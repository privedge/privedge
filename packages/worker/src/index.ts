import { getLandingHTML } from './landing'
import {
  detectPII,
  detectSecrets,
  detectPIINER,
  extractMessages,
  getMessages,
  anonymize,
  deanonymize,
  type AnonMap,
  type NerEntity,
} from './pii'
import { validateKey, type KeyData } from './auth'
import { checkRateLimit, checkEdgeRateLimit } from './ratelimit'
import { writeLog } from './logger'

export interface Env {
  AI: Ai
  // Cloud egress is routed through Cloudflare AI Gateway's OpenAI-compatible endpoint.
  CF_ACCOUNT_ID: string       // AI Gateway account id
  CF_AIG_GATEWAY_ID: string   // AI Gateway gateway id (slug)
  CF_AIG_TOKEN: string        // gateway authorization token (cf-aig-authorization)
  // Managed-mode provider keys (Privedge's own). One per provider; selected per key.
  PROVIDER_KEY_OPENAI?: string
  PROVIDER_KEY_ANTHROPIC?: string
  PROVIDER_KEY_GOOGLE?: string
  PROVIDER_KEY_DEEPSEEK?: string
  PROVIDER_KEY_MISTRAL?: string
  // Legacy single-secret egress — kept as a managed/OpenAI fallback during migration.
  OPENAI_BASE_URL?: string
  CLOUD_API_KEY?: string
  PRIVEDGE_KEYS: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  PII_STRATEGY?: string   // "anonymize" | "edge" — self-host env var fallback
  EDGE_MODEL?: string     // Workers AI model — self-host env var fallback
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** Strategy info echoed back in every successful response so clients (and the demo) can show what ran. */
interface StrategyMeta {
  applied_strategy: 'anonymize' | 'edge'        // what actually ran for this request
  strategy_mode: 'anonymize' | 'edge' | 'custom' // the key's configured mode
}

/** Builds a JSON error response with CORS headers. */
function authError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status, headers: CORS })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      let healthy = false
      try {
        await env.PRIVEDGE_KEYS.get('__health__')
        healthy = !!env.AI
      } catch { /* KV unreachable — unhealthy */ }
      const status = healthy ? 200 : 503
      return new Response(getLandingHTML(healthy), { status, headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS } })
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/v1/keys/info') {
      const keyData = await validateKey(request, env.PRIVEDGE_KEYS)
      if (!keyData) return authError('Unauthorized — provide a valid Privedge API key', 401)
      return Response.json(
        {
          provider: keyData.provider ?? 'openai',
          provider_mode: keyData.provider_mode ?? 'managed',
          cloud_model: keyData.cloud_model ?? null,
        },
        { headers: CORS },
      )
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const keyData = await validateKey(request, env.PRIVEDGE_KEYS)
    if (!keyData) {
      return authError('Unauthorized — provide a valid Privedge API key', 401)
    }

    const edgeModel   = keyData.edge_model ?? env.EDGE_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    const cf = request.cf as { colo?: string; country?: string; city?: string } | undefined
    const cfNode         = cf?.colo ?? null
    const requestCountry = cf?.country ?? null
    const requestCity    = cf?.city ?? null

    const rl = await checkRateLimit(keyData.user_id, keyData.tier, env.PRIVEDGE_KEYS)
    const rlHeaders = {
      ...CORS,
      'X-RateLimit-Limit': String(rl.limit),
      'X-RateLimit-Remaining': String(rl.remaining),
      'X-RateLimit-Reset': rl.reset,
    }

    if (!rl.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded', limit: rl.limit, tier: keyData.tier, reset: rl.reset },
        { status: 429, headers: rlHeaders },
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    // Strategy mode of the key: 'edge'/'anonymize' are fixed; 'custom' lets the caller pick per request.
    const mode = (keyData.pii_strategy ?? env.PII_STRATEGY ?? 'anonymize') as 'anonymize' | 'edge' | 'custom'
    const bodyStrategy = (body as Record<string, unknown>)?.pii_strategy as 'anonymize' | 'edge' | undefined

    // Fail-loud: an explicit body strategy that contradicts a fixed key is a config error, not a silent override.
    if (mode !== 'custom' && bodyStrategy && bodyStrategy !== mode) {
      return authError(
        `Invalid pii_strategy '${bodyStrategy}' for the provided API key (configured as '${mode}'). ` +
        `Check your API key configuration in the dashboard.`,
        400,
        { code: 'strategy_mismatch', configured: mode },
      )
    }

    // Effective strategy actually applied to this request.
    const piiStrategy: 'anonymize' | 'edge' =
      mode === 'custom'
        ? (bodyStrategy === 'edge' || bodyStrategy === 'anonymize' ? bodyStrategy : 'anonymize')
        : mode
    const strategyMeta: StrategyMeta = { applied_strategy: piiStrategy, strategy_mode: mode }

    const start = Date.now()
    const prompt = extractMessages(body)

    // Collect detection results for logging
    let piiTypes: string[] = []
    let piiMatches = 0
    let anonymized = false

    // Secret detection — runs sync, no cost
    const secrets = detectSecrets(prompt)

    // PII detection — regex always; NER only for Pro/Enterprise
    const isPaidTier = keyData.tier === 'pro' || keyData.tier === 'enterprise'
    const [regexResult, nerResult] = await Promise.all([
      Promise.resolve(detectPII(prompt)),
      isPaidTier ? detectPIINER(prompt, env.AI) : Promise.resolve({ detected: false, entities: [] }),
    ])

    const nerEntities: NerEntity[] = nerResult.entities
    const detected = regexResult.detected || nerResult.detected
    piiTypes = [...new Set([...regexResult.types, ...nerEntities.map(e => e.type)])]
    piiMatches = regexResult.matches + nerEntities.length

    if (secrets.detected) piiTypes = [...piiTypes, 'SECRET']

    const hasAnything = detected || secrets.detected

    if (!hasAnything) {
      const { pii_strategy: _ps2, ...cleanBody } = body as Record<string, unknown>
      const response = await routeToCloud(cleanBody, env, keyData, rlHeaders, start, strategyMeta)
      const latencyMs = Date.now() - start
      const data = await response.clone().json().catch(() => null) as Record<string, unknown> | null
      const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
      ctx.waitUntil(writeLog(env, {
        keyData,
        anonymized: false,
        piiTypes: [],

        piiMatches: 0,
        tokensIn: usage?.prompt_tokens ?? null,
        tokensOut: usage?.completion_tokens ?? null,
        latencyMs,
        statusCode: response.status,
        piiStrategy,
        providerMode: keyData.provider_mode ?? 'managed',
        provider: keyData.provider ?? 'openai',
        cloudModel: (cleanBody.model as string | undefined) ?? keyData.cloud_model,
        cfNode,
        requestCountry,
        requestCity,
      }))
      return response
    }

    // PII detected — bifurcate by strategy
    if (piiStrategy === 'edge') {
      const edgeRl = await checkEdgeRateLimit(env, keyData)
      if (!edgeRl.allowed) {
        return Response.json(
          { error: 'Edge inference rate limit exceeded', limit: edgeRl.limit, tier: keyData.tier },
          {
            status: 429,
            headers: {
              ...rlHeaders,
              'X-Edge-Limit': String(edgeRl.limit),
              'X-Edge-Remaining': '0',
            },
          },
        )
      }
      const response = await routeToEdge(body, env, {
        ...rlHeaders,
        'X-Edge-Limit': String(edgeRl.limit),
        'X-Edge-Remaining': String(edgeRl.remaining),
      }, piiMatches, nerEntities, start, edgeModel, strategyMeta)
      const latencyMs = Date.now() - start
      ctx.waitUntil(writeLog(env, {
        keyData,
        anonymized: false,
        piiTypes,

        piiMatches,
        tokensIn: null,
        tokensOut: null,
        latencyMs,
        statusCode: response.status,
        piiStrategy,
        edgeModel,
        cfNode,
        requestCountry,
        requestCity,
      }))
      return response
    }

    // Anonymize + route + de-anonymize (default: 'anonymize')
    anonymized = true
    const messages = getMessages(body)
    const { messages: anonMessages, map } = anonymize(messages, nerEntities)
    const { pii_strategy: _ps, ...bodyRest } = body as Record<string, unknown>
    const anonBody = { ...bodyRest, messages: anonMessages }

    const response = await routeToCloudAnon(anonBody, env, keyData, rlHeaders, piiMatches, nerEntities, map, start, strategyMeta)
    const latencyMs = Date.now() - start
    const data = await response.clone().json().catch(() => null) as Record<string, unknown> | null
    const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined

    ctx.waitUntil(writeLog(env, {
      keyData,
      anonymized,
      piiTypes,
      hasSecret: secrets.detected,
      piiMatches,
      tokensIn: usage?.prompt_tokens ?? null,
      tokensOut: usage?.completion_tokens ?? null,
      latencyMs,
      statusCode: response.status,
      piiStrategy,
      providerMode: keyData.provider_mode ?? 'managed',
      provider: keyData.provider ?? 'openai',
      cloudModel: ((anonBody as Record<string, unknown>).model as string | undefined) ?? keyData.cloud_model,
      cfNode,
      requestCountry,
      requestCity,
    }))

    return response
  },
}

interface CloudRequest {
  url: string
  headers: Record<string, string>
  modelPrefix: string   // '' when talking to a provider directly (legacy/self-host)
}

/** Selects Privedge's own (managed-mode) provider key for the given provider. */
function pickManagedKey(env: Env, provider: string): string | undefined {
  switch (provider) {
    case 'anthropic': return env.PROVIDER_KEY_ANTHROPIC
    case 'google':    return env.PROVIDER_KEY_GOOGLE
    case 'deepseek':  return env.PROVIDER_KEY_DEEPSEEK
    case 'mistral':   return env.PROVIDER_KEY_MISTRAL
    case 'openai':
    default:          return env.PROVIDER_KEY_OPENAI ?? env.CLOUD_API_KEY
  }
}

/**
 * Builds the cloud egress target (URL + headers + model prefix) for a key.
 * - With AI Gateway configured: routes through the OpenAI-compatible `/compat` endpoint.
 *   BYOK → the gateway injects the customer's stored key by alias (we send no provider
 *   Authorization). Managed → we send Privedge's own provider key.
 * - Without AI Gateway (self-host / pre-migration): falls back to a direct
 *   OpenAI-compatible endpoint with the single shared CLOUD_API_KEY, no model prefix.
 */
function buildCloudRequest(env: Env, keyData: KeyData): CloudRequest {
  const provider = keyData.provider ?? 'openai'
  const mode = keyData.provider_mode ?? 'managed'
  const gatewayConfigured = !!(env.CF_ACCOUNT_ID && env.CF_AIG_GATEWAY_ID && env.CF_AIG_TOKEN)

  if (!gatewayConfigured) {
    return {
      url: `${env.OPENAI_BASE_URL ?? 'https://api.openai.com'}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        ...(env.CLOUD_API_KEY ? { Authorization: `Bearer ${env.CLOUD_API_KEY}` } : {}),
      },
      modelPrefix: '',
    }
  }

  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AIG_GATEWAY_ID}/compat/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
  }
  if (mode === 'byok') {
    // Customer key lives in CF Secrets Store; never send a provider Authorization header.
    headers['cf-aig-byok-alias'] = keyData.byok_alias ?? keyData.api_key_id
  } else {
    const key = pickManagedKey(env, provider)
    if (key) headers.Authorization = `Bearer ${key}`
  }
  return { url, headers, modelPrefix: provider }
}

/** Prefixes the body's `model` for the AI Gateway compat endpoint (e.g. `anthropic/claude-…`). No-op if empty prefix or already prefixed. */
function applyModelPrefix(body: Record<string, unknown>, prefix: string): Record<string, unknown> {
  if (!prefix) return body
  const model = body.model
  if (typeof model !== 'string' || model.includes('/')) return body
  return { ...body, model: `${prefix}/${model}` }
}

/**
 * Routes the request to Workers AI (edge inference) without anonymization.
 * PII never leaves the Cloudflare network — the LLM runs on the same edge node.
 * Returns an OpenAI-compatible chat completion response.
 */
async function routeToEdge(
  body: unknown,
  env: Env,
  extraHeaders: Record<string, string>,
  piiMatches: number,
  nerEntities: NerEntity[],
  start: number,
  model: string,
  meta: StrategyMeta,
): Promise<Response> {
  const b = body as Record<string, unknown>
  const messages = b.messages as Array<{ role: string; content: string }>

  const result = await (env.AI.run as Function)(model, {
    messages,
    max_tokens: (b.max_tokens as number) ?? 1024,
    temperature: (b.temperature as number) ?? 0.7,
  })

  return Response.json(
    {
      id: `chatcmpl-edge-${Date.now()}`,
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: (result as { response: string }).response },
          finish_reason: 'stop',
        },
      ],
      routed_to: 'edge',
      anonymized: false,
      pii_matches: piiMatches,
      ner_entities: nerEntities.map((e: NerEntity) => e.type),
      latency_ms: Date.now() - start,
      applied_strategy: meta.applied_strategy,
      strategy_mode: meta.strategy_mode,
    },
    { headers: extraHeaders },
  )
}

/**
 * Sends the already-anonymized request to the cloud LLM, then restores original values
 * in every choice message before returning. The cloud provider never sees raw PII.
 */
async function routeToCloudAnon(
  anonBody: unknown,
  env: Env,
  keyData: KeyData,
  extraHeaders: Record<string, string>,
  piiMatches: number,
  nerEntities: NerEntity[],
  map: AnonMap,
  start: number,
  meta: StrategyMeta,
): Promise<Response> {
  const { url, headers, modelPrefix } = buildCloudRequest(env, keyData)
  const outBody = applyModelPrefix(anonBody as Record<string, unknown>, modelPrefix)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(outBody),
  })

  if (!response.ok) {
    const text = await response.text()
    return new Response(text, { status: response.status, headers: extraHeaders })
  }

  const data = (await response.json()) as Record<string, unknown>

  const choices = (data.choices as Array<Record<string, unknown>>)?.map(choice => {
    const msg = choice.message as Record<string, string> | undefined
    if (!msg?.content) return choice
    return { ...choice, message: { ...msg, content: deanonymize(msg.content, map) } }
  })

  return Response.json(
    {
      ...data,
      choices,
      routed_to: 'cloud',
      anonymized: true,
      pii_matches: piiMatches,
      ner_entities: nerEntities.map(e => e.type),
      latency_ms: Date.now() - start,
      applied_strategy: meta.applied_strategy,
      strategy_mode: meta.strategy_mode,
    },
    { status: response.status, headers: extraHeaders },
  )
}

/** Pass-through to the cloud LLM. Only called when no PII or secrets were detected, so no anonymization needed. */
async function routeToCloud(
  body: unknown,
  env: Env,
  keyData: KeyData,
  extraHeaders: Record<string, string>,
  start: number,
  meta: StrategyMeta,
): Promise<Response> {
  const { url, headers, modelPrefix } = buildCloudRequest(env, keyData)
  const outBody = applyModelPrefix(body as Record<string, unknown>, modelPrefix)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(outBody),
  })

  const data = (await response.json()) as Record<string, unknown>
  return Response.json(
    {
      ...data,
      routed_to: 'cloud',
      anonymized: false,
      pii_matches: 0,
      ner_entities: [],
      latency_ms: Date.now() - start,
      applied_strategy: meta.applied_strategy,
      strategy_mode: meta.strategy_mode,
    },
    { status: response.status, headers: extraHeaders },
  )
}

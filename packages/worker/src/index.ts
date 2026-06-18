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
import { validateKey } from './auth'
import { checkRateLimit, checkEdgeRateLimit } from './ratelimit'
import { writeLog } from './logger'

export interface Env {
  AI: Ai
  OPENAI_BASE_URL: string
  CLOUD_API_KEY: string
  PRIVEDGE_KEYS: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  PII_STRATEGY?: string   // "anonymize" | "edge" — self-host env var fallback
  EDGE_MODEL?: string     // Workers AI model — self-host env var fallback
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      const response = await routeToCloud(cleanBody, env, rlHeaders, start, strategyMeta)
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

    const response = await routeToCloudAnon(anonBody, env, rlHeaders, piiMatches, nerEntities, map, start, strategyMeta)
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
      cfNode,
      requestCountry,
      requestCity,
    }))

    return response
  },
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
  extraHeaders: Record<string, string>,
  piiMatches: number,
  nerEntities: NerEntity[],
  map: AnonMap,
  start: number,
  meta: StrategyMeta,
): Promise<Response> {
  const response = await fetch(`${env.OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CLOUD_API_KEY}`,
    },
    body: JSON.stringify(anonBody),
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
  extraHeaders: Record<string, string>,
  start: number,
  meta: StrategyMeta,
): Promise<Response> {
  const response = await fetch(`${env.OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CLOUD_API_KEY}`,
    },
    body: JSON.stringify(body),
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

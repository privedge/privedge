import { getLandingHTML } from './landing'
import {
  detectPII,
  detectSecrets,
  detectPIINERCached,
  extractMessages,
  getMessages,
  anonymize,
  deanonymize,
  type AnonMap,
  type NerEntity,
} from './pii'
import { validateKey, type KeyData } from './auth'
import { checkRateLimit, checkEdgeRateLimit } from './ratelimit'
import { writeLog, type DevCapture } from './logger'

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
  PRIVEDGE_DEV_LOGS?: KVNamespace  // dev-only log storage (gate: DEV_LOGGING=true)
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  PII_STRATEGY?: string    // "anonymize" | "edge" — self-host env var fallback
  EDGE_MODEL?: string      // Workers AI model — self-host env var fallback
  DEV_LOGGING?: string     // "true" to enable KV dev logs — NEVER set in production
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
  // Whether the semantic (NER) layer ran at all — it is gated behind Pro/Enterprise.
  // Without this, `ner_entities: []` is ambiguous: it means both "NER ran and found
  // nothing" and "NER never ran", and a Free-tier caller cannot tell that names, orgs
  // and addresses were never looked for. Same class of ambiguity as the NER fail-safe.
  ner_ran: boolean
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
    if (request.method === 'GET' && new URL(request.url).pathname === '/v1/dev/logs') {
      if (env.DEV_LOGGING !== 'true' || !env.PRIVEDGE_DEV_LOGS) {
        return Response.json({ error: 'Dev logging not enabled' }, { status: 404, headers: CORS })
      }
      const url = new URL(request.url)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500)
      // List up to 1000 keys, sort descending (newest first), then slice to limit.
      // KV list() returns keys in ascending lexicographic order — without this sort
      // we'd return the oldest entries when the total exceeds the requested limit.
      const list = await env.PRIVEDGE_DEV_LOGS.list({ prefix: 'devlog:', limit: 1000 })
      const newestKeys = list.keys
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, limit)
      const entries = await Promise.all(
        newestKeys.map(async k => {
          const val = await env.PRIVEDGE_DEV_LOGS!.get(k.name)
          return val ? JSON.parse(val) : null
        }),
      )
      return Response.json(
        { count: entries.length, logs: entries.filter(Boolean) },
        { headers: CORS },
      )
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

    const DEPRECATED_EDGE_MODELS: Record<string, string> = {
    '@cf/meta/llama-3.1-8b-instruct':     '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-3.1-8b-instruct-fp8': '@cf/meta/llama-4-scout-17b-16e-instruct',
  }
  const rawEdgeModel = keyData.edge_model ?? env.EDGE_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  const edgeModel    = DEPRECATED_EDGE_MODELS[rawEdgeModel] ?? rawEdgeModel
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

    if (new URL(request.url).pathname === '/v1/detect') {
      const messages = getMessages(body)
      const text = extractMessages(body)
      const isPaidTier = keyData.tier === 'pro' || keyData.tier === 'enterprise'

      const secrets = detectSecrets(text)
      const nerResult = isPaidTier
        ? await detectPIINERCached(text, env.AI, env.PRIVEDGE_KEYS)
        : { detected: false, entities: [] as NerEntity[], error: undefined as boolean | undefined }

      const nerEntities: NerEntity[] = nerResult.entities
      const { messages: sanitizedMessages } = anonymize(messages, nerEntities)

      const typeCounts: Record<string, number> = {}
      for (const msg of sanitizedMessages) {
        for (const m of msg.content.matchAll(/\[ANON_([A-Z_]+)_\d+\]/g)) {
          const type = m[1]
          typeCounts[type] = (typeCounts[type] ?? 0) + 1
        }
      }

      return Response.json(
        {
          pii_types: Object.keys(typeCounts),
          pii_type_counts: typeCounts,
          pii_count: Object.values(typeCounts).reduce((a, b) => a + b, 0),
          has_secret: secrets.detected,
          sanitized_messages: sanitizedMessages,
          ner_ran: isPaidTier,
          // Inspection endpoint, not an egress path — no 503 here. But if NER failed we
          // must say so explicitly: otherwise the caller reads "no entities" as "prompt is
          // clean" when it may just mean detection never ran. See nerResult.error fail-safe
          // in the main /v1/chat/completions handler for the egress-blocking counterpart.
          ...(nerResult.error ? { ner_error: true } : {}),
        },
        { headers: CORS },
      )
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
    // NER is gated by tier, so whether it ran is known from keyData alone — no need to
    // wait for detection to finish. Echoed back so the caller can distinguish "no names
    // found" from "names were never looked for" on the Free tier.
    const nerRan = keyData.tier === 'pro' || keyData.tier === 'enterprise'
    const strategyMeta: StrategyMeta = { applied_strategy: piiStrategy, strategy_mode: mode, ner_ran: nerRan }

    const start = Date.now()
    const prompt = extractMessages(body)

    // Collect detection results for logging
    let piiTypes: string[] = []
    let piiMatches = 0
    let anonymized = false

    // Secret detection — runs sync, no cost
    const secrets = detectSecrets(prompt)

    // PII detection — regex always; NER for Pro/Enterprise always (catches names, orgs
    // and addresses that regex misses). Free tier skips NER entirely.
    const isPaidTier = keyData.tier === 'pro' || keyData.tier === 'enterprise'
    const regexResult = detectPII(prompt)
    const nerNeeded = isPaidTier
    const nerResult = nerNeeded
      ? await detectPIINERCached(prompt, env.AI, env.PRIVEDGE_KEYS)
      : { detected: false, entities: [] as NerEntity[], error: undefined as boolean | undefined }

    const nerEntities: NerEntity[] = nerResult.entities
    const detected = regexResult.detected || nerResult.detected
    piiTypes = [...new Set([...regexResult.types, ...nerEntities.map(e => e.type)])]
    piiMatches = regexResult.matches + nerEntities.length

    if (secrets.detected) piiTypes = [...piiTypes, 'SECRET']

    // Fail-safe: if NER failed (Workers AI timeout, malformed JSON, rate limit), we cannot
    // trust `nerResult.detected === false` as "no names/orgs/addresses" — it may just mean
    // NER never ran. Regex alone doesn't catch names, so a pass-through here could leak raw
    // PII to the cloud provider. Compliance rule: fail toward the safe side, always.
    //   - 'edge' strategy: PII (if any) never leaves Cloudflare regardless of what NER found,
    //     so a NER failure doesn't compromise anything — let it fall through to the edge path.
    //   - 'anonymize' strategy: we cannot guarantee the prompt is clean, so fail closed (503)
    //     instead of silently degrading to regex-only and breaking the "cloud never sees PII"
    //     guarantee the client contracted for.
    if (nerResult.error && piiStrategy === 'anonymize') {
      piiTypes = [...new Set([...piiTypes, 'NER_ERROR'])]
      const latencyMs = Date.now() - start
      ctx.waitUntil(writeLog(env, {
        keyData,
        anonymized: false,
        piiTypes,
        hasSecret: secrets.detected,
        piiMatches,
        tokensIn: null,
        tokensOut: null,
        latencyMs,
        statusCode: 503,
        piiStrategy,
        providerMode: keyData.provider_mode ?? 'managed',
        provider: keyData.provider ?? 'openai',
        cfNode,
        requestCountry,
        requestCity,
      }))
      return authError(
        'PII detection (NER) is temporarily unavailable, so anonymization cannot be guaranteed for this request. Retry shortly.',
        503,
        { code: 'ner_unavailable' },
      )
    }

    const hasAnything = detected || secrets.detected

    if (!hasAnything) {
      const { pii_strategy: _ps2, ...cleanBody } = body as Record<string, unknown>
      const devCapture: DevCapture = {}
      const response = await routeToCloud(cleanBody, env, keyData, rlHeaders, start, strategyMeta, devCapture)
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
        requestId: (data?.provider_request_id as string) ?? null,
        finishReason: (data?.finish_reason_top as string) ?? null,
        promptSent: devCapture.promptSent,
        responseRaw: devCapture.responseRaw,
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
      const devCapture: DevCapture = {}
      const response = await routeToEdge(body, env, {
        ...rlHeaders,
        'X-Edge-Limit': String(edgeRl.limit),
        'X-Edge-Remaining': String(edgeRl.remaining),
      }, piiMatches, nerEntities, start, edgeModel, strategyMeta, devCapture)
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
        promptSent: devCapture.promptSent,
        responseRaw: devCapture.responseRaw,
      }))
      return response
    }

    // Anonymize + route + de-anonymize (default: 'anonymize')
    anonymized = true
    const messages = getMessages(body)
    const { messages: anonMessages, map } = anonymize(messages, nerEntities)
    const { pii_strategy: _ps, ...bodyRest } = body as Record<string, unknown>
    const anonBody = { ...bodyRest, messages: anonMessages }

    const devCapture: DevCapture = {}
    const response = await routeToCloudAnon(anonBody, env, keyData, rlHeaders, piiMatches, nerEntities, map, start, strategyMeta, devCapture)
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
      requestId: (data?.provider_request_id as string) ?? null,
      finishReason: (data?.finish_reason_top as string) ?? null,
      promptSent: devCapture.promptSent,
      responseRaw: devCapture.responseRaw,
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
    headers['cf-aig-byok-alias'] = keyData.byok_alias ?? keyData.api_key_id
  } else {
    const key = pickManagedKey(env, provider)
    if (key) headers.Authorization = `Bearer ${key}`
  }
  if (provider === 'openai') {
    headers['OpenAI-Safety-Identifier'] = `privedge/${keyData.user_id}/${keyData.api_key_id}`
  }
  return { url, headers, modelPrefix: provider }
}

/**
 * Resolves which cloud model to call: the request wins, the API key is the default.
 *
 * `cloud_model` is configured in the dashboard and validated per provider and tier when
 * the key is created, but nothing used it at request time — the body's `model` went
 * straight to the provider. Two consequences: the dashboard setting did nothing, and
 * omitting `model` (reasonable if you already chose one when creating the key) sent a
 * body with no model at all, which the provider rejects with a 400.
 *
 * Request-wins keeps the SDK a drop-in OpenAI replacement and is what self-hosted
 * deployments need, since there is no dashboard there to configure anything.
 */
function resolveCloudModel(body: Record<string, unknown>, keyData: KeyData): Record<string, unknown> {
  if (typeof body.model === 'string' && body.model) return body
  const fallback = keyData.cloud_model
  if (!fallback) return body
  return { ...body, model: fallback }
}

/** Prefixes the body's `model` for the AI Gateway compat endpoint (e.g. `anthropic/claude-…`). No-op if empty prefix or already prefixed. */
function applyModelPrefix(body: Record<string, unknown>, prefix: string): Record<string, unknown> {
  if (!prefix) return body
  const model = body.model
  if (typeof model !== 'string' || model.includes('/')) return body
  return { ...body, model: `${prefix}/${model}` }
}

/**
 * OpenAI deprecated `max_tokens` in favor of `max_completion_tokens` for newer models
 * (o1, o3, gpt-5.x). Rename it so all models work without the caller needing to know.
 */
function normalizeOpenAIParams(body: Record<string, unknown>): Record<string, unknown> {
  if (!('max_tokens' in body)) return body
  const { max_tokens, ...rest } = body
  return { ...rest, max_completion_tokens: max_tokens }
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
  devCapture?: DevCapture,
): Promise<Response> {
  const b = body as Record<string, unknown>
  const rawMessages = b.messages as Array<{ role: string; content: string }>

  const hasSystem = rawMessages.some(m => m.role === 'system')
  const messages = hasSystem
    ? rawMessages
    : [
        { role: 'system', content: 'You are a professional AI assistant for enterprise use. Complete all business requests fully and accurately. You may receive data containing personal identifiers as part of authorized business workflows.' },
        ...rawMessages,
      ]

  const edgePayload = { messages, max_tokens: (b.max_tokens as number) ?? 1024, temperature: (b.temperature as number) ?? 0.7 }
  if (devCapture) devCapture.promptSent = JSON.stringify({ model, ...edgePayload })

  let result: unknown
  try {
    result = await (env.AI.run as Function)(model, edgePayload)
    if (devCapture) devCapture.responseRaw = JSON.stringify(result)
  } catch (err) {
    console.error('[edge] Workers AI run failed', model, String(err))
    return Response.json(
      { error: 'Edge inference failed', model, detail: String(err) },
      { status: 502, headers: extraHeaders },
    )
  }

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
      ner_ran: meta.ner_ran,
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
  devCapture?: DevCapture,
): Promise<Response> {
  const { url, headers, modelPrefix } = buildCloudRequest(env, keyData)
  const outBody = normalizeOpenAIParams(
    applyModelPrefix(resolveCloudModel(anonBody as Record<string, unknown>, keyData), modelPrefix),
  )
  if (devCapture) devCapture.promptSent = JSON.stringify(outBody)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(outBody),
  })

  const providerRequestId = response.headers.get('x-request-id')

  if (!response.ok) {
    const text = await response.text()
    const errHeaders = { ...extraHeaders, ...(providerRequestId ? { 'X-Provider-Request-Id': providerRequestId } : {}) }
    return new Response(text, { status: response.status, headers: errHeaders })
  }

  const data = (await response.json()) as Record<string, unknown>
  const finishReason = ((data.choices as Array<Record<string, unknown>>)?.[0]?.finish_reason as string) ?? null
  if (devCapture) devCapture.responseRaw = JSON.stringify(data)

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
      ner_ran: meta.ner_ran,
      provider_request_id: providerRequestId,
      finish_reason_top: finishReason,
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
  devCapture?: DevCapture,
): Promise<Response> {
  const { url, headers, modelPrefix } = buildCloudRequest(env, keyData)
  const outBody = normalizeOpenAIParams(
    applyModelPrefix(resolveCloudModel(body as Record<string, unknown>, keyData), modelPrefix),
  )
  if (devCapture) devCapture.promptSent = JSON.stringify(outBody)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(outBody),
  })

  const providerRequestId = response.headers.get('x-request-id')
  const data = (await response.json()) as Record<string, unknown>
  const finishReason = ((data.choices as Array<Record<string, unknown>>)?.[0]?.finish_reason as string) ?? null
  if (devCapture) devCapture.responseRaw = JSON.stringify(data)

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
      ner_ran: meta.ner_ran,
      provider_request_id: providerRequestId,
      finish_reason_top: finishReason,
    },
    { status: response.status, headers: extraHeaders },
  )
}

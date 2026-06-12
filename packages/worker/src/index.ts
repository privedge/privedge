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

function authError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status, headers: CORS })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const keyData = await validateKey(request, env.PRIVEDGE_KEYS)
    if (!keyData) {
      return authError('Unauthorized — provide a valid Privedge API key', 401)
    }

    const piiStrategy = (keyData.pii_strategy ?? env.PII_STRATEGY ?? 'anonymize') as 'anonymize' | 'edge'
    const edgeModel   = keyData.edge_model ?? env.EDGE_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    const colo        = request.cf?.colo ?? null
    const country     = request.cf?.country ?? null
    const city        = (request.cf as { city?: string } | undefined)?.city ?? null

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

    const start = Date.now()
    const prompt = extractMessages(body)

    // Collect detection results for logging
    let piiTypes: string[] = []
    let secretTypes: string[] = []
    let piiMatches = 0
    let anonymized = false

    // Secret detection
    const secrets = detectSecrets(prompt)
    secretTypes = secrets.types

    // PII detection — regex first, NER if no match
    const { detected: regexDetected, matches, types } = detectPII(prompt)
    piiTypes = types
    piiMatches = matches
    let nerEntities: NerEntity[] = []

    let detected = regexDetected
    if (!detected) {
      const ner = await detectPIINER(prompt, env.AI)
      detected = ner.detected
      nerEntities = ner.entities
      if (detected) piiTypes = nerEntities.map(e => e.type)
    }

    const hasAnything = detected || secrets.detected

    if (!hasAnything) {
      const response = await routeToCloud(body, env, rlHeaders, start)
      const latencyMs = Date.now() - start
      const data = await response.clone().json().catch(() => null) as Record<string, unknown> | null
      const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
      ctx.waitUntil(writeLog(env, {
        keyData,
        anonymized: false,
        piiTypes: [],
        secretTypes,
        piiMatches: 0,
        tokensIn: usage?.prompt_tokens ?? null,
        tokensOut: usage?.completion_tokens ?? null,
        latencyMs,
        statusCode: response.status,
        piiStrategy,
        colo,
        country,
        city,
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
      }, piiMatches, nerEntities, start, edgeModel)
      const latencyMs = Date.now() - start
      ctx.waitUntil(writeLog(env, {
        keyData,
        anonymized: false,
        piiTypes,
        secretTypes,
        piiMatches,
        tokensIn: null,
        tokensOut: null,
        latencyMs,
        statusCode: response.status,
        piiStrategy,
        edgeModel,
        colo,
        country,
        city,
      }))
      return response
    }

    // Anonymize + route + de-anonymize (default: 'anonymize')
    anonymized = true
    const messages = getMessages(body)
    const { messages: anonMessages, map } = anonymize(messages, nerEntities)
    const anonBody = { ...(body as Record<string, unknown>), messages: anonMessages }

    const response = await routeToCloudAnon(anonBody, env, rlHeaders, piiMatches, nerEntities, map, start)
    const latencyMs = Date.now() - start
    const data = await response.clone().json().catch(() => null) as Record<string, unknown> | null
    const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined

    ctx.waitUntil(writeLog(env, {
      keyData,
      anonymized,
      piiTypes,
      secretTypes,
      piiMatches,
      tokensIn: usage?.prompt_tokens ?? null,
      tokensOut: usage?.completion_tokens ?? null,
      latencyMs,
      statusCode: response.status,
      piiStrategy,
      colo,
      country,
      city,
    }))

    return response
  },
}

async function routeToEdge(
  body: unknown,
  env: Env,
  extraHeaders: Record<string, string>,
  piiMatches: number,
  nerEntities: NerEntity[],
  start: number,
  model: string,
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
    },
    { headers: extraHeaders },
  )
}

async function routeToCloudAnon(
  anonBody: unknown,
  env: Env,
  extraHeaders: Record<string, string>,
  piiMatches: number,
  nerEntities: NerEntity[],
  map: AnonMap,
  start: number,
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
    },
    { status: response.status, headers: extraHeaders },
  )
}

async function routeToCloud(
  body: unknown,
  env: Env,
  extraHeaders: Record<string, string>,
  start: number,
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
    },
    { status: response.status, headers: extraHeaders },
  )
}

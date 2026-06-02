import {
  detectPII,
  detectPIINER,
  extractMessages,
  getMessages,
  anonymize,
  deanonymize,
  type AnonMap,
  type NerEntity,
} from './pii'

export interface Env {
  AI: Ai
  OPENAI_BASE_URL: string
  CLOUD_API_KEY: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Privedge-Compliance',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const start = Date.now()
    const compliance = request.headers.get('X-Privedge-Compliance')
    const prompt = extractMessages(body)

    // Without compliance header — pass through to cloud untouched
    if (!compliance) {
      return routeToCloud(body, request, env, 0, [], false, start)
    }

    // Hybrid detection: regex first (fast) → NER only if regex misses
    const { detected: regexDetected, matches } = detectPII(prompt)

    let detected = regexDetected
    let nerEntities: NerEntity[] = []

    if (!detected) {
      const ner = await detectPIINER(prompt, env.AI)
      detected = ner.detected
      nerEntities = ner.entities
    }

    if (!detected) {
      return routeToCloud(body, request, env, 0, [], false, start)
    }

    // PII detected — anonymize → cloud → de-anonymize
    const messages = getMessages(body)
    const { messages: anonMessages, map } = anonymize(messages, nerEntities)
    const anonBody = { ...(body as Record<string, unknown>), messages: anonMessages }

    return routeToCloudAnon(anonBody, request, env, matches, nerEntities, map, start)
  },
}

async function routeToCloudAnon(
  anonBody: unknown,
  request: Request,
  env: Env,
  piiMatches: number,
  nerEntities: NerEntity[],
  map: AnonMap,
  start: number,
): Promise<Response> {
  const authHeader = request.headers.get('Authorization') ?? `Bearer ${env.CLOUD_API_KEY}`

  const response = await fetch(`${env.OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(anonBody),
  })

  if (!response.ok) {
    const text = await response.text()
    return new Response(text, { status: response.status, headers: CORS })
  }

  const data = (await response.json()) as Record<string, unknown>

  // De-anonymize all choice message contents
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
    { status: response.status, headers: CORS },
  )
}

async function routeToCloud(
  body: unknown,
  request: Request,
  env: Env,
  piiMatches: number,
  nerEntities: NerEntity[],
  anonymized: boolean,
  start: number,
): Promise<Response> {
  const authHeader = request.headers.get('Authorization') ?? `Bearer ${env.CLOUD_API_KEY}`

  const response = await fetch(`${env.OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as Record<string, unknown>
  return Response.json(
    {
      ...data,
      routed_to: 'cloud',
      anonymized,
      pii_matches: piiMatches,
      ner_entities: nerEntities.map(e => e.type),
      latency_ms: Date.now() - start,
    },
    { status: response.status, headers: CORS },
  )
}

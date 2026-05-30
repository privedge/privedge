import { detectPII, extractMessages } from './pii'

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

    const prompt = extractMessages(body)
    const hasPII = detectPII(prompt)
    const compliance = request.headers.get('X-Privedge-Compliance')

    if (hasPII && compliance) {
      return routeToEdge(body, env)
    }

    return routeToCloud(body, request, env)
  },
}

async function routeToEdge(body: unknown, env: Env): Promise<Response> {
  const b = body as Record<string, unknown>
  const messages = b.messages as { role: string; content: string }[]

  const result = await env.AI.run('@cf/meta/llama-3.2-1b-instruct' as Parameters<Ai['run']>[0], {
    messages,
  })

  return Response.json(
    {
      id: `privedge-${Date.now()}`,
      object: 'chat.completion',
      model: 'llama-3.2-1b-instruct',
      routed_to: 'edge',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: (result as { response: string }).response },
          finish_reason: 'stop',
        },
      ],
    },
    { headers: CORS }
  )
}

async function routeToCloud(body: unknown, request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization') ?? `Bearer ${env.CLOUD_API_KEY}`

  const response = await fetch(`${env.OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  })

  const data = await response.json()
  return Response.json(
    { ...data, routed_to: 'cloud' },
    { status: response.status, headers: CORS }
  )
}

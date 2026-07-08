/**
 * Throwaway eval worker: POST { model, text } → runs the production nerPrompt
 * against the given Workers AI model and returns the raw parsed entities
 * (pre-verbatim-filter) plus latency, so the runner can measure paraphrase rate.
 */
const nerPrompt = (text: string) =>
  `List PII entities in this text. Reply with JSON only, no explanation.
{"entities":[{"type":"PERSON","value":"exact name"},{"type":"ORG","value":"exact org"}]}
Types: PERSON=full names, ORG=companies/hospitals/insurers, ADDRESS=street addresses
Values must appear verbatim. Empty: {"entities":[]}
Text: ${JSON.stringify(text)}`

interface Env {
  AI: { run: (model: string, input: unknown) => Promise<unknown> }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 })
    const { model, text } = (await req.json()) as { model: string; text: string }
    const start = Date.now()
    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: 'system', content: 'Reply with valid JSON only. No markdown, no explanation.' },
          { role: 'user', content: nerPrompt(text) },
        ],
        max_tokens: 256,
      })
      const resp = (result as { response: unknown }).response
      const parsed = (typeof resp === 'string'
        ? JSON.parse(resp.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        : resp) as { entities?: Array<{ type: string; value: string }> }
      return Response.json({
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        raw: resp,
        latencyMs: Date.now() - start,
      })
    } catch (e) {
      return Response.json({ error: String(e), latencyMs: Date.now() - start }, { status: 500 })
    }
  },
}

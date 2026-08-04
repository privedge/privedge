/**
 * Throwaway eval worker: POST { model, text } → runs the production nerPrompt
 * against the given Workers AI model and returns the raw parsed entities
 * (pre-verbatim-filter) plus latency, so the runner can measure paraphrase rate.
 */
// Kept in sync with production `nerPrompt` in ../src/pii.ts — the eval only means
// something if it runs the exact prompt production runs.
const nerPrompt = (text: string) =>
  `Extract PERSON names, ORG names, and ADDRESS values from this text. Reply with JSON only — no markdown, no explanation.
Format: {"entities":[{"type":"PERSON","value":"exact name as it appears"},{"type":"ORG","value":"exact org"}]}
Rules:
- PERSON: full names of people (patients, doctors, staff)
- ORG: hospitals, clinics, insurers, companies, and Spanish judicial/institutional bodies with a specific identifying name — courts (e.g. "Juzgado de lo Social nº 3 de Valencia"), tribunals, audiencias provinciales, mutuas, notarías, registries
- ORG excludes bar-association abbreviations (ICAM, ICAB, ICAV, and similar) — those are handled elsewhere, never extract them
- ORG must be the specific named entity, not a generic category or department — exclude generic mentions with no identifying number/city/name (e.g. "el juzgado", "la organización"), and exclude hospital department/specialty names (e.g. "Cardiología", "Medicina Interna")
- ADDRESS: street addresses
- DO NOT include emails, phones, dates, IDs, passport numbers — only PERSON/ORG/ADDRESS
- Values must appear verbatim in the text
- If none found: {"entities":[]}
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
        max_tokens: 512,
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

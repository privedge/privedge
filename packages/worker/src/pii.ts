const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,  type: 'EMAIL'  },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                  type: 'SSN'    },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,           type: 'CARD'   },
  { pattern: /\b(\+?34|0034)?[\s-]?[6789]\d{8}\b/g,                     type: 'PHONE'  },
  { pattern: /\b[0-9]{8}[A-Z]\b|\b[XYZ][0-9]{7}[A-Z]\b/g,             type: 'DNI'    },
  { pattern: /\bES\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}[\s]?\d{10}\b/gi, type: 'IBAN'   },
  { pattern: /\b(paciente|patient|diagnos|historial|clinical|medical)\b/gi, type: 'MEDICAL_KW' },
]

export type NerEntity = { type: string; value: string }

// ── Detection ──────────────────────────────────────────────────────────────

export function detectPII(text: string): { detected: boolean; matches: number } {
  const matches = PII_PATTERNS.filter(({ pattern }) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  }).length
  return { detected: matches > 0, matches }
}

const nerPrompt = (text: string) =>
  `Detect PII in this text. Reply ONLY with valid JSON, no explanation.
Format: {"detected":boolean,"entities":[{"type":"PERSON","value":"exact text found"}]}
Types: PERSON (names/nombres), ADDRESS (addresses/direcciones), MEDICAL (conditions/diagnoses/condiciones/diagnósticos), ORG_SENSITIVE
Rules: only include entities whose "value" appears verbatim in the text. ES+EN.
Text: ${JSON.stringify(text)}
JSON:`

export async function detectPIINER(
  text: string,
  ai: Ai,
): Promise<{ detected: boolean; entities: NerEntity[] }> {
  try {
    const result = await (ai.run as Function)('@cf/meta/llama-3.2-3b-instruct', {
      messages: [{ role: 'user', content: nerPrompt(text) }],
      max_tokens: 150,
    })
    const raw: string = (result as { response: string }).response?.trim() ?? ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { detected: false, entities: [] }
    const parsed = JSON.parse(match[0]) as { detected?: boolean; entities?: unknown }
    const entities: NerEntity[] = Array.isArray(parsed.entities)
      ? (parsed.entities as NerEntity[]).filter(
          e => e?.type && e?.value && text.includes(e.value),
        )
      : []
    return { detected: Boolean(parsed.detected) && entities.length > 0, entities }
  } catch {
    return { detected: false, entities: [] }
  }
}

// ── Anonymization ──────────────────────────────────────────────────────────

export type AnonMap = Record<string, string>

export function anonymize(
  messages: Array<{ role: string; content: string }>,
  nerEntities: NerEntity[],
): { messages: Array<{ role: string; content: string }>; map: AnonMap } {
  const map: AnonMap = {}
  const counters: Record<string, number> = {}

  const token = (type: string) => {
    counters[type] = (counters[type] ?? 0) + 1
    return `<${type}_${counters[type]}>`
  }

  const anonymizeText = (text: string): string => {
    let result = text

    // Regex-based PII — structured patterns
    for (const { pattern, type } of PII_PATTERNS) {
      pattern.lastIndex = 0
      result = result.replace(pattern, match => {
        const t = token(type)
        map[t] = match
        return t
      })
    }

    // NER-detected entities — semantic PII
    for (const { type, value } of nerEntities) {
      if (!result.includes(value)) continue
      const t = token(type)
      map[t] = value
      result = result.split(value).join(t)
    }

    return result
  }

  return {
    messages: messages.map(m => ({ ...m, content: anonymizeText(m.content) })),
    map,
  }
}

// ── De-anonymization ───────────────────────────────────────────────────────

export function deanonymize(text: string, map: AnonMap): string {
  let result = text
  for (const [t, value] of Object.entries(map)) {
    result = result.split(t).join(value)
  }
  return result
}

// ── Utilities ──────────────────────────────────────────────────────────────

export function extractMessages(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages)) return ''
  return b.messages
    .map((m: unknown) => (m as Record<string, string>).content ?? '')
    .join(' ')
}

export function getMessages(body: unknown): Array<{ role: string; content: string }> {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages)) return []
  return b.messages as Array<{ role: string; content: string }>
}

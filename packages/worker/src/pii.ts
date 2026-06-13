const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Identity
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,        type: 'EMAIL'      },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                        type: 'SSN'        },
  { pattern: /\b[0-9]{8}[A-Z]\b|\b[XYZ][0-9]{7}[A-Z]\b/g,                   type: 'DNI'        },
  { pattern: /\b[A-Z]{1,3}\d{6,9}\b/g,                                        type: 'PASSPORT'   },
  // Financial
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,                 type: 'CARD'       },
  { pattern: /\b\d{9}\b(?=.*routing|\brouting\b.*\d{9})/gi,                   type: 'ROUTING'    },
  { pattern: /\bES\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}[\s]?\d{10}\b/gi,      type: 'IBAN'       },
  { pattern: /\b\d{2}-\d{7}\b/g,                                               type: 'TAX_ID'     },
  // Phone — US + ES
  { pattern: /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,         type: 'PHONE'      },
  { pattern: /\b(\+?34|0034)?[\s-]?[6789]\d{8}\b/g,                           type: 'PHONE'      },
  // Date patterns
  { pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,                               type: 'DATE'       },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b/g,                                        type: 'DATE'       },
  // Medical / HR IDs
  { pattern: /\bMRN[-\s]?\d{4,}\b/gi,                                          type: 'MRN'        },
  { pattern: /\bEMP[-\s]?\d{4,}\b/gi,                                          type: 'EMP_ID'     },
  { pattern: /\b(APP|BC|ID)[-#]?[A-Z0-9]{4,}\b/g,                            type: 'ID'         },
  // Medical keywords
  { pattern: /\b(paciente|patient|diagnos|historial|clinical|medical|cardiologist|troponin|ECG)\b/gi, type: 'MEDICAL_KW' },
]

const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /AKIA[0-9A-Z]{16}/g,                                                   type: 'SECRET_CLOUD_KEY'  },
  { pattern: /postgres(?:ql)?:\/\/[^\s"'`>]+/gi,                                    type: 'SECRET_DB_URI'     },
  { pattern: /mongodb(?:\+srv)?:\/\/[^\s"'`>]+/gi,                                  type: 'SECRET_DB_URI'     },
  { pattern: /redis:\/\/[^\s"'`>]+/gi,                                               type: 'SECRET_DB_URI'     },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g,    type: 'SECRET_JWT'        },
  { pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,                                            type: 'SECRET_API_KEY'    },
  { pattern: /(?:secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"]?[a-zA-Z0-9_\-.]{20,}/gi, type: 'SECRET_API_KEY' },
]

export type NerEntity = { type: string; value: string }

// ── Detection ──────────────────────────────────────────────────────────────

export function detectPII(text: string): { detected: boolean; matches: number; types: string[] } {
  const types: string[] = []
  for (const { pattern, type } of PII_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) types.push(type)
  }
  return { detected: types.length > 0, matches: types.length, types }
}

export function detectSecrets(text: string): { detected: boolean; types: string[] } {
  const seen = new Set<string>()
  for (const { pattern, type } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) seen.add(type)
  }
  const types = Array.from(seen)
  return { detected: types.length > 0, types }
}

const nerPrompt = (text: string) =>
  `List PII entities in this text. Reply with JSON only, no explanation.
{"entities":[{"type":"PERSON","value":"exact name"},{"type":"ORG","value":"exact org"}]}
Types: PERSON=full names, ORG=companies/hospitals/insurers, ADDRESS=street addresses
Values must appear verbatim. Empty: {"entities":[]}
Text: ${JSON.stringify(text)}`

export async function detectPIINER(
  text: string,
  ai: Ai,
): Promise<{ detected: boolean; entities: NerEntity[] }> {
  try {
    const result = await (ai.run as Function)('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Reply with valid JSON only. No markdown, no explanation.' },
        { role: 'user', content: nerPrompt(text) },
      ],
      max_tokens: 256,
    })
    const raw: string = (result as { response: string }).response?.trim() ?? ''
    const match = raw.match(/\{[^{}]*"entities"\s*:\s*\[[\s\S]*?\]\s*\}/)
      ?? raw.match(/\{[\s\S]*\}/)
    if (!match) return { detected: false, entities: [] }
    const parsed = JSON.parse(match[0]) as { entities?: unknown }
    const lower = text.toLowerCase()
    const entities: NerEntity[] = Array.isArray(parsed.entities)
      ? (parsed.entities as NerEntity[]).filter(
          e => e?.type && e?.value && lower.includes(e.value.toLowerCase()),
        )
      : []
    return { detected: entities.length > 0, entities }
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

    // Secrets first (longer patterns, more specific — order matters)
    for (const { pattern, type } of SECRET_PATTERNS) {
      pattern.lastIndex = 0
      result = result.replace(pattern, match => {
        const t = token(type)
        map[t] = match
        return t
      })
    }

    // Regex-based PII
    for (const { pattern, type } of PII_PATTERNS) {
      pattern.lastIndex = 0
      result = result.replace(pattern, match => {
        const t = token(type)
        map[t] = match
        return t
      })
    }

    // NER-detected entities
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

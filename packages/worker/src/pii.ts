const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Identity
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,        type: 'EMAIL'      },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                        type: 'SSN'        },
  // DNI separator before the check letter covers: none, single hyphen/space/dot, OR a
  // double-space typo (Y1560293  X, common when copy-pasting justified PDF text) —
  // [-.\s]{0,2} keeps the original zero-or-one behavior (12345678Z, 12345678-Z) while
  // also swallowing the double-space case. Dotted-thousands (12.345.678-Z, how Spanish
  // paper forms print the 8-digit body) needs its OWN branch: the dots sit BETWEEN digit
  // groups (3-3-2), not just before the letter, so it can't share the plain alternative.
  { pattern: /\b[0-9]{2}\.[0-9]{3}\.[0-9]{3}[-\s]?[A-Z]\b|\b[0-9]{8}[-.\s]{0,2}[A-Z]\b|\b[XYZ][0-9]{7}[-.\s]{0,2}[A-Z]\b/g, type: 'DNI' },
  // CIF (company tax ID: org-type letter + 7 digits + control digit/letter) MUST run
  // before PASSPORT. Today there is NO dedicated CIF pattern, so a CIF like B12345678
  // accidentally falls inside PASSPORT's shape (1-3 letters + 6-9 digits — B isn't in
  // PASSPORT's excluded-prefix list) and gets anonymized under the WRONG type. That's
  // not cosmetic: a compliance report reading the anonymization map would say "a
  // passport leaked" when it was actually a company tax ID — unacceptable in an audit
  // trail. Anchoring on the specific org-type letters (A/B/P/Q/S seen in this dataset;
  // the full real-world set also includes C/D/E/F/G/H/J/N/R/U/V/W) plus exactly 7
  // digits scopes this narrowly enough to not steal genuine PASSPORT/ID matches.
  { pattern: /\b[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]\b/g,                        type: 'CIF'        },
  // NIG (nº identificación general, judicial procedure ID: provincia+municipio concatenated
  // as 6 digits, then jurisdiction letter, then order/año) must ALSO run before PASSPORT —
  // without this, PASSPORT's [A-Z]{1,3}[-\s]?\d{6,9} was consuming just the leading 6-digit
  // group (e.g. "190746" in "190746 C 256289/2023"), leaving " C 256289/2023" as unconsumed
  // plaintext: a partial-overlap leak worse than a clean miss because it looks handled.
  { pattern: /\b\d{6}[\s]?[A-Z][\s]?\d{6}\/\d{4}\b/g,                        type: 'NIG'        },
  // Lookahead excludes known account/record prefixes (they belong to ID below) so
  // BC-9913482 stays an insurance ID and doesn't double-fire as PASSPORT
  { pattern: /\b(?!(?:APP|BC|ID|BK|ACC|REF|TXN|ACCT|CASE|CLT)[-#\s]?\d)[A-Z]{1,3}[-\s]?\d{6,9}\b/g, type: 'PASSPORT' },
  // Financial — IBAN before CARD: prevents CARD from consuming 16-digit groups inside IBANs.
  // Separator widened from [\s]? to [\s-]? to cover ES84-6791-9102-6868-1954-8269 — people
  // used to hyphenated card/ID formats sometimes apply the same convention to IBANs.
  { pattern: /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}\b/g,                type: 'IBAN'       },
  // Separator widened from [\s-]? to [\s.-]? to cover dotted card numbers (8893.4772.3375.4503),
  // a format seen on printed insurance/mutua cards where dots replace spaces/hyphens.
  { pattern: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g,             type: 'CARD'       },
  { pattern: /(?<=\brouting\b[^0-9]{0,20})\d{9}\b|\b\d{9}\b(?=[^0-9]{0,20}\brouting\b)/gi, type: 'ROUTING' },
  { pattern: /\b\d{2}-\d{7}\b/g,                                               type: 'TAX_ID'     },
  // Phone — US + ES
  { pattern: /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,         type: 'PHONE'      },
  // ES phones: contiguous (612345678) + real-world groupings — 3-3-3 (612 345 678),
  // 3-2-2-2 (612 34 56 78), 2-3-2-2 landline (91 234 56 78) — with optional +34/0034.
  // Lookarounds keep it from firing mid-number; IBAN/CARD run earlier so span
  // resolution in detectPII stops digit groups inside them from counting as PHONE.
  { pattern: /(?<!\d)(?:(?:\+|00)34[\s.-]?)?(?:[6789]\d{8}|[6789]\d{2}[\s.-]\d{3}[\s.-]\d{3}|[6789]\d{2}(?:[\s.-]\d{2}){3}|[6789]\d[\s.-]\d{3}(?:[\s.-]\d{2}){2})(?!\d)/g, type: 'PHONE' },
  // Date patterns
  { pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,                               type: 'DATE'       },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b/g,                                        type: 'DATE'       },
  // Medical / HR IDs
  { pattern: /\bMRN[-\s]?\d{4,}\b/gi,                                          type: 'MRN'        },
  // NHC (nº historia clínica) — Spanish healthcare record ID, format NHC-YYYY-NNNN.
  // Own pattern rather than widening MRN: MRN is the Anglo equivalent used in US-style
  // records and its own eval line (MRN) must stay unaffected — merging them into one
  // pattern would blur the two entity types in reporting even though the shapes are
  // similar. Kept as a SEPARATE, more specific pattern so a compliance report says
  // "NHC leaked" and not "MRN leaked" when it's actually the Spanish clinical record ID.
  { pattern: /\bNHC[-\s]?\d{4}[-\s]?\d{4,}\b/gi,                               type: 'NHC'        },
  { pattern: /\bEMP[-\s]?\d{4,}\b/gi,                                          type: 'EMP_ID'     },
  // Nº colegiado (bar association membership ID) — uniquely identifies a specific lawyer.
  // Fixed prefix list (ICAM/ICAB/ICAV/ICAS/ICAZ + ICA<city> variants) keeps this narrow;
  // "nº" is optional/case-insensitive since it's sometimes abbreviated or omitted.
  { pattern: /\bICA[A-Z]{1,8}\s?(?:nº|n°|n\.?º?|num\.?)?\s?\d{4,6}\b/gi,      type: 'LAWYER_ID'  },
  // Seguridad Social affiliation number — 2-digit provincia + 10-digit sequence +
  // 2-digit control, always space-separated in this exact 2-10-2 grouping. No
  // real-world hyphenated variant seen in the dataset, so the separator is a plain
  // required space (not the [-\s]? tolerance used elsewhere) to avoid over-matching
  // arbitrary 14-digit runs.
  { pattern: /\b\d{2}\s\d{10}\s\d{2}\b/g,                                     type: 'SSN_ES'     },
  // Referencia catastral — alphanumeric cadastral reference that uniquely identifies a
  // property (personal data under GDPR when tied to an owner). The real-world/official
  // format is 20 chars, but the dataset's actual generator (pools.mjs randomReferenciaCatastral:
  // 7 digits + 2 letters + 5 digits + 4 control chars) produces 18 — {18,20} covers both
  // without loosening enough to swallow arbitrary alphanumeric runs (still \b-anchored and
  // fully uppercase/digit, so it won't fire on mixed-case prose).
  { pattern: /\b[0-9A-Z]{18,20}\b/g,                                          type: 'CATASTRAL'  },
  // 2nd alt capped at 4-5 digits: 6-9 digit codes belong exclusively to PASSPORT.
  // MRN/EMP excluded — they have dedicated patterns above and would double-count.
  // Leading #? and trailing (?:-\d{2,6})? extend the 1st alt to fully swallow expediente
  // refs like #APP-2025-0934: without them the pattern stopped at "APP-2025" (the [-#]?
  // separator only allows ONE hyphen before the alnum run) and left "-0934" as an
  // unconsumed suffix — a partial-overlap leak, not a clean miss (see eval notes).
  { pattern: /#?\b(?:APP|BC|ID|BK|ACC|REF|TXN|ACCT|CASE|CLT)[-#]?[A-Z0-9]{4,}(?:-\d{2,6})?\b|\b(?!(?:MRN|EMP)-)[A-Z]{2,4}-\d{4,5}\b/g, type: 'ID' },
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

/**
 * Scans text with regex patterns. Returns detected PII types and total match count.
 * Overlap-aware: a match overlapping a span already claimed by an earlier (higher-priority)
 * pattern is skipped — mirrors anonymize(), which replaces sequentially so later patterns
 * never see text already consumed (e.g. CARD groups inside an IBAN, PASSPORT over a DNI).
 * Keeps pii_matches consistent with what anonymize actually masks.
 */
export function detectPII(text: string): { detected: boolean; matches: number; types: string[] } {
  const spans: Array<{ start: number; end: number }> = []
  const types: string[] = []
  let totalMatches = 0
  for (const { pattern, type } of PII_PATTERNS) {
    pattern.lastIndex = 0
    let hit = false
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (spans.some(s => start < s.end && end > s.start)) continue
      spans.push({ start, end })
      hit = true
      totalMatches++
    }
    if (hit) types.push(type)
  }
  return { detected: types.length > 0, matches: totalMatches, types }
}

/** Scans for hardcoded secrets (API keys, DB URIs, JWTs). Runs before PII patterns inside anonymize() because secrets are longer and more specific — processing them first avoids partial overlaps. */
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

/**
 * Calls Workers AI (LLaMA) for named entity recognition (PERSON, ORG, ADDRESS).
 * Only invoked for Pro/Enterprise tiers. Falls back gracefully on any error.
 * Returns an `error` flag so callers can distinguish "clean" from "failed".
 */
export async function detectPIINER(
  text: string,
  ai: Ai,
): Promise<{ detected: boolean; entities: NerEntity[]; error?: boolean }> {
  try {
    const result = await (ai.run as Function)('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: 'Reply with valid JSON only. No markdown, no explanation, no extra text.' },
        { role: 'user', content: nerPrompt(text) },
      ],
      max_tokens: 512,
    })
    const resp = (result as { response: unknown }).response
    console.log('[NER raw]', typeof resp === 'string' ? resp.slice(0, 300) : JSON.stringify(resp).slice(0, 300))
    const parsed = (typeof resp === 'string'
      ? JSON.parse(resp.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      : resp) as { entities?: unknown }
    const lower = text.toLowerCase()
    const entities: NerEntity[] = Array.isArray(parsed.entities)
      ? (parsed.entities as NerEntity[]).filter(
          e => e?.type && e?.value && lower.includes(e.value.toLowerCase()),
        )
      : []
    return { detected: entities.length > 0, entities }
  } catch (e) {
    console.error('[NER error]', String(e))
    return { detected: false, entities: [], error: true }
  }
}

/**
 * Negative-cache wrapper for detectPIINER, keyed by SHA-256 of the text in KV (1h TTL).
 * Only clean verdicts are cached — caching positives would persist PII values in KV.
 * Saves the LLM call on repeated/templated clean traffic; any text with entities re-runs.
 *
 * Propagates `error` from detectPIINER so callers can tell "NER ran and found nothing"
 * apart from "NER failed and we have no idea" — collapsing those two into the same
 * `detected: false` is exactly the gap that let raw PII pass through to the cloud
 * when Workers AI failed (see index.ts fail-safe on nerResult.error).
 */
export async function detectPIINERCached(
  text: string,
  ai: Ai,
  kv: KVNamespace,
): Promise<{ detected: boolean; entities: NerEntity[]; error?: boolean }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const kvKey = `ner:clean:${hash}`

  if (await kv.get(kvKey)) return { detected: false, entities: [] }

  const result = await detectPIINER(text, ai)
  // Only cache clean verdicts when NER ran successfully — never cache errors.
  if (!result.detected && !result.error) await kv.put(kvKey, '1', { expirationTtl: 3600 })
  return result
}

// ── Anonymization ──────────────────────────────────────────────────────────

export type AnonMap = Record<string, string>

/**
 * Replaces PII and secret matches with typed tokens (e.g. `<EMAIL_1>`) and returns a
 * reverse map for deanonymize(). Order matters: secrets run first, then regex PII, then
 * NER entities — each pass operates on the already-substituted text to prevent double-replacement.
 */
export function anonymize(
  messages: Array<{ role: string; content: string }>,
  nerEntities: NerEntity[],
): { messages: Array<{ role: string; content: string }>; map: AnonMap } {
  const map: AnonMap = {}
  const counters: Record<string, number> = {}

  const token = (type: string) => {
    counters[type] = (counters[type] ?? 0) + 1
    return `[${type}_${counters[type]}]`
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

/** Restores original values in the LLM response using the token map produced by anonymize(). */
export function deanonymize(text: string, map: AnonMap): string {
  let result = text
  for (const [t, value] of Object.entries(map)) {
    result = result.split(t).join(value)
  }
  return result
}

// ── Utilities ──────────────────────────────────────────────────────────────

/** Flattens all message content into a single string for scanning. Used only for detection — anonymize() operates on the structured messages array directly. */
export function extractMessages(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages)) return ''
  return b.messages
    .map((m: unknown) => (m as Record<string, string>).content ?? '')
    .join(' ')
}

/** Extracts the messages array from the request body for anonymize(). Separate from extractMessages() to preserve structure. */
export function getMessages(body: unknown): Array<{ role: string; content: string }> {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages)) return []
  return b.messages as Array<{ role: string; content: string }>
}

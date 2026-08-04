import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectPII,
  detectSecrets,
  detectPIINERCached,
  anonymize,
  deanonymize,
  extractMessages,
  getMessages,
} from '../src/pii.ts'

const msg = (content: string) => [{ role: 'user', content }]

// ── in-memory doubles for detectPIINERCached ───────────────────────────────────

/** In-memory KVNamespace double — only get/put are used by detectPIINERCached. */
function makeMemoryKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  } as unknown as KVNamespace
}

/** Ai double whose `run` always throws — simulates a Workers AI failure (timeout, rate limit, etc). */
function makeThrowingAi(): Ai {
  return {
    run: async () => {
      throw new Error('simulated Workers AI failure')
    },
  } as unknown as Ai
}

/** Ai double whose `run` returns a clean (no-entities) NER verdict. */
function makeCleanAi(): Ai {
  return {
    run: async () => ({ response: JSON.stringify({ entities: [] }) }),
  } as unknown as Ai
}

// ── detectPII ────────────────────────────────────────────────────────────────

test('detectPII flags common regex PII types', () => {
  assert.equal(detectPII('reach me at john@acme.com').detected, true)
  assert.ok(detectPII('john@acme.com').types.includes('EMAIL'))
  assert.ok(detectPII('my number is 123-45-6789').types.includes('SSN'))
  assert.ok(detectPII('DNI 12345678Z').types.includes('DNI'))
  assert.ok(detectPII('card 4716 1234 5678 9012').types.includes('CARD'))
})

test('detectPII catches Spanish phone formats with spacing', () => {
  assert.ok(detectPII('llámame al +34 612 345 678').types.includes('PHONE'))
  assert.ok(detectPII('tel: 91 234 56 78').types.includes('PHONE'))
  assert.ok(detectPII('móvil 612 34 56 78').types.includes('PHONE'))
  assert.ok(detectPII('612345678').types.includes('PHONE'))
})

test('spaced-phone pattern does not fire inside IBANs or cards', () => {
  const iban = detectPII('IBAN ES91 2100 0418 4502 0005 1332')
  assert.ok(!iban.types.includes('PHONE'), 'PHONE fired inside IBAN')
  assert.deepEqual(iban.types, ['IBAN'])
  const card = detectPII('card 4532-1567-8901-2345')
  assert.ok(!card.types.includes('PHONE'), 'PHONE fired inside card number')
})

test('detectPII returns clean for non-PII text', () => {
  const r = detectPII('Summarize the differences between TCP and UDP.')
  assert.equal(r.detected, false)
  assert.deepEqual(r.types, [])
})

test('detectPII does NOT catch bare person names (NER / Pro-tier only, by design)', () => {
  // The regex tier cannot detect names — names are handled by NER, which is
  // gated behind paid tiers. This documents that gate so a future change that
  // "fixes" it (or breaks NER) is a conscious decision, not a silent regression.
  assert.equal(detectPII('Contact Maria Ortega tomorrow').detected, false)
})

// ── new Spanish sectorial ID patterns (recall gap fixes, see eval/dataset) ────

test('detectPII catches DNI/NIE with dotted-thousands and double-space separators', () => {
  // Dotted-thousands: how Spanish paper forms print the 8-digit body.
  assert.ok(detectPII('DNI 12.345.678-Z').types.includes('DNI'))
  // Double space: common PDF copy-paste artifact.
  assert.ok(detectPII('NIE Y1560293  X').types.includes('DNI'))
  // Baseline formats must still work — this is a widen, not a rewrite.
  assert.ok(detectPII('DNI 12345678Z').types.includes('DNI'))
  assert.ok(detectPII('DNI 12345678-Z').types.includes('DNI'))
})

test('detectPII catches NHC (nº historia clínica) as its own type, not MRN', () => {
  const r = detectPII('Historia clínica NHC-2025-3391 localizada en el archivo')
  assert.ok(r.types.includes('NHC'))
  assert.ok(!r.types.includes('MRN'), 'NHC should not double-fire as MRN')
})

test('detectPII catches nº colegiado (bar association ID)', () => {
  assert.ok(detectPII('El letrado, colegiado ICAM nº 54730, actuante').types.includes('LAWYER_ID'))
  assert.ok(detectPII('colegiado ICAS nº 90383').types.includes('LAWYER_ID'))
})

test('detectPII catches Seguridad Social affiliation number', () => {
  assert.ok(detectPII('Nº afiliación: 28 1234567890 15').types.includes('SSN_ES'))
})

test('detectPII catches NIG (judicial procedure ID) before PASSPORT swallows the prefix', () => {
  const r = detectPII('Procedimiento con NIG 190746 C 256289/2023 ante el juzgado')
  assert.ok(r.types.includes('NIG'))
  assert.ok(!r.types.includes('PASSPORT'), 'PASSPORT should not steal the NIG prefix')
})

test('detectPII catches nº expediente including the trailing -NNNN group', () => {
  const { messages, map } = anonymize(msg('Ref: #APP-2025-0934 asignada al caso'), [])
  // The full expediente must be consumed as ONE token, not leave "-0934" in the clear.
  assert.ok(!messages[0].content.includes('0934'), 'expediente suffix leaked in the clear')
  assert.ok(Object.values(map).includes('#APP-2025-0934'))
})

test('detectPII catches referencia catastral (18-20 char alphanumeric)', () => {
  assert.ok(detectPII('referencia catastral 9872023VK6897S0001WX del inmueble').types.includes('CATASTRAL'))
  assert.ok(detectPII('finca con ref. 8314066UO24180337O registrada').types.includes('CATASTRAL'))
})

test('detectPII catches CIF with its own type, not mislabeled as PASSPORT', () => {
  const r = detectPII('La sociedad, con CIF B12345678, fue emplazada')
  assert.ok(r.types.includes('CIF'))
  assert.ok(!r.types.includes('PASSPORT'), 'CIF must not be reported as PASSPORT in a compliance trail')
})

test('detectPII catches IBAN with hyphen separators and CARD with dot separators', () => {
  assert.ok(detectPII('cuenta ES84-6791-9102-6868-1954-8269 domiciliada').types.includes('IBAN'))
  assert.ok(detectPII('tarjeta 8893.4772.3375.4503 de la mutua').types.includes('CARD'))
})

test('new sectorial ID patterns do not regress the DNI/PHONE/IBAN/CARD baseline', () => {
  // Baseline formats from the independent eval dataset (packages/worker/eval/dataset) —
  // DNI 98.1%, PHONE 95.9%, IBAN 100%, CARD_HEALTH 100% recall must not move.
  assert.ok(detectPII('DNI 12345678Z').types.includes('DNI'))
  assert.ok(detectPII('612345678').types.includes('PHONE'))
  assert.ok(detectPII('IBAN ES91 2100 0418 4502 0005 1332').types.includes('IBAN'))
  assert.ok(detectPII('card 4716 1234 5678 9012').types.includes('CARD'))
})

// ── detectSecrets ────────────────────────────────────────────────────────────

test('detectSecrets flags credentials', () => {
  assert.ok(detectSecrets('AKIAIOSFODNN7EXAMPLE').types.includes('SECRET_CLOUD_KEY'))
  assert.ok(detectSecrets('db at postgres://user:pass@host:5432/app').types.includes('SECRET_DB_URI'))
  assert.ok(detectSecrets('token sk-abcdefghijklmnopqrstuvwxyz').types.includes('SECRET_API_KEY'))
})

// ── anonymize: NO LEAK (the core product promise) ─────────────────────────────

test('anonymize removes the original PII from the outgoing text', () => {
  const original = 'Email maria@clinic.es, SSN 123-45-6789, card 4716 1234 5678 9012'
  const { messages } = anonymize(msg(original), [])
  const out = messages[0].content
  assert.ok(!out.includes('maria@clinic.es'), 'email leaked to output')
  assert.ok(!out.includes('123-45-6789'), 'SSN leaked to output')
  assert.ok(!out.includes('4716 1234 5678 9012'), 'card leaked to output')
})

test('anonymize redacts secrets (sk- keys and DB URIs)', () => {
  const original = 'OPENAI sk-abcdefghijklmnopqrstuvwxyz and db postgres://u:p@h:5432/db'
  const { messages } = anonymize(msg(original), [])
  const out = messages[0].content
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwxyz'), 'api key leaked')
  assert.ok(!out.includes('postgres://u:p@h:5432/db'), 'db uri leaked')
})

test('anonymize produces <TYPE_N> tokens and a populated reversal map', () => {
  const { messages, map } = anonymize(msg('write to a@b.com'), [])
  assert.match(messages[0].content, /<EMAIL_1>/)
  assert.equal(map['<EMAIL_1>'], 'a@b.com')
})

// ── round-trip integrity (anonymize → deanonymize === original) ───────────────

test('deanonymize restores the original text exactly', () => {
  const original = 'Email maria@clinic.es and SSN 123-45-6789'
  const { messages, map } = anonymize(msg(original), [])
  assert.equal(deanonymize(messages[0].content, map), original)
})

test('round-trip with multiple occurrences of the same type', () => {
  const original = 'a@x.com talked to b@y.com and c@z.com'
  const { messages, map } = anonymize(msg(original), [])
  assert.ok(messages[0].content.includes('<EMAIL_1>'))
  assert.ok(messages[0].content.includes('<EMAIL_3>'))
  assert.equal(deanonymize(messages[0].content, map), original)
})

test('round-trip survives 10+ tokens of one type (no <X_1> vs <X_11> collision)', () => {
  // The `>` token delimiter must prevent <EMAIL_1> from matching inside <EMAIL_11>.
  const emails = Array.from({ length: 12 }, (_, i) => `user${i}@x.com`)
  const original = emails.join(' ')
  const { messages, map } = anonymize(msg(original), [])
  assert.equal(deanonymize(messages[0].content, map), original)
})

test('deanonymize is substring-safe across overlapping token numbers', () => {
  const map = { '<PERSON_1>': 'Alice', '<PERSON_11>': 'Bob' }
  assert.equal(deanonymize('<PERSON_11> and <PERSON_1>', map), 'Bob and Alice')
})

test('anonymize keeps detection-only keywords (MEDICAL_KW) in the clear', () => {
  // "patient"/"ECG" flag medical context for detection but are not identifying
  // data — masking them would destroy the prompt's meaning for the cloud LLM.
  const { messages } = anonymize(msg('Patient admitted with chest pain, ordered an ECG'), [])
  const out = messages[0].content
  assert.ok(out.includes('Patient'), 'MEDICAL_KW was masked')
  assert.ok(out.includes('ECG'), 'MEDICAL_KW was masked')
  assert.ok(detectPII('Patient ordered an ECG').types.includes('MEDICAL_KW'), 'detection lost')
})

// ── NER entities ──────────────────────────────────────────────────────────────

test('anonymize replaces ALL occurrences of a NER entity and round-trips', () => {
  const original = 'Dr. Garcia met Garcia again'
  const ner = [{ type: 'PERSON', value: 'Garcia' }]
  const { messages, map } = anonymize(msg(original), ner)
  assert.ok(!messages[0].content.includes('Garcia'), 'NER entity leaked')
  assert.equal(deanonymize(messages[0].content, map), original)
})

// ── input extraction robustness (untrusted request bodies) ────────────────────

test('extractMessages / getMessages tolerate malformed input', () => {
  assert.equal(extractMessages(null), '')
  assert.equal(extractMessages({}), '')
  assert.equal(extractMessages({ messages: 'nope' }), '')
  assert.deepEqual(getMessages(undefined), [])
  assert.equal(
    extractMessages({ messages: [{ content: 'hi' }, { content: 'there' }] }),
    'hi there',
  )
})

// ── detectPIINERCached: error propagation (P0 fail-safe regression coverage) ──
// A Workers AI failure must never be silently reinterpreted as "no PII found" —
// that gap let raw prompts pass through to the cloud provider. See index.ts,
// which checks nerResult.error before the pass-through/anonymize branch.

test('detectPIINERCached propagates error: true when the underlying ai.run throws', async () => {
  const kv = makeMemoryKV()
  const result = await detectPIINERCached('Contact Maria Ortega tomorrow', makeThrowingAi(), kv)
  assert.equal(result.error, true)
  assert.equal(result.detected, false)
  assert.deepEqual(result.entities, [])
})

test('a NER error is never cached — retries always re-run detection', async () => {
  const kv = makeMemoryKV()
  const text = 'Contact Maria Ortega tomorrow'
  await detectPIINERCached(text, makeThrowingAi(), kv)

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const cached = await kv.get(`ner:clean:${hash}`)
  assert.equal(cached, null, 'an errored verdict must not be written to the negative cache')
})

test('a real clean verdict (no error) is cached', async () => {
  const kv = makeMemoryKV()
  const text = 'Summarize the differences between TCP and UDP.'
  const result = await detectPIINERCached(text, makeCleanAi(), kv)
  assert.equal(result.error, undefined)
  assert.equal(result.detected, false)

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const cached = await kv.get(`ner:clean:${hash}`)
  assert.equal(cached, '1', 'a genuinely clean verdict must be cached')
})

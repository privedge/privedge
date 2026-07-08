import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectPII,
  detectSecrets,
  anonymize,
  deanonymize,
  extractMessages,
  getMessages,
} from '../src/pii.ts'

const msg = (content: string) => [{ role: 'user', content }]

// ── detectPII ────────────────────────────────────────────────────────────────

test('detectPII flags common regex PII types', () => {
  assert.equal(detectPII('reach me at john@acme.com').detected, true)
  assert.ok(detectPII('john@acme.com').types.includes('EMAIL'))
  assert.ok(detectPII('my number is 123-45-6789').types.includes('SSN'))
  assert.ok(detectPII('DNI 12345678Z').types.includes('DNI'))
  assert.ok(detectPII('card 4716 1234 5678 9012').types.includes('CARD'))
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

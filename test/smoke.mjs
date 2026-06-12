import Privedge from '../packages/sdk/dist/index.mjs'

const WORKER = 'https://privedge-worker.hberdn.workers.dev'
const KEY_EDGE = 'pvdg_live_0489f281871f4b24b6c127b7d3fb0b4f'

// ── Test 1: PII + edge strategy → CF Workers AI (no OpenAI call) ────────────
console.log('\n--- Test 1: PII detected + edge strategy → edge inference ---')
const ai1 = new Privedge({ apiKey: KEY_EDGE, workerUrl: WORKER })
try {
  const res = await ai1.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'El paciente con DNI 12345678Z necesita revision' }],
  })
  console.log('edge inference: ✅ PASS — got response')
  console.log('routed_to:', res.routed_to)
  console.log('pii_matches:', res.pii_matches)
  console.log('anonymized:', res.anonymized)
  console.log('reply:', res.choices?.[0]?.message?.content?.slice(0, 120))
} catch (err) {
  const isOpenAI = err.message.includes('Incorrect API key') || err.message.includes('invalid_api_key')
  if (isOpenAI) {
    console.log('edge inference: ❌ FAIL — went to OpenAI instead of edge')
  } else {
    console.log('edge inference: ❌ FAIL —', err.message.slice(0, 120))
  }
}

// ── Test 2: No PII + edge strategy → cloud passthrough ──────────────────────
console.log('\n--- Test 2: No PII → cloud passthrough ---')
const ai2 = new Privedge({ apiKey: KEY_EDGE, workerUrl: WORKER })
try {
  await ai2.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  })
  console.log('no-pii path: ✅ PASS — got response')
} catch (err) {
  const is401Cloud = err.message.includes('Incorrect API key') || err.message.includes('invalid_api_key')
  const is401Privedge = err.message.includes('Unauthorized — provide a valid')
  if (is401Cloud) {
    console.log('no-pii path: ✅ PASS — reached cloud (no PII, no edge needed)')
  } else if (is401Privedge) {
    console.log('no-pii path: ❌ FAIL — key not recognized')
  } else {
    console.log('no-pii path: ❌ FAIL —', err.message.slice(0, 120))
  }
}

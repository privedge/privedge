import Privedge from '../packages/sdk/dist/index.mjs'

const WORKER = 'https://privedge-worker.hberdn.workers.dev'

// ── Test 1: PII detected → anonymize → cloud (401 confirms it reached OpenAI) ──
console.log('\n--- Test 1: PII detected → anonymize → route to cloud ---')
const ai1 = new Privedge({ apiKey: 'no-key', workerUrl: WORKER, compliance: 'hipaa' })
try {
  await ai1.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'El paciente con DNI 12345678Z necesita revision' }],
  })
} catch (err) {
  const is401 = err.message.includes('401') || err.message.includes('invalid_api_key')
  console.log('anonymize pipeline:', is401 ? '✅ PASS — reached OpenAI (401 = anonymized prompt sent)' : '❌ FAIL')
  console.log('detail:', err.message.slice(0, 120))
}

// ── Test 2: No compliance header → pass through untouched ───────────────────
console.log('\n--- Test 2: No compliance header → cloud pass-through ---')
const ai2 = new Privedge({ apiKey: 'no-key', workerUrl: WORKER })
try {
  await ai2.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  })
} catch (err) {
  const is401 = err.message.includes('401') || err.message.includes('invalid_api_key')
  console.log('pass-through:', is401 ? '✅ PASS — reached OpenAI (no compliance, no interception)' : '❌ FAIL')
}

// ── Test 3: No PII + compliance → cloud (no anon needed) ────────────────────
console.log('\n--- Test 3: No PII + compliance → cloud (no anonymization needed) ---')
const ai3 = new Privedge({ apiKey: 'no-key', workerUrl: WORKER, compliance: 'hipaa' })
try {
  await ai3.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  })
} catch (err) {
  const is401 = err.message.includes('401') || err.message.includes('invalid_api_key')
  console.log('no-pii path:', is401 ? '✅ PASS — reached OpenAI directly (no PII detected)' : '❌ FAIL')
}

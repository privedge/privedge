/**
 * NER-layer eval runner over the independent Spanish PII dataset
 * (packages/worker/eval/dataset/{generate,adversarial}.mjs).
 *
 * Scope: ONLY the NER layer (PERSON / ORG / ADDRESS), via the production
 * `nerPrompt` served by ../ner-eval-worker.ts (a `wrangler dev` instance with a
 * real Workers AI binding, expected to already be running on localhost:8788 —
 * this runner does NOT start or stop it). Companion to run-dataset-eval.mjs,
 * which measures the regex layer over the same 306-case dataset. Together they
 * produce the combined regex+NER recall number, computed at the bottom of this
 * file, which is the number meant for publication.
 *
 * Ground truth: entities in the dataset flagged `nerScope: true` are the ones
 * production can ONLY catch via the NER layer (pii.ts has no regex pattern for
 * PERSON/ORG/ADDRESS at all — see generate.mjs's header comment). Every other
 * entity (`nerScope` absent/false) belongs to the regex layer and is NOT scored
 * here — it's run-dataset-eval.mjs's job. Cases with zero nerScope entities are
 * still sent to the worker: they are the false-positive probe, since any
 * PERSON/ORG/ADDRESS the model returns for them is by definition unwarranted.
 *
 * Matching criterion (mirrors run-eval.mjs exactly, per the task brief):
 * `norm(e.value).includes(norm(exp)) || norm(exp).includes(norm(e.value))`,
 * where norm = lowercase + NFC. An expected entity counts as found if some
 * *verbatim* returned entity contains it or is contained by it.
 *
 * Why filter by verbatim BEFORE measuring recall: production (pii.ts's
 * detectPIINER) discards any NER-returned entity whose value doesn't literally
 * appear in the source text (`lower.includes(e.value.toLowerCase())`) — the
 * model is free to paraphrase, translate a title, normalize accents, or
 * otherwise alter a name/org/address it extracts, and when it does, production
 * treats that entity as if it were never found (it cannot anonymize a span it
 * cannot locate in the text). So a paraphrased match is not a "close enough"
 * partial credit — in the real pipeline it is a full miss, identical in effect
 * to the model never having extracted the entity at all. Scoring recall only
 * over the verbatim survivors is therefore what actually ships, not an
 * optimistic upper bound on what the model theoretically noticed.
 *
 * Usage: node run-ner-eval.mjs [port]        (port defaults to 8788)
 *        node run-ner-eval.mjs 8788 --limit=5  (smoke test a handful of cases)
 * Writes ner-eval-results-<date>.json + prints a console summary.
 */
import { writeFileSync } from 'node:fs'
import { generateAll } from './generate.mjs'
import { cases as adversarialCases } from './adversarial.mjs'

const args = process.argv.slice(2)
const PORT = args.find(a => !a.startsWith('--')) ?? '8788'
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' // production model
const CONCURRENCY = 4
const PROGRESS_EVERY = 20

const norm = s => s.toLowerCase().normalize('NFC')

// ── Load dataset ─────────────────────────────────────────────────────────────

const syntheticCases = generateAll()
const allCasesFull = [...syntheticCases, ...adversarialCases]
const allCases = LIMIT ? allCasesFull.slice(0, LIMIT) : allCasesFull

// Regex-layer entity count, for the combined regex+NER headline number. Read
// from run-dataset-eval.mjs's own definition (regexScope = !nerScope) rather
// than hardcoding a number, so this stays correct if the dataset changes.
const totalRegexScopeEntities = allCasesFull.reduce(
  (sum, c) => sum + c.entities.filter(e => !e.nerScope).length, 0,
)

// ── Per-case NER call ────────────────────────────────────────────────────────

async function evalCase(c) {
  const start = Date.now()
  let res, data
  try {
    res = await fetch(`http://localhost:${PORT}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, text: c.text }),
    })
    data = await res.json()
  } catch (err) {
    return { case: c, error: String(err), latencyMs: Date.now() - start }
  }
  if (data.error) {
    return { case: c, error: data.error, latencyMs: data.latencyMs ?? (Date.now() - start) }
  }

  const nerExpected = c.entities.filter(e => e.nerScope)
  const returned = Array.isArray(data.entities) ? data.entities : []
  const textNorm = norm(c.text)

  // Verbatim survivors: what production would actually keep (pii.ts's filter,
  // reproduced here with the run-eval.mjs norm() — lowercase+NFC vs prod's
  // plain lowercase; NFC is a superset-safe approximation since this dataset
  // is authored as already-NFC-normalized Spanish text).
  const verbatim = returned.filter(e => e?.value && textNorm.includes(norm(e.value)))
  const paraphrased = returned.filter(e => !(e?.value && textNorm.includes(norm(e.value))))

  // Recall: an expected entity is found if some verbatim returned entity of
  // the SAME type contains it or is contained by it. Type-scoping avoids
  // crediting e.g. an ORG string that happens to textually contain a PERSON
  // name (unusual but happens with law-firm names built from partner surnames).
  const foundExpected = []
  const missedExpected = []
  for (const exp of nerExpected) {
    const hit = verbatim.some(e =>
      e.type === exp.type &&
      (norm(e.value).includes(norm(exp.value)) || norm(exp.value).includes(norm(e.value))),
    )
    ;(hit ? foundExpected : missedExpected).push(exp)
  }

  // False positives: verbatim returned entities not matched (contain/contained,
  // same type) by ANY expected entity in this case. Cases with zero nerScope
  // entities make every verbatim return here a false positive by construction.
  const falsePositives = verbatim.filter(e =>
    !nerExpected.some(exp =>
      exp.type === e.type &&
      (norm(e.value).includes(norm(exp.value)) || norm(exp.value).includes(norm(e.value))),
    ),
  )

  return {
    case: c,
    latencyMs: data.latencyMs,
    nerExpectedCount: nerExpected.length,
    returnedCount: returned.length,
    verbatimCount: verbatim.length,
    paraphrasedCount: paraphrased.length,
    foundExpected,
    missedExpected,
    falsePositives,
    paraphrased,
  }
}

// ── Bounded-concurrency runner ───────────────────────────────────────────────

async function runAll(cases) {
  const results = new Array(cases.length)
  let next = 0
  let done = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= cases.length) return
      results[i] = await evalCase(cases[i])
      done++
      if (done % PROGRESS_EVERY === 0 || done === cases.length) {
        console.log(`  progress: ${done}/${cases.length}`)
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker)
  await Promise.all(workers)
  return results
}

console.log(`═══ NER-layer PII eval — independent Spanish dataset ═══\n`)
console.log(`Model: ${MODEL}`)
console.log(`Cases: ${allCases.length}${LIMIT ? ` (LIMITED from ${allCasesFull.length} for smoke test)` : ''}  Concurrency: ${CONCURRENCY}\n`)

const t0 = Date.now()
const results = await runAll(allCases)
const wallMs = Date.now() - t0
console.log(`\nDone in ${(wallMs / 1000).toFixed(1)}s\n`)

// ── Aggregate ────────────────────────────────────────────────────────────────

const errors = results.filter(r => r.error)
const ok = results.filter(r => !r.error)

const byType = {} // type -> { expected, found }
const falseNegatives = []
const falsePositivesAll = []
const paraphrasedAll = []
let totalNerExpected = 0
let totalFound = 0
let totalReturned = 0
let totalVerbatim = 0
let totalParaphrased = 0
const latencies = []

for (const r of ok) {
  totalNerExpected += r.nerExpectedCount
  totalReturned += r.returnedCount
  totalVerbatim += r.verbatimCount
  totalParaphrased += r.paraphrasedCount
  totalFound += r.foundExpected.length
  if (typeof r.latencyMs === 'number') latencies.push(r.latencyMs)

  for (const exp of r.foundExpected) {
    byType[exp.type] ??= { expected: 0, found: 0 }
    byType[exp.type].expected++
    byType[exp.type].found++
  }
  for (const exp of r.missedExpected) {
    byType[exp.type] ??= { expected: 0, found: 0 }
    byType[exp.type].expected++
    falseNegatives.push({
      caseId: r.case.id, domain: r.case.domain, kind: r.case.kind, source: r.case.source,
      type: exp.type, value: exp.value,
    })
  }
  for (const fp of r.falsePositives) {
    falsePositivesAll.push({
      caseId: r.case.id, domain: r.case.domain, kind: r.case.kind, source: r.case.source,
      type: fp.type, value: fp.value,
      caseHadNerEntities: r.nerExpectedCount > 0,
    })
  }
  for (const p of r.paraphrased) {
    paraphrasedAll.push({
      caseId: r.case.id, type: p.type, value: p.value,
    })
  }
}

// Errors count as fully lost recall for every nerScope entity in that case
// (the model produced nothing usable) — per the brief: "cuentan como recall
// perdido, no como categoría aparte".
for (const r of errors) {
  const nerExpected = r.case.entities.filter(e => e.nerScope)
  totalNerExpected += nerExpected.length
  for (const exp of nerExpected) {
    byType[exp.type] ??= { expected: 0, found: 0 }
    byType[exp.type].expected++
    falseNegatives.push({
      caseId: r.case.id, domain: r.case.domain, kind: r.case.kind, source: r.case.source,
      type: exp.type, value: exp.value, causedByError: r.error,
    })
  }
}

latencies.sort((a, b) => a - b)
const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null
const avgLat = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
const p50 = pct(latencies, 0.5)
const p95 = pct(latencies, 0.95)

const nerRecallPct = totalNerExpected ? +(100 * totalFound / totalNerExpected).toFixed(1) : 0

// ── Combined regex + NER headline number ────────────────────────────────────
// Uses the LIVE regex-layer result if run-dataset-eval.mjs was run and left its
// JSON output alongside; if this is a smoke-test run (--limit) or the file is
// absent, we still report the NER-only slice and skip the combined number
// (combining a partial NER sweep with the full regex total would misrepresent
// the product's real combined recall).
let combined = null
if (!LIMIT) {
  const REGEX_FOUND = 416 // from run-dataset-eval.mjs's published 90.6% result (416/459)
  const REGEX_EXPECTED = 459
  const combinedFound = REGEX_FOUND + totalFound
  const combinedExpected = REGEX_EXPECTED + totalNerExpected
  combined = {
    regexFound: REGEX_FOUND, regexExpected: REGEX_EXPECTED,
    nerFound: totalFound, nerExpected: totalNerExpected,
    combinedFound, combinedExpected,
    combinedPct: +(100 * combinedFound / combinedExpected).toFixed(1),
  }
}

// ── Console report ───────────────────────────────────────────────────────────

console.log('── Recall by entity type (NER layer only) ──')
for (const [type, v] of Object.entries(byType).sort((a, b) => b[1].expected - a[1].expected)) {
  const p = v.expected ? (100 * v.found / v.expected).toFixed(1) : '0.0'
  console.log(`  ${type.padEnd(10)} ${String(v.found).padStart(3)}/${String(v.expected).padEnd(3)}  ${p.padStart(5)}%`)
}

console.log(`\n── NER recall overall: ${totalFound}/${totalNerExpected} (${nerRecallPct}%) ──`)

console.log(`\n── False positives: ${falsePositivesAll.length} ──`)
const fpFromEmptyCases = falsePositivesAll.filter(f => !f.caseHadNerEntities).length
console.log(`  (of which ${fpFromEmptyCases} from the ${allCasesFull.length - allCasesFull.filter(c => c.entities.some(e => e.nerScope)).length} cases with NO ner-scope entities — pure over-extraction)`)
for (const fp of falsePositivesAll.slice(0, 30)) {
  console.log(`  [${fp.type}] "${fp.value}"  (${fp.caseId}, ${fp.domain}${fp.caseHadNerEntities ? '' : ', NO-NER-CASE'})`)
}
if (falsePositivesAll.length > 30) console.log(`  ... and ${falsePositivesAll.length - 30} more (see JSON output)`)

console.log(`\n── Paraphrase rate: ${totalParaphrased}/${totalReturned} returned entities were NOT verbatim (production would discard these) ──`)
for (const p of paraphrasedAll.slice(0, 20)) {
  console.log(`  [${p.type}] "${p.value}"  (${p.caseId})`)
}
if (paraphrasedAll.length > 20) console.log(`  ... and ${paraphrasedAll.length - 20} more (see JSON output)`)

console.log(`\n── Latency: avg ${avgLat}ms  p50 ${p50}ms  p95 ${p95}ms  (n=${latencies.length}) ──`)

console.log(`\n── Errors: ${errors.length}/${allCases.length} ──`)
for (const e of errors.slice(0, 10)) {
  console.log(`  ${e.case.id}: ${String(e.error).slice(0, 100)}`)
}

console.log(`\n── False negatives: ${falseNegatives.length} ──`)
for (const fn of falseNegatives.slice(0, 40)) {
  console.log(`  [${fn.type}] "${fn.value}"  (${fn.caseId}, ${fn.domain})${fn.causedByError ? '  [worker error]' : ''}`)
}
if (falseNegatives.length > 40) console.log(`  ... and ${falseNegatives.length - 40} more (see JSON output)`)

if (combined) {
  console.log(`\n═══ COMBINED regex + NER recall (product headline number) ═══`)
  console.log(`  regex:    ${combined.regexFound}/${combined.regexExpected}  (${(100 * combined.regexFound / combined.regexExpected).toFixed(1)}%)`)
  console.log(`  NER:      ${combined.nerFound}/${combined.nerExpected}  (${nerRecallPct}%)`)
  console.log(`  COMBINED: ${combined.combinedFound}/${combined.combinedExpected}  (${combined.combinedPct}%)`)
} else {
  console.log(`\n(Skipping combined regex+NER number: this was a --limit smoke test, not a full sweep.)`)
}

// ── Write JSON ────────────────────────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'NER-only (PERSON/ORG/ADDRESS via ner-eval-worker.ts, production nerPrompt) — regex layer measured separately by run-dataset-eval.mjs',
  model: MODEL,
  port: PORT,
  limited: LIMIT,
  totals: {
    cases: allCases.length,
    errors: errors.length,
    nerExpected: totalNerExpected,
    nerFound: totalFound,
    nerRecallPct,
    returned: totalReturned,
    verbatim: totalVerbatim,
    paraphrased: totalParaphrased,
    falsePositives: falsePositivesAll.length,
  },
  latency: { avgMs: avgLat, p50Ms: p50, p95Ms: p95, n: latencies.length },
  recallByType: byType,
  falseNegatives,
  falsePositives: falsePositivesAll,
  paraphrasedEntities: paraphrasedAll,
  errorsDetail: errors.map(e => ({ caseId: e.case.id, error: e.error })),
  combined,
}

const outFile = `ner-eval-results-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(new URL(outFile, import.meta.url), JSON.stringify(report, null, 2))
console.log(`\n→ wrote ${outFile}`)

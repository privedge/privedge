/**
 * Regex-layer eval runner over the independent Spanish PII dataset
 * (packages/worker/eval/dataset/{generate,adversarial}.mjs).
 *
 * Scope: ONLY the regex layer (`detectPII` / `anonymize` from ../../src/pii.ts).
 * Does NOT call Workers AI / the NER layer — that requires `wrangler dev` with a
 * real AI binding and costs money per call (see ../README.md). The NER layer is
 * evaluated separately with the existing run-eval.mjs harness.
 *
 * Matching approach (documented per the task brief's "Nota sobre spans"):
 * `detectPII` returns types + counts, not offsets, so we cannot directly compare
 * spans returned by the detector against ground-truth spans. Instead we run
 * `anonymize()` on the case text (with an empty NER entity list, since we are
 * scoping this runner to regex only) and inspect the OUTPUT text:
 *   - If a ground-truth PII value no longer appears verbatim in the anonymized
 *     text (i.e. it got replaced by a `[TYPE_N]` token), we count it as DETECTED.
 *   - If it still appears literally, it's a FALSE NEGATIVE — the regex missed it.
 * This is a conservative but honest proxy: it can't tell us the detector matched
 * the *correct* span if a value is a substring of another matched span, but for
 * this dataset's values (multi-char IDs, phone numbers, names) that collision
 * risk is low and we additionally sanity-check region overlap where practical.
 *
 * Ground-truth entities carry two optional flags that change how they're scored:
 *   - `nerScope: true`   — PERSON/ORG names only detectable by the NER layer.
 *                          Excluded from this regex-only run's recall denominator;
 *                          reported separately as "out of regex scope".
 *   - `expectedMatch: false` — the case's author already determined (by reading
 *                          the pii.ts source) that this value CANNOT match any
 *                          current pattern (e.g. dotted NIF, CIF, cadastral ref).
 *                          Still scored normally as a miss if not detected — the
 *                          flag is informational (used to cross-check our own
 *                          reasoning against the actual runtime result) and
 *                          surfaced in the report as "predicted gap, confirmed"
 *                          vs "predicted gap, but actually matched" (which would
 *                          mean our documentation in adversarial.mjs was wrong).
 *
 * False positives: measured by running detectPII() type counts against what the
 * ground truth expects. Any case with entities: [] (or where regex-scoped
 * entities are all `expectedMatch:false`) that still triggers `detected: true`
 * is inspected: we diff detectPII's per-type counts against the count of
 * ground-truth regex-scope entities of that type. A surplus is a false positive
 * and we capture the surrounding text for the report.
 *
 * Usage: node --experimental-strip-types run-dataset-eval.mjs
 * Writes dataset-eval-results-<date>.json + prints a console summary.
 */
import { writeFileSync } from 'node:fs'
import { detectPII, anonymize } from '../../src/pii.ts'
import { generateAll } from './generate.mjs'
import { cases as adversarialCases } from './adversarial.mjs'

// ── Load dataset ─────────────────────────────────────────────────────────────

const syntheticCases = generateAll()
const allCases = [...syntheticCases, ...adversarialCases]

// ── Per-case scoring ─────────────────────────────────────────────────────────

/**
 * Scores one case against the regex layer. Returns per-entity verdicts plus
 * the false-positive surplus for this case (detectPII types/counts not
 * accounted for by any in-scope ground-truth entity of that type).
 */
function scoreCase(c) {
  const regexScopeEntities = c.entities.filter(e => !e.nerScope)
  const nerScopeCount = c.entities.length - regexScopeEntities.length

  const { messages, map } = anonymize([{ role: 'user', content: c.text }], [])
  const anonymizedText = messages[0].content

  // A naive "value no longer appears literally" check is NOT sufficient: a
  // shorter pattern (e.g. PASSPORT) can consume a SUBSTRING of a longer
  // ground-truth value (e.g. NIE "X 1000392 F" -> PASSPORT eats "X 1000392",
  // leaving " F" behind) which makes `.includes(e.value)` correctly return
  // false (the full string is gone) while the entity was NOT actually
  // recognized as that type — it was a different, unrelated pattern partially
  // overlapping it. We caught this empirically: several `expectedMatch:false`
  // cases in adversarial.mjs showed as "detected" only because of this partial
  // overlap. Fix: an entity counts as detected ONLY if some single token in
  // `map` replaced a value that exactly equals (or fully contains, for
  // multi-word spans the regex may trim leading/trailing labels from) the
  // ground-truth value — i.e. the map's replaced substring must NOT be a
  // strict, smaller substring of e.value at a boundary that leaves original
  // characters from e.value still dangling in the text.
  const mapValues = Object.values(map)
  const results = regexScopeEntities.map(e => {
    // Exact detection: some replaced value equals the ground-truth value exactly.
    const exact = mapValues.includes(e.value)
    // Partial-overlap detection: a replaced value is a strict substring of
    // e.value (regex caught PART of the span) — NOT counted as a full detect,
    // but tracked separately since it still means production would leak the
    // undetected remainder in `anonymize()`'s output.
    const partial = !exact && mapValues.some(v => e.value.includes(v) && v.length < e.value.length)
    const detected = exact
    return { ...e, detected, partial }
  })

  const det = detectPII(c.text)

  return { case: c, results, nerScopeCount, detectPIIResult: det, anonymizedText }
}

const scored = allCases.map(scoreCase)

// ── Aggregate: recall by entity type ────────────────────────────────────────

const byType = {} // type -> { expected, found }
const falseNegatives = []
let totalExpected = 0
let totalFound = 0
let totalNerScope = 0

for (const s of scored) {
  totalNerScope += s.nerScopeCount
  for (const r of s.results) {
    totalExpected++
    byType[r.type] ??= { expected: 0, found: 0 }
    byType[r.type].expected++
    if (r.detected) {
      totalFound++
      byType[r.type].found++
    } else {
      falseNegatives.push({
        caseId: s.case.id, domain: s.case.domain, category: s.case.category ?? null,
        source: s.case.source, type: r.type, value: r.value,
        expectedMatch: r.expectedMatch, partiallyMatched: r.partial, notes: s.case.notes ?? null,
      })
    }
  }
}

// ── Aggregate: recall by domain / source ────────────────────────────────────

function breakdown(filterFn) {
  let exp = 0, found = 0
  for (const s of scored) {
    if (!filterFn(s.case)) continue
    for (const r of s.results) { exp++; if (r.detected) found++ }
  }
  return { expected: exp, found, pct: exp ? +(100 * found / exp).toFixed(1) : null }
}

const bySource = {
  synthetic: breakdown(c => c.source === 'synthetic'),
  adversarial: breakdown(c => c.source === 'adversarial'),
}
const byDomain = {
  legal: breakdown(c => c.domain === 'legal'),
  sanidad: breakdown(c => c.domain === 'sanidad'),
}
const byDomainSource = {}
for (const domain of ['legal', 'sanidad']) {
  for (const source of ['synthetic', 'adversarial']) {
    byDomainSource[`${domain}/${source}`] = breakdown(c => c.domain === domain && c.source === source)
  }
}

// ── Precision: false positives ──────────────────────────────────────────────
// For each case, compare detectPII()'s per-type match COUNT against the count
// of in-scope (non-nerScope) ground-truth entities of that type that were
// actually placed in the text. A surplus beyond ground truth is a candidate
// false positive; we then re-verify by checking which literal substrings
// detectPII's patterns matched that are NOT in the ground-truth entity list.

const falsePositives = []
const byTypeFP = {} // type -> count

for (const s of scored) {
  const c = s.case
  const expectedByType = {}
  for (const r of s.results) expectedByType[r.type] = (expectedByType[r.type] ?? 0) + 1

  // Re-scan the text with the same patterns detectPII uses internally, but we
  // don't have direct access to per-match values from detectPII (it only
  // returns types+counts), so we derive matched values via anonymize()'s map:
  // every key in `map` that maps to a value NOT present in ground truth (by
  // exact value+type) is a false positive.
  const { map } = anonymize([{ role: 'user', content: c.text }], [])
  const groundTruthValues = new Set(s.results.map(r => `${r.type}::${r.value}`))
  // Also allow expectedMatch:false entities to "explain" a token (if the regex
  // DID match a documented-as-uncoverable value, that's not a false positive —
  // it's our documentation being wrong, already surfaced via a note below).
  const allGtEntityValues = c.entities.map(e => e.value)

  for (const [token, value] of Object.entries(map)) {
    const type = token.replace(/^\[([A-Z_]+)_\d+\]$/, '$1')
    const matchesGtExactly = [...groundTruthValues].some(k => k.endsWith(`::${value}`))
    if (matchesGtExactly) continue
    // Documented entity, matched exactly (possibly expectedMatch:false, already
    // surfaced via gapMismatches below) — not a false positive.
    if (allGtEntityValues.includes(value)) continue
    // Partial overlap with a longer ground-truth value (e.g. PASSPORT pattern
    // consuming "X 1000392" out of NIE "X 1000392 F") — this is a genuine
    // detection artifact worth knowing about (production would leak the
    // dangling remainder), but it is NOT an unrelated false positive, so it's
    // excluded from the FP count and NOT double-counted against precision.
    const isPartialOfSomeGt = allGtEntityValues.some(gv => gv.includes(value) && value.length < gv.length)
    if (isPartialOfSomeGt) continue
    // Ground-truth-free match: this value was replaced by the regex layer but
    // is not related to any labeled PII entity in this case → real false positive.
    falsePositives.push({
      caseId: c.id, domain: c.domain, category: c.category ?? null, source: c.source,
      type, value, notes: c.notes ?? null,
    })
    byTypeFP[type] = (byTypeFP[type] ?? 0) + 1
  }
}

// ── Precision by type: TP / (TP + FP) ───────────────────────────────────────

const precisionByType = {}
const allTypes = new Set([...Object.keys(byType), ...Object.keys(byTypeFP)])
for (const type of allTypes) {
  const tp = byType[type]?.found ?? 0
  const fp = byTypeFP[type] ?? 0
  precisionByType[type] = { tp, fp, pct: (tp + fp) ? +(100 * tp / (tp + fp)).toFixed(1) : null }
}

// ── "Predicted gap" cross-check ─────────────────────────────────────────────
// Cases authored with expectedMatch:false document our belief, from reading
// pii.ts, that a value CANNOT match. Cross-check that belief against the
// actual runtime result — if one of these unexpectedly got detected, our
// documentation in adversarial.mjs is wrong and should be corrected.
const gapMismatches = []
for (const s of scored) {
  for (const r of s.results) {
    if (r.expectedMatch === false && r.detected) {
      gapMismatches.push({ caseId: s.case.id, type: r.type, value: r.value, notes: s.case.notes })
    }
  }
}

// ── Console report ───────────────────────────────────────────────────────────

const totalPartial = falseNegatives.filter(f => f.partiallyMatched).length

console.log('═══ Regex-layer PII eval — independent Spanish dataset ═══\n')
console.log(`Cases: ${allCases.length}  (synthetic: ${syntheticCases.length}, adversarial: ${adversarialCases.length})`)
console.log(`Ground-truth entities in regex scope: ${totalExpected}  (NER-scope, excluded from this run: ${totalNerScope})`)
console.log(`Of the misses below, ${totalPartial} were PARTIALLY consumed by an unrelated pattern (e.g. PASSPORT eating part of a NIE) — counted as misses for recall, but flagged since production would still leak the undetected remainder.\n`)

console.log('── Recall by entity type ──')
for (const [type, v] of Object.entries(byType).sort((a, b) => b[1].expected - a[1].expected)) {
  const pct = v.expected ? (100 * v.found / v.expected).toFixed(1) : '0.0'
  console.log(`  ${type.padEnd(22)} ${String(v.found).padStart(3)}/${String(v.expected).padEnd(3)}  ${pct.padStart(5)}%`)
}

console.log('\n── Precision by entity type (TP / (TP+FP)) ──')
for (const [type, v] of Object.entries(precisionByType).sort((a, b) => (b[1].tp + b[1].fp) - (a[1].tp + a[1].fp))) {
  const pct = v.pct === null ? '  n/a' : `${v.pct}%`.padStart(6)
  console.log(`  ${type.padEnd(22)} TP:${String(v.tp).padStart(3)}  FP:${String(v.fp).padStart(3)}  ${pct}`)
}

console.log(`\n── Recall overall: ${totalFound}/${totalExpected} (${totalExpected ? (100 * totalFound / totalExpected).toFixed(1) : '0.0'}%) ──`)
console.log(`  by source:  synthetic ${bySource.synthetic.found}/${bySource.synthetic.expected} (${bySource.synthetic.pct}%)   adversarial ${bySource.adversarial.found}/${bySource.adversarial.expected} (${bySource.adversarial.pct}%)`)
console.log(`  by domain:  legal ${byDomain.legal.found}/${byDomain.legal.expected} (${byDomain.legal.pct}%)   sanidad ${byDomain.sanidad.found}/${byDomain.sanidad.expected} (${byDomain.sanidad.pct}%)`)
for (const [k, v] of Object.entries(byDomainSource)) {
  console.log(`  ${k.padEnd(18)} ${v.found}/${v.expected} (${v.pct}%)`)
}

console.log(`\n── False positives: ${falsePositives.length} ──`)
for (const fp of falsePositives.slice(0, 30)) {
  console.log(`  [${fp.type}] "${fp.value}"  (${fp.caseId}, ${fp.domain}/${fp.category ?? fp.source})`)
}
if (falsePositives.length > 30) console.log(`  ... and ${falsePositives.length - 30} more (see JSON output)`)

console.log(`\n── False negatives: ${falseNegatives.length}  (${totalPartial} partially matched by an unrelated pattern) ──`)
for (const fn of falseNegatives) {
  const tag = fn.partiallyMatched ? '  [partial-overlap]' : ''
  console.log(`  [${fn.type}] "${fn.value}"  (${fn.caseId}, ${fn.domain}/${fn.category ?? fn.source})${tag}`)
}

if (gapMismatches.length) {
  console.log(`\n── Documentation mismatches: ${gapMismatches.length} case(s) marked expectedMatch:false were ACTUALLY detected ──`)
  for (const g of gapMismatches) console.log(`  [${g.type}] "${g.value}" (${g.caseId}) — adversarial.mjs note may be wrong, re-verify`)
} else {
  console.log('\n── Documentation check: all expectedMatch:false cases were confirmed as misses (0 mismatches) ──')
}

// ── Write JSON ────────────────────────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'regex-only (detectPII/anonymize from src/pii.ts) — NER layer not evaluated here',
  totals: {
    cases: allCases.length,
    synthetic: syntheticCases.length,
    adversarial: adversarialCases.length,
    entitiesInRegexScope: totalExpected,
    entitiesNerScope: totalNerScope,
    recallFound: totalFound,
    recallExpected: totalExpected,
    recallPct: totalExpected ? +(100 * totalFound / totalExpected).toFixed(1) : 0,
    partiallyMatchedMisses: totalPartial,
  },
  recallByType: byType,
  precisionByType,
  recallBySource: bySource,
  recallByDomain: byDomain,
  recallByDomainSource: byDomainSource,
  falseNegatives,
  falsePositives,
  gapDocumentationMismatches: gapMismatches,
}

const outFile = `dataset-eval-results-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(new URL(outFile, import.meta.url), JSON.stringify(report, null, 2))
console.log(`\n→ wrote ${outFile}`)

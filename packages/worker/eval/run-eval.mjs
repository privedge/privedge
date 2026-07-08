/**
 * NER model eval: 70B vs 8B over the 10 demo scenario prompts (5 scenarios × EN/ES).
 * Measures per model: recall on expected PERSON/ORG/ADDRESS entities, verbatim rate
 * (value appears literally in text — production filters non-verbatim out), and latency.
 *
 * Usage: node run-eval.mjs [port]   (expects wrangler dev serving ner-eval-worker on that port)
 */

const PORT = process.argv[2] ?? '8788'
const MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-4-26b-a4b-it',
]

// Ground truth: NER-scope entities only (PERSON/ORG/ADDRESS) from packages/demo/src/scenarios.ts
const CASES = [
  {
    id: 'healthcare-en',
    text: `Patient Jane Smith (DOB: 03/15/1985, SSN: 456-78-9012, MRN: MRN-2024-8472) was admitted on 04/12/2025 with chest pain. Her cardiologist Dr. Robert Chen at Memorial Hospital (tel: 555-239-4821) ordered an ECG and troponin panel. Insurance: BlueCross #BC-9913482. Summarize her admission notes and suggest next steps.`,
    expected: ['Jane Smith', 'Robert Chen', 'Memorial Hospital', 'BlueCross'],
  },
  {
    id: 'healthcare-es',
    text: `La paciente María García (FDN: 15/03/1985, DNI: 45678901-A, NHC: NHC-2024-8472) ingresó el 12/04/2025 con dolor torácico. Su cardiólogo el Dr. Javier López en el Hospital Universitario La Paz (tel: 91 234 56 78) ordenó un ECG y panel de troponinas. Seguro: Sanitas #SAN-9913482. Resume sus notas de ingreso y sugiere los próximos pasos.`,
    expected: ['María García', 'Javier López', 'Hospital Universitario La Paz', 'Sanitas'],
  },
  {
    id: 'legal-en',
    text: `My client Marcus Rodriguez (passport ES-9182736) is being sued by his former employer TechCorp Inc. His employment contract contains a clause voiding his $2.1M severance if he "publicly disparages" the company. He recently spoke with journalist Sarah Lee at Reuters. Draft a privileged legal strategy memo outlining our options.`,
    expected: ['Marcus Rodriguez', 'Sarah Lee', 'TechCorp', 'Reuters'],
  },
  {
    id: 'legal-es',
    text: `Mi cliente Carlos Rodríguez (pasaporte ESP-9182736) está siendo demandado por su antiguo empleador TechCorp España S.L. Su contrato incluye una cláusula que anula su indemnización de 180.000 € si «critica públicamente» a la empresa. Recientemente habló con la periodista Ana Martínez de El País. Redacta un memo de estrategia legal privilegiado con nuestras opciones.`,
    expected: ['Carlos Rodríguez', 'Ana Martínez', 'TechCorp España', 'El País'],
  },
  {
    id: 'finance-en',
    text: `Analyze the transactions for account holder Elena Vasquez (account 4532-1567-8901-2345, routing 021000021). She initiated a wire transfer of $85,000 to a Cayman Islands account BK-44921 on May 3rd. Her tax ID is 98-7654321. Flag any suspicious patterns and draft a SAR filing summary.`,
    expected: ['Elena Vasquez'],
  },
  {
    id: 'finance-es',
    text: `Analiza las transacciones de la titular Elena Vázquez (cuenta 4532-1567-8901-2345, IBAN ES91 2100 0418 4502 0005 1332). Realizó una transferencia de 75.000 € a una cuenta en Luxemburgo LU28 0019 4006 4475 0000 el 3 de mayo. Su NIF es 98765432-B. Identifica patrones sospechosos y redacta un resumen de declaración SAR.`,
    expected: ['Elena Vázquez'],
  },
  {
    id: 'hr-en',
    text: `Prepare a performance improvement plan for employee David Kim (ID: EMP-20219, SSN: 234-56-7890, salary $127,500/year). He is managed by Jennifer Walsh in our Seattle office. His last review on January 15th cited consistent failure to meet project deadlines and poor stakeholder communication.`,
    expected: ['David Kim', 'Jennifer Walsh'],
  },
  {
    id: 'hr-es',
    text: `Prepara un plan de mejora del rendimiento para el empleado David Kim (ID: EMP-20219, DNI: 45678901-B, salario 45.000 €/año). Depende de Jennifer Walsh en nuestra oficina de Madrid. Su última evaluación del 15 de enero destacó retrasos constantes en proyectos y mala comunicación con las partes interesadas.`,
    expected: ['David Kim', 'Jennifer Walsh'],
  },
  {
    id: 'public-en',
    text: `Citizen Carlos Mendoza (national ID 48291736-K, address: Calle Mayor 47, Madrid 28001, phone: +34 612 345 678) submitted appeal #APP-2025-0934 against a tax assessment on his declared property. His annual income is €42,800. Prepare a formal administrative response within the 15-day legal window.`,
    expected: ['Carlos Mendoza', 'Calle Mayor 47'],
  },
  {
    id: 'public-es',
    text: `El ciudadano Carlos Mendoza (DNI 48291736-K, dirección: Calle Mayor 47, Madrid 28001, teléfono: +34 612 345 678) presentó el recurso #APP-2025-0934 contra una liquidación tributaria sobre su propiedad declarada. Sus ingresos anuales son 42.800 €. Prepara una respuesta administrativa formal dentro del plazo legal de 15 días.`,
    expected: ['Carlos Mendoza', 'Calle Mayor 47'],
  },
]

const norm = s => s.toLowerCase().normalize('NFC')

async function evalCase(model, c) {
  const res = await fetch(`http://localhost:${PORT}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, text: c.text }),
  })
  const data = await res.json()
  if (data.error) return { id: c.id, error: data.error, latencyMs: data.latencyMs }

  const entities = data.entities ?? []
  const textLower = norm(c.text)
  // Verbatim = production filter would keep it (value appears literally in text)
  const verbatim = entities.filter(e => e?.value && textLower.includes(norm(e.value)))
  // Recall over verbatim survivors: expected found if either contains the other
  const found = c.expected.filter(exp =>
    verbatim.some(e => norm(e.value).includes(norm(exp)) || norm(exp).includes(norm(e.value))),
  )
  const missed = c.expected.filter(e => !found.includes(e))
  return {
    id: c.id,
    expected: c.expected.length,
    found: found.length,
    missed,
    returned: entities.length,
    paraphrased: entities.length - verbatim.length,
    latencyMs: data.latencyMs,
  }
}

for (const model of MODELS) {
  console.log(`\n═══ ${model} ═══`)
  let totExp = 0, totFound = 0, totPara = 0, totLat = 0, errs = 0
  for (const c of CASES) {
    const r = await evalCase(model, c)
    if (r.error) {
      errs++
      console.log(`  ${r.id.padEnd(15)} ERROR: ${r.error.slice(0, 80)}`)
      continue
    }
    totExp += r.expected; totFound += r.found; totPara += r.paraphrased; totLat += r.latencyMs
    const miss = r.missed.length ? `  MISSED: ${r.missed.join(', ')}` : ''
    const para = r.paraphrased ? `  paraphrased:${r.paraphrased}` : ''
    console.log(`  ${r.id.padEnd(15)} ${r.found}/${r.expected}  ${String(r.latencyMs).padStart(5)}ms${para}${miss}`)
  }
  const n = CASES.length - errs
  console.log(`  ── recall: ${totFound}/${totExp} (${(100 * totFound / totExp).toFixed(0)}%)  paraphrased: ${totPara}  avg latency: ${n ? Math.round(totLat / n) : '-'}ms  errors: ${errs}`)
}

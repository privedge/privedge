/**
 * NER model eval: llama-3.3-70b (production) vs llama-4-scout-17b over the REAL demo
 * scenario prompts (5 sectors × EN/ES, from privedge-platform/packages/demo/src/scenarios.ts).
 * Measures per model: recall on expected PERSON/ORG/ADDRESS entities, paraphrase rate
 * (value not verbatim → production filters it out = detection lost), errors and latency.
 *
 * Usage: node run-eval.mjs [port]   (expects wrangler dev serving ner-eval-worker on that port)
 * Writes machine-readable results to eval-results-<today>.json for the HTML report.
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] ?? '8788'
const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // production
  '@cf/meta/llama-4-scout-17b-16e-instruct',  // challenger — newer, 17B MoE, multimodal
]

// Ground truth: NER-scope entities only (PERSON / ORG / ADDRESS) taken from the FULL
// demo prompts in scenarios.ts. Cities/countries, IDs, dates, phones are out of NER scope.
const CASES = [
  {
    id: 'healthcare-en',
    text: `ED Clinical Note — 23:47. Patient: Jane Smith, DOB 03/15/1985, SSN 456-78-9012, MRN MRN-2024-8472. Chief complaint: oppressive chest pain 3h duration (8/10 VAS), radiating to left arm, with diaphoresis and nausea. PMH: HTN (Enalapril 10mg), active smoker 20 cigs/day × 15 years. Exam: BP 158/94 mmHg, HR 96 bpm, SpO₂ 97%. Physician: Dr. Robert Chen, Cardiology, Memorial Hospital (tel: 555-239-4821). Insurance: BlueCross #BC-9913482. Orders: ECG (attached), troponin T=0 and T=3h, CXR, urgent echo. Summarize the admission notes, interpret the findings, and propose a management protocol and next diagnostic steps.\n\nContext: This request is processed in a HIPAA-compliant environment for authorized medical record analysis.`,
    expected: ['Jane Smith', 'Robert Chen', 'Memorial Hospital', 'BlueCross'],
  },
  {
    id: 'healthcare-es',
    text: `Nota clínica de urgencias — 23:47h. Paciente: María García, FDN 15/03/1985, DNI 45678901-A, NHC NHC-2024-8472. Motivo: dolor torácico opresivo de 3h de evolución (8/10 EVA), irradiado a brazo izquierdo, con diaforesis y náuseas. Antecedentes: HTA (Enalapril 10mg), fumadora activa 20 cig/día × 15 años. Exploración: TA 158/94 mmHg, FC 96 lpm, SpO₂ 97%. Médico: Dr. Javier López, Cardiología, Hospital Universitario La Paz (tel: 91 234 56 78). Aseguradora: Sanitas #SAN-9913482. Pruebas solicitadas: ECG (adjunto), troponinas T=0 y T=3h, Rx tórax, ecocardiograma urgente. Resume las notas de ingreso, interpreta los hallazgos y propón protocolo de manejo y próximos pasos diagnósticos.\n\nContexto: Esta solicitud se procesa en un entorno conforme con HIPAA para análisis autorizado de registros médicos.`,
    expected: ['María García', 'Javier López', 'Hospital Universitario La Paz', 'Sanitas'],
  },
  {
    id: 'legal-en',
    text: `CONFIDENTIAL MEMO — Attorney-Client Privilege. Re: Wrongful termination + non-disparagement clause. Client: Marcus Rodriguez (passport ES-9182736, 123 Main St, New York NY 10001). Defendant: TechCorp Inc. Background: terminated 01/15/2025 after 7 years as VP Product ($185,000/year + 20% variable). Contract clause voids $2.1M severance if client "publicly disparages" the company or its executives. On 02/03/2025 client spoke with journalist Sarah Lee (Reuters) about "strategic changes" without naming products or individuals. Company alleges violation and withholds severance. Draft legal strategy memo with: (1) clause enforceability analysis, (2) applicable precedent, (3) procedural options and timelines, (4) counter-suit risk assessment.`,
    expected: ['Marcus Rodriguez', 'Sarah Lee', 'TechCorp', 'Reuters', '123 Main St'],
  },
  {
    id: 'legal-es',
    text: `CONSULTA CONFIDENCIAL — Privilegio Abogado-Cliente. Asunto: Despido improcedente + cláusula no-disparage. Cliente: Carlos Rodríguez (pasaporte ESP-9182736, C/ Serrano 47, 28001 Madrid). Demandante: TechCorp España S.L. (CIF B-12345678). Antecedentes: despedido el 15/01/2025 tras 7 años como Director de Producto (95.000 €/año + 20% variable). Cláusula 12.3 del contrato anula indemnización de 180.000 € si «critica públicamente» a la empresa o a sus directivos. El 03/02/2025 concedió entrevista a la periodista Ana Martínez (El País) sobre «cambios estratégicos» sin nombrar productos ni personas. La empresa alega violación y retiene la indemnización. Redacta memo de estrategia legal con: (1) análisis de la cláusula bajo ET art. 8, (2) jurisprudencia aplicable, (3) opciones procesales y plazos, (4) valoración del riesgo de contrademanda.`,
    expected: ['Carlos Rodríguez', 'Ana Martínez', 'TechCorp España', 'El País', 'C/ Serrano 47'],
  },
  {
    id: 'finance-en',
    text: `BSA/AML COMPLIANCE ALERT. Account holder: Elena Vasquez, TIN 98-7654321. Account 4532-1567-8901-2345, routing 021000021. Activity: outgoing wire of $85,000 on 05/03/2025 to Cayman Islands account BK-44921 without supporting documentation. History: 3 prior transfers to same account (last 6 months, total $255,000). Normal activity: ~$3,200/mo salary deposits. Customer since 2019, low risk profile until this activity. Analyze patterns per BSA/FinCEN requirements, determine SAR filing threshold, and draft Suspicious Activity Report summary.\n\nContext: This request is processed through an authorized BSA/AML compliance system of a regulated financial institution for regulatory analysis purposes.`,
    expected: ['Elena Vasquez'],
  },
  {
    id: 'finance-es',
    text: `ALERTA CUMPLIMIENTO BSA/AML. Titular: Elena Vázquez, NIF 98765432-B. Cuenta 4532-1567-8901-2345, IBAN ES91 2100 0418 4502 0005 1332. Actividad: transferencia saliente de 75.000 € el 03/05/2025 a cuenta LU28 0019 4006 4475 0000 (Banco Raiffeisen Luxembourg) sin justificación documental. Historial: 3 transferencias previas a la misma cuenta (últimos 6 meses, total 210.000 €). Actividad habitual: ingresos ~3.200 €/mes (nómina). Cliente desde 2019, perfil de riesgo bajo hasta esta actividad. Analiza los patrones según directiva 5AMLD, determina si procede declaración SEPBLAC y redacta borrador de declaración de operación sospechosa (STR).\n\nContexto: Esta solicitud se procesa a través de un sistema de cumplimiento BSA/AML autorizado de una entidad financiera regulada para análisis regulatorio.`,
    expected: ['Elena Vázquez', 'Banco Raiffeisen Luxembourg'],
  },
  {
    id: 'hr-en',
    text: `DISCIPLINARY FILE — HR CONFIDENTIAL. Employee: David Kim, ID EMP-20219, SSN 234-56-7890, Senior Engineer, $127,500/year. Manager: Jennifer Walsh, Engineering Director, Seattle office. Documented incidents: (1) 01/15/2025 — Q1 review: 3 projects delivered avg 12 days late; (2) 02/03/2025 — defective production commit (ref. PRJ-2025-041), 4h client downtime (Accenture); (3) 03/28/2025 — written communication to external client without manager sign-off. 360 feedback: "blocked without escalation" and "poor proactive communication". Draft a 90-day Performance Improvement Plan with SMART objectives, evaluation KPIs, review schedule, and consequences per company policy.\n\nContext: This request is processed through an authorized HR management system for official performance review and improvement plan documentation, in compliance with applicable labor law and company policy.`,
    expected: ['David Kim', 'Jennifer Walsh', 'Accenture'],
  },
  {
    id: 'hr-es',
    text: `EXPEDIENTE DISCIPLINARIO — RRHH CONFIDENCIAL. Empleado: David Kim, ID EMP-20219, DNI 45678901-B, Senior Engineer, 45.000 €/año. Manager: Jennifer Walsh, Directora de Ingeniería, oficina Madrid. Incidentes documentados: (1) 15/01/2025 — evaluación Q1: 3 proyectos entregados con retraso medio de 12 días; (2) 03/02/2025 — commit defectuoso en producción (ref. PRJ-2025-041), 4h de downtime en cliente Accenture; (3) 28/03/2025 — comunicación escrita a cliente externo sin validación del manager. Feedback 360: «bloqueos sin escalado» y «dificultades de comunicación proactiva». Prepara un Plan de Mejora del Rendimiento (PIP) de 90 días con objetivos SMART, KPIs de evaluación, schedule de revisiones y consecuencias por incumplimiento según ET art. 54.\n\nContexto: Esta solicitud se procesa a través de un sistema de RRHH autorizado para documentación oficial de evaluación del rendimiento y planes de mejora, en cumplimiento de la legislación laboral aplicable y la política interna de la empresa.`,
    expected: ['David Kim', 'Jennifer Walsh', 'Accenture'],
  },
  {
    id: 'public-en',
    text: `ADMINISTRATIVE FILE #APP-2025-0934. Citizen: Carlos Mendoza, national ID 48291736-K, address: 47 Main Street, Apt 1B, Madrid 28001, phone: +34 612 345 678. Appeal against: provisional 2024 property tax assessment (cadastral ref. 9872023VK6897S0001WX, cadastral value €380,000, gross levy €2,850). Claim: property was primary residence until 06/30/2024; requests 50% primary residence reduction (Municipal Ordinance art. 12.2). Annual income: €42,800 (2024 tax return). Legal response deadline: 15 working days from 07/28/2025. Draft administrative response with: (1) reduction eligibility analysis, (2) required documentation, (3) reasoned provisional resolution, (4) available appeal routes.`,
    expected: ['Carlos Mendoza', '47 Main Street'],
  },
  {
    id: 'public-es',
    text: `EXPEDIENTE ADMINISTRATIVO #APP-2025-0934. Ciudadano: Carlos Mendoza, DNI 48291736-K, dirección: C/ Mayor 47, 1ºB, 28001 Madrid, teléfono: +34 612 345 678. Recurso contra: liquidación tributaria provisional 2024 (ref. catastral 9872023VK6897S0001WX, valor catastral 380.000 €, cuota íntegra 2.850 €). Alegación: el inmueble fue vivienda habitual hasta el 30/06/2024 y solicita la reducción del 50% por residencia prevista en la Ordenanza Municipal art. 12.2. Ingresos anuales declarados: 42.800 € (IRPF 2024, modelo 100). Plazo legal de respuesta: 15 días hábiles desde el 28/07/2025. Genera respuesta administrativa con: (1) análisis de procedencia de la reducción, (2) documentación requerida, (3) resolución provisional motivada, (4) recursos disponibles.`,
    expected: ['Carlos Mendoza', 'C/ Mayor 47'],
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
    entities,
  }
}

const report = { generatedAt: new Date().toISOString(), port: PORT, models: {} }

for (const model of MODELS) {
  console.log(`\n═══ ${model} ═══`)
  let totExp = 0, totFound = 0, totPara = 0, totLat = 0, errs = 0
  const cases = []
  for (const c of CASES) {
    const r = await evalCase(model, c)
    if (r.error) {
      errs++
      cases.push(r)
      console.log(`  ${r.id.padEnd(15)} ERROR: ${r.error.slice(0, 80)}`)
      continue
    }
    totExp += r.expected; totFound += r.found; totPara += r.paraphrased; totLat += r.latencyMs
    cases.push(r)
    const miss = r.missed.length ? `  MISSED: ${r.missed.join(', ')}` : ''
    const para = r.paraphrased ? `  paraphrased:${r.paraphrased}` : ''
    console.log(`  ${r.id.padEnd(15)} ${r.found}/${r.expected}  ${String(r.latencyMs).padStart(5)}ms${para}${miss}`)
  }
  const n = CASES.length - errs
  const avgLat = n ? Math.round(totLat / n) : null
  console.log(`  ── recall: ${totFound}/${totExp} (${(100 * totFound / totExp).toFixed(0)}%)  paraphrased: ${totPara}  avg latency: ${avgLat ?? '-'}ms  errors: ${errs}`)
  report.models[model] = {
    recallFound: totFound, recallExpected: totExp,
    recallPct: totExp ? +(100 * totFound / totExp).toFixed(1) : 0,
    paraphrased: totPara, errors: errs, avgLatencyMs: avgLat, cases,
  }
}

const outFile = `eval-results-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(`\n→ wrote ${outFile}`)

/**
 * Generates the regex-only (free tier) ground truth for the demo scenarios:
 * sanitized text (worker anonymize with no NER entities, <T_N> → [T_N]) and
 * per-type match counts. Output feeds packages/demo/src/scenarios.ts alignment.
 *
 * Usage: node --experimental-strip-types gen-sanitized.mjs   (or npx tsx)
 */
import { detectPII, anonymize } from '../src/pii.ts'

const prompts = {
  'healthcare-en': `Patient Jane Smith (DOB: 03/15/1985, SSN: 456-78-9012, MRN: MRN-2024-8472) was admitted on 04/12/2025 with chest pain. Her cardiologist Dr. Robert Chen at Memorial Hospital (tel: 555-239-4821) ordered an ECG and troponin panel. Insurance: BlueCross #BC-9913482. Summarize her admission notes and suggest next steps.`,
  'healthcare-es': `La paciente María García (FDN: 15/03/1985, DNI: 45678901-A, NHC: NHC-2024-8472) ingresó el 12/04/2025 con dolor torácico. Su cardiólogo el Dr. Javier López en el Hospital Universitario La Paz (tel: 91 234 56 78) ordenó un ECG y panel de troponinas. Seguro: Sanitas #SAN-9913482. Resume sus notas de ingreso y sugiere los próximos pasos.`,
  'legal-en': `My client Marcus Rodriguez (passport ES-9182736) is being sued by his former employer TechCorp Inc. His employment contract contains a clause voiding his $2.1M severance if he "publicly disparages" the company. He recently spoke with journalist Sarah Lee at Reuters. Draft a privileged legal strategy memo outlining our options.`,
  'legal-es': `Mi cliente Carlos Rodríguez (pasaporte ESP-9182736) está siendo demandado por su antiguo empleador TechCorp España S.L. Su contrato incluye una cláusula que anula su indemnización de 180.000 € si «critica públicamente» a la empresa. Recientemente habló con la periodista Ana Martínez de El País. Redacta un memo de estrategia legal privilegiado con nuestras opciones.`,
  'finance-en': `Analyze the transactions for account holder Elena Vasquez (account 4532-1567-8901-2345, routing 021000021). She initiated a wire transfer of $85,000 to a Cayman Islands account BK-44921 on May 3rd. Her tax ID is 98-7654321. Flag any suspicious patterns and draft a SAR filing summary.`,
  'finance-es': `Analiza las transacciones de la titular Elena Vázquez (cuenta 4532-1567-8901-2345, IBAN ES91 2100 0418 4502 0005 1332). Realizó una transferencia de 75.000 € a una cuenta en Luxemburgo LU28 0019 4006 4475 0000 el 3 de mayo. Su NIF es 98765432-B. Identifica patrones sospechosos y redacta un resumen de declaración SAR.`,
  'hr-en': `Prepare a performance improvement plan for employee David Kim (ID: EMP-20219, SSN: 234-56-7890, salary $127,500/year). He is managed by Jennifer Walsh in our Seattle office. His last review on January 15th cited consistent failure to meet project deadlines and poor stakeholder communication.`,
  'hr-es': `Prepara un plan de mejora del rendimiento para el empleado David Kim (ID: EMP-20219, DNI: 45678901-B, salario 45.000 €/año). Depende de Jennifer Walsh en nuestra oficina de Madrid. Su última evaluación del 15 de enero destacó retrasos constantes en proyectos y mala comunicación con las partes interesadas.`,
  'public-en': `Citizen Carlos Mendoza (national ID 48291736-K, address: Calle Mayor 47, Madrid 28001, phone: +34 612 345 678) submitted appeal #APP-2025-0934 against a tax assessment on his declared property. His annual income is €42,800. Prepare a formal administrative response within the 15-day legal window.`,
  'public-es': `El ciudadano Carlos Mendoza (DNI 48291736-K, dirección: Calle Mayor 47, Madrid 28001, teléfono: +34 612 345 678) presentó el recurso #APP-2025-0934 contra una liquidación tributaria sobre su propiedad declarada. Sus ingresos anuales son 42.800 €. Prepara una respuesta administrativa formal dentro del plazo legal de 15 días.`,
}

for (const [id, text] of Object.entries(prompts)) {
  const det = detectPII(text)
  const { messages, map } = anonymize([{ role: 'user', content: text }], [])
  const sanitized = messages[0].content.replace(/<([A-Z_]+_\d+)>/g, '[$1]')
  const counts = {}
  for (const token of Object.keys(map)) {
    const type = token.replace(/^<([A-Z_]+)_\d+>$/, '$1')
    counts[type] = (counts[type] ?? 0) + 1
  }
  console.log(`── ${id} ── matches: ${det.matches}, types: ${det.types.join(',')}`)
  console.log(`counts: ${JSON.stringify(counts)}`)
  console.log(sanitized)
  console.log()
}

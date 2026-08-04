/**
 * Synthetic Spanish PII eval dataset generator — legal + sanidad domains.
 *
 * Builds documents from templates with slots filled from pools.mjs, and records
 * EXACT character offsets (start/end) for every PII entity inserted, so ground
 * truth never depends on string search over a value that might repeat.
 *
 * Deterministic: seeded RNG (see pools.mjs#makeRng) so re-running produces the
 * same dataset. Ground truth is COMPLETE — every PII value placed in a document
 * is labeled, not just the ones we expect the detector to catch (see dataset/README.md
 * for why: an incomplete ground truth hides false negatives behind a 100% score).
 *
 * `nerScope: true` marks PERSON / ORG / ADDRESS entities: packages/worker/src/pii.ts
 * has NO regex pattern for any of these three types at all (confirmed by reading
 * PII_PATTERNS — production only extracts them via detectPIINER, the LLM layer).
 * run-dataset-eval.mjs excludes nerScope entities from the regex-only recall
 * denominator; without the flag every PERSON/ORG/ADDRESS would show as a "false
 * negative", which would be misleading (the regex layer was never meant to catch
 * them — it's not a gap, it's out of scope for this runner).
 *
 * Usage: node generate.mjs > cases.json   (or import { generateAll } elsewhere)
 */
import {
  makeRng, randomFullName, randomAddress, randomNIF, randomNIE, randomCIF,
  randomIBAN, randomPhone, randomSeguridadSocial, randomTarjeta, randomNHC,
  randomNIG, randomColegiado, randomReferenciaCatastral, randomExpediente,
  HOSPITALES, JUZGADOS, DESPACHOS, MUTUAS_ASEGURADORAS, CIUDADES,
} from './pools.mjs'
import { builder } from './builder.mjs'

// ── Domain: Sanidad ─────────────────────────────────────────────────────────

function genInformeClinico(rng, id) {
  const paciente = randomFullName(rng)
  const medico = randomFullName(rng)
  const hospital = rng.pick(HOSPITALES)
  const nhc = randomNHC(rng)
  const nif = randomNIF(rng)
  const telefono = randomPhone(rng)
  const direccion = randomAddress(rng)
  const ciudad = rng.pick(CIUDADES)
  const ss = randomSeguridadSocial(rng)
  const mutua = rng.pick(MUTUAS_ASEGURADORAS)
  const edad = rng.int(18, 92)
  const diagnostico = rng.pick([
    'dolor torácico opresivo con irradiación a brazo izquierdo',
    'fractura de cadera tras caída accidental',
    'crisis hipertensiva con cefalea intensa',
    'apendicitis aguda confirmada por ecografía',
    'neumonía adquirida en la comunidad',
    'episodio de fibrilación auricular paroxística',
  ])

  const b = builder()
  b.t('INFORME CLÍNICO DE ALTA\n\n')
    .t('Paciente: ').e('PERSON', paciente, { nerScope: true }).t(`, ${edad} años\n`)
    .t('Nº Historia Clínica: ').e('NHC', nhc).t('\n')
    .t('DNI: ').e('DNI', nif).t('\n')
    .t('Nº Seguridad Social: ').e('SSN_ES', ss).t('\n')
    .t('Domicilio: ').e('ADDRESS', direccion, { nerScope: true }).t(`, ${ciudad.cp} ${ciudad.nombre}\n`)
    .t('Teléfono de contacto: ').e('PHONE', telefono).t('\n')
    .t('Mutua/Aseguradora: ').e('ORG', mutua, { nerScope: true }).t('\n\n')
    .t('Centro: ').e('ORG', hospital, { nerScope: true }).t('\n')
    .t('Médico responsable: Dr./Dra. ').e('PERSON', medico, { nerScope: true }).t('\n\n')
    .t(`Motivo de ingreso: ${diagnostico}.\n`)
    .t('Evolución: favorable durante el ingreso, sin incidencias reseñables. ')
    .t('Se procede al alta con tratamiento ambulatorio y revisión en consultas externas.\n\n')
    .t('Recomendaciones: reposo relativo, control por su médico de atención primaria, ')
    .t('y contactar con el servicio de urgencias ante empeoramiento de los síntomas.\n')
  return { id, domain: 'sanidad', kind: 'informe-alta', ...b.build() }
}

function genNotaUrgencias(rng, id) {
  const paciente = randomFullName(rng)
  const medico = randomFullName(rng)
  const hospital = rng.pick(HOSPITALES)
  const nhc = randomNHC(rng)
  const nie = rng.bool() ? randomNIE(rng) : randomNIF(rng)
  const tipoDoc = nie.match(/^[XYZ]/) ? 'NIE' : 'DNI'
  const telefono = randomPhone(rng)
  const hora = `${rng.int(0, 23)}:${String(rng.int(0, 59)).padStart(2, '0')}`

  const b = builder()
  b.t(`NOTA DE URGENCIAS — ${hora}h\n\n`)
    .t('Paciente: ').e('PERSON', paciente, { nerScope: true }).t('. ')
    .t(`${tipoDoc}: `).e('DNI', nie).t('. ')
    .t('NHC: ').e('NHC', nhc).t('.\n')
    .t('Contacto familiar: ').e('PHONE', telefono).t('.\n\n')
    .t('Triaje: nivel 2. Constantes estables. Refiere dolor abdominal difuso de 6h de evolución.\n')
    .t('Exploración física sin hallazgos relevantes de alarma. Se solicita analítica completa, ')
    .t('sedimento de orina y ecografía abdominal.\n\n')
    .t('Atendido por: Dr./Dra. ').e('PERSON', medico, { nerScope: true }).t(`, Servicio de Urgencias, `)
    .e('ORG', hospital, { nerScope: true }).t('.\n')
    .t('Pendiente de resultados para decidir ingreso o alta a domicilio con control ambulatorio.\n')
  return { id, domain: 'sanidad', kind: 'nota-urgencias', ...b.build() }
}

function genInterconsulta(rng, id) {
  const paciente = randomFullName(rng)
  const medicoSolicita = randomFullName(rng)
  const medicoRecibe = randomFullName(rng)
  const hospital = rng.pick(HOSPITALES)
  const nhc = randomNHC(rng)
  const tarjeta = randomTarjeta(rng)

  const b = builder()
  b.t('PARTE DE INTERCONSULTA\n\n')
    .t('Servicio solicitante: Medicina Interna → Servicio receptor: Cardiología\n\n')
    .t('Paciente: ').e('PERSON', paciente, { nerScope: true }).t('. NHC: ').e('NHC', nhc).t('.\n')
    .t('Centro: ').e('ORG', hospital, { nerScope: true }).t('.\n')
    .t('Tarjeta sanitaria: ').e('CARD_HEALTH', tarjeta).t('.\n\n')
    .t('Médico solicitante: ').e('PERSON', medicoSolicita, { nerScope: true }).t('.\n')
    .t('Motivo de consulta: valoración de soplo sistólico detectado en exploración rutinaria, ')
    .t('se solicita ecocardiograma y valoración especializada.\n\n')
    .t('Médico que recibe: ').e('PERSON', medicoRecibe, { nerScope: true }).t(', Cardiología.\n')
    .t('Se programa cita preferente en un plazo máximo de 15 días.\n')
  return { id, domain: 'sanidad', kind: 'interconsulta', ...b.build() }
}

// ── Domain: Legal ────────────────────────────────────────────────────────────

function genEscritoDemanda(rng, id) {
  const demandante = randomFullName(rng)
  const demandado = randomFullName(rng)
  const abogado = randomFullName(rng)
  const juzgado = rng.pick(JUZGADOS)
  const despacho = rng.pick(DESPACHOS)
  const nif = randomNIF(rng)
  const direccion = randomAddress(rng)
  const ciudad = rng.pick(CIUDADES)
  const colegiado = randomColegiado(rng)
  const nig = randomNIG(rng)
  const cuantia = rng.int(1000, 95000)

  const b = builder()
  b.t('ESCRITO DE DEMANDA\n\n')
    .t('AL ').e('ORG', juzgado, { nerScope: true }).t('\n\n')
    .t('D./Dña. ').e('PERSON', abogado, { nerScope: true }).t(', Letrado/a colegiado/a ')
    .e('LAWYER_ID', colegiado).t(', del despacho ').e('ORG', despacho, { nerScope: true })
    .t(', en nombre y representación de D./Dña. ').e('PERSON', demandante, { nerScope: true })
    .t(', con DNI ').e('DNI', nif).t(' y domicilio en ').e('ADDRESS', direccion, { nerScope: true })
    .t(`, ${ciudad.cp} ${ciudad.nombre}, `)
    .t('comparece y como mejor proceda en Derecho DICE:\n\n')
    .t('Que por medio del presente escrito formula DEMANDA de reclamación de cantidad contra ')
    .e('PERSON', demandado, { nerScope: true }).t(`, por importe de ${cuantia} €, en base a los siguientes\n\n`)
    .t('HECHOS\n\n')
    .t('PRIMERO. Que las partes suscribieron contrato de prestación de servicios en fecha ')
    .t(`${rng.int(1, 28)}/${rng.int(1, 12)}/${rng.int(2022, 2025)}, sin que el demandado haya `)
    .t('procedido al pago de las cantidades adeudadas pese a los requerimientos efectuados.\n\n')
    .t('Nº de Autos / NIG: ').e('NIG', nig).t('\n\n')
    .t('Por lo expuesto, SUPLICO AL JUZGADO que tenga por presentado este escrito, ')
    .t('lo admita, y dicte sentencia estimando íntegramente la demanda.\n')
  return { id, domain: 'legal', kind: 'demanda', ...b.build() }
}

function genContrato(rng, id) {
  const parteA = randomFullName(rng)
  const parteB = randomFullName(rng)
  const empresa = rng.pick(DESPACHOS)
  const cif = randomCIF(rng)
  const nif = randomNIF(rng)
  const direccion = randomAddress(rng)
  const ciudad = rng.pick(CIUDADES)
  const iban = randomIBAN(rng)
  const importe = rng.int(500, 50000)

  const b = builder()
  b.t('CONTRATO DE PRESTACIÓN DE SERVICIOS\n\n')
    .t('En ').t(ciudad.nombre).t(`, a ${rng.int(1, 28)} de ${rng.pick(['enero', 'marzo', 'junio', 'septiembre', 'noviembre'])} de ${rng.int(2023, 2026)}.\n\n`)
    .t('REUNIDOS\n\n')
    .t('De una parte, D./Dña. ').e('PERSON', parteA, { nerScope: true }).t(', con DNI ').e('DNI', nif)
    .t(' y domicilio en ').e('ADDRESS', direccion, { nerScope: true }).t(`, ${ciudad.cp} ${ciudad.nombre}, en adelante "EL CLIENTE".\n\n`)
    .t('De otra parte, ').e('ORG', empresa, { nerScope: true }).t(', con CIF ').e('CIF', cif)
    .t(', representada en este acto por D./Dña. ').e('PERSON', parteB, { nerScope: true }).t(', en adelante "EL PRESTADOR".\n\n')
    .t('ESTIPULACIONES\n\n')
    .t(`PRIMERA. El PRESTADOR se compromete a prestar servicios de asesoría por un importe de ${importe} €, `)
    .t('pagaderos mediante transferencia a la cuenta ').e('IBAN', iban).t('.\n\n')
    .t('SEGUNDA. El presente contrato tendrá una duración de 12 meses, prorrogables por acuerdo de las partes.\n\n')
    .t('Y en prueba de conformidad, firman el presente contrato por duplicado.\n')
  return { id, domain: 'legal', kind: 'contrato', ...b.build() }
}

function genConsultaAbogado(rng, id) {
  const cliente = randomFullName(rng)
  const abogado = randomFullName(rng)
  const despacho = rng.pick(DESPACHOS)
  const nif = randomNIF(rng)
  const telefono = randomPhone(rng)
  const colegiado = randomColegiado(rng)

  const b = builder()
  b.t('CONSULTA JURÍDICA — PRIVILEGIO ABOGADO-CLIENTE\n\n')
    .t('Cliente: ').e('PERSON', cliente, { nerScope: true }).t('. DNI: ').e('DNI', nif)
    .t('. Teléfono: ').e('PHONE', telefono).t('.\n')
    .t('Letrado: ').e('PERSON', abogado, { nerScope: true }).t(', ').e('LAWYER_ID', colegiado)
    .t(', ').e('ORG', despacho, { nerScope: true }).t('.\n\n')
    .t('Resumen de la consulta: el cliente solicita asesoramiento sobre la viabilidad de una ')
    .t('reclamación por incumplimiento contractual frente a un proveedor, incluyendo plazos de ')
    .t('prescripción aplicables y estrategia procesal recomendada.\n\n')
    .t('Valoración preliminar: se recomienda requerimiento fehaciente previo a la vía judicial, ')
    .t('con plazo de 10 días para respuesta antes de iniciar procedimiento monitorio.\n')
  return { id, domain: 'legal', kind: 'consulta', ...b.build() }
}

function genExpedienteDisciplinario(rng, id) {
  const empleado = randomFullName(rng)
  const responsable = randomFullName(rng)
  const empresa = rng.pick(DESPACHOS)
  const nif = randomNIF(rng)
  const expediente = randomExpediente(rng)
  const iban = randomIBAN(rng)

  const b = builder()
  b.t('EXPEDIENTE DISCIPLINARIO\n\n')
    .t('Expediente nº: ').e('CASE_ID', expediente).t('\n\n')
    .t('Empleado/a: ').e('PERSON', empleado, { nerScope: true }).t('. DNI: ').e('DNI', nif).t('.\n')
    .t('Empresa: ').e('ORG', empresa, { nerScope: true }).t('.\n')
    .t('Responsable de RRHH: ').e('PERSON', responsable, { nerScope: true }).t('.\n')
    .t('Cuenta para liquidación de haberes: ').e('IBAN', iban).t('.\n\n')
    .t('Hechos imputados: incumplimiento reiterado del horario laboral sin justificación, ')
    .t(`constatado en ${rng.int(2, 6)} ocasiones durante el último trimestre.\n\n`)
    .t('Se propone sanción de suspensión de empleo y sueldo por un periodo de ')
    .t(`${rng.int(3, 15)} días, conforme al Estatuto de los Trabajadores art. 58.\n`)
  return { id, domain: 'legal', kind: 'disciplinario', ...b.build() }
}

// ── Assembly ─────────────────────────────────────────────────────────────

const GENERATORS = [
  genInformeClinico, genNotaUrgencias, genInterconsulta,
  genEscritoDemanda, genContrato, genConsultaAbogado, genExpedienteDisciplinario,
]

/**
 * Generates `countPerGenerator` documents from each template, using a seeded RNG
 * so the dataset is reproducible. Returns the full case list (no I/O).
 */
export function generateAll(seed = 20260804, countPerGenerator = 15) {
  const rng = makeRng(seed)
  const cases = []
  let n = 0
  for (const gen of GENERATORS) {
    for (let i = 0; i < countPerGenerator; i++) {
      n++
      const id = `synthetic-${String(n).padStart(3, '0')}`
      cases.push({ ...gen(rng, id), source: 'synthetic' })
    }
  }
  return cases
}

// CLI entry: writes JSON to stdout when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = generateAll()
  process.stdout.write(JSON.stringify(cases, null, 2))
}

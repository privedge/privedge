/**
 * Hand-written adversarial cases — the highest-value part of this dataset.
 *
 * Every case here is deliberately designed to break something specific in the
 * regex-only detector (packages/worker/src/pii.ts). Unlike generate.mjs, these
 * are NOT produced by templates + pools — each one encodes a specific failure
 * mode a human reviewer or attacker would actually produce. The `notes` field
 * on every case documents WHAT it's trying to break; that's the actual
 * deliverable, not decoration.
 *
 * Categories (see CLAUDE.md task brief):
 *   1. indirect-reference — no regex will ever catch these; PII referred to by role/relation
 *   2. malformed-format    — real humans mistype structured IDs
 *   3. ambiguous           — numbers/strings that LOOK like an ID type but aren't (recall trap
 *                            for the detector AND a precision trap — ground truth marks them NOT-PII)
 *   4. hard-name            — surnames that are also common words / place names
 *   5. noisy-context        — PII inside tables, lists, line breaks, expediente formatting
 *   6. negative              — no PII at all; numbers/caps that could false-positive
 *
 * Ground truth uses the SAME shape as generate.mjs: { id, domain, kind, text,
 * entities: [{type, value, start, end}], notes, source: 'adversarial' }.
 * Cases in `ambiguous` and `negative` intentionally have entities: [] for the
 * trap value (it must NOT be flagged) — see notes on each.
 */
import { builder } from './builder.mjs'

const cases = []
let n = 0
function push(domain, kind, category, notes, build) {
  n++
  const { text, entities } = build(builder()).build()
  cases.push({
    id: `adversarial-${String(n).padStart(3, '0')}`,
    domain, kind, category, notes, text, entities, source: 'adversarial',
  })
}

// ── 1. Indirect references ──────────────────────────────────────────────────
// No regex reaches these — they identify a person via role/relation, not a
// structured token. Included so the dataset can eventually score an NER layer
// too; the regex-only runner will correctly report these as "not applicable"
// rather than false negatives (see run-dataset-eval.mjs notes).

push('sanidad', 'nota-urgencias', 'indirect-reference',
  'Patient referred to by room number only — no name, DNI or NHC anywhere in the sentence. Regex has zero surface to match; only an NER/context model could flag "the patient" as a PII-adjacent reference.',
  b => b.t('El paciente de la habitación 302 refiere dolor abdominal desde hace 6 horas, sin fiebre asociada. Se solicita analítica urgente y valoración por cirugía general.'))

push('legal', 'consulta', 'indirect-reference',
  'Client referred to as "mi representado" — common in Spanish legal writing to avoid repeating the name. Zero structured tokens.',
  b => b.t('Mi representado desea conocer las opciones de recurso frente a la resolución notificada la semana pasada, dado que considera que el plazo de alegaciones fue insuficiente.'))

push('legal', 'demanda', 'indirect-reference',
  '"la mercantil demandante" — company referenced by role, not by name. A pure regex has nothing to anchor on.',
  b => b.t('La mercantil demandante sostiene que el incumplimiento contractual le ha ocasionado un perjuicio económico cuantificable, solicitando la resolución del contrato y la correspondiente indemnización.'))

push('legal', 'demanda', 'indirect-reference',
  '"el letrado de la contraparte" — lawyer referenced by role relative to the other party.',
  b => b.t('El letrado de la contraparte solicitó una prórroga de diez días para contestar a la demanda, a lo que esta parte no se opone por razones de cortesía procesal.'))

push('legal', 'disciplinario', 'indirect-reference',
  '"la menor" — minor referenced only by legal category, in a custody/family context. No name, no ID.',
  b => b.t('La menor manifestó ante el equipo psicosocial su preferencia por mantener el régimen de convivencia actual, sin que se apreciaran indicios de manipulación parental.'))

push('sanidad', 'informe-alta', 'indirect-reference',
  '"la interesada" — administrative/medical Spanish convention to refer back to a previously-named person without repeating the name; if used as the ONLY reference in a sentence there is no PII surface at all.',
  b => b.t('La interesada fue derivada a la unidad de rehabilitación tras el alta hospitalaria, con seguimiento programado en un plazo de tres semanas.'))

push('legal', 'consulta', 'indirect-reference',
  '"el cónyuge no custodio" — role-based reference in a family law context.',
  b => b.t('El cónyuge no custodio solicita la modificación del régimen de visitas alegando cambio sustancial de circunstancias laborales.'))

// ── 2. Malformed formats ────────────────────────────────────────────────────
// Real people mistype structured IDs. The DNI pattern in pii.ts is
// /\b[0-9]{8}[-\s]?[A-Z]\b|\b[XYZ][0-9]{7}[-\s]?[A-Z]\b/g — it allows ONE
// optional space/hyphen but nothing else (no dots, no lowercase letter, no
// wrong check letter awareness — it doesn't validate the letter at all,
// meaning a WRONG check letter still matches structurally, which is
// actually correct production behavior: the regex layer isn't a validator).

push('legal', 'consulta', 'malformed-format',
  'NIF written with dots as thousand separators (12.345.678-Z) — a format real people use on paper forms. The regex has no `.` alternative in the separator class, so this should NOT match DNI. This is a genuine recall gap, not a trick.',
  b => b.t('El cliente aportó copia de su DNI ').e('DNI_MALFORMED', '12.345.678-Z', { expectedMatch: false }).t(' para acreditar su identidacd en el expediente.'))

push('sanidad', 'nota-urgencias', 'malformed-format',
  'NIF in lowercase check letter (45678901a) — the pattern requires [A-Z] uppercase only, so a lowercase letter breaks the match entirely.',
  b => b.t('Paciente identificado mediante DNI ').e('DNI_MALFORMED', '45678901a', { expectedMatch: false }).t(' aportado por un familiar en el momento del ingreso.'))

push('legal', 'demanda', 'malformed-format',
  'NIE with no separator and lowercase prefix (x1234567l) — pattern requires uppercase X/Y/Z, so lowercase breaks it.',
  b => b.t('El demandado, identificado con NIE ').e('DNI_MALFORMED', 'x1234567l', { expectedMatch: false }).t(', no compareció a la vista señalada.'))

push('sanidad', 'informe-alta', 'malformed-format',
  'Phone number written with dots as separators everywhere (612.345.678) — regex separator class only covers space/dot/hyphen for the US pattern but the ES pattern lookarounds use [\\s.-] too, so this actually SHOULD match. Included as a format the detector must handle correctly, not a trap.',
  b => b.t('Contacto de emergencia: ').e('PHONE', '612.345.678').t(', disponible las 24 horas.'))

push('legal', 'contrato', 'malformed-format',
  'IBAN written without any spaces (ES9121000418450200051332) — the IBAN pattern requires the 4-char groups to optionally have ONE space between them ([\\s]?), so a fully contiguous IBAN should still match. Sanity check, not a trap.',
  b => b.t('Transferencia a realizar a la cuenta ').e('IBAN', 'ES9121000418450200051332').t(' en un plazo máximo de 10 días hábiles.'))

push('sanidad', 'nota-urgencias', 'malformed-format',
  'NHC written without the hyphen the NHC pattern requires (NHC 2024 8472 with spaces instead of hyphens) — the pii.ts pattern is /\\bMRN[-\\s]?\\d{4,}\\b/gi for MRN but there is NO dedicated NHC pattern in production at all (NHC is a Spanish-healthcare-specific ID the current regex set does not cover). This is a genuine coverage gap, independent of formatting.',
  b => b.t('Historia clínica número ').e('NHC_UNCOVERED', 'NHC 2024 8472', { expectedMatch: false }).t(' localizada en el archivo del servicio.'))

push('legal', 'demanda', 'malformed-format',
  'CIF, no dedicated pattern exists in production (verified: PII_PATTERNS has no CIF-specific entry). CORRECTED after running the eval: this specific value is NOT a clean miss — it gets accidentally swallowed by the PASSPORT pattern (/\\b(?!(?:APP|BC|ID|BK|ACC|REF|TXN|ACCT|CASE|CLT)[-#\\s]?\\d)[A-Z]{1,3}[-\\s]?\\d{6,9}\\b/g), since "B" is not in the excluded-prefix list and 1 letter + 8 digits fits \\d{6,9}. So anonymize() DOES replace it — but tags it PASSPORT, a wrong type, not CIF. Kept as expectedMatch:false because there is still no correct CIF-typed detection; documented here so the false "gap" isn\'t mistaken for a clean miss in the report.',
  b => b.t('La sociedad demandada, con CIF ').e('CIF_UNCOVERED', 'B12345678', { expectedMatch: false }).t(', fue debidamente emplazada.'))

push('legal', 'demanda', 'malformed-format',
  'Referencia catastral — production has zero pattern for this 20-character cadastral reference format at all. Explicit, isolated case per the task brief (this is THE headline example from public-es in scenarios.ts).',
  b => b.t('Se acompaña certificación registral del inmueble con referencia catastral ').e('CATASTRAL_UNCOVERED', '9872023VK6897S0001WX', { expectedMatch: false }).t(' sito en el término municipal.'))

push('sanidad', 'informe-alta', 'malformed-format',
  'Seguridad Social number — production has no dedicated pattern; a 12-digit-with-spaces SSN string like this could ACCIDENTALLY be partially caught by the CARD pattern (\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}) only if grouped in 4s, but the real SSN grouping (2-10-2) does not align — worth checking empirically rather than assuming.',
  b => b.t('Número de afiliación a la Seguridad Social: ').e('SSN_UNCOVERED', '28 1234567890 15', { expectedMatch: false }).t(', aportado para gestión de la incapacidad temporal.'))

push('legal', 'demanda', 'malformed-format',
  'NIG (número de identificación general de procedimiento judicial) — no pattern in production covers this structured judicial ID.',
  b => b.t('Procedimiento seguido con NIG ').e('NIG_UNCOVERED', '28079 1 0234567/2025', { expectedMatch: false }).t(' ante el juzgado decano.'))

push('legal', 'consulta', 'malformed-format',
  'Número de colegiado (bar association ID) — no pattern in production; this identifies a specific lawyer uniquely within their colegio.',
  b => b.t('El letrado actuante, colegiado ').e('LAWYER_ID_UNCOVERED', 'ICAM nº 84213', { expectedMatch: false }).t(', asumió la dirección letrada del asunto.'))

push('legal', 'demanda', 'malformed-format',
  'Phone number written as a single 9-digit run glued to surrounding text with no delimiter at all (contacto:612345678sinespacios) — tests whether the lookaround boundary still holds when there is no whitespace before/after.',
  b => b.t('Contacto directo').e('PHONE', '612345678').t('para notificaciones urgentes.'))

// ── 3. Ambiguity (precision traps — ground truth says NOT PII) ─────────────
// These exist to measure PRECISION, not recall. entities: [] deliberately —
// if the detector fires here, that's a false positive and the runner must
// count it as such (see run-dataset-eval.mjs).

push('legal', 'contrato', 'ambiguous',
  '9-digit reference number that is NOT a phone (does not start with 6/7/8/9 SPANISH mobile/landline prefix pattern semantics — it is an internal invoice sequence number). Starts with 3, so the [6789] anchor should correctly reject it — sanity check that the detector does not over-match all 9-digit runs.',
  b => b.t('Número de expediente interno de facturación: ').t('305817264').t(', sin relación con ningún dato de contacto.'))

push('sanidad', 'informe-alta', 'ambiguous',
  '8-digit + letter sequence that LOOKS like a DNI shape but is a lab sample code, not an identifier of a person (it is prefixed and explicitly labeled as a sample ID, not a personal ID) — structurally the regex WILL match this since it cannot understand context, so we expect a false positive here. That is the point: measuring precision honestly.',
  b => b.t('Código de muestra de laboratorio: ').t('20481537Q').t(', analizada en el laboratorio central del hospital.'))

push('legal', 'consulta', 'ambiguous',
  'A monetary amount formatted as three groups of 3 digits with spaces (185 000 000 pesetas historical reference) could visually resemble a grouped phone number but starts with a "1", failing the [6789] prefix — should NOT match PHONE.',
  b => b.t('El valor histórico de la operación en pesetas ascendía a 185 000 000, cifra mencionada únicamente a efectos de contexto documental.'))

push('sanidad', 'nota-urgencias', 'ambiguous',
  'Vital signs reading formatted as three slash-separated numbers (blood pressure 158/94, heart rate over 3 hours "3/24") could pattern-match DATE (\\d{1,2}/\\d{1,2}/\\d{2,4}) if digits align — here "3/24" (day 3, "month" 24) does NOT satisfy month<=12 semantically but the regex has NO semantic month validation, so this is a genuine expected false positive to document, not prevent.',
  b => b.t('Tensión arterial 158/94 mmHg. Evolución del dolor en escala 3/24 horas transcurridas desde el inicio.'))

push('legal', 'demanda', 'ambiguous',
  'Article/clause citation formatted like an ID (art. 1124 CC, clause "12-3456789" style is NOT used here — instead uses a real statute citation "art. 1902 del Código Civil") which contains no digit run long enough to false-positive on any pattern — included as a true negative sanity check for legal citations specifically.',
  b => b.t('La responsabilidad extracontractual se fundamenta en el artículo 1902 del Código Civil, en relación con el artículo 1101 del mismo texto legal.'))

push('sanidad', 'interconsulta', 'ambiguous',
  'A drug dosage written as "10-2024" (batch/lot number format, month-year style) could resemble a DATE if misread, but here it explicitly reads day-less so the \\d{4}-\\d{2}-\\d{2} pattern needs exactly 3 groups (YYYY-MM-DD) — a 2-group "10-2024" should NOT match that specific pattern (wrong shape), true negative check.',
  b => b.t('Lote de medicación administrado: 10-2024, caducidad verificada antes de la administración.'))

push('legal', 'contrato', 'ambiguous',
  'A percentage-and-figure combo "20-2025" used as a contract clause number (not a date) risks colliding with DATE pattern \\d{1,2}/\\d{1,2}/\\d{2,4} only if slashes are used; here it uses a hyphen in a 2-digit/4-digit shape that does not match either DATE alternative — included to check the hyphen-form is correctly rejected.',
  b => b.t('Conforme a la estipulación 20-2025 del presente contrato, ambas partes quedan vinculadas a sus términos.'))

// ── 4. Hard names ────────────────────────────────────────────────────────────
// Surnames that double as common nouns or place names. The regex layer never
// even attempts PERSON detection (that's NER-only in this codebase), so these
// exist primarily to document that fact clearly and to feed the future NER
// eval. Marked with type PERSON so a future NER runner can reuse this file.

push('sanidad', 'informe-alta', 'hard-name',
  '"Iglesias" as a surname (means "churches") next to actual church/organization vocabulary — worst case for a naive keyword-based NER prompt that might associate the word with a building. Regex-only detector has no PERSON detection at all so this is purely NER-scope, documented for the future NER eval pass.',
  b => b.t('Paciente: ').e('PERSON', 'Pablo Iglesias Casas', { nerScope: true }).t('. Traído por su hijo tras sufrir una caída cerca de la iglesia del barrio.'))

push('legal', 'demanda', 'hard-name',
  '"Prieto" (also means "tight/dark" as an adjective) combined with legal vocabulary using the same root ("apretado", related concept) to stress-test context confusion.',
  b => b.t('Demandante: ').e('PERSON', 'Ana Prieto León', { nerScope: true }).t(', quien alega que el contrato contenía cláusulas redactadas en términos excesivamente apretados y ambiguos.'))

push('sanidad', 'nota-urgencias', 'hard-name',
  '"Casas" (means "houses") as a surname next to references to housing/domicile vocabulary in the same sentence.',
  b => b.t('Paciente: ').e('PERSON', 'Rosa María Casas Torres', { nerScope: true }).t('. Vive sola, sin apoyo familiar cercano; se valora derivación a trabajo social para revisión de las condiciones de su vivienda.'))

push('legal', 'consulta', 'hard-name',
  '"León" as a surname, which is also a Spanish city name (used elsewhere in the address pool) — direct collision risk between PERSON and LOCATION.',
  b => b.t('Cliente: ').e('PERSON', 'Fernando León Blanco', { nerScope: true }).t(', residente actualmente en la ciudad de León, consulta sobre un litigio de herencias.'))

push('sanidad', 'interconsulta', 'hard-name',
  '"Santos" surname colliding with the religious/calendar-date vocabulary ("día de Todos los Santos") mentioned in the same note.',
  b => b.t('Paciente: ').e('PERSON', 'Carmen de los Santos Ruiz', { nerScope: true }).t('. Ingreso programado para el día siguiente al de Todos los Santos, festivo local.'))

push('legal', 'demanda', 'hard-name',
  '"Iglesia" (singular, no plural-s) as part of a compound surname next to a demandado that is literally a religious institution — maximal ambiguity for any organization-name heuristic.',
  b => b.t('Actor: ').e('PERSON', 'Manuel de la Iglesia Gómez', { nerScope: true }).t(', frente a la Parroquia de Santa María como demandada.'))

push('sanidad', 'informe-alta', 'hard-name',
  'Compound surname with particle "Fernández-Gómez de la Serna" — long multi-token span the exact form named in the task brief ("María del Carmen Fernández-Gómez de la Serna"), stress-tests span boundaries for a future NER pass.',
  b => b.t('Paciente: ').e('PERSON', 'María del Carmen Fernández-Gómez de la Serna', { nerScope: true }).t(', ingresada para control postoperatorio tras intervención programada.'))

// ── 5. Noisy context ─────────────────────────────────────────────────────────
// PII embedded in tables, lists, line-break-heavy formatting.

push('sanidad', 'informe-alta', 'noisy-context',
  'DNI and phone inside a pipe-delimited table row — tests whether the [-\\s]? separator tolerance in the DNI pattern survives being flanked by table pipes with no padding space.',
  b => b.t('| Campo | Valor |\n|---|---|\n| Paciente | ').e('PERSON', 'Teresa Moreno Gil', { nerScope: true }).t(' |\n| DNI |').e('DNI', '87654321X').t('|\n| Teléfono |').e('PHONE', '699887766').t('|\n'))

push('legal', 'demanda', 'noisy-context',
  'NIF broken across a line wrap (line ends right after the 8 digits, hyphen and check letter start the next line) — a naive extraction pipeline that reads line-by-line would split this. Confirmed empirically 2026-08-05: the DNI pattern\'s [-.\\s]{0,2} separator class includes \\n, so the detector captures the WHOLE identifier across the wrap, which is the correct production behaviour. Ground truth labels the full span accordingly.',
  b => b.t('El demandante, con DNI número ').e('DNI', '12345678\n-Z').t(' según consta en autos, presenta el presente escrito.'))

push('legal', 'contrato', 'noisy-context',
  'List of multiple parties each with their own DNI, formatted as a numbered list — tests that overlap-resolution in detectPII() does not accidentally merge or skip adjacent entities across list items.',
  b => b.t('Partes firmantes:\n')
    .t('1. ').e('PERSON', 'Javier Ortega Blanco', { nerScope: true }).t(', DNI ').e('DNI', '11223344B').t('\n')
    .t('2. ').e('PERSON', 'Beatriz Suárez Molina', { nerScope: true }).t(', DNI ').e('DNI', '55667788C').t('\n')
    .t('3. ').e('PERSON', 'Ramón Gil Herrero', { nerScope: true }).t(', DNI ').e('DNI', '99001122D').t('\n'))

push('sanidad', 'interconsulta', 'noisy-context',
  'Expediente-style header block with field:value pairs stacked with no blank lines between them and inconsistent colon spacing — tests robustness against irregular whitespace immediately before the ID value.',
  b => b.t('PACIENTE:').e('PERSON', 'Julia Navarro Campos', { nerScope: true }).t('\nNHC:').e('NHC', 'NHC-2025-3391').t('\nTELF:').e('PHONE', '688442211').t('\nCENTRO:').e('ORG', 'Hospital Clínico San Carlos', { nerScope: true }).t('\n'))

push('legal', 'disciplinario', 'noisy-context',
  'IBAN split across two lines by a hard line-break between digit groups (common when copy-pasting from a PDF). Confirmed empirically 2026-08-05: the group separator matches \\n as well as a space, so the detector captures the WHOLE IBAN across the wrap — better than this case originally anticipated (it was documented as an expected miss). Ground truth labels the full span as a real IBAN.',
  b => b.t('Cuenta de abono: ').e('IBAN', 'ES91 2100 0418 4502\n0005 1332').t(' según los datos facilitados por el empleado.'))

push('sanidad', 'nota-urgencias', 'noisy-context',
  'Multiple phone numbers in a contact list separated only by semicolons with no space — tests the phone pattern negative lookaround (?!\\d) does not spill across the semicolon into the next number.',
  b => b.t('Teléfonos de contacto: ').e('PHONE', '612345678').t(';').e('PHONE', '698765432').t(';').e('PHONE', '655112233').t('.\n'))

// ── 6. Negatives (false-positive traps) ─────────────────────────────────────
// No PII at all. Numbers and capitals that COULD trigger a naive detector.

push('legal', 'consulta', 'negative',
  'Case law citation with a 4-digit year and article numbers — no PII, but numeric-heavy legal citation style.',
  b => b.t('La Sentencia del Tribunal Supremo 1234/2019, de 15 de marzo, establece un criterio interpretativo relevante en materia de responsabilidad civil contractual, en línea con la STS 567/2021.'))

push('sanidad', 'informe-alta', 'negative',
  'Vital signs and lab values only — numeric-dense clinical text with zero identifying information.',
  b => b.t('Constantes al alta: TA 128/76 mmHg, FC 72 lpm, SatO2 98%, Tª 36.4ºC. Analítica: hemoglobina 14.2 g/dL, leucocitos 7800/mm³, creatinina 0.9 mg/dL, todos los valores dentro de rango normal.'))

push('legal', 'contrato', 'negative',
  'Generic contract boilerplate clause numbers and percentages — no names, no IDs, no addresses.',
  b => b.t('La cláusula 4.2 establece una penalización del 5% mensual sobre el importe pendiente en caso de demora superior a 30 días, acumulable hasta un máximo del 20% del principal adeudado.'))

push('sanidad', 'nota-urgencias', 'negative',
  'Triage protocol description with room/bed numbers used generically (not tied to a specific patient) and dosage figures.',
  b => b.t('Protocolo de triaje nivel 3: reevaluación cada 60 minutos. Box de observación con capacidad para 12 pacientes. Dosis estándar de paracetamol 1g/8h vía oral si no hay contraindicación.'))

push('legal', 'demanda', 'negative',
  'Statute references and procedural deadlines only (Ley de Enjuiciamiento Civil articles, days) — no party-identifying information in this excerpt.',
  b => b.t('De conformidad con el artículo 399 y siguientes de la Ley de Enjuiciamiento Civil, el plazo de contestación a la demanda es de veinte días hábiles desde el emplazamiento, siendo el 138 el precepto aplicable a la subsanación de defectos procesales.'))

push('sanidad', 'interconsulta', 'negative',
  'Equipment/device model numbers only (ECG machine model, catalog references) — alphanumeric codes that are NOT personal identifiers.',
  b => b.t('Ecógrafo modelo GE Vivid E95, sonda cardíaca M5Sc, calibración registrada en el sistema de mantenimiento con referencia de equipo EQ-4471, revisión anual pendiente para el próximo trimestre.'))

push('legal', 'disciplinario', 'negative',
  'Company-wide policy reference numbers and generic role titles — no individual named or identified.',
  b => b.t('Según la política interna PN-2024-018 sobre régimen disciplinario, los responsables de área deberán documentar cualquier incidencia en el plazo de 48 horas desde su conocimiento, remitiendo el informe correspondiente a Recursos Humanos.'))

push('sanidad', 'informe-alta', 'negative',
  'Postal/ZIP code alone without street or name — a 5-digit number that could superficially resemble part of an ID but is explicitly just a CP with no other component.',
  b => b.t('El centro de salud de referencia para su código postal corresponde a la zona básica de salud número 7, con horario de atención de 8:00 a 20:00 de lunes a viernes.'))

// ── Additional volume across categories to reach the 200-300 target ────────
// Same rigor, more surface area per category: more phone formats, more DNI/NIE
// malformations, more hard-name collisions, more noisy layouts. Grouped by
// category so counts stay auditable.

// -- more malformed-format: NIF/NIE/phone edge cases --
const malformedPhones = [
  ['612 345678', 'PHONE', true, 'Mixed grouping (3-6) not in the pattern\'s explicit alternatives — pattern only defines 3-3-3, 3-2-2-2, 2-3-2-2 and contiguous; a 3-6 split falls between alternatives and should NOT match as a whole span (may partially match contiguous 6-digit remainder is not \\b-bounded though).'],
  ['612345.678', 'PHONE', true, 'Dot used as sole separator mid-number, non-standard grouping — pattern separator class includes . so groups of 3+3 with a dot could still match depending on exact split; included to verify empirically rather than assume.'],
  ['0034612345678', 'PHONE', true, 'Full "00" international prefix with NO separator before the national number — pattern allows (?:\\+|00)34[\\s.-]? which permits zero separators, so this should match.'],
  ['612 34 5678', 'PHONE', true, 'Uneven grouping 3-2-4 not covered by any of the three grouped alternatives (only 3-3-3, 3-2-2-2, 2-3-2-2 exist) — expected miss as a WHOLE span.'],
]
for (const [value, type, expectedMatch, note] of malformedPhones) {
  push('legal', 'consulta', 'malformed-format', note,
    b => b.t('Puede contactar con el interesado en el número ').e(type, value, { expectedMatch }).t(' en horario de mañana.'))
}

const malformedDnis = [
  ['12345678 Z', 'DNI_MALFORMED', true, 'Space instead of hyphen before check letter — pattern explicitly allows [-\\s]? so this SHOULD match; sanity check, not a trap.'],
  ['12345678-z', 'DNI_MALFORMED', false, 'Lowercase check letter — pattern requires [A-Z] uppercase only, breaks the match.'],
  ['x-1234567-l', 'DNI_MALFORMED', false, 'NIE prefix separated from digits by a hyphen (X-1234567-L) — pattern requires prefix immediately adjacent to digits with no separator between letter and digit block, only between block and check letter; the leading hyphen after X breaks it, and lowercase compounds the miss.'],
  ['12345678', 'DNI_MALFORMED', false, 'DNI number with the check letter omitted entirely — common when someone copies only the numeric part off a form. No letter means the pattern (which requires the trailing [A-Z]) cannot match at all.'],
  ['DNI: 12345678-Ñ', 'DNI_MALFORMED', false, 'Invalid check letter Ñ (not a real DNI letter, typo/OCR artifact) — since [A-Z] as a character class does not include Ñ in JS regex (it is outside the ASCII A-Z range), this breaks the match — different failure mode than a wrong-but-valid-range letter.'],
]
for (const [value, type, expectedMatch, note] of malformedDnis) {
  push('sanidad', 'nota-urgencias', 'malformed-format', note,
    b => b.t('Documento de identidad aportado: ').e(type, value, { expectedMatch }).t(', pendiente de verificación por el personal administrativo.'))
}

// -- more ambiguous: ID-shaped non-PII across both domains --
const ambiguousNumbers = [
  ['expediente número 45678901', 'a 8-digit number with no trailing letter at all — cannot match DNI pattern (which requires the check letter), included as a true negative for a plain long number.'],
  ['referencia de pedido AB-123456', 'a 2-letter + 6-digit code shaped like the PASSPORT pattern ([A-Z]{1,3}[-\\s]?\\d{6,9}) which explicitly EXCLUDES known prefixes (APP, BC, ID, BK, ACC, REF, TXN, ACCT, CASE, CLT) via negative lookahead — "AB" is not in that exclusion list, so this SHOULD still match PASSPORT structurally. Included to verify the exclusion list is not accidentally too broad or too narrow.'],
  ['código de barras 5901234123457', 'a 13-digit EAN barcode number — too long for any single pattern (CARD needs exactly 4x4, IBAN needs a 2-letter country prefix) so it should not match anything.'],
]
for (const [phrase, note] of ambiguousNumbers) {
  push('legal', 'contrato', 'ambiguous', note,
    b => b.t(`Se hace constar el ${phrase} a efectos meramente administrativos, sin relación con datos de carácter personal.`))
}

// -- more hard-name collisions (documented as NER-scope, regex has no PERSON detection) --
const hardNames = [
  ['Cristina Iglesias Vega', 'una reunión celebrada en la sede de la organización, no en ninguna iglesia'],
  ['Diego Casas Prieto', 'la revisión del expediente de la vivienda, que resultó estar en buen estado'],
  ['Alba León Iglesias', 'un litigio sobre una finca situada en la provincia de León'],
  ['Raúl Santos Casas', 'la festividad de Todos los Santos, día en que se produjeron los hechos'],
]
for (const [name, contextPhrase] of hardNames) {
  push('sanidad', 'informe-alta', 'hard-name',
    `Surname/common-word collision: "${name}" mentioned alongside "${contextPhrase}" — regex-only detector has no PERSON pattern at all, so this is purely NER-scope; documented for the future NER eval, not scored by run-dataset-eval.mjs.`,
    b => b.t('Referencia: ').e('PERSON', name, { nerScope: true }).t(`, en relación con ${contextPhrase}.`))
}

// -- more noisy-context: additional layout stress tests --
push('legal', 'demanda', 'noisy-context',
  'ALL CAPS header block (common in Spanish court filing cover pages) with DNI embedded — tests case-insensitivity is not accidentally required (pattern for DNI has no /i flag issue since digits/letters are case literal, but ORG names in caps could confuse a future NER layer).',
  b => b.t('JUZGADO DE PRIMERA INSTANCIA. DEMANDANTE: ').e('PERSON', 'ROBERTO MARTÍN IGLESIAS', { nerScope: true }).t('. DNI: ').e('DNI', '33445566E').t('. PROCEDIMIENTO ORDINARIO.\n'))

push('sanidad', 'nota-urgencias', 'noisy-context',
  'PII value immediately followed by punctuation with no space (DNI12345678Bseguido) — tests whether \\b word boundary correctly anchors even when the following character is a lowercase letter that would otherwise extend the match token.',
  b => b.t('Identificado mediante DNI').e('DNI', '12345678B').t('seguido de verificación visual del documento físico.'))

push('legal', 'contrato', 'noisy-context',
  'Table with misaligned columns using tabs instead of consistent spacing — IBAN and phone in adjacent cells.',
  b => b.t('Titular\tIBAN\tTeléfono\n').e('PERSON', 'Cristina Vega Romero', { nerScope: true }).t('\t').e('IBAN', 'ES55 0049 1500 0512 3456').t('\t').e('PHONE', '911223344').t('\n'))

// ── Volume expansion ─────────────────────────────────────────────────────────
// Same categories, more instances, driven by a seeded RNG over pools.mjs so
// values vary (different NIFs, phones, names) while the sentence STRUCTURE and
// the failure mode being tested stay hand-designed per block below. This is
// how the dataset reaches the 200-300 case target from the task brief without
// turning into unlabeled noise — every block documents exactly one failure mode.
import { makeRng, randomFullName, randomPhone, randomNIF, randomNIE, randomIBAN } from './pools.mjs'
const rng2 = makeRng(9182736)

// -- malformed-format: NIF with dots, in bulk, across both domains --
const dotFrasesLegal = [
  'aportó copia de su documento de identidad', 'figura identificado en el encabezado del escrito',
  'consta como titular del expediente', 'firmó el poder notarial correspondiente',
  'fue citado formalmente para la comparecencia', 'presentó alegaciones en el plazo concedido',
]
const dotFrasesSanidad = [
  'fue registrado al ingreso con dicho documento', 'aportó tarjeta sanitaria y DNI en admisión',
  'consta en el volante de derivación', 'firmó el consentimiento informado',
  'fue identificado por el familiar acompañante', 'figura en el listado de pacientes del turno',
]
for (let i = 0; i < 14; i++) {
  const num = rng2.int(10000000, 99999999)
  const digits = String(num)
  const dotted = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}-${'TRWAGMYFPDXBNJZSQVHLCKE'[num % 23]}`
  const domain = i % 2 === 0 ? 'legal' : 'sanidad'
  const kind = domain === 'legal' ? 'consulta' : 'nota-urgencias'
  const frase = domain === 'legal' ? rng2.pick(dotFrasesLegal) : rng2.pick(dotFrasesSanidad)
  push(domain, kind, 'malformed-format',
    'NIF with dot separators between digit groups (dotted thousands, e.g. 12.345.678-Z) — a format Spanish forms and older paper documents commonly print. The DNI pattern separator class is [-\\s]? only (hyphen or single space), no dot alternative, so this is a genuine and repeatable recall gap, not an isolated edge case.',
    b => b.t('El interesado, con documento ').e('DNI_MALFORMED', dotted, { expectedMatch: false }).t(`, ${frase}.`))
}

// -- malformed-format: NIE with space between letter prefix and digits --
for (let i = 0; i < 10; i++) {
  const prefix = rng2.pick(['X', 'Y', 'Z'])
  const num = rng2.int(1000000, 9999999)
  const prefixMap = { X: 0, Y: 1, Z: 2 }
  const letter = 'TRWAGMYFPDXBNJZSQVHLCKE'[(prefixMap[prefix] * 10000000 + num) % 23]
  const spaced = `${prefix} ${num} ${letter}`
  push('legal', 'demanda', 'malformed-format',
    'NIE with a space between the X/Y/Z prefix letter and the digit block ("X 1234567 L") — the pattern requires the prefix immediately adjacent to the digits (\\b[XYZ][0-9]{7}...), no separator allowed there, only before the trailing check letter. A space in that specific position breaks the match even though the format looks reasonable to a human.',
    b => b.t('El extranjero demandado, identificado mediante NIE ').e('DNI_MALFORMED', spaced, { expectedMatch: false }).t(', reside en territorio nacional desde hace cinco años.'))
}

// -- malformed-format: more phone variants (missing digit, extra digit, mixed separators) --
const phoneNoteShort = 'Phone number with only 8 digits (one short of the required 9) — a common typo when transcribing by hand. None of the pattern alternatives match an 8-digit run bounded correctly, so this is an unambiguous miss, not a boundary case.'
const phoneNoteLong = 'Phone number with 10 digits (one extra, e.g. a doubled digit typo) — the trailing (?!\\d) negative lookahead means the pattern will still find a 9-digit substring UNLESS greedy alternation consumes differently; worth verifying which 9 digits (if any) get matched rather than assuming total failure.'
const phoneNoteMixedSep = 'Phone with mixed separators within the same number (space then hyphen: 612 345-678) — the pattern alternatives require a CONSISTENT separator across all groups (same [\\s.-] character is not enforced to repeat, actually each group boundary matches the class independently) so this needs empirical verification rather than assumption.'
for (let i = 0; i < 8; i++) {
  const shortNum = String(rng2.pick(['6', '7'])) + Array.from({ length: 7 }, () => rng2.int(0, 9)).join('')
  push('sanidad', 'informe-alta', 'malformed-format', phoneNoteShort,
    b => b.t('Teléfono de contacto facilitado: ').e('PHONE_MALFORMED', shortNum, { expectedMatch: false }).t(', pendiente de confirmar con el paciente.'))
}
for (let i = 0; i < 6; i++) {
  const first = rng2.pick(['6', '7'])
  const longNum = first + Array.from({ length: 9 }, () => rng2.int(0, 9)).join('')
  push('sanidad', 'nota-urgencias', 'malformed-format', phoneNoteLong,
    b => b.t('Número de contacto: ').e('PHONE_MALFORMED', longNum, { expectedMatch: false }).t(' (verificar dígitos con el familiar).'))
}
for (let i = 0; i < 6; i++) {
  const first = rng2.pick(['6', '7'])
  const rest = Array.from({ length: 8 }, () => rng2.int(0, 9))
  const mixed = `${first}${rest[0]}${rest[1]} ${rest[2]}${rest[3]}${rest[4]}-${rest[5]}${rest[6]}${rest[7]}`
  push('legal', 'consulta', 'malformed-format', phoneNoteMixedSep,
    b => b.t('Se puede localizar al cliente en el ').e('PHONE', mixed).t(' durante el horario laboral.'))
}

// -- ambiguous: more precision traps across both domains --
const ambiguousExtra = [
  ['la factura número 782910345 emitida el trimestre pasado', 'a 9-digit invoice number starting with "7" — falls inside the [6789] prefix class the PHONE pattern uses, so structurally it WILL match as if it were a mobile number even though it is an invoice sequence. This is an expected false positive to document, not a dataset error — the regex cannot know the semantic context.'],
  ['el número de serie 823456712 del equipo médico', 'a 9-digit equipment serial number starting with "8" — same [6789] prefix collision as above, different domain (sanidad-style device serial vs legal invoice), included to confirm the false positive is consistent across contexts rather than a fluke of one phrasing.'],
  ['el código de lote L-2025-04471 del producto sanitario', 'lot code with letter+year+number shape — does not match PASSPORT (requires 1-3 letters directly adjacent to 6-9 digits, but here "L" is separated from "2025" by a hyphen and "2025" is only 4 digits) nor ID (prefix list does not include "L"), true negative check.'],
  ['la referencia bibliográfica ISBN 978-84-9993-456-1', 'ISBN number — contains a 3-digit/2-digit/4-digit/3-digit/1-digit hyphenated shape that does not align with DNI, PHONE, CARD or IBAN group sizes; true negative for a very number-dense but non-personal string.'],
]
for (const [phrase, note] of ambiguousExtra) {
  push(rng2.bool() ? 'legal' : 'sanidad', 'consulta', 'ambiguous', note,
    b => b.t(`Se hace referencia a ${phrase}, sin que ello implique el tratamiento de datos personales identificativos.`))
}

// -- hard-name: more surname/common-word collisions, varied sentence shapes --
const hardNameExtra = [
  ['Marta Iglesias Santos', 'sanidad', 'el traslado se coordinó con la parroquia local para el funeral, sin relación con la paciente'],
  ['Jorge Casas León', 'legal', 'la vivienda objeto de litigio se encuentra en la provincia de León'],
  ['Elena Prieto Iglesias', 'sanidad', 'el vendaje quedó demasiado prieto y hubo que aflojarlo en la siguiente cura'],
  ['Andrés León Casas', 'legal', 'el contrato de arrendamiento de la casa fue firmado el año pasado'],
  ['Lucía Santos Iglesias', 'legal', 'la vista se señaló para el día de Todos los Santos, festivo en varias provincias'],
  ['Pablo Casas Iglesias', 'sanidad', 'fue derivado a una casa de acogida tras el alta médica'],
  ['Nuria Iglesias León', 'legal', 'la sociedad demandada tiene su domicilio social en León capital'],
]
for (const [name, domain, contextPhrase] of hardNameExtra) {
  const kind = domain === 'legal' ? 'demanda' : 'nota-urgencias'
  push(domain, kind, 'hard-name',
    `Surname/common-word collision: "${name}" mentioned in a sentence where the SAME root word appears again with its literal (non-surname) meaning — "${contextPhrase}". Regex-only detector has no PERSON pattern, so this is NER-scope only; documented for a future NER eval pass, not scored by run-dataset-eval.mjs.`,
    b => b.t('Referido: ').e('PERSON', name, { nerScope: true }).t(`. En el mismo documento se menciona que ${contextPhrase}.`))
}

// -- noisy-context: more layout stress across domains --
for (let i = 0; i < 6; i++) {
  const name = randomFullName(rng2)
  const nif = randomNIF(rng2)
  const phone = randomPhone(rng2)
  push('sanidad', 'interconsulta', 'noisy-context',
    'CSV-style single-line record (comma-separated fields, no labels) as sometimes pasted from a spreadsheet export — tests detection with zero surrounding natural-language context to anchor on.',
    b => b.t('registro,').e('PERSON', name, { nerScope: true }).t(',').e('DNI', nif).t(',').e('PHONE', phone).t(',activo\n'))
}
for (let i = 0; i < 6; i++) {
  const name = randomFullName(rng2)
  const iban = randomIBAN(rng2)
  push('legal', 'contrato', 'noisy-context',
    'PII value wrapped in parentheses immediately adjacent to other punctuation ((IBAN:ES9121000418450200051332),) — tests that the trailing \\b boundary in the IBAN pattern is not defeated by a closing paren immediately followed by more punctuation.',
    b => b.t('El pago se realizará a favor de ').e('PERSON', name, { nerScope: true }).t(' (cuenta:').e('IBAN', iban).t('),').t(' según lo pactado.'))
}

// -- indirect-reference: more role/relation-only mentions, both domains --
const indirectRefsLegal = [
  'El arrendador solicita el desahucio por impago reiterado de las últimas cuatro mensualidades.',
  'La parte recurrente insiste en que el plazo de interposición del recurso no había precluido.',
  'El testigo presencial declaró no reconocer a ninguno de los implicados en el momento de los hechos.',
  'El perito designado por el juzgado emitirá su informe en un plazo no superior a treinta días.',
  'La administradora concursal presentó el informe provisional dentro del plazo legalmente establecido.',
  'El heredero forzoso impugna la partición por considerarla lesiva para sus derechos legitimarios.',
  'El avalista fue requerido de pago tras el impago del deudor principal.',
  'La víctima se personó como acusación particular en el procedimiento penal.',
]
const indirectRefsSanidad = [
  'El acompañante refiere que los síntomas comenzaron hace aproximadamente ocho horas.',
  'La enfermera de turno registró las constantes cada cuatro horas sin incidencias.',
  'El facultativo de guardia decidió no proceder al ingreso dado el buen estado general.',
  'La cuidadora principal expresó preocupación por la falta de apetito en los últimos días.',
  'El familiar de primer grado autorizó la intervención quirúrgica de urgencia.',
  'El paciente trasladado desde otro centro llegó estable y sin precisar soporte ventilatorio.',
  'La residente de segundo año presentó el caso en la sesión clínica de la mañana.',
]
for (const text of indirectRefsLegal) push('legal', 'consulta', 'indirect-reference',
  'Role/relation-only reference with zero structured PII surface — no name, no ID, no address, nothing a regex could anchor on. Included in volume because this category is qualitatively different from the others: it is not a formatting edge case, it is proof that an entire class of real documents carries zero regex-detectable PII while still discussing a specific real person.',
  b => b.t(text))
for (const text of indirectRefsSanidad) push('sanidad', 'nota-urgencias', 'indirect-reference',
  'Role/relation-only reference with zero structured PII surface, healthcare register — same rationale as the legal-domain block above.',
  b => b.t(text))

// -- ambiguous: more precision traps, higher volume --
const ambiguousBulk = [
  ['el turno de guardia número 4567890 asignado para el fin de semana', 'a 7-digit shift/roster number — too short for DNI (needs 8) or PHONE (needs 9), too short for IBAN/CARD groupings; true negative for a short numeric code.'],
  ['la partida presupuestaria 6789-2025 del ejercicio en curso', 'budget line item formatted digits-hyphen-year — 4 digits then hyphen then 4-digit year does not match DATE (\\d{1,2}/\\d{1,2}/\\d{2,4} requires slashes, and the \\d{4}-\\d{2}-\\d{2} alternative requires exactly 4-2-2 digit groups, not 4-4), true negative.'],
  ['el kilometraje registrado, 789456 km, en el momento del siniestro', 'a 6-digit odometer reading — one digit short of the minimum for PASSPORT (needs 6-9 but also requires 1-3 leading letters) and not matching any other pattern shape; true negative for a bare digit run under any letter-anchored pattern.'],
  ['el número de colegiado profesional 84213, sin prefijo de colegio', 'a bare 5-digit number with no letter prefix at all (unlike the LAWYER_ID_UNCOVERED case which includes "ICAM nº") — too short for DNI, no letter for PASSPORT, true negative for a bare short number.'],
  ['el código postal 28045 del domicilio social', 'a 5-digit postal code — half the length needed for DNI (8 digits), not matching any pattern; true negative confirming postal codes alone never false-positive.'],
  ['la cantidad de 612345 euros reclamada en el procedimiene', 'a 6-digit monetary amount that happens to start with "6" (the mobile-phone prefix digit) but is only 6 digits long, one short of the 9 the PHONE pattern requires — true negative confirming short amounts starting with 6/7/8/9 do not accidentally match.'],
]
for (const [phrase, note] of ambiguousBulk) {
  const domain = rng2.bool() ? 'legal' : 'sanidad'
  push(domain, domain === 'legal' ? 'contrato' : 'interconsulta', 'ambiguous', note,
    b => b.t(`Consta ${phrase}, dato de naturaleza puramente administrativa y no identificativo.`))
}

// -- malformed-format: more uncovered sectorial ID types, varied phrasing --
const uncoveredIds = [
  ['CIF', () => { const l = rng2.pick(['B', 'A', 'P']); const num = rng2.int(1000000, 9999999); return `${l}${num}${'JABCDEFGHI'[((10 - ((num % 10) || 10)) % 10)]}` }, 'CIF_UNCOVERED', 'Company tax ID (CIF) — production regex has no CIF pattern whatsoever (only the combined DNI/NIE pattern exists for individuals). Every CIF in this dataset is therefore an unconditional miss regardless of formatting; included multiple times with different org-type letters to make the gap unambiguous across variations.'],
  ['referencia catastral', () => { const d1 = Array.from({length:7},()=>rng2.int(0,9)).join(''); const l = Array.from({length:2},()=>String.fromCharCode(65+rng2.int(0,25))).join(''); const d2 = Array.from({length:5},()=>rng2.int(0,9)).join(''); const c = Array.from({length:4},()=>rng2.bool()?String.fromCharCode(65+rng2.int(0,25)):String(rng2.int(0,9))).join(''); return `${d1}${l}${d2}${c}` }, 'CATASTRAL_UNCOVERED', 'Cadastral reference — 20-char alphanumeric format with zero coverage in production. This is the exact entity type called out in the task brief (the public-es scenario ground truth omits it). Included repeatedly because it is the headline finding, not a footnote.'],
  ['NIG', () => { const prov = String(rng2.int(1,52)).padStart(2,'0'); const mun = String(rng2.int(1,999)).padStart(4,'0'); const jur = rng2.pick(['C','S','P']); const orden = String(rng2.int(1,999999)).padStart(6,'0'); return `${prov}${mun} ${jur} ${orden}/${rng2.int(2020,2026)}` }, 'NIG_UNCOVERED', 'Judicial case NIG — structured court-procedure identifier, no pattern in production covers this shape at all.'],
  ['número de colegiado', () => `${rng2.pick(['ICAM','ICAB','ICAV','ICAS'])} nº ${rng2.int(10000,99999)}`, 'LAWYER_ID_UNCOVERED', 'Bar association membership number — uniquely identifies a specific lawyer, zero pattern coverage in production.'],
]
for (const [label, gen, type, note] of uncoveredIds) {
  for (let i = 0; i < 5; i++) {
    const value = gen()
    push('legal', 'demanda', 'malformed-format', note,
      b => b.t(`Se hace constar ${label} `).e(type, value, { expectedMatch: false }).t(' a los efectos oportunos del presente procedimiento.'))
  }
}

// -- negative: more false-positive-shaped clean text, higher volume --
const negativeBulk = [
  'El plazo de garantía del producto es de 24 meses desde la fecha de compra, conforme a la normativa vigente de consumidores y usuarios.',
  'La reunión del comité de seguimiento se celebrará trimestralmente, con un quórum mínimo del 60% de los miembros convocados.',
  'El protocolo establece un tiempo máximo de espera de 15 minutos en la sala de triaje antes de la primera valoración médica.',
  'La cláusula de confidencialidad tendrá una vigencia de 5 años tras la finalización del contrato, con una penalización disuasoria en caso de incumplimiento.',
  'El informe epidemiológico semanal reporta una incidencia de 42 casos por cada 100.000 habitantes en la región, sin desglose individual de pacientes.',
  'La normativa interna exige la renovación del certificado de formación continuada cada 3 años para todo el personal facultativo.',
  'El presupuesto asignado a la partida de mantenimiento asciende a 18.500 euros para el presente ejercicio fiscal.',
  'La sala de espera dispone de 40 asientos distribuidos en dos plantas, con un sistema de llamada por turnos numerados.',
]
for (const text of negativeBulk) {
  const domain = rng2.bool() ? 'legal' : 'sanidad'
  push(domain, domain === 'legal' ? 'contrato' : 'informe-alta', 'negative',
    'Numeric-dense clean text with no PII of any kind — percentages, durations, quantities, generic thresholds. True negative volume to make the precision denominator meaningful (a handful of negatives cannot reliably estimate false-positive rate).',
    b => b.t(text))
}

// -- noisy-context: more layout stress, higher volume --
for (let i = 0; i < 5; i++) {
  const name = randomFullName(rng2)
  const nie = randomNIE(rng2)
  push('legal', 'disciplinario', 'noisy-context',
    'PII value split by a soft-wrap-induced double space (common artifact of copy-pasting justified text from a PDF) — tests whether an unexpected double space inside the separator position still falls within the [-\\s]? single-character class (it should NOT, since the class matches exactly one character).',
    b => b.t('Empleado: ').e('PERSON', name, { nerScope: true }).t(', identificado con NIE ').e('DNI_MALFORMED_DBLSPACE', nie.replace(/^([XYZ]\d+)(\w)$/, '$1  $2'), { expectedMatch: false }).t(' según su contrato laboral.'))
}
for (let i = 0; i < 5; i++) {
  const name = randomFullName(rng2)
  const phone = randomPhone(rng2, 'grouped2222')
  push('sanidad', 'nota-urgencias', 'noisy-context',
    'PII inside a parenthetical aside mid-sentence, natural prose rather than a labeled field — tests detection without any "Teléfono:" style label immediately preceding the value.',
    b => b.t('Se contactó con un familiar (').e('PERSON', name, { nerScope: true }).t(', localizable en el ').e('PHONE', phone).t(') para informar de la evolución.'))
}

// -- malformed-format: IBAN and card edge cases --
for (let i = 0; i < 5; i++) {
  const iban = randomIBAN(rng2).replace(/ /g, '-')
  push('legal', 'contrato', 'malformed-format',
    'IBAN with hyphens instead of spaces between groups (ES91-2100-0418-4502-0005-1332) — the pattern separator is [\\s]? only (whitespace, optional), no hyphen alternative for IBAN specifically (unlike DNI/PHONE which do allow hyphens). This is a real format gap: people who are used to hyphenated card/ID formats sometimes apply the same convention to IBANs.',
    b => b.t('Los pagos se domiciliarán en la cuenta ').e('IBAN_MALFORMED', iban, { expectedMatch: false }).t(' a nombre del prestador de servicios.'))
}
for (let i = 0; i < 4; i++) {
  const groups = Array.from({ length: 4 }, () => String(rng2.int(1000, 9999)))
  const card = groups.join('.')
  push('sanidad', 'informe-alta', 'malformed-format',
    'Payment/insurance card number with dots instead of spaces or hyphens between the 4-digit groups (1234.5678.9012.3456) — CARD pattern separator class is [\\s-]? only, no dot alternative, so this is a genuine miss.',
    b => b.t('Tarjeta de la mutua asociada al expediente: ').e('CARD_MALFORMED', card, { expectedMatch: false }).t(', verificar vigencia antes de facturar.'))
}

export { cases }

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(cases, null, 2))
}

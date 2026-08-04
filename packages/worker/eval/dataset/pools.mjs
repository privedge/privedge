/**
 * Data pools for the synthetic Spanish PII eval dataset. Hand-written, no Faker —
 * the repo keeps deps minimal (see packages/worker/eval/README.md conventions).
 * 40-60 values per pool; combinatoria across pools gives plenty of variety without
 * needing a generator dependency.
 *
 * All names/entities are INVENTED. No real people, no valid real-world NIF/CIF
 * belonging to anyone — check letters are computed correctly (see nifLetter below)
 * but the 8-digit bodies are arbitrary, not sampled from real assignments.
 */

// ── Check-letter algorithms ─────────────────────────────────────────────────

const CONTROL_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

/** NIF check letter: letter = CONTROL_LETTERS[number % 23]. */
export function nifLetter(number) {
  return CONTROL_LETTERS[number % 23]
}

/** NIE check letter: X/Y/Z prefix maps to 0/1/2, prepended to the 7-digit body. */
export function nieLetter(prefix, number) {
  const prefixMap = { X: 0, Y: 1, Z: 2 }
  const full = prefixMap[prefix] * 10000000 + number
  return CONTROL_LETTERS[full % 23]
}

/** CIF check digit/letter — simplified standard algorithm (sum-based, mod 10). */
export function cifCheck(orgTypeLetter, number) {
  const digits = String(number).padStart(7, '0').split('').map(Number)
  let sumEven = 0
  let sumOdd = 0
  for (let i = 0; i < digits.length; i++) {
    if (i % 2 === 0) {
      // odd position (1st, 3rd... 0-indexed even): double and sum digits
      const doubled = digits[i] * 2
      sumOdd += doubled > 9 ? doubled - 9 : doubled
    } else {
      sumEven += digits[i]
    }
  }
  const total = sumEven + sumOdd
  const lastDigit = total % 10
  const checkDigit = lastDigit === 0 ? 0 : 10 - lastDigit
  // Letters like P, Q, S, etc. require a letter check char; numeric-only orgs use digit.
  const letterOrgTypes = new Set(['P', 'Q', 'S', 'K', 'W', 'N'])
  if (letterOrgTypes.has(orgTypeLetter)) {
    return 'JABCDEFGHI'[checkDigit]
  }
  return String(checkDigit)
}

// ── Names ────────────────────────────────────────────────────────────────

export const NOMBRES_M = [
  'Antonio', 'José', 'Manuel', 'Francisco', 'David', 'Juan', 'Javier', 'Daniel',
  'José Antonio', 'Carlos', 'Miguel Ángel', 'Rafael', 'Pedro', 'Ángel', 'Alejandro',
  'Fernando', 'Sergio', 'Pablo', 'Jorge', 'Alberto', 'Luis', 'Álvaro', 'Adrián',
  'Óscar', 'Rubén', 'Iñigo', 'Íñigo', 'Jesús', 'Ramón', 'Ignacio', 'Eduardo',
]

export const NOMBRES_F = [
  'María', 'Carmen', 'Josefa', 'Isabel', 'Ana', 'María Carmen', 'Laura', 'Cristina',
  'Marta', 'María del Carmen', 'Elena', 'Paula', 'Lucía', 'Sara', 'Sandra', 'Raquel',
  'Rosa María', 'María José', 'Beatriz', 'Silvia', 'Nuria', 'Patricia', 'Mónica',
  'Rocío', 'Yolanda', 'Concepción', 'María Ángeles', 'Inés', 'Águeda', 'Begoña',
]

// Apellidos, incluyendo compuestos con partícula ("de la", "del") para forzar
// spans multi-palabra en el ground truth.
export const APELLIDOS = [
  'García', 'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Sánchez',
  'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno',
  'Álvarez', 'Muñoz', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres',
  'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Suárez',
  // Ambiguous: common word / place-name overlaps used deliberately in adversarial.mjs
  'Iglesias', 'Prieto', 'Casas', 'León', 'Santos', 'Cortés', 'Iglesia',
  // Particled compound surnames
  'de la Fuente', 'de la Torre', 'del Río', 'de la Serna', 'de los Santos',
  'Fernández-Gómez de la Serna', 'García-Alonso', 'Ruiz-Domínguez',
]

export function randomFullName(rng) {
  const isFemale = rng.bool()
  const nombre = isFemale ? rng.pick(NOMBRES_F) : rng.pick(NOMBRES_M)
  const ap1 = rng.pick(APELLIDOS)
  const ap2 = rng.pick(APELLIDOS)
  return `${nombre} ${ap1} ${ap2}`
}

// ── Addresses ────────────────────────────────────────────────────────────

export const TIPOS_VIA = ['C/', 'Calle', 'Avda.', 'Avenida', 'Plaza', 'Pza.', 'Paseo', 'Ronda', 'Travesía']

export const NOMBRES_VIA = [
  'Mayor', 'Alcalá', 'Gran Vía', 'de la Constitución', 'del Sol', 'de Andalucía',
  'Real', 'de la Paz', 'San Bernardo', 'Princesa', 'Serrano', 'Goya',
  'de Colón', 'de Aragón', 'de la Merced', 'del Carmen', 'de los Reyes Católicos',
  'Doctor Fleming', 'Cardenal Cisneros', 'de la Rosa', 'del Pilar', 'de la Libertad',
]

export const CIUDADES = [
  { nombre: 'Madrid', cp: '28001' }, { nombre: 'Madrid', cp: '28045' },
  { nombre: 'Barcelona', cp: '08001' }, { nombre: 'Barcelona', cp: '08025' },
  { nombre: 'Valencia', cp: '46001' }, { nombre: 'Sevilla', cp: '41001' },
  { nombre: 'Zaragoza', cp: '50001' }, { nombre: 'Málaga', cp: '29001' },
  { nombre: 'Bilbao', cp: '48001' }, { nombre: 'Alicante', cp: '03001' },
  { nombre: 'Murcia', cp: '30001' }, { nombre: 'Vigo', cp: '36201' },
  { nombre: 'Gijón', cp: '33201' }, { nombre: 'A Coruña', cp: '15001' },
  { nombre: 'Granada', cp: '18001' }, { nombre: 'León', cp: '24001' },
]

export function randomAddress(rng) {
  const tipo = rng.pick(TIPOS_VIA)
  const nombre = rng.pick(NOMBRES_VIA)
  const numero = rng.int(1, 200)
  const piso = rng.bool() ? `, ${rng.int(1, 8)}º${rng.pick(['A', 'B', 'C', 'Izda', 'Dcha'])}` : ''
  return `${tipo} ${nombre} ${numero}${piso}`
}

// ── Organizations ───────────────────────────────────────────────────────

export const HOSPITALES = [
  'Hospital Universitario La Paz', 'Hospital Clínico San Carlos', 'Hospital de la Santa Creu i Sant Pau',
  'Hospital Universitario 12 de Octubre', 'Hospital Vall d\'Hebron', 'Hospital Ramón y Cajal',
  'Hospital Universitario Virgen del Rocío', 'Hospital Regional Universitario de Málaga',
  'Hospital Universitario Central de Asturias', 'Hospital Clínico Universitario de Valencia',
  'Hospital Universitario Marqués de Valdecilla', 'Hospital Son Espases',
  'Complejo Hospitalario Universitario de A Coruña', 'Hospital Universitario Miguel Servet',
]

export const JUZGADOS = [
  'Juzgado de Primera Instancia nº 3 de Madrid', 'Juzgado de lo Social nº 7 de Barcelona',
  'Juzgado de Instrucción nº 12 de Valencia', 'Juzgado de lo Mercantil nº 2 de Sevilla',
  'Juzgado de lo Contencioso-Administrativo nº 5 de Zaragoza', 'Audiencia Provincial de Málaga',
  'Juzgado de Primera Instancia nº 9 de Bilbao', 'Juzgado de lo Penal nº 4 de Alicante',
  'Tribunal Superior de Justicia de Madrid', 'Juzgado de Familia nº 1 de Murcia',
]

export const DESPACHOS = [
  'Bufete Ramírez & Asociados', 'Despacho Jurídico Fernández-Blanco',
  'Gómez Abogados S.L.P.', 'Martínez de la Torre Abogados', 'Cuatrecasas',
  'Uría Menéndez', 'Garrigues', 'Pérez-Llorca', 'Bufete López Serrano',
  'Estudio Jurídico del Río y Asociados',
]

export const MUTUAS_ASEGURADORAS = [
  'Sanitas', 'Adeslas', 'DKV Seguros', 'Asisa', 'Mapfre', 'Mutua Madrileña',
  'Fremap', 'Asepeyo', 'Cigna', 'Caser Seguros', 'Axa Seguros', 'Generali',
]

// ── Sectorial identifiers ─────────────────────────────────────────────────

export const HOSPITAL_CODES = ['LP', 'CSC', 'VH', 'RC', 'DOC', 'MS']
export const JUZGADO_CODES = ['MAD', 'BCN', 'VAL', 'SEV', 'ZAR', 'BIL']

export const COLEGIOS_ABOGADOS = [
  'ICAM', 'ICAB', 'ICAV', 'ICAS', 'ICAZ', 'ICAMalaga',
]

// ── RNG (seeded, deterministic) ─────────────────────────────────────────────

export function makeRng(seed) {
  let state = seed >>> 0
  function next() {
    // xorshift32
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 0xffffffff
  }
  return {
    next,
    int(min, max) { return Math.floor(next() * (max - min + 1)) + min },
    bool() { return next() < 0.5 },
    pick(arr) { return arr[Math.floor(next() * arr.length)] },
  }
}

// ── Structured identifier generators ────────────────────────────────────────

export function randomNIF(rng) {
  const number = rng.int(10000000, 99999999)
  return `${number}${nifLetter(number)}`
}

export function randomNIE(rng) {
  const prefix = rng.pick(['X', 'Y', 'Z'])
  const number = rng.int(1000000, 9999999)
  return `${prefix}${number}${nieLetter(prefix, number)}`
}

export function randomCIF(rng) {
  const orgLetter = rng.pick(['A', 'B', 'P', 'Q', 'S'])
  const number = rng.int(1000000, 9999999)
  return `${orgLetter}${number}${cifCheck(orgLetter, number)}`
}

export function randomIBAN(rng) {
  // ES + 2 check digits (not validated mod-97 — synthetic, format-correct) + 20-digit BBAN,
  // grouped in blocks of 4 as printed on Spanish bank documents (ES91 2100 0418 4502 0005 1332)
  const check = String(rng.int(10, 99))
  const bban = Array.from({ length: 5 }, () => String(rng.int(1000, 9999)))
  return `ES${check} ${bban.join(' ')}`
}

const PHONE_FORMATS = ['contiguous', 'grouped3', 'grouped2222', 'landline', 'international']

export function randomPhone(rng, format) {
  const fmt = format ?? rng.pick(PHONE_FORMATS)
  const first = rng.pick(['6', '7'])
  const rest = () => rng.int(0, 9)
  const digits = [first, ...Array.from({ length: 8 }, rest)]
  switch (fmt) {
    case 'contiguous':
      return digits.join('')
    case 'grouped3':
      return `${digits.slice(0, 3).join('')} ${digits.slice(3, 6).join('')} ${digits.slice(6, 9).join('')}`
    case 'grouped2222': {
      const d = digits.join('')
      return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
    }
    case 'landline': {
      const landline = ['91', '93', '96', '95', '94'][rng.int(0, 4)]
      const rest7 = Array.from({ length: 7 }, () => rng.int(0, 9)).join('')
      return `${landline} ${rest7.slice(0, 3)} ${rest7.slice(3, 5)} ${rest7.slice(5, 7)}`
    }
    case 'international':
      return `+34 ${digits.slice(0, 3).join('')} ${digits.slice(3, 6).join('')} ${digits.slice(6, 9).join('')}`
    default:
      return digits.join('')
  }
}

export function randomSeguridadSocial(rng) {
  // Format: PP NNNNNNNNNN CC (province 2 digits, 10-digit sequence, 2 control digits)
  const provincia = String(rng.int(1, 52)).padStart(2, '0')
  const seq = String(rng.int(0, 9999999999)).padStart(10, '0')
  const control = String(rng.int(0, 99)).padStart(2, '0')
  return `${provincia} ${seq} ${control}`
}

export function randomTarjeta(rng) {
  const groups = Array.from({ length: 4 }, () => String(rng.int(1000, 9999)))
  return groups.join(' ')
}

export function randomNHC(rng) {
  return `NHC-${rng.int(2020, 2026)}-${rng.int(1000, 9999)}`
}

export function randomNIG(rng) {
  // NIG format: NN NNNN N J NNNNNN/NNNN (provincia, municipio, jurisdicción, orden, año)
  const prov = String(rng.int(1, 52)).padStart(2, '0')
  const mun = String(rng.int(1, 999)).padStart(4, '0')
  const jur = rng.pick(['C', 'S', 'P'])
  const orden = String(rng.int(1, 999999)).padStart(6, '0')
  const anyo = rng.int(2020, 2026)
  return `${prov}${mun} ${jur} ${orden}/${anyo}`
}

export function randomColegiado(rng) {
  const colegio = rng.pick(COLEGIOS_ABOGADOS)
  return `${colegio} nº ${rng.int(10000, 99999)}`
}

export function randomReferenciaCatastral(rng) {
  // 20-char alphanumeric: 7 digits (parcela) + 2 letters + 5 digits + 4 chars control
  const digits1 = Array.from({ length: 7 }, () => rng.int(0, 9)).join('')
  const letters1 = Array.from({ length: 2 }, () => String.fromCharCode(65 + rng.int(0, 25))).join('')
  const digits2 = Array.from({ length: 5 }, () => rng.int(0, 9)).join('')
  const control = Array.from({ length: 4 }, () => rng.bool() ? String.fromCharCode(65 + rng.int(0, 25)) : String(rng.int(0, 9))).join('')
  return `${digits1}${letters1}${digits2}${control}`
}

export function randomExpediente(rng) {
  return `#APP-${rng.int(2024, 2026)}-${rng.int(1000, 9999)}`
}

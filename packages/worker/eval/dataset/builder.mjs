/**
 * Shared text/entity builder used by both generate.mjs (synthetic) and
 * adversarial.mjs (hand-written). Accumulates text and records entity spans as
 * fragments are appended, so start/end offsets are always exactly right — we
 * never search for a value inside the final text (which breaks the moment a
 * value repeats, e.g. the same surname used twice in one document).
 */
export function builder() {
  const parts = []
  const entities = []
  let len = 0
  const t = (s) => { parts.push(s); len += s.length; return b }
  const e = (type, value, opts) => {
    const start = len
    parts.push(value)
    len += value.length
    entities.push({ type, value, start, end: len, ...(opts ?? {}) })
    return b
  }
  const build = () => ({ text: parts.join(''), entities })
  const b = { t, e, build }
  return b
}

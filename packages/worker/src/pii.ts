const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,                                      // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,               // Credit card
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,       // Email
  /\b(\+?34|0034)?[\s-]?[6789]\d{8}\b/,                         // Spanish phone
  /\b[0-9]{8}[A-Z]\b|\b[XYZ][0-9]{7}[A-Z]\b/,                  // DNI/NIE
  /\bES\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}[\s]?\d{10}\b/i,    // IBAN ES
  /\b(paciente|patient|diagnos|historial|clinical|medical)\b/i,
]

export function detectPII(text: string): boolean {
  return PII_PATTERNS.some(pattern => pattern.test(text))
}

export function extractMessages(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages)) return ''
  return b.messages
    .map((m: unknown) => (m as Record<string, string>).content ?? '')
    .join(' ')
}

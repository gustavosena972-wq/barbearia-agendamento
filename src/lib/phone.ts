/** Normaliza telefone BR para dígitos (10 ou 11). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('55')) return digits.slice(2)
  if (digits.length === 12 && digits.startsWith('55')) return digits.slice(2)
  return digits
}

export function isValidBrPhone(raw: string): boolean {
  const d = normalizePhone(raw)
  return /^[1-9][0-9]{9,10}$/.test(d)
}

export function formatPhoneDisplay(raw: string): string {
  const d = normalizePhone(raw)
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  }
  return raw
}

export function maskPhoneInput(raw: string): string {
  const d = normalizePhone(raw).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

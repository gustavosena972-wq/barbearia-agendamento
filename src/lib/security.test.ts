import { describe, expect, it } from 'vitest'
import { isValidBrPhone, normalizePhone } from './phone'

/** Espelho da lógica SQL detectar_intent (para regressão no client). */
export function detectarIntent(raw: string): string {
  let t = raw.toLowerCase().trim()
  t = t.normalize('NFD').replace(/\p{M}/gu, '')
  t = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

  if (/(nao posso|nao vou|cancel|desmarcar|impossivel)/.test(t)) return 'cancelar'
  if (/(remarcar|reagendar|outro horario|mais tarde|adiar|mudar|trocar)/.test(t)) return 'remarcar'
  if (/^(sim|s|ok|confirmo|confirmado|pode ser|belez|fechado|vou|estarei|claro|combinado)(\s|$)/.test(t)
    || /(vou sim|pode confirmar|confirmado|estarei la)/.test(t)) return 'confirmar'
  if (/^[1-5]$/.test(t)) return 'escolher_slot'
  return 'duvida'
}

describe('normalizePhone', () => {
  it('aceita celular BR 11 dígitos', () => {
    expect(normalizePhone('(31) 99999-0000')).toBe('31999990000')
    expect(isValidBrPhone('31999990000')).toBe(true)
  })
  it('remove 55', () => {
    expect(normalizePhone('5531999990000')).toBe('31999990000')
  })
})

describe('detectarIntent', () => {
  it('confirma', () => {
    expect(detectarIntent('sim')).toBe('confirmar')
    expect(detectarIntent('Confirmo')).toBe('confirmar')
  })
  it('cancela', () => {
    expect(detectarIntent('não posso')).toBe('cancelar')
    expect(detectarIntent('quero cancelar')).toBe('cancelar')
  })
  it('remarca', () => {
    expect(detectarIntent('remarcar')).toBe('remarcar')
    expect(detectarIntent('pode ser mais tarde?')).toBe('remarcar')
  })
  it('escala dúvida', () => {
    expect(detectarIntent('quanto custa?')).toBe('duvida')
  })
})

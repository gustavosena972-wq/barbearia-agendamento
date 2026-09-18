/**
 * Gera supabase/schema-all.sql concatenando a ordem de instalação.
 * Uso: node scripts/build-schema-all.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'schema.sql',
  'schema-fase2.sql',
  'schema-harden.sql',
  'schema-harden-v2.sql',
  'schema-harden-v3.sql',
  'schema-prod.sql',
  'realtime.sql',
]

const parts = [
  '-- AUTO-GERADO por scripts/build-schema-all.mjs — NÃO edite à mão',
  '-- Ordem: schema → fase2 → harden → harden-v2 → harden-v3 → prod → realtime',
  '-- Banco novo: cole este arquivo inteiro no SQL Editor do Supabase.',
  '',
]

for (const f of files) {
  const p = path.join(root, 'supabase', f)
  if (!fs.existsSync(p)) {
    console.warn('skip missing', f)
    continue
  }
  parts.push(`\n-- ========== ${f} ==========\n`)
  parts.push(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim())
  parts.push('\n')
}

const out = path.join(root, 'supabase', 'schema-all.sql')
fs.writeFileSync(out, parts.join('\n'), 'utf8')
console.log('Wrote', out, `(${Math.round(fs.statSync(out).size / 1024)} KB)`)

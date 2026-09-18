/**
 * Aplica supabase/schema-prod.sql no banco (pooler).
 * Requer .supabase-setup.tmp com SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD.
 * Uso: node scripts/apply-prod.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.supabase-setup.tmp')
if (!fs.existsSync(tmp)) {
  console.error('Missing .supabase-setup.tmp')
  process.exit(1)
}

const vars = Object.fromEntries(
  fs
    .readFileSync(tmp, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sql = fs.readFileSync(path.join(root, 'supabase', 'schema-prod.sql'), 'utf8')
const client = new pg.Client({
  connectionString: `postgresql://postgres.${vars.SUPABASE_PROJECT_REF}:${encodeURIComponent(vars.SUPABASE_DB_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
await client.query(sql)
console.log('PROD_OK')
const cron = await client.query(`select extname from pg_extension where extname='pg_cron'`)
console.log('PG_CRON', cron.rows)
const funcs = await client.query(
  `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('health_barbearia','tick_operacao') order by 1`,
)
console.log('FUNCS', funcs.rows)
await client.end()

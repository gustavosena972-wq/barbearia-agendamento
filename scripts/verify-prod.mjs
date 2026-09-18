import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vars = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.supabase-setup.tmp'), 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const c = new pg.Client({
  connectionString: `postgresql://postgres.${vars.SUPABASE_PROJECT_REF}:${encodeURIComponent(vars.SUPABASE_DB_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  ssl: { rejectUnauthorized: false },
})

await c.connect()
const tick = await c.query('select public.tick_operacao() as r')
console.log('TICK', JSON.stringify(tick.rows[0].r))
const job = await c.query(
  `select jobname, schedule, active from cron.job where jobname = 'barbearia-tick-operacao'`,
)
console.log('CRON_JOB', JSON.stringify(job.rows))
const shop = await c.query(
  `select setup_completo, nome, canal_mensagens from public.barbearia limit 1`,
)
console.log('SHOP', JSON.stringify(shop.rows))
await c.end()

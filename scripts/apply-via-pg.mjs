import fs from 'node:fs'
import pg from 'pg'

const vars = Object.fromEntries(
  fs
    .readFileSync('.supabase-setup.tmp', 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const ref = vars.SUPABASE_PROJECT_REF
const pass = vars.SUPABASE_DB_PASSWORD

const candidates = [
  {
    name: 'pooler-6543',
    connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(pass)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  },
  {
    name: 'pooler-5432',
    connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(pass)}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,
  },
  {
    name: 'direct',
    connectionString: `postgresql://postgres:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/postgres`,
  },
]

async function connect() {
  for (const c of candidates) {
    const client = new pg.Client({
      connectionString: c.connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    try {
      await client.connect()
      const r = await client.query('select 1 as ok')
      console.log('CONNECTED', c.name, r.rows[0])
      return client
    } catch (e) {
      console.log('FAIL', c.name, e.message)
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error('Não conectou em nenhum host Postgres')
}

const client = await connect()

for (const file of ['supabase/schema.sql', 'supabase/schema-fase2.sql', 'supabase/realtime.sql']) {
  const sql = fs.readFileSync(file, 'utf8')
  console.log('APPLY', file)
  try {
    await client.query(sql)
    console.log('OK', file)
  } catch (e) {
    console.error('SQL_ERR', file, e.message)
    process.exitCode = 1
  }
}

await client.end()
console.log('DONE')

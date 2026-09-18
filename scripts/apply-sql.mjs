import fs from 'node:fs'
import path from 'node:path'

const tmp = fs.readFileSync('.supabase-setup.tmp', 'utf8')
const vars = Object.fromEntries(
  tmp
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim()]
    }),
)

const token = vars.SUPABASE_ACCESS_TOKEN
const ref = vars.SUPABASE_PROJECT_REF

async function runSql(file) {
  const query = fs.readFileSync(file, 'utf8')
  console.log('RUNNING', file, `(${query.length} chars)`)
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error('FAIL', file, res.status, text.slice(0, 1500))
    return false
  }
  console.log('OK', file, res.status)
  return true
}

const smoke = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'select 1 as ok;' }),
})
console.log('SMOKE', smoke.status, (await smoke.text()).slice(0, 200))

const files = [
  'supabase/schema.sql',
  'supabase/schema-fase2.sql',
  'supabase/realtime.sql',
]
for (const f of files) {
  const ok = await runSql(f)
  if (!ok) process.exitCode = 1
}

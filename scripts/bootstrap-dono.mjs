import fs from 'node:fs'
import crypto from 'node:crypto'

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

const url = vars.VITE_SUPABASE_URL
const service = vars.SUPABASE_SERVICE_ROLE_KEY
const anon = vars.VITE_SUPABASE_ANON_KEY
const ref = vars.SUPABASE_PROJECT_REF

const email = 'dono@barbearia.local'
const password = crypto.randomBytes(9).toString('base64url') + 'Aa1!'

const createRes = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${service}`,
    apikey: service,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome: 'Dono' },
  }),
})

const created = await createRes.json()
if (!createRes.ok) {
  console.error('AUTH_CREATE_FAIL', created)
  process.exit(1)
}

const userId = created.id
console.log('USER_CREATED', userId)

const { Client } = await import('pg')
const client = new Client({
  connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(vars.SUPABASE_DB_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
await client.query(
  `insert into public.usuarios (auth_user_id, nome, email, papel)
   values ($1, 'Dono', $2, 'dono')
   on conflict (auth_user_id) do update set email = excluded.email, papel = 'dono', ativo = true`,
  [userId, email],
)
await client.end()
console.log('USUARIO_LINKED')

fs.writeFileSync(
  '.env',
  `VITE_SUPABASE_URL=${url}
VITE_SUPABASE_ANON_KEY=${anon}
`,
)

fs.writeFileSync(
  'CREDENTIALS.txt',
  `Barbearia — acesso dono (guarde e apague este arquivo depois)

URL do app: http://localhost:5173
Painel: http://localhost:5173/painel/login

E-mail: ${email}
Senha: ${password}

Projeto Supabase: ${ref}
Dashboard: https://supabase.com/dashboard/project/${ref}

IMPORTANTE: revogue o Access Token que foi colado no chat
(https://supabase.com/dashboard/account/tokens) — ele já foi usado.
`,
)

console.log('ENV_OK CREDENTIALS_OK')

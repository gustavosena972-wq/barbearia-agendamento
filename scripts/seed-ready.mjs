/**
 * Seed mínimo para piloto: 1 barbeiro, 3 serviços, horários, setup_completo.
 * Idempotente (só completa se faltar dados).
 * Uso: node scripts/seed-ready.mjs
 */
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
await c.query('begin')

try {
  const shop = await c.query(`select id, setup_completo, nome from public.barbearia order by created_at limit 1`)
  if (shop.rows.length === 0) {
    await c.query(
      `insert into public.barbearia (nome, telefone, endereco, exibir_precos, canal_mensagens, setup_completo)
       values ('Barbearia Demo', '31999990000', 'Rua Exemplo, 100', true, 'simulacao', false)`,
    )
  }

  const shop2 = await c.query(`select id from public.barbearia order by created_at limit 1`)
  const shopId = shop2.rows[0].id

  let barbeiros = await c.query(`select id, nome from public.barbeiros where ativo`)
  if (barbeiros.rows.length === 0) {
    const ins = await c.query(
      `insert into public.barbeiros (nome, ativo, ordem) values ('Barbeiro Demo', true, 1) returning id`,
    )
    barbeiros = { rows: [{ id: ins.rows[0].id, nome: 'Barbeiro Demo' }] }
  }

  const servCount = await c.query(`select count(*)::int as n from public.servicos where ativo`)
  if (servCount.rows[0].n === 0) {
    await c.query(`
      insert into public.servicos (nome, duracao_min, preco, ativo, ordem) values
        ('Corte', 30, 40, true, 1),
        ('Barba', 30, 30, true, 2),
        ('Corte + Barba', 60, 65, true, 3)
    `)
  }

  for (const b of barbeiros.rows) {
    const h = await c.query(`select count(*)::int as n from public.horarios_trabalho where barbeiro_id = $1`, [
      b.id,
    ])
    if (h.rows[0].n === 0) {
      for (const dia of [1, 2, 3, 4, 5, 6]) {
        await c.query(
          `insert into public.horarios_trabalho
            (barbeiro_id, dia_semana, inicio, fim, almoco_inicio, almoco_fim)
           values ($1, $2, '09:00', '19:00', '12:00', '13:00')`,
          [b.id, dia],
        )
      }
    }
  }

  await c.query(
    `update public.barbearia
     set setup_completo = true,
         nome = coalesce(nullif(nome, ''), 'Barbearia Demo'),
         canal_mensagens = coalesce(canal_mensagens, 'simulacao'),
         exibir_precos = true
     where id = $1`,
    [shopId],
  )

  await c.query('commit')

  const health = await c.query(`
    select
      (select setup_completo from public.barbearia where id = $1) as setup,
      (select count(*) from public.barbeiros where ativo) as barbeiros,
      (select count(*) from public.servicos where ativo) as servicos,
      (select count(*) from public.horarios_trabalho) as horarios
  `, [shopId])
  console.log('SEED_OK', JSON.stringify(health.rows[0]))
} catch (e) {
  await c.query('rollback')
  console.error('SEED_FAIL', e.message)
  process.exit(1)
} finally {
  await c.end()
}

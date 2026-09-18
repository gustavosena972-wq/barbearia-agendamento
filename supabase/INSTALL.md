# Instalação SQL

## Banco novo (recomendado)

1. Gere o arquivo único: `node scripts/build-schema-all.mjs`
2. Cole `supabase/schema-all.sql` no SQL Editor do Supabase (uma vez).

## Ordem manual (alternativa)

1. `schema.sql`
2. `schema-fase2.sql`
3. `schema-harden.sql`
4. `schema-harden-v2.sql`
5. `schema-harden-v3.sql`
6. `schema-prod.sql` — health + tick + pg_cron
7. `realtime.sql` (opcional)

## Banco já existente (este projeto)

Só falta produção:

```bash
node scripts/apply-prod.mjs
```

Ou cole `schema-prod.sql` no SQL Editor.

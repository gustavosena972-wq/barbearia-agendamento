# Barbearia — Sistema de Agendamento (completo)

Projeto **independente** (fora do CodeCraft / Gestão).  
Escopo do relatório: **fases 1 + 2 + 3**, **sem pagamento online**.

## O que está pronto

| Fase | Conteúdo |
|------|----------|
| 1 | Página pública, painel, wizard, agenda, PWA, push, bloqueios |
| 2 | Lembretes, IA (confirmar/remarcar/cancelar/escalar), listas, simulação + webhook WhatsApp |
| 3 | Comissões, relatórios, histórico do cliente |

## Segurança

- Anon sem acesso direto às tabelas (só RPCs)
- Exclusion GiST anti double-booking + revalidação no insert
- Rate limit por telefone
- Manage token só com hash SHA-256
- IA **não inventa horários** — só escolhe slots do `listar_slots`
- Ações da IA registradas; barbeiro pode **desfazer**
- Service role só em Edge Functions

## Pronto para uso (piloto)

Depois do wizard:

1. Login dono → Início mostra **Pronto para uso** (checklist verde).
2. Compartilhe `https://seu-dominio/` com os clientes.
3. Equipe usa **Agenda** (grade do dia) + **Concluir**.
4. **IA**: canal Simulação já funciona; lembretes rodam ao abrir o painel (dono) e via `pg_cron` a cada 15 min se o plano Supabase permitir.
5. Ative notificações push no celular (PWA).

WhatsApp oficial: só depois de secrets `CRON_SECRET`, `WHATSAPP_APP_SECRET`, token Meta — e canal = WhatsApp em Config.

## Setup (obrigatório)

### 1. Supabase (projeto novo)

1. Crie o projeto em [supabase.com](https://supabase.com)
2. SQL Editor — **uma vez**: `node scripts/build-schema-all.mjs` e cole `supabase/schema-all.sql`  
   (ou a ordem em `supabase/INSTALL.md`)
3. Em banco já existente deste projeto: `node scripts/apply-prod.mjs` (health + lembretes)
4. Auth → Users → criar dono (senha forte)
5. Vincular perfil:

```sql
insert into public.usuarios (auth_user_id, nome, email, papel)
select id, 'Dono', email, 'dono'
from auth.users
where email = 'seu@email.com'
on conflict (auth_user_id) do nothing;
```

### 2. Frontend

```bash
cp .env.example .env
# VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Login em `/painel/login` → wizard → testar `/`.

### 3. Push (opcional)

```bash
npx web-push generate-vapid-keys
# pública no .env; privada nos secrets
supabase functions deploy notify-new-booking
```

### 4. WhatsApp (opcional — fase 2)

1. Meta Cloud API: token + phone number id  
2. Deploy: `supabase functions deploy whatsapp-webhook`  
3. Secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`  
4. Webhook URL: `https://<project>.supabase.co/functions/v1/whatsapp-webhook`  
5. Em Config → canal **WhatsApp**  
6. Cron (Supabase scheduled function ou GitHub Action) POST `{ "action": "reminders" }` a cada 15 min  

**Sem WhatsApp:** use canal **Simulação** + tela **IA** no painel (dispara lembrete e responde como cliente).

## Rotas

- `/` agendar  
- `/agendamento/:id?t=` remarcar/cancelar  
- `/painel` início  
- `/painel/agenda`  
- `/painel/ia` conversas + listas  
- `/painel/clientes` histórico  
- `/painel/relatorios`  
- `/painel/config`  

## Como demonstrar a IA (sem custo)

1. Cliente agenda em `/`  
2. Painel → **IA** → Disparar lembretes  
3. Selecione o agendamento → responda `sim`, `remarcar`, `cancelar` ou `1`  
4. Veja status nas listas e use **Desfazer** se precisar  

## Fora do escopo

- Pagamento online / Asaas / PIX no app  
- SaaS multi-barbearia  

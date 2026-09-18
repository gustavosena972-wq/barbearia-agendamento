-- =====================================================================
-- Produção — health + tick automático de lembretes (pg_cron se disponível)
-- Rode após schema-harden-v3.sql
-- =====================================================================

create or replace function public.tick_operacao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lem jsonb;
  v_sem jsonb;
begin
  -- service_role (uid null) ou dono
  if auth.uid() is not null and public.current_papel() is distinct from 'dono' then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  v_lem := public.disparar_lembretes();
  v_sem := public.processar_sem_resposta();

  return jsonb_build_object(
    'ok', true,
    'lembretes', v_lem,
    'sem_resposta', v_sem,
    'at', now()
  );
end;
$$;

revoke all on function public.tick_operacao() from public, anon;
grant execute on function public.tick_operacao() to authenticated, service_role;

create or replace function public.health_barbearia()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop public.barbearia%rowtype;
  v_barbeiros int;
  v_servicos int;
  v_horarios int;
  v_hoje int;
  v_atencao int;
begin
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  select * into v_shop from public.barbearia order by created_at limit 1;
  select count(*) into v_barbeiros from public.barbeiros where ativo;
  select count(*) into v_servicos from public.servicos where ativo;
  select count(*) into v_horarios from public.horarios_trabalho;
  select count(*) into v_hoje
  from public.agendamentos
  where status <> 'cancelado'
    and (inicio at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
    and (
      public.current_papel() = 'dono'
      or barbeiro_id = public.current_barbeiro_id()
    );
  select count(*) into v_atencao
  from public.agendamentos
  where status = 'precisa_atencao'
    and inicio > now() - interval '7 days'
    and (
      public.current_papel() = 'dono'
      or barbeiro_id = public.current_barbeiro_id()
    );

  return jsonb_build_object(
    'ready', coalesce(v_shop.setup_completo, false)
      and v_barbeiros > 0
      and v_servicos > 0
      and v_horarios > 0,
    'setup_completo', coalesce(v_shop.setup_completo, false),
    'barbeiros_ativos', v_barbeiros,
    'servicos_ativos', v_servicos,
    'horarios_cadastrados', v_horarios,
    'agendamentos_hoje', v_hoje,
    'precisa_atencao', v_atencao,
    'canal', coalesce(v_shop.canal_mensagens, 'simulacao'),
    'exibir_precos', coalesce(v_shop.exibir_precos, true),
    'nome', coalesce(v_shop.nome, '')
  );
end;
$$;

revoke all on function public.health_barbearia() from public, anon;
grant execute on function public.health_barbearia() to authenticated;

-- Agenda automática a cada 15 min (Supabase / pg_cron)
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron indisponível neste plano: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'barbearia-tick-operacao';

    perform cron.schedule(
      'barbearia-tick-operacao',
      '*/15 * * * *',
      $cron$ select public.tick_operacao(); $cron$
    );
    raise notice 'pg_cron agendado: barbearia-tick-operacao a cada 15 min';
  end if;
exception when others then
  raise notice 'Não foi possível agendar cron: %', sqlerrm;
end $$;

-- =====================================================================
-- Hardening pós-auditoria — rode no projeto live (idempotente)
-- =====================================================================

-- 1) One-shot push
alter table public.agendamentos
  add column if not exists push_enviado_em timestamptz;

-- 2) Impede escalada de privilégio em usuarios
create or replace function public.proteger_usuarios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel text := public.current_papel();
begin
  if tg_op = 'UPDATE' then
    if v_papel is distinct from 'dono' then
      if new.papel is distinct from old.papel
         or new.ativo is distinct from old.ativo
         or new.barbeiro_id is distinct from old.barbeiro_id
         or new.auth_user_id is distinct from old.auth_user_id
         or new.email is distinct from old.email then
        raise exception 'ALTERACAO_PROIBIDA' using errcode = 'P0001';
      end if;
      -- self só pode mudar nome
      if new.auth_user_id is distinct from auth.uid() then
        raise exception 'ALTERACAO_PROIBIDA' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_usuarios_trg on public.usuarios;
create trigger proteger_usuarios_trg
  before update on public.usuarios
  for each row execute function public.proteger_usuarios();

-- 3) Políticas RLS mais restritas
drop policy if exists usuarios_update_self on public.usuarios;
create policy usuarios_update_self on public.usuarios
  for update to authenticated
  using (
    public.current_papel() = 'dono'
    or auth_user_id = auth.uid()
  )
  with check (
    public.current_papel() = 'dono'
    or auth_user_id = auth.uid()
  );

-- barbeiros: todos leem; só dono escreve
drop policy if exists barbeiros_staff on public.barbeiros;
drop policy if exists barbeiros_select on public.barbeiros;
drop policy if exists barbeiros_write_dono on public.barbeiros;
create policy barbeiros_select on public.barbeiros
  for select to authenticated
  using (public.is_staff());
create policy barbeiros_write_dono on public.barbeiros
  for all to authenticated
  using (public.current_papel() = 'dono')
  with check (public.current_papel() = 'dono');

-- servicos: todos leem; só dono escreve
drop policy if exists servicos_staff on public.servicos;
drop policy if exists servicos_select on public.servicos;
drop policy if exists servicos_write_dono on public.servicos;
create policy servicos_select on public.servicos
  for select to authenticated
  using (public.is_staff());
create policy servicos_write_dono on public.servicos
  for all to authenticated
  using (public.current_papel() = 'dono')
  with check (public.current_papel() = 'dono');

-- vínculos serviço×barbeiro
drop policy if exists barbeiro_servicos_staff on public.barbeiro_servicos;
drop policy if exists barbeiro_servicos_select on public.barbeiro_servicos;
drop policy if exists barbeiro_servicos_write_dono on public.barbeiro_servicos;
create policy barbeiro_servicos_select on public.barbeiro_servicos
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );
create policy barbeiro_servicos_write_dono on public.barbeiro_servicos
  for all to authenticated
  using (public.current_papel() = 'dono')
  with check (public.current_papel() = 'dono');

-- horários / bloqueios: dono tudo; barbeiro só o próprio
drop policy if exists horarios_staff on public.horarios_trabalho;
drop policy if exists horarios_select on public.horarios_trabalho;
drop policy if exists horarios_write on public.horarios_trabalho;
create policy horarios_select on public.horarios_trabalho
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );
create policy horarios_write on public.horarios_trabalho
  for all to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  )
  with check (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );

drop policy if exists bloqueios_staff on public.bloqueios;
drop policy if exists bloqueios_select on public.bloqueios;
drop policy if exists bloqueios_write on public.bloqueios;
create policy bloqueios_select on public.bloqueios
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );
create policy bloqueios_write on public.bloqueios
  for all to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  )
  with check (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );

-- clientes: dono todos; barbeiro só quem já agendou com ele
drop policy if exists clientes_staff on public.clientes;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_write on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or exists (
      select 1 from public.agendamentos a
      where a.cliente_id = clientes.id
        and a.barbeiro_id = public.current_barbeiro_id()
    )
  );
create policy clientes_write on public.clientes
  for all to authenticated
  using (
    public.current_papel() = 'dono'
    or exists (
      select 1 from public.agendamentos a
      where a.cliente_id = clientes.id
        and a.barbeiro_id = public.current_barbeiro_id()
    )
  )
  with check (public.is_staff());

-- mensagens: via agendamento do barbeiro / dono
drop policy if exists mensagens_staff on public.mensagens;
drop policy if exists mensagens_select on public.mensagens;
drop policy if exists mensagens_write on public.mensagens;
create policy mensagens_select on public.mensagens
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or exists (
      select 1 from public.agendamentos a
      where a.id = mensagens.agendamento_id
        and a.barbeiro_id = public.current_barbeiro_id()
    )
  );
create policy mensagens_write on public.mensagens
  for insert to authenticated
  with check (
    public.current_papel() = 'dono'
    or exists (
      select 1 from public.agendamentos a
      where a.id = mensagens.agendamento_id
        and a.barbeiro_id = public.current_barbeiro_id()
    )
  );

-- 4) Least privilege em RPCs DEFINER
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'processar_resposta_cliente',
        'registrar_mensagem',
        'notificar_staff_agendamento',
        'disparar_lembretes',
        'processar_sem_resposta',
        'simular_resposta_cliente',
        'desfazer_acao_ia',
        'relatorio_resumo',
        'criar_agendamento_publico',
        'gerenciar_agendamento_publico',
        'obter_agendamento_publico',
        'listar_slots',
        'catalogo_publico',
        'detectar_intent',
        'normalize_phone',
        'claim_push_notification'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.catalogo_publico() to anon, authenticated;
grant execute on function public.listar_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.criar_agendamento_publico(uuid, uuid, timestamptz, text, text, boolean) to anon, authenticated;
grant execute on function public.gerenciar_agendamento_publico(uuid, text, text, timestamptz) to anon, authenticated;
grant execute on function public.obter_agendamento_publico(uuid, text) to anon, authenticated;

grant execute on function public.disparar_lembretes() to authenticated;
grant execute on function public.processar_sem_resposta() to authenticated;
grant execute on function public.simular_resposta_cliente(uuid, text) to authenticated;
grant execute on function public.desfazer_acao_ia(uuid) to authenticated;
grant execute on function public.relatorio_resumo(date, date) to authenticated;

grant execute on function public.processar_resposta_cliente(uuid, text, text) to service_role;
grant execute on function public.registrar_mensagem(uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.notificar_staff_agendamento(uuid, text, text, text) to service_role;
grant execute on function public.disparar_lembretes() to service_role;
grant execute on function public.processar_sem_resposta() to service_role;

-- 5) Ownership nas RPCs de IA / lembretes
create or replace function public.assert_acesso_agendamento(p_agendamento_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barbeiro uuid;
begin
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;
  if public.current_papel() = 'dono' then
    return;
  end if;
  select barbeiro_id into v_barbeiro from public.agendamentos where id = p_agendamento_id;
  if v_barbeiro is distinct from public.current_barbeiro_id() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.simular_resposta_cliente(
  p_agendamento_id uuid,
  p_texto text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_acesso_agendamento(p_agendamento_id);
  return public.processar_resposta_cliente(p_agendamento_id, p_texto, 'simulacao');
end;
$$;

create or replace function public.desfazer_acao_ia(p_agendamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag public.agendamentos%rowtype;
begin
  perform public.assert_acesso_agendamento(p_agendamento_id);

  select * into v_ag from public.agendamentos where id = p_agendamento_id for update;
  if not found then
    raise exception 'AGENDAMENTO_INVALIDO' using errcode = 'P0001';
  end if;

  if v_ag.horario_anterior_inicio is not null then
    update public.agendamentos
      set inicio = horario_anterior_inicio,
          fim = horario_anterior_fim,
          horario_anterior_inicio = null,
          horario_anterior_fim = null,
          status = 'aguardando',
          conversa_estado = 'idle'
      where id = v_ag.id;
  else
    update public.agendamentos
      set status = 'aguardando', conversa_estado = 'idle'
      where id = v_ag.id;
  end if;

  insert into public.audit_log (actor_usuario_id, acao, entidade, entidade_id, meta)
  values (public.current_usuario_id(), 'desfazer_ia', 'agendamentos', p_agendamento_id, '{}'::jsonb);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.disparar_lembretes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_horas int;
  v_canal text;
  r record;
  v_texto text;
  v_count int := 0;
begin
  -- só dono (ou service_role sem JWT → auth.uid null: permitir via grant service_role)
  if auth.uid() is not null and public.current_papel() is distinct from 'dono' then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  select lembrete_horas_antes, canal_mensagens into v_horas, v_canal
  from public.barbearia order by created_at limit 1;

  if v_horas is null then
    return jsonb_build_object('enviados', 0);
  end if;

  for r in
    select a.id, a.inicio, c.nome, c.telefone, c.consentimento_mensagens, s.nome as servico, b.nome as barbeiro
    from public.agendamentos a
    join public.clientes c on c.id = a.cliente_id
    join public.servicos s on s.id = a.servico_id
    join public.barbeiros b on b.id = a.barbeiro_id
    where a.status in ('aguardando', 'reagendado')
      and a.lembrete_enviado_em is null
      and a.inicio > now()
      and a.inicio <= now() + make_interval(hours => v_horas)
      and c.consentimento_mensagens = true
  loop
    v_texto := format(
      'Olá %s! Lembrete: %s com %s em %s. Responda SIM para confirmar, REMARCAR para outro horário ou CANCELAR.',
      r.nome, r.servico, r.barbeiro,
      to_char(r.inicio at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI')
    );
    perform public.registrar_mensagem(r.id, 'enviada', v_texto, coalesce(v_canal, 'simulacao'), null, 'lembrete', '{}'::jsonb);
    update public.agendamentos
      set lembrete_enviado_em = now(),
          conversa_estado = 'aguardando_confirmacao',
          status = case when status = 'reagendado' then status else 'aguardando' end
      where id = r.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('enviados', v_count);
end;
$$;

create or replace function public.processar_sem_resposta()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regra text;
  r record;
  n int := 0;
begin
  if auth.uid() is not null and public.current_papel() is distinct from 'dono' then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  select regra_sem_resposta into v_regra from public.barbearia order by created_at limit 1;
  if coalesce(v_regra, 'avisar_barbeiro') <> 'avisar_barbeiro' then
    return jsonb_build_object('marcados', 0);
  end if;

  for r in
    select a.id
    from public.agendamentos a
    where a.conversa_estado = 'aguardando_confirmacao'
      and a.lembrete_enviado_em is not null
      and a.lembrete_enviado_em < now() - interval '6 hours'
      and a.status = 'aguardando'
      and a.inicio > now()
      and not exists (
        select 1 from public.mensagens m
        where m.agendamento_id = a.id and m.direcao = 'recebida'
          and m.created_at > a.lembrete_enviado_em
      )
  loop
    update public.agendamentos
      set status = 'precisa_atencao', conversa_estado = 'encerrada'
      where id = r.id;
    perform public.notificar_staff_agendamento(
      r.id, 'precisa_atencao', 'Sem resposta do cliente',
      'Lembrete enviado e cliente não respondeu.'
    );
    n := n + 1;
  end loop;

  return jsonb_build_object('marcados', n);
end;
$$;

-- 6) Claim atômico de push (one-shot) com manage_token
create or replace function public.claim_push_notification(
  p_agendamento_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_ag public.agendamentos%rowtype;
begin
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_ag
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found or v_ag.manage_token_hash is distinct from v_hash then
    raise exception 'TOKEN_INVALIDO' using errcode = 'P0001';
  end if;

  if v_ag.push_enviado_em is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_ag.origem is distinct from 'pagina' then
    return jsonb_build_object('ok', false, 'reason', 'not_public');
  end if;

  if v_ag.created_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  update public.agendamentos
    set push_enviado_em = now()
    where id = v_ag.id;

  return jsonb_build_object(
    'ok', true,
    'barbeiro_id', v_ag.barbeiro_id,
    'inicio', v_ag.inicio,
    'cliente_id', v_ag.cliente_id
  );
end;
$$;

grant execute on function public.claim_push_notification(uuid, text) to anon, authenticated, service_role;
revoke all on function public.assert_acesso_agendamento(uuid) from public, anon, authenticated;

-- Re-grant staff RPCs after replace
grant execute on function public.simular_resposta_cliente(uuid, text) to authenticated;
grant execute on function public.desfazer_acao_ia(uuid) to authenticated;
grant execute on function public.disparar_lembretes() to authenticated, service_role;
grant execute on function public.processar_sem_resposta() to authenticated, service_role;

-- Relatório: incluir aguardando no faturamento opcional? Melhor: contar confirmados+reagendados+concluidos+aguardando como pipeline
create or replace function public.relatorio_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_atendimentos int;
  v_faturamento numeric;
  v_por_hora jsonb;
  v_por_barbeiro jsonb;
  v_pipeline int;
begin
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  select count(*) into v_pipeline
  from public.agendamentos a
  where a.status <> 'cancelado'
    and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and (
      public.current_papel() = 'dono'
      or a.barbeiro_id = public.current_barbeiro_id()
    );

  select count(*), coalesce(sum(s.preco), 0)
  into v_atendimentos, v_faturamento
  from public.agendamentos a
  join public.servicos s on s.id = a.servico_id
  where a.status in ('confirmado', 'reagendado', 'concluido', 'aguardando')
    and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and (
      public.current_papel() = 'dono'
      or a.barbeiro_id = public.current_barbeiro_id()
    );

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_por_hora
  from (
    select extract(hour from a.inicio at time zone 'America/Sao_Paulo')::int as hora,
           count(*) as qtd
    from public.agendamentos a
    where a.status in ('confirmado', 'reagendado', 'concluido', 'aguardando')
      and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (
        public.current_papel() = 'dono'
        or a.barbeiro_id = public.current_barbeiro_id()
      )
    group by 1
    order by 1
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_por_barbeiro
  from (
    select b.nome,
           count(*) as atendimentos,
           coalesce(sum(s.preco), 0) as faturamento,
           coalesce(
             sum(
               case
                 when c.tipo = 'percentual' then s.preco * c.valor / 100.0
                 when c.tipo = 'valor_fixo' then c.valor
                 else 0
               end
             ), 0
           ) as comissao
    from public.agendamentos a
    join public.barbeiros b on b.id = a.barbeiro_id
    join public.servicos s on s.id = a.servico_id
    left join public.comissoes c on c.barbeiro_id = b.id and c.ativo
    where a.status in ('confirmado', 'reagendado', 'concluido', 'aguardando')
      and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (
        public.current_papel() = 'dono'
        or a.barbeiro_id = public.current_barbeiro_id()
      )
    group by b.nome
    order by faturamento desc
  ) x;

  return jsonb_build_object(
    'atendimentos', v_atendimentos,
    'pipeline', v_pipeline,
    'faturamento', v_faturamento,
    'por_hora', v_por_hora,
    'por_barbeiro', v_por_barbeiro
  );
end;
$$;

grant execute on function public.relatorio_resumo(date, date) to authenticated;

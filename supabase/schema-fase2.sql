-- =====================================================================
-- Fase 2 + 3 — mensagens, IA, comissões (rode DEPOIS de schema.sql)
-- =====================================================================

alter table public.barbearia
  add column if not exists canal_mensagens text not null default 'simulacao'
    check (canal_mensagens in ('simulacao', 'whatsapp'));

alter table public.agendamentos
  add column if not exists lembrete_enviado_em timestamptz,
  add column if not exists conversa_estado text not null default 'idle'
    check (conversa_estado in ('idle', 'aguardando_confirmacao', 'oferecendo_horarios', 'encerrada'));

create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid references public.agendamentos(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  direcao text not null check (direcao in ('enviada', 'recebida')),
  canal text not null default 'simulacao' check (canal in ('simulacao', 'whatsapp', 'sistema')),
  texto text not null check (char_length(trim(texto)) between 1 and 2000),
  intent_detectado text,
  acao_ia text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mensagens_agendamento_idx
  on public.mensagens (agendamento_id, created_at);
create index if not exists mensagens_created_idx
  on public.mensagens (created_at desc);

create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  barbeiro_id uuid not null references public.barbeiros(id) on delete cascade,
  tipo text not null default 'percentual' check (tipo in ('percentual', 'valor_fixo')),
  valor numeric(10,2) not null check (valor >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (barbeiro_id)
);

alter table public.mensagens enable row level security;
alter table public.comissoes enable row level security;

drop policy if exists mensagens_staff on public.mensagens;
create policy mensagens_staff on public.mensagens
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists comissoes_staff on public.comissoes;
create policy comissoes_staff on public.comissoes
  for all to authenticated
  using (public.is_staff())
  with check (public.current_papel() = 'dono' or public.is_staff());

-- dono escreve comissões; barbeiro só lê a própria
drop policy if exists comissoes_staff on public.comissoes;
create policy comissoes_select on public.comissoes
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );

create policy comissoes_write_dono on public.comissoes
  for all to authenticated
  using (public.current_papel() = 'dono')
  with check (public.current_papel() = 'dono');

grant select, insert, update, delete on public.mensagens to authenticated;
grant select, insert, update, delete on public.comissoes to authenticated;
revoke all on public.mensagens from anon;
revoke all on public.comissoes from anon;

-- --------------------- Intent + processamento IA ---------------------

create or replace function public.detectar_intent(p_texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  t := lower(trim(unaccent(coalesce(p_texto, ''))));
  t := regexp_replace(t, '[^a-z0-9à-ú\s]', ' ', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');

  if t ~ '(nao posso|não posso|nao vou|não vou|cancel|desmarcar|impossível|impossivel)' then
    return 'cancelar';
  end if;
  if t ~ '(remarcar|reagendar|outro horario|outro horário|mais tarde|adiar|mudar|trocar)' then
    return 'remarcar';
  end if;
  if t ~ '^(sim|s|ok|confirmo|confirmado|pode ser|belez|fechado|vou|estarei|eu vou|claro|combinado)(\s|$)'
     or t ~ '(vou sim|pode confirmar|confirmado|estarei la|estarei lá)' then
    return 'confirmar';
  end if;
  if t ~ '^[1-5]$' then
    return 'escolher_slot';
  end if;
  return 'duvida';
end;
$$;

-- unaccent pode não existir: fallback
do $$
begin
  create extension if not exists unaccent;
exception when others then
  null;
end $$;

create or replace function public.detectar_intent(p_texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  t := lower(trim(coalesce(p_texto, '')));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9\s]', ' ', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');

  if t ~ '(nao posso|nao vou|cancel|desmarcar|impossivel)' then
    return 'cancelar';
  end if;
  if t ~ '(remarcar|reagendar|outro horario|mais tarde|adiar|mudar|trocar)' then
    return 'remarcar';
  end if;
  if t ~ '^(sim|s|ok|confirmo|confirmado|pode ser|belez|fechado|vou|estarei|claro|combinado)(\s|$)'
     or t ~ '(vou sim|pode confirmar|confirmado|estarei la)' then
    return 'confirmar';
  end if;
  if t ~ '^[1-5]$' then
    return 'escolher_slot';
  end if;
  return 'duvida';
end;
$$;

create or replace function public.registrar_mensagem(
  p_agendamento_id uuid,
  p_direcao text,
  p_texto text,
  p_canal text default 'simulacao',
  p_intent text default null,
  p_acao text default null,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_cliente uuid;
begin
  select cliente_id into v_cliente from public.agendamentos where id = p_agendamento_id;
  insert into public.mensagens (
    agendamento_id, cliente_id, direcao, canal, texto, intent_detectado, acao_ia, meta
  ) values (
    p_agendamento_id, v_cliente, p_direcao, p_canal, trim(p_texto), p_intent, p_acao, coalesce(p_meta, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.notificar_staff_agendamento(
  p_agendamento_id uuid,
  p_tipo text,
  p_titulo text,
  p_texto text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barbeiro uuid;
begin
  select barbeiro_id into v_barbeiro from public.agendamentos where id = p_agendamento_id;
  insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
  select u.id, p_tipo, p_titulo, p_texto, p_agendamento_id
  from public.usuarios u
  where u.ativo and (u.papel = 'dono' or u.barbeiro_id = v_barbeiro);
end;
$$;

-- Dispara lembretes para janela configurada
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
      r.nome,
      r.servico,
      r.barbeiro,
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

-- Sem resposta: marca precisa_atencao (regra configurável)
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

-- Processa resposta do cliente (IA segura: só usa slots do sistema)
create or replace function public.processar_resposta_cliente(
  p_agendamento_id uuid,
  p_texto text,
  p_canal text default 'simulacao'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag public.agendamentos%rowtype;
  v_intent text;
  v_reply text;
  v_acao text;
  v_slots record;
  v_opcoes jsonb := '[]'::jsonb;
  v_idx int := 0;
  v_escolha int;
  v_slot_inicio timestamptz;
  v_duracao int;
  v_fim timestamptz;
  v_meta jsonb := '{}'::jsonb;
begin
  select * into v_ag from public.agendamentos where id = p_agendamento_id for update;
  if not found then
    raise exception 'AGENDAMENTO_INVALIDO' using errcode = 'P0001';
  end if;

  if v_ag.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'reply', 'Este horário já foi cancelado.');
  end if;

  v_intent := public.detectar_intent(p_texto);
  perform public.registrar_mensagem(p_agendamento_id, 'recebida', p_texto, p_canal, v_intent, null, '{}'::jsonb);

  -- escolha numérica enquanto oferece slots
  if v_ag.conversa_estado = 'oferecendo_horarios' and v_intent = 'escolher_slot' then
    v_escolha := p_texto::int;
    select meta into v_meta
    from public.mensagens
    where agendamento_id = p_agendamento_id and acao_ia = 'oferecer_slots'
    order by created_at desc limit 1;

    v_slot_inicio := ((v_meta -> 'slots') -> (v_escolha - 1) ->> 'inicio')::timestamptz;
    if v_slot_inicio is null then
      v_reply := 'Opção inválida. Responda com o número de um dos horários oferecidos.';
      perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, null, 'opcao_invalida', '{}'::jsonb);
      return jsonb_build_object('ok', false, 'intent', v_intent, 'reply', v_reply);
    end if;

    select duracao_min into v_duracao from public.servicos where id = v_ag.servico_id;
    v_fim := v_slot_inicio + make_interval(mins => v_duracao);

    if not exists (
      select 1 from public.listar_slots(v_ag.barbeiro_id, v_ag.servico_id, (v_slot_inicio at time zone 'America/Sao_Paulo')::date) s
      where s.inicio = v_slot_inicio
    ) then
      v_reply := 'Esse horário acabou de ficar indisponível. Peça REMARCAR de novo.';
      perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, null, 'slot_perdido', '{}'::jsonb);
      return jsonb_build_object('ok', false, 'reply', v_reply);
    end if;

    update public.agendamentos
      set horario_anterior_inicio = inicio,
          horario_anterior_fim = fim,
          inicio = v_slot_inicio,
          fim = v_fim,
          status = 'reagendado',
          origem = 'ia',
          conversa_estado = 'encerrada'
      where id = v_ag.id;

    v_acao := 'reagendou';
    v_reply := format('Pronto! Remarcado para %s. Até lá!',
      to_char(v_slot_inicio at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI'));
    perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, v_acao, '{}'::jsonb);
    perform public.notificar_staff_agendamento(p_agendamento_id, 'reagendado', 'IA remarcou', v_reply);
    return jsonb_build_object('ok', true, 'intent', v_intent, 'acao', v_acao, 'reply', v_reply);
  end if;

  if v_intent = 'confirmar' then
    update public.agendamentos
      set status = 'confirmado', conversa_estado = 'encerrada'
      where id = v_ag.id;
    v_acao := 'confirmou';
    v_reply := 'Confirmado! Te esperamos no horário marcado.';
    perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, v_acao, '{}'::jsonb);
    perform public.notificar_staff_agendamento(p_agendamento_id, 'confirmado', 'Cliente confirmou', 'IA confirmou o horário.');
    return jsonb_build_object('ok', true, 'intent', v_intent, 'acao', v_acao, 'reply', v_reply);
  end if;

  if v_intent = 'cancelar' then
    update public.agendamentos
      set status = 'cancelado', conversa_estado = 'encerrada'
      where id = v_ag.id;
    v_acao := 'cancelou';
    v_reply := 'Horário cancelado. Se quiser, agende de novo pelo link da barbearia.';
    perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, v_acao, '{}'::jsonb);
    perform public.notificar_staff_agendamento(p_agendamento_id, 'cancelado', 'Cliente cancelou', 'IA cancelou o horário.');
    return jsonb_build_object('ok', true, 'intent', v_intent, 'acao', v_acao, 'reply', v_reply);
  end if;

  if v_intent = 'remarcar' then
    v_opcoes := '[]'::jsonb;
    v_idx := 0;
    for v_slots in
      select s.inicio, s.fim
      from public.listar_slots(
        v_ag.barbeiro_id,
        v_ag.servico_id,
        (now() at time zone 'America/Sao_Paulo')::date
      ) s
      where s.inicio > now()
      limit 5
    loop
      v_idx := v_idx + 1;
      v_opcoes := v_opcoes || jsonb_build_array(jsonb_build_object(
        'n', v_idx,
        'inicio', v_slots.inicio,
        'fim', v_slots.fim,
        'label', to_char(v_slots.inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      ));
    end loop;

    -- se poucos hoje, tenta amanhã
    if jsonb_array_length(v_opcoes) < 3 then
      for v_slots in
        select s.inicio, s.fim
        from public.listar_slots(
          v_ag.barbeiro_id,
          v_ag.servico_id,
          ((now() at time zone 'America/Sao_Paulo')::date + 1)
        ) s
        limit 5
      loop
        exit when jsonb_array_length(v_opcoes) >= 5;
        v_idx := v_idx + 1;
        v_opcoes := v_opcoes || jsonb_build_array(jsonb_build_object(
          'n', v_idx,
          'inicio', v_slots.inicio,
          'fim', v_slots.fim,
          'label', to_char(v_slots.inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
        ));
      end loop;
    end if;

    if jsonb_array_length(v_opcoes) = 0 then
      update public.agendamentos set status = 'precisa_atencao', conversa_estado = 'encerrada' where id = v_ag.id;
      v_reply := 'Não achei horário livre agora. Um barbeiro vai te ajudar.';
      perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, 'sem_slots', '{}'::jsonb);
      perform public.notificar_staff_agendamento(p_agendamento_id, 'precisa_atencao', 'Remarcação sem slot', v_reply);
      return jsonb_build_object('ok', false, 'intent', v_intent, 'reply', v_reply);
    end if;

    update public.agendamentos set conversa_estado = 'oferecendo_horarios' where id = v_ag.id;
    v_reply := 'Posso remarcar. Responda com o número:' || E'\n' ||
      (
        select string_agg(format('%s) %s', (x->>'n'), (x->>'label')), E'\n' order by (x->>'n')::int)
        from jsonb_array_elements(v_opcoes) x
      );
    perform public.registrar_mensagem(
      p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, 'oferecer_slots',
      jsonb_build_object('slots', v_opcoes)
    );
    return jsonb_build_object('ok', true, 'intent', v_intent, 'acao', 'oferecer_slots', 'reply', v_reply, 'slots', v_opcoes);
  end if;

  -- dúvida / fora do comum
  update public.agendamentos
    set status = 'precisa_atencao', conversa_estado = 'encerrada'
    where id = v_ag.id;
  v_acao := 'escalou';
  v_reply := 'Não entendi bem. Um barbeiro vai olhar e te responder.';
  perform public.registrar_mensagem(p_agendamento_id, 'enviada', v_reply, p_canal, v_intent, v_acao, '{}'::jsonb);
  perform public.notificar_staff_agendamento(
    p_agendamento_id, 'precisa_atencao', 'IA precisa de você',
    left(p_texto, 120)
  );
  return jsonb_build_object('ok', true, 'intent', v_intent, 'acao', v_acao, 'reply', v_reply);
exception
  when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
end;
$$;

-- Simulação: staff envia resposta como se fosse o cliente
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
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;
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
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

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

-- Relatórios simples
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
begin
  if not public.is_staff() then
    raise exception 'NAO_AUTORIZADO' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(s.preco), 0)
  into v_atendimentos, v_faturamento
  from public.agendamentos a
  join public.servicos s on s.id = a.servico_id
  where a.status in ('confirmado', 'reagendado', 'concluido')
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
    where a.status in ('confirmado', 'reagendado', 'concluido')
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
    where a.status in ('confirmado', 'reagendado', 'concluido')
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
    'faturamento', v_faturamento,
    'por_hora', v_por_hora,
    'por_barbeiro', v_por_barbeiro
  );
end;
$$;

grant execute on function public.disparar_lembretes() to authenticated;
grant execute on function public.processar_sem_resposta() to authenticated;
grant execute on function public.simular_resposta_cliente(uuid, text) to authenticated;
grant execute on function public.desfazer_acao_ia(uuid) to authenticated;
grant execute on function public.relatorio_resumo(date, date) to authenticated;
grant execute on function public.processar_resposta_cliente(uuid, text, text) to service_role;

-- Realtime mensagens (opcional)
-- alter publication supabase_realtime add table public.mensagens;

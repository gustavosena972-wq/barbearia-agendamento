-- =====================================================================
-- Harden v3 — token rotation + relatório split
-- =====================================================================

create or replace function public.gerenciar_agendamento_publico(
  p_agendamento_id uuid,
  p_token text,
  p_acao text,
  p_novo_inicio timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_ag public.agendamentos%rowtype;
  v_duracao int;
  v_fim timestamptz;
  v_slot_ok boolean;
  v_new_token text;
  v_new_hash text;
begin
  if p_acao not in ('cancelar', 'remarcar') then
    raise exception 'ACAO_INVALIDA' using errcode = 'P0001';
  end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_ag
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found or v_ag.manage_token_hash is distinct from v_hash then
    raise exception 'TOKEN_INVALIDO' using errcode = 'P0001';
  end if;

  if v_ag.status = 'cancelado' then
    raise exception 'JA_CANCELADO' using errcode = 'P0001';
  end if;

  -- rotaciona token após qualquer ação válida
  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash := encode(digest(v_new_token, 'sha256'), 'hex');

  if p_acao = 'cancelar' then
    update public.agendamentos
      set status = 'cancelado',
          manage_token_hash = v_new_hash,
          updated_at = now()
      where id = v_ag.id;

    insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
    select u.id, 'cancelado', 'Agendamento cancelado',
           'Um cliente cancelou pelo link.',
           v_ag.id
    from public.usuarios u
    where u.ativo and (u.papel = 'dono' or u.barbeiro_id = v_ag.barbeiro_id);

    return jsonb_build_object('ok', true, 'status', 'cancelado', 'manage_token', v_new_token);
  end if;

  if p_novo_inicio is null then
    raise exception 'NOVO_HORARIO_OBRIGATORIO' using errcode = 'P0001';
  end if;

  select duracao_min into v_duracao from public.servicos where id = v_ag.servico_id;
  v_fim := p_novo_inicio + make_interval(mins => v_duracao);

  select exists (
    select 1 from public.listar_slots(
      v_ag.barbeiro_id,
      v_ag.servico_id,
      (p_novo_inicio at time zone 'America/Sao_Paulo')::date
    ) s where s.inicio = p_novo_inicio
  ) into v_slot_ok;

  if not v_slot_ok then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
  end if;

  update public.agendamentos
    set horario_anterior_inicio = inicio,
        horario_anterior_fim = fim,
        inicio = p_novo_inicio,
        fim = v_fim,
        status = 'reagendado',
        manage_token_hash = v_new_hash,
        updated_at = now()
    where id = v_ag.id;

  insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
  select u.id, 'reagendado', 'Cliente remarcou',
         to_char(p_novo_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
         v_ag.id
  from public.usuarios u
  where u.ativo and (u.papel = 'dono' or u.barbeiro_id = v_ag.barbeiro_id);

  return jsonb_build_object(
    'ok', true,
    'status', 'reagendado',
    'inicio', p_novo_inicio,
    'fim', v_fim,
    'manage_token', v_new_token
  );
exception
  when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
end;
$$;

grant execute on function public.gerenciar_agendamento_publico(uuid, text, text, timestamptz) to anon, authenticated;

-- Relatório: pipeline vs realizado
create or replace function public.relatorio_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pipeline int;
  v_realizados int;
  v_faturamento numeric;
  v_faturamento_pipeline numeric;
  v_por_hora jsonb;
  v_por_barbeiro jsonb;
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
  into v_realizados, v_faturamento
  from public.agendamentos a
  join public.servicos s on s.id = a.servico_id
  where a.status in ('confirmado', 'reagendado', 'concluido')
    and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and (
      public.current_papel() = 'dono'
      or a.barbeiro_id = public.current_barbeiro_id()
    );

  select coalesce(sum(s.preco), 0) into v_faturamento_pipeline
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
           count(*) filter (where a.status in ('confirmado', 'reagendado', 'concluido')) as atendimentos,
           count(*) filter (where a.status <> 'cancelado') as pipeline,
           coalesce(sum(s.preco) filter (where a.status in ('confirmado', 'reagendado', 'concluido')), 0) as faturamento,
           coalesce(
             sum(
               case
                 when a.status in ('confirmado', 'reagendado', 'concluido') and c.tipo = 'percentual'
                   then s.preco * c.valor / 100.0
                 when a.status in ('confirmado', 'reagendado', 'concluido') and c.tipo = 'valor_fixo'
                   then c.valor
                 else 0
               end
             ), 0
           ) as comissao
    from public.agendamentos a
    join public.barbeiros b on b.id = a.barbeiro_id
    join public.servicos s on s.id = a.servico_id
    left join public.comissoes c on c.barbeiro_id = b.id and c.ativo
    where (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and a.status <> 'cancelado'
      and (
        public.current_papel() = 'dono'
        or a.barbeiro_id = public.current_barbeiro_id()
      )
    group by b.nome
    order by faturamento desc
  ) x;

  return jsonb_build_object(
    'pipeline', v_pipeline,
    'atendimentos', v_realizados,
    'faturamento', v_faturamento,
    'faturamento_pipeline', v_faturamento_pipeline,
    'por_hora', v_por_hora,
    'por_barbeiro', v_por_barbeiro
  );
end;
$$;

grant execute on function public.relatorio_resumo(date, date) to authenticated;

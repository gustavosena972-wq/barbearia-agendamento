-- AUTO-GERADO por scripts/build-schema-all.mjs — NÃO edite à mão
-- Ordem: schema → fase2 → harden → harden-v2 → harden-v3 → prod → realtime
-- Banco novo: cole este arquivo inteiro no SQL Editor do Supabase.


-- ========== schema.sql ==========

-- =====================================================================
-- Barbearia Agendamento — schema MVP (segurança reforçada)
-- Rode UMA VEZ no SQL Editor do Supabase (projeto dedicado).
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- --------------------- HELPERS ---------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_usuario_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select id from public.usuarios where auth_user_id = auth.uid() limit 1);
end;
$$;

create or replace function public.current_papel()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select papel from public.usuarios where auth_user_id = auth.uid() limit 1);
end;
$$;

create or replace function public.current_barbeiro_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select barbeiro_id from public.usuarios where auth_user_id = auth.uid() limit 1);
end;
$$;

create or replace function public.is_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.usuarios
    where auth_user_id = auth.uid() and ativo = true
  );
end;
$$;

-- --------------------- TABELAS ---------------------
create table if not exists public.barbearia (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 120),
  telefone text,
  endereco text,
  logo_url text,
  exibir_precos boolean not null default true,
  setup_completo boolean not null default false,
  lembrete_horas_antes int not null default 24 check (lembrete_horas_antes between 1 and 168),
  regra_sem_resposta text not null default 'avisar_barbeiro'
    check (regra_sem_resposta in ('avisar_barbeiro', 'manter_aguardando')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 80),
  email text not null unique,
  papel text not null check (papel in ('dono', 'barbeiro')),
  barbeiro_id uuid,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barbeiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 80),
  foto_url text,
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.usuarios
  drop constraint if exists usuarios_barbeiro_id_fkey;
alter table public.usuarios
  add constraint usuarios_barbeiro_id_fkey
  foreign key (barbeiro_id) references public.barbeiros(id) on delete set null;

create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 80),
  duracao_min int not null check (duracao_min between 5 and 480),
  preco numeric(10,2) not null check (preco >= 0),
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barbeiro_servicos (
  barbeiro_id uuid not null references public.barbeiros(id) on delete cascade,
  servico_id uuid not null references public.servicos(id) on delete cascade,
  primary key (barbeiro_id, servico_id)
);

create table if not exists public.horarios_trabalho (
  id uuid primary key default gen_random_uuid(),
  barbeiro_id uuid not null references public.barbeiros(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6), -- 0=domingo
  inicio time not null,
  fim time not null,
  almoco_inicio time,
  almoco_fim time,
  check (inicio < fim),
  check (
    (almoco_inicio is null and almoco_fim is null)
    or (almoco_inicio is not null and almoco_fim is not null and almoco_inicio < almoco_fim
        and almoco_inicio >= inicio and almoco_fim <= fim)
  ),
  unique (barbeiro_id, dia_semana)
);

create table if not exists public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  barbeiro_id uuid not null references public.barbeiros(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text not null default 'bloqueio' check (char_length(trim(motivo)) between 2 and 120),
  created_by uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  check (inicio < fim)
);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 80),
  telefone text not null check (telefone ~ '^[0-9]{10,13}$'),
  consentimento_mensagens boolean not null default false,
  consentimento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telefone)
);

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  barbeiro_id uuid not null references public.barbeiros(id) on delete restrict,
  servico_id uuid not null references public.servicos(id) on delete restrict,
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'confirmado', 'reagendado', 'cancelado', 'precisa_atencao', 'concluido')),
  origem text not null default 'pagina'
    check (origem in ('pagina', 'manual', 'ia')),
  horario_anterior_inicio timestamptz,
  horario_anterior_fim timestamptz,
  manage_token_hash text not null,
  notas text,
  created_by uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (inicio < fim),
  -- faixa ativa para exclusão (cancelados não bloqueiam)
  excl_range tstzrange
    generated always as (
      case when status = 'cancelado' then null else tstzrange(inicio, fim, '[)') end
    ) stored
);

-- impede double-booking no mesmo barbeiro (nível banco)
create index if not exists agendamentos_barbeiro_inicio_idx
  on public.agendamentos (barbeiro_id, inicio);
create index if not exists agendamentos_status_idx
  on public.agendamentos (status);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agendamentos_sem_sobreposicao'
  ) then
    alter table public.agendamentos
      add constraint agendamentos_sem_sobreposicao
      exclude using gist (
        barbeiro_id with =,
        excl_range with &&
      )
      where (excl_range is not null);
  end if;
end $$;

create table if not exists public.dispositivos_push (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo text not null check (tipo in (
    'novo_agendamento', 'confirmado', 'reagendado', 'cancelado', 'precisa_atencao', 'sistema'
  )),
  titulo text not null,
  texto text not null,
  agendamento_id uuid references public.agendamentos(id) on delete set null,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notificacoes_usuario_idx
  on public.notificacoes (usuario_id, lida, created_at desc);

-- auditoria mínima de ações sensíveis
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_usuario_id uuid references public.usuarios(id) on delete set null,
  acao text not null,
  entidade text not null,
  entidade_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- rate limit simples por telefone (público)
create table if not exists public.booking_rate_limit (
  telefone text primary key,
  tentativas int not null default 0,
  janela_inicio timestamptz not null default now()
);

-- triggers updated_at
drop trigger if exists barbeiros_updated_at on public.barbeiros;
create trigger barbeiros_updated_at before update on public.barbeiros
  for each row execute function public.set_updated_at();

drop trigger if exists servicos_updated_at on public.servicos;
create trigger servicos_updated_at before update on public.servicos
  for each row execute function public.set_updated_at();

drop trigger if exists clientes_updated_at on public.clientes;
create trigger clientes_updated_at before update on public.clientes
  for each row execute function public.set_updated_at();

drop trigger if exists agendamentos_updated_at on public.agendamentos;
create trigger agendamentos_updated_at before update on public.agendamentos
  for each row execute function public.set_updated_at();

drop trigger if exists usuarios_updated_at on public.usuarios;
create trigger usuarios_updated_at before update on public.usuarios
  for each row execute function public.set_updated_at();

drop trigger if exists barbearia_updated_at on public.barbearia;
create trigger barbearia_updated_at before update on public.barbearia
  for each row execute function public.set_updated_at();

-- --------------------- FUNÇÕES PÚBLICAS (slots + booking) ---------------------

create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  if char_length(digits) = 11 and left(digits, 2) <> '55' then
    return digits;
  end if;
  if char_length(digits) = 10 then
    return digits;
  end if;
  if char_length(digits) = 13 and left(digits, 2) = '55' then
    return right(digits, 11);
  end if;
  if char_length(digits) = 12 and left(digits, 2) = '55' then
    return right(digits, 10);
  end if;
  return digits;
end;
$$;

create or replace function public.listar_slots(
  p_barbeiro_id uuid,
  p_servico_id uuid,
  p_data date
)
returns table (inicio timestamptz, fim timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_duracao int;
  v_dia smallint;
  v_ht record;
  v_cursor timestamptz;
  v_end timestamptz;
  v_slot_end timestamptz;
  v_almoco_ini timestamptz;
  v_almoco_fim timestamptz;
  v_step interval := interval '15 minutes';
begin
  if p_data < (timezone('America/Sao_Paulo', now()))::date then
    return;
  end if;

  select s.duracao_min into v_duracao
  from public.servicos s
  where s.id = p_servico_id and s.ativo = true;

  if v_duracao is null then
    return;
  end if;

  if not exists (
    select 1 from public.barbeiro_servicos bs
    where bs.barbeiro_id = p_barbeiro_id and bs.servico_id = p_servico_id
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.barbeiros b where b.id = p_barbeiro_id and b.ativo = true
  ) then
    return;
  end if;

  v_dia := extract(dow from p_data)::smallint;

  select * into v_ht
  from public.horarios_trabalho
  where barbeiro_id = p_barbeiro_id and dia_semana = v_dia;

  if not found then
    return;
  end if;

  v_cursor := (p_data + v_ht.inicio) at time zone 'America/Sao_Paulo';
  v_end := (p_data + v_ht.fim) at time zone 'America/Sao_Paulo';

  if v_ht.almoco_inicio is not null then
    v_almoco_ini := (p_data + v_ht.almoco_inicio) at time zone 'America/Sao_Paulo';
    v_almoco_fim := (p_data + v_ht.almoco_fim) at time zone 'America/Sao_Paulo';
  end if;

  while v_cursor + make_interval(mins => v_duracao) <= v_end loop
    v_slot_end := v_cursor + make_interval(mins => v_duracao);

    if v_cursor >= now()
       and (
         v_almoco_ini is null
         or v_slot_end <= v_almoco_ini
         or v_cursor >= v_almoco_fim
       )
       and not exists (
         select 1 from public.bloqueios bl
         where bl.barbeiro_id = p_barbeiro_id
           and tstzrange(bl.inicio, bl.fim, '[)') && tstzrange(v_cursor, v_slot_end, '[)')
       )
       and not exists (
         select 1 from public.agendamentos a
         where a.barbeiro_id = p_barbeiro_id
           and a.excl_range is not null
           and a.excl_range && tstzrange(v_cursor, v_slot_end, '[)')
       )
    then
      inicio := v_cursor;
      fim := v_slot_end;
      return next;
    end if;

    v_cursor := v_cursor + v_step;
  end loop;
end;
$$;

create or replace function public.criar_agendamento_publico(
  p_barbeiro_id uuid,
  p_servico_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_telefone text,
  p_consentimento boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_nome text;
  v_duracao int;
  v_fim timestamptz;
  v_cliente_id uuid;
  v_token text;
  v_hash text;
  v_ag_id uuid;
  v_rl record;
  v_slot_ok boolean;
begin
  if coalesce(p_consentimento, false) is not true then
    raise exception 'CONSENTIMENTO_OBRIGATORIO' using errcode = 'P0001';
  end if;

  v_nome := trim(p_nome);
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    raise exception 'NOME_INVALIDO' using errcode = 'P0001';
  end if;

  v_phone := public.normalize_phone(p_telefone);
  if v_phone !~ '^[0-9]{10,11}$' then
    raise exception 'TELEFONE_INVALIDO' using errcode = 'P0001';
  end if;

  -- rate limit: máx 5 tentativas / 15 min por telefone
  select * into v_rl from public.booking_rate_limit where telefone = v_phone for update;
  if found then
    if v_rl.janela_inicio > now() - interval '15 minutes' then
      if v_rl.tentativas >= 5 then
        raise exception 'RATE_LIMIT' using errcode = 'P0001';
      end if;
      update public.booking_rate_limit
        set tentativas = tentativas + 1
        where telefone = v_phone;
    else
      update public.booking_rate_limit
        set tentativas = 1, janela_inicio = now()
        where telefone = v_phone;
    end if;
  else
    insert into public.booking_rate_limit (telefone, tentativas, janela_inicio)
    values (v_phone, 1, now());
  end if;

  if p_inicio < now() + interval '5 minutes' then
    raise exception 'HORARIO_PASSADO' using errcode = 'P0001';
  end if;

  select s.duracao_min into v_duracao
  from public.servicos s where s.id = p_servico_id and s.ativo;

  if v_duracao is null then
    raise exception 'SERVICO_INVALIDO' using errcode = 'P0001';
  end if;

  v_fim := p_inicio + make_interval(mins => v_duracao);

  -- revalida slot no momento da confirmação
  select exists (
    select 1 from public.listar_slots(
      p_barbeiro_id,
      p_servico_id,
      (p_inicio at time zone 'America/Sao_Paulo')::date
    ) s
    where s.inicio = p_inicio
  ) into v_slot_ok;

  if not v_slot_ok then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
  end if;

  insert into public.clientes (nome, telefone, consentimento_mensagens, consentimento_em)
  values (v_nome, v_phone, true, now())
  on conflict (telefone) do update
    set nome = excluded.nome,
        consentimento_mensagens = true,
        consentimento_em = now(),
        updated_at = now()
  returning id into v_cliente_id;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.agendamentos (
    cliente_id, barbeiro_id, servico_id, inicio, fim, status, origem, manage_token_hash
  ) values (
    v_cliente_id, p_barbeiro_id, p_servico_id, p_inicio, v_fim, 'aguardando', 'pagina', v_hash
  )
  returning id into v_ag_id;

  -- notificações internas para dono + barbeiro vinculado
  insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
  select u.id, 'novo_agendamento',
         'Novo agendamento',
         format('%s — %s', v_nome, to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
         v_ag_id
  from public.usuarios u
  where u.ativo = true
    and (
      u.papel = 'dono'
      or u.barbeiro_id = p_barbeiro_id
    );

  insert into public.audit_log (acao, entidade, entidade_id, meta)
  values (
    'criar_publico',
    'agendamentos',
    v_ag_id,
    jsonb_build_object('barbeiro_id', p_barbeiro_id, 'telefone_sufixo', right(v_phone, 4))
  );

  return jsonb_build_object(
    'id', v_ag_id,
    'inicio', p_inicio,
    'fim', v_fim,
    'manage_token', v_token
  );
exception
  when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
end;
$$;

create or replace function public.gerenciar_agendamento_publico(
  p_agendamento_id uuid,
  p_token text,
  p_acao text, -- cancelar | remarcar
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

  if p_acao = 'cancelar' then
    update public.agendamentos
      set status = 'cancelado', updated_at = now()
      where id = v_ag.id;

    insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
    select u.id, 'cancelado', 'Agendamento cancelado',
           'Um cliente cancelou pelo link.',
           v_ag.id
    from public.usuarios u
    where u.ativo and (u.papel = 'dono' or u.barbeiro_id = v_ag.barbeiro_id);

    return jsonb_build_object('ok', true, 'status', 'cancelado');
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
        updated_at = now()
    where id = v_ag.id;

  insert into public.notificacoes (usuario_id, tipo, titulo, texto, agendamento_id)
  select u.id, 'reagendado', 'Cliente remarcou',
         to_char(p_novo_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
         v_ag.id
  from public.usuarios u
  where u.ativo and (u.papel = 'dono' or u.barbeiro_id = v_ag.barbeiro_id);

  return jsonb_build_object('ok', true, 'status', 'reagendado', 'inicio', p_novo_inicio, 'fim', v_fim);
exception
  when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
end;
$$;

create or replace function public.obter_agendamento_publico(
  p_agendamento_id uuid,
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row record;
begin
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select a.id, a.inicio, a.fim, a.status,
         a.barbeiro_id, a.servico_id,
         c.nome as cliente_nome,
         b.nome as barbeiro_nome,
         s.nome as servico_nome,
         s.duracao_min,
         s.preco,
         br.exibir_precos
  into v_row
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  join public.barbeiros b on b.id = a.barbeiro_id
  join public.servicos s on s.id = a.servico_id
  left join lateral (select exibir_precos from public.barbearia order by created_at limit 1) br on true
  where a.id = p_agendamento_id
    and a.manage_token_hash = v_hash;

  if not found then
    raise exception 'TOKEN_INVALIDO' using errcode = 'P0001';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- catálogo público (somente ativos)
create or replace function public.catalogo_publico()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop jsonb;
begin
  select jsonb_build_object(
    'nome', b.nome,
    'telefone', b.telefone,
    'endereco', b.endereco,
    'exibir_precos', b.exibir_precos,
    'setup_completo', b.setup_completo
  )
  into v_shop
  from public.barbearia b
  order by b.created_at
  limit 1;

  if v_shop is null or (v_shop->>'setup_completo')::boolean is not true then
    return jsonb_build_object('ready', false);
  end if;

  return jsonb_build_object(
    'ready', true,
    'barbearia', v_shop,
    'barbeiros', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', br.id,
        'nome', br.nome,
        'foto_url', br.foto_url,
        'servico_ids', coalesce((
          select jsonb_agg(bs.servico_id)
          from public.barbeiro_servicos bs where bs.barbeiro_id = br.id
        ), '[]'::jsonb)
      ) order by br.ordem, br.nome)
      from public.barbeiros br where br.ativo
    ), '[]'::jsonb),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'nome', s.nome,
        'duracao_min', s.duracao_min,
        'preco', s.preco
      ) order by s.ordem, s.nome)
      from public.servicos s where s.ativo
    ), '[]'::jsonb)
  );
end;
$$;

-- --------------------- RLS ---------------------
alter table public.barbearia enable row level security;
alter table public.usuarios enable row level security;
alter table public.barbeiros enable row level security;
alter table public.servicos enable row level security;
alter table public.barbeiro_servicos enable row level security;
alter table public.horarios_trabalho enable row level security;
alter table public.bloqueios enable row level security;
alter table public.clientes enable row level security;
alter table public.agendamentos enable row level security;
alter table public.dispositivos_push enable row level security;
alter table public.notificacoes enable row level security;
alter table public.audit_log enable row level security;
alter table public.booking_rate_limit enable row level security;

-- revoke direct access from anon/authenticated; grant via policies / RPCs
revoke all on public.booking_rate_limit from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;

-- barbearia
drop policy if exists barbearia_staff_all on public.barbearia;
create policy barbearia_staff_all on public.barbearia
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff() and public.current_papel() = 'dono');

-- usuarios: cada um lê o próprio; dono lê todos
drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios
  for select to authenticated
  using (auth_user_id = auth.uid() or public.current_papel() = 'dono');

drop policy if exists usuarios_update_self on public.usuarios;
create policy usuarios_update_self on public.usuarios
  for update to authenticated
  using (auth_user_id = auth.uid() or public.current_papel() = 'dono')
  with check (auth_user_id = auth.uid() or public.current_papel() = 'dono');

drop policy if exists usuarios_insert_dono on public.usuarios;
create policy usuarios_insert_dono on public.usuarios
  for insert to authenticated
  with check (public.current_papel() = 'dono');

-- barbeiros / servicos / vínculos / horários / bloqueios: staff
drop policy if exists barbeiros_staff on public.barbeiros;
create policy barbeiros_staff on public.barbeiros
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists servicos_staff on public.servicos;
create policy servicos_staff on public.servicos
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists barbeiro_servicos_staff on public.barbeiro_servicos;
create policy barbeiro_servicos_staff on public.barbeiro_servicos
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists horarios_staff on public.horarios_trabalho;
create policy horarios_staff on public.horarios_trabalho
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists bloqueios_staff on public.bloqueios;
create policy bloqueios_staff on public.bloqueios
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- clientes: staff only
drop policy if exists clientes_staff on public.clientes;
create policy clientes_staff on public.clientes
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- agendamentos: dono vê todos; barbeiro só os seus
drop policy if exists agendamentos_select on public.agendamentos;
create policy agendamentos_select on public.agendamentos
  for select to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );

drop policy if exists agendamentos_write on public.agendamentos;
create policy agendamentos_write on public.agendamentos
  for all to authenticated
  using (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  )
  with check (
    public.current_papel() = 'dono'
    or barbeiro_id = public.current_barbeiro_id()
  );

-- push devices / notificações: só o próprio usuário
drop policy if exists push_own on public.dispositivos_push;
create policy push_own on public.dispositivos_push
  for all to authenticated
  using (usuario_id = public.current_usuario_id())
  with check (usuario_id = public.current_usuario_id());

drop policy if exists notif_own on public.notificacoes;
create policy notif_own on public.notificacoes
  for all to authenticated
  using (usuario_id = public.current_usuario_id())
  with check (usuario_id = public.current_usuario_id());

-- grants RPC
grant execute on function public.catalogo_publico() to anon, authenticated;
grant execute on function public.listar_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.criar_agendamento_publico(uuid, uuid, timestamptz, text, text, boolean) to anon, authenticated;
grant execute on function public.gerenciar_agendamento_publico(uuid, text, text, timestamptz) to anon, authenticated;
grant execute on function public.obter_agendamento_publico(uuid, text) to anon, authenticated;

-- seed demo (idempotente-ish: só se vazio)
do $$
begin
  if not exists (select 1 from public.barbearia) then
    insert into public.barbearia (nome, telefone, endereco, exibir_precos, setup_completo)
    values ('Barbearia Demo', '31999990000', 'Rua Exemplo, 100 — BH', true, false);
  end if;
end $$;

-- privilégios de tabela (RLS continua mandando)
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.barbearia,
  public.usuarios,
  public.barbeiros,
  public.servicos,
  public.barbeiro_servicos,
  public.horarios_trabalho,
  public.bloqueios,
  public.clientes,
  public.agendamentos,
  public.dispositivos_push,
  public.notificacoes
to authenticated;

revoke all on public.barbearia from anon;
revoke all on public.usuarios from anon;
revoke all on public.barbeiros from anon;
revoke all on public.servicos from anon;
revoke all on public.barbeiro_servicos from anon;
revoke all on public.horarios_trabalho from anon;
revoke all on public.bloqueios from anon;
revoke all on public.clientes from anon;
revoke all on public.agendamentos from anon;
revoke all on public.dispositivos_push from anon;
revoke all on public.notificacoes from anon;
revoke all on public.audit_log from anon;
revoke all on public.booking_rate_limit from anon;

-- privilégios de tabela (RLS continua mandando)
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.barbearia,
  public.usuarios,
  public.barbeiros,
  public.servicos,
  public.barbeiro_servicos,
  public.horarios_trabalho,
  public.bloqueios,
  public.clientes,
  public.agendamentos,
  public.dispositivos_push,
  public.notificacoes
to authenticated;

revoke all on public.barbearia from anon;
revoke all on public.usuarios from anon;
revoke all on public.barbeiros from anon;
revoke all on public.servicos from anon;
revoke all on public.barbeiro_servicos from anon;
revoke all on public.horarios_trabalho from anon;
revoke all on public.bloqueios from anon;
revoke all on public.clientes from anon;
revoke all on public.agendamentos from anon;
revoke all on public.dispositivos_push from anon;
revoke all on public.notificacoes from anon;
revoke all on public.audit_log from anon;
revoke all on public.booking_rate_limit from anon;



-- ========== schema-fase2.sql ==========

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



-- ========== schema-harden.sql ==========

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



-- ========== schema-harden-v2.sql ==========

-- Residual harden v2
drop policy if exists barbearia_staff_all on public.barbearia;
create policy barbearia_select on public.barbearia
  for select to authenticated
  using (public.is_staff());
create policy barbearia_write_dono on public.barbearia
  for insert to authenticated
  with check (public.current_papel() = 'dono');
create policy barbearia_update_dono on public.barbearia
  for update to authenticated
  using (public.current_papel() = 'dono')
  with check (public.current_papel() = 'dono');
create policy barbearia_delete_dono on public.barbearia
  for delete to authenticated
  using (public.current_papel() = 'dono');

-- claim_push só via service_role (edge function)
revoke all on function public.claim_push_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_push_notification(uuid, text) to service_role;



-- ========== schema-harden-v3.sql ==========

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



-- ========== schema-prod.sql ==========

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



-- ========== realtime.sql ==========

-- Habilitar Realtime no sino do painel (Dashboard → Database → Replication)
-- Ou rode:
alter publication supabase_realtime add table public.notificacoes;


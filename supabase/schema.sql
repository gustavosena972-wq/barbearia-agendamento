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

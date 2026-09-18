-- Grants adicionais (rode após schema.sql se as policies existirem sem privilégio)
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

-- anon: sem acesso direto às tabelas (só RPCs)
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

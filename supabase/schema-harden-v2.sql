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

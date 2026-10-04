-- Marcações com vários serviços e agendamentos recorrentes, parte 3: permissões.
-- Leitura pela equipe; gravação somente pelas funções (que conferem o perfil e registram histórico).

revoke all on table public.grupos_agendamento, public.series_agendamento from public, anon, authenticated;
alter table public.grupos_agendamento enable row level security;
alter table public.series_agendamento enable row level security;
grant select on public.grupos_agendamento, public.series_agendamento to authenticated;
create policy "equipe le marcacoes" on public.grupos_agendamento
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe le series" on public.series_agendamento
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));

revoke execute on function private.relancar(text, text, text, text) from public, anon, authenticated;
revoke execute on function private.travar_reservas(uuid[], uuid, uuid[]) from public, anon, authenticated;
revoke execute on function private.inserir_reserva(uuid, uuid, uuid, uuid, timestamptz, text, boolean, text, uuid, integer, uuid, integer, text) from public, anon, authenticated;
revoke execute on function private.revalidar_reserva(uuid, text) from public, anon, authenticated;
revoke execute on function private.exigir_versoes(uuid[], jsonb) from public, anon, authenticated;
revoke execute on function private.datas_serie(date, text, integer, date, text) from public, anon, authenticated;
revoke execute on function private.validar_ocorrencia(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke execute on function private.ocorrencias_elegiveis(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.criar_grupo_agendamentos(uuid, uuid, jsonb, text, text) from public, anon;
revoke execute on function public.cancelar_grupo(uuid, text, jsonb) from public, anon;
revoke execute on function public.reagendar_grupo(uuid, date, time, text, jsonb, text) from public, anon;
revoke execute on function public.prever_serie(uuid, uuid, uuid, date, time, text, integer, date, text, text) from public, anon;
revoke execute on function public.criar_serie(uuid, uuid, uuid, uuid, date, time, text, integer, date, text, date[], text, text) from public, anon;
revoke execute on function public.cancelar_serie(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.reagendar_serie(uuid, uuid, time, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.agendamentos_vinculados(uuid, uuid) from public, anon;

grant execute on function public.criar_grupo_agendamentos(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.cancelar_grupo(uuid, text, jsonb) to authenticated;
grant execute on function public.reagendar_grupo(uuid, date, time, text, jsonb, text) to authenticated;
grant execute on function public.prever_serie(uuid, uuid, uuid, date, time, text, integer, date, text, text) to authenticated;
grant execute on function public.criar_serie(uuid, uuid, uuid, uuid, date, time, text, integer, date, text, date[], text, text) to authenticated;
grant execute on function public.cancelar_serie(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.reagendar_serie(uuid, uuid, time, uuid, text, jsonb, text) to authenticated;
grant execute on function public.agendamentos_vinculados(uuid, uuid) to authenticated;

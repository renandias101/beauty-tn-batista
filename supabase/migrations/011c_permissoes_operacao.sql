-- Operação da agenda, parte 3: permissões, RLS e sincronização.
-- Menor privilégio: as novas tabelas não recebem gravação direta, exceto cadastros da administração
-- (recursos, recursos por serviço e duração por profissional), protegidos por RLS.
-- Novas tabelas recebem GRANT explícito (o Supabase deixou de expor tabelas novas automaticamente).

revoke all on table public.recursos, public.servico_recursos, public.agendamento_recursos, public.comunicacoes,
  public.lista_espera, public.lista_espera_contatos, public.agenda_revisoes from public, anon, authenticated;

alter table public.recursos enable row level security;
alter table public.servico_recursos enable row level security;
alter table public.agendamento_recursos enable row level security;
alter table public.comunicacoes enable row level security;
alter table public.lista_espera enable row level security;
alter table public.lista_espera_contatos enable row level security;
alter table public.agenda_revisoes enable row level security;

-- Recursos: equipe lê; administração cadastra, ativa e desativa (sem exclusão física).
grant select, insert, update on public.recursos to authenticated;
create policy "equipe le recursos" on public.recursos
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "admin cadastra recursos" on public.recursos
  for insert to authenticated with check ((select private.papel_atual()) = 'admin');
create policy "admin altera recursos" on public.recursos
  for update to authenticated
  using ((select private.papel_atual()) = 'admin') with check ((select private.papel_atual()) = 'admin');

-- Recursos exigidos por serviço: equipe lê; administração inclui e retira.
grant select, insert, delete on public.servico_recursos to authenticated;
create policy "equipe le recursos dos servicos" on public.servico_recursos
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "admin vincula recursos" on public.servico_recursos
  for insert to authenticated with check ((select private.papel_atual()) = 'admin');
create policy "admin desvincula recursos" on public.servico_recursos
  for delete to authenticated using ((select private.papel_atual()) = 'admin');

-- Recursos reservados, comunicações e lista de espera: leitura da equipe; gravação só pelas funções.
grant select on public.agendamento_recursos, public.comunicacoes, public.lista_espera, public.lista_espera_contatos to authenticated;
create policy "equipe le recursos reservados" on public.agendamento_recursos
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe le comunicacoes" on public.comunicacoes
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe le lista de espera" on public.lista_espera
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe le contatos da lista de espera" on public.lista_espera_contatos
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));

-- Duração específica por profissional e serviço: somente a administração altera essa coluna.
grant update (duracao_minutos) on public.profissional_servicos to authenticated;
create policy "admin altera duracao por profissional" on public.profissional_servicos
  for update to authenticated
  using ((select private.papel_atual()) = 'admin') with check ((select private.papel_atual()) = 'admin');

-- Sinal de atualização: a equipe vê todos; o profissional, somente o próprio. Não contém dados de clientes.
grant select on public.agenda_revisoes to authenticated;
create policy "leitura do sinal da agenda" on public.agenda_revisoes
  for select to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria') or profissional_id = (select private.profissional_atual()));

-- Funções auxiliares e de gatilho: nunca chamáveis pela API.
revoke execute on function private.ocupa_periodo(public.status_agendamento) from public, anon, authenticated;
revoke execute on function private.incrementar_versao() from public, anon, authenticated;
revoke execute on function private.sinalizar_agenda() from public, anon, authenticated;
revoke execute on function private.duracao_efetiva(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.travar_cliente(uuid) from public, anon, authenticated;
revoke execute on function private.travar_recursos(uuid[]) from public, anon, authenticated;
revoke execute on function private.exigir_versao(integer, integer) from public, anon, authenticated;
revoke execute on function private.rotulo_status(public.status_agendamento) from public, anon, authenticated;
revoke execute on function private.descrever_atendimento(uuid) from public, anon, authenticated;
revoke execute on function private.validar_ocupacao_profissional(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function private.validar_reserva(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function private.recurso_disponivel(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function private.validar_recursos(uuid[], timestamptz, timestamptz, uuid, boolean) from public, anon, authenticated;
revoke execute on function private.resolver_conflito_cliente(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function private.mensagem_exclusao(text) from public, anon, authenticated;
revoke execute on function private.calcular_horarios(uuid, date, date, integer, integer, uuid[], uuid) from public, anon, authenticated;
revoke execute on function private.itens_agenda(uuid[], boolean) from public, anon, authenticated;
revoke execute on function private.validar_alteracao_recurso() from public, anon, authenticated;

-- Novas funções da API: somente quem precisa (cada uma também confere o perfil).
revoke execute on function public.horarios_livres(uuid, uuid, date, uuid, integer) from public, anon;
revoke execute on function public.duracao_publica(uuid, uuid) from public;
revoke execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, date, time, text, boolean, text, uuid) from public, anon;
revoke execute on function public.alterar_status_agendamento(uuid, public.status_agendamento, integer) from public, anon;
revoke execute on function public.cancelar_agendamento(uuid, text, integer) from public, anon;
revoke execute on function public.editar_agendamento(uuid, text, boolean, integer) from public, anon;
revoke execute on function public.reagendar_agendamento(uuid, date, time, uuid, text, integer, integer, text) from public, anon;
revoke execute on function public.corrigir_status_agendamento(uuid, public.status_agendamento, text, integer) from public, anon;
revoke execute on function public.registrar_comunicacao(uuid, uuid, text) from public, anon;
revoke execute on function public.listar_comunicacoes(uuid) from public, anon;
revoke execute on function public.criar_lista_espera(uuid, uuid, uuid, uuid, date, date, time, time, text) from public, anon;
revoke execute on function public.atualizar_lista_espera(uuid, text, text, integer) from public, anon;
revoke execute on function public.listar_lista_espera(text) from public, anon;
revoke execute on function public.contatos_lista_espera(uuid) from public, anon;
revoke execute on function public.candidatos_lista_espera(uuid, timestamptz, timestamptz) from public, anon;

grant execute on function public.horarios_livres(uuid, uuid, date, uuid, integer) to authenticated;
grant execute on function public.duracao_publica(uuid, uuid) to anon, authenticated;
grant execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, date, time, text, boolean, text, uuid) to authenticated;
grant execute on function public.alterar_status_agendamento(uuid, public.status_agendamento, integer) to authenticated;
grant execute on function public.cancelar_agendamento(uuid, text, integer) to authenticated;
grant execute on function public.editar_agendamento(uuid, text, boolean, integer) to authenticated;
grant execute on function public.reagendar_agendamento(uuid, date, time, uuid, text, integer, integer, text) to authenticated;
grant execute on function public.corrigir_status_agendamento(uuid, public.status_agendamento, text, integer) to authenticated;
grant execute on function public.registrar_comunicacao(uuid, uuid, text) to authenticated;
grant execute on function public.listar_comunicacoes(uuid) to authenticated;
grant execute on function public.criar_lista_espera(uuid, uuid, uuid, uuid, date, date, time, time, text) to authenticated;
grant execute on function public.atualizar_lista_espera(uuid, text, text, integer) to authenticated;
grant execute on function public.listar_lista_espera(text) to authenticated;
grant execute on function public.contatos_lista_espera(uuid) to authenticated;
grant execute on function public.candidatos_lista_espera(uuid, timestamptz, timestamptz) to authenticated;

-- Assinaturas anteriores (sem versão, sem verificação de conflito da cliente e de horário passado):
-- deixam de ser chamáveis pela aplicação. Permanecem no banco para não usar DROP nesta etapa.
revoke execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, date, time, text, boolean) from public, anon, authenticated;
revoke execute on function public.alterar_status_agendamento(uuid, public.status_agendamento) from public, anon, authenticated;
revoke execute on function public.cancelar_agendamento(uuid, text) from public, anon, authenticated;
revoke execute on function public.reagendar_agendamento(uuid, date, time, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.editar_agendamento(uuid, text, boolean) from public, anon, authenticated;

-- Sincronização: as mudanças do sinal são transmitidas pelo Supabase Realtime (respeitando a RLS acima).
-- Em bancos sem a publicação (ambiente de teste isolado), o passo é ignorado.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agenda_revisoes') then
    alter publication supabase_realtime add table public.agenda_revisoes;
  end if;
end $$;

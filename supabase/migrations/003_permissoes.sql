-- Permissões (seção 4 e 10 do PRD): menor privilégio, validado no banco.
-- Usuários sem perfil ativo não leem nem gravam nada. Gravações de agenda,
-- jornada e bloqueios só acontecem pelas funções das migrações 002.

-- Remove os privilégios padrão concedidos pelo Supabase e concede apenas o necessário.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon;

-- As políticas de RLS executam com o papel do usuário: ele precisa enxergar estas duas funções.
grant usage on schema private to authenticated;
grant execute on function private.papel_atual() to authenticated;
grant execute on function private.profissional_atual() to authenticated;

alter table public.configuracao_clinica enable row level security;
alter table public.perfis enable row level security;
alter table public.profissionais enable row level security;
alter table public.servicos enable row level security;
alter table public.profissional_servicos enable row level security;
alter table public.disponibilidades enable row level security;
alter table public.excecoes_disponibilidade enable row level security;
alter table public.bloqueios enable row level security;
alter table public.clientes enable row level security;
alter table public.agendamentos enable row level security;
alter table public.historico_agendamentos enable row level security;

-- Configuração: leitura para qualquer perfil ativo; alteração só pelo painel do banco.
grant select on public.configuracao_clinica to authenticated;
create policy "perfis ativos leem a configuracao" on public.configuracao_clinica
  for select to authenticated using ((select private.papel_atual()) is not null);

-- Perfis: cada um lê o próprio; administração lê todos. Gravação pela função de usuários (service role).
grant select on public.perfis to authenticated;
create policy "usuario le o proprio perfil ou admin le todos" on public.perfis
  for select to authenticated
  using (usuario_id = (select auth.uid()) or (select private.papel_atual()) = 'admin');

-- Profissionais: equipe administrativa lê todos; profissional lê o próprio cadastro; administração grava.
grant select, insert, update on public.profissionais to authenticated;
create policy "equipe le profissionais" on public.profissionais
  for select to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria') or id = (select private.profissional_atual()));
create policy "admin cadastra profissionais" on public.profissionais
  for insert to authenticated with check ((select private.papel_atual()) = 'admin');
create policy "admin altera profissionais" on public.profissionais
  for update to authenticated
  using ((select private.papel_atual()) = 'admin') with check ((select private.papel_atual()) = 'admin');

-- Serviços.
grant select, insert, update on public.servicos to authenticated;
create policy "perfis ativos leem servicos" on public.servicos
  for select to authenticated using ((select private.papel_atual()) is not null);
create policy "admin cadastra servicos" on public.servicos
  for insert to authenticated with check ((select private.papel_atual()) = 'admin');
create policy "admin altera servicos" on public.servicos
  for update to authenticated
  using ((select private.papel_atual()) = 'admin') with check ((select private.papel_atual()) = 'admin');

-- Habilitações profissional–serviço.
grant select, insert, delete on public.profissional_servicos to authenticated;
create policy "perfis ativos leem habilitacoes" on public.profissional_servicos
  for select to authenticated using ((select private.papel_atual()) is not null);
create policy "admin habilita servicos" on public.profissional_servicos
  for insert to authenticated with check ((select private.papel_atual()) = 'admin');
create policy "admin desabilita servicos" on public.profissional_servicos
  for delete to authenticated using ((select private.papel_atual()) = 'admin');

-- Jornada, exceções e bloqueios: leitura; gravação apenas pelas funções.
grant select on public.disponibilidades, public.excecoes_disponibilidade, public.bloqueios to authenticated;
create policy "leitura da jornada" on public.disponibilidades
  for select to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria') or profissional_id = (select private.profissional_atual()));
create policy "leitura das excecoes" on public.excecoes_disponibilidade
  for select to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria') or profissional_id = (select private.profissional_atual()));
create policy "leitura dos bloqueios" on public.bloqueios
  for select to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria') or profissional_id = (select private.profissional_atual()));

-- Clientes: somente administração e secretaria; sem exclusão física.
grant select, insert, update on public.clientes to authenticated;
create policy "equipe le clientes" on public.clientes
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe cadastra clientes" on public.clientes
  for insert to authenticated with check ((select private.papel_atual()) in ('admin', 'secretaria'));
create policy "equipe altera clientes" on public.clientes
  for update to authenticated
  using ((select private.papel_atual()) in ('admin', 'secretaria'))
  with check ((select private.papel_atual()) in ('admin', 'secretaria'));
alter table public.clientes alter column criado_por set default auth.uid();

-- Agendamentos e histórico: leitura administrativa; o profissional usa public.listar_agenda.
grant select on public.agendamentos to authenticated;
create policy "equipe le agendamentos" on public.agendamentos
  for select to authenticated using ((select private.papel_atual()) in ('admin', 'secretaria'));
grant select on public.historico_agendamentos to authenticated;
create policy "admin le historico" on public.historico_agendamentos
  for select to authenticated using ((select private.papel_atual()) = 'admin');

-- Funções expostas pela API: somente usuários autenticados (cada uma confere o perfil).
grant execute on function public.listar_agenda(date, date, uuid) to authenticated;
grant execute on function public.agendamentos_do_cliente(uuid) to authenticated;
grant execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, date, time, text, boolean) to authenticated;
grant execute on function public.alterar_status_agendamento(uuid, public.status_agendamento) to authenticated;
grant execute on function public.cancelar_agendamento(uuid, text) to authenticated;
grant execute on function public.reagendar_agendamento(uuid, date, time, uuid, text, integer) to authenticated;
grant execute on function public.editar_agendamento(uuid, text, boolean) to authenticated;
grant execute on function public.historico_do_agendamento(uuid) to authenticated;
grant execute on function public.salvar_disponibilidade(uuid, jsonb) to authenticated;
grant execute on function public.criar_excecao_disponibilidade(uuid, date, time, time, text) to authenticated;
grant execute on function public.remover_excecao_disponibilidade(uuid) to authenticated;
grant execute on function public.criar_bloqueio(uuid, date, date, time, time, text, boolean) to authenticated;
grant execute on function public.remover_bloqueio(uuid) to authenticated;
grant execute on function public.listar_usuarios() to authenticated;
grant execute on function public.meu_perfil() to authenticated;

-- Funções criadas no futuro não ficam expostas por padrão.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Correção encontrada pelo teste de integração: a tabela auditoria (005) herdou os privilégios padrão
-- do Supabase (inclusive gravação para anon e authenticated). A RLS já impedia gravações, mas a
-- auditoria deve ser somente leitura também no nível de privilégios.
revoke all on table public.auditoria from anon, authenticated;
grant select on table public.auditoria to authenticated;

-- Tabelas e funções criadas no futuro por este papel não ficam abertas por padrão.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- As funções criadas na 005 herdaram EXECUTE para PUBLIC. Elas já recusam quem não tem perfil,
-- mas a regra é menor privilégio: cada função fica executável somente por quem precisa.
revoke execute on function public.listar_auditoria(integer, text) from public, anon;
revoke execute on function public.remover_bloqueio(uuid, text) from public, anon;
revoke execute on function public.remover_bloqueio(uuid) from public, anon, authenticated;
revoke execute on function public.configuracao_publica() from public;
revoke execute on function public.servicos_publicos() from public;
revoke execute on function public.profissionais_publicos(uuid) from public;
revoke execute on function public.horarios_disponiveis(uuid, uuid, date, date) from public;
revoke execute on function private.auditar() from public, anon, authenticated;
revoke execute on function private.preservar_ultimo_admin() from public, anon, authenticated;

grant execute on function public.listar_auditoria(integer, text) to authenticated;
grant execute on function public.remover_bloqueio(uuid, text) to authenticated;
grant execute on function public.configuracao_publica() to anon, authenticated;
grant execute on function public.servicos_publicos() to anon, authenticated;
grant execute on function public.profissionais_publicos(uuid) to anon, authenticated;
grant execute on function public.horarios_disponiveis(uuid, uuid, date, date) to anon, authenticated;

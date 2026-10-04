-- Remoção autorizada pelo usuário em 04/10/2026: a versão de remover_bloqueio sem motivo
-- (substituída na 005 por remover_bloqueio(uuid, text)) já não era chamável e deixa de existir.
drop function if exists public.remover_bloqueio(uuid);

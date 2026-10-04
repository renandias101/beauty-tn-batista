-- Vínculos de conta feitos pela função de usuários (chave de serviço) passam a registrar o autor na auditoria.
alter table public.profissionais add column atualizado_por uuid references auth.users (id) on delete set null;

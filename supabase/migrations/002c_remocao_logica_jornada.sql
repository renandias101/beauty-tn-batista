-- Remoção lógica de jornada, exceções e bloqueios: nada é apagado, fica registrado quem removeu e quando.
-- As restrições de sobreposição passam a considerar somente os registros vigentes.

alter table public.disponibilidades
  add column removido_em timestamptz,
  add column removido_por uuid references auth.users (id) on delete set null;
alter table public.excecoes_disponibilidade
  add column removido_em timestamptz,
  add column removido_por uuid references auth.users (id) on delete set null;
alter table public.bloqueios
  add column removido_em timestamptz,
  add column removido_por uuid references auth.users (id) on delete set null;

alter table public.disponibilidades drop constraint disponibilidade_sem_sobreposicao;
alter table public.disponibilidades add constraint disponibilidade_sem_sobreposicao exclude using gist (
  profissional_id with =, dia_semana with =, public.faixa_horario(hora_inicio, hora_fim, '[)') with &&
) where (removido_em is null);

alter table public.excecoes_disponibilidade drop constraint excecao_sem_sobreposicao;
alter table public.excecoes_disponibilidade add constraint excecao_sem_sobreposicao exclude using gist (
  profissional_id with =, data with =, public.faixa_horario(hora_inicio, hora_fim, '[)') with &&
) where (removido_em is null);

alter table public.bloqueios drop constraint bloqueio_sem_sobreposicao;
alter table public.bloqueios add constraint bloqueio_sem_sobreposicao exclude using gist (
  profissional_id with =, tstzrange(inicio, fim, '[)') with &&
) where (removido_em is null);

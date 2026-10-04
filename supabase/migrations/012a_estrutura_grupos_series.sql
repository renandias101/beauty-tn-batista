-- Marcações com vários serviços e agendamentos recorrentes (pedido de 04/10/2026), parte 1: estrutura.
-- As reservas continuam sendo linhas de public.agendamentos (cada serviço/ocorrência com status e histórico próprios);
-- um vínculo opcional as agrupa. Reservas existentes ficam sem vínculo e continuam funcionando como antes.

-- Marcação com vários serviços para a mesma cliente (ex.: cabelo com uma profissional e sobrancelha com outra).
create table public.grupos_agendamento (
  id uuid primary key,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  criado_por uuid not null references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now()
);

-- Série recorrente de um serviço com um profissional.
create table public.series_agendamento (
  id uuid primary key,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  servico_id uuid not null references public.servicos (id) on delete restrict,
  profissional_id uuid not null references public.profissionais (id) on delete restrict,
  frequencia text not null check (frequencia in ('semanal', 'quinzenal', 'mensal')),
  data_inicial date not null,
  hora time not null,
  quantidade integer check (quantidade is null or quantidade between 1 and 52),
  data_final date,
  -- Mensal: o que fazer quando o dia não existe no mês (escolha explícita do usuário).
  dia_inexistente text check (dia_inexistente is null or dia_inexistente in ('ultimo_dia', 'pular')),
  criado_por uuid not null references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now(),
  constraint serie_limite_definido check ((quantidade is null) <> (data_final is null)),
  constraint serie_periodo_valido check (data_final is null or (data_final >= data_inicial and data_final - data_inicial <= 366))
);

alter table public.agendamentos
  add column grupo_id uuid references public.grupos_agendamento (id) on delete restrict,
  add column grupo_ordem smallint,
  add column serie_id uuid references public.series_agendamento (id) on delete restrict,
  add column serie_ordem smallint,
  add constraint agendamento_grupo_completo check ((grupo_id is null) = (grupo_ordem is null)),
  add constraint agendamento_serie_completa check ((serie_id is null) = (serie_ordem is null)),
  -- Recorrência de marcações com vários serviços não faz parte desta etapa.
  add constraint agendamento_grupo_ou_serie check (grupo_id is null or serie_id is null);

create unique index agendamentos_grupo_ordem_idx on public.agendamentos (grupo_id, grupo_ordem) where grupo_id is not null;
create unique index agendamentos_serie_ordem_idx on public.agendamentos (serie_id, serie_ordem) where serie_id is not null;

-- Auditoria geral da criação de marcações e séries (cada reserva tem também o próprio histórico).
create trigger auditar_grupos after insert or update or delete on public.grupos_agendamento for each row execute function private.auditar();
create trigger auditar_series after insert or update or delete on public.series_agendamento for each row execute function private.auditar();

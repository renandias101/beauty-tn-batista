-- Esquema do sistema de agendamento (PRD v2.0, escopo reduzido).
-- Somente agenda: sem financeiro, prontuário, lixeira ou exclusão física de reservas.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

create type public.papel_usuario as enum ('admin', 'secretaria', 'profissional');
create type public.status_agendamento as enum ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido', 'cancelado', 'faltou');
-- Faixa de horário do dia, usada para impedir sobreposição de disponibilidades.
create type public.faixa_horario as range (subtype = time);

-- RN10: fuso único da clínica, em uma linha só.
create table public.configuracao_clinica (
  id boolean primary key default true check (id),
  fuso_horario text not null default 'America/Sao_Paulo',
  atualizado_em timestamptz not null default now()
);
insert into public.configuracao_clinica default values;

create table public.perfis (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  papel public.papel_usuario not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.profissionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  telefone text check (telefone is null or char_length(telefone) <= 30),
  cor text not null default '#9A6A20' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo boolean not null default true,
  usuario_id uuid unique references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  duracao_minutos integer not null check (duracao_minutos > 0 and duracao_minutos <= 720),
  categoria text check (categoria is null or char_length(categoria) <= 60),
  descricao text check (descricao is null or char_length(descricao) <= 300),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.profissional_servicos (
  profissional_id uuid not null references public.profissionais (id) on delete cascade,
  servico_id uuid not null references public.servicos (id) on delete cascade,
  primary key (profissional_id, servico_id)
);
create index profissional_servicos_servico_idx on public.profissional_servicos (servico_id);

-- Jornada semanal. Várias faixas no mesmo dia representam os intervalos.
create table public.disponibilidades (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.profissionais (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fim time not null,
  constraint disponibilidade_horario_valido check (hora_inicio < hora_fim),
  constraint disponibilidade_sem_sobreposicao exclude using gist (
    profissional_id with =, dia_semana with =, public.faixa_horario(hora_inicio, hora_fim, '[)') with &&
  )
);

-- Exceção por data: abre um período fora da jornada habitual.
create table public.excecoes_disponibilidade (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.profissionais (id) on delete cascade,
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  motivo text check (motivo is null or char_length(motivo) <= 200),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint excecao_horario_valido check (hora_inicio < hora_fim),
  constraint excecao_sem_sobreposicao exclude using gist (
    profissional_id with =, data with =, public.faixa_horario(hora_inicio, hora_fim, '[)') with &&
  )
);

-- Folgas, férias, feriados e outras indisponibilidades.
create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.profissionais (id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text not null check (char_length(btrim(motivo)) between 1 and 200),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint bloqueio_horario_valido check (inicio < fim),
  constraint bloqueio_sem_sobreposicao exclude using gist (
    profissional_id with =, tstzrange(inicio, fim, '[)') with &&
  )
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 150),
  telefone text not null check (char_length(regexp_replace(telefone, '\D', '', 'g')) between 8 and 15 and char_length(telefone) <= 30),
  telefone_digitos text generated always as (regexp_replace(telefone, '\D', '', 'g')) stored,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index clientes_telefone_digitos_idx on public.clientes (telefone_digitos);
create index clientes_nome_idx on public.clientes (lower(nome));

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  servico_id uuid not null references public.servicos (id) on delete restrict,
  profissional_id uuid not null references public.profissionais (id) on delete restrict,
  inicio timestamptz not null,
  duracao_minutos integer not null check (duracao_minutos > 0 and duracao_minutos <= 720),
  fim timestamptz not null,
  status public.status_agendamento not null default 'agendado',
  encaixe boolean not null default false,
  observacao text check (observacao is null or char_length(observacao) <= 500),
  criado_por uuid not null references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete restrict,
  atualizado_em timestamptz not null default now(),
  cancelado_por uuid references auth.users (id) on delete restrict,
  cancelado_em timestamptz,
  motivo_cancelamento text check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 300),
  constraint agendamento_fim_calculado check (fim = inicio + make_interval(mins => duracao_minutos)),
  -- RN07: cancelamento sempre identifica responsável, momento e motivo.
  constraint agendamento_cancelamento_completo check (
    status <> 'cancelado' or (cancelado_por is not null and cancelado_em is not null and char_length(btrim(coalesce(motivo_cancelamento, ''))) > 0)
  ),
  -- RN01, RN04, RN09: reservas que ocupam horário nunca se sobrepõem, mesmo com gravações simultâneas.
  -- O intervalo [inicio, fim) permite que um atendimento comece exatamente no término de outro (CA05).
  constraint agendamento_sem_sobreposicao exclude using gist (
    profissional_id with =, tstzrange(inicio, fim, '[)') with &&
  ) where (status in ('agendado', 'confirmado', 'chegou', 'em_atendimento'))
);
create index agendamentos_profissional_inicio_idx on public.agendamentos (profissional_id, inicio);
create index agendamentos_cliente_inicio_idx on public.agendamentos (cliente_id, inicio);
create index agendamentos_inicio_idx on public.agendamentos (inicio);
create index agendamentos_servico_idx on public.agendamentos (servico_id);

-- RF09: histórico imutável das alterações relevantes.
create table public.historico_agendamentos (
  id bigint generated always as identity primary key,
  agendamento_id uuid not null references public.agendamentos (id) on delete restrict,
  acao text not null check (acao in ('criado', 'status_alterado', 'reagendado', 'cancelado', 'editado')),
  usuario_id uuid references auth.users (id) on delete restrict,
  ocorrido_em timestamptz not null default now(),
  motivo text check (motivo is null or char_length(motivo) <= 300),
  valores_anteriores jsonb,
  valores_novos jsonb
);
create index historico_agendamento_idx on public.historico_agendamentos (agendamento_id, ocorrido_em);

-- Mantém atualizado_em consistente em atualizações diretas.
create function private.tocar_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger perfis_atualizado_em before update on public.perfis for each row execute function private.tocar_atualizado_em();
create trigger profissionais_atualizado_em before update on public.profissionais for each row execute function private.tocar_atualizado_em();
create trigger servicos_atualizado_em before update on public.servicos for each row execute function private.tocar_atualizado_em();
create trigger clientes_atualizado_em before update on public.clientes for each row execute function private.tocar_atualizado_em();
create trigger agendamentos_atualizado_em before update on public.agendamentos for each row execute function private.tocar_atualizado_em();

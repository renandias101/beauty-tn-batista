-- Operação da agenda (pedido de 04/10/2026), parte 1: estrutura.
-- Somente acréscimos e ajustes de restrições: nenhum dado existente é apagado.
-- Regras novas: conflito da cliente, duração por profissional, preparação, ocupação após conclusão,
-- controle de versão, recursos compartilhados, comunicações pelo WhatsApp e lista de espera.

-- ---------------------------------------------------------------------------
-- Ocupação do período
-- ---------------------------------------------------------------------------
-- Ocupam o período previsto: reservas pendentes e também as concluídas (concluir antes do horário
-- não libera o restante do período nem a preparação). Cancelado e faltou liberam o período:
-- na falta a cliente não veio, então o tempo restante pode receber um encaixe.
-- private.ocupa_horario continua significando "reserva ativa a resolver" (jornada, bloqueios, inativações).
create function private.ocupa_periodo(p_status public.status_agendamento) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido')
$$;

-- ---------------------------------------------------------------------------
-- Preparação por serviço e duração por profissional e serviço
-- ---------------------------------------------------------------------------
alter table public.servicos
  add column preparacao_minutos integer not null default 0 check (preparacao_minutos between 0 and 240);

-- Sem valor, vale a duração padrão do serviço.
alter table public.profissional_servicos
  add column duracao_minutos integer check (duracao_minutos is null or (duracao_minutos > 0 and duracao_minutos <= 720));

-- ---------------------------------------------------------------------------
-- Agendamentos: preparação gravada, fim da ocupação, versão e exceção de conflito da cliente
-- ---------------------------------------------------------------------------
alter table public.agendamentos
  add column preparacao_minutos integer not null default 0 check (preparacao_minutos between 0 and 240),
  add column ocupado_ate timestamptz,
  add column versao integer not null default 1,
  add column conflito_cliente_justificativa text check (conflito_cliente_justificativa is null or char_length(conflito_cliente_justificativa) between 3 and 300),
  add column conflito_cliente_autorizado_por uuid references auth.users (id) on delete restrict;

-- Reservas existentes não tinham preparação: a ocupação termina no fim do atendimento.
-- O gatilho de atualizado_em fica desligado para não alterar a data de atualização dos registros.
alter table public.agendamentos disable trigger agendamentos_atualizado_em;
update public.agendamentos set ocupado_ate = fim where ocupado_ate is null;
alter table public.agendamentos enable trigger agendamentos_atualizado_em;

alter table public.agendamentos
  alter column ocupado_ate set not null,
  add constraint agendamento_ocupacao_calculada check (ocupado_ate = fim + make_interval(mins => preparacao_minutos)),
  add constraint agendamento_excecao_completa check ((conflito_cliente_justificativa is null) = (conflito_cliente_autorizado_por is null));

-- Antes de trocar as restrições, confere se os registros existentes já obedecem às novas regras.
-- Se houver sobreposição (por exemplo, uma conclusão antecipada seguida de outra reserva no mesmo período),
-- a migração para com a lista para revisão manual, em vez de alterar dados por conta própria.
do $$
declare
  v_lista text;
begin
  select string_agg(format('%s x %s', a.id, b.id), '; ') into v_lista
  from public.agendamentos a
  join public.agendamentos b on b.profissional_id = a.profissional_id and b.id > a.id
  where private.ocupa_periodo(a.status) and private.ocupa_periodo(b.status)
    and tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(b.inicio, b.ocupado_ate, '[)');
  if v_lista is not null then
    raise exception 'Reservas sobrepostas do mesmo profissional (revise antes de migrar): %', v_lista;
  end if;
  select string_agg(format('%s x %s', a.id, b.id), '; ') into v_lista
  from public.agendamentos a
  join public.agendamentos b on b.cliente_id = a.cliente_id and b.id > a.id
  where private.ocupa_periodo(a.status) and private.ocupa_periodo(b.status)
    and tstzrange(a.inicio, a.fim, '[)') && tstzrange(b.inicio, b.fim, '[)');
  if v_lista is not null then
    raise exception 'Reservas sobrepostas da mesma cliente (revise antes de migrar): %', v_lista;
  end if;
end $$;

-- Profissional: o período ocupado inclui a preparação e continua ocupado após a conclusão.
-- As restrições são adiáveis (verificadas na hora, por padrão): operações sobre uma marcação ou série inteira
-- movem várias reservas na mesma transação e conferem tudo antes de confirmar.
alter table public.agendamentos drop constraint agendamento_sem_sobreposicao;
alter table public.agendamentos add constraint agendamento_sem_sobreposicao exclude using gist (
  profissional_id with =, tstzrange(inicio, ocupado_ate, '[)') with &&
) where (status in ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido')) deferrable initially immediate;

-- Cliente: não fica em dois atendimentos ao mesmo tempo (a preparação é do profissional, não da cliente).
-- Exceções autorizadas pela administração ficam fora da restrição e são registradas no histórico.
alter table public.agendamentos add constraint agendamento_cliente_sem_sobreposicao exclude using gist (
  cliente_id with =, tstzrange(inicio, fim, '[)') with &&
) where (status in ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido') and conflito_cliente_justificativa is null) deferrable initially immediate;

-- Cada alteração incrementa a versão: gravações com versão antiga são recusadas pelas funções.
create function private.incrementar_versao() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.versao := old.versao + 1;
  return new;
end $$;
create trigger agendamentos_versao before update on public.agendamentos for each row execute function private.incrementar_versao();

-- Histórico: correção administrativa de status.
alter table public.historico_agendamentos drop constraint historico_agendamentos_acao_check;
alter table public.historico_agendamentos add constraint historico_agendamentos_acao_check
  check (acao in ('criado', 'status_alterado', 'reagendado', 'cancelado', 'editado', 'status_corrigido'));

-- ---------------------------------------------------------------------------
-- Recursos compartilhados (opcionais): salas, macas e equipamentos
-- ---------------------------------------------------------------------------
create table public.recursos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  tipo text not null default 'sala' check (tipo in ('sala', 'equipamento', 'outro')),
  -- Quantas reservas podem usar o recurso ao mesmo tempo (ex.: 2 macas iguais).
  capacidade integer not null default 1 check (capacidade between 1 and 20),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
create unique index recursos_nome_unico on public.recursos (lower(btrim(nome)));
create trigger recursos_atualizado_em before update on public.recursos for each row execute function private.tocar_atualizado_em();

-- Recursos exigidos por um serviço. Serviço sem linha aqui não precisa de recurso.
create table public.servico_recursos (
  servico_id uuid not null references public.servicos (id) on delete cascade,
  recurso_id uuid not null references public.recursos (id) on delete restrict,
  primary key (servico_id, recurso_id)
);
create index servico_recursos_recurso_idx on public.servico_recursos (recurso_id);

-- Recursos reservados por agendamento, gravados na criação: mudanças posteriores no serviço não alteram reservas existentes.
create table public.agendamento_recursos (
  agendamento_id uuid not null references public.agendamentos (id) on delete restrict,
  recurso_id uuid not null references public.recursos (id) on delete restrict,
  primary key (agendamento_id, recurso_id)
);
create index agendamento_recursos_recurso_idx on public.agendamento_recursos (recurso_id);

-- ---------------------------------------------------------------------------
-- Comunicações registradas manualmente (WhatsApp). Não guarda o texto enviado.
-- ---------------------------------------------------------------------------
create table public.comunicacoes (
  id uuid primary key,
  agendamento_id uuid not null references public.agendamentos (id) on delete restrict,
  tipo text not null check (tipo in ('confirmacao', 'lembrete', 'cancelamento', 'reagendamento')),
  canal text not null default 'whatsapp' check (canal = 'whatsapp'),
  registrado_por uuid not null references auth.users (id) on delete restrict,
  registrado_em timestamptz not null default now(),
  -- Horário e profissional vigentes quando a mensagem foi enviada: após um reagendamento,
  -- a diferença indica que é preciso avisar a cliente de novo.
  inicio_referencia timestamptz not null,
  profissional_referencia uuid not null references public.profissionais (id) on delete restrict
);
create index comunicacoes_agendamento_idx on public.comunicacoes (agendamento_id, registrado_em desc);

-- ---------------------------------------------------------------------------
-- Lista de espera (não reserva horários)
-- ---------------------------------------------------------------------------
create table public.lista_espera (
  id uuid primary key,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  servico_id uuid not null references public.servicos (id) on delete restrict,
  profissional_id uuid references public.profissionais (id) on delete restrict,
  data_inicio date not null,
  data_fim date not null,
  hora_inicio time,
  hora_fim time,
  observacao text check (observacao is null or char_length(observacao) <= 300),
  status text not null default 'aguardando' check (status in ('aguardando', 'contatado', 'agendado', 'desistiu')),
  agendamento_id uuid references public.agendamentos (id) on delete restrict,
  versao integer not null default 1,
  criado_por uuid not null references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete restrict,
  atualizado_em timestamptz not null default now(),
  constraint lista_espera_periodo_valido check (data_fim >= data_inicio and data_fim - data_inicio <= 180),
  constraint lista_espera_faixa_valida check ((hora_inicio is null) = (hora_fim is null) and (hora_inicio is null or hora_inicio < hora_fim)),
  constraint lista_espera_agendada_com_reserva check ((status = 'agendado') = (agendamento_id is not null))
);
-- Evita entradas duplicadas acidentais: uma entrada em aberto por cliente, serviço e preferência de profissional.
create unique index lista_espera_sem_duplicidade on public.lista_espera
  (cliente_id, servico_id, coalesce(profissional_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('aguardando', 'contatado');
create index lista_espera_status_idx on public.lista_espera (status, data_inicio);
create trigger lista_espera_atualizado_em before update on public.lista_espera for each row execute function private.tocar_atualizado_em();
create trigger lista_espera_versao before update on public.lista_espera for each row execute function private.incrementar_versao();

-- Histórico de contatos e mudanças de situação da lista de espera.
create table public.lista_espera_contatos (
  id bigint generated always as identity primary key,
  lista_espera_id uuid not null references public.lista_espera (id) on delete restrict,
  usuario_id uuid references auth.users (id) on delete restrict,
  ocorrido_em timestamptz not null default now(),
  status_anterior text,
  status_novo text not null,
  observacao text check (observacao is null or char_length(observacao) <= 300)
);
create index lista_espera_contatos_idx on public.lista_espera_contatos (lista_espera_id, ocorrido_em);

-- ---------------------------------------------------------------------------
-- Sinal de atualização da agenda (sincronização entre computadores)
-- ---------------------------------------------------------------------------
-- Uma linha por profissional, sem dados de clientes: a aplicação escuta as mudanças desta tabela
-- e recarrega a agenda pelas funções que já aplicam as permissões de cada perfil.
create table public.agenda_revisoes (
  profissional_id uuid primary key references public.profissionais (id) on delete cascade,
  revisao bigint not null default 1,
  atualizado_em timestamptz not null default now()
);

create function private.sinalizar_agenda() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in
    select distinct x from unnest(array[
      case when tg_op in ('INSERT', 'UPDATE') then new.profissional_id end,
      case when tg_op in ('UPDATE', 'DELETE') then old.profissional_id end
    ]) x where x is not null
  loop
    insert into public.agenda_revisoes (profissional_id) values (v_id)
    on conflict (profissional_id) do update set revisao = public.agenda_revisoes.revisao + 1, atualizado_em = now();
  end loop;
  return null;
end $$;

create trigger agendamentos_sinalizar after insert or update on public.agendamentos for each row execute function private.sinalizar_agenda();
create trigger bloqueios_sinalizar after insert or update on public.bloqueios for each row execute function private.sinalizar_agenda();
create trigger disponibilidades_sinalizar after insert or update on public.disponibilidades for each row execute function private.sinalizar_agenda();
create trigger excecoes_sinalizar after insert or update on public.excecoes_disponibilidade for each row execute function private.sinalizar_agenda();

-- Auditoria geral dos novos cadastros (agendamentos e lista de espera têm históricos próprios).
create trigger auditar_recursos after insert or update or delete on public.recursos for each row execute function private.auditar();
create trigger auditar_servico_recursos after insert or update or delete on public.servico_recursos for each row execute function private.auditar();

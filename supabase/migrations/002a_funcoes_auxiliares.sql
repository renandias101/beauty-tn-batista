-- Funções auxiliares das regras de agenda (schema private, não exposto pela API).
-- Mensagens de erro com código P0001 são exibidas diretamente ao usuário.

create function private.papel_atual() returns public.papel_usuario
language sql stable security definer set search_path = '' as $$
  select papel from public.perfis where usuario_id = (select auth.uid()) and ativo
$$;

create function private.profissional_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.profissionais p
  join public.perfis pf on pf.usuario_id = p.usuario_id
  where p.usuario_id = (select auth.uid()) and pf.ativo and pf.papel = 'profissional'
$$;

create function private.exigir_papel(p_papeis public.papel_usuario[]) returns public.papel_usuario
language plpgsql stable security definer set search_path = '' as $$
declare
  v_papel public.papel_usuario := private.papel_atual();
begin
  if v_papel is null or not (v_papel = any (p_papeis)) then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  return v_papel;
end $$;

create function private.fuso() returns text
language sql stable security definer set search_path = '' as $$
  select fuso_horario from public.configuracao_clinica limit 1
$$;

create function private.ocupa_horario(p_status public.status_agendamento) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('agendado', 'confirmado', 'chegou', 'em_atendimento')
$$;

-- RN09: serializa gravações concorrentes na agenda de um mesmo profissional.
create function private.travar_profissional(p_profissional_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_profissional_id::text, 0));
end $$;

create function private.exigir_motivo(p_motivo text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo (mínimo de 3 caracteres).';
  end if;
  if char_length(p_motivo) > 300 then
    raise exception 'O motivo deve ter no máximo 300 caracteres.';
  end if;
  return btrim(p_motivo);
end $$;

-- RN03: o atendimento inteiro cabe em uma faixa da jornada semanal ou em uma exceção da data.
create function private.cabe_na_jornada(p_profissional_id uuid, p_inicio timestamptz, p_fim timestamptz) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_ini timestamp := p_inicio at time zone v_fuso;
  v_fim timestamp := p_fim at time zone v_fuso;
  v_dia date := (p_inicio at time zone v_fuso)::date;
begin
  return exists (
    select 1 from public.disponibilidades d
    where d.profissional_id = p_profissional_id
      and d.dia_semana = extract(dow from v_dia)::smallint
      and v_dia + d.hora_inicio <= v_ini
      and v_dia + d.hora_fim >= v_fim
  ) or exists (
    select 1 from public.excecoes_disponibilidade e
    where e.profissional_id = p_profissional_id
      and e.data = v_dia
      and v_dia + e.hora_inicio <= v_ini
      and v_dia + e.hora_fim >= v_fim
  );
end $$;

create function private.descrever_agendamentos(p_ids uuid[]) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(
    to_char(a.inicio at time zone private.fuso(), 'DD/MM HH24:MI') || ' – ' || c.nome,
    '; ' order by a.inicio
  )
  from (select * from public.agendamentos where id = any (p_ids) order by inicio limit 5) a
  join public.clientes c on c.id = a.cliente_id
$$;

-- RN01–RN05: valida um período para um profissional (e serviço, quando informado).
create function private.validar_horario(
  p_profissional_id uuid, p_servico_id uuid, p_inicio timestamptz, p_fim timestamptz, p_ignorar_id uuid
) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_dia date := (p_inicio at time zone v_fuso)::date;
  v_motivo text;
begin
  if not exists (select 1 from public.profissionais where id = p_profissional_id and ativo) then
    raise exception 'O profissional selecionado está inativo ou não foi encontrado.';
  end if;
  if p_servico_id is not null then
    if not exists (select 1 from public.servicos where id = p_servico_id and ativo) then
      raise exception 'O serviço selecionado está inativo ou não foi encontrado.';
    end if;
    if not exists (select 1 from public.profissional_servicos where profissional_id = p_profissional_id and servico_id = p_servico_id) then
      raise exception 'Este profissional não está habilitado para o serviço selecionado.';
    end if;
  end if;

  if not private.cabe_na_jornada(p_profissional_id, p_inicio, p_fim) then
    if not exists (select 1 from public.disponibilidades where profissional_id = p_profissional_id and dia_semana = extract(dow from v_dia)::smallint)
       and not exists (select 1 from public.excecoes_disponibilidade where profissional_id = p_profissional_id and data = v_dia) then
      raise exception 'O profissional não atende nesta data.';
    end if;
    raise exception 'O horário não cabe na jornada do profissional. Verifique intervalos e o fim do expediente.';
  end if;

  select motivo into v_motivo
  from public.bloqueios
  where profissional_id = p_profissional_id
    and tstzrange(inicio, fim, '[)') && tstzrange(p_inicio, p_fim, '[)')
  limit 1;
  if found then
    raise exception 'O horário está bloqueado na agenda do profissional (%).', v_motivo;
  end if;

  if exists (
    select 1 from public.agendamentos a
    where a.profissional_id = p_profissional_id
      and private.ocupa_horario(a.status)
      and a.id is distinct from p_ignorar_id
      and tstzrange(a.inicio, a.fim, '[)') && tstzrange(p_inicio, p_fim, '[)')
  ) then
    raise exception 'Já existe um atendimento deste profissional nesse horário.';
  end if;
end $$;

-- Retrato legível de uma reserva, guardado no histórico.
create function private.retrato_agendamento(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', a.status,
    'data', to_char(a.inicio at time zone private.fuso(), 'YYYY-MM-DD'),
    'hora_inicio', to_char(a.inicio at time zone private.fuso(), 'HH24:MI'),
    'hora_fim', to_char(a.fim at time zone private.fuso(), 'HH24:MI'),
    'duracao_minutos', a.duracao_minutos,
    'profissional_id', a.profissional_id,
    'profissional', p.nome,
    'servico', s.nome,
    'encaixe', a.encaixe,
    'observacao', a.observacao
  )
  from public.agendamentos a
  join public.profissionais p on p.id = a.profissional_id
  join public.servicos s on s.id = a.servico_id
  where a.id = p_id
$$;

create function private.registrar_historico(p_id uuid, p_acao text, p_motivo text, p_antes jsonb, p_depois jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.historico_agendamentos (agendamento_id, acao, usuario_id, motivo, valores_anteriores, valores_novos)
  values (p_id, p_acao, (select auth.uid()), p_motivo, p_antes, p_depois)
$$;

-- RN08: impede alterações de jornada que deixariam reservas futuras fora do horário.
create function private.exigir_reservas_na_jornada(p_profissional_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(a.id order by a.inicio) into v_ids
  from public.agendamentos a
  where a.profissional_id = p_profissional_id
    and private.ocupa_horario(a.status)
    and a.fim > now()
    and not private.cabe_na_jornada(a.profissional_id, a.inicio, a.fim);
  if v_ids is not null then
    raise exception 'A alteração deixaria % agendamento(s) futuro(s) fora da jornada: %. Reagende ou cancele essas reservas antes.',
      cardinality(v_ids), private.descrever_agendamentos(v_ids);
  end if;
end $$;


-- Inativar um profissional exige revisar antes as reservas futuras (seção 5 do PRD).
create function private.validar_inativacao_profissional() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if old.ativo and not new.ativo then
    select array_agg(id order by inicio) into v_ids
    from public.agendamentos
    where profissional_id = new.id and private.ocupa_horario(status) and fim > now();
    if v_ids is not null then
      raise exception 'Existem % agendamento(s) futuro(s) para este profissional: %. Reagende ou cancele antes de inativar.',
        cardinality(v_ids), private.descrever_agendamentos(v_ids);
    end if;
  end if;
  return new;
end $$;

create trigger profissionais_validar_inativacao
before update of ativo on public.profissionais
for each row execute function private.validar_inativacao_profissional();


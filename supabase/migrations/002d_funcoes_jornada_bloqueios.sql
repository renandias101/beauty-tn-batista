-- Jornada, exceções e bloqueios (perfil Administração). RN08: nenhuma alteração cancela reservas;
-- quando uma reserva futura seria afetada, a operação é recusada e lista as reservas a resolver.

-- Validações passam a considerar somente jornada, exceções e bloqueios vigentes.
create or replace function private.cabe_na_jornada(p_profissional_id uuid, p_inicio timestamptz, p_fim timestamptz) returns boolean
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
      and d.removido_em is null
      and d.dia_semana = extract(dow from v_dia)::smallint
      and v_dia + d.hora_inicio <= v_ini
      and v_dia + d.hora_fim >= v_fim
  ) or exists (
    select 1 from public.excecoes_disponibilidade e
    where e.profissional_id = p_profissional_id
      and e.removido_em is null
      and e.data = v_dia
      and v_dia + e.hora_inicio <= v_ini
      and v_dia + e.hora_fim >= v_fim
  );
end $$;

create or replace function private.validar_horario(
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
    if not exists (select 1 from public.disponibilidades where profissional_id = p_profissional_id and removido_em is null and dia_semana = extract(dow from v_dia)::smallint)
       and not exists (select 1 from public.excecoes_disponibilidade where profissional_id = p_profissional_id and removido_em is null and data = v_dia) then
      raise exception 'O profissional não atende nesta data.';
    end if;
    raise exception 'O horário não cabe na jornada do profissional. Verifique intervalos e o fim do expediente.';
  end if;

  select motivo into v_motivo
  from public.bloqueios
  where profissional_id = p_profissional_id
    and removido_em is null
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

-- Substitui a jornada semanal. As faixas anteriores ficam registradas como removidas.
-- p_faixas: [{"dia_semana":1,"hora_inicio":"08:00","hora_fim":"12:00"}, ...]
create function public.salvar_disponibilidade(p_profissional_id uuid, p_faixas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  if not exists (select 1 from public.profissionais where id = p_profissional_id) then
    raise exception 'Profissional não encontrado.';
  end if;
  if jsonb_typeof(coalesce(p_faixas, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de jornada inválido.';
  end if;

  perform private.travar_profissional(p_profissional_id);
  update public.disponibilidades
  set removido_em = now(), removido_por = (select auth.uid())
  where profissional_id = p_profissional_id and removido_em is null;
  begin
    insert into public.disponibilidades (profissional_id, dia_semana, hora_inicio, hora_fim)
    select p_profissional_id, (f ->> 'dia_semana')::smallint, (f ->> 'hora_inicio')::time, (f ->> 'hora_fim')::time
    from jsonb_array_elements(coalesce(p_faixas, '[]'::jsonb)) f;
  exception
    when exclusion_violation then
      raise exception 'Há faixas sobrepostas no mesmo dia. Ajuste os horários.';
    when check_violation then
      raise exception 'Cada faixa precisa terminar depois de começar.';
    when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or not_null_violation then
      raise exception 'Há horários inválidos na jornada.';
  end;
  -- RN08: se alguma reserva futura ficar fora da nova jornada, a transação inteira é desfeita.
  perform private.exigir_reservas_na_jornada(p_profissional_id);
end $$;

create function public.criar_excecao_disponibilidade(
  p_profissional_id uuid, p_data date, p_hora_inicio time, p_hora_fim time, p_motivo text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  if p_data is null or p_hora_inicio is null or p_hora_fim is null or p_hora_inicio >= p_hora_fim then
    raise exception 'Informe data e um período válido.';
  end if;
  if char_length(coalesce(p_motivo, '')) > 200 then
    raise exception 'O motivo deve ter no máximo 200 caracteres.';
  end if;
  perform private.travar_profissional(p_profissional_id);
  if exists (
    select 1 from public.disponibilidades
    where profissional_id = p_profissional_id and removido_em is null
      and dia_semana = extract(dow from p_data)::smallint
      and public.faixa_horario(hora_inicio, hora_fim, '[)') && public.faixa_horario(p_hora_inicio, p_hora_fim, '[)')
  ) then
    raise exception 'A exceção deve abrir um período fora da jornada habitual desse dia.';
  end if;
  begin
    insert into public.excecoes_disponibilidade (profissional_id, data, hora_inicio, hora_fim, motivo, criado_por)
    values (p_profissional_id, p_data, p_hora_inicio, p_hora_fim, nullif(btrim(coalesce(p_motivo, '')), ''), (select auth.uid()))
    returning id into v_id;
  exception
    when exclusion_violation then
      raise exception 'Já existe uma exceção sobreposta nesta data.';
  end;
  return v_id;
end $$;

create function public.remover_excecao_disponibilidade(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profissional uuid;
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  select profissional_id into v_profissional from public.excecoes_disponibilidade where id = p_id and removido_em is null;
  if v_profissional is null then
    raise exception 'Exceção não encontrada.';
  end if;
  perform private.travar_profissional(v_profissional);
  update public.excecoes_disponibilidade set removido_em = now(), removido_por = (select auth.uid()) where id = p_id;
  -- RN08: impede remover a exceção que sustenta uma reserva futura.
  perform private.exigir_reservas_na_jornada(v_profissional);
end $$;

-- p_dia_inteiro = true gera um bloqueio contínuo do início de p_data_inicio ao fim de p_data_fim;
-- caso contrário, um bloqueio por dia no mesmo horário.
create function public.criar_bloqueio(
  p_profissional_id uuid, p_data_inicio date, p_data_fim date,
  p_hora_inicio time, p_hora_fim time, p_motivo text, p_dia_inteiro boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_periodos tstzrange[];
  v_ids uuid[];
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  if not exists (select 1 from public.profissionais where id = p_profissional_id) then
    raise exception 'Profissional não encontrado.';
  end if;
  if char_length(v_motivo) = 0 or char_length(v_motivo) > 200 then
    raise exception 'Informe o motivo do bloqueio (até 200 caracteres).';
  end if;
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Informe um período de datas válido.';
  end if;
  if p_data_fim - p_data_inicio > 366 then
    raise exception 'O bloqueio pode abranger no máximo um ano.';
  end if;

  if coalesce(p_dia_inteiro, false) then
    v_periodos := array[tstzrange(p_data_inicio::timestamp at time zone v_fuso, (p_data_fim + 1)::timestamp at time zone v_fuso, '[)')];
  else
    if p_hora_inicio is null or p_hora_fim is null or p_hora_inicio >= p_hora_fim then
      raise exception 'O horário final deve ser posterior ao inicial.';
    end if;
    select array_agg(tstzrange((d::date + p_hora_inicio) at time zone v_fuso, (d::date + p_hora_fim) at time zone v_fuso, '[)') order by d)
    into v_periodos
    from generate_series(p_data_inicio::timestamp, p_data_fim::timestamp, interval '1 day') d;
  end if;

  perform private.travar_profissional(p_profissional_id);

  -- RN08: nunca cancela reservas automaticamente; exige resolução explícita.
  select array_agg(a.id order by a.inicio) into v_ids
  from public.agendamentos a
  where a.profissional_id = p_profissional_id
    and private.ocupa_horario(a.status)
    and exists (select 1 from unnest(v_periodos) per where per && tstzrange(a.inicio, a.fim, '[)'));
  if v_ids is not null then
    raise exception 'O bloqueio atinge % agendamento(s): %. Reagende ou cancele essas reservas antes de bloquear.',
      cardinality(v_ids), private.descrever_agendamentos(v_ids);
  end if;

  begin
    insert into public.bloqueios (profissional_id, inicio, fim, motivo, criado_por)
    select p_profissional_id, lower(per), upper(per), v_motivo, (select auth.uid()) from unnest(v_periodos) per;
  exception
    when exclusion_violation then
      raise exception 'Já existe um bloqueio sobreposto nesse período.';
  end;
  return cardinality(v_periodos);
end $$;

-- Remover um bloqueio apenas reabre o período; o registro fica com responsável e data da remoção.
create function public.remover_bloqueio(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  update public.bloqueios set removido_em = now(), removido_por = (select auth.uid())
  where id = p_id and removido_em is null;
  if not found then
    raise exception 'Bloqueio não encontrado.';
  end if;
end $$;

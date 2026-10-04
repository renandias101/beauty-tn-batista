-- Marcações com vários serviços e agendamentos recorrentes, parte 2: regras no servidor.
-- Criação e operações sobre a marcação ou a série inteira são atômicas: qualquer falha desfaz tudo.
-- Cada reserva é validada pelas mesmas regras da criação individual (habilitação, jornada, bloqueios,
-- preparação, recursos, conflito do profissional e da cliente, horário passado).

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Relança um erro com prefixo (ex.: "Etapa 2: ...") preservando a dica e o tipo de erro de permissão.
create function private.relancar(p_prefixo text, p_mensagem text, p_dica text, p_estado text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  raise exception using
    message = p_prefixo || ': ' || p_mensagem,
    hint = coalesce(p_dica, ''),
    errcode = case when p_estado = '42501' then '42501' else 'P0001' end;
end $$;

-- Travas na ordem fixa: profissionais, cliente, recursos.
create function private.travar_reservas(p_profissionais uuid[], p_cliente_id uuid, p_recursos uuid[]) returns void
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in select distinct x from unnest(coalesce(p_profissionais, '{}')) x where x is not null order by x loop
    perform private.travar_profissional(v_id);
  end loop;
  perform private.travar_cliente(p_cliente_id);
  perform private.travar_recursos(p_recursos);
end $$;

-- Grava uma reserva já validada por completo. As travas são responsabilidade de quem chama.
create function private.inserir_reserva(
  p_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_inicio timestamptz,
  p_observacao text, p_encaixe boolean, p_justificativa text,
  p_grupo_id uuid default null, p_grupo_ordem integer default null, p_serie_id uuid default null, p_serie_ordem integer default null,
  p_motivo_historico text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_duracao integer;
  v_preparacao integer;
  v_recursos uuid[];
  v_fim timestamptz;
  v_ocupado timestamptz;
  v_justificativa text;
  v_restricao text;
begin
  select preparacao_minutos into v_preparacao from public.servicos where id = p_servico_id;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;
  v_duracao := private.duracao_efetiva(p_profissional_id, p_servico_id);
  if v_duracao is null then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  select array_agg(recurso_id order by recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;
  v_fim := p_inicio + make_interval(mins => v_duracao);
  v_ocupado := v_fim + make_interval(mins => v_preparacao);
  if p_inicio <= now() then
    raise exception 'Não é possível agendar em data ou horário que já passou.';
  end if;

  perform private.validar_reserva(p_profissional_id, p_servico_id, p_inicio, v_ocupado, null);
  perform private.validar_recursos(v_recursos, p_inicio, v_ocupado, null);
  v_justificativa := private.resolver_conflito_cliente(p_cliente_id, p_inicio, v_fim, null, p_justificativa);

  begin
    insert into public.agendamentos (id, cliente_id, servico_id, profissional_id, inicio, duracao_minutos, fim, preparacao_minutos, ocupado_ate,
                                     encaixe, observacao, criado_por, atualizado_por, conflito_cliente_justificativa, conflito_cliente_autorizado_por,
                                     grupo_id, grupo_ordem, serie_id, serie_ordem)
    values (p_id, p_cliente_id, p_servico_id, p_profissional_id, p_inicio, v_duracao, v_fim, v_preparacao, v_ocupado,
            coalesce(p_encaixe, false), nullif(btrim(coalesce(p_observacao, '')), ''), (select auth.uid()), (select auth.uid()),
            v_justificativa, case when v_justificativa is not null then (select auth.uid()) end,
            p_grupo_id, p_grupo_ordem, p_serie_id, p_serie_ordem);
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    raise exception '%', private.mensagem_exclusao(v_restricao);
  end;
  insert into public.agendamento_recursos (agendamento_id, recurso_id) select p_id, unnest(v_recursos);
  perform private.registrar_historico(p_id, 'criado',
    nullif(concat_ws(' · ', p_motivo_historico, case when v_justificativa is not null then 'Exceção de conflito da cliente autorizada: ' || v_justificativa end), ''),
    null, private.retrato_agendamento(p_id));
end $$;

-- Confere de novo uma reserva já movida (operações sobre marcação ou série inteira): como todas as reservas afetadas
-- já estão nas novas posições, os conflitos entre elas também são detectados.
create function private.revalidar_reserva(p_id uuid, p_justificativa text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reserva public.agendamentos;
  v_recursos uuid[];
  v_justificativa text;
begin
  select * into v_reserva from public.agendamentos where id = p_id;
  if v_reserva.inicio <= now() then
    raise exception 'Não é possível reagendar para data ou horário que já passou.';
  end if;
  perform private.validar_reserva(v_reserva.profissional_id, v_reserva.servico_id, v_reserva.inicio, v_reserva.ocupado_ate, p_id);
  select array_agg(recurso_id) into v_recursos from public.agendamento_recursos where agendamento_id = p_id;
  perform private.validar_recursos(v_recursos, v_reserva.inicio, v_reserva.ocupado_ate, p_id);
  v_justificativa := private.resolver_conflito_cliente(v_reserva.cliente_id, v_reserva.inicio, v_reserva.fim, p_id, p_justificativa);
  if v_justificativa is distinct from v_reserva.conflito_cliente_justificativa then
    update public.agendamentos
    set conflito_cliente_justificativa = v_justificativa,
        conflito_cliente_autorizado_por = case when v_justificativa is not null then (select auth.uid()) end
    where id = p_id;
  end if;
end $$;

-- Versões vistas pelo usuário ({"<id>": versao, ...}): todas as reservas afetadas e todas as que o usuário viu
-- (o impacto mostrado na tela) precisam estar iguais às atuais; senão nada é alterado.
create function private.exigir_versoes(p_ids uuid[], p_versoes jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.agendamentos a
    where a.id = any (p_ids) and (p_versoes ->> a.id::text) is distinct from a.versao::text
  ) or exists (
    select 1 from jsonb_each_text(coalesce(p_versoes, '{}')) v
    left join public.agendamentos a on a.id::text = v.key
    where a.id is null or a.versao::text is distinct from v.value
  ) then
    raise exception 'Alguma das reservas afetadas foi alterada por outra pessoa. Confira os dados atuais e tente de novo.'
      using hint = 'versao_desatualizada';
  end if;
end $$;

-- Retrato do histórico passa a indicar o vínculo com marcação ou série.
create or replace function private.retrato_agendamento(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', a.status,
    'data', to_char(a.inicio at time zone private.fuso(), 'YYYY-MM-DD'),
    'hora_inicio', to_char(a.inicio at time zone private.fuso(), 'HH24:MI'),
    'hora_fim', to_char(a.fim at time zone private.fuso(), 'HH24:MI'),
    'duracao_minutos', a.duracao_minutos,
    'preparacao_minutos', a.preparacao_minutos,
    'profissional_id', a.profissional_id,
    'profissional', p.nome,
    'servico', s.nome,
    'encaixe', a.encaixe,
    'observacao', a.observacao,
    'motivo_cancelamento', a.motivo_cancelamento,
    'cancelado_em', a.cancelado_em,
    'excecao_conflito_cliente', a.conflito_cliente_justificativa,
    'recursos', (select jsonb_agg(r.nome order by r.nome) from public.agendamento_recursos ar join public.recursos r on r.id = ar.recurso_id where ar.agendamento_id = a.id),
    'grupo_id', a.grupo_id, 'grupo_ordem', a.grupo_ordem,
    'serie_id', a.serie_id, 'serie_ordem', a.serie_ordem
  )
  from public.agendamentos a
  join public.profissionais p on p.id = a.profissional_id
  join public.servicos s on s.id = a.servico_id
  where a.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Criação individual (mesma assinatura da 011): passa a usar private.inserir_reserva
-- ---------------------------------------------------------------------------
create or replace function public.criar_agendamento(
  p_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_data date, p_hora time,
  p_observacao text, p_encaixe boolean, p_justificativa_conflito text, p_lista_espera_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_recursos uuid[];
  v_inicio timestamptz;
  v_existente public.agendamentos;
  v_espera public.lista_espera;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_id is null or p_cliente_id is null or p_servico_id is null or p_profissional_id is null or p_data is null or p_hora is null then
    raise exception 'Preencha cliente, serviço, profissional, data e horário.';
  end if;
  if char_length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação deve ter no máximo 500 caracteres.';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  v_inicio := (p_data + p_hora) at time zone private.fuso();
  select array_agg(recurso_id order by recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;
  perform private.travar_reservas(array[p_profissional_id], p_cliente_id, v_recursos);

  select * into v_existente from public.agendamentos where id = p_id;
  if found then
    -- Reenvio do mesmo pedido: devolve a reserva já gravada sem duplicar (CA11).
    if v_existente.criado_por = (select auth.uid()) and v_existente.cliente_id = p_cliente_id
       and v_existente.profissional_id = p_profissional_id and v_existente.inicio = v_inicio then
      return p_id;
    end if;
    raise exception 'Este agendamento já foi registrado.';
  end if;

  if p_lista_espera_id is not null then
    select * into v_espera from public.lista_espera where id = p_lista_espera_id for update;
    if not found then
      raise exception 'Entrada da lista de espera não encontrada.';
    end if;
    if v_espera.status not in ('aguardando', 'contatado') then
      raise exception 'Esta entrada da lista de espera já foi encerrada (%).', v_espera.status;
    end if;
    if v_espera.cliente_id <> p_cliente_id or v_espera.servico_id <> p_servico_id then
      raise exception 'A cliente e o serviço devem ser os mesmos da lista de espera.';
    end if;
  end if;

  perform private.inserir_reserva(p_id, p_cliente_id, p_servico_id, p_profissional_id, v_inicio, p_observacao, p_encaixe, p_justificativa_conflito);

  if p_lista_espera_id is not null then
    update public.lista_espera set status = 'agendado', agendamento_id = p_id, atualizado_por = (select auth.uid()) where id = p_lista_espera_id;
    insert into public.lista_espera_contatos (lista_espera_id, usuario_id, status_anterior, status_novo, observacao)
    values (p_lista_espera_id, (select auth.uid()), v_espera.status, 'agendado',
            'Agendado para ' || to_char(v_inicio at time zone private.fuso(), 'DD/MM/YYYY HH24:MI'));
  end if;
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Marcação com vários serviços
-- ---------------------------------------------------------------------------
-- p_etapas: [{"servico_id": "...", "profissional_id": "...", "data": "AAAA-MM-DD", "hora": "HH:MM"}, ...] (2 a 6 etapas).
-- Cada etapa tem profissional, início, duração efetiva e término próprios. Etapas consecutivas são permitidas;
-- sobreposição da cliente só com exceção da administração (p_justificativa_conflito). Tudo ou nada.
create function public.criar_grupo_agendamentos(p_grupo_id uuid, p_cliente_id uuid, p_etapas jsonb, p_observacao text, p_justificativa_conflito text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_total integer;
  v_existente public.grupos_agendamento;
  v_etapa record;
  v_msg text;
  v_dica text;
  v_estado text;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_grupo_id is null or p_cliente_id is null or jsonb_typeof(coalesce(p_etapas, 'null'::jsonb)) <> 'array' then
    raise exception 'Informe a cliente e as etapas da marcação.';
  end if;
  v_total := jsonb_array_length(p_etapas);
  if v_total < 2 or v_total > 6 then
    raise exception 'Uma marcação com vários serviços tem de 2 a 6 etapas.';
  end if;
  if char_length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação deve ter no máximo 500 caracteres.';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_etapas) e
             where (e ->> 'servico_id') is null or (e ->> 'profissional_id') is null or (e ->> 'data') is null or (e ->> 'hora') is null) then
    raise exception 'Preencha serviço, profissional, data e horário de todas as etapas.';
  end if;

  perform private.travar_reservas(
    array(select (e ->> 'profissional_id')::uuid from jsonb_array_elements(p_etapas) e),
    p_cliente_id,
    array(select sr.recurso_id from jsonb_array_elements(p_etapas) e join public.servico_recursos sr on sr.servico_id = (e ->> 'servico_id')::uuid));

  -- Reenvio da mesma marcação: devolve a já gravada, sem duplicar.
  select * into v_existente from public.grupos_agendamento where id = p_grupo_id;
  if found then
    if v_existente.criado_por = (select auth.uid()) and v_existente.cliente_id = p_cliente_id then
      return p_grupo_id;
    end if;
    raise exception 'Esta marcação já foi registrada.';
  end if;

  insert into public.grupos_agendamento (id, cliente_id, criado_por) values (p_grupo_id, p_cliente_id, (select auth.uid()));
  for v_etapa in select e, n from jsonb_array_elements(p_etapas) with ordinality as t (e, n) order by n loop
    begin
      perform private.inserir_reserva(gen_random_uuid(), p_cliente_id, (v_etapa.e ->> 'servico_id')::uuid, (v_etapa.e ->> 'profissional_id')::uuid,
        ((v_etapa.e ->> 'data')::date + (v_etapa.e ->> 'hora')::time) at time zone v_fuso,
        p_observacao, false, p_justificativa_conflito, p_grupo_id, v_etapa.n::integer, null, null,
        format('Marcação com %s serviços (etapa %s)', v_total, v_etapa.n));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_dica = pg_exception_hint, v_estado = returned_sqlstate;
      perform private.relancar('Etapa ' || v_etapa.n, v_msg, v_dica, v_estado);
    end;
  end loop;
  return p_grupo_id;
end $$;

-- Cancela as etapas ainda canceláveis da marcação (concluídas, em atendimento e já canceladas são preservadas).
create function public.cancelar_grupo(p_grupo_id uuid, p_motivo text, p_versoes jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := private.exigir_motivo(p_motivo);
  v_ids uuid[];
  v_id uuid;
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  perform 1 from public.agendamentos where grupo_id = p_grupo_id order by id for update;
  select array_agg(id order by grupo_ordem) into v_ids from public.agendamentos
  where grupo_id = p_grupo_id and status in ('agendado', 'confirmado', 'chegou');
  if v_ids is null then
    raise exception 'Nenhuma etapa desta marcação pode ser cancelada.';
  end if;
  perform private.exigir_versoes(v_ids, p_versoes);
  foreach v_id in array v_ids loop
    v_antes := private.retrato_agendamento(v_id);
    update public.agendamentos
    set status = 'cancelado', cancelado_por = (select auth.uid()), cancelado_em = now(), motivo_cancelamento = v_motivo, atualizado_por = (select auth.uid())
    where id = v_id;
    perform private.registrar_historico(v_id, 'cancelado', v_motivo || ' (marcação inteira)', v_antes, private.retrato_agendamento(v_id));
  end loop;
  return cardinality(v_ids);
end $$;

-- Move a marcação inteira: a primeira etapa passa a começar em p_data/p_hora e as demais mantêm a mesma distância
-- entre si, os profissionais e as durações. Exige que todas as etapas estejam aguardando ou confirmadas (sem mudança parcial).
create function public.reagendar_grupo(p_grupo_id uuid, p_data date, p_hora time, p_motivo text, p_versoes jsonb, p_justificativa_conflito text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := private.exigir_motivo(p_motivo);
  v_etapas public.agendamentos[];
  v_etapa public.agendamentos;
  v_bloqueada public.agendamentos;
  v_deslocamento interval;
  v_antes jsonb;
  v_retratos jsonb := '{}';
  v_msg text;
  v_dica text;
  v_estado text;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_data is null or p_hora is null then
    raise exception 'Informe a nova data e o horário da primeira etapa.';
  end if;
  select array_agg(a order by a.grupo_ordem) into v_etapas from public.agendamentos a where a.grupo_id = p_grupo_id;
  if v_etapas is null then
    raise exception 'Marcação não encontrada.';
  end if;
  perform private.travar_reservas(
    array(select e.profissional_id from unnest(v_etapas) e), (v_etapas[1]).cliente_id,
    array(select ar.recurso_id from public.agendamento_recursos ar where ar.agendamento_id in (select e.id from unnest(v_etapas) e)));
  perform 1 from public.agendamentos where grupo_id = p_grupo_id order by id for update;
  select array_agg(a order by a.grupo_ordem) into v_etapas from public.agendamentos a where a.grupo_id = p_grupo_id;
  select * into v_bloqueada from unnest(v_etapas) e where e.status not in ('agendado', 'confirmado') order by e.grupo_ordem limit 1;
  if found then
    raise exception 'A etapa % (%) não pode ser reagendada. Reagende as etapas pendentes individualmente.', v_bloqueada.grupo_ordem, private.rotulo_status(v_bloqueada.status);
  end if;
  perform private.exigir_versoes(array(select e.id from unnest(v_etapas) e), p_versoes);

  v_deslocamento := ((p_data + p_hora) at time zone private.fuso()) - (v_etapas[1]).inicio;
  if v_deslocamento = interval '0' then
    raise exception 'Informe um horário diferente do atual.';
  end if;
  set constraints public.agendamento_sem_sobreposicao, public.agendamento_cliente_sem_sobreposicao deferred;
  foreach v_etapa in array v_etapas loop
    v_retratos := v_retratos || jsonb_build_object(v_etapa.id::text, private.retrato_agendamento(v_etapa.id));
    update public.agendamentos
    set inicio = inicio + v_deslocamento, fim = fim + v_deslocamento, ocupado_ate = ocupado_ate + v_deslocamento, atualizado_por = (select auth.uid())
    where id = v_etapa.id;
  end loop;
  foreach v_etapa in array v_etapas loop
    begin
      perform private.revalidar_reserva(v_etapa.id, p_justificativa_conflito);
    exception when others then
      get stacked diagnostics v_msg = message_text, v_dica = pg_exception_hint, v_estado = returned_sqlstate;
      perform private.relancar('Etapa ' || v_etapa.grupo_ordem, v_msg, v_dica, v_estado);
    end;
    perform private.registrar_historico(v_etapa.id, 'reagendado', v_motivo || ' (marcação inteira)', v_retratos -> v_etapa.id::text, private.retrato_agendamento(v_etapa.id));
  end loop;
  set constraints public.agendamento_sem_sobreposicao, public.agendamento_cliente_sem_sobreposicao immediate;
  return cardinality(v_etapas);
end $$;

-- ---------------------------------------------------------------------------
-- Agendamentos recorrentes
-- ---------------------------------------------------------------------------
-- Datas da série. situacao: null (normal), 'ultimo_dia' (mês sem o dia: usado o último dia, por escolha),
-- 'pulada' (mês sem o dia: pulado, por escolha) ou 'inexistente' (mês sem o dia e nenhuma escolha feita).
-- Limite: 52 ocorrências e período de até 1 ano.
create function private.datas_serie(p_data_inicial date, p_frequencia text, p_quantidade integer, p_data_final date, p_dia_inexistente text)
returns table (ordem integer, data date, situacao text)
language plpgsql immutable set search_path = '' as $$
declare
  v_dia integer := extract(day from p_data_inicial);
  v_k integer := 0;
  v_ordem integer := 0;
  v_mes date;
  v_data date;
  v_ultimo date;
begin
  if p_frequencia not in ('semanal', 'quinzenal', 'mensal') then
    raise exception 'Frequência inválida.';
  end if;
  if (p_quantidade is null) = (p_data_final is null) then
    raise exception 'Informe a quantidade de ocorrências ou a data final.';
  end if;
  if p_quantidade is not null and (p_quantidade < 2 or p_quantidade > 52) then
    raise exception 'A série pode ter de 2 a 52 ocorrências.';
  end if;
  if p_data_final is not null and (p_data_final <= p_data_inicial or p_data_final - p_data_inicial > 366) then
    raise exception 'A data final deve ser posterior à inicial, em até 1 ano.';
  end if;
  loop
    exit when v_k > 60;
    if p_frequencia = 'mensal' then
      v_mes := (date_trunc('month', p_data_inicial) + make_interval(months => v_k))::date;
      v_ultimo := (v_mes + interval '1 month' - interval '1 day')::date;
      if v_dia <= extract(day from v_ultimo) then
        v_data := v_mes + (v_dia - 1); situacao := null;
      elsif p_dia_inexistente = 'ultimo_dia' then
        v_data := v_ultimo; situacao := 'ultimo_dia';
      elsif p_dia_inexistente = 'pular' then
        v_data := v_ultimo; situacao := 'pulada';
      else
        v_data := v_ultimo; situacao := 'inexistente';
      end if;
    else
      v_data := p_data_inicial + v_k * case when p_frequencia = 'semanal' then 7 else 14 end;
      situacao := null;
    end if;
    exit when p_data_final is not null and v_data > p_data_final;
    if situacao is distinct from 'pulada' then
      v_ordem := v_ordem + 1;
      if v_ordem > 52 then
        raise exception 'A série ultrapassa o limite de 52 ocorrências. Reduza o período.';
      end if;
    end if;
    ordem := case when situacao = 'pulada' then null else v_ordem end;
    data := v_data;
    return next;
    v_k := v_k + 1;
    exit when p_quantidade is not null and v_ordem >= p_quantidade;
  end loop;
end $$;

-- Valida uma ocorrência sem gravar (mesmas regras da criação).
create function private.validar_ocorrencia(p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_inicio timestamptz, p_justificativa text)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_duracao integer := private.duracao_efetiva(p_profissional_id, p_servico_id);
  v_preparacao integer;
  v_recursos uuid[];
begin
  if v_duracao is null then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  select preparacao_minutos into v_preparacao from public.servicos where id = p_servico_id;
  select array_agg(recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;
  if p_inicio <= now() then
    raise exception 'Não é possível agendar em data ou horário que já passou.';
  end if;
  perform private.validar_reserva(p_profissional_id, p_servico_id, p_inicio, p_inicio + make_interval(mins => v_duracao + v_preparacao), null);
  perform private.validar_recursos(v_recursos, p_inicio, p_inicio + make_interval(mins => v_duracao + v_preparacao), null);
  perform private.resolver_conflito_cliente(p_cliente_id, p_inicio, p_inicio + make_interval(mins => v_duracao), null, p_justificativa);
end $$;

-- Prévia: todas as datas com a situação de cada uma. Nada é gravado.
create function public.prever_serie(
  p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_data_inicial date, p_hora time, p_frequencia text,
  p_quantidade integer, p_data_final date, p_dia_inexistente text, p_justificativa_conflito text
) returns table (ordem integer, data date, situacao text, motivo text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_item record;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_cliente_id is null or p_servico_id is null or p_profissional_id is null or p_data_inicial is null or p_hora is null then
    raise exception 'Preencha cliente, serviço, profissional, data e horário.';
  end if;
  for v_item in select * from private.datas_serie(p_data_inicial, p_frequencia, p_quantidade, p_data_final, p_dia_inexistente) loop
    ordem := v_item.ordem;
    data := v_item.data;
    motivo := null;
    if v_item.situacao = 'pulada' then
      situacao := 'pulada';
      motivo := format('O dia %s não existe neste mês; mês pulado por escolha.', extract(day from p_data_inicial));
    elsif v_item.situacao = 'inexistente' then
      situacao := 'dia_inexistente';
      motivo := format('O dia %s não existe neste mês. Escolha usar o último dia do mês ou pular.', extract(day from p_data_inicial));
    else
      begin
        perform private.validar_ocorrencia(p_cliente_id, p_servico_id, p_profissional_id, (v_item.data + p_hora) at time zone v_fuso, p_justificativa_conflito);
        situacao := 'disponivel';
        if v_item.situacao = 'ultimo_dia' then
          motivo := format('O dia %s não existe neste mês; usado o último dia, por escolha.', extract(day from p_data_inicial));
        end if;
      exception when others then
        situacao := 'indisponivel';
        motivo := sqlerrm;
      end;
    end if;
    return next;
  end loop;
end $$;

-- Cria a série com as datas escolhidas (todas as disponíveis ou um subconjunto escolhido explicitamente).
-- Todas as ocorrências selecionadas são revalidadas aqui: se alguma falhar, nada é criado.
-- p_serie_id gerado no navegador torna o reenvio seguro (devolve a série já criada).
create function public.criar_serie(
  p_serie_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_data_inicial date, p_hora time, p_frequencia text,
  p_quantidade integer, p_data_final date, p_dia_inexistente text, p_datas date[], p_observacao text, p_justificativa_conflito text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_existente public.series_agendamento;
  v_item record;
  v_total integer;
  v_criadas integer := 0;
  v_msg text;
  v_dica text;
  v_estado text;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_serie_id is null or p_cliente_id is null or p_servico_id is null or p_profissional_id is null or p_data_inicial is null or p_hora is null then
    raise exception 'Preencha cliente, serviço, profissional, data e horário.';
  end if;
  if coalesce(cardinality(p_datas), 0) = 0 then
    raise exception 'Escolha ao menos uma data da série.';
  end if;
  if char_length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação deve ter no máximo 500 caracteres.';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  perform private.travar_reservas(array[p_profissional_id], p_cliente_id,
    array(select recurso_id from public.servico_recursos where servico_id = p_servico_id));

  select * into v_existente from public.series_agendamento where id = p_serie_id;
  if found then
    if v_existente.criado_por = (select auth.uid()) and v_existente.cliente_id = p_cliente_id then
      return (select count(*) from public.agendamentos where serie_id = p_serie_id);
    end if;
    raise exception 'Esta série já foi registrada.';
  end if;

  if exists (select 1 from private.datas_serie(p_data_inicial, p_frequencia, p_quantidade, p_data_final, p_dia_inexistente) d where d.situacao = 'inexistente') then
    raise exception 'Alguns meses não têm o dia %. Escolha usar o último dia do mês ou pular esses meses.', extract(day from p_data_inicial);
  end if;
  if exists (select 1 from unnest(p_datas) x where x not in (
       select d.data from private.datas_serie(p_data_inicial, p_frequencia, p_quantidade, p_data_final, p_dia_inexistente) d where d.ordem is not null)) then
    raise exception 'As datas escolhidas não correspondem à série. Gere a prévia novamente.';
  end if;
  select count(*) into v_total from private.datas_serie(p_data_inicial, p_frequencia, p_quantidade, p_data_final, p_dia_inexistente) d where d.ordem is not null;

  insert into public.series_agendamento (id, cliente_id, servico_id, profissional_id, frequencia, data_inicial, hora, quantidade, data_final, dia_inexistente, criado_por)
  values (p_serie_id, p_cliente_id, p_servico_id, p_profissional_id, p_frequencia, p_data_inicial, p_hora, p_quantidade, p_data_final, p_dia_inexistente, (select auth.uid()));

  for v_item in
    select d.ordem, d.data from private.datas_serie(p_data_inicial, p_frequencia, p_quantidade, p_data_final, p_dia_inexistente) d
    where d.ordem is not null and d.data = any (p_datas) order by d.ordem
  loop
    begin
      perform private.inserir_reserva(gen_random_uuid(), p_cliente_id, p_servico_id, p_profissional_id, (v_item.data + p_hora) at time zone v_fuso,
        p_observacao, false, p_justificativa_conflito, null, null, p_serie_id, v_item.ordem,
        format('Série %s (%s de %s)', p_frequencia, v_item.ordem, v_total));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_dica = pg_exception_hint, v_estado = returned_sqlstate;
      perform private.relancar('Ocorrência de ' || to_char(v_item.data, 'DD/MM/YYYY'), v_msg, v_dica, v_estado);
    end;
    v_criadas := v_criadas + 1;
  end loop;
  return v_criadas;
end $$;

-- Ocorrências afetadas por uma operação de série: aguardando ou confirmadas e ainda futuras;
-- com p_a_partir_de, somente essa ocorrência e as seguintes. Concluídas e passadas são preservadas.
create function private.ocorrencias_elegiveis(p_serie_id uuid, p_a_partir_de uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select array_agg(a.id order by a.serie_ordem)
  from public.agendamentos a
  where a.serie_id = p_serie_id and a.status in ('agendado', 'confirmado') and a.inicio > now()
    and (p_a_partir_de is null or a.serie_ordem >= (select serie_ordem from public.agendamentos where id = p_a_partir_de and serie_id = p_serie_id))
$$;

create function public.cancelar_serie(p_serie_id uuid, p_a_partir_de uuid, p_motivo text, p_versoes jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := private.exigir_motivo(p_motivo);
  v_ids uuid[];
  v_id uuid;
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  perform 1 from public.agendamentos where serie_id = p_serie_id order by id for update;
  v_ids := private.ocorrencias_elegiveis(p_serie_id, p_a_partir_de);
  if v_ids is null then
    raise exception 'Nenhuma ocorrência futura desta série pode ser cancelada.';
  end if;
  perform private.exigir_versoes(v_ids, p_versoes);
  foreach v_id in array v_ids loop
    v_antes := private.retrato_agendamento(v_id);
    update public.agendamentos
    set status = 'cancelado', cancelado_por = (select auth.uid()), cancelado_em = now(), motivo_cancelamento = v_motivo, atualizado_por = (select auth.uid())
    where id = v_id;
    perform private.registrar_historico(v_id, 'cancelado',
      v_motivo || case when p_a_partir_de is null then ' (toda a série)' else ' (esta e as próximas da série)' end, v_antes, private.retrato_agendamento(v_id));
  end loop;
  return cardinality(v_ids);
end $$;

-- Altera horário e/ou profissional das ocorrências elegíveis, mantendo a data de cada uma. Tudo ou nada.
create function public.reagendar_serie(
  p_serie_id uuid, p_a_partir_de uuid, p_hora time, p_profissional_id uuid, p_motivo text, p_versoes jsonb, p_justificativa_conflito text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := private.exigir_motivo(p_motivo);
  v_fuso text := private.fuso();
  v_ids uuid[];
  v_reserva public.agendamentos;
  v_profissional uuid;
  v_duracao integer;
  v_inicio timestamptz;
  v_retratos jsonb := '{}';
  v_msg text;
  v_dica text;
  v_estado text;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_hora is null then
    raise exception 'Informe o novo horário.';
  end if;
  v_ids := private.ocorrencias_elegiveis(p_serie_id, p_a_partir_de);
  if v_ids is null then
    raise exception 'Nenhuma ocorrência futura desta série pode ser alterada.';
  end if;
  select * into v_reserva from public.agendamentos where id = v_ids[1];
  v_profissional := coalesce(p_profissional_id, v_reserva.profissional_id);
  perform private.travar_reservas(
    array(select profissional_id from public.agendamentos where id = any (v_ids)) || v_profissional, v_reserva.cliente_id,
    array(select recurso_id from public.agendamento_recursos where agendamento_id = any (v_ids)));
  perform 1 from public.agendamentos where id = any (v_ids) order by id for update;
  -- Recalcula depois das travas: outra operação pode ter mudado a série.
  if v_ids is distinct from private.ocorrencias_elegiveis(p_serie_id, p_a_partir_de) then
    raise exception 'A série foi alterada por outra pessoa. Confira os dados atuais e tente de novo.' using hint = 'versao_desatualizada';
  end if;
  perform private.exigir_versoes(v_ids, p_versoes);

  set constraints public.agendamento_sem_sobreposicao, public.agendamento_cliente_sem_sobreposicao deferred;
  for v_reserva in select * from public.agendamentos where id = any (v_ids) order by serie_ordem loop
    v_retratos := v_retratos || jsonb_build_object(v_reserva.id::text, private.retrato_agendamento(v_reserva.id));
    v_duracao := case when v_profissional = v_reserva.profissional_id then v_reserva.duracao_minutos
                      else private.duracao_efetiva(v_profissional, v_reserva.servico_id) end;
    if v_duracao is null then
      raise exception 'Este profissional não está habilitado para o serviço da série.';
    end if;
    v_inicio := ((v_reserva.inicio at time zone v_fuso)::date + p_hora) at time zone v_fuso;
    update public.agendamentos
    set profissional_id = v_profissional, inicio = v_inicio, duracao_minutos = v_duracao,
        fim = v_inicio + make_interval(mins => v_duracao), ocupado_ate = v_inicio + make_interval(mins => v_duracao + preparacao_minutos),
        atualizado_por = (select auth.uid())
    where id = v_reserva.id;
  end loop;
  if not exists (select 1 from public.agendamentos a where a.id = any (v_ids)
                 and ((v_retratos -> a.id::text ->> 'hora_inicio') is distinct from to_char(a.inicio at time zone v_fuso, 'HH24:MI')
                      or (v_retratos -> a.id::text ->> 'profissional_id')::uuid is distinct from a.profissional_id)) then
    raise exception 'Informe um horário ou profissional diferente do atual.';
  end if;
  for v_reserva in select * from public.agendamentos where id = any (v_ids) order by serie_ordem loop
    begin
      perform private.revalidar_reserva(v_reserva.id, p_justificativa_conflito);
    exception when others then
      get stacked diagnostics v_msg = message_text, v_dica = pg_exception_hint, v_estado = returned_sqlstate;
      perform private.relancar('Ocorrência de ' || to_char(v_reserva.inicio at time zone v_fuso, 'DD/MM/YYYY'), v_msg, v_dica, v_estado);
    end;
    perform private.registrar_historico(v_reserva.id, 'reagendado',
      v_motivo || case when p_a_partir_de is null then ' (toda a série)' else ' (esta e as próximas da série)' end,
      v_retratos -> v_reserva.id::text, private.retrato_agendamento(v_reserva.id));
  end loop;
  set constraints public.agendamento_sem_sobreposicao, public.agendamento_cliente_sem_sobreposicao immediate;
  return cardinality(v_ids);
end $$;

-- ---------------------------------------------------------------------------
-- Agenda: vínculo com marcação e série
-- ---------------------------------------------------------------------------
alter type public.item_agenda
  add attribute grupo_id uuid,
  add attribute grupo_ordem integer,
  add attribute grupo_total integer,
  add attribute serie_id uuid,
  add attribute serie_ordem integer,
  add attribute serie_total integer,
  add attribute serie_frequencia text;

create or replace function private.itens_agenda(p_ids uuid[], p_completo boolean) returns setof public.item_agenda
language sql stable security definer set search_path = '' as $$
  select a.id, a.cliente_id, c.nome,
         case when p_completo then c.telefone end,
         a.servico_id, s.nome, a.profissional_id, p.nome, p.cor,
         a.inicio, a.fim,
         (a.inicio at time zone private.fuso())::date,
         to_char(a.inicio at time zone private.fuso(), 'HH24:MI'),
         to_char(a.fim at time zone private.fuso(), 'HH24:MI'),
         a.duracao_minutos, a.status, a.encaixe,
         case when p_completo then a.observacao end,
         case when p_completo then a.motivo_cancelamento end,
         a.criado_em, a.atualizado_em,
         a.preparacao_minutos, a.ocupado_ate, to_char(a.ocupado_ate at time zone private.fuso(), 'HH24:MI'), a.versao,
         case when p_completo then a.conflito_cliente_justificativa end,
         (select string_agg(r.nome, ', ' order by r.nome) from public.agendamento_recursos ar join public.recursos r on r.id = ar.recurso_id where ar.agendamento_id = a.id),
         case when p_completo then uc.tipo end,
         case when p_completo then uc.registrado_em end,
         case when p_completo then uc.registrado_por end,
         case when p_completo then uc.tipo is not null and (uc.inicio_referencia <> a.inicio or uc.profissional_referencia <> a.profissional_id) end,
         a.grupo_id, a.grupo_ordem::integer,
         (select count(*)::integer from public.agendamentos g where g.grupo_id = a.grupo_id),
         a.serie_id, a.serie_ordem::integer,
         (select count(*)::integer from public.agendamentos sa where sa.serie_id = a.serie_id),
         se.frequencia
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  join public.servicos s on s.id = a.servico_id
  join public.profissionais p on p.id = a.profissional_id
  left join public.series_agendamento se on se.id = a.serie_id
  left join lateral (
    select co.tipo, co.registrado_em, coalesce(pf.nome, 'Usuário removido') as registrado_por, co.inicio_referencia, co.profissional_referencia
    from public.comunicacoes co left join public.perfis pf on pf.usuario_id = co.registrado_por
    where co.agendamento_id = a.id order by co.registrado_em desc limit 1
  ) uc on true
  where a.id = any (p_ids)
  order by a.inicio, p.nome
$$;

-- Reservas vinculadas (etapas da marcação ou ocorrências da série), para mostrar o impacto das operações.
create function public.agendamentos_vinculados(p_grupo_id uuid, p_serie_id uuid) returns setof public.item_agenda
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if (p_grupo_id is null) = (p_serie_id is null) then
    raise exception 'Informe a marcação ou a série.';
  end if;
  return query select * from private.itens_agenda(array(
    select id from public.agendamentos where (p_grupo_id is not null and grupo_id = p_grupo_id) or (p_serie_id is not null and serie_id = p_serie_id)
  ), true);
end $$;

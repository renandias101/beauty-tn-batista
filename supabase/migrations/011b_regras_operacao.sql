-- Operação da agenda, parte 2: regras no servidor.
-- As funções que mudam de parâmetros ganham uma nova assinatura (com versão e justificativa obrigatórias na chamada);
-- as assinaturas anteriores deixam de ser chamáveis pela aplicação na parte 3 (011c).
-- Mensagens com código P0001 são exibidas ao usuário. O "hint" identifica situações tratadas pela interface:
--   conflito_cliente      a cliente já tem atendimento no período
--   versao_desatualizada  outra pessoa alterou o registro depois que ele foi aberto

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Duração efetiva: a específica do profissional para o serviço ou, sem ela, a padrão do serviço.
-- Retorna null quando o profissional não está habilitado para o serviço.
create function private.duracao_efetiva(p_profissional_id uuid, p_servico_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(ps.duracao_minutos, s.duracao_minutos)
  from public.profissional_servicos ps
  join public.servicos s on s.id = ps.servico_id
  where ps.profissional_id = p_profissional_id and ps.servico_id = p_servico_id
$$;

-- Ordem fixa de travas em todas as funções: profissionais, cliente e recursos (cada grupo em ordem crescente).
create function private.travar_cliente(p_cliente_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cliente:' || p_cliente_id::text, 0));
end $$;

create function private.travar_recursos(p_recursos uuid[]) returns void
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in select distinct x from unnest(coalesce(p_recursos, '{}')) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('recurso:' || v_id::text, 0));
  end loop;
end $$;

create function private.exigir_versao(p_atual integer, p_informada integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_informada is null or p_informada <> p_atual then
    raise exception 'Este agendamento foi alterado por outra pessoa depois que você o abriu. Confira os dados atuais e tente de novo.'
      using hint = 'versao_desatualizada';
  end if;
end $$;

create function private.rotulo_status(p_status public.status_agendamento) returns text
language sql immutable set search_path = '' as $$
  select case p_status
    when 'agendado' then 'aguardando confirmação' when 'confirmado' then 'presença confirmada'
    when 'chegou' then 'cliente presente' when 'em_atendimento' then 'em atendimento'
    when 'concluido' then 'concluído' when 'cancelado' then 'cancelado' else 'faltou' end
$$;

-- Descrição de um atendimento para mensagens de conflito (sem telefone nem observação).
create function private.descrever_atendimento(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select format('%s, %s–%s, %s com %s (%s)',
    to_char(a.inicio at time zone private.fuso(), 'DD/MM'), to_char(a.inicio at time zone private.fuso(), 'HH24:MI'),
    to_char(a.fim at time zone private.fuso(), 'HH24:MI'), s.nome, p.nome, private.rotulo_status(a.status))
  from public.agendamentos a
  join public.servicos s on s.id = a.servico_id
  join public.profissionais p on p.id = a.profissional_id
  where a.id = p_id
$$;

-- Retrato legível da reserva para o histórico (passa a incluir preparação, recursos, cancelamento e exceção).
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
    'recursos', (select jsonb_agg(r.nome order by r.nome) from public.agendamento_recursos ar join public.recursos r on r.id = ar.recurso_id where ar.agendamento_id = a.id)
  )
  from public.agendamentos a
  join public.profissionais p on p.id = a.profissional_id
  join public.servicos s on s.id = a.servico_id
  where a.id = p_id
$$;

-- Bloqueios e outras reservas do profissional no período ocupado [inicio, ocupado_ate).
create function private.validar_ocupacao_profissional(p_profissional_id uuid, p_inicio timestamptz, p_ocupado_ate timestamptz, p_ignorar_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_motivo text;
  v_conflito uuid;
begin
  select motivo into v_motivo from public.bloqueios
  where profissional_id = p_profissional_id and removido_em is null
    and tstzrange(inicio, fim, '[)') && tstzrange(p_inicio, p_ocupado_ate, '[)')
  limit 1;
  if found then
    raise exception 'O horário está bloqueado na agenda do profissional (%).', v_motivo;
  end if;
  select a.id into v_conflito from public.agendamentos a
  where a.profissional_id = p_profissional_id and private.ocupa_periodo(a.status)
    and a.id is distinct from p_ignorar_id
    and tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(p_inicio, p_ocupado_ate, '[)')
  order by a.inicio limit 1;
  if v_conflito is not null then
    raise exception 'Já existe um atendimento deste profissional nesse período (incluindo a preparação): %.', private.descrever_atendimento(v_conflito);
  end if;
end $$;

-- RN01–RN05 com preparação: o período inteiro (atendimento + preparação) cabe na jornada, sem bloqueios nem outras reservas.
create function private.validar_reserva(
  p_profissional_id uuid, p_servico_id uuid, p_inicio timestamptz, p_ocupado_ate timestamptz, p_ignorar_id uuid
) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dia date := (p_inicio at time zone private.fuso())::date;
begin
  if not exists (select 1 from public.profissionais where id = p_profissional_id and ativo) then
    raise exception 'O profissional selecionado está inativo ou não foi encontrado.';
  end if;
  if not exists (select 1 from public.servicos where id = p_servico_id and ativo) then
    raise exception 'O serviço selecionado está inativo ou não foi encontrado.';
  end if;
  if not exists (select 1 from public.profissional_servicos where profissional_id = p_profissional_id and servico_id = p_servico_id) then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  if not private.cabe_na_jornada(p_profissional_id, p_inicio, p_ocupado_ate) then
    if not exists (select 1 from public.disponibilidades where profissional_id = p_profissional_id and removido_em is null and dia_semana = extract(dow from v_dia)::smallint)
       and not exists (select 1 from public.excecoes_disponibilidade where profissional_id = p_profissional_id and removido_em is null and data = v_dia) then
      raise exception 'O profissional não atende nesta data.';
    end if;
    raise exception 'O horário não cabe na jornada do profissional (atendimento e preparação). Verifique intervalos e o fim do expediente.';
  end if;
  perform private.validar_ocupacao_profissional(p_profissional_id, p_inicio, p_ocupado_ate, p_ignorar_id);
end $$;

-- Capacidade dos recursos no período. A ocupação máxima acontece no início do período ou no início
-- de alguma reserva que começa dentro dele; basta contar nesses instantes.
create function private.recurso_disponivel(p_recurso_id uuid, p_inicio timestamptz, p_ocupado_ate timestamptz, p_ignorar_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with reservas as (
    select a.inicio, a.ocupado_ate from public.agendamento_recursos ar
    join public.agendamentos a on a.id = ar.agendamento_id
    where ar.recurso_id = p_recurso_id and private.ocupa_periodo(a.status) and a.id is distinct from p_ignorar_id
      and tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(p_inicio, p_ocupado_ate, '[)')
  ), instantes as (
    select p_inicio as t union select inicio from reservas where inicio > p_inicio
  )
  select coalesce(max((select count(*) from reservas r where r.inicio <= i.t and r.ocupado_ate > i.t)), 0)
         < (select capacidade from public.recursos where id = p_recurso_id)
  from instantes i
$$;

create function private.validar_recursos(p_recursos uuid[], p_inicio timestamptz, p_ocupado_ate timestamptz, p_ignorar_id uuid, p_exigir_ativos boolean default true) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_recurso record;
begin
  for v_recurso in select r.id, r.nome, r.ativo from public.recursos r where r.id = any (coalesce(p_recursos, '{}')) order by r.nome loop
    if p_exigir_ativos and not v_recurso.ativo then
      raise exception 'O recurso "%" exigido por este serviço está desativado. Peça à administração para revisar o serviço.', v_recurso.nome;
    end if;
    if not private.recurso_disponivel(v_recurso.id, p_inicio, p_ocupado_ate, p_ignorar_id) then
      raise exception 'O recurso "%" já está em uso nesse período. Escolha outro horário.', v_recurso.nome;
    end if;
  end loop;
end $$;

-- Conflito da cliente: devolve a justificativa a gravar (exceção autorizada) ou null quando não há conflito.
-- A autorização vem somente do perfil gravado no banco; o parâmetro enviado pelo navegador não basta.
create function private.resolver_conflito_cliente(p_cliente_id uuid, p_inicio timestamptz, p_fim timestamptz, p_ignorar_id uuid, p_justificativa text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_conflito uuid;
  v_texto text := btrim(coalesce(p_justificativa, ''));
begin
  select a.id into v_conflito from public.agendamentos a
  where a.cliente_id = p_cliente_id and private.ocupa_periodo(a.status) and a.id is distinct from p_ignorar_id
    and tstzrange(a.inicio, a.fim, '[)') && tstzrange(p_inicio, p_fim, '[)')
  order by a.inicio limit 1;
  if v_conflito is null then
    return null;
  end if;
  if private.papel_atual() is distinct from 'admin' then
    raise exception 'A cliente já tem atendimento nesse período: %. Somente a administração pode autorizar uma exceção.', private.descrever_atendimento(v_conflito)
      using hint = 'conflito_cliente';
  end if;
  if char_length(v_texto) < 3 or char_length(v_texto) > 300 then
    raise exception 'A cliente já tem atendimento nesse período: %. Para manter mesmo assim, informe a justificativa da exceção (3 a 300 caracteres).', private.descrever_atendimento(v_conflito)
      using hint = 'conflito_cliente';
  end if;
  return v_texto;
end $$;

-- Gravação final protegida pelas restrições do banco (rede de segurança contra corridas).
create function private.mensagem_exclusao(p_restricao text) returns text
language sql immutable set search_path = '' as $$
  select case p_restricao
    when 'agendamento_cliente_sem_sobreposicao' then 'A cliente já tem atendimento nesse período. Atualize a agenda e tente de novo.'
    else 'Já existe uma reserva nesse período. Atualize a agenda e escolha outro horário.' end
$$;

-- ---------------------------------------------------------------------------
-- Cálculo de horários livres (agenda interna e consulta pública usam a mesma regra)
-- ---------------------------------------------------------------------------
-- Horários encaixados um após o outro a partir do início de cada faixa da jornada, com passo igual a
-- atendimento + preparação. Ao encontrar ocupação (bloqueio, reserva ou recurso sem capacidade),
-- a contagem recomeça no fim dela. Nunca retorna horários passados.
create function private.calcular_horarios(
  p_profissional_id uuid, p_data_inicio date, p_data_fim date, p_duracao integer, p_preparacao integer, p_recursos uuid[], p_ignorar_id uuid
) returns table (dia date, horario text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_passo integer := p_duracao + coalesce(p_preparacao, 0);
  v_data date := p_data_inicio;
  v_faixa record;
  v_cursor timestamp;
  v_fim_faixa timestamp;
  v_ini timestamptz;
  v_ocup timestamptz;
  v_ocupado_ate timestamptz;
  v_recurso uuid;
begin
  if p_duracao is null or p_duracao <= 0 then
    return;
  end if;
  -- Serviço que exige recurso desativado não tem horários.
  if exists (select 1 from public.recursos where id = any (coalesce(p_recursos, '{}')) and not ativo) then
    return;
  end if;
  while v_data <= p_data_fim loop
    for v_faixa in
      select d.hora_inicio as ini, d.hora_fim as fim from public.disponibilidades d
      where d.profissional_id = p_profissional_id and d.removido_em is null and d.dia_semana = extract(dow from v_data)::smallint
      union all
      select e.hora_inicio, e.hora_fim from public.excecoes_disponibilidade e
      where e.profissional_id = p_profissional_id and e.removido_em is null and e.data = v_data
      order by 1
    loop
      v_cursor := v_data + v_faixa.ini;
      v_fim_faixa := v_data + v_faixa.fim;
      while v_cursor + make_interval(mins => v_passo) <= v_fim_faixa loop
        v_ini := v_cursor at time zone v_fuso;
        v_ocup := v_ini + make_interval(mins => v_passo);
        select max(o.fim) into v_ocupado_ate from (
          select b.fim from public.bloqueios b
          where b.profissional_id = p_profissional_id and b.removido_em is null
            and tstzrange(b.inicio, b.fim, '[)') && tstzrange(v_ini, v_ocup, '[)')
          union all
          select a.ocupado_ate from public.agendamentos a
          where a.profissional_id = p_profissional_id and private.ocupa_periodo(a.status) and a.id is distinct from p_ignorar_id
            and tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(v_ini, v_ocup, '[)')
        ) o;
        if v_ocupado_ate is null then
          foreach v_recurso in array coalesce(p_recursos, '{}') loop
            if not private.recurso_disponivel(v_recurso, v_ini, v_ocup, p_ignorar_id) then
              -- Próximo instante em que alguma reserva do recurso termina.
              select min(a.ocupado_ate) into v_ocupado_ate from public.agendamento_recursos ar
              join public.agendamentos a on a.id = ar.agendamento_id
              where ar.recurso_id = v_recurso and private.ocupa_periodo(a.status) and a.id is distinct from p_ignorar_id
                and tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(v_ini, v_ocup, '[)');
              exit;
            end if;
          end loop;
        end if;
        if v_ocupado_ate is not null then
          v_cursor := greatest(v_ocupado_ate at time zone v_fuso, v_cursor + interval '1 minute');
        else
          if v_ini > now() then
            dia := v_data;
            horario := to_char(v_cursor, 'HH24:MI');
            return next;
          end if;
          v_cursor := v_cursor + make_interval(mins => v_passo);
        end if;
      end loop;
    end loop;
    v_data := v_data + 1;
  end loop;
end $$;

-- Sugestões de horário da agenda interna. Com p_ignorar_id (reagendamento), usa a preparação e os recursos
-- gravados na reserva; p_duracao_minutos permite à administração simular outra duração.
create function public.horarios_livres(
  p_servico_id uuid, p_profissional_id uuid, p_data date, p_ignorar_id uuid, p_duracao_minutos integer
) returns setof text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_duracao integer;
  v_preparacao integer;
  v_recursos uuid[];
  v_reserva public.agendamentos;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_data is null then
    raise exception 'Informe a data.';
  end if;
  if p_ignorar_id is not null then
    select * into v_reserva from public.agendamentos where id = p_ignorar_id;
    if not found then
      raise exception 'Agendamento não encontrado.';
    end if;
    v_preparacao := v_reserva.preparacao_minutos;
    select array_agg(recurso_id) into v_recursos from public.agendamento_recursos where agendamento_id = p_ignorar_id;
    v_duracao := case when v_reserva.profissional_id = p_profissional_id then v_reserva.duracao_minutos
                      else private.duracao_efetiva(p_profissional_id, v_reserva.servico_id) end;
  else
    select preparacao_minutos into v_preparacao from public.servicos where id = p_servico_id;
    select array_agg(recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;
    v_duracao := private.duracao_efetiva(p_profissional_id, p_servico_id);
  end if;
  v_duracao := coalesce(p_duracao_minutos, v_duracao);
  if v_duracao is null or v_duracao <= 0 or v_duracao > 720 then
    return;
  end if;
  return query select c.horario from private.calcular_horarios(p_profissional_id, p_data, p_data, v_duracao, v_preparacao, v_recursos, p_ignorar_id) c;
end $$;

-- Consulta pública: mesma assinatura e retorno; passa a considerar duração por profissional, preparação e recursos.
create or replace function public.horarios_disponiveis(p_servico_id uuid, p_profissional_id uuid, p_data_inicio date, p_data_fim date)
returns table (dia date, horario text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone private.fuso())::date;
  v_horizonte integer;
  v_duracao integer;
  v_preparacao integer;
  v_recursos uuid[];
begin
  select horizonte_publico_dias into v_horizonte from public.configuracao_clinica limit 1;
  select s.preparacao_minutos into v_preparacao from public.servicos s where s.id = p_servico_id and s.ativo;
  if not found then
    raise exception 'Serviço indisponível para consulta.';
  end if;
  if not exists (select 1 from public.profissionais p where p.id = p_profissional_id and p.ativo) then
    raise exception 'Profissional indisponível para este serviço.';
  end if;
  v_duracao := private.duracao_efetiva(p_profissional_id, p_servico_id);
  if v_duracao is null then
    raise exception 'Profissional indisponível para este serviço.';
  end if;
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido.';
  end if;
  if p_data_fim - p_data_inicio > 62 then
    raise exception 'Consulte no máximo 62 dias por vez.';
  end if;
  select array_agg(recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;
  return query select c.dia, c.horario
  from private.calcular_horarios(p_profissional_id, greatest(p_data_inicio, v_hoje), least(p_data_fim, v_hoje + v_horizonte),
                                 v_duracao, v_preparacao, v_recursos, null) c;
end $$;

-- Duração do atendimento informada ao visitante (sem a preparação interna).
create function public.duracao_publica(p_servico_id uuid, p_profissional_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select private.duracao_efetiva(p_profissional_id, p_servico_id)
  where exists (select 1 from public.servicos where id = p_servico_id and ativo)
    and exists (select 1 from public.profissionais where id = p_profissional_id and ativo)
$$;

-- ---------------------------------------------------------------------------
-- Agenda: listagem com versão, preparação, recursos e última comunicação
-- ---------------------------------------------------------------------------
alter type public.item_agenda
  add attribute preparacao_minutos integer,
  add attribute ocupado_ate timestamptz,
  add attribute hora_ocupado_ate text,
  add attribute versao integer,
  add attribute excecao_conflito_cliente text,
  add attribute recursos text,
  add attribute ultima_comunicacao_tipo text,
  add attribute ultima_comunicacao_em timestamptz,
  add attribute ultima_comunicacao_por text,
  add attribute comunicacao_desatualizada boolean;

create function private.itens_agenda(p_ids uuid[], p_completo boolean) returns setof public.item_agenda
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
         case when p_completo then uc.tipo is not null and (uc.inicio_referencia <> a.inicio or uc.profissional_referencia <> a.profissional_id) end
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  join public.servicos s on s.id = a.servico_id
  join public.profissionais p on p.id = a.profissional_id
  left join lateral (
    select co.tipo, co.registrado_em, coalesce(pf.nome, 'Usuário removido') as registrado_por, co.inicio_referencia, co.profissional_referencia
    from public.comunicacoes co left join public.perfis pf on pf.usuario_id = co.registrado_por
    where co.agendamento_id = a.id order by co.registrado_em desc limit 1
  ) uc on true
  where a.id = any (p_ids)
  order by a.inicio, p.nome
$$;

-- O profissional continua recebendo somente a própria agenda e dados mínimos (sem telefone, observação e comunicações).
create or replace function public.listar_agenda(p_data_inicio date, p_data_fim date, p_profissional_id uuid default null)
returns setof public.item_agenda
language plpgsql stable security definer set search_path = '' as $$
declare
  v_papel public.papel_usuario := private.exigir_papel(array['admin', 'secretaria', 'profissional']::public.papel_usuario[]);
  v_fuso text := private.fuso();
  v_profissional uuid := p_profissional_id;
begin
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido.';
  end if;
  if p_data_fim - p_data_inicio > 62 then
    raise exception 'Consulte no máximo 62 dias por vez.';
  end if;
  if v_papel = 'profissional' then
    v_profissional := private.profissional_atual();
    if v_profissional is null then
      raise exception 'Seu usuário não está vinculado a um profissional. Procure a administração.';
    end if;
  end if;
  return query select * from private.itens_agenda(array(
    select a.id from public.agendamentos a
    where a.inicio >= (p_data_inicio::timestamp at time zone v_fuso)
      and a.inicio < ((p_data_fim + 1)::timestamp at time zone v_fuso)
      and (v_profissional is null or a.profissional_id = v_profissional)
  ), v_papel in ('admin', 'secretaria'));
end $$;

create or replace function public.agendamentos_do_cliente(p_cliente_id uuid)
returns setof public.item_agenda
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query select i.* from private.itens_agenda(array(select id from public.agendamentos where cliente_id = p_cliente_id), true) i
  order by i.inicio desc;
end $$;

-- ---------------------------------------------------------------------------
-- Criação
-- ---------------------------------------------------------------------------
-- p_justificativa_conflito: usada somente quando a cliente já tem atendimento no período e quem grava é a administração.
-- p_lista_espera_id: a entrada da lista de espera passa a "agendado" na mesma transação, só depois da reserva gravada.
create function public.criar_agendamento(
  p_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_data date, p_hora time,
  p_observacao text, p_encaixe boolean, p_justificativa_conflito text, p_lista_espera_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_duracao integer;
  v_preparacao integer;
  v_recursos uuid[];
  v_inicio timestamptz;
  v_fim timestamptz;
  v_ocupado timestamptz;
  v_justificativa text;
  v_existente public.agendamentos;
  v_espera public.lista_espera;
  v_restricao text;
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
  select preparacao_minutos into v_preparacao from public.servicos where id = p_servico_id;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;
  v_duracao := private.duracao_efetiva(p_profissional_id, p_servico_id);
  if v_duracao is null then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  select array_agg(recurso_id order by recurso_id) into v_recursos from public.servico_recursos where servico_id = p_servico_id;

  v_inicio := (p_data + p_hora) at time zone private.fuso();
  v_fim := v_inicio + make_interval(mins => v_duracao);
  v_ocupado := v_fim + make_interval(mins => v_preparacao);

  perform private.travar_profissional(p_profissional_id);
  perform private.travar_cliente(p_cliente_id);
  perform private.travar_recursos(v_recursos);

  select * into v_existente from public.agendamentos where id = p_id;
  if found then
    -- Reenvio do mesmo pedido: devolve a reserva já gravada sem duplicar (CA11).
    if v_existente.criado_por = (select auth.uid()) and v_existente.cliente_id = p_cliente_id
       and v_existente.profissional_id = p_profissional_id and v_existente.inicio = v_inicio then
      return p_id;
    end if;
    raise exception 'Este agendamento já foi registrado.';
  end if;

  -- Sem lançamento retroativo: o horário precisa estar no futuro, no fuso da clínica.
  if v_inicio <= now() then
    raise exception 'Não é possível agendar em data ou horário que já passou.';
  end if;

  perform private.validar_reserva(p_profissional_id, p_servico_id, v_inicio, v_ocupado, null);
  perform private.validar_recursos(v_recursos, v_inicio, v_ocupado, null);
  v_justificativa := private.resolver_conflito_cliente(p_cliente_id, v_inicio, v_fim, null, p_justificativa_conflito);

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

  begin
    insert into public.agendamentos (id, cliente_id, servico_id, profissional_id, inicio, duracao_minutos, fim, preparacao_minutos, ocupado_ate,
                                     encaixe, observacao, criado_por, atualizado_por, conflito_cliente_justificativa, conflito_cliente_autorizado_por)
    values (p_id, p_cliente_id, p_servico_id, p_profissional_id, v_inicio, v_duracao, v_fim, v_preparacao, v_ocupado,
            coalesce(p_encaixe, false), nullif(btrim(coalesce(p_observacao, '')), ''), (select auth.uid()), (select auth.uid()),
            v_justificativa, case when v_justificativa is not null then (select auth.uid()) end);
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    raise exception '%', private.mensagem_exclusao(v_restricao);
  end;
  insert into public.agendamento_recursos (agendamento_id, recurso_id) select p_id, unnest(v_recursos);

  perform private.registrar_historico(p_id, 'criado',
    case when v_justificativa is not null then 'Exceção de conflito da cliente autorizada: ' || v_justificativa end,
    null, private.retrato_agendamento(p_id));

  if p_lista_espera_id is not null then
    update public.lista_espera set status = 'agendado', agendamento_id = p_id, atualizado_por = (select auth.uid()) where id = p_lista_espera_id;
    insert into public.lista_espera_contatos (lista_espera_id, usuario_id, status_anterior, status_novo, observacao)
    values (p_lista_espera_id, (select auth.uid()), v_espera.status, 'agendado',
            'Agendado para ' || to_char(v_inicio at time zone private.fuso(), 'DD/MM/YYYY HH24:MI'));
  end if;
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Andamento, cancelamento, edição e reagendamento (com versão)
-- ---------------------------------------------------------------------------
create function public.alterar_status_agendamento(p_id uuid, p_status public.status_agendamento, p_versao integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_atual public.agendamentos;
  v_permitidos public.status_agendamento[];
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  select * into v_atual from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform private.exigir_versao(v_atual.versao, p_versao);
  if p_status = 'cancelado' then
    raise exception 'Use a ação de cancelar, que exige o motivo.';
  end if;
  v_permitidos := case v_atual.status
    when 'agendado' then array['confirmado', 'chegou', 'faltou']::public.status_agendamento[]
    when 'confirmado' then array['chegou', 'faltou']::public.status_agendamento[]
    when 'chegou' then array['em_atendimento', 'concluido']::public.status_agendamento[]
    when 'em_atendimento' then array['concluido']::public.status_agendamento[]
    else array[]::public.status_agendamento[]
  end;
  if not (p_status = any (v_permitidos)) then
    raise exception 'Não é possível mudar de "%" para "%". Para corrigir um registro, use a correção de status da administração.',
      private.rotulo_status(v_atual.status), private.rotulo_status(p_status);
  end if;
  if p_status = 'faltou' and now() < v_atual.inicio then
    raise exception 'A falta só pode ser registrada após o horário previsto.';
  end if;
  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos set status = p_status, atualizado_por = (select auth.uid()) where id = p_id;
  perform private.registrar_historico(p_id, 'status_alterado', null, v_antes, private.retrato_agendamento(p_id));
end $$;

create function public.cancelar_agendamento(p_id uuid, p_motivo text, p_versao integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_atual public.agendamentos;
  v_motivo text;
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  v_motivo := private.exigir_motivo(p_motivo);
  select * into v_atual from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform private.exigir_versao(v_atual.versao, p_versao);
  if v_atual.status not in ('agendado', 'confirmado', 'chegou') then
    raise exception 'Agendamentos com status "%" não podem ser cancelados.', private.rotulo_status(v_atual.status);
  end if;
  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos
  set status = 'cancelado', cancelado_por = (select auth.uid()), cancelado_em = now(),
      motivo_cancelamento = v_motivo, atualizado_por = (select auth.uid())
  where id = p_id;
  perform private.registrar_historico(p_id, 'cancelado', v_motivo, v_antes, private.retrato_agendamento(p_id));
end $$;

create function public.editar_agendamento(p_id uuid, p_observacao text, p_encaixe boolean, p_versao integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_atual public.agendamentos;
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if char_length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação deve ter no máximo 500 caracteres.';
  end if;
  select * into v_atual from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform private.exigir_versao(v_atual.versao, p_versao);
  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos
  set observacao = nullif(btrim(coalesce(p_observacao, '')), ''), encaixe = coalesce(p_encaixe, false), atualizado_por = (select auth.uid())
  where id = p_id;
  perform private.registrar_historico(p_id, 'editado', null, v_antes, private.retrato_agendamento(p_id));
end $$;

-- RN06: valida o novo horário e só então libera o anterior, na mesma transação.
-- Mantém a preparação e os recursos gravados na reserva. Mesmo profissional: mantém a duração gravada;
-- outro profissional: usa a duração efetiva dele. Somente a administração informa outra duração.
create function public.reagendar_agendamento(
  p_id uuid, p_data date, p_hora time, p_profissional_id uuid, p_motivo text, p_duracao_minutos integer,
  p_versao integer, p_justificativa_conflito text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_papel public.papel_usuario := private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  v_motivo text := private.exigir_motivo(p_motivo);
  v_atual public.agendamentos;
  v_profissional uuid;
  v_base integer;
  v_duracao integer;
  v_recursos uuid[];
  v_inicio timestamptz;
  v_fim timestamptz;
  v_ocupado timestamptz;
  v_justificativa text;
  v_antes jsonb;
  v_trava uuid;
  v_restricao text;
begin
  if p_data is null or p_hora is null then
    raise exception 'Informe a nova data e o novo horário.';
  end if;
  select * into v_atual from public.agendamentos where id = p_id;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  v_profissional := coalesce(p_profissional_id, v_atual.profissional_id);
  v_base := case when v_profissional = v_atual.profissional_id then v_atual.duracao_minutos
                 else private.duracao_efetiva(v_profissional, v_atual.servico_id) end;
  if v_base is null then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  v_duracao := coalesce(p_duracao_minutos, v_base);
  if v_duracao <> v_base and v_papel <> 'admin' then
    raise exception 'Somente a administração pode ajustar a duração de uma reserva.';
  end if;
  if v_duracao <= 0 or v_duracao > 720 then
    raise exception 'A duração deve ser maior que zero e de no máximo 12 horas.';
  end if;
  select array_agg(recurso_id order by recurso_id) into v_recursos from public.agendamento_recursos where agendamento_id = p_id;

  for v_trava in select distinct x from unnest(array[v_atual.profissional_id, v_profissional]) as x order by x loop
    perform private.travar_profissional(v_trava);
  end loop;
  perform private.travar_cliente(v_atual.cliente_id);
  perform private.travar_recursos(v_recursos);

  select * into v_atual from public.agendamentos where id = p_id for update;
  perform private.exigir_versao(v_atual.versao, p_versao);
  if v_atual.status not in ('agendado', 'confirmado') then
    raise exception 'Somente agendamentos aguardando confirmação ou com presença confirmada podem ser reagendados.';
  end if;

  v_inicio := (p_data + p_hora) at time zone private.fuso();
  v_fim := v_inicio + make_interval(mins => v_duracao);
  v_ocupado := v_fim + make_interval(mins => v_atual.preparacao_minutos);
  if v_inicio = v_atual.inicio and v_profissional = v_atual.profissional_id and v_duracao = v_atual.duracao_minutos then
    raise exception 'Informe um horário, profissional ou duração diferente do atual.';
  end if;
  if v_inicio <= now() then
    raise exception 'Não é possível reagendar para data ou horário que já passou.';
  end if;

  perform private.validar_reserva(v_profissional, v_atual.servico_id, v_inicio, v_ocupado, p_id);
  perform private.validar_recursos(v_recursos, v_inicio, v_ocupado, p_id);
  v_justificativa := private.resolver_conflito_cliente(v_atual.cliente_id, v_inicio, v_fim, p_id, p_justificativa_conflito);

  v_antes := private.retrato_agendamento(p_id);
  begin
    update public.agendamentos
    set profissional_id = v_profissional, inicio = v_inicio, duracao_minutos = v_duracao, fim = v_fim, ocupado_ate = v_ocupado,
        conflito_cliente_justificativa = v_justificativa,
        conflito_cliente_autorizado_por = case when v_justificativa is not null then (select auth.uid()) end,
        atualizado_por = (select auth.uid())
    where id = p_id;
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    raise exception '%', private.mensagem_exclusao(v_restricao);
  end;
  perform private.registrar_historico(p_id, 'reagendado',
    v_motivo || case when v_justificativa is not null then ' · Exceção de conflito da cliente autorizada: ' || v_justificativa else '' end,
    v_antes, private.retrato_agendamento(p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Correção administrativa de status
-- ---------------------------------------------------------------------------
-- Corrige um status marcado por engano (inclusive concluído, faltou e cancelado), com justificativa e histórico.
-- Ao voltar para um status que ocupa o período, revalida jornada, bloqueios e reservas do profissional, recursos e cliente.
-- Cancelamento: ao corrigir para cancelado, grava responsável, momento e motivo; ao sair de cancelado, os dados
-- de cancelamento são limpos no registro e continuam preservados no histórico.
create function public.corrigir_status_agendamento(p_id uuid, p_status public.status_agendamento, p_justificativa text, p_versao integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_justificativa text;
  v_atual public.agendamentos;
  v_recursos uuid[];
  v_conflito uuid;
  v_antes jsonb;
  v_restricao text;
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  v_justificativa := private.exigir_motivo(p_justificativa);
  if p_status is null then
    raise exception 'Informe o status correto.';
  end if;
  select * into v_atual from public.agendamentos where id = p_id;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  select array_agg(recurso_id order by recurso_id) into v_recursos from public.agendamento_recursos where agendamento_id = p_id;
  perform private.travar_profissional(v_atual.profissional_id);
  perform private.travar_cliente(v_atual.cliente_id);
  perform private.travar_recursos(v_recursos);

  select * into v_atual from public.agendamentos where id = p_id for update;
  perform private.exigir_versao(v_atual.versao, p_versao);
  if p_status = v_atual.status then
    raise exception 'O agendamento já está com o status "%".', private.rotulo_status(p_status);
  end if;
  if p_status = 'faltou' and now() < v_atual.inicio then
    raise exception 'A falta só pode ser registrada após o horário previsto.';
  end if;

  if private.ocupa_periodo(p_status) and not private.ocupa_periodo(v_atual.status) then
    if not private.cabe_na_jornada(v_atual.profissional_id, v_atual.inicio, v_atual.ocupado_ate) then
      raise exception 'O horário deste agendamento não cabe mais na jornada do profissional (atendimento e preparação). Reagende em vez de corrigir o status.';
    end if;
    perform private.validar_ocupacao_profissional(v_atual.profissional_id, v_atual.inicio, v_atual.ocupado_ate, p_id);
    perform private.validar_recursos(v_recursos, v_atual.inicio, v_atual.ocupado_ate, p_id, false);
    -- Sobreposição da cliente só é aceita se já tinha sido autorizada como exceção (nesta reserva ou na outra).
    select a.id into v_conflito from public.agendamentos a
    where a.cliente_id = v_atual.cliente_id and private.ocupa_periodo(a.status) and a.id <> p_id
      and tstzrange(a.inicio, a.fim, '[)') && tstzrange(v_atual.inicio, v_atual.fim, '[)')
      and a.conflito_cliente_justificativa is null and v_atual.conflito_cliente_justificativa is null
    order by a.inicio limit 1;
    if v_conflito is not null then
      raise exception 'A cliente já tem outro atendimento nesse período: %. Resolva esse atendimento antes de corrigir o status.', private.descrever_atendimento(v_conflito)
        using hint = 'conflito_cliente';
    end if;
  end if;

  v_antes := private.retrato_agendamento(p_id);
  begin
    update public.agendamentos
    set status = p_status,
        cancelado_por = case when p_status = 'cancelado' then (select auth.uid()) end,
        cancelado_em = case when p_status = 'cancelado' then now() end,
        motivo_cancelamento = case when p_status = 'cancelado' then v_justificativa end,
        atualizado_por = (select auth.uid())
    where id = p_id;
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    raise exception '%', private.mensagem_exclusao(v_restricao);
  end;
  perform private.registrar_historico(p_id, 'status_corrigido', v_justificativa, v_antes, private.retrato_agendamento(p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Comunicações (WhatsApp manual assistido)
-- ---------------------------------------------------------------------------
-- Registra que a equipe enviou a mensagem. Abrir o WhatsApp não chama esta função.
-- p_id é gerado pelo navegador: o mesmo clique repetido não duplica o registro.
create function public.registrar_comunicacao(p_id uuid, p_agendamento_id uuid, p_tipo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_atual public.agendamentos;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_id is null or p_tipo not in ('confirmacao', 'lembrete', 'cancelamento', 'reagendamento') then
    raise exception 'Tipo de mensagem inválido.';
  end if;
  if exists (select 1 from public.comunicacoes where id = p_id) then
    return p_id;
  end if;
  select * into v_atual from public.agendamentos where id = p_agendamento_id;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  if p_tipo = 'cancelamento' and v_atual.status <> 'cancelado' then
    raise exception 'O aviso de cancelamento só pode ser registrado para agendamentos cancelados.';
  end if;
  if p_tipo <> 'cancelamento' and v_atual.status not in ('agendado', 'confirmado') then
    raise exception 'Esta mensagem só pode ser registrada para agendamentos aguardando confirmação ou com presença confirmada.';
  end if;
  insert into public.comunicacoes (id, agendamento_id, tipo, registrado_por, inicio_referencia, profissional_referencia)
  values (p_id, p_agendamento_id, p_tipo, (select auth.uid()), v_atual.inicio, v_atual.profissional_id);
  return p_id;
end $$;

create function public.listar_comunicacoes(p_agendamento_id uuid)
returns table (id uuid, tipo text, registrado_em timestamptz, registrado_por text, desatualizada boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query
  select c.id, c.tipo, c.registrado_em, coalesce(pf.nome, 'Usuário removido'),
         (c.inicio_referencia <> a.inicio or c.profissional_referencia <> a.profissional_id)
  from public.comunicacoes c
  join public.agendamentos a on a.id = c.agendamento_id
  left join public.perfis pf on pf.usuario_id = c.registrado_por
  where c.agendamento_id = p_agendamento_id
  order by c.registrado_em desc;
end $$;

-- ---------------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------------
create function public.criar_lista_espera(
  p_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid, p_data_inicio date, p_data_fim date,
  p_hora_inicio time, p_hora_fim time, p_observacao text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone private.fuso())::date;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_id is null or p_cliente_id is null or p_servico_id is null or p_data_inicio is null or p_data_fim is null then
    raise exception 'Preencha cliente, serviço e o período de datas.';
  end if;
  if exists (select 1 from public.lista_espera where id = p_id) then
    return p_id;
  end if;
  if p_data_fim < p_data_inicio or p_data_fim < v_hoje then
    raise exception 'Informe um período de datas válido, que termine hoje ou depois.';
  end if;
  if p_data_fim - p_data_inicio > 180 then
    raise exception 'O período pode ter no máximo 180 dias.';
  end if;
  if (p_hora_inicio is null) <> (p_hora_fim is null) or (p_hora_inicio is not null and p_hora_inicio >= p_hora_fim) then
    raise exception 'Informe a faixa de horário completa (início antes do fim) ou deixe as duas em branco.';
  end if;
  if char_length(coalesce(p_observacao, '')) > 300 then
    raise exception 'A observação deve ter no máximo 300 caracteres.';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  if not exists (select 1 from public.servicos where id = p_servico_id and ativo) then
    raise exception 'O serviço selecionado está inativo ou não foi encontrado.';
  end if;
  if p_profissional_id is not null and private.duracao_efetiva(p_profissional_id, p_servico_id) is null then
    raise exception 'Este profissional não está habilitado para o serviço selecionado.';
  end if;
  begin
    insert into public.lista_espera (id, cliente_id, servico_id, profissional_id, data_inicio, data_fim, hora_inicio, hora_fim, observacao, criado_por, atualizado_por)
    values (p_id, p_cliente_id, p_servico_id, p_profissional_id, p_data_inicio, p_data_fim, p_hora_inicio, p_hora_fim,
            nullif(btrim(coalesce(p_observacao, '')), ''), (select auth.uid()), (select auth.uid()));
  exception when unique_violation then
    raise exception 'Esta cliente já está na lista de espera para este serviço e profissional. Atualize a entrada existente.';
  end;
  insert into public.lista_espera_contatos (lista_espera_id, usuario_id, status_anterior, status_novo, observacao)
  values (p_id, (select auth.uid()), null, 'aguardando', 'Entrada na lista de espera');
  return p_id;
end $$;

-- Mudança de situação feita pela equipe (contato, desistência, reabertura). "agendado" só acontece ao criar a reserva.
create function public.atualizar_lista_espera(p_id uuid, p_status text, p_observacao text, p_versao integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_atual public.lista_espera;
  v_observacao text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_status not in ('aguardando', 'contatado', 'desistiu') then
    raise exception 'Situação inválida. A situação "agendado" é definida ao criar o agendamento.';
  end if;
  if char_length(coalesce(v_observacao, '')) > 300 then
    raise exception 'A observação deve ter no máximo 300 caracteres.';
  end if;
  select * into v_atual from public.lista_espera where id = p_id for update;
  if not found then
    raise exception 'Entrada da lista de espera não encontrada.';
  end if;
  if p_versao is null or p_versao <> v_atual.versao then
    raise exception 'Esta entrada foi alterada por outra pessoa. Atualize a lista e tente de novo.' using hint = 'versao_desatualizada';
  end if;
  if v_atual.status = 'agendado' then
    raise exception 'Esta entrada já foi agendada e não pode mudar de situação.';
  end if;
  if p_status = v_atual.status and v_observacao is null then
    raise exception 'Informe uma observação do contato ou escolha outra situação.';
  end if;
  begin
    update public.lista_espera set status = p_status, atualizado_por = (select auth.uid()) where id = p_id;
  exception when unique_violation then
    raise exception 'Já existe outra entrada em aberto para esta cliente, serviço e profissional.';
  end;
  insert into public.lista_espera_contatos (lista_espera_id, usuario_id, status_anterior, status_novo, observacao)
  values (p_id, (select auth.uid()), v_atual.status, p_status, v_observacao);
end $$;

create function public.listar_lista_espera(p_status text default null)
returns table (
  id uuid, cliente_id uuid, cliente_nome text, cliente_telefone text, servico_id uuid, servico_nome text,
  profissional_id uuid, profissional_nome text, data_inicio date, data_fim date, hora_inicio text, hora_fim text,
  observacao text, status text, agendamento_id uuid, versao integer, criado_em timestamptz, criado_por text,
  ultimo_contato_em timestamptz, ultimo_contato_por text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query
  select l.id, l.cliente_id, c.nome, c.telefone, l.servico_id, s.nome, l.profissional_id, p.nome,
         l.data_inicio, l.data_fim, to_char(l.hora_inicio, 'HH24:MI'), to_char(l.hora_fim, 'HH24:MI'),
         l.observacao, l.status, l.agendamento_id, l.versao, l.criado_em, coalesce(pc.nome, 'Usuário removido'),
         uc.ocorrido_em, uc.nome
  from public.lista_espera l
  join public.clientes c on c.id = l.cliente_id
  join public.servicos s on s.id = l.servico_id
  left join public.profissionais p on p.id = l.profissional_id
  left join public.perfis pc on pc.usuario_id = l.criado_por
  left join lateral (
    select lc.ocorrido_em, coalesce(pf.nome, 'Usuário removido') as nome from public.lista_espera_contatos lc
    left join public.perfis pf on pf.usuario_id = lc.usuario_id
    where lc.lista_espera_id = l.id order by lc.ocorrido_em desc, lc.id desc limit 1
  ) uc on true
  where p_status is null or l.status = p_status
  order by case l.status when 'aguardando' then 0 when 'contatado' then 1 else 2 end, l.criado_em;
end $$;

create function public.contatos_lista_espera(p_id uuid)
returns table (id bigint, ocorrido_em timestamptz, usuario_nome text, status_anterior text, status_novo text, observacao text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query
  select lc.id, lc.ocorrido_em, coalesce(pf.nome, 'Usuário removido'), lc.status_anterior, lc.status_novo, lc.observacao
  from public.lista_espera_contatos lc
  left join public.perfis pf on pf.usuario_id = lc.usuario_id
  where lc.lista_espera_id = p_id
  order by lc.ocorrido_em, lc.id;
end $$;

-- Candidatos para uma vaga liberada [p_inicio, p_ocupado_ate) de um profissional: entradas em aberto cujo serviço
-- (com a duração efetiva e a preparação) cabe na vaga, dentro do período e da faixa desejados. Não reserva nada.
create function public.candidatos_lista_espera(p_profissional_id uuid, p_inicio timestamptz, p_ocupado_ate timestamptz)
returns table (
  id uuid, cliente_id uuid, cliente_nome text, servico_id uuid, servico_nome text, duracao_minutos integer,
  profissional_preferido text, data_inicio date, data_fim date, hora_inicio text, hora_fim text, observacao text, status text, versao integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_dia date := (p_inicio at time zone v_fuso)::date;
  v_hora time := (p_inicio at time zone v_fuso)::time;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if p_inicio is null or p_ocupado_ate is null or p_ocupado_ate <= p_inicio or p_inicio <= now() then
    return;
  end if;
  return query
  select l.id, l.cliente_id, c.nome, l.servico_id, s.nome, d.duracao, p.nome, l.data_inicio, l.data_fim,
         to_char(l.hora_inicio, 'HH24:MI'), to_char(l.hora_fim, 'HH24:MI'), l.observacao, l.status, l.versao
  from public.lista_espera l
  join public.clientes c on c.id = l.cliente_id
  join public.servicos s on s.id = l.servico_id and s.ativo
  left join public.profissionais p on p.id = l.profissional_id
  cross join lateral (select private.duracao_efetiva(p_profissional_id, l.servico_id) as duracao) d
  where l.status in ('aguardando', 'contatado')
    and (l.profissional_id is null or l.profissional_id = p_profissional_id)
    and d.duracao is not null
    and p_inicio + make_interval(mins => d.duracao + s.preparacao_minutos) <= p_ocupado_ate
    and v_dia between l.data_inicio and l.data_fim
    and (l.hora_inicio is null or (v_hora >= l.hora_inicio and v_hora + make_interval(mins => d.duracao) <= l.hora_fim
                                    and v_hora + make_interval(mins => d.duracao) > v_hora))
  order by l.criado_em;
end $$;

-- ---------------------------------------------------------------------------
-- Recursos: desativar ou reduzir capacidade exige tratar as reservas futuras antes
-- ---------------------------------------------------------------------------
create function private.validar_alteracao_recurso() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if (old.ativo and not new.ativo) or new.capacidade < old.capacidade then
    perform private.travar_recursos(array[new.id]);
    select array_agg(a.id order by a.inicio) into v_ids
    from public.agendamento_recursos ar
    join public.agendamentos a on a.id = ar.agendamento_id
    where ar.recurso_id = new.id and private.ocupa_horario(a.status) and a.ocupado_ate > now()
      and (not new.ativo or (
        select count(*) from public.agendamento_recursos ar2 join public.agendamentos b on b.id = ar2.agendamento_id
        where ar2.recurso_id = new.id and private.ocupa_periodo(b.status) and b.inicio <= a.inicio and b.ocupado_ate > a.inicio
      ) > new.capacidade);
    if v_ids is not null then
      raise exception 'O recurso está reservado em % agendamento(s) futuro(s): %. Reagende ou cancele essas reservas antes de %.',
        cardinality(v_ids), private.descrever_agendamentos(v_ids), case when not new.ativo then 'desativar' else 'reduzir a capacidade' end;
    end if;
  end if;
  return new;
end $$;

create trigger recursos_validar_alteracao before update on public.recursos
for each row execute function private.validar_alteracao_recurso();

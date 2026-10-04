-- Funções de agenda expostas pela API. Cada uma confere o perfil, valida no servidor e registra o histórico.

create type public.item_agenda as (
  id uuid,
  cliente_id uuid,
  cliente_nome text,
  cliente_telefone text,
  servico_id uuid,
  servico_nome text,
  profissional_id uuid,
  profissional_nome text,
  profissional_cor text,
  inicio timestamptz,
  fim timestamptz,
  data date,
  hora_inicio text,
  hora_fim text,
  duracao_minutos integer,
  status public.status_agendamento,
  encaixe boolean,
  observacao text,
  motivo_cancelamento text,
  criado_em timestamptz,
  atualizado_em timestamptz
);

-- Lista a agenda conforme o perfil. O profissional recebe somente a própria agenda e dados mínimos
-- (sem telefone e observação), mesmo que chame a função diretamente (seção 10 do PRD).
create function public.listar_agenda(p_data_inicio date, p_data_fim date, p_profissional_id uuid default null)
returns setof public.item_agenda
language plpgsql stable security definer set search_path = '' as $$
declare
  v_papel public.papel_usuario := private.exigir_papel(array['admin', 'secretaria', 'profissional']::public.papel_usuario[]);
  v_fuso text := private.fuso();
  v_profissional uuid := p_profissional_id;
  v_completo boolean := v_papel in ('admin', 'secretaria');
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

  return query
  select a.id, a.cliente_id, c.nome,
         case when v_completo then c.telefone end,
         a.servico_id, s.nome, a.profissional_id, p.nome, p.cor,
         a.inicio, a.fim,
         (a.inicio at time zone v_fuso)::date,
         to_char(a.inicio at time zone v_fuso, 'HH24:MI'),
         to_char(a.fim at time zone v_fuso, 'HH24:MI'),
         a.duracao_minutos, a.status, a.encaixe,
         case when v_completo then a.observacao end,
         case when v_completo then a.motivo_cancelamento end,
         a.criado_em, a.atualizado_em
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  join public.servicos s on s.id = a.servico_id
  join public.profissionais p on p.id = a.profissional_id
  where a.inicio >= (p_data_inicio::timestamp at time zone v_fuso)
    and a.inicio < ((p_data_fim + 1)::timestamp at time zone v_fuso)
    and (v_profissional is null or a.profissional_id = v_profissional)
  order by a.inicio, p.nome;
end $$;

-- RF08: agendamentos anteriores e futuros de um cliente.
create function public.agendamentos_do_cliente(p_cliente_id uuid)
returns setof public.item_agenda
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query
  select a.id, a.cliente_id, c.nome, c.telefone, a.servico_id, s.nome, a.profissional_id, p.nome, p.cor,
         a.inicio, a.fim, (a.inicio at time zone v_fuso)::date,
         to_char(a.inicio at time zone v_fuso, 'HH24:MI'), to_char(a.fim at time zone v_fuso, 'HH24:MI'),
         a.duracao_minutos, a.status, a.encaixe, a.observacao, a.motivo_cancelamento, a.criado_em, a.atualizado_em
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  join public.servicos s on s.id = a.servico_id
  join public.profissionais p on p.id = a.profissional_id
  where a.cliente_id = p_cliente_id
  order by a.inicio desc;
end $$;

-- RF06: cria a reserva. p_id é gerado pelo navegador e serve de chave de idempotência (RF10, CA11).
create function public.criar_agendamento(
  p_id uuid, p_cliente_id uuid, p_servico_id uuid, p_profissional_id uuid,
  p_data date, p_hora time, p_observacao text default null, p_encaixe boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_duracao integer;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_existente public.agendamentos;
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
  select duracao_minutos into v_duracao from public.servicos where id = p_servico_id;
  if v_duracao is null then
    raise exception 'Serviço não encontrado.';
  end if;

  v_inicio := (p_data + p_hora) at time zone private.fuso();
  v_fim := v_inicio + make_interval(mins => v_duracao);

  perform private.travar_profissional(p_profissional_id);

  select * into v_existente from public.agendamentos where id = p_id;
  if found then
    -- Reenvio do mesmo pedido: devolve a reserva já gravada sem duplicar.
    if v_existente.criado_por = (select auth.uid()) and v_existente.cliente_id = p_cliente_id
       and v_existente.profissional_id = p_profissional_id and v_existente.inicio = v_inicio then
      return p_id;
    end if;
    raise exception 'Este agendamento já foi registrado.';
  end if;

  perform private.validar_horario(p_profissional_id, p_servico_id, v_inicio, v_fim, null);

  insert into public.agendamentos (id, cliente_id, servico_id, profissional_id, inicio, duracao_minutos, fim, encaixe, observacao, criado_por, atualizado_por)
  values (p_id, p_cliente_id, p_servico_id, p_profissional_id, v_inicio, v_duracao, v_fim, coalesce(p_encaixe, false),
          nullif(btrim(coalesce(p_observacao, '')), ''), (select auth.uid()), (select auth.uid()));

  perform private.registrar_historico(p_id, 'criado', null, null, private.retrato_agendamento(p_id));
  return p_id;
end $$;

-- RF07: confirmação e andamento do atendimento.
create function public.alterar_status_agendamento(p_id uuid, p_status public.status_agendamento) returns void
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
  if p_status = 'cancelado' then
    raise exception 'Use a ação de cancelar, que exige o motivo.';
  end if;

  v_permitidos := case v_atual.status
    when 'agendado' then array['confirmado', 'chegou', 'faltou']
    when 'confirmado' then array['chegou', 'faltou']
    when 'chegou' then array['em_atendimento', 'concluido']
    when 'em_atendimento' then array['concluido']
    else array[]::public.status_agendamento[]
  end;
  if not (p_status = any (v_permitidos)) then
    raise exception 'Não é possível mudar de "%" para "%".', v_atual.status, p_status;
  end if;
  if p_status = 'faltou' and now() < v_atual.inicio then
    raise exception 'A falta só pode ser registrada após o horário previsto.';
  end if;

  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos set status = p_status, atualizado_por = (select auth.uid()) where id = p_id;
  perform private.registrar_historico(p_id, 'status_alterado', null, v_antes, private.retrato_agendamento(p_id));
end $$;

-- RN07: cancelamento com responsável, momento e motivo; o registro é preservado.
create function public.cancelar_agendamento(p_id uuid, p_motivo text) returns void
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
  if v_atual.status not in ('agendado', 'confirmado', 'chegou') then
    raise exception 'Agendamentos com status "%" não podem ser cancelados.', v_atual.status;
  end if;

  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos
  set status = 'cancelado', cancelado_por = (select auth.uid()), cancelado_em = now(),
      motivo_cancelamento = v_motivo, atualizado_por = (select auth.uid())
  where id = p_id;
  perform private.registrar_historico(p_id, 'cancelado', v_motivo, v_antes, private.retrato_agendamento(p_id));
end $$;

-- RN06: valida o novo horário e só então libera o anterior, na mesma transação.
create function public.reagendar_agendamento(
  p_id uuid, p_data date, p_hora time, p_profissional_id uuid, p_motivo text, p_duracao_minutos integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_papel public.papel_usuario := private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  v_motivo text := private.exigir_motivo(p_motivo);
  v_atual public.agendamentos;
  v_profissional uuid;
  v_duracao integer;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_antes jsonb;
  v_trava uuid;
begin
  if p_data is null or p_hora is null then
    raise exception 'Informe a nova data e o novo horário.';
  end if;
  select * into v_atual from public.agendamentos where id = p_id;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  v_profissional := coalesce(p_profissional_id, v_atual.profissional_id);
  v_duracao := coalesce(p_duracao_minutos, v_atual.duracao_minutos);
  if v_duracao <> v_atual.duracao_minutos and v_papel <> 'admin' then
    raise exception 'Somente a administração pode ajustar a duração de uma reserva.';
  end if;
  if v_duracao <= 0 or v_duracao > 720 then
    raise exception 'A duração deve ser maior que zero e de no máximo 12 horas.';
  end if;

  -- Trava as duas agendas sempre na mesma ordem para evitar impasse entre transações.
  for v_trava in select distinct x from unnest(array[v_atual.profissional_id, v_profissional]) as x order by x loop
    perform private.travar_profissional(v_trava);
  end loop;

  select * into v_atual from public.agendamentos where id = p_id for update;
  if v_atual.status not in ('agendado', 'confirmado') then
    raise exception 'Somente agendamentos agendados ou confirmados podem ser reagendados.';
  end if;

  v_inicio := (p_data + p_hora) at time zone private.fuso();
  v_fim := v_inicio + make_interval(mins => v_duracao);
  if v_inicio = v_atual.inicio and v_profissional = v_atual.profissional_id and v_duracao = v_atual.duracao_minutos then
    raise exception 'Informe um horário, profissional ou duração diferente do atual.';
  end if;

  perform private.validar_horario(v_profissional, v_atual.servico_id, v_inicio, v_fim, p_id);

  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos
  set profissional_id = v_profissional, inicio = v_inicio, duracao_minutos = v_duracao, fim = v_fim,
      atualizado_por = (select auth.uid())
  where id = p_id;
  perform private.registrar_historico(p_id, 'reagendado', v_motivo, v_antes, private.retrato_agendamento(p_id));
end $$;

-- Ajustes que não mexem no horário: observação operacional e identificação de encaixe.
create function public.editar_agendamento(p_id uuid, p_observacao text, p_encaixe boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb;
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if char_length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação deve ter no máximo 500 caracteres.';
  end if;
  perform 1 from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;
  v_antes := private.retrato_agendamento(p_id);
  update public.agendamentos
  set observacao = nullif(btrim(coalesce(p_observacao, '')), ''), encaixe = coalesce(p_encaixe, false),
      atualizado_por = (select auth.uid())
  where id = p_id;
  perform private.registrar_historico(p_id, 'editado', null, v_antes, private.retrato_agendamento(p_id));
end $$;

-- Consulta do histórico de alterações (perfil Administração, seção 4 do PRD).
create function public.historico_do_agendamento(p_id uuid)
returns table (id bigint, acao text, usuario_nome text, ocorrido_em timestamptz, motivo text, valores_anteriores jsonb, valores_novos jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  return query
  select h.id, h.acao, coalesce(pf.nome, 'Usuário removido'), h.ocorrido_em, h.motivo, h.valores_anteriores, h.valores_novos
  from public.historico_agendamentos h
  left join public.perfis pf on pf.usuario_id = h.usuario_id
  where h.agendamento_id = p_id
  order by h.ocorrido_em, h.id;
end $$;

-- Lista de usuários para a administração (o e-mail fica em auth.users).
create function public.listar_usuarios()
returns table (usuario_id uuid, nome text, email text, papel public.papel_usuario, ativo boolean, profissional_id uuid, profissional_nome text, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  return query
  select pf.usuario_id, pf.nome, u.email::text, pf.papel, pf.ativo, p.id, p.nome, u.last_sign_in_at
  from public.perfis pf
  join auth.users u on u.id = pf.usuario_id
  left join public.profissionais p on p.usuario_id = pf.usuario_id
  order by pf.ativo desc, pf.nome;
end $$;

-- Dados do usuário logado, usados pela interface para montar o menu conforme o perfil.
create function public.meu_perfil()
returns table (usuario_id uuid, nome text, papel public.papel_usuario, profissional_id uuid, fuso_horario text)
language sql stable security definer set search_path = '' as $$
  select pf.usuario_id, pf.nome, pf.papel, private.profissional_atual(), private.fuso()
  from public.perfis pf
  where pf.usuario_id = (select auth.uid()) and pf.ativo
$$;

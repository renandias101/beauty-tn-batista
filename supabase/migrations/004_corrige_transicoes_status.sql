-- Correção encontrada pelo teste de integração: as listas de transição precisam do tipo
-- explícito status_agendamento[]; sem a conversão, toda mudança de andamento falhava.
create or replace function public.alterar_status_agendamento(p_id uuid, p_status public.status_agendamento) returns void
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
    when 'agendado' then array['confirmado', 'chegou', 'faltou']::public.status_agendamento[]
    when 'confirmado' then array['chegou', 'faltou']::public.status_agendamento[]
    when 'chegou' then array['em_atendimento', 'concluido']::public.status_agendamento[]
    when 'em_atendimento' then array['concluido']::public.status_agendamento[]
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

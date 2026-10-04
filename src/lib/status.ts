import type { StatusAgendamento } from '../types'

// "Presença confirmada" é a resposta da cliente; mensagem enviada é registrada à parte (comunicações).
export const STATUS: Record<StatusAgendamento, { rotulo: string; classes: string }> = {
  agendado: { rotulo: 'Aguardando confirmação', classes: 'bg-warning-soft text-warning' },
  confirmado: { rotulo: 'Presença confirmada', classes: 'bg-success-soft text-success' },
  chegou: { rotulo: 'Cliente presente', classes: 'bg-info-soft text-info' },
  em_atendimento: { rotulo: 'Em atendimento', classes: 'bg-info-soft text-info' },
  concluido: { rotulo: 'Concluído', classes: 'bg-secondary text-secondary-foreground' },
  cancelado: { rotulo: 'Cancelado', classes: 'bg-error-soft text-error' },
  faltou: { rotulo: 'Faltou', classes: 'bg-error-soft text-error' },
}

export const LISTA_STATUS = Object.keys(STATUS) as StatusAgendamento[]

/** Reserva ativa (RN04): ainda precisa ser resolvida antes de bloquear, mudar jornada ou inativar. */
export const ocupaHorario = (status: StatusAgendamento) =>
  status === 'agendado' || status === 'confirmado' || status === 'chegou' || status === 'em_atendimento'

/**
 * Ocupa o período previsto na agenda (atendimento + preparação). Concluir antes do horário não libera o período.
 * Cancelado e faltou liberam: na falta a cliente não veio, então o tempo restante pode receber um encaixe.
 * Espelha private.ocupa_periodo no banco.
 */
export const ocupaPeriodo = (status: StatusAgendamento) => ocupaHorario(status) || status === 'concluido'

/** Próximos passos permitidos; espelha public.alterar_status_agendamento no banco. */
export const PROXIMOS_STATUS: Record<StatusAgendamento, { status: StatusAgendamento; acao: string }[]> = {
  agendado: [{ status: 'confirmado', acao: 'Confirmar presença' }, { status: 'chegou', acao: 'Registrar chegada' }, { status: 'faltou', acao: 'Registrar falta' }],
  confirmado: [{ status: 'chegou', acao: 'Registrar chegada' }, { status: 'faltou', acao: 'Registrar falta' }],
  chegou: [{ status: 'em_atendimento', acao: 'Iniciar atendimento' }, { status: 'concluido', acao: 'Concluir' }],
  em_atendimento: [{ status: 'concluido', acao: 'Concluir atendimento' }],
  concluido: [],
  cancelado: [],
  faltou: [],
}

export const podeCancelar = (status: StatusAgendamento) => status === 'agendado' || status === 'confirmado' || status === 'chegou'
export const podeReagendar = (status: StatusAgendamento) => status === 'agendado' || status === 'confirmado'

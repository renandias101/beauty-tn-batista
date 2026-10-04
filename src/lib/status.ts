import type { StatusAgendamento } from '../types'

export const STATUS: Record<StatusAgendamento, { rotulo: string; classes: string }> = {
  agendado: { rotulo: 'Agendado', classes: 'bg-warning-soft text-warning' },
  confirmado: { rotulo: 'Confirmado', classes: 'bg-success-soft text-success' },
  chegou: { rotulo: 'Cliente chegou', classes: 'bg-info-soft text-info' },
  em_atendimento: { rotulo: 'Em atendimento', classes: 'bg-info-soft text-info' },
  concluido: { rotulo: 'Concluído', classes: 'bg-secondary text-secondary-foreground' },
  cancelado: { rotulo: 'Cancelado', classes: 'bg-error-soft text-error' },
  faltou: { rotulo: 'Faltou', classes: 'bg-error-soft text-error' },
}

export const LISTA_STATUS = Object.keys(STATUS) as StatusAgendamento[]

/** RN04: estados que ocupam o horário do profissional. */
export const ocupaHorario = (status: StatusAgendamento) =>
  status === 'agendado' || status === 'confirmado' || status === 'chegou' || status === 'em_atendimento'

/** Próximos passos permitidos; espelha public.alterar_status_agendamento no banco. */
export const PROXIMOS_STATUS: Record<StatusAgendamento, { status: StatusAgendamento; acao: string }[]> = {
  agendado: [{ status: 'confirmado', acao: 'Confirmar' }, { status: 'chegou', acao: 'Registrar chegada' }, { status: 'faltou', acao: 'Registrar falta' }],
  confirmado: [{ status: 'chegou', acao: 'Registrar chegada' }, { status: 'faltou', acao: 'Registrar falta' }],
  chegou: [{ status: 'em_atendimento', acao: 'Iniciar atendimento' }, { status: 'concluido', acao: 'Concluir' }],
  em_atendimento: [{ status: 'concluido', acao: 'Concluir atendimento' }],
  concluido: [],
  cancelado: [],
  faltou: [],
}

export const podeCancelar = (status: StatusAgendamento) => status === 'agendado' || status === 'confirmado' || status === 'chegou'
export const podeReagendar = (status: StatusAgendamento) => status === 'agendado' || status === 'confirmado'

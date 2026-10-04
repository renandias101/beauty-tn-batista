import type { ItemAgenda, StatusAgendamento } from '../types'

/** '' = todos exceto cancelados; 'todos' inclui cancelados; 'sem_mensagem' = reservas ativas sem mensagem válida registrada. */
export type FiltroStatus = '' | 'todos' | 'sem_mensagem' | StatusAgendamento

/** Aguardando confirmação ou com presença confirmada, sem mensagem registrada para o horário atual. */
export const semMensagem = (item: ItemAgenda) =>
  (item.status === 'agendado' || item.status === 'confirmado') && (!item.ultimaComunicacao || item.comunicacaoDesatualizada)

export const filtrarPorStatus = (itens: ItemAgenda[], filtro: FiltroStatus) =>
  itens.filter(item => filtro === 'todos' ? true : filtro === '' ? item.status !== 'cancelado' : filtro === 'sem_mensagem' ? semMensagem(item) : item.status === filtro)

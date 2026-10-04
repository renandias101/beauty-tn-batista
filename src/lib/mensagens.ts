// Mensagens prontas para o WhatsApp (envio manual pela equipe). Usam somente primeiro nome, serviço,
// profissional, data e horário: nunca observações internas, telefone de terceiros ou motivos registrados.
import { dataPorExtenso } from './datas'
import { linkWhatsApp } from './telefone'
import type { ItemAgenda, TipoComunicacao } from '../types'

export const TIPOS_COMUNICACAO: Record<TipoComunicacao, string> = {
  confirmacao: 'Confirmação',
  lembrete: 'Lembrete',
  cancelamento: 'Cancelamento',
  reagendamento: 'Reagendamento',
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? ''

export function textoDaMensagem(tipo: TipoComunicacao, item: Pick<ItemAgenda, 'clienteNome' | 'servicoNome' | 'profissionalNome' | 'data' | 'horaInicio'>) {
  const ola = `Olá, ${primeiroNome(item.clienteNome)}! Aqui é da Clínica Beauty.`
  const quando = `${dataPorExtenso(item.data)}, às ${item.horaInicio}`
  const atendimento = `${item.servicoNome} com ${item.profissionalNome}`
  switch (tipo) {
    case 'confirmacao': return `${ola} Seu horário de ${atendimento} está agendado para ${quando}. Você confirma sua presença?`
    case 'lembrete': return `${ola} Passando para lembrar do seu horário de ${atendimento}: ${quando}. Até lá!`
    case 'cancelamento': return `${ola} Seu horário de ${atendimento}, marcado para ${quando}, foi cancelado. Se quiser remarcar, é só responder esta mensagem.`
    case 'reagendamento': return `${ola} Seu horário de ${atendimento} foi alterado para ${quando}. Você confirma o novo horário?`
  }
}

/** Link que abre o WhatsApp com a mensagem preenchida. Abrir não significa que a mensagem foi enviada. */
export const linkMensagem = (telefone: string, texto: string) => `${linkWhatsApp(telefone)}?text=${encodeURIComponent(texto)}`

/** Tipos adequados à situação da reserva (o servidor recusa os demais). */
export const tiposPermitidos = (status: ItemAgenda['status']): TipoComunicacao[] =>
  status === 'cancelado' ? ['cancelamento'] : status === 'agendado' || status === 'confirmado' ? ['confirmacao', 'lembrete', 'reagendamento'] : []

import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { ItemAgenda, RegistroHistorico, StatusAgendamento } from '../types'

interface LinhaAgenda {
  id: string; cliente_id: string; cliente_nome: string; cliente_telefone: string | null
  servico_id: string; servico_nome: string; profissional_id: string; profissional_nome: string; profissional_cor: string
  inicio: string; fim: string; data: string; hora_inicio: string; hora_fim: string; duracao_minutos: number
  status: StatusAgendamento; encaixe: boolean; observacao: string | null; motivo_cancelamento: string | null
}

const paraItem = (l: LinhaAgenda): ItemAgenda => ({
  id: l.id, clienteId: l.cliente_id, clienteNome: l.cliente_nome, clienteTelefone: l.cliente_telefone,
  servicoId: l.servico_id, servicoNome: l.servico_nome, profissionalId: l.profissional_id, profissionalNome: l.profissional_nome,
  profissionalCor: l.profissional_cor, inicio: l.inicio, fim: l.fim, data: l.data, horaInicio: l.hora_inicio, horaFim: l.hora_fim,
  duracaoMinutos: l.duracao_minutos, status: l.status, encaixe: l.encaixe, observacao: l.observacao, motivoCancelamento: l.motivo_cancelamento,
})

export async function listarAgenda(dataInicio: string, dataFim: string, profissionalId?: string) {
  if (modoDemo) return demo.listarAgenda(dataInicio, dataFim, profissionalId)
  const { data, error } = await supabase.rpc('listar_agenda', { p_data_inicio: dataInicio, p_data_fim: dataFim, p_profissional_id: profissionalId ?? null })
  if (error) throw error
  return (data as LinhaAgenda[]).map(paraItem)
}

export async function agendamentosDoCliente(clienteId: string) {
  if (modoDemo) return demo.agendamentosDoCliente(clienteId)
  const { data, error } = await supabase.rpc('agendamentos_do_cliente', { p_cliente_id: clienteId })
  if (error) throw error
  return (data as LinhaAgenda[]).map(paraItem)
}

export interface NovoAgendamento { id: string; clienteId: string; servicoId: string; profissionalId: string; data: string; hora: string; observacao: string; encaixe: boolean }

/** O id é gerado uma vez por formulário: reenvios devolvem a mesma reserva sem duplicar (CA11). */
export async function criarAgendamento(a: NovoAgendamento) {
  if (modoDemo) return demo.criarAgendamento(a)
  const { error } = await supabase.rpc('criar_agendamento', {
    p_id: a.id, p_cliente_id: a.clienteId, p_servico_id: a.servicoId, p_profissional_id: a.profissionalId,
    p_data: a.data, p_hora: a.hora, p_observacao: a.observacao || null, p_encaixe: a.encaixe,
  })
  if (error) throw error
}

export async function alterarStatus(id: string, status: StatusAgendamento) {
  if (modoDemo) return demo.alterarStatus(id, status)
  const { error } = await supabase.rpc('alterar_status_agendamento', { p_id: id, p_status: status })
  if (error) throw error
}

export async function cancelarAgendamento(id: string, motivo: string) {
  if (modoDemo) return demo.cancelarAgendamento(id, motivo)
  const { error } = await supabase.rpc('cancelar_agendamento', { p_id: id, p_motivo: motivo })
  if (error) throw error
}

export async function reagendarAgendamento(id: string, novo: { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number }) {
  if (modoDemo) return demo.reagendarAgendamento(id, novo)
  const { error } = await supabase.rpc('reagendar_agendamento', {
    p_id: id, p_data: novo.data, p_hora: novo.hora, p_profissional_id: novo.profissionalId, p_motivo: novo.motivo,
    p_duracao_minutos: novo.duracaoMinutos ?? null,
  })
  if (error) throw error
}

export async function editarAgendamento(id: string, observacao: string, encaixe: boolean) {
  if (modoDemo) return demo.editarAgendamento(id, observacao, encaixe)
  const { error } = await supabase.rpc('editar_agendamento', { p_id: id, p_observacao: observacao || null, p_encaixe: encaixe })
  if (error) throw error
}

export async function historicoDoAgendamento(id: string): Promise<RegistroHistorico[]> {
  if (modoDemo) return demo.historicoDoAgendamento(id)
  const { data, error } = await supabase.rpc('historico_do_agendamento', { p_id: id })
  if (error) throw error
  return (data as { id: number; acao: RegistroHistorico['acao']; usuario_nome: string; ocorrido_em: string; motivo: string | null; valores_anteriores: Record<string, unknown> | null; valores_novos: Record<string, unknown> | null }[])
    .map(h => ({ id: h.id, acao: h.acao, usuarioNome: h.usuario_nome, ocorridoEm: h.ocorrido_em, motivo: h.motivo, valoresAnteriores: h.valores_anteriores, valoresNovos: h.valores_novos }))
}

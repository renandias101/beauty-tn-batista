// Lista de espera (administração e secretaria). Não reserva horários: o agendamento é criado pela agenda,
// e a entrada só passa a "agendado" quando a reserva é gravada (na mesma transação do servidor).
import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { ContatoEspera, EntradaEspera, StatusEspera } from '../types'

interface LinhaEspera {
  id: string; cliente_id: string; cliente_nome: string; cliente_telefone: string; servico_id: string; servico_nome: string
  profissional_id: string | null; profissional_nome: string | null; data_inicio: string; data_fim: string; hora_inicio: string | null; hora_fim: string | null
  observacao: string | null; status: StatusEspera; agendamento_id: string | null; versao: number; criado_em: string; criado_por: string
  ultimo_contato_em: string | null; ultimo_contato_por: string | null
}

export async function listarListaEspera(status?: StatusEspera): Promise<EntradaEspera[]> {
  if (modoDemo) return demo.listarListaEspera(status)
  const { data, error } = await supabase.rpc('listar_lista_espera', { p_status: status ?? null })
  if (error) throw error
  return (data as LinhaEspera[]).map(l => ({
    id: l.id, clienteId: l.cliente_id, clienteNome: l.cliente_nome, clienteTelefone: l.cliente_telefone, servicoId: l.servico_id, servicoNome: l.servico_nome,
    profissionalId: l.profissional_id, profissionalNome: l.profissional_nome, dataInicio: l.data_inicio, dataFim: l.data_fim, horaInicio: l.hora_inicio, horaFim: l.hora_fim,
    observacao: l.observacao, status: l.status, agendamentoId: l.agendamento_id, versao: l.versao, criadoEm: l.criado_em, criadoPor: l.criado_por,
    ultimoContatoEm: l.ultimo_contato_em, ultimoContatoPor: l.ultimo_contato_por,
  }))
}

export interface NovaEntradaEspera {
  id: string; clienteId: string; servicoId: string; profissionalId: string | null; dataInicio: string; dataFim: string
  horaInicio: string | null; horaFim: string | null; observacao: string
}

/** O id gerado no formulário evita entrada duplicada em reenvio; o servidor também recusa duplicidade em aberto. */
export async function criarEntradaEspera(e: NovaEntradaEspera) {
  if (modoDemo) return demo.criarEntradaEspera(e)
  const { error } = await supabase.rpc('criar_lista_espera', {
    p_id: e.id, p_cliente_id: e.clienteId, p_servico_id: e.servicoId, p_profissional_id: e.profissionalId, p_data_inicio: e.dataInicio, p_data_fim: e.dataFim,
    p_hora_inicio: e.horaInicio, p_hora_fim: e.horaFim, p_observacao: e.observacao.trim() || null,
  })
  if (error) throw error
}

export async function atualizarEntradaEspera(id: string, status: Exclude<StatusEspera, 'agendado'>, observacao: string, versao: number) {
  if (modoDemo) return demo.atualizarEntradaEspera(id, status, observacao, versao)
  const { error } = await supabase.rpc('atualizar_lista_espera', { p_id: id, p_status: status, p_observacao: observacao.trim() || null, p_versao: versao })
  if (error) throw error
}

export async function contatosDaEntrada(id: string): Promise<ContatoEspera[]> {
  if (modoDemo) return demo.contatosDaEntrada(id)
  const { data, error } = await supabase.rpc('contatos_lista_espera', { p_id: id })
  if (error) throw error
  return (data as { id: number; ocorrido_em: string; usuario_nome: string; status_anterior: StatusEspera | null; status_novo: StatusEspera; observacao: string | null }[])
    .map(c => ({ id: c.id, ocorridoEm: c.ocorrido_em, usuarioNome: c.usuario_nome, statusAnterior: c.status_anterior, statusNovo: c.status_novo, observacao: c.observacao }))
}

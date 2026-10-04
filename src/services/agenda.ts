import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { CandidatoEspera, Comunicacao, DiaInexistente, FrequenciaSerie, ItemAgenda, OcorrenciaPrevista, RegistroHistorico, StatusAgendamento, StatusEspera, TipoComunicacao } from '../types'

interface LinhaAgenda {
  id: string; cliente_id: string; cliente_nome: string; cliente_telefone: string | null
  servico_id: string; servico_nome: string; profissional_id: string; profissional_nome: string; profissional_cor: string
  inicio: string; fim: string; data: string; hora_inicio: string; hora_fim: string; duracao_minutos: number
  status: StatusAgendamento; encaixe: boolean; observacao: string | null; motivo_cancelamento: string | null
  preparacao_minutos: number; ocupado_ate: string; hora_ocupado_ate: string; versao: number; excecao_conflito_cliente: string | null
  recursos: string | null; ultima_comunicacao_tipo: TipoComunicacao | null; ultima_comunicacao_em: string | null; ultima_comunicacao_por: string | null
  comunicacao_desatualizada: boolean | null
  grupo_id: string | null; grupo_ordem: number | null; grupo_total: number | null
  serie_id: string | null; serie_ordem: number | null; serie_total: number | null; serie_frequencia: FrequenciaSerie | null
}

const paraItem = (l: LinhaAgenda): ItemAgenda => ({
  id: l.id, clienteId: l.cliente_id, clienteNome: l.cliente_nome, clienteTelefone: l.cliente_telefone,
  servicoId: l.servico_id, servicoNome: l.servico_nome, profissionalId: l.profissional_id, profissionalNome: l.profissional_nome,
  profissionalCor: l.profissional_cor, inicio: l.inicio, fim: l.fim, data: l.data, horaInicio: l.hora_inicio, horaFim: l.hora_fim,
  duracaoMinutos: l.duracao_minutos, status: l.status, encaixe: l.encaixe, observacao: l.observacao, motivoCancelamento: l.motivo_cancelamento,
  preparacaoMinutos: l.preparacao_minutos, ocupadoAte: l.ocupado_ate, horaOcupadoAte: l.hora_ocupado_ate, versao: l.versao,
  excecaoConflitoCliente: l.excecao_conflito_cliente, recursos: l.recursos,
  ultimaComunicacao: l.ultima_comunicacao_tipo && l.ultima_comunicacao_em ? { tipo: l.ultima_comunicacao_tipo, em: l.ultima_comunicacao_em, por: l.ultima_comunicacao_por ?? '' } : null,
  comunicacaoDesatualizada: Boolean(l.comunicacao_desatualizada),
  grupoId: l.grupo_id ?? null, grupoOrdem: l.grupo_ordem ?? null, grupoTotal: l.grupo_id ? l.grupo_total : null,
  serieId: l.serie_id ?? null, serieOrdem: l.serie_ordem ?? null, serieTotal: l.serie_id ? l.serie_total : null, serieFrequencia: l.serie_frequencia ?? null,
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

/**
 * Horários livres calculados pelo servidor (jornada, bloqueios, reservas, preparação, duração por profissional e recursos).
 * ignorarId: reserva sendo reagendada; duracaoMinutos: duração ajustada pela administração.
 */
export async function horariosLivres(o: { servicoId: string; profissionalId: string; data: string; ignorarId?: string; duracaoMinutos?: number }): Promise<string[]> {
  if (modoDemo) return demo.horariosLivres(o)
  const { data, error } = await supabase.rpc('horarios_livres', {
    p_servico_id: o.servicoId, p_profissional_id: o.profissionalId, p_data: o.data, p_ignorar_id: o.ignorarId ?? null, p_duracao_minutos: o.duracaoMinutos ?? null,
  })
  if (error) throw error
  return data as string[]
}

export interface NovoAgendamento {
  id: string; clienteId: string; servicoId: string; profissionalId: string; data: string; hora: string; observacao: string; encaixe: boolean
  /** Exceção de conflito da cliente: só tem efeito quando quem grava é a administração (o servidor decide). */
  justificativaConflito?: string
  listaEsperaId?: string
}

/** O id é gerado uma vez por formulário: reenvios devolvem a mesma reserva sem duplicar (CA11). */
export async function criarAgendamento(a: NovoAgendamento) {
  if (modoDemo) return demo.criarAgendamento(a)
  const { error } = await supabase.rpc('criar_agendamento', {
    p_id: a.id, p_cliente_id: a.clienteId, p_servico_id: a.servicoId, p_profissional_id: a.profissionalId,
    p_data: a.data, p_hora: a.hora, p_observacao: a.observacao || null, p_encaixe: a.encaixe,
    p_justificativa_conflito: a.justificativaConflito?.trim() || null, p_lista_espera_id: a.listaEsperaId ?? null,
  })
  if (error) throw error
}

// As alterações enviam a versão vista pelo usuário: se outra pessoa alterou antes, o servidor recusa.

export async function alterarStatus(id: string, status: StatusAgendamento, versao: number) {
  if (modoDemo) return demo.alterarStatus(id, status, versao)
  const { error } = await supabase.rpc('alterar_status_agendamento', { p_id: id, p_status: status, p_versao: versao })
  if (error) throw error
}

/** Correção administrativa de um status marcado por engano (justificativa obrigatória). */
export async function corrigirStatus(id: string, status: StatusAgendamento, justificativa: string, versao: number) {
  if (modoDemo) return demo.corrigirStatus(id, status, justificativa, versao)
  const { error } = await supabase.rpc('corrigir_status_agendamento', { p_id: id, p_status: status, p_justificativa: justificativa, p_versao: versao })
  if (error) throw error
}

export async function cancelarAgendamento(id: string, motivo: string, versao: number) {
  if (modoDemo) return demo.cancelarAgendamento(id, motivo, versao)
  const { error } = await supabase.rpc('cancelar_agendamento', { p_id: id, p_motivo: motivo, p_versao: versao })
  if (error) throw error
}

export interface DadosReagendamento { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number; justificativaConflito?: string }

export async function reagendarAgendamento(id: string, novo: DadosReagendamento, versao: number) {
  if (modoDemo) return demo.reagendarAgendamento(id, novo, versao)
  const { error } = await supabase.rpc('reagendar_agendamento', {
    p_id: id, p_data: novo.data, p_hora: novo.hora, p_profissional_id: novo.profissionalId, p_motivo: novo.motivo,
    p_duracao_minutos: novo.duracaoMinutos ?? null, p_versao: versao, p_justificativa_conflito: novo.justificativaConflito?.trim() || null,
  })
  if (error) throw error
}

export async function editarAgendamento(id: string, observacao: string, encaixe: boolean, versao: number) {
  if (modoDemo) return demo.editarAgendamento(id, observacao, encaixe, versao)
  const { error } = await supabase.rpc('editar_agendamento', { p_id: id, p_observacao: observacao || null, p_encaixe: encaixe, p_versao: versao })
  if (error) throw error
}

export async function historicoDoAgendamento(id: string): Promise<RegistroHistorico[]> {
  if (modoDemo) return demo.historicoDoAgendamento(id)
  const { data, error } = await supabase.rpc('historico_do_agendamento', { p_id: id })
  if (error) throw error
  return (data as { id: number; acao: RegistroHistorico['acao']; usuario_nome: string; ocorrido_em: string; motivo: string | null; valores_anteriores: Record<string, unknown> | null; valores_novos: Record<string, unknown> | null }[])
    .map(h => ({ id: h.id, acao: h.acao, usuarioNome: h.usuario_nome, ocorridoEm: h.ocorrido_em, motivo: h.motivo, valoresAnteriores: h.valores_anteriores, valoresNovos: h.valores_novos }))
}

// ----- Comunicações pelo WhatsApp (registro manual) -----

/** Registra que a equipe enviou a mensagem. O id gerado no navegador evita registro duplicado no mesmo clique. */
export async function registrarComunicacao(id: string, agendamentoId: string, tipo: TipoComunicacao) {
  if (modoDemo) return demo.registrarComunicacao(id, agendamentoId, tipo)
  const { error } = await supabase.rpc('registrar_comunicacao', { p_id: id, p_agendamento_id: agendamentoId, p_tipo: tipo })
  if (error) throw error
}

export async function listarComunicacoes(agendamentoId: string): Promise<Comunicacao[]> {
  if (modoDemo) return demo.listarComunicacoes(agendamentoId)
  const { data, error } = await supabase.rpc('listar_comunicacoes', { p_agendamento_id: agendamentoId })
  if (error) throw error
  return (data as { id: string; tipo: TipoComunicacao; registrado_em: string; registrado_por: string; desatualizada: boolean }[])
    .map(c => ({ id: c.id, tipo: c.tipo, registradoEm: c.registrado_em, registradoPor: c.registrado_por, desatualizada: c.desatualizada }))
}

// ----- Vaga liberada: candidatos da lista de espera -----

export async function candidatosListaEspera(profissionalId: string, inicio: string, ocupadoAte: string): Promise<CandidatoEspera[]> {
  if (modoDemo) return demo.candidatosListaEspera(profissionalId, inicio, ocupadoAte)
  const { data, error } = await supabase.rpc('candidatos_lista_espera', { p_profissional_id: profissionalId, p_inicio: inicio, p_ocupado_ate: ocupadoAte })
  if (error) throw error
  return (data as { id: string; cliente_id: string; cliente_nome: string; servico_id: string; servico_nome: string; duracao_minutos: number; profissional_preferido: string | null; data_inicio: string; data_fim: string; hora_inicio: string | null; hora_fim: string | null; observacao: string | null; status: StatusEspera; versao: number }[])
    .map(c => ({ id: c.id, clienteId: c.cliente_id, clienteNome: c.cliente_nome, servicoId: c.servico_id, servicoNome: c.servico_nome, duracaoMinutos: c.duracao_minutos, profissionalPreferido: c.profissional_preferido, dataInicio: c.data_inicio, dataFim: c.data_fim, horaInicio: c.hora_inicio, horaFim: c.hora_fim, observacao: c.observacao, status: c.status, versao: c.versao }))
}

// ----- Marcação com vários serviços (criação e operações atômicas no servidor) -----

export interface EtapaMarcacao { servicoId: string; profissionalId: string; data: string; hora: string }

/** O id da marcação é gerado uma vez por formulário: reenvio devolve a mesma marcação, sem duplicar. */
export async function criarMarcacao(m: { id: string; clienteId: string; etapas: EtapaMarcacao[]; observacao: string; justificativaConflito?: string }) {
  if (modoDemo) return demo.criarMarcacao(m)
  const { error } = await supabase.rpc('criar_grupo_agendamentos', {
    p_grupo_id: m.id, p_cliente_id: m.clienteId, p_observacao: m.observacao || null, p_justificativa_conflito: m.justificativaConflito?.trim() || null,
    p_etapas: m.etapas.map(e => ({ servico_id: e.servicoId, profissional_id: e.profissionalId, data: e.data, hora: e.hora })),
  })
  if (error) throw error
}

const mapaVersoes = (itens: ItemAgenda[]) => Object.fromEntries(itens.map(i => [i.id, i.versao]))

export async function cancelarMarcacao(grupoId: string, motivo: string, vistos: ItemAgenda[]) {
  if (modoDemo) return demo.cancelarMarcacao(grupoId, motivo, mapaVersoes(vistos))
  const { data, error } = await supabase.rpc('cancelar_grupo', { p_grupo_id: grupoId, p_motivo: motivo, p_versoes: mapaVersoes(vistos) })
  if (error) throw error
  return data as number
}

export async function reagendarMarcacao(grupoId: string, novo: { data: string; hora: string; motivo: string; justificativaConflito?: string }, vistos: ItemAgenda[]) {
  if (modoDemo) return demo.reagendarMarcacao(grupoId, novo, mapaVersoes(vistos))
  const { data, error } = await supabase.rpc('reagendar_grupo', {
    p_grupo_id: grupoId, p_data: novo.data, p_hora: novo.hora, p_motivo: novo.motivo, p_versoes: mapaVersoes(vistos), p_justificativa_conflito: novo.justificativaConflito?.trim() || null,
  })
  if (error) throw error
  return data as number
}

/** Etapas da marcação ou ocorrências da série, para mostrar o impacto antes de confirmar. */
export async function agendamentosVinculados(v: { grupoId?: string; serieId?: string }) {
  if (modoDemo) return demo.agendamentosVinculados(v)
  const { data, error } = await supabase.rpc('agendamentos_vinculados', { p_grupo_id: v.grupoId ?? null, p_serie_id: v.serieId ?? null })
  if (error) throw error
  return (data as LinhaAgenda[]).map(paraItem)
}

// ----- Agendamentos recorrentes -----

export const LIMITE_OCORRENCIAS = 52

export interface DadosSerie {
  clienteId: string; servicoId: string; profissionalId: string; dataInicial: string; hora: string; frequencia: FrequenciaSerie
  quantidade: number | null; dataFinal: string | null; diaInexistente: DiaInexistente | null; justificativaConflito?: string
}

const argsSerie = (s: DadosSerie) => ({
  p_cliente_id: s.clienteId, p_servico_id: s.servicoId, p_profissional_id: s.profissionalId, p_data_inicial: s.dataInicial, p_hora: s.hora,
  p_frequencia: s.frequencia, p_quantidade: s.quantidade, p_data_final: s.dataFinal, p_dia_inexistente: s.diaInexistente,
  p_justificativa_conflito: s.justificativaConflito?.trim() || null,
})

/** Prévia de todas as datas com a situação de cada uma. Nada é gravado. */
export async function preverSerie(s: DadosSerie): Promise<OcorrenciaPrevista[]> {
  if (modoDemo) return demo.preverSerie(s)
  const { data, error } = await supabase.rpc('prever_serie', argsSerie(s))
  if (error) throw error
  return data as OcorrenciaPrevista[]
}

/** Cria a série com as datas escolhidas; o servidor revalida todas e não cria série parcial se alguma falhar. */
export async function criarSerie(id: string, s: DadosSerie, datas: string[], observacao: string) {
  if (modoDemo) return demo.criarSerie(id, s, datas, observacao)
  const { data, error } = await supabase.rpc('criar_serie', { p_serie_id: id, ...argsSerie(s), p_datas: datas, p_observacao: observacao || null })
  if (error) throw error
  return data as number
}

/** aPartirDe: id da ocorrência para "esta e as próximas"; sem ele, toda a série elegível. */
export async function cancelarSerie(serieId: string, aPartirDe: string | null, motivo: string, vistos: ItemAgenda[]) {
  if (modoDemo) return demo.cancelarSerie(serieId, aPartirDe, motivo, mapaVersoes(vistos))
  const { data, error } = await supabase.rpc('cancelar_serie', { p_serie_id: serieId, p_a_partir_de: aPartirDe, p_motivo: motivo, p_versoes: mapaVersoes(vistos) })
  if (error) throw error
  return data as number
}

export async function reagendarSerie(serieId: string, aPartirDe: string | null, novo: { hora: string; profissionalId: string | null; motivo: string; justificativaConflito?: string }, vistos: ItemAgenda[]) {
  if (modoDemo) return demo.reagendarSerie(serieId, aPartirDe, novo, mapaVersoes(vistos))
  const { data, error } = await supabase.rpc('reagendar_serie', {
    p_serie_id: serieId, p_a_partir_de: aPartirDe, p_hora: novo.hora, p_profissional_id: novo.profissionalId, p_motivo: novo.motivo,
    p_versoes: mapaVersoes(vistos), p_justificativa_conflito: novo.justificativaConflito?.trim() || null,
  })
  if (error) throw error
  return data as number
}

import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { Cliente, Habilitacao, Profissional, Recurso, Servico, ServicoRecurso, TipoRecurso } from '../types'

// ----- Clientes -----

const paraCliente = (c: { id: string; nome: string; telefone: string; telefone_digitos: string }): Cliente =>
  ({ id: c.id, nome: c.nome, telefone: c.telefone, telefoneDigitos: c.telefone_digitos })

export async function listarClientes() {
  if (modoDemo) return demo.listarClientes()
  const { data, error } = await supabase.from('clientes').select('id, nome, telefone, telefone_digitos').order('nome')
  if (error) throw error
  return data.map(paraCliente)
}

/** Possíveis duplicidades pelo telefone; pessoas podem compartilhar um número, então é só um alerta. */
export async function clientesComTelefone(digitos: string, ignorarId?: string) {
  if (modoDemo) return demo.clientesComTelefone(digitos, ignorarId)
  let consulta = supabase.from('clientes').select('id, nome, telefone, telefone_digitos').eq('telefone_digitos', digitos)
  if (ignorarId) consulta = consulta.neq('id', ignorarId)
  const { data, error } = await consulta
  if (error) throw error
  return data.map(paraCliente)
}

export async function salvarCliente(cliente: { id?: string; nome: string; telefone: string }) {
  if (modoDemo) return demo.salvarCliente(cliente)
  const valores = { nome: cliente.nome.trim(), telefone: cliente.telefone.trim() }
  const { data, error } = cliente.id
    ? await supabase.from('clientes').update(valores).eq('id', cliente.id).select('id, nome, telefone, telefone_digitos').single()
    : await supabase.from('clientes').insert(valores).select('id, nome, telefone, telefone_digitos').single()
  if (error) throw error
  return paraCliente(data)
}

// ----- Profissionais -----

const paraProfissional = (p: { id: string; nome: string; telefone: string | null; cor: string; ativo: boolean; usuario_id: string | null }): Profissional =>
  ({ id: p.id, nome: p.nome, telefone: p.telefone, cor: p.cor, ativo: p.ativo, usuarioId: p.usuario_id })

export async function listarProfissionais() {
  if (modoDemo) return demo.listarProfissionais()
  const { data, error } = await supabase.from('profissionais').select('id, nome, telefone, cor, ativo, usuario_id').order('nome')
  if (error) throw error
  return data.map(paraProfissional)
}

export async function salvarProfissional(p: { id?: string; nome: string; telefone: string; cor: string; ativo: boolean }) {
  if (modoDemo) return demo.salvarProfissional(p)
  const valores = { nome: p.nome.trim(), telefone: p.telefone.trim() || null, cor: p.cor, ativo: p.ativo }
  const { data, error } = p.id
    ? await supabase.from('profissionais').update(valores).eq('id', p.id).select('id, nome, telefone, cor, ativo, usuario_id').single()
    : await supabase.from('profissionais').insert(valores).select('id, nome, telefone, cor, ativo, usuario_id').single()
  if (error) throw error
  return paraProfissional(data)
}

// ----- Serviços -----

const paraServico = (s: { id: string; nome: string; duracao_minutos: number; preparacao_minutos: number; categoria: string | null; descricao: string | null; ativo: boolean }): Servico =>
  ({ id: s.id, nome: s.nome, duracaoMinutos: s.duracao_minutos, preparacaoMinutos: s.preparacao_minutos, categoria: s.categoria, descricao: s.descricao, ativo: s.ativo })
const COLUNAS_SERVICO = 'id, nome, duracao_minutos, preparacao_minutos, categoria, descricao, ativo'

export async function listarServicos() {
  if (modoDemo) return demo.listarServicos()
  const { data, error } = await supabase.from('servicos').select(COLUNAS_SERVICO).order('nome')
  if (error) throw error
  return data.map(paraServico)
}

/** Alterar a duração padrão ou a preparação não modifica reservas existentes: cada reserva guarda as próprias. */
export async function salvarServico(s: { id?: string; nome: string; duracaoMinutos: number; preparacaoMinutos: number; categoria: string; descricao: string; ativo: boolean }) {
  if (modoDemo) return demo.salvarServico(s)
  const valores = { nome: s.nome.trim(), duracao_minutos: s.duracaoMinutos, preparacao_minutos: s.preparacaoMinutos, categoria: s.categoria.trim() || null, descricao: s.descricao.trim() || null, ativo: s.ativo }
  const { data, error } = s.id
    ? await supabase.from('servicos').update(valores).eq('id', s.id).select(COLUNAS_SERVICO).single()
    : await supabase.from('servicos').insert(valores).select(COLUNAS_SERVICO).single()
  if (error) throw error
  return paraServico(data)
}

// ----- Habilitações profissional–serviço -----

export async function listarHabilitacoes(): Promise<Habilitacao[]> {
  if (modoDemo) return demo.listarHabilitacoes()
  const { data, error } = await supabase.from('profissional_servicos').select('profissional_id, servico_id, duracao_minutos')
  if (error) throw error
  return data.map(h => ({ profissionalId: h.profissional_id, servicoId: h.servico_id, duracaoMinutos: h.duracao_minutos }))
}

/** Aplica somente as diferenças entre o conjunto atual e o desejado. */
export async function definirHabilitacoes(atuais: Habilitacao[], desejadas: Habilitacao[]) {
  if (modoDemo) return demo.definirHabilitacoes(atuais, desejadas)
  const chave = (h: Habilitacao) => `${h.profissionalId}:${h.servicoId}`
  const desejadasChaves = new Set(desejadas.map(chave))
  const atuaisChaves = new Set(atuais.map(chave))
  const incluir = desejadas.filter(h => !atuaisChaves.has(chave(h)))
  const retirar = atuais.filter(h => !desejadasChaves.has(chave(h)))
  if (incluir.length) {
    const { error } = await supabase.from('profissional_servicos').insert(incluir.map(h => ({ profissional_id: h.profissionalId, servico_id: h.servicoId })))
    if (error) throw error
  }
  for (const h of retirar) {
    const { error } = await supabase.from('profissional_servicos').delete().eq('profissional_id', h.profissionalId).eq('servico_id', h.servicoId)
    if (error) throw error
  }
}

/** Duração específica do profissional para o serviço (null volta a usar a duração padrão). Reservas existentes não mudam. */
export async function definirDuracaoProfissional(profissionalId: string, servicoId: string, duracaoMinutos: number | null) {
  if (modoDemo) return demo.definirDuracaoProfissional(profissionalId, servicoId, duracaoMinutos)
  const { data, error } = await supabase.from('profissional_servicos').update({ duracao_minutos: duracaoMinutos })
    .eq('profissional_id', profissionalId).eq('servico_id', servicoId).select('servico_id')
  if (error) throw error
  if (!data?.length) throw new Error('Habilitação não encontrada. Salve os serviços habilitados antes.')
}

/** Duração efetiva: a específica do profissional ou a padrão do serviço. */
export const duracaoEfetiva = (servico: Servico | undefined, habilitacoes: Habilitacao[], profissionalId: string) =>
  habilitacoes.find(h => h.profissionalId === profissionalId && h.servicoId === servico?.id)?.duracaoMinutos ?? servico?.duracaoMinutos ?? 0

// ----- Recursos compartilhados (salas, macas, equipamentos) -----

const paraRecurso = (r: { id: string; nome: string; tipo: TipoRecurso; capacidade: number; ativo: boolean }): Recurso => ({ id: r.id, nome: r.nome, tipo: r.tipo, capacidade: r.capacidade, ativo: r.ativo })

export async function listarRecursos(): Promise<Recurso[]> {
  if (modoDemo) return demo.listarRecursos()
  const { data, error } = await supabase.from('recursos').select('id, nome, tipo, capacidade, ativo').order('nome')
  if (error) throw error
  return data.map(paraRecurso)
}

/** Desativar ou reduzir a capacidade é recusado pelo servidor se houver reservas futuras afetadas. */
export async function salvarRecurso(r: { id?: string; nome: string; tipo: TipoRecurso; capacidade: number; ativo: boolean }, usuarioId: string) {
  if (modoDemo) return demo.salvarRecurso(r)
  const valores = { nome: r.nome.trim(), tipo: r.tipo, capacidade: r.capacidade, ativo: r.ativo, atualizado_por: usuarioId }
  const { data, error } = r.id
    ? await supabase.from('recursos').update(valores).eq('id', r.id).select('id, nome, tipo, capacidade, ativo').single()
    : await supabase.from('recursos').insert(valores).select('id, nome, tipo, capacidade, ativo').single()
  if (error) throw error
  return paraRecurso(data)
}

export async function listarServicoRecursos(): Promise<ServicoRecurso[]> {
  if (modoDemo) return demo.listarServicoRecursos()
  const { data, error } = await supabase.from('servico_recursos').select('servico_id, recurso_id')
  if (error) throw error
  return data.map(v => ({ servicoId: v.servico_id, recursoId: v.recurso_id }))
}

/** Recursos exigidos por um serviço. Vale para novas reservas; as existentes mantêm os recursos gravados. */
export async function definirRecursosDoServico(servicoId: string, atuais: string[], desejados: string[]) {
  if (modoDemo) return demo.definirRecursosDoServico(servicoId, desejados)
  const incluir = desejados.filter(id => !atuais.includes(id))
  const retirar = atuais.filter(id => !desejados.includes(id))
  if (incluir.length) {
    const { error } = await supabase.from('servico_recursos').insert(incluir.map(recurso_id => ({ servico_id: servicoId, recurso_id })))
    if (error) throw error
  }
  for (const recursoId of retirar) {
    const { error } = await supabase.from('servico_recursos').delete().eq('servico_id', servicoId).eq('recurso_id', recursoId)
    if (error) throw error
  }
}

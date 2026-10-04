import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { Cliente, Habilitacao, Profissional, Servico } from '../types'

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

const paraServico = (s: { id: string; nome: string; duracao_minutos: number; categoria: string | null; descricao: string | null; ativo: boolean }): Servico =>
  ({ id: s.id, nome: s.nome, duracaoMinutos: s.duracao_minutos, categoria: s.categoria, descricao: s.descricao, ativo: s.ativo })

export async function listarServicos() {
  if (modoDemo) return demo.listarServicos()
  const { data, error } = await supabase.from('servicos').select('id, nome, duracao_minutos, categoria, descricao, ativo').order('nome')
  if (error) throw error
  return data.map(paraServico)
}

/** Alterar a duração padrão não modifica reservas existentes: cada reserva guarda a própria duração. */
export async function salvarServico(s: { id?: string; nome: string; duracaoMinutos: number; categoria: string; descricao: string; ativo: boolean }) {
  if (modoDemo) return demo.salvarServico(s)
  const valores = { nome: s.nome.trim(), duracao_minutos: s.duracaoMinutos, categoria: s.categoria.trim() || null, descricao: s.descricao.trim() || null, ativo: s.ativo }
  const { data, error } = s.id
    ? await supabase.from('servicos').update(valores).eq('id', s.id).select('id, nome, duracao_minutos, categoria, descricao, ativo').single()
    : await supabase.from('servicos').insert(valores).select('id, nome, duracao_minutos, categoria, descricao, ativo').single()
  if (error) throw error
  return paraServico(data)
}

// ----- Habilitações profissional–serviço -----

export async function listarHabilitacoes(): Promise<Habilitacao[]> {
  if (modoDemo) return demo.listarHabilitacoes()
  const { data, error } = await supabase.from('profissional_servicos').select('profissional_id, servico_id')
  if (error) throw error
  return data.map(h => ({ profissionalId: h.profissional_id, servicoId: h.servico_id }))
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

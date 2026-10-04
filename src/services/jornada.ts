import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { Bloqueio, Disponibilidade, Excecao, FaixaJornada } from '../types'

const hhmm = (hora: string) => hora.slice(0, 5)

export async function listarDisponibilidades(profissionalId?: string): Promise<Disponibilidade[]> {
  if (modoDemo) return demo.listarDisponibilidades(profissionalId)
  let consulta = supabase.from('disponibilidades').select('id, profissional_id, dia_semana, hora_inicio, hora_fim').is('removido_em', null)
  if (profissionalId) consulta = consulta.eq('profissional_id', profissionalId)
  const { data, error } = await consulta.order('dia_semana').order('hora_inicio')
  if (error) throw error
  return data.map(d => ({ id: d.id, profissionalId: d.profissional_id, diaSemana: d.dia_semana, horaInicio: hhmm(d.hora_inicio), horaFim: hhmm(d.hora_fim) }))
}

/** Substitui a jornada semanal; o servidor recusa se alguma reserva futura ficar de fora (RN08). */
export async function salvarJornada(profissionalId: string, faixas: FaixaJornada[]) {
  if (modoDemo) return demo.salvarJornada(profissionalId, faixas)
  const { error } = await supabase.rpc('salvar_disponibilidade', {
    p_profissional_id: profissionalId,
    p_faixas: faixas.map(f => ({ dia_semana: f.diaSemana, hora_inicio: f.horaInicio, hora_fim: f.horaFim })),
  })
  if (error) throw error
}

export async function listarExcecoes(filtro: { profissionalId?: string; aPartirDe?: string; data?: string }): Promise<Excecao[]> {
  if (modoDemo) return demo.listarExcecoes(filtro)
  let consulta = supabase.from('excecoes_disponibilidade').select('id, profissional_id, data, hora_inicio, hora_fim, motivo').is('removido_em', null)
  if (filtro.profissionalId) consulta = consulta.eq('profissional_id', filtro.profissionalId)
  if (filtro.aPartirDe) consulta = consulta.gte('data', filtro.aPartirDe)
  if (filtro.data) consulta = consulta.eq('data', filtro.data)
  const { data, error } = await consulta.order('data').order('hora_inicio')
  if (error) throw error
  return data.map(e => ({ id: e.id, profissionalId: e.profissional_id, data: e.data, horaInicio: hhmm(e.hora_inicio), horaFim: hhmm(e.hora_fim), motivo: e.motivo }))
}

export async function criarExcecao(e: { profissionalId: string; data: string; horaInicio: string; horaFim: string; motivo: string }) {
  if (modoDemo) return demo.criarExcecao(e)
  const { error } = await supabase.rpc('criar_excecao_disponibilidade', {
    p_profissional_id: e.profissionalId, p_data: e.data, p_hora_inicio: e.horaInicio, p_hora_fim: e.horaFim, p_motivo: e.motivo || null,
  })
  if (error) throw error
}

export async function removerExcecao(id: string) {
  if (modoDemo) return demo.removerExcecao(id)
  const { error } = await supabase.rpc('remover_excecao_disponibilidade', { p_id: id })
  if (error) throw error
}

/** Bloqueios vigentes que tocam o intervalo [de, ate) (instantes ISO). */
export async function listarBloqueios(filtro: { de: string; ate: string; profissionalId?: string }): Promise<Bloqueio[]> {
  if (modoDemo) return demo.listarBloqueios(filtro)
  let consulta = supabase.from('bloqueios').select('id, profissional_id, inicio, fim, motivo')
    .is('removido_em', null).lt('inicio', filtro.ate).gt('fim', filtro.de)
  if (filtro.profissionalId) consulta = consulta.eq('profissional_id', filtro.profissionalId)
  const { data, error } = await consulta.order('inicio')
  if (error) throw error
  return data.map(b => ({ id: b.id, profissionalId: b.profissional_id, inicio: b.inicio, fim: b.fim, motivo: b.motivo }))
}

export async function criarBloqueio(b: { profissionalId: string; dataInicio: string; dataFim: string; horaInicio: string; horaFim: string; motivo: string; diaInteiro: boolean }) {
  if (modoDemo) return demo.criarBloqueio(b)
  const { data, error } = await supabase.rpc('criar_bloqueio', {
    p_profissional_id: b.profissionalId, p_data_inicio: b.dataInicio, p_data_fim: b.dataFim,
    p_hora_inicio: b.diaInteiro ? null : b.horaInicio, p_hora_fim: b.diaInteiro ? null : b.horaFim,
    p_motivo: b.motivo, p_dia_inteiro: b.diaInteiro,
  })
  if (error) throw error
  return data as number
}

/** A remoção registra motivo, responsável e data; o bloqueio não é apagado. */
export async function removerBloqueio(id: string, motivo: string) {
  if (modoDemo) return demo.removerBloqueio(id, motivo)
  const { error } = await supabase.rpc('remover_bloqueio', { p_id: id, p_motivo: motivo })
  if (error) throw error
}

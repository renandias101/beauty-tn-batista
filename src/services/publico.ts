// Consulta pública de disponibilidade (visitante sem login). As funções do banco devolvem somente
// o necessário: serviços ativos, nomes de profissionais habilitados e horários livres (data e hora).
import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'

export interface ConfiguracaoPublica { whatsapp: string | null; horizonteDias: number; fusoHorario: string }
export interface ServicoPublico { id: string; nome: string; duracaoMinutos: number; categoria: string | null; descricao: string | null }
export interface ProfissionalPublico { id: string; nome: string }
export interface HorarioDisponivel { data: string; hora: string }

export async function configuracaoPublica(): Promise<ConfiguracaoPublica> {
  if (modoDemo) return demo.configuracaoPublica()
  const { data, error } = await supabase.rpc('configuracao_publica')
  if (error) throw error
  const linha = (data as { whatsapp: string | null; horizonte_dias: number; fuso_horario: string }[])[0]
  return { whatsapp: linha?.whatsapp ?? null, horizonteDias: linha?.horizonte_dias ?? 30, fusoHorario: linha?.fuso_horario ?? 'America/Sao_Paulo' }
}

export async function servicosPublicos(): Promise<ServicoPublico[]> {
  if (modoDemo) return demo.servicosPublicos()
  const { data, error } = await supabase.rpc('servicos_publicos')
  if (error) throw error
  return (data as { id: string; nome: string; duracao_minutos: number; categoria: string | null; descricao: string | null }[])
    .map(s => ({ id: s.id, nome: s.nome, duracaoMinutos: s.duracao_minutos, categoria: s.categoria, descricao: s.descricao }))
}

export async function profissionaisPublicos(servicoId: string): Promise<ProfissionalPublico[]> {
  if (modoDemo) return demo.profissionaisPublicos(servicoId)
  const { data, error } = await supabase.rpc('profissionais_publicos', { p_servico_id: servicoId })
  if (error) throw error
  return data as ProfissionalPublico[]
}

export async function horariosDisponiveis(servicoId: string, profissionalId: string, dataInicio: string, dataFim: string): Promise<HorarioDisponivel[]> {
  if (modoDemo) return demo.horariosDisponiveis(servicoId, profissionalId, dataInicio, dataFim)
  const { data, error } = await supabase.rpc('horarios_disponiveis', { p_servico_id: servicoId, p_profissional_id: profissionalId, p_data_inicio: dataInicio, p_data_fim: dataFim })
  if (error) throw error
  return (data as { dia: string; horario: string }[]).map(h => ({ data: h.dia, hora: h.horario }))
}

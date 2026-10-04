// Configuração da clínica e auditoria geral (perfil Administração).
import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'

export interface ConfiguracaoClinica { whatsapp: string | null; horizonteDias: number; fusoHorario: string }
export interface RegistroAuditoria {
  id: number; tabela: string; registroId: string | null; operacao: 'insert' | 'update' | 'delete'
  usuarioNome: string; ocorridoEm: string; valoresAnteriores: Record<string, unknown> | null; valoresNovos: Record<string, unknown> | null
}

export async function obterConfiguracao(): Promise<ConfiguracaoClinica> {
  if (modoDemo) return demo.obterConfiguracao()
  const { data, error } = await supabase.from('configuracao_clinica').select('whatsapp_clinica, horizonte_publico_dias, fuso_horario').single()
  if (error) throw error
  return { whatsapp: data.whatsapp_clinica, horizonteDias: data.horizonte_publico_dias, fusoHorario: data.fuso_horario }
}

/** O banco aceita somente administração (RLS) e somente WhatsApp e horizonte (permissão por coluna). */
export async function salvarConfiguracao(c: { whatsapp: string | null; horizonteDias: number }, usuarioId: string) {
  if (modoDemo) return demo.salvarConfiguracao(c)
  const { data, error } = await supabase.from('configuracao_clinica')
    .update({ whatsapp_clinica: c.whatsapp, horizonte_publico_dias: c.horizonteDias, atualizado_por: usuarioId })
    .eq('id', true).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Configuração não atualizada.')
}

export async function listarAuditoria(limite = 100, tabela?: string): Promise<RegistroAuditoria[]> {
  if (modoDemo) return demo.listarAuditoria()
  const { data, error } = await supabase.rpc('listar_auditoria', { p_limite: limite, p_tabela: tabela ?? null })
  if (error) throw error
  return (data as { id: number; tabela: string; registro_id: string | null; operacao: RegistroAuditoria['operacao']; usuario_nome: string; ocorrido_em: string; valores_anteriores: Record<string, unknown> | null; valores_novos: Record<string, unknown> | null }[])
    .map(a => ({ id: a.id, tabela: a.tabela, registroId: a.registro_id, operacao: a.operacao, usuarioNome: a.usuario_nome, ocorridoEm: a.ocorrido_em, valoresAnteriores: a.valores_anteriores, valoresNovos: a.valores_novos }))
}

import { FunctionsHttpError } from '@supabase/supabase-js'
import { usuarioDoEmail } from '../lib/acesso'
import { ErroDeOperacao } from '../lib/erros'
import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { Papel, Usuario } from '../types'

export async function listarUsuarios(): Promise<Usuario[]> {
  if (modoDemo) return demo.listarUsuarios()
  const { data, error } = await supabase.rpc('listar_usuarios')
  if (error) throw error
  return (data as { usuario_id: string; nome: string; email: string; papel: Papel; ativo: boolean; profissional_id: string | null; profissional_nome: string | null; ultimo_acesso: string | null }[])
    .map(u => ({ usuarioId: u.usuario_id, nome: u.nome, usuario: usuarioDoEmail(u.email), papel: u.papel, ativo: u.ativo, profissionalId: u.profissional_id, profissionalNome: u.profissional_nome, ultimoAcesso: u.ultimo_acesso }))
}

/** Operações que exigem a chave de serviço passam pela função gerenciar-usuarios. */
async function chamar(corpo: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke('gerenciar-usuarios', { body: corpo })
  if (!error) return
  if (error instanceof FunctionsHttpError) {
    const detalhe = await error.context.json().catch(() => null) as { erro?: string } | null
    throw new ErroDeOperacao(detalhe?.erro ?? 'Não foi possível concluir a operação.')
  }
  throw error
}

export const criarUsuario = (u: { nome: string; usuario: string; senha: string; papel: Papel; profissionalId: string | null }) =>
  modoDemo ? demo.criarUsuario(u) : chamar({ acao: 'criar', nome: u.nome, usuario: u.usuario, senha: u.senha, papel: u.papel, profissional_id: u.profissionalId })

export const atualizarUsuario = (u: { usuarioId: string; nome: string; papel: Papel; ativo: boolean; profissionalId: string | null }) =>
  modoDemo ? demo.atualizarUsuario(u) : chamar({ acao: 'atualizar', usuario_id: u.usuarioId, nome: u.nome, papel: u.papel, ativo: u.ativo, profissional_id: u.profissionalId })

export const redefinirSenha = (usuarioId: string, senha: string) => modoDemo ? demo.redefinirSenha(usuarioId, senha) : chamar({ acao: 'redefinir_senha', usuario_id: usuarioId, senha })

import { FunctionsHttpError } from '@supabase/supabase-js'
import { usuarioDoEmail } from '../lib/acesso'
import { ErroDeOperacao } from '../lib/erros'
import * as demo from '../demo/servicos'
import { modoDemo } from '../lib/modoDemo'
import { supabase } from '../lib/supabase'
import type { Papel, PedidoSenha, Usuario } from '../types'

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

// ---------- "Esqueci a senha": pedido sem login, atendido pela administração ----------

/** A resposta é sempre igual, exista a conta ou não (o servidor não revela quais usuários existem). */
export async function solicitarRedefinicaoSenha(usuario: string) {
  if (modoDemo) return demo.solicitarRedefinicaoSenha(usuario)
  const { error } = await supabase.rpc('solicitar_redefinicao_senha', { p_usuario: usuario })
  if (error) throw error
}

export async function listarPedidosSenha(): Promise<PedidoSenha[]> {
  if (modoDemo) return demo.listarPedidosSenha()
  const { data, error } = await supabase.rpc('listar_pedidos_senha')
  if (error) throw error
  return (data as { usuario_id: string; nome: string; email: string; ativo: boolean; solicitado_em: string }[])
    .map(p => ({ usuarioId: p.usuario_id, nome: p.nome, usuario: usuarioDoEmail(p.email), ativo: p.ativo, solicitadoEm: p.solicitado_em }))
}

/** Avisa o menu para atualizar o contador de pedidos depois que a administração atende um. */
export const EVENTO_PEDIDOS_SENHA = 'beauty-tn-batista:pedidos-senha'

export async function encerrarPedidoSenha(usuarioId: string, resolucao: 'senha_redefinida' | 'descartado') {
  if (modoDemo) await demo.encerrarPedidoSenha(usuarioId, resolucao)
  else {
    const { error } = await supabase.rpc('encerrar_pedido_senha', { p_usuario_id: usuarioId, p_resolucao: resolucao })
    if (error) throw error
  }
  window.dispatchEvent(new Event(EVENTO_PEDIDOS_SENHA))
}

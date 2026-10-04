import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { entrarComoDemo as entrarNaDemo, perfilDemo, sairDaDemo } from '../demo/estado'
import { usuarioDoEmail } from '../lib/acesso'
import { modoDemo } from '../lib/modoDemo'
import { pode } from '../lib/permissoes'
import { supabase } from '../lib/supabase'
import type { Papel, Perfil } from '../types'

type EstadoSessao =
  | { tipo: 'carregando' }
  | { tipo: 'anonimo' }
  | { tipo: 'sem_perfil'; usuario: string }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'autenticado'; perfil: Perfil }

interface ContextoSessao { estado: EstadoSessao; sair: () => Promise<void>; recarregarPerfil: () => Promise<void>; entrarComoDemo?: (usuarioId: string) => void }

const Contexto = createContext<ContextoSessao | null>(null)

async function carregarPerfil(sessao: Session): Promise<EstadoSessao> {
  const { data, error } = await supabase.rpc('meu_perfil')
  if (error) return { tipo: 'erro', mensagem: 'Não foi possível carregar seu perfil. Verifique a conexão e tente novamente.' }
  const linha = (data as { usuario_id: string; nome: string; papel: Papel; profissional_id: string | null; fuso_horario: string }[])[0]
  // Conta sem perfil ativo não acessa nada (o banco também bloqueia pela RLS).
  if (!linha) return { tipo: 'sem_perfil', usuario: usuarioDoEmail(sessao.user.email ?? '') }
  return {
    tipo: 'autenticado',
    perfil: { usuarioId: linha.usuario_id, nome: linha.nome, papel: linha.papel, profissionalId: linha.profissional_id, fusoHorario: linha.fuso_horario },
  }
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  return modoDemo ? <ProvedorSessaoDemo>{children}</ProvedorSessaoDemo> : <ProvedorSessaoReal>{children}</ProvedorSessaoReal>
}

/**
 * Demonstração: o perfil é escolhido numa lista e vale só para os dados fictícios do navegador.
 * Não substitui nem enfraquece a autenticação real, que segue exigida fora do modo demonstração.
 */
function ProvedorSessaoDemo({ children }: { children: ReactNode }) {
  const lerEstado = (): EstadoSessao => { const perfil = perfilDemo(); return perfil ? { tipo: 'autenticado', perfil } : { tipo: 'anonimo' } }
  const [estado, setEstado] = useState<EstadoSessao>(lerEstado)
  const recarregarPerfil = useCallback(async () => setEstado(lerEstado()), [])
  const sair = useCallback(async () => { sairDaDemo(); setEstado({ tipo: 'anonimo' }) }, [])
  const entrarComoDemo = useCallback((usuarioId: string) => { entrarNaDemo(usuarioId); setEstado(lerEstado()) }, [])
  return <Contexto.Provider value={{ estado, sair, recarregarPerfil, entrarComoDemo }}>{children}</Contexto.Provider>
}

function ProvedorSessaoReal({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao>({ tipo: 'carregando' })
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, nova) => setSessao(nova))
    return () => data.subscription.unsubscribe()
  }, [])

  // Recarrega o perfil somente quando muda o usuário, não a cada renovação de token.
  const ultimaSessao = useRef<Session | null>(null)
  ultimaSessao.current = sessao ?? null
  const chaveUsuario = sessao === undefined ? 'pendente' : sessao ? sessao.user.id : 'anonimo'
  useEffect(() => {
    if (chaveUsuario === 'pendente') return
    const atual = ultimaSessao.current
    if (!atual) { setEstado({ tipo: 'anonimo' }); return }
    let ativo = true
    setEstado({ tipo: 'carregando' })
    carregarPerfil(atual).then(novo => { if (ativo) setEstado(novo) })
    return () => { ativo = false }
  }, [chaveUsuario])

  const recarregarPerfil = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setEstado(data.session ? await carregarPerfil(data.session) : { tipo: 'anonimo' })
  }, [])

  const sair = useCallback(async () => {
    await supabase.auth.signOut()
    setEstado({ tipo: 'anonimo' })
  }, [])

  return <Contexto.Provider value={{ estado, sair, recarregarPerfil }}>{children}</Contexto.Provider>
}

export function useSessao() {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useSessao fora de ProvedorSessao')
  return contexto
}

/** Perfil do usuário autenticado; só deve ser usado dentro da área logada. */
export function usePerfil() {
  const { estado } = useSessao()
  if (estado.tipo !== 'autenticado') throw new Error('usePerfil sem usuário autenticado')
  return estado.perfil
}

export const ehEquipe = (papel: Papel) => pode(papel, 'verAgendaGeral')

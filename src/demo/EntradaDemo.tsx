import type { ReactNode } from 'react'
import { KeyRound, UserRound, Users } from 'lucide-react'
import { useSessao } from '../auth/Sessao'
import { MENSAGEM_DEMO } from '../lib/modoDemo'
import { obterBase } from './estado'

/** Entrada da demonstração: escolha um perfil existente para ver as telas com dados fictícios. */
export function EntradaDemo() {
  const { entrarComoDemo } = useSessao()
  const base = obterBase()
  const ativos = base.usuarios.filter(u => u.ativo)
  const grupos = [
    { titulo: 'Administração', descricao: 'Todas as agendas, cadastros, jornadas, bloqueios, usuários e histórico.', icone: KeyRound, usuarios: ativos.filter(u => u.papel === 'admin') },
    { titulo: 'Atendimento', descricao: 'Agendas, clientes, agendamentos, andamento do dia, bloqueios pontuais e histórico dos agendamentos.', icone: Users, usuarios: ativos.filter(u => u.papel === 'secretaria') },
    { titulo: 'Profissional', descricao: 'Somente a própria agenda, para consulta.', icone: UserRound, usuarios: ativos.filter(u => u.papel === 'profissional') },
  ]

  return (
    <div className="min-h-screen bg-background">
      <FaixaDemo />
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="cartao animar-modal p-6 sm:p-8">
          <div className="marca mb-6"><img src="/brand/clinica-beauty.svg" alt="Clínica Beauty" width="80" height="80" /></div>
          <h1 className="titulo text-center text-2xl">Demonstração da agenda</h1>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            Escolha um perfil para navegar. Todos os nomes, telefones, horários e bloqueios são exemplos fictícios e ficam somente neste navegador;
            não são regras nem cadastros oficiais da clínica.
          </p>
          <div className="mt-6 space-y-5">
            {grupos.map(grupo => (
              <section key={grupo.titulo}>
                <h2 className="flex items-center gap-2 text-sm font-bold"><grupo.icone size={16} className="text-primary" />{grupo.titulo}</h2>
                <p className="mb-2 text-xs text-muted-foreground">{grupo.descricao}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {grupo.usuarios.map(u => (
                    <button key={u.usuarioId} type="button" onClick={() => entrarComoDemo?.(u.usuarioId)} className="rounded-xl border border-border bg-card p-3 text-left text-sm font-semibold hover:border-primary hover:bg-accent-soft">
                      {u.nome}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="mt-6 text-center text-sm"><a href="#/horarios" className="font-semibold text-primary hover:underline">Ver a página pública de horários (visitante)</a></p>
        </div>
      </div>
    </div>
  )
}

/** Faixa que identifica a demonstração em todas as telas. Na área logada fica fixa no topo (altura h-9). */
export function FaixaDemo({ children, fixa }: { children?: ReactNode; fixa?: boolean }) {
  return (
    <div role="note" className={`${fixa ? 'fixed inset-x-0 top-0 z-[45] h-9' : 'sticky top-0 z-40 min-h-9'} flex items-center justify-center gap-3 overflow-hidden whitespace-nowrap bg-warning px-3 text-center text-xs font-bold text-white sm:text-sm`}>
      <span className="truncate">{MENSAGEM_DEMO}</span>
      {children}
    </div>
  )
}

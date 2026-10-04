import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, History, KeyRound, LogOut, Menu, Scissors, Settings, UserRound, Users, X, type LucideIcon } from 'lucide-react'
import { usePerfil, useSessao } from '../auth/Sessao'
import { BarraDemo } from '../demo/BarraDemo'
import { modoDemo } from '../lib/modoDemo'
import { agoraNoFuso, dataCompleta } from '../lib/datas'
import { pode, type Permissao } from '../lib/permissoes'
import type { Papel } from '../types'

export type Rota = 'agenda' | 'clientes' | 'profissionais' | 'servicos' | 'usuarios' | 'auditoria' | 'configuracoes'

// Sem permissão definida, o item vale para todos os perfis internos (a agenda: cada um vê o que o banco libera).
const MENU: { rota: Rota; rotulo: string; icone: LucideIcon; permissao?: Permissao }[] = [
  { rota: 'agenda', rotulo: 'Agenda', icone: CalendarDays },
  { rota: 'clientes', rotulo: 'Clientes', icone: Users, permissao: 'gerenciarClientes' },
  { rota: 'profissionais', rotulo: 'Profissionais', icone: UserRound, permissao: 'gerenciarCadastros' },
  { rota: 'servicos', rotulo: 'Serviços', icone: Scissors, permissao: 'gerenciarCadastros' },
  { rota: 'usuarios', rotulo: 'Usuários', icone: KeyRound, permissao: 'gerenciarUsuarios' },
  { rota: 'auditoria', rotulo: 'Auditoria', icone: History, permissao: 'verAuditoria' },
  { rota: 'configuracoes', rotulo: 'Configurações', icone: Settings, permissao: 'configurarClinica' },
]

export const rotasPermitidas = (papel: Papel) => MENU.filter(item => !item.permissao || pode(papel, item.permissao)).map(item => item.rota)

const NOME_PAPEL: Record<Papel, string> = { admin: 'Administração', secretaria: 'Atendimento', profissional: 'Profissional' }

export function Layout({ rota, onNavegar, children }: { rota: Rota; onNavegar: (rota: Rota) => void; children: ReactNode }) {
  const perfil = usePerfil()
  const { sair } = useSessao()
  const [menuAberto, setMenuAberto] = useState(false)
  const hoje = agoraNoFuso(perfil.fusoHorario).data
  const iniciais = perfil.nome.split(' ').filter(Boolean).map(parte => parte[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => setMenuAberto(false), [rota])

  const ir = (destino: Rota) => { onNavegar(destino); setMenuAberto(false) }

  return (
    <div className={`min-h-screen bg-background text-foreground ${modoDemo ? 'pt-9' : ''}`}>
      {modoDemo && <BarraDemo />}
      <a href="#conteudo" className="pular-conteudo">Pular para o conteúdo principal</a>
      <aside className={`fixed bottom-0 left-0 ${modoDemo ? 'top-9' : 'top-0'} z-40 flex w-64 flex-col border-r border-border bg-sidebar px-5 py-6 shadow-[8px_0_28px_rgb(51_42_34/.035)] transition-transform lg:translate-x-0 ${menuAberto ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-8 flex items-start justify-between">
          <button type="button" onClick={() => ir('agenda')} className="marca" aria-label="Ir para a agenda"><img src="/brand/clinica-beauty.svg" alt="Clínica Beauty" width="80" height="80" /></button>
          <button type="button" onClick={() => setMenuAberto(false)} className="botao botao-texto botao-pequeno lg:hidden" aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <div className="mb-3 px-3 text-[.7rem] font-semibold uppercase tracking-[.18em] text-muted-foreground">Menu principal</div>
        <nav className="space-y-1" aria-label="Menu principal">
          {MENU.filter(item => !item.permissao || pode(perfil.papel, item.permissao)).map(item => (
            <button key={item.rota} type="button" onClick={() => ir(item.rota)} aria-current={rota === item.rota ? 'page' : undefined} className="item-menu">
              <item.icone size={18} strokeWidth={1.8} />{perfil.papel === 'profissional' && item.rota === 'agenda' ? 'Minha agenda' : item.rotulo}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{iniciais}</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{perfil.nome}</div>
              <div className="text-xs text-muted-foreground">{NOME_PAPEL[perfil.papel]}</div>
            </div>
          </div>
          <button type="button" onClick={sair} className="botao botao-texto botao-pequeno mt-2 w-full justify-start"><LogOut size={16} />Sair</button>
        </div>
      </aside>
      {menuAberto && <div onClick={() => setMenuAberto(false)} className="fixed inset-0 z-30 bg-black/20 lg:hidden" aria-hidden="true" />}

      <div className="lg:ml-64">
        <header className={`sticky ${modoDemo ? 'top-9' : 'top-0'} z-20 flex h-16 items-center justify-between border-b border-border bg-[rgb(255_253_249/.94)] px-4 shadow-[0_1px_8px_rgb(51_42_34/.055)] backdrop-blur lg:h-20 lg:px-10`}>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMenuAberto(true)} className="botao botao-texto botao-pequeno lg:hidden" aria-label="Abrir menu"><Menu size={22} /></button>
            <span className="hidden text-sm text-muted-foreground sm:inline">Olá, {perfil.nome.split(' ')[0]}</span>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold">Hoje</div>
            <div className="text-xs text-muted-foreground">{dataCompleta(hoje)}</div>
          </div>
        </header>
        <main id="conteudo" className="animar-pagina mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  )
}

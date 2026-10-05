import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { ProvedorSessao, usePerfil, useSessao } from './auth/Sessao'
import { ProvedorAvisos } from './components/Avisos'
import { Carregando } from './components/Basicos'
import { Layout, rotasPermitidas, type Rota } from './components/Layout'
import { EntradaDemo } from './demo/EntradaDemo'
import { modoDemo } from './lib/modoDemo'
import { supabaseConfigurado } from './lib/supabase'
import { LoginPage } from './pages/LoginPage'

// Cada tela é baixada só quando aberta: o carregamento inicial fica menor (entrada e agenda primeiro).
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const AgendaPage = lazy(() => import('./pages/agenda/AgendaPage').then(m => ({ default: m.AgendaPage })))
const AuditoriaPage = lazy(() => import('./pages/AuditoriaPage').then(m => ({ default: m.AuditoriaPage })))
const ClientesPage = lazy(() => import('./pages/ClientesPage').then(m => ({ default: m.ClientesPage })))
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage').then(m => ({ default: m.ConfiguracoesPage })))
const ListaEsperaPage = lazy(() => import('./pages/ListaEsperaPage').then(m => ({ default: m.ListaEsperaPage })))
const PaginaPublica = lazy(() => import('./pages/PaginaPublica').then(m => ({ default: m.PaginaPublica })))
const ProfissionaisPage = lazy(() => import('./pages/ProfissionaisPage').then(m => ({ default: m.ProfissionaisPage })))
const RecursosPage = lazy(() => import('./pages/RecursosPage').then(m => ({ default: m.RecursosPage })))
const ServicosPage = lazy(() => import('./pages/ServicosPage').then(m => ({ default: m.ServicosPage })))
const UsuariosPage = lazy(() => import('./pages/UsuariosPage').then(m => ({ default: m.UsuariosPage })))

const ehPaginaPublica = () => window.location.hash.startsWith('#/horarios')

export default function App() {
  const [publica, setPublica] = useState(ehPaginaPublica)
  useEffect(() => {
    const aoMudar = () => setPublica(ehPaginaPublica())
    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [])

  if (!supabaseConfigurado) return <AvisoTela titulo="Configuração ausente" texto="Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env.local." />
  // A consulta pública não passa pela sessão: visitante não é usuário interno.
  if (publica) return <ProvedorAvisos><Suspense fallback={<Carregando />}><PaginaPublica /></Suspense></ProvedorAvisos>
  return (
    <ProvedorAvisos>
      <ProvedorSessao>
        <Portao />
      </ProvedorSessao>
    </ProvedorAvisos>
  )
}

function Portao() {
  const { estado, sair, recarregarPerfil } = useSessao()
  if (estado.tipo === 'carregando') return <Carregando texto="Abrindo a agenda..." />
  if (estado.tipo === 'anonimo') return modoDemo ? <EntradaDemo /> : <LoginPage />
  if (estado.tipo === 'erro') return <AvisoTela titulo="Falha ao carregar" texto={estado.mensagem} acao={{ rotulo: 'Tentar novamente', executar: recarregarPerfil }} />
  if (estado.tipo === 'sem_perfil') return <AvisoTela titulo="Acesso não liberado" texto={`O usuário ${estado.usuario} ainda não tem perfil ativo. Procure a administração da clínica.`} acao={{ rotulo: 'Sair', executar: sair }} />
  return <AreaLogada />
}

const rotaDoEndereco = () => window.location.hash.replace(/^#\/?/, '') as Rota

function AreaLogada() {
  const perfil = usePerfil()
  const permitidas = useMemo(() => rotasPermitidas(perfil.papel), [perfil.papel])
  // Tela inicial: o Dashboard para a equipe; a própria agenda para o profissional.
  const inicial = permitidas[0]
  const [rota, setRota] = useState<Rota>(() => permitidas.includes(rotaDoEndereco()) ? rotaDoEndereco() : inicial)

  useEffect(() => {
    const aoMudar = () => setRota(permitidas.includes(rotaDoEndereco()) ? rotaDoEndereco() : inicial)
    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [permitidas, inicial])

  const navegar = (destino: Rota) => { window.location.hash = `/${destino}`; setRota(destino) }

  return (
    <Layout rota={rota} onNavegar={navegar}>
      <Suspense fallback={<Carregando />}>
      {rota === 'dashboard' && <DashboardPage />}
      {rota === 'agenda' && <AgendaPage />}
      {rota === 'espera' && <ListaEsperaPage />}
      {rota === 'clientes' && <ClientesPage />}
      {rota === 'profissionais' && <ProfissionaisPage />}
      {rota === 'servicos' && <ServicosPage />}
      {rota === 'recursos' && <RecursosPage />}
      {rota === 'usuarios' && <UsuariosPage />}
      {rota === 'auditoria' && <AuditoriaPage />}
      {rota === 'configuracoes' && <ConfiguracoesPage />}
      </Suspense>
    </Layout>
  )
}

function AvisoTela({ titulo, texto, acao }: { titulo: string; texto: string; acao?: { rotulo: string; executar: () => void } }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="cartao w-full max-w-md p-8 text-center">
        <h1 className="titulo text-2xl">{titulo}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{texto}</p>
        {acao && <button type="button" onClick={acao.executar} className="botao botao-primario mt-6">{acao.rotulo}</button>}
      </div>
    </div>
  )
}

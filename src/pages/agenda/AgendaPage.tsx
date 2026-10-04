import { useMemo, useState } from 'react'
import { Ban, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { ehEquipe, usePerfil } from '../../auth/Sessao'
import { pode } from '../../lib/permissoes'
import { useAvisos } from '../../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento } from '../../components/Basicos'
import { agoraNoFuso, dataPorExtenso, diaMes, gradeDoMes, inicioDaSemana, mesPorExtenso, primeiraMaiuscula, somarDias, somarMeses } from '../../lib/datas'
import { LISTA_STATUS, STATUS } from '../../lib/status'
import { useCarregar } from '../../lib/useCarregar'
import { listarAgenda } from '../../services/agenda'
import { listarHabilitacoes, listarProfissionais, listarServicos } from '../../services/cadastros'
import { listarBloqueios } from '../../services/jornada'
import type { ItemAgenda, StatusAgendamento } from '../../types'
import { BloqueiosModal } from './BloqueiosModal'
import { DetalhesAgendamentoModal } from './DetalhesAgendamentoModal'
import { NovoAgendamentoModal } from './NovoAgendamentoModal'
import { VisaoDia, VisaoMes, VisaoSemana } from './Visoes'

type ModoAgenda = 'dia' | 'semana' | 'mes'
// '' mostra tudo exceto cancelados; 'todos' inclui cancelados.
type FiltroStatus = '' | 'todos' | StatusAgendamento

export function AgendaPage() {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const equipe = ehEquipe(perfil.papel)
  const fuso = perfil.fusoHorario
  const hoje = agoraNoFuso(fuso).data

  const [modo, setModo] = useState<ModoAgenda>('dia')
  const [data, setData] = useState(hoje)
  const [profissionalId, setProfissionalId] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [status, setStatus] = useState<FiltroStatus>('')
  const [novo, setNovo] = useState(false)
  const [bloqueiosAberto, setBloqueiosAberto] = useState(false)
  const [selecionado, setSelecionado] = useState<ItemAgenda | null>(null)

  const periodo = useMemo(() => {
    if (modo === 'dia') return { de: data, ate: data }
    if (modo === 'semana') { const de = inicioDaSemana(data); return { de, ate: somarDias(de, 6) } }
    const grade = gradeDoMes(data)
    return { de: grade[0], ate: grade[grade.length - 1] }
  }, [modo, data])

  // Cadastros usados nos filtros e formulários (somente a equipe administrativa os lê).
  const cadastros = useCarregar(async () => {
    if (!equipe) return { profissionais: [], servicos: [], habilitacoes: [] }
    const [profissionais, servicos, habilitacoes] = await Promise.all([listarProfissionais(), listarServicos(), listarHabilitacoes()])
    return { profissionais, servicos, habilitacoes }
  }, [equipe])

  const agenda = useCarregar(async () => {
    const [itens, bloqueios] = await Promise.all([
      listarAgenda(periodo.de, periodo.ate, profissionalId || undefined),
      modo === 'dia'
        ? listarBloqueios({ de: `${somarDias(data, -1)}T00:00:00Z`, ate: `${somarDias(data, 2)}T00:00:00Z`, profissionalId: profissionalId || undefined })
        : Promise.resolve([]),
    ])
    return { itens, bloqueios }
  }, [periodo.de, periodo.ate, profissionalId, modo, data], { aoFocar: true })

  const itens = (agenda.dados?.itens ?? []).filter(item =>
    (!servicoId || item.servicoId === servicoId) &&
    (status === 'todos' ? true : status === '' ? item.status !== 'cancelado' : item.status === status))

  // Bloqueios que tocam o dia exibido no fuso da clínica.
  const bloqueiosDoDia = (agenda.dados?.bloqueios ?? []).filter(b => {
    const inicio = new Date(b.inicio).getTime()
    const fim = new Date(b.fim).getTime()
    const diaInicio = agoraNoFuso(fuso, new Date(inicio)).data
    const diaFim = agoraNoFuso(fuso, new Date(fim - 1)).data
    return diaInicio <= data && diaFim >= data
  })

  const navegar = (direcao: number) => {
    if (modo === 'dia') setData(somarDias(data, direcao))
    if (modo === 'semana') setData(somarDias(data, 7 * direcao))
    if (modo === 'mes') setData(somarMeses(data, direcao))
  }

  const tituloPeriodo = modo === 'dia' ? dataPorExtenso(data)
    : modo === 'semana' ? `${diaMes(periodo.de)} a ${diaMes(periodo.ate)}`
    : mesPorExtenso(data)

  const aposAlterar = (mensagem: string) => { avisar(mensagem); setSelecionado(null); agenda.recarregar() }
  const profissionais = cadastros.dados?.profissionais ?? []

  return (
    <div>
      <CabecalhoPagina sobretitulo={equipe ? 'Visão geral' : 'Profissional'} titulo={equipe ? 'Agenda' : 'Minha agenda'}
        descricao={equipe ? 'Organize os atendimentos e horários da clínica.' : 'Seus atendimentos, sempre atualizados.'}
        acoes={equipe && <>
          {pode(perfil.papel, 'gerenciarBloqueios') && <button type="button" onClick={() => setBloqueiosAberto(true)} className="botao botao-secundario" disabled={!cadastros.dados}><Ban size={17} />Bloqueios</button>}
          <button type="button" onClick={() => setNovo(true)} className="botao botao-primario" disabled={!cadastros.dados}><Plus size={18} />Novo agendamento</button>
        </>} />

      <div className="cartao mb-5 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => navegar(-1)} className="botao botao-texto botao-pequeno" aria-label="Período anterior"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => setData(hoje)} className="botao botao-secundario botao-pequeno">Hoje</button>
            <button type="button" onClick={() => navegar(1)} className="botao botao-texto botao-pequeno" aria-label="Próximo período"><ChevronRight size={18} /></button>
            <span className="ml-1 text-base font-bold">{primeiraMaiuscula(tituloPeriodo)}</span>
            <input type="date" aria-label="Escolher data" className="campo !mt-0 !min-h-9 w-auto py-1 text-sm" value={data} onChange={e => e.target.value && setData(e.target.value)} />
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Visualização">
            {(['dia', 'semana', 'mes'] as const).map(m => <button key={m} type="button" aria-pressed={modo === m} onClick={() => setModo(m)} className="aba">{m === 'dia' ? 'Dia' : m === 'semana' ? 'Semana' : 'Mês'}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {equipe && (
            <select aria-label="Filtrar por profissional" className="campo !mt-0 w-full sm:w-56" value={profissionalId} onChange={e => setProfissionalId(e.target.value)}>
              <option value="">Todos os profissionais</option>
              {profissionais.map(p => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' (inativo)'}</option>)}
            </select>
          )}
          {equipe && (
            <select aria-label="Filtrar por serviço" className="campo !mt-0 w-full sm:w-56" value={servicoId} onChange={e => setServicoId(e.target.value)}>
              <option value="">Todos os serviços</option>
              {(cadastros.dados?.servicos ?? []).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
          <select aria-label="Filtrar por status" className="campo !mt-0 w-full sm:w-56" value={status} onChange={e => setStatus(e.target.value as FiltroStatus)}>
            <option value="">Todos, exceto cancelados</option>
            <option value="todos">Todos, inclusive cancelados</option>
            {LISTA_STATUS.map(s => <option key={s} value={s}>{STATUS[s].rotulo}</option>)}
          </select>
          <button type="button" onClick={agenda.recarregar} disabled={agenda.carregando} className="botao botao-texto botao-pequeno sm:ml-auto">
            <RefreshCw size={16} className={agenda.carregando ? 'animate-spin' : ''} />Atualizar
          </button>
        </div>
      </div>

      {cadastros.erro && <div className="mb-4"><FalhaCarregamento mensagem={cadastros.erro} onTentar={cadastros.recarregar} /></div>}
      {agenda.erro ? <FalhaCarregamento mensagem={agenda.erro} onTentar={agenda.recarregar} />
        : !agenda.dados ? <Carregando texto="Carregando agenda..." />
        : modo === 'dia' ? <VisaoDia itens={itens} bloqueios={bloqueiosDoDia} profissionais={profissionais} data={data} fuso={fuso} onAbrir={setSelecionado} />
        : modo === 'semana' ? <VisaoSemana itens={itens} inicioSemana={periodo.de} hoje={hoje} onAbrir={setSelecionado} onIrParaDia={dia => { setData(dia); setModo('dia') }} />
        : <VisaoMes itens={itens} data={data} hoje={hoje} onIrParaDia={dia => { setData(dia); setModo('dia') }} />}

      {novo && cadastros.dados && (
        <NovoAgendamentoModal dataInicial={data < hoje ? hoje : data} profissionalInicial={profissionalId || undefined} fuso={fuso}
          profissionais={cadastros.dados.profissionais} servicos={cadastros.dados.servicos} habilitacoes={cadastros.dados.habilitacoes}
          onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); avisar('Agendamento criado.'); agenda.recarregar() }} />
      )}
      {selecionado && (
        <DetalhesAgendamentoModal item={selecionado} papel={perfil.papel} fuso={fuso}
          profissionais={profissionais} habilitacoes={cadastros.dados?.habilitacoes ?? []}
          onAlterado={aposAlterar} onFechar={() => setSelecionado(null)} />
      )}
      {bloqueiosAberto && cadastros.dados && (
        <BloqueiosModal profissionais={cadastros.dados.profissionais} profissionalInicial={profissionalId || undefined} dataInicial={data < hoje ? hoje : data} fuso={fuso}
          onAlterado={agenda.recarregar} onFechar={() => setBloqueiosAberto(false)} />
      )}
    </div>
  )
}

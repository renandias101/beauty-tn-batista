import { useState, type FormEvent } from 'react'
import { Layers, Loader2, Repeat } from 'lucide-react'
import { Carregando, FalhaCarregamento, SeloStatus } from '../../components/Basicos'
import { dataCurta, nomeDoDia } from '../../lib/datas'
import { dicaDoErro, mensagemDeErro } from '../../lib/erros'
import { pode } from '../../lib/permissoes'
import { STATUS } from '../../lib/status'
import { useCarregar } from '../../lib/useCarregar'
import { agendamentosVinculados, cancelarMarcacao, cancelarSerie, reagendarMarcacao, reagendarSerie } from '../../services/agenda'
import type { Habilitacao, ItemAgenda, Papel, Profissional } from '../../types'

const FREQUENCIA = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' }
type Acao = null | 'cancelar_grupo' | 'reagendar_grupo' | 'cancelar_serie' | 'reagendar_serie'
type Escopo = 'proximas' | 'toda'

const futuraAtiva = (i: ItemAgenda) => (i.status === 'agendado' || i.status === 'confirmado') && Date.parse(i.inicio) > Date.now()

/**
 * Marcação com vários serviços ou série recorrente: lista as reservas vinculadas e oferece as operações sobre o conjunto,
 * mostrando antes quais reservas serão afetadas e quais serão preservadas. "Somente esta" usa as ações do próprio agendamento.
 */
export function VinculosAgendamento({ item, papel, profissionais, habilitacoes, onAlterado }: {
  item: ItemAgenda; papel: Papel; profissionais: Profissional[]; habilitacoes: Habilitacao[]; onAlterado: (mensagem: string) => void
}) {
  const vinculados = useCarregar(() => agendamentosVinculados(item.grupoId ? { grupoId: item.grupoId } : { serieId: item.serieId! }), [item.grupoId, item.serieId, item.versao])
  const [acao, setAcao] = useState<Acao>(null)
  const [escopo, setEscopo] = useState<Escopo>('proximas')
  const [motivo, setMotivo] = useState('')
  const [data, setData] = useState(item.data)
  const [hora, setHora] = useState('')
  const [profissionalId, setProfissionalId] = useState(item.profissionalId)
  const [justificativa, setJustificativa] = useState('')
  const [conflito, setConflito] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const lista = vinculados.dados ?? []
  const grupo = Boolean(item.grupoId)

  // Reservas afetadas pela ação escolhida (mesma regra do servidor) e as que serão preservadas.
  const afetadas = acao === 'cancelar_grupo' ? lista.filter(i => ['agendado', 'confirmado', 'chegou'].includes(i.status))
    : acao === 'reagendar_grupo' ? lista
    : acao ? lista.filter(i => futuraAtiva(i) && (escopo === 'toda' || (i.serieOrdem ?? 0) >= (item.serieOrdem ?? 0)))
    : []
  const preservadas = lista.filter(i => !afetadas.includes(i))
  const bloqueioGrupo = acao === 'reagendar_grupo' ? lista.find(i => i.status !== 'agendado' && i.status !== 'confirmado') : undefined
  const habilitados = profissionais.filter(p => p.ativo && habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === item.servicoId))

  const abrir = (nova: Acao) => { setAcao(nova); setErro(''); setConflito(false); setMotivo(''); setHora('') }

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando || !acao) return
    if (motivo.trim().length < 3) { setErro('Informe o motivo (mínimo de 3 caracteres).'); return }
    if ((acao === 'reagendar_grupo' || acao === 'reagendar_serie') && !hora) { setErro('Informe o novo horário.'); return }
    setSalvando(true)
    setErro('')
    try {
      const aPartirDe = escopo === 'proximas' ? item.id : null
      let total = 0
      if (acao === 'cancelar_grupo') total = await cancelarMarcacao(item.grupoId!, motivo.trim(), afetadas)
      if (acao === 'reagendar_grupo') total = await reagendarMarcacao(item.grupoId!, { data, hora, motivo: motivo.trim(), justificativaConflito: justificativa }, lista)
      if (acao === 'cancelar_serie') total = await cancelarSerie(item.serieId!, aPartirDe, motivo.trim(), afetadas)
      if (acao === 'reagendar_serie') total = await reagendarSerie(item.serieId!, aPartirDe, { hora, profissionalId, motivo: motivo.trim(), justificativaConflito: justificativa }, afetadas)
      onAlterado(`${acao.startsWith('cancelar') ? 'Cancelados' : 'Reagendados'}: ${total} agendamento(s).${acao.startsWith('reagendar') ? ' Avise a cliente sobre os novos horários.' : ''}`)
    } catch (falha) {
      setConflito(dicaDoErro(falha) === 'conflito_cliente')
      if (dicaDoErro(falha) === 'versao_desatualizada') vinculados.recarregar()
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const linha = (i: ItemAgenda) => (
    <li key={i.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${i.id === item.id ? 'bg-accent-soft' : 'bg-muted'}`}>
      <span>{grupo ? `${i.grupoOrdem}. ` : `${i.serieOrdem}. ${nomeDoDia(i.data)}, ${dataCurta(i.data)} · `}{i.horaInicio}–{i.horaFim} · {i.servicoNome} · {i.profissionalNome}{i.id === item.id ? ' (este)' : ''}</span>
      <SeloStatus status={i.status} />
    </li>
  )

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        {grupo ? <Layers size={16} className="text-primary" /> : <Repeat size={16} className="text-primary" />}
        {grupo ? `Marcação com ${item.grupoTotal} serviços (este é o ${item.grupoOrdem}º)` : `Série ${FREQUENCIA[item.serieFrequencia ?? 'semanal']} · ocorrência nº ${item.serieOrdem} · ${item.serieTotal} reservas na série`}
      </h3>
      {vinculados.erro ? <FalhaCarregamento mensagem={vinculados.erro} onTentar={vinculados.recarregar} /> : !vinculados.dados ? <Carregando /> : !acao && (
        <>
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rolagem-fina">{lista.map(linha)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Cada {grupo ? 'serviço' : 'ocorrência'} mantém status e histórico próprios. Para alterar somente este, use as ações abaixo do agendamento.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {grupo ? <>
              <button type="button" onClick={() => abrir('reagendar_grupo')} className="botao botao-secundario botao-pequeno">Reagendar a marcação inteira</button>
              <button type="button" onClick={() => abrir('cancelar_grupo')} className="botao botao-texto botao-pequeno text-error">Cancelar a marcação inteira</button>
            </> : <>
              <button type="button" onClick={() => abrir('reagendar_serie')} className="botao botao-secundario botao-pequeno">Alterar horário da série</button>
              <button type="button" onClick={() => abrir('cancelar_serie')} className="botao botao-texto botao-pequeno text-error">Cancelar ocorrências da série</button>
            </>}
          </div>
        </>
      )}

      {acao && vinculados.dados && (
        <form onSubmit={confirmar} className="mt-3 space-y-3">
          {!grupo && (
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="rotulo mb-1">Aplicar a</legend>
              <label className="flex items-center gap-2"><input type="radio" checked={escopo === 'proximas'} onChange={() => setEscopo('proximas')} />Esta e as próximas</label>
              <label className="flex items-center gap-2"><input type="radio" checked={escopo === 'toda'} onChange={() => setEscopo('toda')} />Toda a série elegível</label>
            </fieldset>
          )}
          {acao === 'reagendar_grupo' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rotulo">Nova data<input className="campo" type="date" required value={data} onChange={e => setData(e.target.value)} /></label>
              <label className="rotulo">Início do 1º serviço<input className="campo" type="time" required step={300} value={hora} onChange={e => setHora(e.target.value)} /></label>
              <p className="text-xs text-muted-foreground sm:col-span-2">Os demais serviços mantêm a mesma distância entre si, os profissionais e as durações.</p>
            </div>
          )}
          {acao === 'reagendar_serie' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rotulo">Novo horário<input className="campo" type="time" required step={300} value={hora} onChange={e => setHora(e.target.value)} /></label>
              <label className="rotulo">Profissional
                <select className="campo" value={profissionalId} onChange={e => setProfissionalId(e.target.value)}>
                  {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">Cada ocorrência mantém a própria data. Outro profissional usa a duração dele para o serviço.</p>
            </div>
          )}
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-semibold">{bloqueioGrupo ? 'Não é possível reagendar a marcação inteira' : `Serão ${acao.startsWith('cancelar') ? 'cancelados' : 'alterados'}: ${afetadas.length}`}</p>
            {bloqueioGrupo ? <p className="mt-1 text-error">O serviço {bloqueioGrupo.grupoOrdem} está “{STATUS[bloqueioGrupo.status].rotulo.toLowerCase()}”. Reagende os serviços pendentes individualmente.</p>
              : <ul className="mt-2 space-y-1">{afetadas.map(linha)}</ul>}
            {!bloqueioGrupo && preservadas.length > 0 && <>
              <p className="mt-3 font-semibold">Preservados (não mudam): {preservadas.length}</p>
              <ul className="mt-2 space-y-1 opacity-75">{preservadas.map(linha)}</ul>
            </>}
          </div>
          <label className="rotulo">Motivo<textarea className="campo resize-none" rows={2} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
          {conflito && pode(papel, 'autorizarConflitoCliente') && acao.startsWith('reagendar') && (
            <label className="rotulo">Justificativa da exceção (administração)
              <textarea className="campo resize-none" rows={2} maxLength={300} value={justificativa} onChange={e => setJustificativa(e.target.value)} />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => abrir(null)} disabled={salvando} className="botao botao-texto botao-pequeno">Voltar</button>
            <button type="submit" disabled={salvando || Boolean(bloqueioGrupo) || afetadas.length === 0} className={`botao botao-pequeno ${acao.startsWith('cancelar') ? 'botao-perigo' : 'botao-primario'}`}>
              {salvando && <Loader2 size={14} className="animate-spin" />}Confirmar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

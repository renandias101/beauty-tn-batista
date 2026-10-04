import { useMemo, useState, type FormEvent } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { CampoBusca } from '../../components/CampoBusca'
import { ClienteFormulario } from '../../components/ClienteFormulario'
import { Modal } from '../../components/Modal'
import { dataPorExtenso, primeiraMaiuscula } from '../../lib/datas'
import { dicaDoErro, mensagemDeErro } from '../../lib/erros'
import { pode } from '../../lib/permissoes'
import { useCarregar } from '../../lib/useCarregar'
import { novoUuid } from '../../lib/uuid'
import { criarAgendamento, criarMarcacao, criarSerie, preverSerie, type DadosSerie } from '../../services/agenda'
import { duracaoEfetiva, listarClientes } from '../../services/cadastros'
import type { Cliente, Habilitacao, OcorrenciaPrevista, Papel, Profissional, Servico } from '../../types'
import { EtapasMarcacao, fimDaEtapa, recalcularSugestoes, type EtapaForm } from './EtapasMarcacao'
import { RECORRENCIA_PADRAO, RecorrenciaCampos, type ConfigRecorrencia } from './RecorrenciaCampos'
import { SeletorHorario } from './SeletorHorario'

/** Dados já conhecidos (ex.: vindos da lista de espera ou de uma vaga liberada). */
export interface DadosIniciaisAgendamento {
  clienteId?: string
  servicoId?: string
  profissionalId?: string
  data?: string
  hora?: string
  listaEsperaId?: string
  observacao?: string
}

interface Props {
  dataInicial: string
  inicial?: DadosIniciaisAgendamento
  papel: Papel
  profissionais: Profissional[]
  servicos: Servico[]
  habilitacoes: Habilitacao[]
  fuso: string
  revisao?: number
  onSalvo: (mensagem?: string) => void
  onFechar: () => void
}

type Modo = 'um' | 'varios'
const novaEtapa = (): EtapaForm => ({ chave: Math.random().toString(36).slice(2), servicoId: '', profissionalId: '', hora: '', intervalo: '0', manual: false })

/** Fluxo "Criar e confirmar" (seção 8): um serviço (opcionalmente recorrente) ou vários serviços em sequência. */
export function NovoAgendamentoModal({ dataInicial, inicial, papel, profissionais, servicos, habilitacoes, fuso, revisao, onSalvo, onFechar }: Props) {
  // Ids gerados uma vez: se a resposta se perder e o usuário salvar de novo, o servidor não duplica (CA11).
  const [id] = useState(novoUuid)
  const [idSerie] = useState(novoUuid)
  const [idMarcacao] = useState(novoUuid)
  const clientes = useCarregar(listarClientes, [])
  const [novos, setNovos] = useState<Cliente[]>([])
  const [cadastrandoCliente, setCadastrandoCliente] = useState(false)
  const [modo, setModo] = useState<Modo>('um')
  const [clienteId, setClienteId] = useState(inicial?.clienteId ?? '')
  const [servicoId, setServicoId] = useState(inicial?.servicoId ?? '')
  const [profissionalId, setProfissionalId] = useState(inicial?.profissionalId ?? '')
  const [data, setData] = useState(inicial?.data ?? dataInicial)
  const [hora, setHora] = useState(inicial?.hora ?? '')
  const [encaixe, setEncaixe] = useState(false)
  const [observacao, setObservacao] = useState(inicial?.observacao ?? '')
  const [justificativa, setJustificativa] = useState('')
  const [conflitoCliente, setConflitoCliente] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  // Recorrência
  const [recorrente, setRecorrente] = useState(false)
  const [config, setConfig] = useState<ConfigRecorrencia>(RECORRENCIA_PADRAO)
  const [previa, setPrevia] = useState<{ chave: string; ocorrencias: OcorrenciaPrevista[] } | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [erroPrevia, setErroPrevia] = useState('')
  const [somenteDisponiveis, setSomenteDisponiveis] = useState(false)
  // Vários serviços
  const [etapas, setEtapas] = useState<EtapaForm[]>(() => [{ ...novaEtapa(), servicoId: inicial?.servicoId ?? '', profissionalId: inicial?.profissionalId ?? '', hora: inicial?.hora ?? '' }, novaEtapa()])
  const [revisando, setRevisando] = useState(false)
  const listaEspera = Boolean(inicial?.listaEsperaId)

  const listaClientes = useMemo(() => [...novos, ...(clientes.dados ?? []).filter(c => !novos.some(n => n.id === c.id))], [clientes.dados, novos])
  const servicosAtivos = servicos.filter(s => s.ativo)
  const servico = servicos.find(s => s.id === servicoId)
  // RN02: somente profissionais ativos e habilitados para o serviço.
  const habilitados = profissionais.filter(p => p.ativo && (!servicoId || habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === servicoId)))
  const duracao = profissionalId ? duracaoEfetiva(servico, habilitacoes, profissionalId) : servico?.duracaoMinutos ?? 0
  const nomeCliente = listaClientes.find(c => c.id === clienteId)?.nome ?? ''

  const dadosSerie = (): DadosSerie => ({
    clienteId, servicoId, profissionalId, dataInicial: data, hora, frequencia: config.frequencia,
    quantidade: config.limite === 'quantidade' ? Number(config.quantidade) || 0 : null, dataFinal: config.limite === 'data' ? config.dataFinal || null : null,
    diaInexistente: config.diaInexistente || null, justificativaConflito: justificativa,
  })
  const chaveSerie = JSON.stringify(dadosSerie())
  const previaAtual = previa?.chave === chaveSerie ? previa.ocorrencias : null

  const limparResultado = () => { setErro(''); setConflitoCliente(false) }
  const escolherServico = (novo: string) => {
    setServicoId(novo)
    if (profissionalId && !habilitacoes.some(h => h.profissionalId === profissionalId && h.servicoId === novo)) setProfissionalId('')
    setHora('')
  }

  const prever = async () => {
    if (!clienteId || !servicoId || !profissionalId || !data || !hora) { setErroPrevia('Preencha cliente, serviço, profissional, data e horário antes de ver as datas.'); return }
    setCarregandoPrevia(true)
    setErroPrevia('')
    try {
      setPrevia({ chave: chaveSerie, ocorrencias: await preverSerie(dadosSerie()) })
      setSomenteDisponiveis(false)
    } catch (falha) {
      setErroPrevia(mensagemDeErro(falha))
    } finally {
      setCarregandoPrevia(false)
    }
  }

  const tratarFalha = (falha: unknown) => {
    setConflitoCliente(dicaDoErro(falha) === 'conflito_cliente')
    setErro(mensagemDeErro(falha))
  }

  const salvarUm = async () => {
    if (!clienteId || !servicoId || !profissionalId || !data || !hora) { setErro('Preencha cliente, serviço, profissional, data e horário.'); return }
    if (!recorrente) {
      await criarAgendamento({ id, clienteId, servicoId, profissionalId, data, hora, observacao: observacao.trim(), encaixe, justificativaConflito: justificativa, listaEsperaId: inicial?.listaEsperaId })
      onSalvo('Agendamento criado.')
      return
    }
    if (!previaAtual) { setErro('Gere a prévia das datas (“Ver todas as datas”) antes de salvar a série.'); return }
    if (previaAtual.some(p => p.situacao === 'dia_inexistente')) { setErro('Escolha o que fazer nos meses que não têm o dia escolhido.'); return }
    const disponiveis = previaAtual.filter(p => p.situacao === 'disponivel').map(p => p.data)
    const comProblema = previaAtual.some(p => p.situacao === 'indisponivel')
    if (!disponiveis.length) { setErro('Nenhuma ocorrência disponível. Ajuste a série.'); return }
    if (comProblema && !somenteDisponiveis) { setErro('Há datas indisponíveis. Ajuste a série ou marque “Criar somente as ocorrências disponíveis”.'); return }
    const total = await criarSerie(idSerie, dadosSerie(), disponiveis, observacao.trim())
    onSalvo(`Série criada com ${total} ocorrência(s).`)
  }

  const salvarVarios = async () => {
    if (!clienteId) { setErro('Escolha a cliente.'); return }
    if (etapas.some(e => !e.servicoId || !e.profissionalId || !e.hora)) { setErro('Preencha serviço, profissional e início de todos os serviços.'); return }
    if (!revisando) { setErro(''); setRevisando(true); return }
    await criarMarcacao({ id: idMarcacao, clienteId, observacao: observacao.trim(), justificativaConflito: justificativa, etapas: etapas.map(e => ({ servicoId: e.servicoId, profissionalId: e.profissionalId, data, hora: e.hora })) })
    onSalvo(`Marcação com ${etapas.length} serviços criada.`)
  }

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    setSalvando(true)
    limparResultado()
    try {
      await (modo === 'um' ? salvarUm() : salvarVarios())
    } catch (falha) {
      tratarFalha(falha)
    } finally {
      setSalvando(false)
    }
  }

  const rotuloSalvar = modo === 'varios' ? (revisando ? 'Confirmar marcação' : 'Revisar marcação') : recorrente ? 'Criar série' : 'Salvar agendamento'

  return (
    <>
      <Modal titulo="Novo agendamento" descricao={listaEspera ? 'A partir da lista de espera. O horário é validado de novo ao salvar.' : 'O horário é validado novamente ao salvar.'} onFechar={onFechar} bloqueado={salvando} largura="lg"
        rodape={<>
          <button type="button" onClick={revisando ? () => setRevisando(false) : onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" form="form-novo-agendamento" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}{rotuloSalvar}</button>
        </>}>
        <form id="form-novo-agendamento" onSubmit={salvar} className="space-y-4">
          {listaEspera && <p className="alerta-info">A entrada da lista de espera só passa para “Agendado” depois que esta reserva for salva.</p>}
          {!listaEspera && !revisando && (
            <div className="flex w-fit items-center gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Tipo de agendamento">
              <button type="button" aria-pressed={modo === 'um'} onClick={() => { setModo('um'); limparResultado() }} className="aba">Um serviço</button>
              <button type="button" aria-pressed={modo === 'varios'} onClick={() => { setModo('varios'); limparResultado() }} className="aba">Vários serviços</button>
            </div>
          )}

          {!revisando && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <CampoBusca rotulo="Cliente" valor={clienteId} onEscolher={valor => { setClienteId(valor); limparResultado() }} desabilitado={listaEspera}
                  placeholder={clientes.carregando ? 'Carregando clientes...' : 'Buscar por nome ou telefone'}
                  opcoes={listaClientes.map(c => ({ id: c.id, rotulo: c.nome, detalhe: c.telefone }))} vazio="Nenhum cliente encontrado. Use “Novo cliente”." />
              </div>
              {!listaEspera && <button type="button" onClick={() => setCadastrandoCliente(true)} className="botao botao-secundario" title="Cadastrar novo cliente"><UserPlus size={16} /><span className="hidden sm:inline">Novo cliente</span></button>}
            </div>
          )}
          {clientes.erro && <p className="alerta-erro">{clientes.erro}</p>}

          {modo === 'um' && (
            <>
              <CampoBusca rotulo="Serviço" valor={servicoId} onEscolher={escolherServico} desabilitado={listaEspera}
                opcoes={servicosAtivos.map(s => ({ id: s.id, rotulo: s.nome, detalhe: `${s.duracaoMinutos} min${s.preparacaoMinutos ? ` + ${s.preparacaoMinutos} min de preparação` : ''}` }))} vazio="Nenhum serviço ativo encontrado." />
              <label className="rotulo">Profissional
                <select className="campo" required value={profissionalId} onChange={e => { setProfissionalId(e.target.value); setHora('') }} disabled={!servicoId}>
                  <option value="">{servicoId ? (habilitados.length ? 'Selecione' : 'Nenhum profissional habilitado') : 'Escolha o serviço primeiro'}</option>
                  {habilitados.map(p => {
                    const especifica = habilitacoes.find(h => h.profissionalId === p.id && h.servicoId === servicoId)?.duracaoMinutos
                    return <option key={p.id} value={p.id}>{p.nome}{especifica ? ` (${especifica} min)` : ''}</option>
                  })}
                </select>
              </label>
              <SeletorHorario servicoId={servicoId} profissionalId={profissionalId} duracaoMinutos={duracao} preparacaoMinutos={servico?.preparacaoMinutos ?? 0} fuso={fuso}
                data={data} hora={hora} onData={valor => { setData(valor); setHora('') }} onHora={valor => { setHora(valor); setConflitoCliente(false) }} revisao={revisao} />
              {!listaEspera && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} />Repetir este agendamento (série)</label>
              )}
              {recorrente && (
                <RecorrenciaCampos config={config} onConfig={setConfig} dataInicial={data} previa={previaAtual} carregandoPrevia={carregandoPrevia} erroPrevia={erroPrevia}
                  onPrever={prever} somenteDisponiveis={somenteDisponiveis} onSomenteDisponiveis={setSomenteDisponiveis} />
              )}
              {!recorrente && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={encaixe} onChange={e => setEncaixe(e.target.checked)} />Identificar como encaixe</label>}
            </>
          )}

          {modo === 'varios' && !revisando && (
            <>
              <label className="rotulo">Data<input className="campo" type="date" required value={data} onChange={e => setData(e.target.value)} /></label>
              <EtapasMarcacao etapas={etapas} onEtapas={lista => { setEtapas(lista); limparResultado() }} data={data} servicos={servicos} profissionais={profissionais} habilitacoes={habilitacoes} revisao={revisao} />
            </>
          )}

          {modo === 'varios' && revisando && (
            <section aria-label="Resumo da marcação" className="space-y-3">
              <p className="text-sm">Confira antes de confirmar. Se qualquer serviço não puder ser reservado, nenhum será criado.</p>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-semibold uppercase text-muted-foreground">Cliente</dt><dd className="font-semibold">{nomeCliente}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-muted-foreground">Data</dt><dd className="font-semibold">{primeiraMaiuscula(dataPorExtenso(data))}</dd></div>
              </dl>
              <ol className="space-y-2">
                {recalcularSugestoes(etapas, servicos, habilitacoes).map((e, i) => {
                  const s = servicos.find(x => x.id === e.servicoId)
                  return (
                    <li key={e.chave} className="rounded-xl border border-border p-3 text-sm">
                      <span className="font-bold">{i + 1}. {s?.nome}</span> com {profissionais.find(p => p.id === e.profissionalId)?.nome}
                      <span className="block text-muted-foreground">{e.hora} – {fimDaEtapa(e, servicos, habilitacoes)} ({duracaoEfetiva(s, habilitacoes, e.profissionalId)} min){s?.preparacaoMinutos ? ` · preparação de ${s.preparacaoMinutos} min na agenda do profissional` : ''}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          {!revisando && (
            <label className="rotulo">Observação operacional (opcional)
              <textarea className="campo resize-none" rows={2} maxLength={500} value={observacao} onChange={e => setObservacao(e.target.value)} />
              <span className="mt-1 block font-normal">Não registre dados clínicos ou de saúde.{modo === 'varios' || recorrente ? ' A observação vale para todas as reservas criadas.' : ''}</span>
            </label>
          )}
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
          {conflitoCliente && pode(papel, 'autorizarConflitoCliente') && (
            <label className="rotulo">Justificativa da exceção (administração)
              <textarea className="campo resize-none" rows={2} maxLength={300} value={justificativa} onChange={e => setJustificativa(e.target.value)} placeholder="Ex.: atendimento em dupla combinado com a cliente" />
              <span className="mt-1 block font-normal">A exceção fica registrada no histórico com seu nome. {recorrente ? 'Gere a prévia de novo e salve' : 'Salve novamente'} para confirmar.</span>
            </label>
          )}
        </form>
      </Modal>

      {cadastrandoCliente && (
        <Modal titulo="Novo cliente" descricao="Nome completo e telefone de contato." onFechar={() => setCadastrandoCliente(false)}>
          <ClienteFormulario onCancelar={() => setCadastrandoCliente(false)} onSalvo={cliente => { setNovos(atual => [cliente, ...atual]); setClienteId(cliente.id); setCadastrandoCliente(false) }} />
        </Modal>
      )}
    </>
  )
}

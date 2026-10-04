import { useMemo, useState, type FormEvent } from 'react'
import { CalendarPlus, History, Loader2, MessageCircle, Plus, UserPlus } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { CampoBusca } from '../components/CampoBusca'
import { ClienteFormulario } from '../components/ClienteFormulario'
import { Modal } from '../components/Modal'
import { agoraNoFuso, dataCurta, instanteNoFuso, somarDias } from '../lib/datas'
import { dicaDoErro, mensagemDeErro } from '../lib/erros'
import { linkWhatsApp } from '../lib/telefone'
import { useCarregar } from '../lib/useCarregar'
import { novoUuid } from '../lib/uuid'
import { listarClientes, listarHabilitacoes, listarProfissionais, listarServicos } from '../services/cadastros'
import { atualizarEntradaEspera, contatosDaEntrada, criarEntradaEspera, listarListaEspera } from '../services/espera'
import type { Cliente, EntradaEspera, StatusEspera } from '../types'
import { NovoAgendamentoModal } from './agenda/NovoAgendamentoModal'

export const STATUS_ESPERA: Record<StatusEspera, { rotulo: string; classes: string }> = {
  aguardando: { rotulo: 'Aguardando', classes: 'bg-warning-soft text-warning' },
  contatado: { rotulo: 'Contatado', classes: 'bg-info-soft text-info' },
  agendado: { rotulo: 'Agendado', classes: 'bg-success-soft text-success' },
  desistiu: { rotulo: 'Desistiu', classes: 'bg-muted text-muted-foreground' },
}

type Filtro = 'abertos' | StatusEspera | 'todos'

/**
 * Lista de espera: registra o interesse da cliente sem reservar horário. Para agendar, a equipe abre o formulário
 * de agendamento já preenchido; o servidor revalida a disponibilidade e só marca "Agendado" quando a reserva é criada.
 */
export function ListaEsperaPage() {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const hoje = agoraNoFuso(perfil.fusoHorario).data
  const lista = useCarregar(() => listarListaEspera(), [], { aoFocar: true })
  const cadastros = useCarregar(async () => {
    const [profissionais, servicos, habilitacoes] = await Promise.all([listarProfissionais(), listarServicos(), listarHabilitacoes()])
    return { profissionais, servicos, habilitacoes }
  }, [])
  const [filtro, setFiltro] = useState<Filtro>('abertos')
  const [filtros, setFiltros] = useState({ servicoId: '', profissionalId: '', de: '', ate: '' })
  const [nova, setNova] = useState(false)
  const [contato, setContato] = useState<EntradaEspera | null>(null)
  const [historico, setHistorico] = useState<EntradaEspera | null>(null)
  const [agendando, setAgendando] = useState<EntradaEspera | null>(null)

  const visiveis = (lista.dados ?? []).filter(e =>
    (filtro === 'todos' ? true : filtro === 'abertos' ? e.status === 'aguardando' || e.status === 'contatado' : e.status === filtro)
    && (!filtros.servicoId || e.servicoId === filtros.servicoId)
    // Profissional: entradas com essa preferência e as sem preferência (aceitam qualquer profissional habilitado).
    && (!filtros.profissionalId || e.profissionalId === filtros.profissionalId || e.profissionalId === null)
    // Período: entradas cujo período desejado cruza o período filtrado.
    && (!filtros.de || e.dataFim >= filtros.de) && (!filtros.ate || e.dataInicio <= filtros.ate))
  const abertas = (lista.dados ?? []).filter(e => e.status === 'aguardando' || e.status === 'contatado')
  const temFiltro = Boolean(filtros.servicoId || filtros.profissionalId || filtros.de || filtros.ate)
  const quando = (instante: string) => { const m = instanteNoFuso(instante, perfil.fusoHorario); return `${dataCurta(m.data)} ${m.hora}` }

  return (
    <div>
      <CabecalhoPagina sobretitulo="Atendimento" titulo="Lista de espera" descricao="Clientes interessadas em horários que ainda não estão livres. A lista não reserva horários."
        acoes={<button type="button" onClick={() => setNova(true)} className="botao botao-primario" disabled={!cadastros.dados}><Plus size={18} />Nova entrada</button>} />

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Filtrar lista de espera">
        {([['abertos', 'Em aberto'], ['aguardando', 'Aguardando'], ['contatado', 'Contatados'], ['agendado', 'Agendados'], ['desistiu', 'Desistências'], ['todos', 'Todos']] as [Filtro, string][]).map(([valor, rotulo]) => (
          <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)} className="aba">{rotulo}</button>
        ))}
      </div>

      <div className="cartao mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <select aria-label="Filtrar por serviço" className="campo !mt-0" value={filtros.servicoId} onChange={e => setFiltros({ ...filtros, servicoId: e.target.value })}>
          <option value="">Todos os serviços</option>
          {(cadastros.dados?.servicos ?? []).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <select aria-label="Filtrar por profissional" className="campo !mt-0" value={filtros.profissionalId} onChange={e => setFiltros({ ...filtros, profissionalId: e.target.value })}>
          <option value="">Todos os profissionais</option>
          {(cadastros.dados?.profissionais ?? []).map(p => <option key={p.id} value={p.id}>{p.nome} (ou sem preferência)</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">De<input type="date" aria-label="Período: de" className="campo !mt-0" value={filtros.de} onChange={e => setFiltros({ ...filtros, de: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">Até<input type="date" aria-label="Período: até" className="campo !mt-0" value={filtros.ate} onChange={e => setFiltros({ ...filtros, ate: e.target.value })} /></label>
        <button type="button" onClick={() => setFiltros({ servicoId: '', profissionalId: '', de: '', ate: '' })} disabled={!temFiltro} className="botao botao-texto botao-pequeno">Limpar filtros</button>
      </div>

      {cadastros.erro && <div className="mb-4"><FalhaCarregamento mensagem={cadastros.erro} onTentar={cadastros.recarregar} /></div>}
      {lista.erro ? <FalhaCarregamento mensagem={lista.erro} onTentar={lista.recarregar} /> : !lista.dados ? <Carregando /> : !visiveis.length ? <Vazio>Nenhuma entrada nesta situação.</Vazio> : (
        <ul className="space-y-3">
          {visiveis.map(e => {
            const aberta = e.status === 'aguardando' || e.status === 'contatado'
            const vencida = aberta && e.dataFim < hoje
            return (
              <li key={e.id} className="cartao p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold">{e.clienteNome}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_ESPERA[e.status].classes}`}>{STATUS_ESPERA[e.status].rotulo}</span>
                      {vencida && <span className="rounded-full bg-error-soft px-2.5 py-0.5 text-xs font-bold text-error">Período encerrado</span>}
                    </div>
                    <a href={linkWhatsApp(e.clienteTelefone)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><MessageCircle size={14} />{e.clienteTelefone}</a>
                    <div className="mt-1 text-sm">{e.servicoNome}{e.profissionalNome ? ` · prefere ${e.profissionalNome}` : ' · qualquer profissional habilitado'}</div>
                    <div className="mt-1 text-sm text-muted-foreground">De {dataCurta(e.dataInicio)} a {dataCurta(e.dataFim)}{e.horaInicio ? ` · entre ${e.horaInicio} e ${e.horaFim}` : ' · qualquer horário'}</div>
                    {e.observacao && <div className="mt-1 text-sm">{e.observacao}</div>}
                    <div className="mt-2 text-xs text-muted-foreground">Entrada em {quando(e.criadoEm)} por {e.criadoPor}{e.ultimoContatoEm ? ` · última atualização ${quando(e.ultimoContatoEm)} por ${e.ultimoContatoPor}` : ''}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {aberta && <button type="button" onClick={() => setAgendando(e)} disabled={!cadastros.dados} className="botao botao-primario botao-pequeno"><CalendarPlus size={14} />Agendar</button>}
                    {e.status !== 'agendado' && <button type="button" onClick={() => setContato(e)} className="botao botao-secundario botao-pequeno">Registrar contato</button>}
                    <button type="button" onClick={() => setHistorico(e)} className="botao botao-texto botao-pequeno"><History size={14} />Histórico</button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {nova && cadastros.dados && (
        <NovaEntradaModal hoje={hoje} abertas={abertas} servicos={cadastros.dados.servicos.filter(s => s.ativo)} profissionais={cadastros.dados.profissionais.filter(p => p.ativo)} habilitacoes={cadastros.dados.habilitacoes}
          onFechar={() => setNova(false)} onSalvo={() => { setNova(false); avisar('Entrada adicionada à lista de espera.'); lista.recarregar() }} />
      )}
      {contato && <ContatoModal entrada={contato} onFechar={() => setContato(null)} onSalvo={() => { setContato(null); avisar('Contato registrado.'); lista.recarregar() }} onDesatualizado={lista.recarregar} />}
      {historico && <HistoricoEspera entrada={historico} onFechar={() => setHistorico(null)} />}
      {agendando && cadastros.dados && (
        <NovoAgendamentoModal dataInicial={agendando.dataInicio > hoje ? agendando.dataInicio : hoje} papel={perfil.papel} fuso={perfil.fusoHorario}
          inicial={{ clienteId: agendando.clienteId, servicoId: agendando.servicoId, profissionalId: agendando.profissionalId ?? undefined, listaEsperaId: agendando.id }}
          profissionais={cadastros.dados.profissionais} servicos={cadastros.dados.servicos} habilitacoes={cadastros.dados.habilitacoes}
          onFechar={() => setAgendando(null)} onSalvo={() => { setAgendando(null); avisar('Agendamento criado e entrada marcada como agendada.'); lista.recarregar() }} />
      )}
    </div>
  )
}

function NovaEntradaModal({ hoje, abertas, servicos, profissionais, habilitacoes, onSalvo, onFechar }: {
  hoje: string; abertas: EntradaEspera[]; servicos: { id: string; nome: string }[]; profissionais: { id: string; nome: string }[]; habilitacoes: { profissionalId: string; servicoId: string }[]
  onSalvo: () => void; onFechar: () => void
}) {
  const [id] = useState(novoUuid)
  const clientes = useCarregar(listarClientes, [])
  const [novos, setNovos] = useState<Cliente[]>([])
  const [cadastrandoCliente, setCadastrandoCliente] = useState(false)
  const [form, setForm] = useState({ clienteId: '', servicoId: '', profissionalId: '', dataInicio: hoje, dataFim: somarDias(hoje, 14), comFaixa: false, horaInicio: '09:00', horaFim: '12:00', observacao: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const listaClientes = useMemo(() => [...novos, ...(clientes.dados ?? []).filter(c => !novos.some(n => n.id === c.id))], [clientes.dados, novos])
  const habilitados = profissionais.filter(p => !form.servicoId || habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === form.servicoId))
  // Possíveis duplicidades: entradas em aberto da mesma cliente para o mesmo serviço (com qualquer preferência).
  const parecidas = form.clienteId && form.servicoId ? abertas.filter(e => e.clienteId === form.clienteId && e.servicoId === form.servicoId) : []
  const [mesmoAssim, setMesmoAssim] = useState(false)

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (!form.clienteId || !form.servicoId) { setErro('Escolha a cliente e o serviço.'); return }
    if (form.dataFim < form.dataInicio) { setErro('A data final deve ser igual ou posterior à inicial.'); return }
    if (form.comFaixa && form.horaInicio >= form.horaFim) { setErro('O horário final deve ser posterior ao inicial.'); return }
    if (parecidas.length && !mesmoAssim) { setErro('Confira a possível duplicidade e marque “Adicionar mesmo assim” se for outra solicitação.'); return }
    setSalvando(true)
    setErro('')
    try {
      await criarEntradaEspera({
        id, clienteId: form.clienteId, servicoId: form.servicoId, profissionalId: form.profissionalId || null, dataInicio: form.dataInicio, dataFim: form.dataFim,
        horaInicio: form.comFaixa ? form.horaInicio : null, horaFim: form.comFaixa ? form.horaFim : null, observacao: form.observacao,
      })
      onSalvo()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Modal titulo="Nova entrada na lista de espera" descricao="Nenhum horário é reservado." onFechar={onFechar} bloqueado={salvando} largura="lg">
        <form onSubmit={salvar} className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <CampoBusca rotulo="Cliente" valor={form.clienteId} onEscolher={clienteId => setForm({ ...form, clienteId })} placeholder={clientes.carregando ? 'Carregando clientes...' : 'Buscar por nome ou telefone'}
                opcoes={listaClientes.map(c => ({ id: c.id, rotulo: c.nome, detalhe: c.telefone }))} vazio="Nenhum cliente encontrado. Use “Novo cliente”." />
            </div>
            <button type="button" onClick={() => setCadastrandoCliente(true)} className="botao botao-secundario" title="Cadastrar novo cliente"><UserPlus size={16} /><span className="hidden sm:inline">Novo cliente</span></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="rotulo">Serviço
              <select className="campo" required value={form.servicoId} onChange={e => setForm({ ...form, servicoId: e.target.value, profissionalId: '' })}>
                <option value="">Selecione</option>
                {servicos.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label className="rotulo">Profissional preferido (opcional)
              <select className="campo" value={form.profissionalId} onChange={e => setForm({ ...form, profissionalId: e.target.value })} disabled={!form.servicoId}>
                <option value="">Qualquer profissional habilitado</option>
                {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="rotulo">A partir de<input className="campo" type="date" required min={hoje} value={form.dataInicio} onChange={e => setForm({ ...form, dataInicio: e.target.value, dataFim: e.target.value > form.dataFim ? e.target.value : form.dataFim })} /></label>
            <label className="rotulo">Até<input className="campo" type="date" required min={form.dataInicio} value={form.dataFim} onChange={e => setForm({ ...form, dataFim: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.comFaixa} onChange={e => setForm({ ...form, comFaixa: e.target.checked })} />Só em uma faixa de horário</label>
          {form.comFaixa && (
            <div className="grid grid-cols-2 gap-4">
              <label className="rotulo">Das<input className="campo" type="time" required value={form.horaInicio} onChange={e => setForm({ ...form, horaInicio: e.target.value })} /></label>
              <label className="rotulo">Até<input className="campo" type="time" required value={form.horaFim} onChange={e => setForm({ ...form, horaFim: e.target.value })} /></label>
            </div>
          )}
          {parecidas.length > 0 && (
            <div role="alert" className="alerta-aviso space-y-2">
              <p className="font-semibold">Possível duplicidade: esta cliente já está na lista para este serviço.</p>
              <ul className="list-disc pl-5">{parecidas.map(e => <li key={e.id}>{e.profissionalNome ? `Prefere ${e.profissionalNome}` : 'Qualquer profissional'} · {dataCurta(e.dataInicio)} a {dataCurta(e.dataFim)} · {STATUS_ESPERA[e.status].rotulo}</li>)}</ul>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={mesmoAssim} onChange={e => setMesmoAssim(e.target.checked)} />Adicionar mesmo assim (é outra solicitação)</label>
            </div>
          )}
          <label className="rotulo">Observação operacional (opcional)
            <textarea className="campo resize-none" rows={2} maxLength={300} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} />
            <span className="mt-1 block font-normal">Não registre dados clínicos ou de saúde.</span>
          </label>
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
            <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Adicionar</button>
          </div>
        </form>
      </Modal>
      {cadastrandoCliente && (
        <Modal titulo="Novo cliente" descricao="Nome completo e telefone de contato." onFechar={() => setCadastrandoCliente(false)}>
          <ClienteFormulario onCancelar={() => setCadastrandoCliente(false)} onSalvo={cliente => { setNovos(atual => [cliente, ...atual]); setForm(f => ({ ...f, clienteId: cliente.id })); setCadastrandoCliente(false) }} />
        </Modal>
      )}
    </>
  )
}

function ContatoModal({ entrada, onSalvo, onFechar, onDesatualizado }: { entrada: EntradaEspera; onSalvo: () => void; onFechar: () => void; onDesatualizado: () => void }) {
  const [status, setStatus] = useState<Exclude<StatusEspera, 'agendado'>>(entrada.status === 'aguardando' ? 'contatado' : entrada.status === 'agendado' ? 'contatado' : entrada.status)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    setSalvando(true)
    setErro('')
    try {
      await atualizarEntradaEspera(entrada.id, status, observacao, entrada.versao)
      onSalvo()
    } catch (falha) {
      if (dicaDoErro(falha) === 'versao_desatualizada') onDesatualizado()
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo="Registrar contato" descricao={`${entrada.clienteNome} · ${entrada.servicoNome}`} onFechar={onFechar} bloqueado={salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Situação
          <select className="campo" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            <option value="aguardando">Aguardando</option>
            <option value="contatado">Contatado</option>
            <option value="desistiu">Desistiu</option>
          </select>
        </label>
        <label className="rotulo">Observação do contato<textarea className="campo resize-none" rows={3} maxLength={300} value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex.: Ofereci quinta às 10h, vai responder até amanhã" /></label>
        <p className="text-xs text-muted-foreground">“Agendado” é registrado automaticamente quando o agendamento é salvo pela opção Agendar.</p>
        {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Registrar</button>
        </div>
      </form>
    </Modal>
  )
}

function HistoricoEspera({ entrada, onFechar }: { entrada: EntradaEspera; onFechar: () => void }) {
  const perfil = usePerfil()
  const contatos = useCarregar(() => contatosDaEntrada(entrada.id), [entrada.id])
  return (
    <Modal titulo="Histórico da lista de espera" descricao={`${entrada.clienteNome} · ${entrada.servicoNome}`} onFechar={onFechar}>
      {contatos.erro ? <FalhaCarregamento mensagem={contatos.erro} onTentar={contatos.recarregar} /> : !contatos.dados ? <Carregando /> : !contatos.dados.length ? <Vazio>Nenhum registro.</Vazio> : (
        <ol className="space-y-2">
          {contatos.dados.map(c => {
            const m = instanteNoFuso(c.ocorridoEm, perfil.fusoHorario)
            return (
              <li key={c.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{c.statusAnterior ? `${STATUS_ESPERA[c.statusAnterior].rotulo} → ` : ''}{STATUS_ESPERA[c.statusNovo].rotulo}</span>
                  <span className="text-xs text-muted-foreground">{dataCurta(m.data)} às {m.hora} · {c.usuarioNome}</span>
                </div>
                {c.observacao && <p className="mt-1 text-muted-foreground">{c.observacao}</p>}
              </li>
            )
          })}
        </ol>
      )}
    </Modal>
  )
}

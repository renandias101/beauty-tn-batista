import { useState, type ReactNode } from 'react'
import { Ban, CalendarDays, CheckCircle2, ChevronRight, KeyRound, ListTodo, MessageCircle, Plus, RefreshCw } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, SeloStatus } from '../components/Basicos'
import { agoraNoFuso, dataPorExtenso, deMinutos, diaMes, nomeDoDia, primeiraMaiuscula, somarDias } from '../lib/datas'
import { bloqueioNaData } from '../lib/horariosLivres'
import { pode } from '../lib/permissoes'
import { filtrarPorStatus, semMensagem, type FiltroStatus } from '../lib/resumo'
import { ocupaHorario } from '../lib/status'
import { useCarregar } from '../lib/useCarregar'
import { useSincronizacaoAgenda } from '../lib/useSincronizacaoAgenda'
import { listarAgenda } from '../services/agenda'
import { listarHabilitacoes, listarProfissionais, listarServicos } from '../services/cadastros'
import { listarListaEspera } from '../services/espera'
import { listarBloqueios } from '../services/jornada'
import { listarPedidosSenha } from '../services/usuarios'
import { NovoAgendamentoModal } from './agenda/NovoAgendamentoModal'

const DIAS_A_FRENTE = 7

const INDICADORES: { filtro: FiltroStatus | 'presentes'; rotulo: string }[] = [
  { filtro: '', rotulo: 'Total do dia' },
  { filtro: 'agendado', rotulo: 'Aguardando confirmação' },
  { filtro: 'confirmado', rotulo: 'Presença confirmada' },
  { filtro: 'presentes', rotulo: 'Presentes ou em atendimento' },
  { filtro: 'concluido', rotulo: 'Concluídos' },
  { filtro: 'faltou', rotulo: 'Faltas' },
  { filtro: 'cancelado', rotulo: 'Cancelados' },
]

/**
 * Painel de resumo da equipe: o dia de hoje, os próximos dias e o que precisa de atenção.
 * Só lê dados com as mesmas funções da agenda (as permissões continuam no servidor); as ações ficam na Agenda.
 */
export function DashboardPage() {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const fuso = perfil.fusoHorario
  const hoje = agoraNoFuso(fuso).data
  const ultimoDia = somarDias(hoje, DIAS_A_FRENTE - 1)
  const verPedidosSenha = pode(perfil.papel, 'gerenciarUsuarios')
  const [novo, setNovo] = useState(false)
  const [revisao, setRevisao] = useState(0)

  const dados = useCarregar(async () => {
    const [itens, bloqueios, profissionais] = await Promise.all([
      listarAgenda(hoje, ultimoDia),
      listarBloqueios({ de: `${somarDias(hoje, -1)}T00:00:00Z`, ate: `${somarDias(hoje, 2)}T00:00:00Z` }),
      listarProfissionais(),
    ])
    // Pendências complementares: se uma delas falhar, o restante do painel continua visível.
    const [espera, pedidosSenha] = await Promise.all([
      listarListaEspera().then(lista => lista.filter(e => e.status === 'aguardando' || e.status === 'contatado').length, () => null),
      verPedidosSenha ? listarPedidosSenha().then(lista => lista.length, () => null) : Promise.resolve(null),
    ])
    return { itens, bloqueios, profissionais, espera, pedidosSenha }
  }, [hoje, ultimoDia, verPedidosSenha], { aoFocar: true })

  // Cadastros só para o formulário de novo agendamento, carregados quando ele é aberto.
  const cadastros = useCarregar(async () => {
    if (!novo) return null
    const [profissionais, servicos, habilitacoes] = await Promise.all([listarProfissionais(), listarServicos(), listarHabilitacoes()])
    return { profissionais, servicos, habilitacoes }
  }, [novo])

  useSincronizacaoAgenda(() => { dados.recarregar(); setRevisao(r => r + 1) })

  const itens = dados.dados?.itens ?? []
  const deHoje = itens.filter(i => i.data === hoje)
  const contar = (filtro: FiltroStatus | 'presentes') => filtro === 'presentes'
    ? deHoje.filter(i => i.status === 'chegou' || i.status === 'em_atendimento').length
    : filtrarPorStatus(deHoje, filtro).length
  const agora = Date.now()
  const proximos = deHoje.filter(i => ocupaHorario(i.status) && Date.parse(i.fim) > agora).sort((a, b) => a.inicio.localeCompare(b.inicio))
  const amanha = somarDias(hoje, 1)
  const semAviso = itens.filter(i => (i.data === hoje || i.data === amanha) && semMensagem(i) && Date.parse(i.inicio) > agora)
  const desatualizadas = semAviso.filter(i => i.comunicacaoDesatualizada)
  const nomeProfissional = (id: string) => dados.dados?.profissionais.find(p => p.id === id)?.nome ?? 'Profissional'
  const bloqueiosHoje = (dados.dados?.bloqueios ?? []).flatMap(b => {
    const trecho = bloqueioNaData(b, hoje, fuso)
    return trecho ? [{ ...b, trecho }] : []
  }).sort((a, b) => a.trecho.inicio - b.trecho.inicio)
  const dias = Array.from({ length: DIAS_A_FRENTE }, (_, i) => somarDias(hoje, i))
  const porDia = dias.map(d => ({ data: d, total: filtrarPorStatus(itens.filter(i => i.data === d), '').length }))
  const maiorDia = Math.max(1, ...porDia.map(d => d.total))

  return (
    <div>
      <CabecalhoPagina sobretitulo="Visão geral" titulo="Dashboard" descricao={`${primeiraMaiuscula(dataPorExtenso(hoje))}: resumo do dia e do que precisa de atenção.`}
        acoes={<>
          <a href="#/agenda" className="botao botao-secundario"><CalendarDays size={18} />Abrir agenda</a>
          <button type="button" onClick={() => setNovo(true)} className="botao botao-primario"><Plus size={18} />Novo agendamento</button>
        </>} />

      {dados.erro ? <FalhaCarregamento mensagem={dados.erro} onTentar={dados.recarregar} /> : !dados.dados ? <Carregando texto="Carregando o resumo..." /> : (
        <div className="space-y-5">
          <section aria-label="Indicadores de hoje" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {INDICADORES.map(indicador => (
              <div key={indicador.filtro || 'total'} className={`rounded-xl border p-3 ${indicador.filtro === '' ? 'border-primary bg-accent-soft' : 'border-border bg-card'}`}>
                <span className="block text-2xl font-bold leading-none">{contar(indicador.filtro)}</span>
                <span className="mt-1 block text-xs font-semibold text-muted-foreground">{indicador.rotulo}</span>
              </div>
            ))}
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Cartao titulo="Próximos atendimentos de hoje" acao={<a href="#/agenda" className="botao botao-texto botao-pequeno">Ver agenda<ChevronRight size={16} /></a>}>
                {proximos.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nenhum outro atendimento previsto para hoje.</p> : (
                  <ul className="divide-y divide-border">
                    {proximos.slice(0, 8).map(item => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                        <span className="w-24 shrink-0 text-sm font-bold tabular-nums">{item.horaInicio}–{item.horaFim}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{item.clienteNome}</span>
                          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.profissionalCor }} aria-hidden="true" />
                            {item.servicoNome} · {item.profissionalNome}{item.encaixe ? ' · Encaixe' : ''}
                          </span>
                        </span>
                        <SeloStatus status={item.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {proximos.length > 8 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">E mais {proximos.length - 8} atendimento(s) hoje. Veja todos na agenda.</p>}
              </Cartao>

              <Cartao titulo={`Próximos ${DIAS_A_FRENTE} dias`}>
                <ul className="space-y-2 p-4">
                  {porDia.map(d => (
                    <li key={d.data} className="flex items-center gap-3 text-sm">
                      <span className={`w-20 shrink-0 ${d.data === hoje ? 'font-bold' : 'text-muted-foreground'}`}>{d.data === hoje ? 'Hoje' : `${primeiraMaiuscula(nomeDoDia(d.data))} ${diaMes(d.data)}`}</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${(d.total / maiorDia) * 100}%` }} />
                      </span>
                      <span className="w-28 shrink-0 text-right tabular-nums">{d.total} {d.total === 1 ? 'atendimento' : 'atendimentos'}</span>
                    </li>
                  ))}
                </ul>
              </Cartao>
            </div>

            <div className="space-y-5">
              <Cartao titulo="Pendências" acao={<button type="button" onClick={dados.recarregar} disabled={dados.carregando} className="botao botao-texto botao-pequeno" aria-label="Atualizar o resumo"><RefreshCw size={16} className={dados.carregando ? 'animate-spin' : ''} /></button>}>
                <ul className="divide-y divide-border">
                  <Pendencia icone={MessageCircle} quantidade={semAviso.length} destino="#/agenda"
                    texto="sem mensagem enviada para hoje ou amanhã" detalhe={desatualizadas.length ? `${desatualizadas.length} com mensagem desatualizada após reagendar` : undefined} />
                  {dados.dados.espera !== null && <Pendencia icone={ListTodo} quantidade={dados.dados.espera} destino="#/espera" texto="na lista de espera aguardando contato ou vaga" />}
                  {verPedidosSenha && dados.dados.pedidosSenha !== null && <Pendencia icone={KeyRound} quantidade={dados.dados.pedidosSenha} destino="#/usuarios" texto="pedido(s) de nova senha" />}
                </ul>
                {(dados.dados.espera === null || (verPedidosSenha && dados.dados.pedidosSenha === null)) && (
                  <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Parte das pendências não pôde ser carregada agora.</p>
                )}
              </Cartao>

              <Cartao titulo="Bloqueios de hoje">
                {bloqueiosHoje.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nenhum bloqueio de agenda hoje.</p> : (
                  <ul className="divide-y divide-border">
                    {bloqueiosHoje.map(b => (
                      <li key={b.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                        <Ban size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block font-semibold">{nomeProfissional(b.profissionalId)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {b.trecho.inicio === 0 && b.trecho.fim >= 24 * 60 ? 'Dia inteiro' : `${deMinutos(b.trecho.inicio)}–${deMinutos(Math.min(b.trecho.fim, 24 * 60))}`} · {b.motivo}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Cartao>
            </div>
          </div>
        </div>
      )}

      {novo && cadastros.dados && (
        <NovoAgendamentoModal dataInicial={hoje} inicial={{}} papel={perfil.papel} fuso={fuso} revisao={revisao}
          profissionais={cadastros.dados.profissionais} servicos={cadastros.dados.servicos} habilitacoes={cadastros.dados.habilitacoes}
          onFechar={() => setNovo(false)} onSalvo={mensagem => { setNovo(false); avisar(mensagem ?? 'Agendamento criado.'); dados.recarregar() }} />
      )}
      {novo && cadastros.erro && <div className="mt-4"><FalhaCarregamento mensagem={cadastros.erro} onTentar={cadastros.recarregar} /></div>}
    </div>
  )
}

function Cartao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="cartao overflow-hidden" aria-label={titulo}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-bold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  )
}

function Pendencia({ icone: Icone, quantidade, texto, detalhe, destino }: { icone: typeof ListTodo; quantidade: number; texto: string; detalhe?: string; destino: string }) {
  return (
    <li>
      <a href={destino} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent-soft">
        {quantidade === 0 ? <CheckCircle2 size={18} className="shrink-0 text-success" /> : <Icone size={18} className="shrink-0 text-primary" />}
        <span className="min-w-0 flex-1">
          <span className="font-bold">{quantidade}</span> <span className="text-muted-foreground">{texto}</span>
          {detalhe && <span className="block text-xs text-warning">{detalhe}</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
      </a>
    </li>
  )
}

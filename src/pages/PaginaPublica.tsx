import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Clock3, Loader2, MessageCircle, RefreshCw } from 'lucide-react'
import { Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { FaixaDemo } from '../demo/EntradaDemo'
import { agoraNoFuso, dataCurta, dataPorExtenso, gradeDoMes, mesPorExtenso, primeiraMaiuscula, somarDias, somarMeses } from '../lib/datas'
import { mensagemDeErro } from '../lib/erros'
import { modoDemo } from '../lib/modoDemo'
import { linkWhatsApp } from '../lib/telefone'
import { useCarregar } from '../lib/useCarregar'
import { configuracaoPublica, duracaoPublica, horariosDisponiveis, profissionaisPublicos, servicosPublicos, type HorarioDisponivel, type ServicoPublico } from '../services/publico'

export const AVISO_DISPONIBILIDADE = 'A disponibilidade pode mudar. A solicitação pelo WhatsApp não garante a vaga: o horário só fica reservado depois que a equipe registrar o agendamento e confirmar com você.'
export const SEM_PROFISSIONAIS = 'Não há profissionais disponíveis para este serviço. Entre em contato com a clínica.'

export const mensagemWhatsApp = (servico: string, profissional: string, data: string, hora: string) =>
  `Olá! Gostaria de agendar ${servico} com ${profissional}, em ${dataCurta(data)}, às ${hora}. Esse horário ainda está disponível?`

/**
 * Consulta pública de disponibilidade (visitante sem login). Usa as mesmas regras e dados da agenda
 * interna, pelas funções públicas do banco, que devolvem só o necessário. Não cria reservas nem
 * bloqueia horários: a solicitação segue pelo WhatsApp e a equipe revalida o horário ao gravar.
 */
export function PaginaPublica() {
  const config = useCarregar(configuracaoPublica, [])
  const servicos = useCarregar(servicosPublicos, [])
  const [servicoId, setServicoId] = useState('')
  const [profissionalId, setProfissionalId] = useState('')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [aviso, setAviso] = useState('')

  const fuso = config.dados?.fusoHorario ?? 'America/Sao_Paulo'
  const horizonte = config.dados?.horizonteDias ?? 30
  // limparAoMudar: ao trocar a seleção, a resposta anterior some na hora (e respostas atrasadas são ignoradas).
  const profissionais = useCarregar(() => servicoId ? profissionaisPublicos(servicoId) : Promise.resolve([]), [servicoId], { limparAoMudar: true })
  const horarios = useCarregar(() => {
    if (!servicoId || !profissionalId) return Promise.resolve([] as HorarioDisponivel[])
    const hoje = agoraNoFuso(fuso).data
    return horariosDisponiveis(servicoId, profissionalId, hoje, somarDias(hoje, horizonte))
  }, [servicoId, profissionalId, horizonte, fuso], { aoFocar: true, limparAoMudar: true })

  // Duração com a profissional escolhida (pode ser diferente da padrão do serviço). Não inclui a preparação interna.
  const duracao = useCarregar(() => servicoId && profissionalId ? duracaoPublica(servicoId, profissionalId) : Promise.resolve(null), [servicoId, profissionalId], { limparAoMudar: true })
  const servico = servicos.dados?.find(s => s.id === servicoId)
  const profissional = profissionais.dados?.find(p => p.id === profissionalId)
  const duracaoMinutos = duracao.dados ?? servico?.duracaoMinutos
  const porData = useMemo(() => {
    const mapa = new Map<string, string[]>()
    for (const h of horarios.dados ?? []) mapa.set(h.data, [...(mapa.get(h.data) ?? []), h.hora])
    return mapa
  }, [horarios.dados])
  const horasDoDia = data ? porData.get(data) ?? [] : []

  // Se uma atualização mostrar que o horário escolhido foi ocupado, a escolha é desfeita com aviso.
  useEffect(() => {
    if (!horarios.dados || !data) return
    if (hora && !horasDoDia.includes(hora)) { setHora(''); setAviso('O horário escolhido não está mais disponível. Escolha outro.') }
  }, [horarios.dados])

  // Cada escolha limpa as etapas seguintes.
  const escolherServico = (id: string) => { setServicoId(id); setProfissionalId(''); setData(''); setHora(''); setAviso('') }
  const escolherProfissional = (id: string) => { setProfissionalId(id); setData(''); setHora(''); setAviso('') }
  const escolherData = (dia: string) => { setData(dia); setHora(''); setAviso('') }
  const recomecar = () => escolherServico('')

  const solicitar = async () => {
    if (!servico || !profissional || !data || !hora || !config.dados?.whatsapp) return
    setVerificando(true)
    setAviso('')
    try {
      // Consulta novamente antes de abrir a conversa.
      const atuais = await horariosDisponiveis(servico.id, profissional.id, data, data)
      if (!atuais.some(h => h.data === data && h.hora === hora)) {
        setHora('')
        setAviso('Esse horário acabou de ficar indisponível. Escolha um novo horário.')
        horarios.recarregar()
        return
      }
      const texto = mensagemWhatsApp(servico.nome, profissional.nome, data, hora)
      window.open(`${linkWhatsApp(config.dados.whatsapp)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
    } catch (falha) {
      setAviso(`Não foi possível confirmar a disponibilidade agora. ${mensagemDeErro(falha)}`)
    } finally {
      setVerificando(false)
    }
  }

  const categorias = useMemo(() => {
    const mapa = new Map<string, ServicoPublico[]>()
    for (const s of servicos.dados ?? []) mapa.set(s.categoria ?? 'Outros', [...(mapa.get(s.categoria ?? 'Outros') ?? []), s])
    return [...mapa.entries()]
  }, [servicos.dados])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {modoDemo && <FaixaDemo />}
      <header className="border-b border-border bg-[rgb(255_253_249/.94)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/brand/clinica-beauty.svg" alt="Clínica Beauty" width="44" height="44" className="h-11 w-11 rounded-xl border border-border object-contain" />
            <div><div className="sobretitulo">Clínica Beauty</div><div className="text-sm text-muted-foreground">Consulta de horários</div></div>
          </div>
          <a href="#/" className="text-sm font-semibold text-primary hover:underline">Acesso da equipe</a>
        </div>
      </header>

      <main className="animar-pagina mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="titulo text-2xl sm:text-3xl">Horários disponíveis</h1>
          <p className="mt-2 text-sm text-muted-foreground">Escolha o serviço, a profissional, a data e o horário. A solicitação é enviada pelo WhatsApp da clínica, e a equipe confirma a reserva.</p>
          <p role="note" className="alerta-info mt-4">{AVISO_DISPONIBILIDADE}</p>
        </div>

        <Etapa numero={1} titulo="Serviço" resumo={servico ? `${servico.nome} · ${servico.duracaoMinutos} min` : undefined} acao={servico && <button type="button" onClick={recomecar} className="botao botao-texto botao-pequeno">Alterar</button>}>
          {servicos.erro ? <FalhaCarregamento mensagem={`Não foi possível carregar os serviços. ${servicos.erro}`} onTentar={servicos.recarregar} />
            : !servicos.dados ? <Carregando texto="Carregando serviços..." />
            : !servicos.dados.length ? <Vazio>Nenhum serviço disponível no momento. Entre em contato com a clínica.</Vazio>
            : (
              <div className="space-y-4">
                {categorias.map(([categoria, lista]) => (
                  <div key={categoria}>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{categoria}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {lista.map(s => (
                        <Opcao key={s.id} ativa={s.id === servicoId} onClick={() => escolherServico(s.id)}>
                          <span className="block font-bold">{s.nome}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={12} />{s.duracaoMinutos} min</span>
                        </Opcao>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </Etapa>

        {servicoId && (
          <Etapa numero={2} titulo="Profissional" resumo={profissional ? `${profissional.nome}${duracao.dados && duracao.dados !== servico?.duracaoMinutos ? ` · ${duracao.dados} min` : ''}` : undefined} acao={profissional && <button type="button" onClick={() => escolherProfissional('')} className="botao botao-texto botao-pequeno">Alterar</button>}>
            {profissionais.erro ? <FalhaCarregamento mensagem={`Não foi possível carregar as profissionais. ${profissionais.erro}`} onTentar={profissionais.recarregar} />
              : !profissionais.dados ? <Carregando texto="Carregando profissionais..." />
              : !profissionais.dados.length ? <p className="alerta-aviso">{SEM_PROFISSIONAIS}</p>
              : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {profissionais.dados.map(p => <Opcao key={p.id} ativa={p.id === profissionalId} onClick={() => escolherProfissional(p.id)}><span className="font-bold">{p.nome}</span></Opcao>)}
                </div>
              )}
          </Etapa>
        )}

        {profissionalId && (
          <Etapa numero={3} titulo="Data" resumo={data ? primeiraMaiuscula(dataPorExtenso(data)) : undefined}
            acao={<button type="button" onClick={horarios.recarregar} disabled={horarios.carregando} className="botao botao-texto botao-pequeno"><RefreshCw size={14} className={horarios.carregando ? 'animate-spin' : ''} />Atualizar</button>}>
            {horarios.erro ? <FalhaCarregamento mensagem={`Não foi possível consultar a agenda. Os horários não foram verificados. ${horarios.erro}`} onTentar={horarios.recarregar} />
              : !horarios.dados ? <Carregando texto="Consultando a agenda..." />
              : !porData.size ? <Vazio>Não há horários disponíveis nos próximos {horizonte} dias para este serviço com esta profissional. Entre em contato com a clínica.</Vazio>
              : <Calendario hoje={agoraNoFuso(fuso).data} ultimo={somarDias(agoraNoFuso(fuso).data, horizonte)} disponiveis={porData} selecionada={data} onEscolher={escolherData} />}
          </Etapa>
        )}

        {data && horarios.dados && (
          <Etapa numero={4} titulo="Horário" resumo={hora || undefined}>
            {!horasDoDia.length ? <Vazio>Os horários desta data acabaram de ser ocupados. Escolha outra data.</Vazio> : (
              <div className="flex flex-wrap gap-2">
                {horasDoDia.map(h => (
                  <button key={h} type="button" onClick={() => { setHora(h); setAviso('') }} aria-pressed={h === hora}
                    className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${h === hora ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary'}`}>{h}</button>
                ))}
              </div>
            )}
          </Etapa>
        )}

        {aviso && <p role="alert" className="alerta-erro">{aviso}</p>}

        {hora && servico && profissional && (
          <section className="cartao space-y-4 p-5">
            <h2 className="titulo text-xl">Resumo da solicitação</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Item rotulo="Serviço">{servico.nome} ({duracaoMinutos} min)</Item>
              <Item rotulo="Profissional">{profissional.nome}</Item>
              <Item rotulo="Data">{primeiraMaiuscula(dataPorExtenso(data))}</Item>
              <Item rotulo="Horário">{hora}</Item>
            </dl>
            <p className="text-sm text-muted-foreground">Ao tocar no botão, abrimos o WhatsApp com a mensagem pronta. A reserva só existe depois que a equipe responder confirmando.</p>
            <p className="alerta-info">{AVISO_DISPONIBILIDADE}</p>
            <button type="button" onClick={solicitar} disabled={verificando || !config.dados?.whatsapp} className="botao botao-primario w-full sm:w-auto">
              {verificando ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}Solicitar pelo WhatsApp
            </button>
            {config.erro && <p className="alerta-erro">Não foi possível carregar o contato da clínica. Recarregue a página.</p>}
            {config.dados && !config.dados.whatsapp && <p className="alerta-aviso">O WhatsApp da clínica ainda não foi configurado pela administração.</p>}
          </section>
        )}
      </main>
    </div>
  )
}

/** Calendário mensal: só ficam habilitadas as datas com ao menos um horário que comporta o serviço. */
function Calendario({ hoje, ultimo, disponiveis, selecionada, onEscolher }: { hoje: string; ultimo: string; disponiveis: Map<string, string[]>; selecionada: string; onEscolher: (data: string) => void }) {
  const primeiraComHorario = [...disponiveis.keys()][0] ?? hoje
  const [mes, setMes] = useState(primeiraComHorario.slice(0, 7))
  const dias = gradeDoMes(`${mes}-01`)
  const podeVoltar = mes > hoje.slice(0, 7)
  const podeAvancar = mes < ultimo.slice(0, 7)

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => setMes(somarMeses(`${mes}-01`, -1).slice(0, 7))} disabled={!podeVoltar} aria-label="Mês anterior" className="botao botao-texto botao-pequeno"><ChevronLeft size={18} /></button>
        <span className="text-sm font-bold">{primeiraMaiuscula(mesPorExtenso(`${mes}-01`))}</span>
        <button type="button" onClick={() => setMes(somarMeses(`${mes}-01`, 1).slice(0, 7))} disabled={!podeAvancar} aria-label="Próximo mês" className="botao botao-texto botao-pequeno"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold uppercase text-muted-foreground">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map(dia => {
          const doMes = dia.startsWith(mes)
          const livre = doMes && disponiveis.has(dia)
          const marcada = dia === selecionada
          return (
            <button key={dia} type="button" disabled={!livre} onClick={() => onEscolher(dia)} aria-pressed={marcada}
              aria-label={`${primeiraMaiuscula(dataPorExtenso(dia))}${livre ? `, ${disponiveis.get(dia)!.length} horário(s)` : ', sem horários'}`}
              className={`aspect-square min-h-10 rounded-lg text-sm font-bold ${!doMes ? 'invisible' : marcada ? 'bg-primary text-primary-foreground' : livre ? 'border border-primary/40 bg-accent-soft text-foreground hover:border-primary' : 'text-muted-foreground/50 line-through decoration-1'}`}>
              {Number(dia.slice(8))}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Datas em destaque têm ao menos um horário para a duração completa do serviço.</p>
    </div>
  )
}

function Etapa({ numero, titulo, resumo, acao, children }: { numero: number; titulo: string; resumo?: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="cartao p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-bold">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm text-primary-foreground">{numero}</span>
          <span className="truncate">{titulo}{resumo && <span className="font-semibold text-primary"> · {resumo}</span>}</span>
        </h2>
        {acao}
      </div>
      {children}
    </section>
  )
}

function Opcao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativa}
      className={`min-h-12 rounded-xl border p-3 text-left text-sm transition ${ativa ? 'border-primary bg-accent-soft' : 'border-border bg-card hover:border-primary'}`}>
      {children}
    </button>
  )
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase text-muted-foreground">{rotulo}</dt><dd className="font-semibold">{children}</dd></div>
}

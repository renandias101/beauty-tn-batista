import { useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, History, Loader2, MessageCircle, Pencil, ShieldAlert, XCircle } from 'lucide-react'
import { ehEquipe } from '../../auth/Sessao'
import { pode } from '../../lib/permissoes'
import { SeloStatus } from '../../components/Basicos'
import { Modal } from '../../components/Modal'
import { dataPorExtenso, primeiraMaiuscula } from '../../lib/datas'
import { dicaDoErro, mensagemDeErro } from '../../lib/erros'
import { LISTA_STATUS, PROXIMOS_STATUS, STATUS, ocupaPeriodo, podeCancelar, podeReagendar } from '../../lib/status'
import { linkWhatsApp } from '../../lib/telefone'
import { alterarStatus, cancelarAgendamento, corrigirStatus, editarAgendamento, reagendarAgendamento, type DadosReagendamento } from '../../services/agenda'
import { duracaoEfetiva } from '../../services/cadastros'
import type { Habilitacao, ItemAgenda, Papel, Profissional, Servico, StatusAgendamento } from '../../types'
import { HistoricoAgendamento } from './HistoricoAgendamento'
import { MensagensWhatsApp } from './MensagensWhatsApp'
import { SeletorHorario } from './SeletorHorario'
import { VinculosAgendamento } from './VinculosAgendamento'

/** Período que deixou de estar ocupado (cancelamento ou reagendamento), usado para sugerir a lista de espera. */
export interface VagaLiberada { profissionalId: string; profissionalNome: string; data: string; horaInicio: string; inicio: string; ocupadoAte: string }

interface Props {
  /** Versão mais recente do agendamento na agenda (atualizada quando outra pessoa altera). */
  item: ItemAgenda
  papel: Papel
  profissionais: Profissional[]
  servicos: Servico[]
  habilitacoes: Habilitacao[]
  fuso: string
  revisao?: number
  onAlterado: (mensagem: string, vaga?: VagaLiberada) => void
  onRecarregar: () => void
  onFechar: () => void
}

type Modo = 'detalhes' | 'reagendar' | 'cancelar' | 'editar' | 'historico' | 'corrigir'

export function DetalhesAgendamentoModal({ item, papel, profissionais, servicos, habilitacoes, fuso, revisao, onAlterado, onRecarregar, onFechar }: Props) {
  const [modo, setModo] = useState<Modo>('detalhes')
  const [statusPendente, setStatusPendente] = useState<{ status: StatusAgendamento; acao: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [versaoDesatualizada, setVersaoDesatualizada] = useState(false)
  const [conflitoCliente, setConflitoCliente] = useState(false)
  // Versão vista ao abrir: as gravações a enviam ao servidor, que recusa se outra pessoa tiver alterado antes.
  const [versaoBase, setVersaoBase] = useState(item.versao)
  const alteradoPorOutro = item.versao !== versaoBase
  const equipe = ehEquipe(papel)
  const vaga: VagaLiberada = { profissionalId: item.profissionalId, profissionalNome: item.profissionalNome, data: item.data, horaInicio: item.horaInicio, inicio: item.inicio, ocupadoAte: item.ocupadoAte }

  const executar = async (acao: () => Promise<void>, mensagem: string, liberaVaga = false) => {
    if (salvando) return
    setSalvando(true)
    setErro('')
    setVersaoDesatualizada(false)
    try {
      await acao()
      onAlterado(mensagem, liberaVaga && Date.parse(vaga.inicio) > Date.now() ? vaga : undefined)
    } catch (falha) {
      const dica = dicaDoErro(falha)
      setVersaoDesatualizada(dica === 'versao_desatualizada')
      setConflitoCliente(dica === 'conflito_cliente')
      if (dica === 'versao_desatualizada') onRecarregar()
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const titulos: Record<Modo, string> = { detalhes: 'Agendamento', reagendar: 'Reagendar', cancelar: 'Cancelar agendamento', editar: 'Editar observação', historico: 'Histórico de alterações', corrigir: 'Corrigir status' }
  const voltar = () => { setModo('detalhes'); setErro(''); setConflitoCliente(false) }
  // Falta só pode ser registrada depois do horário previsto (seção 6).
  const proximos = PROXIMOS_STATUS[item.status].filter(p => p.status !== 'faltou' || Date.now() >= Date.parse(item.inicio))
  const usarVersaoAtual = () => { setVersaoBase(item.versao); setVersaoDesatualizada(false); setErro('') }

  // Aviso de edição concorrente: os campos preenchidos são mantidos; o usuário revisa antes de salvar.
  const avisoVersao = (alteradoPorOutro || versaoDesatualizada) && (
    <div role="alert" className="alerta-aviso mb-4 flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
        {alteradoPorOutro ? 'Outra pessoa alterou este agendamento enquanto ele estava aberto. Os dados acima já são os atuais; o que você preencheu foi mantido.' : 'A agenda está sendo atualizada com a versão mais recente.'}
      </span>
      {alteradoPorOutro && <button type="button" onClick={usarVersaoAtual} className="botao botao-secundario botao-pequeno">Revisei, continuar</button>}
    </div>
  )

  return (
    <Modal titulo={titulos[modo]} descricao={`${item.clienteNome} · ${item.servicoNome}`} onFechar={onFechar} bloqueado={salvando} largura="lg">
      {avisoVersao}
      {modo === 'detalhes' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <SeloStatus status={item.status} />
            {item.encaixe && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-secondary-foreground">Encaixe</span>}
            {item.excecaoConflitoCliente && <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning"><ShieldAlert size={12} />Exceção de conflito autorizada</span>}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Dado rotulo="Cliente">{item.clienteNome}</Dado>
            {item.clienteTelefone && (
              <Dado rotulo="Telefone">
                <a href={linkWhatsApp(item.clienteTelefone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-2 hover:underline"><MessageCircle size={15} />{item.clienteTelefone}</a>
              </Dado>
            )}
            <Dado rotulo="Serviço">{item.servicoNome}</Dado>
            <Dado rotulo="Profissional"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.profissionalCor }} />{item.profissionalNome}</span></Dado>
            <Dado rotulo="Data">{primeiraMaiuscula(dataPorExtenso(item.data))}</Dado>
            <Dado rotulo="Horário">
              {item.horaInicio} – {item.horaFim} ({item.duracaoMinutos} min)
              {item.preparacaoMinutos > 0 && <span className="block text-xs text-muted-foreground">Preparação até {item.horaOcupadoAte} ({item.preparacaoMinutos} min)</span>}
            </Dado>
            {item.recursos && <Dado rotulo="Recursos reservados">{item.recursos}</Dado>}
            {item.observacao && <Dado rotulo="Observação" largo>{item.observacao}</Dado>}
            {item.motivoCancelamento && <Dado rotulo="Motivo do cancelamento" largo>{item.motivoCancelamento}</Dado>}
            {item.excecaoConflitoCliente && <Dado rotulo="Justificativa da exceção" largo>{item.excecaoConflitoCliente}</Dado>}
          </dl>

          {equipe && (item.grupoId || item.serieId) && <VinculosAgendamento item={item} papel={papel} profissionais={profissionais} habilitacoes={habilitacoes} onAlterado={mensagem => onAlterado(mensagem)} />}

          {equipe && item.clienteTelefone && pode(papel, 'registrarComunicacoes') && <MensagensWhatsApp item={item} onRegistrado={onRecarregar} />}

          {equipe && (
            <>
              {statusPendente ? (
                <div className="alerta-info flex flex-wrap items-center justify-between gap-3">
                  <span>Confirmar: <strong>{statusPendente.acao.toLowerCase()}</strong>?</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStatusPendente(null)} disabled={salvando} className="botao botao-texto botao-pequeno">Voltar</button>
                    <button type="button" disabled={salvando} className="botao botao-primario botao-pequeno"
                      onClick={() => executar(() => alterarStatus(item.id, statusPendente.status, versaoBase), `${statusPendente.acao}: registrado.`, statusPendente.status === 'faltou')}>
                      {salvando && <Loader2 size={14} className="animate-spin" />}Sim, registrar
                    </button>
                  </div>
                </div>
              ) : proximos.length > 0 && (
                <div>
                  <div className="rotulo mb-2">Andamento</div>
                  <div className="flex flex-wrap gap-2">
                    {proximos.map(p => <button key={p.status} type="button" onClick={() => { setErro(''); setStatusPendente(p) }} className="botao botao-secundario botao-pequeno">{p.acao}</button>)}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {podeReagendar(item.status) && <button type="button" onClick={() => setModo('reagendar')} className="botao botao-texto botao-pequeno"><CalendarClock size={16} />{item.grupoId ? 'Reagendar só este serviço' : item.serieId ? 'Reagendar só esta ocorrência' : 'Reagendar'}</button>}
                {item.status !== 'cancelado' && <button type="button" onClick={() => setModo('editar')} className="botao botao-texto botao-pequeno"><Pencil size={16} />Editar observação</button>}
                {pode(papel, 'verHistoricoAgendamento') && <button type="button" onClick={() => setModo('historico')} className="botao botao-texto botao-pequeno"><History size={16} />Histórico</button>}
                {pode(papel, 'corrigirStatus') && <button type="button" onClick={() => setModo('corrigir')} className="botao botao-texto botao-pequeno"><ShieldAlert size={16} />Corrigir status</button>}
                {podeCancelar(item.status) && <button type="button" onClick={() => setModo('cancelar')} className="botao botao-texto botao-pequeno ml-auto text-error"><XCircle size={16} />{item.grupoId ? 'Cancelar só este serviço' : item.serieId ? 'Cancelar só esta ocorrência' : 'Cancelar agendamento'}</button>}
              </div>
            </>
          )}
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        </div>
      )}

      {modo === 'reagendar' && (
        <FormReagendar item={item} papel={papel} profissionais={profissionais} servicos={servicos} habilitacoes={habilitacoes} fuso={fuso} revisao={revisao}
          salvando={salvando} erro={erro} conflitoCliente={conflitoCliente} onVoltar={voltar}
          onSalvar={dados => executar(() => reagendarAgendamento(item.id, dados, versaoBase), 'Agendamento reagendado. Avise a cliente sobre o novo horário.', true)} />
      )}

      {modo === 'cancelar' && <FormCancelar salvando={salvando} erro={erro} onVoltar={voltar} onSalvar={motivo => executar(() => cancelarAgendamento(item.id, motivo, versaoBase), 'Agendamento cancelado. O horário foi liberado.', true)} />}

      {modo === 'editar' && (
        <FormEditar item={item} salvando={salvando} erro={erro} onVoltar={voltar}
          onSalvar={(observacao, encaixe) => executar(() => editarAgendamento(item.id, observacao, encaixe, versaoBase), 'Agendamento atualizado.')} />
      )}

      {modo === 'corrigir' && (
        <FormCorrigir item={item} salvando={salvando} erro={erro} onVoltar={voltar}
          onSalvar={(status, justificativa) => executar(() => corrigirStatus(item.id, status, justificativa, versaoBase), 'Status corrigido. A correção ficou registrada no histórico.', !ocupaPeriodo(status) && ocupaPeriodo(item.status))} />
      )}

      {modo === 'historico' && (
        <div className="space-y-4">
          <HistoricoAgendamento agendamentoId={item.id} fuso={fuso} />
          <div className="flex justify-end"><button type="button" onClick={voltar} className="botao botao-texto">Voltar</button></div>
        </div>
      )}
    </Modal>
  )
}

function Dado({ rotulo, children, largo }: { rotulo: string; children: ReactNode; largo?: boolean }) {
  return <div className={largo ? 'sm:col-span-2' : ''}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</dt><dd className="mt-1 text-sm font-medium">{children}</dd></div>
}

function Botoes({ salvando, onVoltar, rotulo, perigo }: { salvando: boolean; onVoltar: () => void; rotulo: string; perigo?: boolean }) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button type="button" onClick={onVoltar} disabled={salvando} className="botao botao-texto">Voltar</button>
      <button type="submit" disabled={salvando} className={`botao ${perigo ? 'botao-perigo' : 'botao-primario'}`}>{salvando && <Loader2 size={16} className="animate-spin" />}{rotulo}</button>
    </div>
  )
}

function FormReagendar({ item, papel, profissionais, servicos, habilitacoes, fuso, revisao, salvando, erro, conflitoCliente, onVoltar, onSalvar }: {
  item: ItemAgenda; papel: Papel; profissionais: Profissional[]; servicos: Servico[]; habilitacoes: Habilitacao[]; fuso: string; revisao?: number
  salvando: boolean; erro: string; conflitoCliente: boolean; onVoltar: () => void; onSalvar: (dados: DadosReagendamento) => void
}) {
  const [data, setData] = useState(item.data)
  const [hora, setHora] = useState('')
  const [profissionalId, setProfissionalId] = useState(item.profissionalId)
  const [duracao, setDuracao] = useState(String(item.duracaoMinutos))
  const [motivo, setMotivo] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [aviso, setAviso] = useState('')
  const habilitados = profissionais.filter(p => p.ativo && habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === item.servicoId))
  const ajustaDuracao = pode(papel, 'ajustarDuracaoReserva')
  // Mesmo profissional: mantém a duração gravada; outro profissional: duração efetiva dele.
  const duracaoPadrao = (id: string) => id === item.profissionalId ? item.duracaoMinutos : duracaoEfetiva(servicos.find(s => s.id === item.servicoId), habilitacoes, id)
  const duracaoMinutos = ajustaDuracao ? Number(duracao) || 0 : duracaoPadrao(profissionalId)

  const trocarProfissional = (id: string) => { setProfissionalId(id); setDuracao(String(duracaoPadrao(id))); setHora('') }

  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (!hora) { setAviso('Escolha o novo horário.'); return }
    if (motivo.trim().length < 3) { setAviso('Informe o motivo do reagendamento.'); return }
    if (duracaoMinutos <= 0) { setAviso('A duração deve ser maior que zero.'); return }
    setAviso('')
    onSalvar({ data, hora, profissionalId, motivo: motivo.trim(), duracaoMinutos: ajustaDuracao ? duracaoMinutos : undefined, justificativaConflito: justificativa })
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="alerta-info">Atual: {dataPorExtenso(item.data)}, {item.horaInicio} – {item.horaFim} com {item.profissionalNome}. O horário atual só é liberado depois que o novo for gravado.</p>
      <label className="rotulo">Profissional
        <select className="campo" value={profissionalId} onChange={e => trocarProfissional(e.target.value)}>
          {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      {ajustaDuracao && (
        <label className="rotulo">Duração da reserva (minutos)
          <input className="campo" type="number" min={1} max={720} value={duracao} onChange={e => { setDuracao(e.target.value); setHora('') }} />
          <span className="mt-1 block font-normal">A preparação gravada na reserva ({item.preparacaoMinutos} min) é mantida.</span>
        </label>
      )}
      <SeletorHorario servicoId={item.servicoId} profissionalId={profissionalId} duracaoMinutos={duracaoMinutos} preparacaoMinutos={item.preparacaoMinutos} fuso={fuso} data={data} hora={hora}
        onData={valor => { setData(valor); setHora('') }} onHora={setHora} ignorarId={item.id} duracaoAjustada={ajustaDuracao && duracaoMinutos !== duracaoPadrao(profissionalId) ? duracaoMinutos : undefined} revisao={revisao} />
      <label className="rotulo">Motivo do reagendamento<textarea className="campo resize-none" rows={2} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      {(aviso || erro) && <p role="alert" className="alerta-erro">{aviso || erro}</p>}
      {conflitoCliente && pode(papel, 'autorizarConflitoCliente') && (
        <label className="rotulo">Justificativa da exceção (administração)
          <textarea className="campo resize-none" rows={2} maxLength={300} value={justificativa} onChange={e => setJustificativa(e.target.value)} />
          <span className="mt-1 block font-normal">A exceção fica registrada no histórico com seu nome. Confirme novamente para gravar.</span>
        </label>
      )}
      <Botoes salvando={salvando} onVoltar={onVoltar} rotulo="Confirmar reagendamento" />
    </form>
  )
}

function FormCancelar({ salvando, erro, onVoltar, onSalvar }: { salvando: boolean; erro: string; onVoltar: () => void; onSalvar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState('')
  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (motivo.trim().length < 3) { setAviso('Informe o motivo do cancelamento.'); return }
    onSalvar(motivo.trim())
  }
  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-muted-foreground">O registro é preservado com responsável, data, hora e motivo, e o horário fica livre para novas reservas.</p>
      <label className="rotulo">Motivo do cancelamento<textarea className="campo resize-none" rows={3} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      {(aviso || erro) && <p role="alert" className="alerta-erro">{aviso || erro}</p>}
      <Botoes salvando={salvando} onVoltar={onVoltar} rotulo="Cancelar agendamento" perigo />
    </form>
  )
}

function FormEditar({ item, salvando, erro, onVoltar, onSalvar }: { item: ItemAgenda; salvando: boolean; erro: string; onVoltar: () => void; onSalvar: (observacao: string, encaixe: boolean) => void }) {
  const [observacao, setObservacao] = useState(item.observacao ?? '')
  const [encaixe, setEncaixe] = useState(item.encaixe)
  return (
    <form onSubmit={evento => { evento.preventDefault(); onSalvar(observacao.trim(), encaixe) }} className="space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={encaixe} onChange={e => setEncaixe(e.target.checked)} />Identificar como encaixe</label>
      <label className="rotulo">Observação operacional
        <textarea className="campo resize-none" rows={3} maxLength={500} value={observacao} onChange={e => setObservacao(e.target.value)} />
        <span className="mt-1 block font-normal">Não registre dados clínicos ou de saúde.</span>
      </label>
      {erro && <p role="alert" className="alerta-erro">{erro}</p>}
      <Botoes salvando={salvando} onVoltar={onVoltar} rotulo="Salvar" />
    </form>
  )
}

/** Correção administrativa: qualquer status marcado por engano, com justificativa obrigatória e histórico. */
function FormCorrigir({ item, salvando, erro, onVoltar, onSalvar }: { item: ItemAgenda; salvando: boolean; erro: string; onVoltar: () => void; onSalvar: (status: StatusAgendamento, justificativa: string) => void }) {
  const opcoes = LISTA_STATUS.filter(s => s !== item.status)
  const [status, setStatus] = useState<StatusAgendamento>(opcoes[0])
  const [justificativa, setJustificativa] = useState('')
  const [aviso, setAviso] = useState('')
  const voltaAOcupar = ocupaPeriodo(status) && !ocupaPeriodo(item.status)

  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (justificativa.trim().length < 3) { setAviso('Informe a justificativa da correção.'); return }
    setAviso('')
    onSalvar(status, justificativa.trim())
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-muted-foreground">Use somente para corrigir um registro feito por engano. O status anterior, o novo, o responsável, a data e a justificativa ficam no histórico.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span>Status atual:</span><SeloStatus status={item.status} /></div>
      <label className="rotulo">Status correto
        <select className="campo" value={status} onChange={e => setStatus(e.target.value as StatusAgendamento)}>
          {opcoes.map(s => <option key={s} value={s}>{STATUS[s].rotulo}</option>)}
        </select>
      </label>
      {voltaAOcupar && <p className="alerta-info">Este status volta a ocupar o horário: o servidor confere de novo bloqueios, outras reservas do profissional, recursos e a agenda da cliente.</p>}
      {status === 'cancelado' && <p className="alerta-info">A justificativa será registrada como motivo do cancelamento, com seu nome e a data de hoje.</p>}
      {item.status === 'cancelado' && <p className="alerta-info">Os dados do cancelamento deixam o registro e continuam preservados no histórico.</p>}
      <label className="rotulo">Justificativa<textarea className="campo resize-none" rows={3} maxLength={300} required value={justificativa} onChange={e => setJustificativa(e.target.value)} /></label>
      {(aviso || erro) && <p role="alert" className="alerta-erro">{aviso || erro}</p>}
      <Botoes salvando={salvando} onVoltar={onVoltar} rotulo="Corrigir status" />
    </form>
  )
}

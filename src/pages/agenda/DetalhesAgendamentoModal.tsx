import { useState, type FormEvent, type ReactNode } from 'react'
import { CalendarClock, History, Loader2, MessageCircle, Pencil, XCircle } from 'lucide-react'
import { ehEquipe } from '../../auth/Sessao'
import { pode } from '../../lib/permissoes'
import { SeloStatus } from '../../components/Basicos'
import { Modal } from '../../components/Modal'
import { dataPorExtenso, primeiraMaiuscula } from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { PROXIMOS_STATUS, podeCancelar, podeReagendar } from '../../lib/status'
import { linkWhatsApp } from '../../lib/telefone'
import { alterarStatus, cancelarAgendamento, editarAgendamento, reagendarAgendamento } from '../../services/agenda'
import type { Habilitacao, ItemAgenda, Papel, Profissional, StatusAgendamento } from '../../types'
import { HistoricoAgendamento } from './HistoricoAgendamento'
import { SeletorHorario } from './SeletorHorario'

interface Props {
  item: ItemAgenda
  papel: Papel
  profissionais: Profissional[]
  habilitacoes: Habilitacao[]
  fuso: string
  onAlterado: (mensagem: string) => void
  onFechar: () => void
}

type Modo = 'detalhes' | 'reagendar' | 'cancelar' | 'editar' | 'historico'

export function DetalhesAgendamentoModal({ item, papel, profissionais, habilitacoes, fuso, onAlterado, onFechar }: Props) {
  const [modo, setModo] = useState<Modo>('detalhes')
  const [statusPendente, setStatusPendente] = useState<{ status: StatusAgendamento; acao: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const equipe = ehEquipe(papel)

  const executar = async (acao: () => Promise<void>, mensagem: string) => {
    if (salvando) return
    setSalvando(true)
    setErro('')
    try {
      await acao()
      onAlterado(mensagem)
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const titulos: Record<Modo, string> = { detalhes: 'Agendamento', reagendar: 'Reagendar', cancelar: 'Cancelar agendamento', editar: 'Editar observação', historico: 'Histórico de alterações' }
  const voltar = () => { setModo('detalhes'); setErro('') }
  // Falta só pode ser registrada depois do horário previsto (seção 6).
  const proximos = PROXIMOS_STATUS[item.status].filter(p => p.status !== 'faltou' || Date.now() >= Date.parse(item.inicio))

  return (
    <Modal titulo={titulos[modo]} descricao={`${item.clienteNome} · ${item.servicoNome}`} onFechar={onFechar} bloqueado={salvando} largura="lg">
      {modo === 'detalhes' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><SeloStatus status={item.status} />{item.encaixe && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-secondary-foreground">Encaixe</span>}</div>
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
            <Dado rotulo="Horário">{item.horaInicio} – {item.horaFim} ({item.duracaoMinutos} min)</Dado>
            {item.observacao && <Dado rotulo="Observação" largo>{item.observacao}</Dado>}
            {item.motivoCancelamento && <Dado rotulo="Motivo do cancelamento" largo>{item.motivoCancelamento}</Dado>}
          </dl>

          {equipe && (
            <>
              {statusPendente ? (
                <div className="alerta-info flex flex-wrap items-center justify-between gap-3">
                  <span>Confirmar: <strong>{statusPendente.acao.toLowerCase()}</strong>?</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStatusPendente(null)} disabled={salvando} className="botao botao-texto botao-pequeno">Voltar</button>
                    <button type="button" disabled={salvando} className="botao botao-primario botao-pequeno"
                      onClick={() => executar(() => alterarStatus(item.id, statusPendente.status), `${statusPendente.acao}: registrado.`)}>
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
                {podeReagendar(item.status) && <button type="button" onClick={() => setModo('reagendar')} className="botao botao-texto botao-pequeno"><CalendarClock size={16} />Reagendar</button>}
                {item.status !== 'cancelado' && <button type="button" onClick={() => setModo('editar')} className="botao botao-texto botao-pequeno"><Pencil size={16} />Editar observação</button>}
                {pode(papel, 'verHistoricoAgendamento') && <button type="button" onClick={() => setModo('historico')} className="botao botao-texto botao-pequeno"><History size={16} />Histórico</button>}
                {podeCancelar(item.status) && <button type="button" onClick={() => setModo('cancelar')} className="botao botao-texto botao-pequeno ml-auto text-error"><XCircle size={16} />Cancelar agendamento</button>}
              </div>
            </>
          )}
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        </div>
      )}

      {modo === 'reagendar' && (
        <FormReagendar item={item} papel={papel} profissionais={profissionais} habilitacoes={habilitacoes} fuso={fuso} salvando={salvando} erro={erro} onVoltar={voltar}
          onSalvar={dados => executar(() => reagendarAgendamento(item.id, dados), 'Agendamento reagendado.')} />
      )}

      {modo === 'cancelar' && <FormCancelar salvando={salvando} erro={erro} onVoltar={voltar} onSalvar={motivo => executar(() => cancelarAgendamento(item.id, motivo), 'Agendamento cancelado. O horário foi liberado.')} />}

      {modo === 'editar' && (
        <FormEditar item={item} salvando={salvando} erro={erro} onVoltar={voltar}
          onSalvar={(observacao, encaixe) => executar(() => editarAgendamento(item.id, observacao, encaixe), 'Agendamento atualizado.')} />
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

function FormReagendar({ item, papel, profissionais, habilitacoes, fuso, salvando, erro, onVoltar, onSalvar }: {
  item: ItemAgenda; papel: Papel; profissionais: Profissional[]; habilitacoes: Habilitacao[]; fuso: string; salvando: boolean; erro: string
  onVoltar: () => void; onSalvar: (dados: { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number }) => void
}) {
  const [data, setData] = useState(item.data)
  const [hora, setHora] = useState('')
  const [profissionalId, setProfissionalId] = useState(item.profissionalId)
  const [duracao, setDuracao] = useState(String(item.duracaoMinutos))
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState('')
  const habilitados = profissionais.filter(p => p.ativo && habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === item.servicoId))
  const duracaoMinutos = Number(duracao) || 0

  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (!hora) { setAviso('Escolha o novo horário.'); return }
    if (motivo.trim().length < 3) { setAviso('Informe o motivo do reagendamento.'); return }
    if (duracaoMinutos <= 0) { setAviso('A duração deve ser maior que zero.'); return }
    setAviso('')
    onSalvar({ data, hora, profissionalId, motivo: motivo.trim(), duracaoMinutos: pode(papel, 'ajustarDuracaoReserva') ? duracaoMinutos : undefined })
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="alerta-info">Atual: {dataPorExtenso(item.data)}, {item.horaInicio} – {item.horaFim} com {item.profissionalNome}. O horário atual só é liberado depois que o novo for gravado.</p>
      <label className="rotulo">Profissional
        <select className="campo" value={profissionalId} onChange={e => { setProfissionalId(e.target.value); setHora('') }}>
          {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      {pode(papel, 'ajustarDuracaoReserva') && (
        <label className="rotulo">Duração da reserva (minutos)
          <input className="campo" type="number" min={1} max={720} value={duracao} onChange={e => { setDuracao(e.target.value); setHora('') }} />
        </label>
      )}
      <SeletorHorario profissionalId={profissionalId} duracaoMinutos={duracaoMinutos} fuso={fuso} data={data} hora={hora}
        onData={valor => { setData(valor); setHora('') }} onHora={setHora} ignorarId={item.id} />
      <label className="rotulo">Motivo do reagendamento<textarea className="campo resize-none" rows={2} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      {(aviso || erro) && <p role="alert" className="alerta-erro">{aviso || erro}</p>}
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

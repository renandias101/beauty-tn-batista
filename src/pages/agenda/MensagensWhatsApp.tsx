import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, Send } from 'lucide-react'
import { useAvisos } from '../../components/Avisos'
import { dataCurta, instanteNoFuso } from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { TIPOS_COMUNICACAO, linkMensagem, textoDaMensagem, tiposPermitidos } from '../../lib/mensagens'
import { useCarregar } from '../../lib/useCarregar'
import { novoUuid } from '../../lib/uuid'
import { usePerfil } from '../../auth/Sessao'
import { listarComunicacoes, registrarComunicacao } from '../../services/agenda'
import type { ItemAgenda, TipoComunicacao } from '../../types'

/**
 * Fluxo manual assistido: abre o WhatsApp com a mensagem pronta e, separadamente, registra o envio
 * quando a equipe confirma que enviou. Abrir o WhatsApp não registra nada.
 * "Mensagem enviada" (registro aqui) é diferente de "Presença confirmada" (status do agendamento).
 */
export function MensagensWhatsApp({ item, onRegistrado }: { item: ItemAgenda; onRegistrado: () => void }) {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const historico = useCarregar(() => listarComunicacoes(item.id), [item.id, item.versao])
  const [pendente, setPendente] = useState<{ tipo: TipoComunicacao; id: string } | null>(null)
  const [registrando, setRegistrando] = useState(false)
  const [erro, setErro] = useState('')
  const tipos = tiposPermitidos(item.status)
  const quando = (instante: string) => { const m = instanteNoFuso(instante, perfil.fusoHorario); return `${dataCurta(m.data)} às ${m.hora}` }
  const ultimaDoTipo = (tipo: TipoComunicacao) => historico.dados?.find(c => c.tipo === tipo && !c.desatualizada)

  if (!item.clienteTelefone || (!tipos.length && !item.ultimaComunicacao)) return null

  const abrir = (tipo: TipoComunicacao) => {
    window.open(linkMensagem(item.clienteTelefone!, textoDaMensagem(tipo, item)), '_blank', 'noopener,noreferrer')
    // O id é gerado agora: clicar duas vezes em "Registrar envio" não duplica o registro.
    setPendente({ tipo, id: novoUuid() })
    setErro('')
  }

  const registrar = async () => {
    if (!pendente || registrando) return
    setRegistrando(true)
    setErro('')
    try {
      await registrarComunicacao(pendente.id, item.id, pendente.tipo)
      avisar(`Envio registrado: ${TIPOS_COMUNICACAO[pendente.tipo].toLowerCase()}.`)
      setPendente(null)
      historico.recarregar()
      onRegistrado()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setRegistrando(false)
    }
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold"><MessageCircle size={16} className="text-primary" />Mensagens pelo WhatsApp</h3>
      <p className="mt-1 text-xs text-muted-foreground">A mensagem enviada é registrada aqui. A presença confirmada é o status do agendamento, registrado em Andamento quando a cliente responder.</p>

      <div className="mt-3 text-sm">
        {item.ultimaComunicacao
          ? <p><span className="font-semibold">Última mensagem enviada:</span> {TIPOS_COMUNICACAO[item.ultimaComunicacao.tipo]} em {quando(item.ultimaComunicacao.em)} por {item.ultimaComunicacao.por}</p>
          : <p className="text-muted-foreground">Nenhuma mensagem registrada para este agendamento.</p>}
        {item.comunicacaoDesatualizada && tipos.includes('reagendamento') && (
          <p className="alerta-aviso mt-2 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />O horário ou o profissional mudou depois da última mensagem. Envie o aviso de reagendamento à cliente.</p>
        )}
      </div>

      {tipos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tipos.map(tipo => {
            const enviada = ultimaDoTipo(tipo)
            return (
              <button key={tipo} type="button" onClick={() => abrir(tipo)} className="botao botao-secundario botao-pequeno" title={enviada ? `Já enviada em ${quando(enviada.registradoEm)}` : undefined}>
                <Send size={14} />{TIPOS_COMUNICACAO[tipo]}{enviada && <CheckCircle2 size={14} className="text-success" aria-label="já enviada" />}
              </button>
            )
          })}
        </div>
      )}

      {pendente && (
        <div className="alerta-info mt-3 space-y-2">
          <p>O WhatsApp foi aberto com a mensagem de <strong>{TIPOS_COMUNICACAO[pendente.tipo].toLowerCase()}</strong>. Abrir não registra o envio: confirme somente depois de enviar.</p>
          {ultimaDoTipo(pendente.tipo) && <p className="font-semibold">Atenção: esta mensagem já foi registrada em {quando(ultimaDoTipo(pendente.tipo)!.registradoEm)}. Evite repetir.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={registrar} disabled={registrando} className="botao botao-primario botao-pequeno">{registrando && <Loader2 size={14} className="animate-spin" />}Registrar envio</button>
            <button type="button" onClick={() => setPendente(null)} disabled={registrando} className="botao botao-texto botao-pequeno">Não enviei</button>
          </div>
        </div>
      )}
      {erro && <p role="alert" className="alerta-erro mt-2">{erro}</p>}

      {(historico.dados?.length ?? 0) > 1 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold">Envios registrados ({historico.dados!.length})</summary>
          <ul className="mt-2 space-y-1">
            {historico.dados!.map(c => <li key={c.id}>{TIPOS_COMUNICACAO[c.tipo]} · {quando(c.registradoEm)} · {c.registradoPor}{c.desatualizada ? ' · horário anterior' : ''}</li>)}
          </ul>
        </details>
      )}
    </section>
  )
}

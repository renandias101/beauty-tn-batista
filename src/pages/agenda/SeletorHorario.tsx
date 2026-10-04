import { Loader2 } from 'lucide-react'
import { agoraNoFuso, somarMinutos } from '../../lib/datas'
import { useHorariosLivres } from './useHorariosLivres'

interface Props {
  servicoId: string
  profissionalId: string
  /** Duração do atendimento (efetiva ou ajustada) e preparação, apenas para exibir o término previsto. */
  duracaoMinutos: number
  preparacaoMinutos: number
  fuso: string
  data: string
  hora: string
  onData: (data: string) => void
  onHora: (hora: string) => void
  ignorarId?: string
  /** Duração informada pela administração no reagendamento (substitui a efetiva). */
  duracaoAjustada?: number
  /** Muda quando a agenda é atualizada por outra pessoa, para recalcular as sugestões. */
  revisao?: number
}

/** Data, horário e sugestões de horários livres. A disponibilidade é revalidada no servidor ao salvar. */
export function SeletorHorario({ servicoId, profissionalId, duracaoMinutos, preparacaoMinutos, fuso, data, hora, onData, onHora, ignorarId, duracaoAjustada, revisao }: Props) {
  const { horarios, carregando, erro } = useHorariosLivres({ servicoId, profissionalId, data, ignorarId, duracaoMinutos: duracaoAjustada, versao: revisao })
  const agora = agoraNoFuso(fuso)
  const noPassado = Boolean(data && hora) && (data < agora.data || (data === agora.data && hora <= agora.hora))

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="rotulo">Data<input className="campo" type="date" required min={agora.data} value={data} onChange={e => onData(e.target.value)} /></label>
        <label className="rotulo">Horário de início<input className="campo" type="time" required step={300} value={hora} onChange={e => onHora(e.target.value)} /></label>
      </div>
      {hora && duracaoMinutos > 0 && (
        <p className="text-xs text-muted-foreground">
          Término previsto: {somarMinutos(hora, duracaoMinutos)} ({duracaoMinutos} min)
          {preparacaoMinutos > 0 && ` · agenda ocupada até ${somarMinutos(hora, duracaoMinutos + preparacaoMinutos)} pela preparação (${preparacaoMinutos} min)`}
        </p>
      )}
      {noPassado && <p className="alerta-erro">Este horário já passou. Não é possível agendar no passado.</p>}
      {servicoId && profissionalId && data && (
        <div>
          <div className="rotulo mb-2">Horários livres</div>
          {carregando ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Consultando a agenda...</p>
            : erro ? <p className="alerta-erro">{erro}</p>
            : horarios.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum horário livre nesta data para este serviço (jornada, bloqueios, reservas, preparação e recursos já considerados).</p>
            : (
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rolagem-fina">
                {horarios.map(valor => (
                  <button key={valor} type="button" onClick={() => onHora(valor)} aria-pressed={hora === valor}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${hora === valor ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary'}`}>
                    {valor}
                  </button>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  )
}

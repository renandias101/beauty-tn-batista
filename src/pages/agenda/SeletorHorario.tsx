import { Loader2 } from 'lucide-react'
import { agoraNoFuso, deMinutos, somarMinutos } from '../../lib/datas'
import { useHorariosLivres } from './useHorariosLivres'

interface Props {
  profissionalId: string
  duracaoMinutos: number
  fuso: string
  data: string
  hora: string
  onData: (data: string) => void
  onHora: (hora: string) => void
  ignorarId?: string
}

/** Data, horário e sugestões de horários livres. A disponibilidade é revalidada no servidor ao salvar. */
export function SeletorHorario({ profissionalId, duracaoMinutos, fuso, data, hora, onData, onHora, ignorarId }: Props) {
  const { horarios, carregando, erro, semJornada } = useHorariosLivres({ profissionalId, data, duracaoMinutos, fuso, ignorarId })
  const agora = agoraNoFuso(fuso)
  const noPassado = Boolean(data && hora) && (data < agora.data || (data === agora.data && hora < agora.hora))

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="rotulo">Data<input className="campo" type="date" required value={data} onChange={e => onData(e.target.value)} /></label>
        <label className="rotulo">Horário de início<input className="campo" type="time" required step={300} value={hora} onChange={e => onHora(e.target.value)} /></label>
      </div>
      {hora && duracaoMinutos > 0 && <p className="text-xs text-muted-foreground">Término previsto: {somarMinutos(hora, duracaoMinutos)} ({duracaoMinutos} min)</p>}
      {noPassado && <p className="alerta-aviso">Este horário já passou. Confira antes de salvar.</p>}
      {profissionalId && data && duracaoMinutos > 0 && (
        <div>
          <div className="rotulo mb-2">Horários livres</div>
          {carregando ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Consultando a agenda...</p>
            : erro ? <p className="alerta-erro">{erro}</p>
            : semJornada ? <p className="text-sm text-muted-foreground">O profissional não atende nesta data.</p>
            : horarios.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum horário livre para a duração deste serviço.</p>
            : (
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rolagem-fina">
                {horarios.map(minuto => {
                  const valor = deMinutos(minuto)
                  return (
                    <button key={minuto} type="button" onClick={() => onHora(valor)} aria-pressed={hora === valor}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${hora === valor ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary'}`}>
                      {valor}
                    </button>
                  )
                })}
              </div>
            )}
        </div>
      )}
    </div>
  )
}

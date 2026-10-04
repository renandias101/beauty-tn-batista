import { Ban, Clock3 } from 'lucide-react'
import { SeloStatus, Vazio } from '../../components/Basicos'
import { dataCompleta, diaMes, gradeDoMes, instanteNoFuso, nomeDoDia, primeiraMaiuscula, somarDias } from '../../lib/datas'
import type { Bloqueio, ItemAgenda, Profissional } from '../../types'

function CartaoAgendamento({ item, onAbrir, compacto }: { item: ItemAgenda; onAbrir: (item: ItemAgenda) => void; compacto?: boolean }) {
  const encerrado = item.status === 'cancelado' || item.status === 'faltou'
  return (
    <button type="button" onClick={() => onAbrir(item)} style={{ borderLeftColor: item.profissionalCor }}
      className={`w-full rounded-xl border border-l-4 border-border bg-muted text-left transition hover:border-accent hover:shadow-md ${compacto ? 'px-2.5 py-2' : 'p-4'} ${encerrado ? 'opacity-60' : ''}`}>
      {compacto ? (
        <>
          <div className={`text-xs font-bold ${item.status === 'cancelado' ? 'line-through' : ''}`}>{item.horaInicio} · {item.clienteNome}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.servicoNome}</div>
        </>
      ) : (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className={`text-base font-bold ${item.status === 'cancelado' ? 'line-through' : ''}`}>{item.clienteNome}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 size={14} />{item.horaInicio} – {item.horaFim} · {item.servicoNome}</div>
            <div className="mt-1 text-sm font-semibold text-muted-foreground">{item.profissionalNome}{item.encaixe ? ' · Encaixe' : ''}</div>
          </div>
          <SeloStatus status={item.status} />
        </div>
      )}
    </button>
  )
}

/** Visão diária: atendimentos agrupados por horário de início, em lista (legível no celular). */
export function VisaoDia({ itens, bloqueios, profissionais, data, fuso, onAbrir }: {
  itens: ItemAgenda[]; bloqueios: Bloqueio[]; profissionais: Profissional[]; data: string; fuso: string; onAbrir: (item: ItemAgenda) => void
}) {
  const grupos = new Map<string, ItemAgenda[]>()
  for (const item of itens) grupos.set(item.horaInicio, [...(grupos.get(item.horaInicio) ?? []), item])
  const nomeProfissional = (id: string) => profissionais.find(p => p.id === id)?.nome ?? 'Profissional'

  const periodoBloqueio = (b: Bloqueio) => {
    const de = instanteNoFuso(b.inicio, fuso)
    const ate = instanteNoFuso(b.fim, fuso)
    return `${de.data < data ? '00:00' : de.hora} – ${ate.data > data ? '24:00' : ate.hora}`
  }

  return (
    <div className="space-y-4">
      {bloqueios.length > 0 && (
        <div className="cartao p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><Ban size={16} className="text-error" />Bloqueios do dia</h2>
          <ul className="space-y-1 text-sm">
            {bloqueios.map(b => <li key={b.id}><span className="font-semibold">{periodoBloqueio(b)}</span> · {nomeProfissional(b.profissionalId)} · <span className="text-muted-foreground">{b.motivo}</span></li>)}
          </ul>
        </div>
      )}
      <div className="cartao p-3 sm:p-4">
        {grupos.size === 0 ? <Vazio>Nenhum atendimento em {dataCompleta(data)}.</Vazio> : (
          <div className="space-y-4">
            {[...grupos.entries()].map(([hora, lista]) => (
              <div key={hora} className="grid gap-2 sm:grid-cols-[4.5rem_1fr] sm:gap-4">
                <div className="pt-1 text-sm font-bold text-primary sm:pt-4">{hora}</div>
                <div className="space-y-2">{lista.map(item => <CartaoAgendamento key={item.id} item={item} onAbrir={onAbrir} />)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function VisaoSemana({ itens, inicioSemana, hoje, onAbrir, onIrParaDia }: {
  itens: ItemAgenda[]; inicioSemana: string; hoje: string; onAbrir: (item: ItemAgenda) => void; onIrParaDia: (data: string) => void
}) {
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(inicioSemana, i))
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      {dias.map(dia => {
        const doDia = itens.filter(item => item.data === dia)
        return (
          <section key={dia} className={`cartao flex min-h-36 flex-col p-3 ${dia === hoje ? 'border-primary' : ''}`}>
            <button type="button" onClick={() => onIrParaDia(dia)} className="mb-3 flex items-center justify-between rounded-lg px-1 py-1 text-left hover:bg-muted" title="Abrir o dia">
              <span className="text-xs font-bold uppercase tracking-[.1em] text-primary">{nomeDoDia(dia)}</span>
              <span className="text-sm font-bold">{diaMes(dia)}</span>
            </button>
            <div className="space-y-2">
              {doDia.length ? doDia.map(item => <CartaoAgendamento key={item.id} item={item} onAbrir={onAbrir} compacto />) : <p className="px-1 text-xs text-muted-foreground">Sem atendimentos</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function VisaoMes({ itens, data, hoje, onIrParaDia }: { itens: ItemAgenda[]; data: string; hoje: string; onIrParaDia: (data: string) => void }) {
  const mes = data.slice(0, 7)
  const dias = gradeDoMes(data)
  const porDia = (dia: string) => itens.filter(item => item.data === dia)
  const diasComAtendimento = dias.filter(dia => dia.startsWith(mes) && porDia(dia).length)

  return (
    <>
      {/* Computador e tablet: calendário. */}
      <div className="cartao hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-border bg-muted text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(nome => <div key={nome} className="py-2">{nome}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {dias.map(dia => {
            const lista = porDia(dia)
            const foraDoMes = !dia.startsWith(mes)
            return (
              <button key={dia} type="button" onClick={() => onIrParaDia(dia)}
                className={`min-h-28 border-b border-r border-border p-2 text-left align-top hover:bg-accent-soft ${foraDoMes ? 'bg-muted/60 text-muted-foreground' : ''}`}>
                <div className={`mb-1 inline-grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${dia === hoje ? 'bg-primary text-primary-foreground' : ''}`}>{Number(dia.slice(8))}</div>
                {lista.slice(0, 3).map(item => (
                  <div key={item.id} className={`truncate text-xs ${item.status === 'cancelado' ? 'line-through opacity-60' : ''}`}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.profissionalCor }} />{item.horaInicio} {item.clienteNome}
                  </div>
                ))}
                {lista.length > 3 && <div className="text-xs font-bold text-primary">+{lista.length - 3} atendimento{lista.length - 3 > 1 ? 's' : ''}</div>}
              </button>
            )
          })}
        </div>
      </div>
      {/* Celular: lista dos dias com atendimentos. */}
      <div className="space-y-2 md:hidden">
        {diasComAtendimento.length ? diasComAtendimento.map(dia => (
          <button key={dia} type="button" onClick={() => onIrParaDia(dia)} className="cartao flex w-full items-center justify-between p-4 text-left">
            <span className="text-sm font-bold">{primeiraMaiuscula(nomeDoDia(dia))}, {diaMes(dia)}</span>
            <span className="text-sm font-semibold text-primary">{porDia(dia).length} atendimento(s)</span>
          </button>
        )) : <Vazio>Nenhum atendimento neste mês.</Vazio>}
      </div>
    </>
  )
}

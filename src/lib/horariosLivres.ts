import { instanteNoFuso, paraMinutos } from './datas'

/** Intervalo em minutos do dia, fechado no início e aberto no fim: [inicio, fim). */
export interface IntervaloMinutos { inicio: number; fim: number }

const MINUTOS_DIA = 24 * 60

/** Converte um bloqueio (instantes ISO) no trecho que ele ocupa em uma data da clínica. */
export const bloqueioNaData = (bloqueio: { inicio: string; fim: string }, data: string, fuso: string): IntervaloMinutos | null => {
  const inicio = instanteNoFuso(bloqueio.inicio, fuso)
  const fim = instanteNoFuso(bloqueio.fim, fuso)
  if (inicio.data > data || fim.data < data) return null
  const deMin = inicio.data < data ? 0 : paraMinutos(inicio.hora)
  const ateMin = fim.data > data ? MINUTOS_DIA : paraMinutos(fim.hora)
  return ateMin > deMin ? { inicio: deMin, fim: ateMin } : null
}

/**
 * Horários em que o serviço inteiro cabe (RN03), encaixados um após o outro pela duração do serviço
 * a partir do início de cada faixa de trabalho. Ao encontrar uma ocupação (bloqueio ou reserva), a
 * contagem recomeça no fim dela. Assim a agenda mostra quantos atendimentos cabem (decisão de 04/10/2026).
 * Espelha public.horarios_disponiveis no banco; o servidor repete a validação ao salvar (RN09).
 */
export const calcularHorariosLivres = (opcoes: {
  faixas: { horaInicio: string; horaFim: string }[]
  ocupados: IntervaloMinutos[]
  duracaoMinutos: number
  aPartirDeMinutos?: number
}) => {
  const { faixas, ocupados, duracaoMinutos, aPartirDeMinutos = 0 } = opcoes
  if (duracaoMinutos <= 0) return []
  const livres = new Set<number>()
  for (const faixa of faixas) {
    const fimFaixa = faixa.horaFim === '24:00' ? MINUTOS_DIA : paraMinutos(faixa.horaFim)
    let cursor = paraMinutos(faixa.horaInicio)
    while (cursor + duracaoMinutos <= fimFaixa) {
      const fim = cursor + duracaoMinutos
      const conflitos = ocupados.filter(o => cursor < o.fim && fim > o.inicio)
      if (conflitos.length) {
        cursor = Math.max(...conflitos.map(o => o.fim))
        continue
      }
      if (cursor >= aPartirDeMinutos) livres.add(cursor)
      cursor = fim
    }
  }
  return [...livres].sort((a, b) => a - b)
}

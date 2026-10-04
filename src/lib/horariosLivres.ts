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
 * Horários em que o atendimento e a preparação cabem inteiros (RN03), encaixados um após o outro com passo
 * igual a atendimento + preparação, a partir do início de cada faixa de trabalho. Ao encontrar uma ocupação
 * (bloqueio, reserva ou recurso sem capacidade), a contagem recomeça no fim dela.
 * Espelha private.calcular_horarios no banco; o servidor repete a validação ao salvar (RN09).
 */
export const calcularHorariosLivres = (opcoes: {
  faixas: { horaInicio: string; horaFim: string }[]
  ocupados: IntervaloMinutos[]
  duracaoMinutos: number
  preparacaoMinutos?: number
  aPartirDeMinutos?: number
  /** Retorna o fim da ocupação de um recurso no trecho, ou null se o recurso tiver capacidade. */
  recursoOcupadoAte?: (inicio: number, fim: number) => number | null
}) => {
  const { faixas, ocupados, duracaoMinutos, preparacaoMinutos = 0, aPartirDeMinutos = 0, recursoOcupadoAte } = opcoes
  if (duracaoMinutos <= 0) return []
  const passo = duracaoMinutos + preparacaoMinutos
  const livres = new Set<number>()
  for (const faixa of faixas) {
    const fimFaixa = faixa.horaFim === '24:00' ? MINUTOS_DIA : paraMinutos(faixa.horaFim)
    let cursor = paraMinutos(faixa.horaInicio)
    while (cursor + passo <= fimFaixa) {
      const fim = cursor + passo
      const conflitos = ocupados.filter(o => cursor < o.fim && fim > o.inicio)
      const ocupadoAte = conflitos.length ? Math.max(...conflitos.map(o => o.fim)) : recursoOcupadoAte?.(cursor, fim) ?? null
      if (ocupadoAte !== null) {
        cursor = Math.max(ocupadoAte, cursor + 1)
        continue
      }
      if (cursor >= aPartirDeMinutos) livres.add(cursor)
      cursor = fim
    }
  }
  return [...livres].sort((a, b) => a - b)
}

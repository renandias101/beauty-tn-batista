// Datas de calendário são strings YYYY-MM-DD e horas são HH:MM, sempre no fuso da clínica (RN10).
// Os cálculos usam UTC internamente para não depender do fuso do aparelho.

const paraData = (data: string) => new Date(`${data}T00:00:00Z`)
const paraTexto = (data: Date) => data.toISOString().slice(0, 10)

export const somarDias = (data: string, dias: number) => {
  const d = paraData(data)
  d.setUTCDate(d.getUTCDate() + dias)
  return paraTexto(d)
}

/** 0 = domingo ... 6 = sábado. */
export const diaDaSemana = (data: string) => paraData(data).getUTCDay()

/** Segunda-feira da semana que contém a data. */
export const inicioDaSemana = (data: string) => somarDias(data, -((diaDaSemana(data) + 6) % 7))

export const inicioDoMes = (data: string) => `${data.slice(0, 7)}-01`

export const fimDoMes = (data: string) => {
  const d = paraData(inicioDoMes(data))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return paraTexto(d)
}

export const somarMeses = (data: string, meses: number) => {
  const d = paraData(inicioDoMes(data))
  d.setUTCMonth(d.getUTCMonth() + meses)
  return paraTexto(d)
}

/** Grade do mês em semanas de segunda a domingo, incluindo dias dos meses vizinhos. */
export const gradeDoMes = (data: string) => {
  const primeiro = inicioDaSemana(inicioDoMes(data))
  const ultimo = somarDias(inicioDaSemana(fimDoMes(data)), 6)
  const dias: string[] = []
  for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) dias.push(dia)
  return dias
}

export const paraMinutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export const deMinutos = (minutos: number) =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`

export const somarMinutos = (hora: string, minutos: number) => deMinutos(paraMinutos(hora) + minutos)

/** Data e hora atuais no fuso informado. */
export const agoraNoFuso = (fuso: string, referencia = new Date()) => {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(referencia)
      .map(parte => [parte.type, parte.value]),
  )
  return { data: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` }
}

const formatar = (data: string, opcoes: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: 'UTC' }).format(paraData(data))

export const dataPorExtenso = (data: string) => formatar(data, { weekday: 'long', day: 'numeric', month: 'long' })
export const dataCompleta = (data: string) => formatar(data, { day: '2-digit', month: 'long', year: 'numeric' })
export const dataCurta = (data: string) => formatar(data, { day: '2-digit', month: '2-digit', year: 'numeric' })
export const diaMes = (data: string) => formatar(data, { day: '2-digit', month: '2-digit' })
export const nomeDoDia = (data: string) => formatar(data, { weekday: 'short' }).replace('.', '')
export const mesPorExtenso = (data: string) => formatar(data, { month: 'long', year: 'numeric' })

/** Converte um instante (ISO) para data e hora no fuso da clínica. */
export const instanteNoFuso = (instante: string, fuso: string) => agoraNoFuso(fuso, new Date(instante))

export const NOMES_DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

/** Maiúscula só na primeira letra ("Domingo, 4 de outubro"), sem afetar preposições. */
export const primeiraMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

import { agoraNoFuso, diaDaSemana, paraMinutos, somarDias } from '../../lib/datas'
import { bloqueioNaData, calcularHorariosLivres } from '../../lib/horariosLivres'
import { ocupaHorario } from '../../lib/status'
import { useCarregar } from '../../lib/useCarregar'
import { listarAgenda } from '../../services/agenda'
import { listarBloqueios, listarDisponibilidades, listarExcecoes } from '../../services/jornada'

/** Sugere horários livres de um profissional em uma data. ignorarId exclui a própria reserva (reagendamento). */
export function useHorariosLivres(opcoes: { profissionalId: string; data: string; duracaoMinutos: number; fuso: string; ignorarId?: string }) {
  const { profissionalId, data, duracaoMinutos, fuso, ignorarId } = opcoes
  const pronto = Boolean(profissionalId && data && duracaoMinutos > 0)

  const { dados, carregando, erro } = useCarregar(async () => {
    if (!pronto) return null
    const [faixas, excecoes, bloqueios, agenda] = await Promise.all([
      listarDisponibilidades(profissionalId),
      listarExcecoes({ profissionalId, data }),
      listarBloqueios({ profissionalId, de: `${somarDias(data, -1)}T00:00:00Z`, ate: `${somarDias(data, 2)}T00:00:00Z` }),
      listarAgenda(data, data, profissionalId),
    ])
    return { faixas, excecoes, bloqueios, agenda }
  }, [profissionalId, data, pronto])

  if (!dados) return { horarios: [] as number[], carregando: pronto && carregando, erro, semJornada: false }

  const faixasDoDia = [
    ...dados.faixas.filter(f => f.diaSemana === diaDaSemana(data)),
    ...dados.excecoes,
  ]
  const ocupados = [
    ...dados.bloqueios.map(b => bloqueioNaData(b, data, fuso)).filter(Boolean) as { inicio: number; fim: number }[],
    ...dados.agenda.filter(a => a.id !== ignorarId && ocupaHorario(a.status)).map(a => ({ inicio: paraMinutos(a.horaInicio), fim: paraMinutos(a.horaInicio) + a.duracaoMinutos })),
  ]
  const agora = agoraNoFuso(fuso)
  const horarios = calcularHorariosLivres({
    faixas: faixasDoDia,
    ocupados,
    duracaoMinutos,
    aPartirDeMinutos: data === agora.data ? paraMinutos(agora.hora) : 0,
  })
  return { horarios, carregando, erro, semJornada: faixasDoDia.length === 0 }
}

import { useCarregar } from '../../lib/useCarregar'
import { horariosLivres } from '../../services/agenda'

/**
 * Horários livres calculados pelo servidor: jornada, bloqueios, reservas (inclusive concluídas), preparação,
 * duração por profissional e recursos compartilhados. ignorarId exclui a própria reserva (reagendamento).
 */
export function useHorariosLivres(opcoes: { servicoId: string; profissionalId: string; data: string; ignorarId?: string; duracaoMinutos?: number; versao?: number }) {
  const { servicoId, profissionalId, data, ignorarId, duracaoMinutos, versao } = opcoes
  const pronto = Boolean(servicoId && profissionalId && data)
  const { dados, carregando, erro } = useCarregar(
    async () => pronto ? horariosLivres({ servicoId, profissionalId, data, ignorarId, duracaoMinutos }) : null,
    // versao: recalcula quando a agenda muda em outro computador.
    [servicoId, profissionalId, data, ignorarId, duracaoMinutos, versao, pronto],
    { limparAoMudar: true },
  )
  return { horarios: dados ?? [], carregando: pronto && carregando, erro }
}

import { filtrarPorStatus, type FiltroStatus } from '../../lib/resumo'
import type { ItemAgenda } from '../../types'

const INDICADORES: { filtro: FiltroStatus; rotulo: string; dica: string }[] = [
  { filtro: '', rotulo: 'Total do dia', dica: 'Todos os atendimentos, exceto cancelados' },
  { filtro: 'agendado', rotulo: 'Aguardando confirmação', dica: 'A cliente ainda não confirmou presença' },
  { filtro: 'confirmado', rotulo: 'Presença confirmada', dica: 'A cliente confirmou que virá (não é o mesmo que mensagem enviada)' },
  { filtro: 'chegou', rotulo: 'Clientes presentes', dica: 'Chegada registrada na recepção' },
  { filtro: 'em_atendimento', rotulo: 'Em atendimento', dica: 'Atendimento iniciado' },
  { filtro: 'concluido', rotulo: 'Concluídos', dica: 'Atendimento concluído' },
  { filtro: 'cancelado', rotulo: 'Cancelados', dica: 'Cancelados no dia' },
  { filtro: 'faltou', rotulo: 'Faltas', dica: 'A cliente não compareceu' },
]

/**
 * Resumo objetivo do dia exibido. Conta somente os itens que o perfil pode ver (o servidor já filtra a agenda
 * do profissional) e respeita os filtros de profissional e serviço. Clicar em um indicador filtra a agenda.
 */
export function ResumoDia({ itens, filtro, onFiltrar, mostrarMensagens }: { itens: ItemAgenda[]; filtro: FiltroStatus; onFiltrar: (filtro: FiltroStatus) => void; mostrarMensagens: boolean }) {
  const contar = (f: FiltroStatus) => filtrarPorStatus(itens, f).length
  // Cada serviço conta como um atendimento; uma cliente com vários serviços conta uma vez aqui.
  const clientesDistintos = new Set(filtrarPorStatus(itens, '').map(i => i.clienteId)).size
  const indicadores = mostrarMensagens
    ? [...INDICADORES, { filtro: 'sem_mensagem' as const, rotulo: 'Sem mensagem enviada', dica: 'Aguardando confirmação ou confirmados sem mensagem registrada para o horário atual' }]
    : INDICADORES

  return (
    <section aria-label="Resumo do dia" className="mb-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        {indicadores.map(indicador => {
          const ativo = filtro === indicador.filtro
          return (
            <button key={indicador.filtro || 'total'} type="button" onClick={() => onFiltrar(ativo && indicador.filtro !== '' ? '' : indicador.filtro)} aria-pressed={ativo} title={indicador.dica}
              className={`rounded-xl border p-3 text-left transition ${ativo ? 'border-primary bg-accent-soft' : 'border-border bg-card hover:border-primary'}`}>
              <span className="block text-2xl font-bold leading-none">{contar(indicador.filtro)}</span>
              <span className="mt-1 block text-xs font-semibold text-muted-foreground">{indicador.rotulo}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-sm"><span className="font-bold">{clientesDistintos}</span> <span className="text-muted-foreground">cliente(s) distinta(s) no dia (sem cancelados). Cada serviço conta como um atendimento no total.</span></p>
      <p className="mt-1 text-xs text-muted-foreground">Clique em um indicador para filtrar a agenda. “Presença confirmada” é a resposta da cliente; “mensagem enviada” é o registro feito pela equipe.</p>
    </section>
  )
}

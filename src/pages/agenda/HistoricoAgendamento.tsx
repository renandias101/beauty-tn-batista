import { Carregando, FalhaCarregamento, Vazio } from '../../components/Basicos'
import { dataCurta, instanteNoFuso } from '../../lib/datas'
import { STATUS } from '../../lib/status'
import { useCarregar } from '../../lib/useCarregar'
import { historicoDoAgendamento } from '../../services/agenda'
import type { RegistroHistorico, StatusAgendamento } from '../../types'

const ACOES: Record<RegistroHistorico['acao'], string> = {
  criado: 'Agendamento criado',
  status_alterado: 'Andamento atualizado',
  reagendado: 'Reagendado',
  cancelado: 'Cancelado',
  editado: 'Observação ou encaixe alterados',
  status_corrigido: 'Status corrigido pela administração',
}

type Retrato = { status?: StatusAgendamento; data?: string; hora_inicio?: string; hora_fim?: string; profissional?: string; duracao_minutos?: number; observacao?: string | null; encaixe?: boolean }

const quando = (r: Retrato) => `${r.data ? dataCurta(r.data) : ''} ${r.hora_inicio ?? ''}–${r.hora_fim ?? ''} · ${r.profissional ?? ''}`

const resumo = (registro: RegistroHistorico) => {
  const antes = (registro.valoresAnteriores ?? {}) as Retrato
  const depois = (registro.valoresNovos ?? {}) as Retrato
  if (registro.acao === 'criado') return quando(depois)
  if (registro.acao === 'reagendado') return `De ${quando(antes)} para ${quando(depois)}`
  if ((registro.acao === 'status_alterado' || registro.acao === 'status_corrigido') && antes.status && depois.status) return `${STATUS[antes.status].rotulo} → ${STATUS[depois.status].rotulo}`
  if (registro.acao === 'editado') return `Encaixe: ${depois.encaixe ? 'sim' : 'não'}${depois.observacao ? ` · Observação: ${depois.observacao}` : ''}`
  return ''
}

/** RF09: alterações relevantes com responsável, data, hora e motivo. */
export function HistoricoAgendamento({ agendamentoId, fuso }: { agendamentoId: string; fuso: string }) {
  const { dados, carregando, erro, recarregar } = useCarregar(() => historicoDoAgendamento(agendamentoId), [agendamentoId])
  if (carregando && !dados) return <Carregando />
  if (erro) return <FalhaCarregamento mensagem={erro} onTentar={recarregar} />
  if (!dados?.length) return <Vazio>Nenhuma alteração registrada.</Vazio>
  return (
    <ol className="space-y-3">
      {dados.map(registro => {
        const momento = instanteNoFuso(registro.ocorridoEm, fuso)
        return (
          <li key={registro.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold">{ACOES[registro.acao]}</span>
              <span className="text-xs text-muted-foreground">{dataCurta(momento.data)} às {momento.hora} · {registro.usuarioNome}</span>
            </div>
            {resumo(registro) && <p className="mt-1 text-sm text-muted-foreground">{resumo(registro)}</p>}
            {registro.motivo && <p className="mt-1 text-sm"><span className="font-semibold">Motivo:</span> {registro.motivo}</p>}
          </li>
        )
      })}
    </ol>
  )
}

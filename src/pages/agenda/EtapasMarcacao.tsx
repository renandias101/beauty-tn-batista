import { Plus, Trash2 } from 'lucide-react'
import { CampoBusca } from '../../components/CampoBusca'
import { somarMinutos } from '../../lib/datas'
import { duracaoEfetiva } from '../../services/cadastros'
import type { Habilitacao, Profissional, Servico } from '../../types'
import { useHorariosLivres } from './useHorariosLivres'

/** hora: início da etapa; intervalo: minutos de espera da cliente depois da etapa anterior (quando o horário é sugerido). */
export interface EtapaForm { chave: string; servicoId: string; profissionalId: string; hora: string; intervalo: string; manual: boolean }

export const MAXIMO_ETAPAS = 6

export const fimDaEtapa = (etapa: EtapaForm, servicos: Servico[], habilitacoes: Habilitacao[]) => {
  const servico = servicos.find(s => s.id === etapa.servicoId)
  const duracao = etapa.profissionalId ? duracaoEfetiva(servico, habilitacoes, etapa.profissionalId) : 0
  return etapa.hora && duracao ? somarMinutos(etapa.hora, duracao) : ''
}

/**
 * Sugere o início de cada etapa logo após o término do atendimento anterior, somando o intervalo informado.
 * A preparação é do profissional, não da cliente: por isso a etapa seguinte pode começar no término do atendimento
 * (com outro profissional). Etapas com horário digitado pelo usuário não são alteradas.
 */
export function recalcularSugestoes(etapas: EtapaForm[], servicos: Servico[], habilitacoes: Habilitacao[]) {
  const resultado = [...etapas]
  for (let i = 1; i < resultado.length; i++) {
    if (resultado[i].manual) continue
    const fimAnterior = fimDaEtapa(resultado[i - 1], servicos, habilitacoes)
    resultado[i] = { ...resultado[i], hora: fimAnterior ? somarMinutos(fimAnterior, Number(resultado[i].intervalo) || 0) : resultado[i].hora }
  }
  return resultado
}

export function EtapasMarcacao({ etapas, onEtapas, data, servicos, profissionais, habilitacoes, revisao }: {
  etapas: EtapaForm[]; onEtapas: (etapas: EtapaForm[]) => void; data: string
  servicos: Servico[]; profissionais: Profissional[]; habilitacoes: Habilitacao[]; revisao?: number
}) {
  const atualizar = (indice: number, mudanca: Partial<EtapaForm>) =>
    onEtapas(recalcularSugestoes(etapas.map((e, i) => i === indice ? { ...e, ...mudanca } : e), servicos, habilitacoes))
  const adicionar = () => onEtapas(recalcularSugestoes([...etapas, { chave: Math.random().toString(36).slice(2), servicoId: '', profissionalId: '', hora: '', intervalo: '0', manual: false }], servicos, habilitacoes))
  const remover = (indice: number) => onEtapas(recalcularSugestoes(etapas.filter((_, i) => i !== indice), servicos, habilitacoes))

  return (
    <div className="space-y-3">
      {etapas.map((etapa, indice) => (
        <LinhaEtapa key={etapa.chave} indice={indice} etapa={etapa} data={data} servicos={servicos} profissionais={profissionais} habilitacoes={habilitacoes} revisao={revisao}
          podeRemover={etapas.length > 2} onMudar={mudanca => atualizar(indice, mudanca)} onRemover={() => remover(indice)} />
      ))}
      {etapas.length < MAXIMO_ETAPAS && <button type="button" onClick={adicionar} className="botao botao-texto botao-pequeno"><Plus size={16} />Adicionar serviço</button>}
      <p className="text-xs text-muted-foreground">Até {MAXIMO_ETAPAS} serviços. O início de cada serviço é sugerido logo após o término do anterior; ajuste o intervalo ou digite outro horário se precisar.</p>
    </div>
  )
}

function LinhaEtapa({ indice, etapa, data, servicos, profissionais, habilitacoes, revisao, podeRemover, onMudar, onRemover }: {
  indice: number; etapa: EtapaForm; data: string; servicos: Servico[]; profissionais: Profissional[]; habilitacoes: Habilitacao[]; revisao?: number
  podeRemover: boolean; onMudar: (mudanca: Partial<EtapaForm>) => void; onRemover: () => void
}) {
  const servico = servicos.find(s => s.id === etapa.servicoId)
  const habilitados = profissionais.filter(p => p.ativo && habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === etapa.servicoId))
  const { horarios, carregando } = useHorariosLivres({ servicoId: etapa.servicoId, profissionalId: etapa.profissionalId, data, versao: revisao })
  const fim = fimDaEtapa(etapa, servicos, habilitacoes)
  const livre = etapa.hora && horarios.includes(etapa.hora)

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">Serviço {indice + 1}</span>
        {podeRemover && <button type="button" onClick={onRemover} className="botao botao-texto botao-pequeno" aria-label={`Remover serviço ${indice + 1}`}><Trash2 size={15} /></button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoBusca rotulo="Serviço" valor={etapa.servicoId} onEscolher={id => onMudar({ servicoId: id, profissionalId: habilitacoes.some(h => h.profissionalId === etapa.profissionalId && h.servicoId === id) ? etapa.profissionalId : '' })}
          opcoes={servicos.filter(s => s.ativo).map(s => ({ id: s.id, rotulo: s.nome, detalhe: `${s.duracaoMinutos} min` }))} vazio="Nenhum serviço ativo encontrado." />
        <label className="rotulo">Profissional
          <select className="campo" value={etapa.profissionalId} onChange={e => onMudar({ profissionalId: e.target.value })} disabled={!etapa.servicoId}>
            <option value="">{etapa.servicoId ? (habilitados.length ? 'Selecione' : 'Nenhum profissional habilitado') : 'Escolha o serviço primeiro'}</option>
            {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        {indice > 0 && (
          <label className="rotulo">Intervalo após o serviço anterior (min)
            <input className="campo" type="number" min={0} max={240} step={5} value={etapa.intervalo} onChange={e => onMudar({ intervalo: e.target.value, manual: false })} />
          </label>
        )}
        <label className="rotulo">Início
          <input className="campo" type="time" step={300} value={etapa.hora} onChange={e => onMudar({ hora: e.target.value, manual: indice > 0 })} />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {fim ? `Término: ${fim}${servico?.preparacaoMinutos ? ` (+${servico.preparacaoMinutos} min de preparação na agenda do profissional)` : ''}` : 'Escolha serviço, profissional e horário.'}
        {etapa.manual && ' · horário ajustado manualmente'}
      </p>
      {etapa.servicoId && etapa.profissionalId && etapa.hora && !carregando && (
        livre ? <p className="mt-1 text-xs font-semibold text-success">Horário livre na agenda do profissional.</p>
          : <div className="mt-1 text-xs">
              <span className="font-semibold text-warning">Este início não aparece entre os horários livres. </span>
              {horarios.length > 0 && <span className="text-muted-foreground">Livres: </span>}
              {horarios.slice(0, 8).map(h => <button key={h} type="button" onClick={() => onMudar({ hora: h, manual: indice > 0 })} className="mr-1 mt-1 rounded-md border border-border px-2 py-0.5 font-semibold hover:border-primary">{h}</button>)}
            </div>
      )}
    </div>
  )
}

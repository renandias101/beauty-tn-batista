import { CalendarCheck, CalendarX, Loader2 } from 'lucide-react'
import { dataCurta, nomeDoDia } from '../../lib/datas'
import { LIMITE_OCORRENCIAS } from '../../services/agenda'
import type { DiaInexistente, FrequenciaSerie, OcorrenciaPrevista } from '../../types'

export interface ConfigRecorrencia {
  frequencia: FrequenciaSerie
  limite: 'quantidade' | 'data'
  quantidade: string
  dataFinal: string
  diaInexistente: DiaInexistente | ''
}

export const RECORRENCIA_PADRAO: ConfigRecorrencia = { frequencia: 'semanal', limite: 'quantidade', quantidade: '4', dataFinal: '', diaInexistente: '' }

const SITUACAO: Record<OcorrenciaPrevista['situacao'], { rotulo: string; classes: string }> = {
  disponivel: { rotulo: 'Disponível', classes: 'text-success' },
  indisponivel: { rotulo: 'Indisponível', classes: 'text-error' },
  dia_inexistente: { rotulo: 'Dia inexistente', classes: 'text-warning' },
  pulada: { rotulo: 'Mês pulado', classes: 'text-muted-foreground' },
}

/**
 * Configuração e prévia da série. Nada é ajustado em silêncio: datas indisponíveis aparecem com o motivo,
 * e no mensal o usuário escolhe explicitamente o que fazer nos meses sem o dia escolhido.
 */
export function RecorrenciaCampos({ config, onConfig, dataInicial, previa, carregandoPrevia, erroPrevia, onPrever, somenteDisponiveis, onSomenteDisponiveis }: {
  config: ConfigRecorrencia; onConfig: (c: ConfigRecorrencia) => void; dataInicial: string
  previa: OcorrenciaPrevista[] | null; carregandoPrevia: boolean; erroPrevia: string; onPrever: () => void
  somenteDisponiveis: boolean; onSomenteDisponiveis: (valor: boolean) => void
}) {
  const dia = Number(dataInicial.slice(8)) || 0
  const disponiveis = previa?.filter(p => p.situacao === 'disponivel').length ?? 0
  const problemas = previa?.filter(p => p.situacao === 'indisponivel' || p.situacao === 'dia_inexistente') ?? []
  const precisaEscolhaMensal = config.frequencia === 'mensal' && dia > 28

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="rotulo">Repetir
          <select className="campo" value={config.frequencia} onChange={e => onConfig({ ...config, frequencia: e.target.value as FrequenciaSerie })}>
            <option value="semanal">Toda semana</option>
            <option value="quinzenal">A cada 15 dias</option>
            <option value="mensal">Todo mês</option>
          </select>
        </label>
        <label className="rotulo">Termina
          <select className="campo" value={config.limite} onChange={e => onConfig({ ...config, limite: e.target.value as ConfigRecorrencia['limite'] })}>
            <option value="quantidade">Após N ocorrências</option>
            <option value="data">Em uma data</option>
          </select>
        </label>
        {config.limite === 'quantidade'
          ? <label className="rotulo">Ocorrências<input className="campo" type="number" min={2} max={LIMITE_OCORRENCIAS} value={config.quantidade} onChange={e => onConfig({ ...config, quantidade: e.target.value })} /></label>
          : <label className="rotulo">Data final<input className="campo" type="date" min={dataInicial} value={config.dataFinal} onChange={e => onConfig({ ...config, dataFinal: e.target.value })} /></label>}
      </div>
      <p className="text-xs text-muted-foreground">Limite de segurança: até {LIMITE_OCORRENCIAS} ocorrências e período de até 1 ano. Cada ocorrência é validada separadamente.</p>
      {precisaEscolhaMensal && (
        <fieldset className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          <legend className="sr-only">Meses sem o dia {dia}</legend>
          <p className="font-semibold">Alguns meses não têm o dia {dia}. O que fazer nesses meses?</p>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="radio" name="dia-inexistente" checked={config.diaInexistente === 'ultimo_dia'} onChange={() => onConfig({ ...config, diaInexistente: 'ultimo_dia' })} />Usar o último dia do mês</label>
            <label className="flex items-center gap-2"><input type="radio" name="dia-inexistente" checked={config.diaInexistente === 'pular'} onChange={() => onConfig({ ...config, diaInexistente: 'pular' })} />Pular esses meses</label>
          </div>
        </fieldset>
      )}
      <button type="button" onClick={onPrever} disabled={carregandoPrevia} className="botao botao-secundario botao-pequeno">
        {carregandoPrevia ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />}Ver todas as datas
      </button>
      {erroPrevia && <p role="alert" className="alerta-erro">{erroPrevia}</p>}
      {previa && (
        <div>
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border rolagem-fina">
            {previa.map((p, i) => (
              <li key={`${p.data}-${i}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <span className="font-semibold">{p.ordem ? `${p.ordem}. ` : ''}{nomeDoDia(p.data)}, {dataCurta(p.data)}</span>
                <span className={`text-xs font-semibold sm:text-right ${SITUACAO[p.situacao].classes}`}>{SITUACAO[p.situacao].rotulo}{p.motivo ? ` · ${p.motivo}` : ''}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">{disponiveis} de {previa.filter(p => p.ordem !== null).length} ocorrência(s) disponível(is).</p>
          {problemas.length > 0 && disponiveis > 0 && (
            <label className="mt-2 flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={somenteDisponiveis} onChange={e => onSomenteDisponiveis(e.target.checked)} />
              <span><span className="font-semibold">Criar somente as {disponiveis} ocorrências disponíveis.</span> As datas marcadas como indisponíveis não serão criadas. Para incluí-las, ajuste horário, profissional ou período e gere a prévia de novo.</span>
            </label>
          )}
          {problemas.length > 0 && disponiveis === 0 && <p className="alerta-erro mt-2 flex items-center gap-2"><CalendarX size={16} />Nenhuma ocorrência disponível. Ajuste a série.</p>}
        </div>
      )}
    </div>
  )
}

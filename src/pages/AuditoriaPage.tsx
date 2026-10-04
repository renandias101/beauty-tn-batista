import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { dataCurta, instanteNoFuso } from '../lib/datas'
import { modoDemo } from '../lib/modoDemo'
import { useCarregar } from '../lib/useCarregar'
import { listarAuditoria, type RegistroAuditoria } from '../services/administracao'

const TABELAS: Record<string, string> = {
  perfis: 'Usuários e perfis',
  profissionais: 'Profissionais',
  servicos: 'Serviços',
  profissional_servicos: 'Serviços habilitados',
  disponibilidades: 'Jornada semanal',
  excecoes_disponibilidade: 'Exceções de jornada',
  bloqueios: 'Bloqueios',
  clientes: 'Clientes',
  configuracao_clinica: 'Configurações',
}
const OPERACOES = { insert: 'Criação', update: 'Alteração', delete: 'Remoção' }
// Campos técnicos que não ajudam a entender a alteração.
const IGNORAR = new Set(['id', 'criado_em', 'atualizado_em', 'telefone_digitos', 'atualizado_por', 'criado_por', 'removido_por'])

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function resumo(r: RegistroAuditoria, fuso: string): string[] {
  const valor = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'sim' : 'não'
    if (typeof v === 'string' && INSTANTE.test(v)) { const m = instanteNoFuso(v, fuso); return `${dataCurta(m.data)} ${m.hora}` }
    return String(v)
  }
  const linhas = linhasDeResumo(r, valor)
  return linhas.length ? linhas : ['Somente dados técnicos atualizados (data de alteração ou responsável).']
}

function linhasDeResumo(r: RegistroAuditoria, valor: (v: unknown) => string) {
  if (r.operacao === 'update' && r.valoresAnteriores && r.valoresNovos) {
    return Object.keys(r.valoresNovos).filter(c => !IGNORAR.has(c) && JSON.stringify(r.valoresAnteriores![c]) !== JSON.stringify(r.valoresNovos![c]))
      .map(c => `${c}: ${valor(r.valoresAnteriores![c])} → ${valor(r.valoresNovos![c])}`)
  }
  const dados = r.valoresNovos ?? r.valoresAnteriores ?? {}
  return Object.entries(dados).filter(([c, v]) => !IGNORAR.has(c) && v !== null && v !== '').slice(0, 6).map(([c, v]) => `${c}: ${valor(v)}`)
}

/** Histórico completo de alterações nos cadastros (o histórico de cada agendamento fica no próprio agendamento). */
export function AuditoriaPage() {
  const perfil = usePerfil()
  const [tabela, setTabela] = useState('')
  const auditoria = useCarregar(() => listarAuditoria(200, tabela || undefined), [tabela])

  return (
    <div>
      <CabecalhoPagina sobretitulo="Administração" titulo="Auditoria" descricao="Quem alterou cadastros, jornadas, bloqueios, usuários e configurações, e quando. Registros somente para consulta."
        acoes={<button type="button" onClick={auditoria.recarregar} className="botao botao-texto"><RefreshCw size={16} className={auditoria.carregando ? 'animate-spin' : ''} />Atualizar</button>} />
      <div className="cartao mb-4 p-3">
        <select aria-label="Filtrar por área" className="campo !mt-0 w-full sm:w-72" value={tabela} onChange={e => setTabela(e.target.value)}>
          <option value="">Todas as áreas</option>
          {Object.entries(TABELAS).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
        </select>
      </div>
      {modoDemo && <p className="alerta-info mb-4">A demonstração não mantém auditoria geral de cadastros. O histórico de cada agendamento continua disponível na agenda.</p>}
      {auditoria.erro ? <FalhaCarregamento mensagem={auditoria.erro} onTentar={auditoria.recarregar} />
        : !auditoria.dados ? <Carregando />
        : !auditoria.dados.length ? <Vazio>Nenhum registro encontrado.</Vazio>
        : (
          <ol className="space-y-2">
            {auditoria.dados.map(r => {
              const momento = instanteNoFuso(r.ocorridoEm, perfil.fusoHorario)
              return (
                <li key={r.id} className="cartao p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-bold">{OPERACOES[r.operacao]} · {TABELAS[r.tabela] ?? r.tabela}</span>
                    <span className="text-xs text-muted-foreground">{dataCurta(momento.data)} às {momento.hora} · {r.usuarioNome}</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 break-words text-xs text-muted-foreground">{resumo(r, perfil.fusoHorario).map(linha => <li key={linha}>{linha}</li>)}</ul>
                </li>
              )
            })}
          </ol>
        )}
    </div>
  )
}

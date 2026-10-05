import { useState, type FormEvent } from 'react'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { Modal } from '../components/Modal'
import { mensagemDeErro } from '../lib/erros'
import { useCarregar } from '../lib/useCarregar'
import { listarRecursos, listarServicoRecursos, listarServicos, salvarRecurso } from '../services/cadastros'
import type { Recurso, TipoRecurso } from '../types'

const TIPOS: Record<TipoRecurso, string> = { sala: 'Sala', equipamento: 'Equipamento', outro: 'Outro' }

/**
 * Salas, macas e equipamentos compartilhados (opcional). Só serviços ligados a um recurso o reservam;
 * os demais não exigem cadastro. Recursos não são excluídos: são desativados, e o servidor recusa desativar
 * ou reduzir a capacidade enquanto houver reservas futuras usando o recurso.
 */
export function RecursosPage() {
  const avisar = useAvisos()
  const dados = useCarregar(async () => {
    const [recursos, servicos, vinculos] = await Promise.all([listarRecursos(), listarServicos(), listarServicoRecursos()])
    return { recursos, servicos, vinculos }
  }, [])
  const [editando, setEditando] = useState<Recurso | 'novo' | null>(null)

  const servicosDo = (recursoId: string) => (dados.dados?.vinculos ?? []).filter(v => v.recursoId === recursoId)
    .map(v => dados.dados?.servicos.find(s => s.id === v.servicoId)?.nome).filter(Boolean)

  return (
    <div>
      <CabecalhoPagina sobretitulo="Cadastro" titulo="Recursos" descricao="Salas e equipamentos compartilhados. Opcional: use apenas para serviços que disputam o mesmo espaço ou equipamento."
        acoes={<>
          <a href="#/servicos" className="botao botao-texto"><ArrowLeft size={18} />Serviços</a>
          <button type="button" onClick={() => setEditando('novo')} className="botao botao-primario"><Plus size={18} />Novo recurso</button>
        </>} />
      {dados.erro ? <FalhaCarregamento mensagem={dados.erro} onTentar={dados.recarregar} /> : !dados.dados ? <Carregando /> : !dados.dados.recursos.length ? (
        <Vazio>Nenhum recurso cadastrado. Enquanto não houver recursos, os agendamentos consideram somente a agenda dos profissionais.</Vazio>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dados.dados.recursos.map(r => {
            const servicos = servicosDo(r.id)
            return (
              <button key={r.id} type="button" onClick={() => setEditando(r)} className={`cartao p-4 text-left transition hover:border-accent hover:shadow-md ${r.ativo ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold">{r.nome}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${r.ativo ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>{r.ativo ? 'Ativo' : 'Desativado'}</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{TIPOS[r.tipo]} · {r.capacidade === 1 ? 'uso exclusivo' : `${r.capacidade} usos simultâneos`}</div>
                <div className="mt-2 text-xs text-muted-foreground">{servicos.length ? `Usado por: ${servicos.join(', ')}` : 'Nenhum serviço usa este recurso (vincule em Serviços).'}</div>
              </button>
            )
          })}
        </div>
      )}
      {editando && (
        <RecursoModal recurso={editando === 'novo' ? undefined : editando} onFechar={() => setEditando(null)}
          onSalvo={() => { avisar(editando === 'novo' ? 'Recurso cadastrado.' : 'Recurso atualizado.'); setEditando(null); dados.recarregar() }} />
      )}
    </div>
  )
}

function RecursoModal({ recurso, onSalvo, onFechar }: { recurso?: Recurso; onSalvo: () => void; onFechar: () => void }) {
  const perfil = usePerfil()
  const [form, setForm] = useState({ nome: recurso?.nome ?? '', tipo: recurso?.tipo ?? 'sala' as TipoRecurso, capacidade: String(recurso?.capacidade ?? 1), ativo: recurso?.ativo ?? true })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    const capacidade = Number(form.capacidade)
    if (!form.nome.trim()) { setErro('Informe o nome do recurso.'); return }
    if (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 20) { setErro('A capacidade deve ser um número inteiro de 1 a 20.'); return }
    setSalvando(true)
    setErro('')
    try {
      await salvarRecurso({ id: recurso?.id, nome: form.nome, tipo: form.tipo, capacidade, ativo: form.ativo }, perfil.usuarioId)
      onSalvo()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={recurso ? 'Editar recurso' : 'Novo recurso'} onFechar={onFechar} bloqueado={salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Nome<input className="campo" required maxLength={80} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Sala 2, Maca de massagem, Laser" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="rotulo">Tipo
            <select className="campo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as TipoRecurso })}>
              {Object.entries(TIPOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
          <label className="rotulo">Usos simultâneos
            <input className="campo" type="number" min={1} max={20} required value={form.capacidade} onChange={e => setForm({ ...form, capacidade: e.target.value })} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Use 1 para uso exclusivo. Se houver itens iguais e intercambiáveis (ex.: 2 macas), informe a quantidade.</p>
        {recurso && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
            <span>Ativo<span className="block text-xs text-muted-foreground">Desativar exige reagendar ou cancelar antes as reservas futuras que usam o recurso. Serviços que exigem um recurso desativado não podem ser agendados.</span></span>
          </label>
        )}
        {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

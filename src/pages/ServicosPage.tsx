import { useState, type FormEvent } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { Modal } from '../components/Modal'
import { mensagemDeErro } from '../lib/erros'
import { useCarregar } from '../lib/useCarregar'
import { definirHabilitacoes, listarHabilitacoes, listarProfissionais, listarServicos, salvarServico } from '../services/cadastros'
import type { Habilitacao, Profissional, Servico } from '../types'

export function ServicosPage() {
  const avisar = useAvisos()
  const dados = useCarregar(async () => {
    const [servicos, profissionais, habilitacoes] = await Promise.all([listarServicos(), listarProfissionais(), listarHabilitacoes()])
    return { servicos, profissionais, habilitacoes }
  }, [])
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Servico | 'novo' | null>(null)

  const termo = busca.trim().toLowerCase()
  const servicos = (dados.dados?.servicos ?? []).filter(s => !termo || `${s.nome} ${s.categoria ?? ''}`.toLowerCase().includes(termo))
  const nomesHabilitados = (servicoId: string) => (dados.dados?.habilitacoes ?? [])
    .filter(h => h.servicoId === servicoId)
    .map(h => dados.dados?.profissionais.find(p => p.id === h.profissionalId)?.nome)
    .filter(Boolean)

  return (
    <div>
      <CabecalhoPagina sobretitulo="Catálogo" titulo="Serviços" descricao="A duração padrão preenche novos agendamentos; reservas existentes mantêm a duração original."
        acoes={<button type="button" onClick={() => setEditando('novo')} className="botao botao-primario"><Plus size={18} />Novo serviço</button>} />
      <div className="cartao overflow-hidden">
        <div className="border-b border-border p-4">
          <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-primary">
            <Search size={16} className="text-muted-foreground" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar serviço ou categoria" aria-label="Buscar serviço" className="min-h-11 w-full bg-transparent text-sm outline-none" />
          </label>
        </div>
        {dados.erro ? <div className="p-4"><FalhaCarregamento mensagem={dados.erro} onTentar={dados.recarregar} /></div>
          : !dados.dados ? <Carregando />
          : servicos.length === 0 ? <div className="p-4"><Vazio>{busca ? 'Nenhum serviço encontrado.' : 'Nenhum serviço cadastrado.'}</Vazio></div>
          : (
            <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {servicos.map(s => {
                const nomes = nomesHabilitados(s.id)
                return (
                  <button key={s.id} type="button" onClick={() => setEditando(s)} className={`rounded-xl border border-border bg-card p-4 text-left transition hover:border-accent hover:shadow-md ${s.ativo ? '' : 'opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold">{s.nome}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.ativo ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>{s.ativo ? 'Ativo' : 'Inativo'}</span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{s.duracaoMinutos} minutos{s.categoria ? ` · ${s.categoria}` : ''}</div>
                    <div className="mt-2 text-xs text-muted-foreground">{nomes.length ? nomes.join(', ') : 'Nenhum profissional habilitado'}</div>
                  </button>
                )
              })}
            </div>
          )}
      </div>
      {editando && dados.dados && (
        <ServicoModal servico={editando === 'novo' ? undefined : editando} profissionais={dados.dados.profissionais} habilitacoes={dados.dados.habilitacoes}
          onFechar={() => setEditando(null)} onSalvo={() => { avisar(editando === 'novo' ? 'Serviço cadastrado.' : 'Serviço atualizado.'); setEditando(null); dados.recarregar() }} />
      )}
    </div>
  )
}

function ServicoModal({ servico, profissionais, habilitacoes, onSalvo, onFechar }: {
  servico?: Servico; profissionais: Profissional[]; habilitacoes: Habilitacao[]; onSalvo: () => void; onFechar: () => void
}) {
  const atuais = servico ? habilitacoes.filter(h => h.servicoId === servico.id) : []
  const [form, setForm] = useState({ nome: servico?.nome ?? '', duracao: String(servico?.duracaoMinutos ?? 60), categoria: servico?.categoria ?? '', descricao: servico?.descricao ?? '', ativo: servico?.ativo ?? true })
  const [marcados, setMarcados] = useState(() => new Set(atuais.map(h => h.profissionalId)))
  const [idSalvo, setIdSalvo] = useState(servico?.id)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    const duracaoMinutos = Number(form.duracao)
    if (!form.nome.trim()) { setErro('Informe o nome do serviço.'); return }
    if (!Number.isInteger(duracaoMinutos) || duracaoMinutos <= 0 || duracaoMinutos > 720) { setErro('A duração deve ser um número inteiro de minutos, maior que zero e até 720.'); return }
    setSalvando(true)
    setErro('')
    try {
      // Guarda o id após a primeira gravação: se as habilitações falharem, tentar de novo não duplica o serviço.
      const salvo = await salvarServico({ id: idSalvo, nome: form.nome, duracaoMinutos, categoria: form.categoria, descricao: form.descricao, ativo: form.ativo })
      setIdSalvo(salvo.id)
      const vigentes = idSalvo === servico?.id ? atuais : (await listarHabilitacoes()).filter(h => h.servicoId === salvo.id)
      await definirHabilitacoes(vigentes, [...marcados].map(profissionalId => ({ profissionalId, servicoId: salvo.id })))
      onSalvo()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={servico ? 'Editar serviço' : 'Novo serviço'} onFechar={onFechar} bloqueado={salvando} largura="lg">
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Nome do serviço<input className="campo" required maxLength={120} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="rotulo">Duração padrão (minutos)<input className="campo" type="number" required min={1} max={720} value={form.duracao} onChange={e => setForm({ ...form, duracao: e.target.value })} /></label>
          <label className="rotulo">Categoria (opcional)<input className="campo" maxLength={60} placeholder="Ex.: Cílios" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} /></label>
        </div>
        <label className="rotulo">Descrição curta (opcional)<textarea className="campo resize-none" rows={2} maxLength={300} value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} /></label>
        {servico && servico.duracaoMinutos !== Number(form.duracao) && <p className="alerta-info">A nova duração vale para os próximos agendamentos. Reservas já existentes não mudam.</p>}
        <fieldset>
          <legend className="rotulo mb-2">Profissionais habilitados</legend>
          {profissionais.length === 0 ? <p className="text-sm text-muted-foreground">Cadastre profissionais primeiro.</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {profissionais.map(p => (
                <label key={p.id} className={`flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm ${p.ativo ? '' : 'opacity-60'}`}>
                  <input type="checkbox" className="h-4 w-4" checked={marcados.has(p.id)}
                    onChange={e => setMarcados(atual => { const novo = new Set(atual); if (e.target.checked) novo.add(p.id); else novo.delete(p.id); return novo })} />
                  {p.nome}{p.ativo ? '' : ' (inativo)'}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />Serviço ativo para novos agendamentos</label>
        {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar serviço</button>
        </div>
      </form>
    </Modal>
  )
}

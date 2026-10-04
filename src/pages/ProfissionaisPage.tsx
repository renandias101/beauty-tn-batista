import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { Modal } from '../components/Modal'
import { NOMES_DIAS, agoraNoFuso, dataCurta } from '../lib/datas'
import { mensagemDeErro } from '../lib/erros'
import { formatarTelefone } from '../lib/telefone'
import { useCarregar } from '../lib/useCarregar'
import { definirHabilitacoes, listarHabilitacoes, listarProfissionais, listarServicos, salvarProfissional } from '../services/cadastros'
import { criarExcecao, listarDisponibilidades, listarExcecoes, removerExcecao, salvarJornada } from '../services/jornada'
import type { FaixaJornada, Habilitacao, Profissional, Servico } from '../types'

const CORES = ['#9A6A20', '#7F9877', '#B68B5D', '#806456', '#8B789B', '#6D8FA3', '#A56F75', '#8C8C63', '#9C7664', '#708B84']

export function ProfissionaisPage() {
  const avisar = useAvisos()
  const dados = useCarregar(async () => {
    const [profissionais, servicos, habilitacoes] = await Promise.all([listarProfissionais(), listarServicos(), listarHabilitacoes()])
    return { profissionais, servicos, habilitacoes }
  }, [])
  const [selecionadoId, setSelecionadoId] = useState('')
  const [editando, setEditando] = useState<Profissional | 'novo' | null>(null)

  const profissionais = [...(dados.dados?.profissionais ?? [])].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome))
  const selecionado = profissionais.find(p => p.id === selecionadoId) ?? profissionais[0]

  return (
    <div>
      <CabecalhoPagina sobretitulo="Equipe" titulo="Profissionais" descricao="Cadastre a equipe, os serviços habilitados e a jornada de cada profissional."
        acoes={<button type="button" onClick={() => setEditando('novo')} className="botao botao-primario"><Plus size={18} />Novo profissional</button>} />
      {dados.erro ? <FalhaCarregamento mensagem={dados.erro} onTentar={dados.recarregar} /> : !dados.dados ? <Carregando /> : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <nav className="cartao max-h-[40dvh] self-start overflow-y-auto p-3 lg:max-h-none" aria-label="Profissionais">
            {profissionais.length === 0 && <Vazio>Nenhum profissional cadastrado.</Vazio>}
            {profissionais.map(p => (
              <button key={p.id} type="button" onClick={() => setSelecionadoId(p.id)} aria-current={selecionado?.id === p.id ? 'true' : undefined}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left ${selecionado?.id === p.id ? 'bg-secondary' : 'hover:bg-muted'} ${p.ativo ? '' : 'opacity-60'}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: p.cor }}>{p.nome.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.nome}</span><span className="block text-xs text-muted-foreground">{p.ativo ? 'Ativo' : 'Inativo'}</span></span>
              </button>
            ))}
          </nav>
          {selecionado && (
            <DetalheProfissional key={selecionado.id} profissional={selecionado} servicos={dados.dados.servicos} habilitacoes={dados.dados.habilitacoes}
              onEditar={() => setEditando(selecionado)} onHabilitacoesSalvas={dados.recarregar} />
          )}
        </div>
      )}
      {editando && (
        <ProfissionalModal profissional={editando === 'novo' ? undefined : editando} onFechar={() => setEditando(null)}
          onSalvo={p => { avisar(editando === 'novo' ? 'Profissional cadastrado.' : 'Dados atualizados.'); setEditando(null); setSelecionadoId(p.id); dados.recarregar() }} />
      )}
    </div>
  )
}

function ProfissionalModal({ profissional, onSalvo, onFechar }: { profissional?: Profissional; onSalvo: (p: Profissional) => void; onFechar: () => void }) {
  const [form, setForm] = useState({ nome: profissional?.nome ?? '', telefone: profissional?.telefone ?? '', cor: profissional?.cor ?? CORES[0], ativo: profissional?.ativo ?? true })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (!form.nome.trim()) { setErro('Informe o nome.'); return }
    setSalvando(true)
    setErro('')
    try {
      onSalvo(await salvarProfissional({ id: profissional?.id, ...form }))
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={profissional ? 'Editar profissional' : 'Novo profissional'} onFechar={onFechar} bloqueado={salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Nome<input className="campo" required maxLength={120} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
        <label className="rotulo">Contato (telefone)<input className="campo" inputMode="tel" maxLength={20} value={form.telefone} onChange={e => setForm({ ...form, telefone: formatarTelefone(e.target.value) })} /></label>
        <fieldset>
          <legend className="rotulo mb-2">Cor na agenda</legend>
          <div className="flex flex-wrap gap-2">
            {CORES.map(cor => <button key={cor} type="button" aria-label={`Cor ${cor}`} aria-pressed={form.cor === cor} onClick={() => setForm({ ...form, cor })}
              className={`h-8 w-8 rounded-full border-2 ${form.cor === cor ? 'border-foreground' : 'border-transparent'}`} style={{ backgroundColor: cor }} />)}
          </div>
        </fieldset>
        {profissional && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
            <span>Ativo para novos agendamentos<span className="block text-xs text-muted-foreground">Inativar preserva os registros. Reservas futuras precisam ser reagendadas ou canceladas antes.</span></span>
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

function DetalheProfissional({ profissional, servicos, habilitacoes, onEditar, onHabilitacoesSalvas }: {
  profissional: Profissional; servicos: Servico[]; habilitacoes: Habilitacao[]; onEditar: () => void; onHabilitacoesSalvas: () => void
}) {
  return (
    <div className="space-y-6">
      <section className="cartao flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: profissional.cor }} />
          <div>
            <h2 className="titulo text-2xl">{profissional.nome}</h2>
            <p className="text-sm text-muted-foreground">{profissional.telefone || 'Sem contato cadastrado'} · {profissional.ativo ? 'Ativo' : 'Inativo'} · {profissional.usuarioId ? 'Com acesso ao sistema' : 'Sem usuário de acesso'}</p>
          </div>
        </div>
        <button type="button" onClick={onEditar} className="botao botao-secundario botao-pequeno">Editar dados</button>
      </section>
      <ServicosHabilitados profissional={profissional} servicos={servicos} habilitacoes={habilitacoes} onSalvo={onHabilitacoesSalvas} />
      <EditorJornada profissionalId={profissional.id} />
      <Excecoes profissionalId={profissional.id} />
    </div>
  )
}

function ServicosHabilitados({ profissional, servicos, habilitacoes, onSalvo }: { profissional: Profissional; servicos: Servico[]; habilitacoes: Habilitacao[]; onSalvo: () => void }) {
  const avisar = useAvisos()
  const atuais = habilitacoes.filter(h => h.profissionalId === profissional.id)
  const [marcados, setMarcados] = useState(() => new Set(atuais.map(h => h.servicoId)))
  const [salvando, setSalvando] = useState(false)
  const alterado = marcados.size !== atuais.length || atuais.some(h => !marcados.has(h.servicoId))

  const salvar = async () => {
    setSalvando(true)
    try {
      await definirHabilitacoes(atuais, [...marcados].map(servicoId => ({ profissionalId: profissional.id, servicoId })))
      avisar('Serviços habilitados atualizados.')
      onSalvo()
    } catch (falha) {
      avisar(mensagemDeErro(falha), 'erro')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="cartao p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="titulo text-lg">Serviços habilitados</h3><p className="text-sm text-muted-foreground">Somente serviços marcados podem ser agendados com este profissional.</p></div>
        <button type="button" onClick={salvar} disabled={!alterado || salvando} className="botao botao-primario botao-pequeno">{salvando && <Loader2 size={14} className="animate-spin" />}Salvar serviços</button>
      </div>
      {servicos.length === 0 ? <Vazio>Cadastre serviços na tela Serviços.</Vazio> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {servicos.map(s => (
            <label key={s.id} className={`flex items-center gap-2 rounded-lg border border-border p-3 text-sm ${s.ativo ? '' : 'opacity-60'}`}>
              <input type="checkbox" className="h-4 w-4" checked={marcados.has(s.id)}
                onChange={e => setMarcados(atual => { const novo = new Set(atual); if (e.target.checked) novo.add(s.id); else novo.delete(s.id); return novo })} />
              <span>{s.nome} <span className="text-muted-foreground">· {s.duracaoMinutos} min{s.ativo ? '' : ' · inativo'}</span></span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

function EditorJornada({ profissionalId }: { profissionalId: string }) {
  const avisar = useAvisos()
  const carregada = useCarregar(() => listarDisponibilidades(profissionalId), [profissionalId])
  const [faixas, setFaixas] = useState<FaixaJornada[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { if (carregada.dados) setFaixas(carregada.dados.map(({ diaSemana, horaInicio, horaFim }) => ({ diaSemana, horaInicio, horaFim }))) }, [carregada.dados])

  const atualizar = (indice: number, campo: 'horaInicio' | 'horaFim', valor: string) => setFaixas(atual => atual.map((f, i) => i === indice ? { ...f, [campo]: valor } : f))
  const adicionar = (diaSemana: number) => {
    const doDia = faixas.filter(f => f.diaSemana === diaSemana)
    const ultima = doDia[doDia.length - 1]
    setFaixas(atual => [...atual, ultima ? { diaSemana, horaInicio: ultima.horaFim, horaFim: ultima.horaFim < '18:00' ? '18:00' : '23:00' } : { diaSemana, horaInicio: '08:00', horaFim: '18:00' }])
  }

  const salvar = async () => {
    const invalida = faixas.find(f => !f.horaInicio || !f.horaFim || f.horaInicio >= f.horaFim)
    if (invalida) { setErro(`${NOMES_DIAS[invalida.diaSemana]}: cada faixa precisa terminar depois de começar.`); return }
    setSalvando(true)
    setErro('')
    try {
      await salvarJornada(profissionalId, faixas)
      avisar('Jornada salva.')
      carregada.recarregar()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="cartao p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="titulo text-lg">Jornada semanal</h3><p className="text-sm text-muted-foreground">Use duas ou mais faixas no mesmo dia para registrar intervalos (ex.: 08:00–12:00 e 13:00–18:00).</p></div>
        <button type="button" onClick={salvar} disabled={salvando || !carregada.dados} className="botao botao-primario botao-pequeno">{salvando && <Loader2 size={14} className="animate-spin" />}Salvar jornada</button>
      </div>
      {carregada.erro ? <FalhaCarregamento mensagem={carregada.erro} onTentar={carregada.recarregar} /> : !carregada.dados ? <Carregando /> : (
        <div className="space-y-2">
          {NOMES_DIAS.map((nome, dia) => {
            const doDia = faixas.map((f, indice) => ({ f, indice })).filter(({ f }) => f.diaSemana === dia)
            return (
              <div key={dia} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-start">
                <div className="w-36 shrink-0 pt-2 text-sm font-semibold">{nome}</div>
                <div className="flex flex-1 flex-col gap-2">
                  {doDia.length === 0 && <span className="pt-2 text-sm text-muted-foreground">Não atende</span>}
                  {doDia.map(({ f, indice }) => (
                    <div key={indice} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="time" aria-label={`${nome}: início`} className="campo !mt-0 w-auto" value={f.horaInicio} onChange={e => atualizar(indice, 'horaInicio', e.target.value)} />
                      <span className="text-muted-foreground">até</span>
                      <input type="time" aria-label={`${nome}: fim`} className="campo !mt-0 w-auto" value={f.horaFim} onChange={e => atualizar(indice, 'horaFim', e.target.value)} />
                      <button type="button" onClick={() => setFaixas(atual => atual.filter((_, i) => i !== indice))} className="botao botao-texto botao-pequeno" aria-label={`Remover faixa de ${nome}`}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => adicionar(dia)} className="botao botao-texto botao-pequeno self-start"><Plus size={16} />Faixa</button>
              </div>
            )
          })}
        </div>
      )}
      {erro && <p role="alert" className="alerta-erro mt-4">{erro}</p>}
    </section>
  )
}

function Excecoes({ profissionalId }: { profissionalId: string }) {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const hoje = agoraNoFuso(perfil.fusoHorario).data
  const lista = useCarregar(() => listarExcecoes({ profissionalId, aPartirDe: hoje }), [profissionalId])
  const [form, setForm] = useState({ data: hoje, horaInicio: '18:00', horaFim: '20:00', motivo: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const criar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (form.horaInicio >= form.horaFim) { setErro('O horário final deve ser posterior ao inicial.'); return }
    setSalvando(true)
    setErro('')
    try {
      await criarExcecao({ profissionalId, ...form, motivo: form.motivo.trim() })
      avisar('Exceção criada.')
      setForm(atual => ({ ...atual, motivo: '' }))
      lista.recarregar()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const remover = async (id: string) => {
    try {
      await removerExcecao(id)
      avisar('Exceção removida.')
      lista.recarregar()
    } catch (falha) {
      avisar(mensagemDeErro(falha), 'erro')
    }
  }

  return (
    <section className="cartao p-5">
      <h3 className="titulo text-lg">Exceções por data</h3>
      <p className="mb-4 text-sm text-muted-foreground">Abre um período de atendimento fora da jornada habitual. Para folgas e férias, use Bloqueios na agenda.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {lista.erro ? <FalhaCarregamento mensagem={lista.erro} onTentar={lista.recarregar} /> : !lista.dados ? <Carregando />
            : lista.dados.length === 0 ? <Vazio>Nenhuma exceção futura.</Vazio> : (
              <ul className="space-y-2">
                {lista.dados.map(e => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                    <span><span className="font-semibold">{dataCurta(e.data)} · {e.horaInicio} – {e.horaFim}</span>{e.motivo && <span className="text-muted-foreground"> · {e.motivo}</span>}</span>
                    <button type="button" onClick={() => remover(e.id)} className="botao botao-texto botao-pequeno text-error">Remover</button>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <form onSubmit={criar} className="space-y-3 rounded-xl bg-muted p-4">
          <label className="rotulo">Data<input className="campo" type="date" required value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="rotulo">Início<input className="campo" type="time" required value={form.horaInicio} onChange={e => setForm({ ...form, horaInicio: e.target.value })} /></label>
            <label className="rotulo">Fim<input className="campo" type="time" required value={form.horaFim} onChange={e => setForm({ ...form, horaFim: e.target.value })} /></label>
          </div>
          <label className="rotulo">Motivo (opcional)<input className="campo" maxLength={200} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} /></label>
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
          <button type="submit" disabled={salvando} className="botao botao-primario w-full">{salvando && <Loader2 size={16} className="animate-spin" />}Adicionar exceção</button>
        </form>
      </div>
    </section>
  )
}

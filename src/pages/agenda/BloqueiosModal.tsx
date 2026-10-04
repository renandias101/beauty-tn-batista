import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useAvisos } from '../../components/Avisos'
import { Carregando, FalhaCarregamento, Vazio } from '../../components/Basicos'
import { Modal } from '../../components/Modal'
import { agoraNoFuso, dataCurta, instanteNoFuso, somarDias } from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { useCarregar } from '../../lib/useCarregar'
import { criarBloqueio, listarBloqueios, removerBloqueio } from '../../services/jornada'
import type { Bloqueio, Profissional } from '../../types'

/** Folgas, férias, feriados e outras indisponibilidades (seção 5). RN08: reservas afetadas precisam ser resolvidas antes. */
export function BloqueiosModal({ profissionais, profissionalInicial, dataInicial, fuso, onAlterado, onFechar }: {
  profissionais: Profissional[]; profissionalInicial?: string; dataInicial: string; fuso: string; onAlterado: () => void; onFechar: () => void
}) {
  const avisar = useAvisos()
  const [profissionalId, setProfissionalId] = useState(profissionalInicial || profissionais.find(p => p.ativo)?.id || '')
  const hoje = agoraNoFuso(fuso).data
  const bloqueios = useCarregar(
    () => profissionalId ? listarBloqueios({ profissionalId, de: `${somarDias(hoje, -1)}T00:00:00Z`, ate: `${somarDias(hoje, 400)}T00:00:00Z` }) : Promise.resolve([]),
    [profissionalId],
  )
  const [form, setForm] = useState({ dataInicio: dataInicial, dataFim: dataInicial, diaInteiro: false, horaInicio: '12:00', horaFim: '13:00', motivo: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [removendo, setRemovendo] = useState<Bloqueio | null>(null)
  const [motivoRemocao, setMotivoRemocao] = useState('')

  const criar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (form.dataFim < form.dataInicio) { setErro('A data final deve ser igual ou posterior à inicial.'); return }
    if (!form.diaInteiro && form.horaInicio >= form.horaFim) { setErro('O horário final deve ser posterior ao inicial.'); return }
    if (!form.motivo.trim()) { setErro('Informe o motivo do bloqueio.'); return }
    setSalvando(true)
    setErro('')
    try {
      const total = await criarBloqueio({ profissionalId, ...form, motivo: form.motivo.trim() })
      avisar(total > 1 ? `${total} bloqueios criados.` : 'Bloqueio criado.')
      setForm(atual => ({ ...atual, motivo: '' }))
      bloqueios.recarregar()
      onAlterado()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const confirmarRemocao = async () => {
    if (!removendo || salvando) return
    if (motivoRemocao.trim().length < 3) { avisar('Informe o motivo da remoção (mínimo de 3 caracteres).', 'erro'); return }
    setSalvando(true)
    try {
      await removerBloqueio(removendo.id, motivoRemocao.trim())
      avisar('Bloqueio removido. O período foi reaberto.')
      setRemovendo(null)
      setMotivoRemocao('')
      bloqueios.recarregar()
      onAlterado()
    } catch (falha) {
      avisar(mensagemDeErro(falha), 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const descrever = (b: Bloqueio) => {
    const de = instanteNoFuso(b.inicio, fuso)
    const ate = instanteNoFuso(b.fim, fuso)
    if (de.hora === '00:00' && ate.hora === '00:00') {
      const ultimoDia = somarDias(ate.data, -1)
      return ultimoDia === de.data ? `${dataCurta(de.data)} · dia inteiro` : `${dataCurta(de.data)} a ${dataCurta(ultimoDia)} · dias inteiros`
    }
    return de.data === ate.data ? `${dataCurta(de.data)} · ${de.hora} – ${ate.hora}` : `${dataCurta(de.data)} ${de.hora} a ${dataCurta(ate.data)} ${ate.hora}`
  }

  return (
    <Modal titulo="Bloqueios de agenda" descricao="Folgas, férias, feriados e outras indisponibilidades." onFechar={onFechar} bloqueado={salvando} largura="xl">
      <label className="rotulo mb-5 max-w-sm">Profissional
        <select className="campo" value={profissionalId} onChange={e => setProfissionalId(e.target.value)}>
          {profissionais.map(p => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' (inativo)'}</option>)}
        </select>
      </label>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section>
          <h3 className="mb-3 text-sm font-bold">Bloqueios vigentes</h3>
          {bloqueios.carregando && !bloqueios.dados ? <Carregando /> : bloqueios.erro ? <FalhaCarregamento mensagem={bloqueios.erro} onTentar={bloqueios.recarregar} />
            : !bloqueios.dados?.length ? <Vazio>Nenhum bloqueio a partir de hoje.</Vazio> : (
              <ul className="max-h-[50dvh] space-y-2 overflow-y-auto pr-1">
                {bloqueios.dados.map(b => (
                  <li key={b.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><div className="text-sm font-semibold">{descrever(b)}</div><div className="mt-1 text-xs text-muted-foreground">{b.motivo}</div></div>
                      {removendo?.id !== b.id && <button type="button" onClick={() => { setRemovendo(b); setMotivoRemocao('') }} className="botao botao-texto botao-pequeno text-error">Remover</button>}
                    </div>
                    {removendo?.id === b.id && (
                      <div className="mt-3 space-y-2">
                        <label className="rotulo">Motivo da remoção<input className="campo" maxLength={300} autoFocus value={motivoRemocao} onChange={e => setMotivoRemocao(e.target.value)} placeholder="Ex.: Folga cancelada pela profissional" /></label>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setRemovendo(null)} disabled={salvando} className="botao botao-texto botao-pequeno">Voltar</button>
                          <button type="button" onClick={confirmarRemocao} disabled={salvando} className="botao botao-perigo botao-pequeno">Remover bloqueio</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </section>
        <form onSubmit={criar} className="space-y-4 rounded-xl bg-muted p-4">
          <h3 className="text-sm font-bold">Novo bloqueio</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="rotulo">Data inicial<input className="campo" type="date" required value={form.dataInicio} onChange={e => setForm({ ...form, dataInicio: e.target.value, dataFim: e.target.value > form.dataFim ? e.target.value : form.dataFim })} /></label>
            <label className="rotulo">Data final<input className="campo" type="date" required min={form.dataInicio} value={form.dataFim} onChange={e => setForm({ ...form, dataFim: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.diaInteiro} onChange={e => setForm({ ...form, diaInteiro: e.target.checked })} />Dia inteiro (folga, férias, feriado)</label>
          {!form.diaInteiro && (
            <div className="grid grid-cols-2 gap-3">
              <label className="rotulo">Início<input className="campo" type="time" required value={form.horaInicio} onChange={e => setForm({ ...form, horaInicio: e.target.value })} /></label>
              <label className="rotulo">Fim<input className="campo" type="time" required value={form.horaFim} onChange={e => setForm({ ...form, horaFim: e.target.value })} /></label>
            </div>
          )}
          {!form.diaInteiro && form.dataFim > form.dataInicio && <p className="text-xs text-muted-foreground">O mesmo horário será bloqueado em todos os dias do período.</p>}
          <label className="rotulo">Motivo<input className="campo" required maxLength={200} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} placeholder="Ex.: Férias, Curso, Feriado" /></label>
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
          <button type="submit" disabled={salvando || !profissionalId} className="botao botao-primario w-full">{salvando && <Loader2 size={16} className="animate-spin" />}Criar bloqueio</button>
        </form>
      </div>
    </Modal>
  )
}

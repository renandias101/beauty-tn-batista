import { useState, type FormEvent } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, Vazio } from '../components/Basicos'
import { Modal } from '../components/Modal'
import { FORMATO_USUARIO } from '../lib/acesso'
import { dataCurta, instanteNoFuso } from '../lib/datas'
import { mensagemDeErro } from '../lib/erros'
import { useCarregar } from '../lib/useCarregar'
import { listarProfissionais } from '../services/cadastros'
import { atualizarUsuario, criarUsuario, listarUsuarios, redefinirSenha } from '../services/usuarios'
import type { Papel, Profissional, Usuario } from '../types'

const PAPEIS: { valor: Papel; rotulo: string; descricao: string }[] = [
  { valor: 'admin', rotulo: 'Administração', descricao: 'Todas as agendas, cadastros, jornadas, bloqueios, usuários e histórico.' },
  { valor: 'secretaria', rotulo: 'Atendimento', descricao: 'Agendas, clientes, agendamentos, andamento do dia, bloqueios pontuais e histórico dos agendamentos.' },
  { valor: 'profissional', rotulo: 'Profissional', descricao: 'Somente a própria agenda, para consulta.' },
]
const rotuloPapel = (papel: Papel) => PAPEIS.find(p => p.valor === papel)?.rotulo ?? papel

export function UsuariosPage() {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const dados = useCarregar(async () => {
    const [usuarios, profissionais] = await Promise.all([listarUsuarios(), listarProfissionais()])
    return { usuarios, profissionais }
  }, [])
  const [editando, setEditando] = useState<Usuario | 'novo' | null>(null)
  const [senhaDe, setSenhaDe] = useState<Usuario | null>(null)

  return (
    <div>
      <CabecalhoPagina sobretitulo="Acesso" titulo="Usuários" descricao="Cada pessoa tem login individual. Contas desativadas perdem o acesso, mas o histórico é preservado."
        acoes={<button type="button" onClick={() => setEditando('novo')} className="botao botao-primario"><Plus size={18} />Novo usuário</button>} />
      {dados.erro ? <FalhaCarregamento mensagem={dados.erro} onTentar={dados.recarregar} /> : !dados.dados ? <Carregando /> : dados.dados.usuarios.length === 0 ? <Vazio>Nenhum usuário.</Vazio> : (
        <div className="cartao divide-y divide-border">
          {dados.dados.usuarios.map(u => {
            const ultimo = u.ultimoAcesso ? instanteNoFuso(u.ultimoAcesso, perfil.fusoHorario) : null
            return (
              <div key={u.usuarioId} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${u.ativo ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <div className="text-sm font-bold">{u.nome}{u.usuarioId === perfil.usuarioId && <span className="font-normal text-muted-foreground"> (você)</span>}</div>
                  <div className="truncate text-sm text-muted-foreground">Usuário: {u.usuario}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {rotuloPapel(u.papel)}{u.profissionalNome ? ` · ${u.profissionalNome}` : ''} · {u.ativo ? 'Ativo' : 'Desativado'}{ultimo ? ` · Último acesso ${dataCurta(ultimo.data)} ${ultimo.hora}` : ' · Nunca acessou'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSenhaDe(u)} className="botao botao-texto botao-pequeno">Redefinir senha</button>
                  <button type="button" onClick={() => setEditando(u)} className="botao botao-secundario botao-pequeno">Editar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {editando && dados.dados && (
        <UsuarioModal usuario={editando === 'novo' ? undefined : editando} profissionais={dados.dados.profissionais} usuarios={dados.dados.usuarios} proprio={perfil.usuarioId}
          onFechar={() => setEditando(null)} onSalvo={mensagem => { avisar(mensagem); setEditando(null); dados.recarregar() }} />
      )}
      {senhaDe && <SenhaModal usuario={senhaDe} onFechar={() => setSenhaDe(null)} onSalvo={() => { avisar('Senha redefinida.'); setSenhaDe(null) }} />}
    </div>
  )
}

function UsuarioModal({ usuario, profissionais, usuarios, proprio, onSalvo, onFechar }: {
  usuario?: Usuario; profissionais: Profissional[]; usuarios: Usuario[]; proprio: string; onSalvo: (mensagem: string) => void; onFechar: () => void
}) {
  const [form, setForm] = useState({ nome: usuario?.nome ?? '', login: usuario?.usuario ?? '', senha: '', papel: usuario?.papel ?? 'secretaria' as Papel, ativo: usuario?.ativo ?? true, profissionalId: usuario?.profissionalId ?? '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const ehProprio = usuario?.usuarioId === proprio
  // Cada profissional tem no máximo uma conta vinculada.
  const livres = profissionais.filter(p => !usuarios.some(u => u.profissionalId === p.id && u.usuarioId !== usuario?.usuarioId))

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (form.papel === 'profissional' && !form.profissionalId) { setErro('Selecione o profissional vinculado a esta conta.'); return }
    if (!usuario && !FORMATO_USUARIO.test(form.login)) { setErro('Usuário inválido: use de 3 a 30 caracteres entre letras minúsculas, números, ponto, hífen ou sublinhado.'); return }
    if (!usuario && form.senha.length < 8) { setErro('A senha inicial deve ter pelo menos 8 caracteres.'); return }
    setSalvando(true)
    setErro('')
    try {
      const profissionalId = form.papel === 'secretaria' ? null : form.profissionalId || null
      if (usuario) {
        await atualizarUsuario({ usuarioId: usuario.usuarioId, nome: form.nome.trim(), papel: form.papel, ativo: form.ativo, profissionalId })
        onSalvo('Usuário atualizado.')
      } else {
        await criarUsuario({ nome: form.nome.trim(), usuario: form.login.trim().toLowerCase(), senha: form.senha, papel: form.papel, profissionalId })
        onSalvo('Usuário criado. Informe a senha inicial à pessoa por um canal seguro.')
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={usuario ? 'Editar usuário' : 'Novo usuário'} onFechar={onFechar} bloqueado={salvando} largura="lg">
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Nome<input className="campo" required maxLength={120} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
        <label className="rotulo">Usuário de acesso
          <input className="campo" required disabled={Boolean(usuario)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} placeholder="Ex.: maria, recepcao, thais.batista"
            value={form.login} onChange={e => setForm({ ...form, login: e.target.value.toLowerCase().replace(/\s/g, '') })} />
          {!usuario && <span className="mt-1 block font-normal">De 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado. Não pode ser alterado depois.</span>}
        </label>
        {!usuario && <label className="rotulo">Senha inicial<input className="campo" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} /></label>}
        <fieldset className="space-y-2">
          <legend className="rotulo mb-1">Perfil</legend>
          {PAPEIS.map(p => (
            <label key={p.valor} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${form.papel === p.valor ? 'border-primary bg-accent-soft' : 'border-border'}`}>
              <input type="radio" name="papel" className="mt-1" checked={form.papel === p.valor} disabled={ehProprio && p.valor !== 'admin'} onChange={() => setForm({ ...form, papel: p.valor })} />
              <span><span className="font-semibold">{p.rotulo}</span><span className="block text-muted-foreground">{p.descricao}</span></span>
            </label>
          ))}
        </fieldset>
        {(form.papel === 'profissional' || form.papel === 'admin') && (
          <label className="rotulo">{form.papel === 'admin' ? 'Também atende como profissional? (opcional)' : 'Profissional vinculado'}
            <select className="campo" required={form.papel === 'profissional'} value={form.profissionalId} onChange={e => setForm({ ...form, profissionalId: e.target.value })}>
              <option value="">{form.papel === 'admin' ? 'Não atende' : 'Selecione'}</option>
              {livres.map(p => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' (inativo)'}</option>)}
            </select>
            {form.papel === 'admin' && <span className="mt-1 block font-normal">Mantém uma única conta: o vínculo identifica a agenda da pessoa, sem mudar as permissões.</span>}
          </label>
        )}
        {usuario && !ehProprio && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />Acesso ativo</label>}
        {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

function SenhaModal({ usuario, onSalvo, onFechar }: { usuario: Usuario; onSalvo: () => void; onFechar: () => void }) {
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (senha.length < 8) { setErro('A senha deve ter pelo menos 8 caracteres.'); return }
    setSalvando(true)
    setErro('')
    try {
      await redefinirSenha(usuario.usuarioId, senha)
      onSalvo()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }
  return (
    <Modal titulo="Redefinir senha" descricao={`${usuario.nome} · usuário ${usuario.usuario}`} onFechar={onFechar} bloqueado={salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="rotulo">Nova senha<input className="campo" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={senha} onChange={e => setSenha(e.target.value)} /></label>
        {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Redefinir</button>
        </div>
      </form>
    </Modal>
  )
}

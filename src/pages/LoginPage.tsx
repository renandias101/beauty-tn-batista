import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { emailDeAcesso } from '../lib/acesso'
import { mensagemDeErro } from '../lib/erros'
import { sessaoDoNavegador } from '../lib/lembrarAcesso'
import { supabase } from '../lib/supabase'
import { solicitarRedefinicaoSenha } from '../services/usuarios'

export function LoginPage() {
  const [usuario, setUsuario] = useState('')
  const [esqueci, setEsqueci] = useState(false)

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="cartao animar-modal w-full max-w-sm p-6 sm:p-8">
        <div className="marca mb-6"><img src="/brand/clinica-beauty.svg" alt="Clínica Beauty" width="80" height="80" /></div>
        {esqueci
          ? <EsqueciSenha usuarioInicial={usuario} onVoltar={() => setEsqueci(false)} />
          : <Entrada usuario={usuario} onUsuario={setUsuario} onEsqueci={() => setEsqueci(true)} />}
        <p className="mt-5 text-center text-sm"><a href="#/horarios" className="font-semibold text-primary hover:underline">Consultar horários disponíveis</a></p>
      </div>
    </div>
  )
}

function Entrada({ usuario, onUsuario, onEsqueci }: { usuario: string; onUsuario: (valor: string) => void; onEsqueci: () => void }) {
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [lembrar, setLembrar] = useState(sessaoDoNavegador.lembrar)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const entrar = async (evento: FormEvent) => {
    evento.preventDefault()
    setEnviando(true)
    setErro('')
    // Define onde a sessão será guardada antes de ela ser criada.
    sessaoDoNavegador.definirLembrar(lembrar)
    const { error } = await supabase.auth.signInWithPassword({ email: emailDeAcesso(usuario), password: senha })
    setEnviando(false)
    if (!error) return
    if (/invalid login credentials/i.test(error.message)) setErro('Usuário ou senha incorretos.')
    else if (/banned|disabled/i.test(error.message)) setErro('Este acesso está desativado. Procure a administração.')
    else if (/fetch|network/i.test(error.message)) setErro('Sem conexão com o servidor. Verifique a internet.')
    else setErro('Não foi possível entrar. Tente novamente.')
  }

  return (
    <form onSubmit={entrar}>
      <h1 className="titulo text-center text-2xl">Agenda da clínica</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">Entre com seu acesso individual.</p>
      <div className="mt-6 space-y-4">
        <label className="rotulo">Usuário<input className="campo" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={usuario} onChange={e => onUsuario(e.target.value)} /></label>
        <div>
          <label htmlFor="senha" className="rotulo">Senha</label>
          <div className="relative">
            <input id="senha" className="campo pr-12" type={mostrarSenha ? 'text' : 'password'} autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
            <button type="button" onClick={() => setMostrarSenha(atual => !atual)} aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={mostrarSenha} aria-controls="senha"
              className="absolute right-1 bottom-0 top-1.5 grid w-10 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
              {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={lembrar} onChange={e => setLembrar(e.target.checked)} />Lembrar de mim
        </label>
        <button type="button" onClick={onEsqueci} className="font-semibold text-primary hover:underline">Esqueci a senha</button>
      </div>
      {erro && <p role="alert" className="alerta-erro mt-4">{erro}</p>}
      <button type="submit" disabled={enviando} className="botao botao-primario mt-6 w-full">{enviando && <Loader2 size={16} className="animate-spin" />}Entrar</button>
    </form>
  )
}

function EsqueciSenha({ usuarioInicial, onVoltar }: { usuarioInicial: string; onVoltar: () => void }) {
  const [usuario, setUsuario] = useState(usuarioInicial)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando) return
    setEnviando(true)
    setErro('')
    try {
      await solicitarRedefinicaoSenha(usuario.trim())
      setEnviado(true)
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setEnviando(false)
    }
  }

  if (enviado) {
    return (
      <div>
        <h1 className="titulo text-center text-2xl">Pedido enviado</h1>
        {/* Mesma mensagem para qualquer usuário digitado: a tela não revela quais contas existem. */}
        <p role="status" className="alerta-info mt-6">
          Se o usuário estiver ativo, a administração da clínica foi avisada. Ela vai criar uma nova senha e repassá-la a você pessoalmente ou por um canal seguro.
        </p>
        <button type="button" onClick={onVoltar} className="botao botao-primario mt-6 w-full">Voltar para a entrada</button>
      </div>
    )
  }

  return (
    <form onSubmit={enviar}>
      <h1 className="titulo text-center text-2xl">Esqueci a senha</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">Informe seu usuário. A administração será avisada para criar uma nova senha.</p>
      <label className="rotulo mt-6">Usuário<input className="campo" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} autoFocus value={usuario} onChange={e => setUsuario(e.target.value)} /></label>
      {erro && <p role="alert" className="alerta-erro mt-4">{erro}</p>}
      <button type="submit" disabled={enviando} className="botao botao-primario mt-6 w-full">{enviando && <Loader2 size={16} className="animate-spin" />}Avisar a administração</button>
      <button type="button" onClick={onVoltar} disabled={enviando} className="botao botao-texto mt-2 w-full">Voltar para a entrada</button>
    </form>
  )
}

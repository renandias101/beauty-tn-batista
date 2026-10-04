import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { emailDeAcesso } from '../lib/acesso'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const entrar = async (evento: FormEvent) => {
    evento.preventDefault()
    setEnviando(true)
    setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email: emailDeAcesso(usuario), password: senha })
    setEnviando(false)
    if (!error) return
    if (/invalid login credentials/i.test(error.message)) setErro('Usuário ou senha incorretos.')
    else if (/banned|disabled/i.test(error.message)) setErro('Este acesso está desativado. Procure a administração.')
    else if (/fetch|network/i.test(error.message)) setErro('Sem conexão com o servidor. Verifique a internet.')
    else setErro('Não foi possível entrar. Tente novamente.')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <form onSubmit={entrar} className="cartao animar-modal w-full max-w-sm p-6 sm:p-8">
        <div className="marca mb-6"><img src="/brand/clinica-beauty.svg" alt="Clínica Beauty" width="80" height="80" /></div>
        <h1 className="titulo text-center text-2xl">Agenda da clínica</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Entre com seu acesso individual.</p>
        <div className="mt-6 space-y-4">
          <label className="rotulo">Usuário<input className="campo" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={usuario} onChange={e => setUsuario(e.target.value)} /></label>
          <label className="rotulo">Senha<input className="campo" type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} /></label>
        </div>
        {erro && <p role="alert" className="alerta-erro mt-4">{erro}</p>}
        <button type="submit" disabled={enviando} className="botao botao-primario mt-6 w-full">{enviando && <Loader2 size={16} className="animate-spin" />}Entrar</button>
        <p className="mt-5 text-center text-sm"><a href="#/horarios" className="font-semibold text-primary hover:underline">Consultar horários disponíveis</a></p>
      </form>
    </div>
  )
}

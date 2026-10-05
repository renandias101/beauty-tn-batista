import { createClient } from '@supabase/supabase-js'
import { sessaoDoNavegador } from './lembrarAcesso'
import { modoDemo } from './modoDemo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigurado = modoDemo || Boolean(url && chave)

// Sem configuração, a aplicação mostra um aviso em vez de tentar acessar o banco.
// Na demonstração o cliente aponta para um endereço inexistente: nenhum dado fictício chega ao banco real.
export const supabase = modoDemo
  ? createClient('https://demonstracao.invalid', 'modo-demonstracao', { auth: { persistSession: false, autoRefreshToken: false } })
  : createClient(url || 'http://localhost', chave || 'nao-configurado', { auth: { storage: sessaoDoNavegador.armazenamento } })

// Saída feita em outra aba (sessão não lembrada): esta aba recarrega e volta para a tela de entrada.
if (!modoDemo && typeof window !== 'undefined') sessaoDoNavegador.aoEncerrarEmOutraAba(() => window.location.reload())

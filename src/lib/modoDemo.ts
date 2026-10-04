// Modo demonstração: só existe quando a aplicação é gerada com `--mode demo` (arquivo .env.demo).
// Nesse modo todos os dados são fictícios e ficam no navegador; nada é lido ou gravado no Supabase.
export const modoDemo = import.meta.env.VITE_MODO_DEMO === 'true'

export const MENSAGEM_DEMO = 'Modo demonstração — dados fictícios'

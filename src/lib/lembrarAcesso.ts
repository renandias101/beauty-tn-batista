// "Lembrar de mim" na tela de entrada.
// Marcado: a sessão fica no localStorage e continua após fechar o navegador.
// Desmarcado (padrão, mais seguro em computador compartilhado da recepção): fica no sessionStorage de cada aba e
// termina quando a última aba do sistema é fechada. As abas abertas compartilham a sessão por um canal do próprio
// navegador (BroadcastChannel, somente da mesma origem): uma aba nova pede a sessão às abertas, e renovações e saídas
// são repassadas a todas. Sem isso, cada aba pediria login de novo e as renovações de uma invalidariam as outras.
// Sessões gravadas antes desta opção continuam sendo lidas; na próxima renovação do token passam a seguir a opção atual.

export const CHAVE_LEMBRAR_ACESSO = 'beauty-tn-batista:lembrar-acesso'
export const NOME_CANAL_SESSAO = 'beauty-tn-batista:sessao'

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface Canal { postMessage(mensagem: unknown): void; onmessage: ((evento: { data: unknown }) => void) | null }
type Mensagem =
  | { tipo: 'pedir'; chave: string; pedido: string }
  | { tipo: 'resposta'; pedido: string; valor: string }
  | { tipo: 'gravar'; chave: string; valor: string }
  | { tipo: 'remover'; chave: string }

// Navegador com armazenamento bloqueado (modo privado restrito, por exemplo) não deve impedir a entrada.
const tentar = <T,>(acao: () => T, padrao: T): T => { try { return acao() } catch { return padrao } }
// Só a sessão do Supabase é compartilhada; outras chaves do cliente ficam na própria aba.
const ehSessao = (chave: string) => chave.endsWith('-auth-token')

export function criarArmazenamentoSessao(local: Armazenamento | undefined, sessao: Armazenamento | undefined, canal?: Canal, esperaMs = 150) {
  const lembrar = () => tentar(() => local?.getItem(CHAVE_LEMBRAR_ACESSO) === '1', false)
  const definirLembrar = (valor: boolean) => tentar(() => valor ? local?.setItem(CHAVE_LEMBRAR_ACESSO, '1') : local?.removeItem(CHAVE_LEMBRAR_ACESSO), undefined)
  const enviar = (mensagem: Mensagem) => tentar(() => canal?.postMessage(mensagem), undefined)
  const esperando = new Map<string, (valor: string) => void>()
  let aoEncerrarEmOutraAba: (() => void) | null = null
  let sequencia = 0

  if (canal) {
    canal.onmessage = ({ data }) => {
      const m = data as Mensagem
      if (m.tipo === 'pedir') {
        // Responde só quem guarda a sessão na aba; com "lembrar" marcado as abas já leem o mesmo localStorage.
        const valor = tentar(() => sessao?.getItem(m.chave) ?? null, null)
        if (valor !== null && !lembrar()) enviar({ tipo: 'resposta', pedido: m.pedido, valor })
      } else if (m.tipo === 'resposta') {
        esperando.get(m.pedido)?.(m.valor)
      } else if (m.tipo === 'gravar') {
        if (!lembrar()) tentar(() => sessao?.setItem(m.chave, m.valor), undefined)
      } else if (m.tipo === 'remover') {
        // Saída em outra aba: esta aba também encerra (sem repassar de novo, para não criar um ciclo).
        const tinha = tentar(() => sessao?.getItem(m.chave) ?? null, null) !== null
        tentar(() => sessao?.removeItem(m.chave), undefined)
        if (tinha) aoEncerrarEmOutraAba?.()
      }
    }
  }

  /** Pede a sessão às outras abas abertas; sem resposta no prazo, segue sem sessão. */
  const pedirAsOutrasAbas = (chave: string) => new Promise<string | null>(resolver => {
    const pedido = `${Date.now()}-${++sequencia}`
    const prazo = setTimeout(() => { esperando.delete(pedido); resolver(null) }, esperaMs)
    esperando.set(pedido, valor => {
      clearTimeout(prazo)
      esperando.delete(pedido)
      tentar(() => sessao?.setItem(chave, valor), undefined)
      resolver(valor)
    })
    enviar({ tipo: 'pedir', chave, pedido })
  })

  // Adaptador usado pelo cliente do Supabase: cada chave da sessão fica em um único lugar, conforme a opção.
  const armazenamento = {
    getItem: (chave: string): string | null | Promise<string | null> => {
      const valor = tentar(() => sessao?.getItem(chave) ?? local?.getItem(chave) ?? null, null)
      if (valor !== null || !canal || lembrar() || !ehSessao(chave)) return valor
      return pedirAsOutrasAbas(chave)
    },
    setItem: (chave: string, valor: string) => {
      const guardarNaAba = !lembrar()
      const [destino, outro] = guardarNaAba ? [sessao, local] : [local, sessao]
      tentar(() => outro?.removeItem(chave), undefined)
      tentar(() => destino?.setItem(chave, valor), undefined)
      if (guardarNaAba && ehSessao(chave)) enviar({ tipo: 'gravar', chave, valor })
    },
    removeItem: (chave: string) => {
      tentar(() => sessao?.removeItem(chave), undefined)
      tentar(() => local?.removeItem(chave), undefined)
      if (ehSessao(chave)) enviar({ tipo: 'remover', chave })
    },
  }

  return { lembrar, definirLembrar, armazenamento, aoEncerrarEmOutraAba: (acao: () => void) => { aoEncerrarEmOutraAba = acao } }
}

const doNavegador = (nome: 'localStorage' | 'sessionStorage') => tentar(() => (typeof window === 'undefined' ? undefined : window[nome]), undefined)
const canalDoNavegador = () => tentar(() => (typeof BroadcastChannel === 'undefined' || typeof window === 'undefined' ? undefined : new BroadcastChannel(NOME_CANAL_SESSAO) as unknown as Canal), undefined)

export const sessaoDoNavegador = criarArmazenamentoSessao(doNavegador('localStorage'), doNavegador('sessionStorage'), canalDoNavegador())

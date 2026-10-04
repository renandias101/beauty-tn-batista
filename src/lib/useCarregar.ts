import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemDeErro } from './erros'

/**
 * Carrega dados do servidor e expõe recarregar(). Com aoFocar, recarrega quando a janela volta ao foco,
 * para que alterações feitas por outros usuários apareçam sem envio manual (seção 8 do PRD).
 * Com limparAoMudar, o resultado anterior é descartado assim que as dependências mudam, para nunca
 * exibir dados de uma seleção anterior enquanto a nova consulta não chega.
 */
export function useCarregar<T>(carregar: () => Promise<T>, dependencias: unknown[], opcoes: { aoFocar?: boolean; limparAoMudar?: boolean } = {}) {
  const [dados, setDados] = useState<T | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const funcao = useRef(carregar)
  funcao.current = carregar
  const ultimaChamada = useRef(0)

  const recarregar = useCallback(async () => {
    const chamada = ++ultimaChamada.current
    setCarregando(true)
    try {
      const resultado = await funcao.current()
      // Ignora respostas antigas quando o usuário já trocou de data ou filtro.
      if (chamada === ultimaChamada.current) { setDados(resultado); setErro(null) }
    } catch (falha) {
      if (chamada === ultimaChamada.current) setErro(mensagemDeErro(falha))
    } finally {
      if (chamada === ultimaChamada.current) setCarregando(false)
    }
  }, [])

  // As dependências são as do chamador (data, filtros), não as da função.
  useEffect(() => {
    if (opcoes.limparAoMudar) { setDados(null); setErro(null) }
    recarregar()
  }, dependencias)

  useEffect(() => {
    if (!opcoes.aoFocar) return
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregar() }
    window.addEventListener('focus', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { window.removeEventListener('focus', aoVoltar); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [opcoes.aoFocar, recarregar])

  return { dados, carregando, erro, recarregar }
}

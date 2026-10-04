import { useEffect, useRef, useState } from 'react'
import { CHAVE_DADOS_DEMO } from '../demo/estado'
import { modoDemo } from './modoDemo'
import { supabase } from './supabase'

/**
 * ao_vivo: alterações feitas em outros computadores chegam em segundos (Supabase Realtime).
 * alternativo: a conexão em tempo real falhou; a agenda é consultada de novo periodicamente até reconectar.
 */
export type EstadoSincronizacao = 'conectando' | 'ao_vivo' | 'alternativo'

const INTERVALO_ALTERNATIVO = 30_000

/**
 * Escuta o sinal de atualização da agenda (tabela agenda_revisoes, sem dados de clientes) e chama aoMudar.
 * Os dados são recarregados pelas funções que já aplicam as permissões de cada perfil; o sinal só avisa que mudou.
 * Na demonstração, o sinal é a gravação dos dados fictícios em outra aba do mesmo navegador.
 */
export function useSincronizacaoAgenda(aoMudar: () => void): EstadoSincronizacao {
  const [estado, setEstado] = useState<EstadoSincronizacao>(modoDemo ? 'ao_vivo' : 'conectando')
  const callback = useRef(aoMudar)
  callback.current = aoMudar

  useEffect(() => {
    let espera: number | undefined
    // Várias alterações seguidas (ex.: reagendar mexe em duas agendas) geram uma única recarga.
    const avisar = () => { window.clearTimeout(espera); espera = window.setTimeout(() => callback.current(), 400) }

    if (modoDemo) {
      const aoGravarEmOutraAba = (evento: StorageEvent) => { if (evento.key === CHAVE_DADOS_DEMO) avisar() }
      window.addEventListener('storage', aoGravarEmOutraAba)
      return () => { window.removeEventListener('storage', aoGravarEmOutraAba); window.clearTimeout(espera) }
    }

    let conectadoAntes = false
    const canal = supabase
      .channel(`agenda-revisoes-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_revisoes' }, avisar)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          // Ao reconectar, busca o que pode ter mudado enquanto a conexão estava fora.
          if (conectadoAntes) avisar()
          conectadoAntes = true
          setEstado('ao_vivo')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setEstado('alternativo')
        }
      })
    // Se a conexão não se estabelecer (rede ou firewall), passa para a atualização alternativa.
    const limite = window.setTimeout(() => setEstado(atual => atual === 'conectando' ? 'alternativo' : atual), 15_000)
    return () => { window.clearTimeout(espera); window.clearTimeout(limite); supabase.removeChannel(canal) }
  }, [])

  // Atualização alternativa enquanto o tempo real não estiver disponível.
  useEffect(() => {
    if (estado !== 'alternativo') return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') callback.current() }, INTERVALO_ALTERNATIVO)
    return () => window.clearInterval(id)
  }, [estado])

  return estado
}

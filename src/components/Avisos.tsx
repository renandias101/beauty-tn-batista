import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

type TipoAviso = 'sucesso' | 'erro'
interface Aviso { id: number; mensagem: string; tipo: TipoAviso }

const Contexto = createContext<(mensagem: string, tipo?: TipoAviso) => void>(() => {})

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const avisar = useCallback((mensagem: string, tipo: TipoAviso = 'sucesso') => {
    const id = Date.now() + Math.random()
    setAvisos(atuais => [...atuais, { id, mensagem, tipo }])
    window.setTimeout(() => setAvisos(atuais => atuais.filter(aviso => aviso.id !== id)), tipo === 'erro' ? 9000 : 5000)
  }, [])

  return (
    <Contexto.Provider value={avisar}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[24rem]">
        {avisos.map(aviso => (
          <div key={aviso.id} role={aviso.tipo === 'erro' ? 'alert' : 'status'} className="animar-aviso pointer-events-auto flex w-full items-start gap-3 rounded-xl bg-foreground px-5 py-4 text-sm font-semibold text-primary-foreground shadow-xl">
            {aviso.tipo === 'erro' ? <XCircle size={20} className="mt-0.5 shrink-0 text-[#F2A79F]" /> : <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[#9FD0AE]" />}
            <span>{aviso.mensagem}</span>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}

export const useAvisos = () => useContext(Contexto)

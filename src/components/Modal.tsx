import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  titulo: string
  descricao?: string
  onFechar: () => void
  children: ReactNode
  rodape?: ReactNode
  largura?: 'md' | 'lg' | 'xl'
  /** Impede fechar por Esc ou clique fora enquanto uma gravação está em andamento. */
  bloqueado?: boolean
}

const larguras = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
const pilha: string[] = []

export function Modal({ titulo, descricao, onFechar, children, rodape, largura = 'md', bloqueado }: Props) {
  const idTitulo = useId()
  const caixa = useRef<HTMLDivElement>(null)
  const fechar = useRef(onFechar)
  fechar.current = onFechar

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    caixa.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-fechar])')?.focus()
    return () => anterior?.focus()
  }, [])

  useEffect(() => {
    pilha.push(idTitulo)
    return () => { pilha.splice(pilha.indexOf(idTitulo), 1) }
  }, [idTitulo])

  useEffect(() => {
    // Com modais empilhados, o Esc fecha somente o que está por cima.
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !bloqueado && pilha[pilha.length - 1] === idTitulo) fechar.current()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [bloqueado, idTitulo])

  // Renderizado no body para cobrir menu e cabeçalho, fora do contexto de empilhamento da página.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgb(51_42_34/.34)] p-3 sm:p-6" onMouseDown={evento => { if (evento.target === evento.currentTarget && !bloqueado) onFechar() }}>
      <div ref={caixa} role="dialog" aria-modal="true" aria-labelledby={idTitulo} className={`animar-modal flex max-h-[calc(100dvh-1.5rem)] w-full ${larguras[largura]} flex-col rounded-2xl border border-border bg-card shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id={idTitulo} className="titulo text-xl sm:text-2xl">{titulo}</h2>
            {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
          </div>
          <button type="button" data-fechar onClick={onFechar} disabled={bloqueado} aria-label="Fechar" className="botao botao-texto botao-pequeno -mr-2"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {rodape && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4 sm:px-6">{rodape}</div>}
      </div>
    </div>,
    document.body,
  )
}

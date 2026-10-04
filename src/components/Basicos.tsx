import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { STATUS } from '../lib/status'
import type { StatusAgendamento } from '../types'

export function CabecalhoPagina({ sobretitulo, titulo, descricao, acoes }: { sobretitulo: string; titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end lg:mb-8">
      <div>
        <div className="sobretitulo mb-2">{sobretitulo}</div>
        <h1 className="titulo text-3xl lg:text-4xl">{titulo}</h1>
        {descricao && <p className="mt-2 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  )
}

export function SeloStatus({ status }: { status: StatusAgendamento }) {
  const { rotulo, classes } = STATUS[status]
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${classes}`}>{rotulo}</span>
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 size={18} className="animate-spin text-primary" />{texto}</div>
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-muted p-8 text-center text-sm text-muted-foreground">{children}</div>
}

export function FalhaCarregamento({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-error-soft p-8 text-center text-sm text-error">
      <AlertTriangle size={22} />
      <p>{mensagem}</p>
      <button type="button" onClick={onTentar} className="botao botao-secundario botao-pequeno">Tentar novamente</button>
    </div>
  )
}

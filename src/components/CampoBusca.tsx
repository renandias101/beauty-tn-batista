import { useEffect, useId, useRef, useState } from 'react'

export interface OpcaoBusca { id: string; rotulo: string; detalhe?: string }

interface Props {
  rotulo: string
  valor: string
  opcoes: OpcaoBusca[]
  onEscolher: (id: string) => void
  placeholder?: string
  vazio?: string
  desabilitado?: boolean
}

/** Campo com busca por texto para escolher um item de uma lista (cliente, profissional, serviço). */
export function CampoBusca({ rotulo, valor, opcoes, onEscolher, placeholder, vazio = 'Nenhum resultado encontrado.', desabilitado }: Props) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [destaque, setDestaque] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)
  const idLista = useId()
  const selecionado = opcoes.find(opcao => opcao.id === valor)
  const termo = texto.trim().toLowerCase()
  const visiveis = opcoes.filter(opcao => `${opcao.rotulo} ${opcao.detalhe ?? ''}`.toLowerCase().includes(termo)).slice(0, 50)

  useEffect(() => {
    const fora = (evento: MouseEvent) => { if (raiz.current && !raiz.current.contains(evento.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const escolher = (opcao: OpcaoBusca) => { onEscolher(opcao.id); setTexto(''); setAberto(false) }

  return (
    <div ref={raiz} className="relative">
      <label className="rotulo">
        {rotulo}
        <input
          className="campo"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          disabled={desabilitado}
          value={aberto ? texto : selecionado ? `${selecionado.rotulo}${selecionado.detalhe ? ` · ${selecionado.detalhe}` : ''}` : ''}
          placeholder={placeholder ?? `Buscar ${rotulo.toLowerCase()}`}
          onFocus={() => { setAberto(true); setTexto(''); setDestaque(0) }}
          onChange={evento => { setTexto(evento.target.value); setAberto(true); setDestaque(0) }}
          onKeyDown={evento => {
            if (evento.key === 'ArrowDown') { evento.preventDefault(); setDestaque(i => Math.min(i + 1, visiveis.length - 1)) }
            if (evento.key === 'ArrowUp') { evento.preventDefault(); setDestaque(i => Math.max(i - 1, 0)) }
            if (evento.key === 'Enter' && aberto && visiveis[destaque]) { evento.preventDefault(); escolher(visiveis[destaque]) }
            if (evento.key === 'Escape' && aberto) { evento.stopPropagation(); setAberto(false) }
          }}
        />
      </label>
      {aberto && (
        <ul id={idLista} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-xl">
          {visiveis.length ? visiveis.map((opcao, indice) => (
            <li key={opcao.id} role="option" aria-selected={opcao.id === valor}>
              <button type="button" onMouseDown={evento => { evento.preventDefault(); escolher(opcao) }} onMouseEnter={() => setDestaque(indice)}
                className={`block w-full px-3 py-2.5 text-left text-sm ${indice === destaque ? 'bg-muted' : ''}`}>
                <span className="font-semibold">{opcao.rotulo}</span>
                {opcao.detalhe && <span className="text-muted-foreground"> · {opcao.detalhe}</span>}
              </button>
            </li>
          )) : <li className="px-3 py-3 text-sm text-muted-foreground">{vazio}</li>}
        </ul>
      )}
    </div>
  )
}

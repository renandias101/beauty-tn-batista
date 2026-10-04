import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { mensagemDeErro } from '../lib/erros'
import { formatarTelefone, somenteDigitos, telefoneValido } from '../lib/telefone'
import { clientesComTelefone, salvarCliente } from '../services/cadastros'
import type { Cliente } from '../types'

/**
 * Cadastro mínimo de cliente (seção 5 do PRD): nome completo e telefone.
 * Telefone repetido gera alerta, mas pessoas podem compartilhar o mesmo número.
 */
export function ClienteFormulario({ cliente, onSalvo, onCancelar }: { cliente?: Cliente; onSalvo: (cliente: Cliente) => void; onCancelar: () => void }) {
  const [nome, setNome] = useState(cliente?.nome ?? '')
  const [telefone, setTelefone] = useState(cliente?.telefone ?? '')
  const [duplicados, setDuplicados] = useState<Cliente[] | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async (evento: FormEvent, confirmado = false) => {
    evento.preventDefault()
    if (salvando) return
    setErro('')
    if (!nome.trim()) { setErro('Informe o nome completo.'); return }
    if (!telefoneValido(telefone)) { setErro('Informe um telefone com DDD.'); return }
    setSalvando(true)
    try {
      if (!confirmado) {
        const iguais = await clientesComTelefone(somenteDigitos(telefone), cliente?.id)
        if (iguais.length) { setDuplicados(iguais); return }
      }
      onSalvo(await salvarCliente({ id: cliente?.id, nome, telefone }))
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <label className="rotulo">Nome completo<input className="campo" required maxLength={150} value={nome} onChange={e => { setNome(e.target.value); setDuplicados(null) }} /></label>
      <label className="rotulo">Telefone (WhatsApp)<input className="campo" required inputMode="tel" maxLength={20} placeholder="(11) 98765-4321" value={telefone} onChange={e => { setTelefone(formatarTelefone(e.target.value)); setDuplicados(null) }} /></label>
      {duplicados && (
        <div role="alert" className="alerta-aviso space-y-2">
          <p className="font-semibold">Este telefone já está cadastrado para:</p>
          <ul className="list-inside list-disc">{duplicados.map(d => <li key={d.id}>{d.nome}</li>)}</ul>
          <p>Se for outra pessoa usando o mesmo número, confirme para salvar.</p>
          <button type="button" onClick={e => salvar(e, true)} disabled={salvando} className="botao botao-secundario botao-pequeno">Salvar mesmo assim</button>
        </div>
      )}
      {erro && <p role="alert" className="alerta-erro">{erro}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={salvando} className="botao botao-texto">Voltar</button>
        <button type="submit" disabled={salvando || Boolean(duplicados)} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar cliente</button>
      </div>
    </form>
  )
}

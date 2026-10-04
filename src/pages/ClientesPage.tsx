import { useState } from 'react'
import { MessageCircle, Plus, Search } from 'lucide-react'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento, SeloStatus, Vazio } from '../components/Basicos'
import { ClienteFormulario } from '../components/ClienteFormulario'
import { Modal } from '../components/Modal'
import { usePerfil } from '../auth/Sessao'
import { agoraNoFuso, dataCurta } from '../lib/datas'
import { linkWhatsApp, somenteDigitos } from '../lib/telefone'
import { useCarregar } from '../lib/useCarregar'
import { agendamentosDoCliente } from '../services/agenda'
import { listarClientes } from '../services/cadastros'
import type { Cliente, ItemAgenda } from '../types'

export function ClientesPage() {
  const avisar = useAvisos()
  const clientes = useCarregar(listarClientes, [])
  const [busca, setBusca] = useState('')
  const [selecionadoId, setSelecionadoId] = useState('')
  const [editando, setEditando] = useState<Cliente | 'novo' | null>(null)

  const termo = busca.trim().toLowerCase()
  const digitos = somenteDigitos(busca)
  const filtrados = (clientes.dados ?? []).filter(c => !termo || c.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && c.telefoneDigitos.includes(digitos)))
  const selecionado = clientes.dados?.find(c => c.id === selecionadoId)

  return (
    <div>
      <CabecalhoPagina sobretitulo="Cadastro" titulo="Clientes" descricao="Pesquise clientes e consulte os agendamentos anteriores e futuros."
        acoes={<button type="button" onClick={() => setEditando('novo')} className="botao botao-primario"><Plus size={18} />Novo cliente</button>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(300px,.85fr)_1.15fr]">
        <section className="cartao overflow-hidden">
          <div className="border-b border-border p-4">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-primary">
              <Search size={16} className="text-muted-foreground" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar cliente" className="min-h-11 w-full bg-transparent text-sm outline-none" />
            </label>
          </div>
          {clientes.erro ? <div className="p-4"><FalhaCarregamento mensagem={clientes.erro} onTentar={clientes.recarregar} /></div>
            : !clientes.dados ? <Carregando />
            : filtrados.length === 0 ? <div className="p-4"><Vazio>{busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado.'}</Vazio></div>
            : (
              <ul className="max-h-[65dvh] divide-y divide-border overflow-y-auto">
                {filtrados.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelecionadoId(c.id)} aria-current={c.id === selecionadoId ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left ${c.id === selecionadoId ? 'bg-secondary' : 'hover:bg-muted'}`}>
                      <span><span className="block text-sm font-bold">{c.nome}</span><span className="mt-0.5 block text-sm text-muted-foreground">{c.telefone}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="cartao p-5 lg:p-7">
          {selecionado ? <DetalheCliente cliente={selecionado} onEditar={() => setEditando(selecionado)} /> : <Vazio>Selecione um cliente para ver os agendamentos.</Vazio>}
        </section>
      </div>

      {editando && (
        <Modal titulo={editando === 'novo' ? 'Novo cliente' : 'Editar cliente'} descricao="Nome completo e telefone de contato." onFechar={() => setEditando(null)}>
          <ClienteFormulario cliente={editando === 'novo' ? undefined : editando} onCancelar={() => setEditando(null)}
            onSalvo={cliente => { avisar(editando === 'novo' ? 'Cliente cadastrado.' : 'Dados atualizados.'); setEditando(null); setSelecionadoId(cliente.id); clientes.recarregar() }} />
        </Modal>
      )}
    </div>
  )
}

function DetalheCliente({ cliente, onEditar }: { cliente: Cliente; onEditar: () => void }) {
  const perfil = usePerfil()
  const historico = useCarregar(() => agendamentosDoCliente(cliente.id), [cliente.id], { aoFocar: true })
  const agora = agoraNoFuso(perfil.fusoHorario)
  const ehFuturo = (a: ItemAgenda) => a.data > agora.data || (a.data === agora.data && a.horaFim > agora.hora)
  // Cancelados saem dos próximos e ficam no histórico, para não parecer reserva vigente.
  const futuros = (historico.dados ?? []).filter(a => ehFuturo(a) && a.status !== 'cancelado').reverse()
  const anteriores = (historico.dados ?? []).filter(a => !futuros.includes(a))

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="sobretitulo">Cliente</div>
          <h2 className="titulo mt-2 text-2xl">{cliente.nome}</h2>
          <a href={linkWhatsApp(cliente.telefone)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><MessageCircle size={15} />{cliente.telefone}</a>
        </div>
        <button type="button" onClick={onEditar} className="botao botao-secundario botao-pequeno">Editar dados</button>
      </div>
      {historico.erro ? <FalhaCarregamento mensagem={historico.erro} onTentar={historico.recarregar} />
        : !historico.dados ? <Carregando />
        : (
          <div className="space-y-6">
            <ListaAgendamentos titulo="Próximos agendamentos" itens={futuros} vazio="Nenhum agendamento futuro." />
            <ListaAgendamentos titulo="Anteriores e cancelados" itens={anteriores} vazio="Nenhum registro anterior." />
          </div>
        )}
    </div>
  )
}

function ListaAgendamentos({ titulo, itens, vazio }: { titulo: string; itens: ItemAgenda[]; vazio: string }) {
  return (
    <div>
      <h3 className="titulo mb-3 text-lg">{titulo}</h3>
      {itens.length === 0 ? <Vazio>{vazio}</Vazio> : (
        <ul className="space-y-2">
          {itens.map(a => (
            <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-bold">{dataCurta(a.data)} · {a.horaInicio} – {a.horaFim}</div>
                <div className="mt-1 text-sm text-muted-foreground">{a.servicoNome} · {a.profissionalNome}</div>
              </div>
              <SeloStatus status={a.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

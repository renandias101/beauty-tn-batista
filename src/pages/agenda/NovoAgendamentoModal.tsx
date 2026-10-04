import { useMemo, useState, type FormEvent } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { CampoBusca } from '../../components/CampoBusca'
import { ClienteFormulario } from '../../components/ClienteFormulario'
import { Modal } from '../../components/Modal'
import { mensagemDeErro } from '../../lib/erros'
import { useCarregar } from '../../lib/useCarregar'
import { novoUuid } from '../../lib/uuid'
import { criarAgendamento } from '../../services/agenda'
import { listarClientes } from '../../services/cadastros'
import type { Cliente, Habilitacao, Profissional, Servico } from '../../types'
import { SeletorHorario } from './SeletorHorario'

interface Props {
  dataInicial: string
  profissionalInicial?: string
  profissionais: Profissional[]
  servicos: Servico[]
  habilitacoes: Habilitacao[]
  fuso: string
  onSalvo: () => void
  onFechar: () => void
}

/** Fluxo "Criar e confirmar" (seção 8): cliente, serviço, profissional habilitado, horário livre. */
export function NovoAgendamentoModal({ dataInicial, profissionalInicial, profissionais, servicos, habilitacoes, fuso, onSalvo, onFechar }: Props) {
  // Gerado uma vez: se a resposta se perder e o usuário salvar de novo, o servidor não duplica (CA11).
  const [id] = useState(novoUuid)
  const clientes = useCarregar(listarClientes, [])
  const [novos, setNovos] = useState<Cliente[]>([])
  const [cadastrandoCliente, setCadastrandoCliente] = useState(false)
  const [clienteId, setClienteId] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [profissionalId, setProfissionalId] = useState(profissionalInicial ?? '')
  const [data, setData] = useState(dataInicial)
  const [hora, setHora] = useState('')
  const [encaixe, setEncaixe] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const listaClientes = useMemo(() => [...novos, ...(clientes.dados ?? []).filter(c => !novos.some(n => n.id === c.id))], [clientes.dados, novos])
  const servicosAtivos = servicos.filter(s => s.ativo)
  const servico = servicos.find(s => s.id === servicoId)
  // RN02: somente profissionais ativos e habilitados para o serviço.
  const habilitados = profissionais.filter(p => p.ativo && (!servicoId || habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === servicoId)))

  const escolherServico = (id: string) => {
    setServicoId(id)
    if (profissionalId && !habilitacoes.some(h => h.profissionalId === profissionalId && h.servicoId === id)) setProfissionalId('')
    setHora('')
  }

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    if (!clienteId || !servicoId || !profissionalId || !data || !hora) { setErro('Preencha cliente, serviço, profissional, data e horário.'); return }
    setSalvando(true)
    setErro('')
    try {
      await criarAgendamento({ id, clienteId, servicoId, profissionalId, data, hora, observacao: observacao.trim(), encaixe })
      onSalvo()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Modal titulo="Novo agendamento" descricao="O horário é validado novamente ao salvar." onFechar={onFechar} bloqueado={salvando} largura="lg"
        rodape={<>
          <button type="button" onClick={onFechar} disabled={salvando} className="botao botao-texto">Voltar</button>
          <button type="submit" form="form-novo-agendamento" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar agendamento</button>
        </>}>
        <form id="form-novo-agendamento" onSubmit={salvar} className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <CampoBusca rotulo="Cliente" valor={clienteId} onEscolher={setClienteId} placeholder={clientes.carregando ? 'Carregando clientes...' : 'Buscar por nome ou telefone'}
                opcoes={listaClientes.map(c => ({ id: c.id, rotulo: c.nome, detalhe: c.telefone }))} vazio="Nenhum cliente encontrado. Use “Novo cliente”." />
            </div>
            <button type="button" onClick={() => setCadastrandoCliente(true)} className="botao botao-secundario" title="Cadastrar novo cliente"><UserPlus size={16} /><span className="hidden sm:inline">Novo cliente</span></button>
          </div>
          {clientes.erro && <p className="alerta-erro">{clientes.erro}</p>}

          <CampoBusca rotulo="Serviço" valor={servicoId} onEscolher={escolherServico}
            opcoes={servicosAtivos.map(s => ({ id: s.id, rotulo: s.nome, detalhe: `${s.duracaoMinutos} min` }))} vazio="Nenhum serviço ativo encontrado." />

          <label className="rotulo">Profissional
            <select className="campo" required value={profissionalId} onChange={e => { setProfissionalId(e.target.value); setHora('') }} disabled={!servicoId}>
              <option value="">{servicoId ? (habilitados.length ? 'Selecione' : 'Nenhum profissional habilitado') : 'Escolha o serviço primeiro'}</option>
              {habilitados.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>

          <SeletorHorario profissionalId={profissionalId} duracaoMinutos={servico?.duracaoMinutos ?? 0} fuso={fuso}
            data={data} hora={hora} onData={valor => { setData(valor); setHora('') }} onHora={setHora} />

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={encaixe} onChange={e => setEncaixe(e.target.checked)} />Identificar como encaixe</label>
          <label className="rotulo">Observação operacional (opcional)
            <textarea className="campo resize-none" rows={2} maxLength={500} value={observacao} onChange={e => setObservacao(e.target.value)} />
            <span className="mt-1 block font-normal">Não registre dados clínicos ou de saúde.</span>
          </label>
          {erro && <p role="alert" className="alerta-erro">{erro}</p>}
        </form>
      </Modal>

      {cadastrandoCliente && (
        <Modal titulo="Novo cliente" descricao="Nome completo e telefone de contato." onFechar={() => setCadastrandoCliente(false)}>
          <ClienteFormulario onCancelar={() => setCadastrandoCliente(false)} onSalvo={cliente => { setNovos(atual => [cliente, ...atual]); setClienteId(cliente.id); setCadastrandoCliente(false) }} />
        </Modal>
      )}
    </>
  )
}

import { useEffect } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Carregando, FalhaCarregamento, Vazio } from '../../components/Basicos'
import { Modal } from '../../components/Modal'
import { dataCurta, dataPorExtenso, primeiraMaiuscula } from '../../lib/datas'
import { useCarregar } from '../../lib/useCarregar'
import { candidatosListaEspera } from '../../services/agenda'
import type { CandidatoEspera } from '../../types'
import type { VagaLiberada } from './DetalhesAgendamentoModal'

/**
 * Após cancelar ou reagendar, mostra quem da lista de espera cabe na vaga liberada. Nada é reservado aqui:
 * "Agendar" abre o formulário preenchido, e o servidor revalida o horário ao salvar.
 */
export function VagaLiberadaModal({ vaga, onAgendar, onFechar }: { vaga: VagaLiberada; onAgendar: (candidato: CandidatoEspera) => void; onFechar: () => void }) {
  const candidatos = useCarregar(() => candidatosListaEspera(vaga.profissionalId, vaga.inicio, vaga.ocupadoAte), [vaga.inicio, vaga.profissionalId])

  const semCandidatos = candidatos.dados?.length === 0
  // Sem candidatos, a janela nem aparece.
  useEffect(() => { if (semCandidatos) onFechar() }, [semCandidatos])
  // A janela só aparece quando há candidatos (ou se a consulta falhar).
  if (semCandidatos || (!candidatos.dados && !candidatos.erro)) return null

  return (
    <Modal titulo="Vaga liberada" descricao={`${primeiraMaiuscula(dataPorExtenso(vaga.data))}, ${vaga.horaInicio} · ${vaga.profissionalNome}`} onFechar={onFechar} largura="lg">
      <p className="mb-4 text-sm text-muted-foreground">Pessoas da lista de espera compatíveis com este horário (serviço habilitado, duração, período e faixa desejados). A lista não reserva o horário: confirme com a cliente e salve o agendamento.</p>
      {candidatos.erro ? <FalhaCarregamento mensagem={candidatos.erro} onTentar={candidatos.recarregar} />
        : !candidatos.dados ? <Carregando texto="Buscando na lista de espera..." />
        : !candidatos.dados.length ? <Vazio>Ninguém da lista de espera cabe nesta vaga.</Vazio>
        : (
          <ul className="space-y-2">
            {candidatos.dados.map(c => (
              <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-bold">{c.clienteNome}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{c.servicoNome} · {c.duracaoMinutos} min{c.profissionalPreferido ? ` · prefere ${c.profissionalPreferido}` : ''}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Período: {dataCurta(c.dataInicio)} a {dataCurta(c.dataFim)}{c.horaInicio ? ` · ${c.horaInicio}–${c.horaFim}` : ''}{c.status === 'contatado' ? ' · já contatada' : ''}</div>
                  {c.observacao && <div className="mt-1 text-xs">{c.observacao}</div>}
                </div>
                <button type="button" onClick={() => onAgendar(c)} className="botao botao-primario botao-pequeno self-start sm:self-center"><CalendarPlus size={14} />Agendar</button>
              </li>
            ))}
          </ul>
        )}
      <div className="mt-4 flex justify-end"><button type="button" onClick={onFechar} className="botao botao-texto">Fechar</button></div>
    </Modal>
  )
}

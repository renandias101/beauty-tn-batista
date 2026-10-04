// Regras da agenda aplicadas aos dados fictícios da demonstração.
// Espelham as funções do banco (migrações 002 e 004) para que a demonstração se comporte como o sistema real.
// Não são a fonte oficial das regras: no sistema real, quem valida é o servidor.
import { diaDaSemana, paraMinutos, somarMinutos } from '../lib/datas'
import { ErroDeOperacao } from '../lib/erros'
import { bloqueioNaData } from '../lib/horariosLivres'
import { PROXIMOS_STATUS, ocupaHorario } from '../lib/status'
import type { Bloqueio, Cliente, Disponibilidade, Excecao, Habilitacao, ItemAgenda, Papel, Perfil, Profissional, RegistroHistorico, Servico, StatusAgendamento } from '../types'

/** Fuso usado na demonstração. O Brasil não adota horário de verão desde 2019, então o deslocamento é fixo. */
export const FUSO_DEMO = 'America/Sao_Paulo'
const DESLOCAMENTO = '-03:00'

export interface UsuarioDemo { usuarioId: string; nome: string; usuario: string; papel: Papel; ativo: boolean }
export interface AgendamentoDemo {
  id: string; clienteId: string; servicoId: string; profissionalId: string
  data: string; horaInicio: string; duracaoMinutos: number; status: StatusAgendamento
  encaixe: boolean; observacao: string | null; motivoCancelamento: string | null; criadoPor: string
}
export interface HistoricoDemo extends RegistroHistorico { agendamentoId: string }
export interface BloqueioDemo extends Bloqueio { removidoEm: string | null; motivoRemocao?: string | null }
export interface ExcecaoDemo extends Excecao { removidoEm: string | null }

export interface BaseDemo {
  versao: 1
  geradaEm: string
  usuarios: UsuarioDemo[]
  profissionais: Profissional[]
  servicos: Servico[]
  habilitacoes: Habilitacao[]
  disponibilidades: Disponibilidade[]
  excecoes: ExcecaoDemo[]
  bloqueios: BloqueioDemo[]
  clientes: Cliente[]
  agendamentos: AgendamentoDemo[]
  historico: HistoricoDemo[]
  /** Ausente em demonstrações geradas antes da consulta pública: vale o padrão (sem WhatsApp, 30 dias). */
  configuracao?: { whatsapp: string | null; horizonteDias: number }
}

export const instante = (data: string, hora: string) => new Date(`${data}T${hora}:00${DESLOCAMENTO}`).toISOString()

const falhar = (mensagem: string): never => { throw new ErroDeOperacao(mensagem) }

export function exigirPapel(perfil: Perfil | null, papeis: Papel[]) {
  if (!perfil || !papeis.includes(perfil.papel)) falhar('Você não tem permissão para esta ação.')
  return perfil as Perfil
}

const fimEmMinutos = (a: AgendamentoDemo) => paraMinutos(a.horaInicio) + a.duracaoMinutos
const sobrepoe = (ini: number, fim: number, outroIni: number, outroFim: number) => ini < outroFim && fim > outroIni

/** RN03: o atendimento inteiro cabe em uma faixa da jornada ou em uma exceção vigente da data. */
export function cabeNaJornada(base: BaseDemo, profissionalId: string, data: string, inicio: number, fim: number) {
  const faixas = [
    ...base.disponibilidades.filter(d => d.profissionalId === profissionalId && d.diaSemana === diaDaSemana(data)),
    ...base.excecoes.filter(e => !e.removidoEm && e.profissionalId === profissionalId && e.data === data),
  ]
  return { atende: faixas.length > 0, cabe: faixas.some(f => paraMinutos(f.horaInicio) <= inicio && paraMinutos(f.horaFim) >= fim) }
}

/** RN01–RN05: mesma ordem de verificações e mensagens de private.validar_horario. */
export function validarHorario(base: BaseDemo, opcoes: { profissionalId: string; servicoId: string; data: string; hora: string; duracaoMinutos: number; ignorarId?: string }) {
  const { profissionalId, servicoId, data, hora, duracaoMinutos, ignorarId } = opcoes
  if (!base.profissionais.some(p => p.id === profissionalId && p.ativo)) falhar('O profissional selecionado está inativo ou não foi encontrado.')
  if (!base.servicos.some(s => s.id === servicoId && s.ativo)) falhar('O serviço selecionado está inativo ou não foi encontrado.')
  if (!base.habilitacoes.some(h => h.profissionalId === profissionalId && h.servicoId === servicoId)) falhar('Este profissional não está habilitado para o serviço selecionado.')
  const inicio = paraMinutos(hora)
  const fim = inicio + duracaoMinutos
  const jornada = cabeNaJornada(base, profissionalId, data, inicio, fim)
  if (!jornada.cabe) falhar(jornada.atende ? 'O horário não cabe na jornada do profissional. Verifique intervalos e o fim do expediente.' : 'O profissional não atende nesta data.')
  const bloqueio = base.bloqueios.find(b => {
    if (b.removidoEm || b.profissionalId !== profissionalId) return false
    const trecho = bloqueioNaData(b, data, FUSO_DEMO)
    return trecho !== null && sobrepoe(inicio, fim, trecho.inicio, trecho.fim)
  })
  if (bloqueio) falhar(`O horário está bloqueado na agenda do profissional (${bloqueio.motivo}).`)
  const conflito = base.agendamentos.some(a => a.id !== ignorarId && a.profissionalId === profissionalId && a.data === data
    && ocupaHorario(a.status) && sobrepoe(inicio, fim, paraMinutos(a.horaInicio), fimEmMinutos(a)))
  if (conflito) falhar('Já existe um atendimento deste profissional nesse horário.')
}

export function paraItem(base: BaseDemo, a: AgendamentoDemo, completo = true): ItemAgenda {
  const cliente = base.clientes.find(c => c.id === a.clienteId)
  const servico = base.servicos.find(s => s.id === a.servicoId)
  const profissional = base.profissionais.find(p => p.id === a.profissionalId)
  return {
    id: a.id, clienteId: a.clienteId, clienteNome: cliente?.nome ?? 'Cliente', clienteTelefone: completo ? cliente?.telefone ?? null : null,
    servicoId: a.servicoId, servicoNome: servico?.nome ?? 'Serviço', profissionalId: a.profissionalId,
    profissionalNome: profissional?.nome ?? 'Profissional', profissionalCor: profissional?.cor ?? '#9A6A20',
    inicio: instante(a.data, a.horaInicio), fim: instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos)),
    data: a.data, horaInicio: a.horaInicio, horaFim: somarMinutos(a.horaInicio, a.duracaoMinutos), duracaoMinutos: a.duracaoMinutos,
    status: a.status, encaixe: a.encaixe, observacao: completo ? a.observacao : null, motivoCancelamento: completo ? a.motivoCancelamento : null,
  }
}

function retrato(base: BaseDemo, a: AgendamentoDemo) {
  const item = paraItem(base, a)
  return { status: a.status, data: a.data, hora_inicio: item.horaInicio, hora_fim: item.horaFim, duracao_minutos: a.duracaoMinutos, profissional_id: a.profissionalId, profissional: item.profissionalNome, servico: item.servicoNome, encaixe: a.encaixe, observacao: a.observacao }
}

function registrar(base: BaseDemo, perfil: Perfil, a: AgendamentoDemo, acao: RegistroHistorico['acao'], motivo: string | null, antes: Record<string, unknown> | null, agora: Date) {
  base.historico.push({ id: base.historico.length + 1, agendamentoId: a.id, acao, usuarioNome: perfil.nome, ocorridoEm: agora.toISOString(), motivo, valoresAnteriores: antes, valoresNovos: retrato(base, a) })
}

const exigirMotivo = (motivo: string) => {
  const limpo = motivo.trim()
  if (limpo.length < 3) falhar('Informe o motivo (mínimo de 3 caracteres).')
  if (limpo.length > 300) falhar('O motivo deve ter no máximo 300 caracteres.')
  return limpo
}

const buscar = (base: BaseDemo, id: string) => base.agendamentos.find(a => a.id === id) ?? falhar('Agendamento não encontrado.')

// ---------------- Agendamentos ----------------

export function criarAgendamento(base: BaseDemo, perfil: Perfil | null, novo: { id: string; clienteId: string; servicoId: string; profissionalId: string; data: string; hora: string; observacao: string; encaixe: boolean }, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (!novo.clienteId || !novo.servicoId || !novo.profissionalId || !novo.data || !novo.hora) falhar('Preencha cliente, serviço, profissional, data e horário.')
  if (novo.observacao.length > 500) falhar('A observação deve ter no máximo 500 caracteres.')
  if (!base.clientes.some(c => c.id === novo.clienteId)) falhar('Cliente não encontrado.')
  const servico = base.servicos.find(s => s.id === novo.servicoId) ?? falhar('Serviço não encontrado.')
  const existente = base.agendamentos.find(a => a.id === novo.id)
  if (existente) {
    // Reenvio do mesmo pedido devolve a reserva já gravada (CA11).
    if (existente.clienteId === novo.clienteId && existente.profissionalId === novo.profissionalId && existente.data === novo.data && existente.horaInicio === novo.hora) return existente
    falhar('Este agendamento já foi registrado.')
  }
  validarHorario(base, { profissionalId: novo.profissionalId, servicoId: novo.servicoId, data: novo.data, hora: novo.hora, duracaoMinutos: servico.duracaoMinutos })
  const agendamento: AgendamentoDemo = {
    id: novo.id, clienteId: novo.clienteId, servicoId: novo.servicoId, profissionalId: novo.profissionalId, data: novo.data, horaInicio: novo.hora,
    duracaoMinutos: servico.duracaoMinutos, status: 'agendado', encaixe: novo.encaixe, observacao: novo.observacao.trim() || null, motivoCancelamento: null, criadoPor: quem.usuarioId,
  }
  base.agendamentos.push(agendamento)
  registrar(base, quem, agendamento, 'criado', null, null, agora)
  return agendamento
}

export function alterarStatus(base: BaseDemo, perfil: Perfil | null, id: string, status: StatusAgendamento, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const a = buscar(base, id)
  if (status === 'cancelado') falhar('Use a ação de cancelar, que exige o motivo.')
  if (!PROXIMOS_STATUS[a.status].some(p => p.status === status)) falhar(`Não é possível mudar de "${a.status}" para "${status}".`)
  if (status === 'faltou' && agora.getTime() < Date.parse(instante(a.data, a.horaInicio))) falhar('A falta só pode ser registrada após o horário previsto.')
  const antes = retrato(base, a)
  a.status = status
  registrar(base, quem, a, 'status_alterado', null, antes, agora)
}

export function cancelarAgendamento(base: BaseDemo, perfil: Perfil | null, id: string, motivo: string, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(motivo)
  const a = buscar(base, id)
  if (!['agendado', 'confirmado', 'chegou'].includes(a.status)) falhar(`Agendamentos com status "${a.status}" não podem ser cancelados.`)
  const antes = retrato(base, a)
  a.status = 'cancelado'
  a.motivoCancelamento = limpo
  registrar(base, quem, a, 'cancelado', limpo, antes, agora)
}

export function reagendarAgendamento(base: BaseDemo, perfil: Perfil | null, id: string, novo: { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number }, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(novo.motivo)
  if (!novo.data || !novo.hora) falhar('Informe a nova data e o novo horário.')
  const a = buscar(base, id)
  const duracao = novo.duracaoMinutos ?? a.duracaoMinutos
  if (duracao !== a.duracaoMinutos && quem.papel !== 'admin') falhar('Somente a administração pode ajustar a duração de uma reserva.')
  if (duracao <= 0 || duracao > 720) falhar('A duração deve ser maior que zero e de no máximo 12 horas.')
  if (a.status !== 'agendado' && a.status !== 'confirmado') falhar('Somente agendamentos agendados ou confirmados podem ser reagendados.')
  if (a.data === novo.data && a.horaInicio === novo.hora && a.profissionalId === novo.profissionalId && a.duracaoMinutos === duracao) falhar('Informe um horário, profissional ou duração diferente do atual.')
  // RN06: valida o novo horário antes de liberar o anterior.
  validarHorario(base, { profissionalId: novo.profissionalId, servicoId: a.servicoId, data: novo.data, hora: novo.hora, duracaoMinutos: duracao, ignorarId: a.id })
  const antes = retrato(base, a)
  Object.assign(a, { data: novo.data, horaInicio: novo.hora, profissionalId: novo.profissionalId, duracaoMinutos: duracao })
  registrar(base, quem, a, 'reagendado', limpo, antes, agora)
}

export function editarAgendamento(base: BaseDemo, perfil: Perfil | null, id: string, observacao: string, encaixe: boolean, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (observacao.length > 500) falhar('A observação deve ter no máximo 500 caracteres.')
  const a = buscar(base, id)
  const antes = retrato(base, a)
  a.observacao = observacao.trim() || null
  a.encaixe = encaixe
  registrar(base, quem, a, 'editado', null, antes, agora)
}

/** RN08: lista reservas futuras que deixariam de caber na jornada. */
export function reservasForaDaJornada(base: BaseDemo, profissionalId: string, agora = new Date()) {
  return base.agendamentos.filter(a => a.profissionalId === profissionalId && ocupaHorario(a.status)
    && Date.parse(instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos))) > agora.getTime()
    && !cabeNaJornada(base, profissionalId, a.data, paraMinutos(a.horaInicio), fimEmMinutos(a)).cabe)
}

export function descrever(base: BaseDemo, lista: AgendamentoDemo[]) {
  return [...lista].sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`)).slice(0, 5)
    .map(a => `${a.data.slice(8, 10)}/${a.data.slice(5, 7)} ${a.horaInicio} – ${base.clientes.find(c => c.id === a.clienteId)?.nome ?? 'Cliente'}`).join('; ')
}

/** Bloqueios: um contínuo (dia inteiro) ou um por dia no mesmo horário. Recusa se atingir reservas (RN08). */
export function criarBloqueio(base: BaseDemo, perfil: Perfil | null, b: { profissionalId: string; dataInicio: string; dataFim: string; horaInicio: string; horaFim: string; motivo: string; diaInteiro: boolean }, novoId: () => string) {
  exigirPapel(perfil, ['admin', 'secretaria'])
  const motivo = b.motivo.trim()
  if (motivo.length < 3 || motivo.length > 200) falhar('Informe o motivo do bloqueio (de 3 a 200 caracteres).')
  if (!b.dataInicio || !b.dataFim || b.dataFim < b.dataInicio) falhar('Informe um período de datas válido.')
  if (!b.diaInteiro && (!b.horaInicio || !b.horaFim || b.horaInicio >= b.horaFim)) falhar('O horário final deve ser posterior ao inicial.')
  const periodos: { inicio: string; fim: string }[] = []
  if (b.diaInteiro) {
    const depois = new Date(`${b.dataFim}T00:00:00Z`); depois.setUTCDate(depois.getUTCDate() + 1)
    periodos.push({ inicio: instante(b.dataInicio, '00:00'), fim: instante(depois.toISOString().slice(0, 10), '00:00') })
  } else {
    for (let dia = b.dataInicio; dia <= b.dataFim; ) {
      periodos.push({ inicio: instante(dia, b.horaInicio), fim: instante(dia, b.horaFim) })
      const d = new Date(`${dia}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); dia = d.toISOString().slice(0, 10)
    }
  }
  if (periodos.length > 367) falhar('O bloqueio pode abranger no máximo um ano.')
  const toca = (x: { inicio: string; fim: string }, y: { inicio: string; fim: string }) => Date.parse(x.inicio) < Date.parse(y.fim) && Date.parse(x.fim) > Date.parse(y.inicio)
  const atingidas = base.agendamentos.filter(a => a.profissionalId === b.profissionalId && ocupaHorario(a.status)
    && periodos.some(p => toca(p, { inicio: instante(a.data, a.horaInicio), fim: instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos)) })))
  if (atingidas.length) falhar(`O bloqueio atinge ${atingidas.length} agendamento(s): ${descrever(base, atingidas)}. Reagende ou cancele essas reservas antes de bloquear.`)
  if (base.bloqueios.some(x => !x.removidoEm && x.profissionalId === b.profissionalId && periodos.some(p => toca(p, x)))) falhar('Já existe um bloqueio sobreposto nesse período.')
  for (const p of periodos) base.bloqueios.push({ id: novoId(), profissionalId: b.profissionalId, inicio: p.inicio, fim: p.fim, motivo, removidoEm: null })
  return periodos.length
}

export function salvarJornada(base: BaseDemo, perfil: Perfil | null, profissionalId: string, faixas: { diaSemana: number; horaInicio: string; horaFim: string }[], novoId: () => string) {
  exigirPapel(perfil, ['admin'])
  if (faixas.some(f => !f.horaInicio || !f.horaFim || f.horaInicio >= f.horaFim)) falhar('Cada faixa precisa terminar depois de começar.')
  const sobrepostas = faixas.some((f, i) => faixas.some((g, j) => i < j && f.diaSemana === g.diaSemana && f.horaInicio < g.horaFim && g.horaInicio < f.horaFim))
  if (sobrepostas) falhar('Há faixas sobrepostas no mesmo dia. Ajuste os horários.')
  const anteriores = base.disponibilidades
  base.disponibilidades = [...anteriores.filter(d => d.profissionalId !== profissionalId), ...faixas.map(f => ({ id: novoId(), profissionalId, ...f }))]
  const fora = reservasForaDaJornada(base, profissionalId)
  if (fora.length) {
    base.disponibilidades = anteriores
    falhar(`A alteração deixaria ${fora.length} agendamento(s) futuro(s) fora da jornada: ${descrever(base, fora)}. Reagende ou cancele essas reservas antes.`)
  }
}

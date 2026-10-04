// Regras da agenda aplicadas aos dados fictícios da demonstração.
// Espelham as funções do banco (migrações 002, 004 e 011) para que a demonstração se comporte como o sistema real.
// Não são a fonte oficial das regras: no sistema real, quem valida é o servidor.
import { agoraNoFuso, deMinutos, diaDaSemana, fimDoMes, paraMinutos, somarDias, somarMeses, somarMinutos } from '../lib/datas'
import { ErroDeOperacao, type DicaDeErro } from '../lib/erros'
import { bloqueioNaData, calcularHorariosLivres } from '../lib/horariosLivres'
import { PROXIMOS_STATUS, STATUS, ocupaHorario, ocupaPeriodo } from '../lib/status'
import type {
  Bloqueio, CandidatoEspera, Cliente, Comunicacao, ContatoEspera, DiaInexistente, Disponibilidade, EntradaEspera, Excecao, FrequenciaSerie, Habilitacao, ItemAgenda, OcorrenciaPrevista, Papel, Perfil,
  Profissional, Recurso, RegistroHistorico, Servico, ServicoRecurso, StatusAgendamento, StatusEspera, TipoComunicacao,
} from '../types'

/** Fuso usado na demonstração. O Brasil não adota horário de verão desde 2019, então o deslocamento é fixo. */
export const FUSO_DEMO = 'America/Sao_Paulo'
const DESLOCAMENTO = '-03:00'

export interface UsuarioDemo { usuarioId: string; nome: string; usuario: string; papel: Papel; ativo: boolean }
export interface AgendamentoDemo {
  id: string; clienteId: string; servicoId: string; profissionalId: string
  data: string; horaInicio: string; duracaoMinutos: number; status: StatusAgendamento
  encaixe: boolean; observacao: string | null; motivoCancelamento: string | null; criadoPor: string
  preparacaoMinutos: number; versao: number; recursos: string[]; conflitoJustificativa: string | null; canceladoEm: string | null
  grupoId: string | null; grupoOrdem: number | null; serieId: string | null; serieOrdem: number | null
}
export interface GrupoDemo { id: string; clienteId: string; criadoPor: string }
export interface SerieDemo {
  id: string; clienteId: string; servicoId: string; profissionalId: string; frequencia: FrequenciaSerie; dataInicial: string; hora: string
  quantidade: number | null; dataFinal: string | null; diaInexistente: DiaInexistente | null; criadoPor: string
}
export interface HistoricoDemo extends RegistroHistorico { agendamentoId: string }
export interface BloqueioDemo extends Bloqueio { removidoEm: string | null; motivoRemocao?: string | null }
export interface ExcecaoDemo extends Excecao { removidoEm: string | null }
export interface ComunicacaoDemo { id: string; agendamentoId: string; tipo: TipoComunicacao; registradoEm: string; registradoPor: string; inicioReferencia: string; profissionalReferencia: string }
export interface EsperaDemo {
  id: string; clienteId: string; servicoId: string; profissionalId: string | null; dataInicio: string; dataFim: string
  horaInicio: string | null; horaFim: string | null; observacao: string | null; status: StatusEspera; agendamentoId: string | null
  versao: number; criadoEm: string; criadoPor: string
}
export interface ContatoEsperaDemo extends ContatoEspera { listaEsperaId: string }

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
  recursos: Recurso[]
  servicoRecursos: ServicoRecurso[]
  comunicacoes: ComunicacaoDemo[]
  listaEspera: EsperaDemo[]
  contatosEspera: ContatoEsperaDemo[]
  grupos: GrupoDemo[]
  series: SerieDemo[]
}

/** Completa dados gravados por versões anteriores da demonstração (sem perder as alterações já feitas). */
export function normalizarBase(base: BaseDemo): BaseDemo {
  base.recursos ??= []
  base.servicoRecursos ??= []
  base.comunicacoes ??= []
  base.listaEspera ??= []
  base.contatosEspera ??= []
  base.grupos ??= []
  base.series ??= []
  for (const s of base.servicos) s.preparacaoMinutos ??= 0
  for (const a of base.agendamentos) {
    a.preparacaoMinutos ??= 0
    a.versao ??= 1
    a.recursos ??= []
    a.conflitoJustificativa ??= null
    a.canceladoEm ??= null
    a.grupoId ??= null
    a.grupoOrdem ??= null
    a.serieId ??= null
    a.serieOrdem ??= null
  }
  return base
}

export const instante = (data: string, hora: string) => new Date(`${data}T${hora}:00${DESLOCAMENTO}`).toISOString()

const falhar = (mensagem: string, dica?: DicaDeErro): never => { throw new ErroDeOperacao(mensagem, dica) }

export function exigirPapel(perfil: Perfil | null, papeis: Papel[]) {
  if (!perfil || !papeis.includes(perfil.papel)) falhar('Você não tem permissão para esta ação.')
  return perfil as Perfil
}

const inicioEmMinutos = (a: AgendamentoDemo) => paraMinutos(a.horaInicio)
const fimEmMinutos = (a: AgendamentoDemo) => inicioEmMinutos(a) + a.duracaoMinutos
const ocupadoAteEmMinutos = (a: AgendamentoDemo) => fimEmMinutos(a) + a.preparacaoMinutos
const sobrepoe = (ini: number, fim: number, outroIni: number, outroFim: number) => ini < outroFim && fim > outroIni

/** Duração efetiva: a específica do profissional ou, sem ela, a padrão do serviço. null se não habilitado. */
export function duracaoEfetiva(base: BaseDemo, profissionalId: string, servicoId: string) {
  const habilitacao = base.habilitacoes.find(h => h.profissionalId === profissionalId && h.servicoId === servicoId)
  if (!habilitacao) return null
  return habilitacao.duracaoMinutos ?? base.servicos.find(s => s.id === servicoId)?.duracaoMinutos ?? null
}

const ROTULO = (status: StatusAgendamento) => STATUS[status].rotulo.toLowerCase()

export function descreverAtendimento(base: BaseDemo, a: AgendamentoDemo) {
  const servico = base.servicos.find(s => s.id === a.servicoId)?.nome ?? 'Serviço'
  const profissional = base.profissionais.find(p => p.id === a.profissionalId)?.nome ?? 'Profissional'
  return `${a.data.slice(8, 10)}/${a.data.slice(5, 7)}, ${a.horaInicio}–${somarMinutos(a.horaInicio, a.duracaoMinutos)}, ${servico} com ${profissional} (${ROTULO(a.status)})`
}

/** RN03: o período inteiro (atendimento + preparação) cabe em uma faixa da jornada ou em uma exceção vigente da data. */
export function cabeNaJornada(base: BaseDemo, profissionalId: string, data: string, inicio: number, fim: number) {
  const faixas = faixasDoDia(base, profissionalId, data)
  return { atende: faixas.length > 0, cabe: faixas.some(f => paraMinutos(f.horaInicio) <= inicio && paraMinutos(f.horaFim) >= fim) }
}

const faixasDoDia = (base: BaseDemo, profissionalId: string, data: string) => [
  ...base.disponibilidades.filter(d => d.profissionalId === profissionalId && d.diaSemana === diaDaSemana(data)),
  ...base.excecoes.filter(e => !e.removidoEm && e.profissionalId === profissionalId && e.data === data),
]

const bloqueiosNaData = (base: BaseDemo, profissionalId: string, data: string) =>
  base.bloqueios.filter(b => !b.removidoEm && b.profissionalId === profissionalId)
    .map(b => ({ b, trecho: bloqueioNaData(b, data, FUSO_DEMO) })).filter(x => x.trecho !== null) as { b: BloqueioDemo; trecho: { inicio: number; fim: number } }[]

/** Bloqueios e outras reservas do profissional no período ocupado (espelha private.validar_ocupacao_profissional). */
function validarOcupacaoProfissional(base: BaseDemo, profissionalId: string, data: string, inicio: number, ocupadoAte: number, ignorarId?: string) {
  const bloqueio = bloqueiosNaData(base, profissionalId, data).find(x => sobrepoe(inicio, ocupadoAte, x.trecho.inicio, x.trecho.fim))
  if (bloqueio) falhar(`O horário está bloqueado na agenda do profissional (${bloqueio.b.motivo}).`)
  const conflito = base.agendamentos.filter(a => a.id !== ignorarId && a.profissionalId === profissionalId && a.data === data && ocupaPeriodo(a.status)
    && sobrepoe(inicio, ocupadoAte, inicioEmMinutos(a), ocupadoAteEmMinutos(a))).sort((x, y) => x.horaInicio.localeCompare(y.horaInicio))[0]
  if (conflito) falhar(`Já existe um atendimento deste profissional nesse período (incluindo a preparação): ${descreverAtendimento(base, conflito)}.`)
}

/** RN01–RN05 com preparação: mesma ordem de verificações e mensagens de private.validar_reserva. */
export function validarReserva(base: BaseDemo, o: { profissionalId: string; servicoId: string; data: string; inicio: number; ocupadoAte: number; ignorarId?: string }) {
  if (!base.profissionais.some(p => p.id === o.profissionalId && p.ativo)) falhar('O profissional selecionado está inativo ou não foi encontrado.')
  if (!base.servicos.some(s => s.id === o.servicoId && s.ativo)) falhar('O serviço selecionado está inativo ou não foi encontrado.')
  if (!base.habilitacoes.some(h => h.profissionalId === o.profissionalId && h.servicoId === o.servicoId)) falhar('Este profissional não está habilitado para o serviço selecionado.')
  const jornada = cabeNaJornada(base, o.profissionalId, o.data, o.inicio, o.ocupadoAte)
  if (!jornada.cabe) falhar(jornada.atende ? 'O horário não cabe na jornada do profissional (atendimento e preparação). Verifique intervalos e o fim do expediente.' : 'O profissional não atende nesta data.')
  validarOcupacaoProfissional(base, o.profissionalId, o.data, o.inicio, o.ocupadoAte, o.ignorarId)
}

const reservasDoRecurso = (base: BaseDemo, recursoId: string, data: string, inicio: number, ocupadoAte: number, ignorarId?: string) =>
  base.agendamentos.filter(a => a.id !== ignorarId && a.data === data && a.recursos.includes(recursoId) && ocupaPeriodo(a.status)
    && sobrepoe(inicio, ocupadoAte, inicioEmMinutos(a), ocupadoAteEmMinutos(a)))

/** Capacidade do recurso no período: a ocupação máxima acontece no início do período ou no início de outra reserva dentro dele. */
export function recursoDisponivel(base: BaseDemo, recursoId: string, data: string, inicio: number, ocupadoAte: number, ignorarId?: string) {
  const capacidade = base.recursos.find(r => r.id === recursoId)?.capacidade ?? 1
  const reservas = reservasDoRecurso(base, recursoId, data, inicio, ocupadoAte, ignorarId)
  const instantes = [inicio, ...reservas.map(inicioEmMinutos).filter(t => t > inicio)]
  return Math.max(0, ...instantes.map(t => reservas.filter(a => inicioEmMinutos(a) <= t && ocupadoAteEmMinutos(a) > t).length)) < capacidade
}

function validarRecursos(base: BaseDemo, recursos: string[], data: string, inicio: number, ocupadoAte: number, ignorarId?: string, exigirAtivos = true) {
  for (const recurso of base.recursos.filter(r => recursos.includes(r.id)).sort((a, b) => a.nome.localeCompare(b.nome))) {
    if (exigirAtivos && !recurso.ativo) falhar(`O recurso "${recurso.nome}" exigido por este serviço está desativado. Peça à administração para revisar o serviço.`)
    if (!recursoDisponivel(base, recurso.id, data, inicio, ocupadoAte, ignorarId)) falhar(`O recurso "${recurso.nome}" já está em uso nesse período. Escolha outro horário.`)
  }
}

/** Conflito da cliente: exceção só pela administração, com justificativa (espelha private.resolver_conflito_cliente). */
function resolverConflitoCliente(base: BaseDemo, perfil: Perfil, clienteId: string, data: string, inicio: number, fim: number, ignorarId: string | undefined, justificativa?: string) {
  const conflito = base.agendamentos.filter(a => a.id !== ignorarId && a.clienteId === clienteId && a.data === data && ocupaPeriodo(a.status)
    && sobrepoe(inicio, fim, inicioEmMinutos(a), fimEmMinutos(a))).sort((x, y) => x.horaInicio.localeCompare(y.horaInicio))[0]
  if (!conflito) return null
  const texto = (justificativa ?? '').trim()
  if (perfil.papel !== 'admin') falhar(`A cliente já tem atendimento nesse período: ${descreverAtendimento(base, conflito)}. Somente a administração pode autorizar uma exceção.`, 'conflito_cliente')
  if (texto.length < 3 || texto.length > 300) falhar(`A cliente já tem atendimento nesse período: ${descreverAtendimento(base, conflito)}. Para manter mesmo assim, informe a justificativa da exceção (3 a 300 caracteres).`, 'conflito_cliente')
  return texto
}

function exigirVersao(a: AgendamentoDemo, versao: number | undefined) {
  if (versao === undefined || versao !== a.versao) falhar('Este agendamento foi alterado por outra pessoa depois que você o abriu. Confira os dados atuais e tente de novo.', 'versao_desatualizada')
}

const noPassado = (data: string, hora: string, agora: Date) => Date.parse(instante(data, hora)) <= agora.getTime()

export function paraItem(base: BaseDemo, a: AgendamentoDemo, completo = true): ItemAgenda {
  const cliente = base.clientes.find(c => c.id === a.clienteId)
  const servico = base.servicos.find(s => s.id === a.servicoId)
  const profissional = base.profissionais.find(p => p.id === a.profissionalId)
  const horaFim = somarMinutos(a.horaInicio, a.duracaoMinutos)
  const horaOcupadoAte = somarMinutos(horaFim, a.preparacaoMinutos)
  const ultima = completo ? base.comunicacoes.filter(c => c.agendamentoId === a.id).sort((x, y) => y.registradoEm.localeCompare(x.registradoEm))[0] : undefined
  const nomesRecursos = base.recursos.filter(r => a.recursos.includes(r.id)).map(r => r.nome).sort().join(', ')
  return {
    id: a.id, clienteId: a.clienteId, clienteNome: cliente?.nome ?? 'Cliente', clienteTelefone: completo ? cliente?.telefone ?? null : null,
    servicoId: a.servicoId, servicoNome: servico?.nome ?? 'Serviço', profissionalId: a.profissionalId,
    profissionalNome: profissional?.nome ?? 'Profissional', profissionalCor: profissional?.cor ?? '#9A6A20',
    inicio: instante(a.data, a.horaInicio), fim: instante(a.data, horaFim),
    data: a.data, horaInicio: a.horaInicio, horaFim, duracaoMinutos: a.duracaoMinutos,
    status: a.status, encaixe: a.encaixe, observacao: completo ? a.observacao : null, motivoCancelamento: completo ? a.motivoCancelamento : null,
    preparacaoMinutos: a.preparacaoMinutos, ocupadoAte: instante(a.data, horaOcupadoAte), horaOcupadoAte, versao: a.versao,
    excecaoConflitoCliente: completo ? a.conflitoJustificativa : null, recursos: nomesRecursos || null,
    ultimaComunicacao: ultima ? { tipo: ultima.tipo, em: ultima.registradoEm, por: ultima.registradoPor } : null,
    comunicacaoDesatualizada: Boolean(ultima && (ultima.inicioReferencia !== instante(a.data, a.horaInicio) || ultima.profissionalReferencia !== a.profissionalId)),
    grupoId: a.grupoId, grupoOrdem: a.grupoOrdem, grupoTotal: a.grupoId ? base.agendamentos.filter(x => x.grupoId === a.grupoId).length : null,
    serieId: a.serieId, serieOrdem: a.serieOrdem, serieTotal: a.serieId ? base.agendamentos.filter(x => x.serieId === a.serieId).length : null,
    serieFrequencia: a.serieId ? base.series.find(x => x.id === a.serieId)?.frequencia ?? null : null,
  }
}

function retrato(base: BaseDemo, a: AgendamentoDemo) {
  const item = paraItem(base, a)
  return {
    status: a.status, data: a.data, hora_inicio: item.horaInicio, hora_fim: item.horaFim, duracao_minutos: a.duracaoMinutos, preparacao_minutos: a.preparacaoMinutos,
    profissional_id: a.profissionalId, profissional: item.profissionalNome, servico: item.servicoNome, encaixe: a.encaixe, observacao: a.observacao,
    motivo_cancelamento: a.motivoCancelamento, cancelado_em: a.canceladoEm, excecao_conflito_cliente: a.conflitoJustificativa, recursos: item.recursos,
    grupo_id: a.grupoId, grupo_ordem: a.grupoOrdem, serie_id: a.serieId, serie_ordem: a.serieOrdem,
  }
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

// ---------------- Horários livres (mesma regra da agenda interna e da consulta pública) ----------------

export function horariosLivres(base: BaseDemo, o: { servicoId: string; profissionalId: string; data: string; ignorarId?: string; duracaoMinutos?: number }, agora = new Date()) {
  const reserva = o.ignorarId ? base.agendamentos.find(a => a.id === o.ignorarId) : undefined
  const servicoId = reserva?.servicoId ?? o.servicoId
  const preparacao = reserva ? reserva.preparacaoMinutos : base.servicos.find(s => s.id === servicoId)?.preparacaoMinutos ?? 0
  const recursos = reserva ? reserva.recursos : base.servicoRecursos.filter(v => v.servicoId === servicoId).map(v => v.recursoId)
  const padrao = reserva && reserva.profissionalId === o.profissionalId ? reserva.duracaoMinutos : duracaoEfetiva(base, o.profissionalId, servicoId)
  const duracao = o.duracaoMinutos ?? padrao
  if (!duracao || duracao <= 0) return []
  if (base.recursos.some(r => recursos.includes(r.id) && !r.ativo)) return []
  const ocupados = [
    ...bloqueiosNaData(base, o.profissionalId, o.data).map(x => x.trecho),
    ...base.agendamentos.filter(a => a.id !== o.ignorarId && a.profissionalId === o.profissionalId && a.data === o.data && ocupaPeriodo(a.status))
      .map(a => ({ inicio: inicioEmMinutos(a), fim: ocupadoAteEmMinutos(a) })),
  ]
  const hoje = agoraNoFuso(FUSO_DEMO, agora)
  if (o.data < hoje.data) return []
  const minutos = calcularHorariosLivres({
    faixas: faixasDoDia(base, o.profissionalId, o.data), ocupados, duracaoMinutos: duracao, preparacaoMinutos: preparacao,
    aPartirDeMinutos: o.data === hoje.data ? paraMinutos(hoje.hora) + 1 : 0,
    recursoOcupadoAte: (inicio, fim) => {
      for (const recursoId of recursos) {
        if (!recursoDisponivel(base, recursoId, o.data, inicio, fim, o.ignorarId)) {
          return Math.min(...reservasDoRecurso(base, recursoId, o.data, inicio, fim, o.ignorarId).map(ocupadoAteEmMinutos))
        }
      }
      return null
    },
  })
  return minutos.map(deMinutos)
}

// ---------------- Agendamentos ----------------

export interface NovoAgendamentoDemo {
  id: string; clienteId: string; servicoId: string; profissionalId: string; data: string; hora: string; observacao: string; encaixe: boolean
  justificativaConflito?: string; listaEsperaId?: string
  /** Vínculos e texto do histórico usados pela marcação com vários serviços e pela série. */
  grupoId?: string; grupoOrdem?: number; serieId?: string; serieOrdem?: number; motivoHistorico?: string
}

/** opcoes.permitirPassado: somente para gerar o histórico fictício inicial; a interface nunca usa. */
export function criarAgendamento(base: BaseDemo, perfil: Perfil | null, novo: NovoAgendamentoDemo, agora = new Date(), opcoes: { permitirPassado?: boolean } = {}) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (!novo.clienteId || !novo.servicoId || !novo.profissionalId || !novo.data || !novo.hora) falhar('Preencha cliente, serviço, profissional, data e horário.')
  if (novo.observacao.length > 500) falhar('A observação deve ter no máximo 500 caracteres.')
  if (!base.clientes.some(c => c.id === novo.clienteId)) falhar('Cliente não encontrado.')
  const servico = base.servicos.find(s => s.id === novo.servicoId) ?? falhar('Serviço não encontrado.')
  const duracao = duracaoEfetiva(base, novo.profissionalId, novo.servicoId) ?? falhar('Este profissional não está habilitado para o serviço selecionado.')
  const existente = base.agendamentos.find(a => a.id === novo.id)
  if (existente) {
    // Reenvio do mesmo pedido devolve a reserva já gravada (CA11).
    if (existente.clienteId === novo.clienteId && existente.profissionalId === novo.profissionalId && existente.data === novo.data && existente.horaInicio === novo.hora) return existente
    falhar('Este agendamento já foi registrado.')
  }
  if (!opcoes.permitirPassado && noPassado(novo.data, novo.hora, agora)) falhar('Não é possível agendar em data ou horário que já passou.')
  const inicio = paraMinutos(novo.hora)
  const ocupadoAte = inicio + duracao + servico.preparacaoMinutos
  const recursos = base.servicoRecursos.filter(v => v.servicoId === servico.id).map(v => v.recursoId)
  validarReserva(base, { profissionalId: novo.profissionalId, servicoId: novo.servicoId, data: novo.data, inicio, ocupadoAte })
  validarRecursos(base, recursos, novo.data, inicio, ocupadoAte)
  const justificativa = resolverConflitoCliente(base, quem, novo.clienteId, novo.data, inicio, inicio + duracao, undefined, novo.justificativaConflito)
  const espera = novo.listaEsperaId ? base.listaEspera.find(e => e.id === novo.listaEsperaId) ?? falhar('Entrada da lista de espera não encontrada.') : null
  if (espera) {
    if (espera.status !== 'aguardando' && espera.status !== 'contatado') falhar(`Esta entrada da lista de espera já foi encerrada (${espera.status}).`)
    if (espera.clienteId !== novo.clienteId || espera.servicoId !== novo.servicoId) falhar('A cliente e o serviço devem ser os mesmos da lista de espera.')
  }
  const agendamento: AgendamentoDemo = {
    id: novo.id, clienteId: novo.clienteId, servicoId: novo.servicoId, profissionalId: novo.profissionalId, data: novo.data, horaInicio: novo.hora,
    duracaoMinutos: duracao, status: 'agendado', encaixe: novo.encaixe, observacao: novo.observacao.trim() || null, motivoCancelamento: null, criadoPor: quem.usuarioId,
    preparacaoMinutos: servico.preparacaoMinutos, versao: 1, recursos, conflitoJustificativa: justificativa, canceladoEm: null,
    grupoId: novo.grupoId ?? null, grupoOrdem: novo.grupoOrdem ?? null, serieId: novo.serieId ?? null, serieOrdem: novo.serieOrdem ?? null,
  }
  base.agendamentos.push(agendamento)
  const motivoCriacao = [novo.motivoHistorico, justificativa ? `Exceção de conflito da cliente autorizada: ${justificativa}` : null].filter(Boolean).join(' · ')
  registrar(base, quem, agendamento, 'criado', motivoCriacao || null, null, agora)
  if (espera) {
    const anterior = espera.status
    Object.assign(espera, { status: 'agendado', agendamentoId: agendamento.id, versao: espera.versao + 1 })
    registrarContato(base, quem, espera.id, anterior, 'agendado', `Agendado para ${novo.data.split('-').reverse().join('/')} ${novo.hora}`, agora)
  }
  return agendamento
}

export function alterarStatus(base: BaseDemo, perfil: Perfil | null, id: string, status: StatusAgendamento, versao: number, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const a = buscar(base, id)
  exigirVersao(a, versao)
  if (status === 'cancelado') falhar('Use a ação de cancelar, que exige o motivo.')
  if (!PROXIMOS_STATUS[a.status].some(p => p.status === status)) falhar(`Não é possível mudar de "${ROTULO(a.status)}" para "${ROTULO(status)}". Para corrigir um registro, use a correção de status da administração.`)
  if (status === 'faltou' && agora.getTime() < Date.parse(instante(a.data, a.horaInicio))) falhar('A falta só pode ser registrada após o horário previsto.')
  const antes = retrato(base, a)
  a.status = status
  a.versao++
  registrar(base, quem, a, 'status_alterado', null, antes, agora)
}

export function cancelarAgendamento(base: BaseDemo, perfil: Perfil | null, id: string, motivo: string, versao: number, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(motivo)
  const a = buscar(base, id)
  exigirVersao(a, versao)
  if (!['agendado', 'confirmado', 'chegou'].includes(a.status)) falhar(`Agendamentos com status "${ROTULO(a.status)}" não podem ser cancelados.`)
  const antes = retrato(base, a)
  Object.assign(a, { status: 'cancelado', motivoCancelamento: limpo, canceladoEm: agora.toISOString(), versao: a.versao + 1 })
  registrar(base, quem, a, 'cancelado', limpo, antes, agora)
}

export function reagendarAgendamento(
  base: BaseDemo, perfil: Perfil | null, id: string,
  novo: { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number; justificativaConflito?: string }, versao: number, agora = new Date(),
) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(novo.motivo)
  if (!novo.data || !novo.hora) falhar('Informe a nova data e o novo horário.')
  const a = buscar(base, id)
  // Mesmo profissional: mantém a duração gravada; outro profissional: duração efetiva dele.
  const padrao = (a.profissionalId === novo.profissionalId ? a.duracaoMinutos : duracaoEfetiva(base, novo.profissionalId, a.servicoId)) ?? falhar('Este profissional não está habilitado para o serviço selecionado.')
  const duracao = novo.duracaoMinutos ?? padrao
  if (duracao !== padrao && quem.papel !== 'admin') falhar('Somente a administração pode ajustar a duração de uma reserva.')
  if (duracao <= 0 || duracao > 720) falhar('A duração deve ser maior que zero e de no máximo 12 horas.')
  exigirVersao(a, versao)
  if (a.status !== 'agendado' && a.status !== 'confirmado') falhar('Somente agendamentos aguardando confirmação ou com presença confirmada podem ser reagendados.')
  if (a.data === novo.data && a.horaInicio === novo.hora && a.profissionalId === novo.profissionalId && a.duracaoMinutos === duracao) falhar('Informe um horário, profissional ou duração diferente do atual.')
  if (noPassado(novo.data, novo.hora, agora)) falhar('Não é possível reagendar para data ou horário que já passou.')
  // RN06: valida o novo horário antes de liberar o anterior.
  const inicio = paraMinutos(novo.hora)
  const ocupadoAte = inicio + duracao + a.preparacaoMinutos
  validarReserva(base, { profissionalId: novo.profissionalId, servicoId: a.servicoId, data: novo.data, inicio, ocupadoAte, ignorarId: a.id })
  validarRecursos(base, a.recursos, novo.data, inicio, ocupadoAte, a.id)
  const justificativa = resolverConflitoCliente(base, quem, a.clienteId, novo.data, inicio, inicio + duracao, a.id, novo.justificativaConflito)
  const antes = retrato(base, a)
  Object.assign(a, { data: novo.data, horaInicio: novo.hora, profissionalId: novo.profissionalId, duracaoMinutos: duracao, conflitoJustificativa: justificativa, versao: a.versao + 1 })
  registrar(base, quem, a, 'reagendado', justificativa ? `${limpo} · Exceção de conflito da cliente autorizada: ${justificativa}` : limpo, antes, agora)
}

export function editarAgendamento(base: BaseDemo, perfil: Perfil | null, id: string, observacao: string, encaixe: boolean, versao: number, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (observacao.length > 500) falhar('A observação deve ter no máximo 500 caracteres.')
  const a = buscar(base, id)
  exigirVersao(a, versao)
  const antes = retrato(base, a)
  Object.assign(a, { observacao: observacao.trim() || null, encaixe, versao: a.versao + 1 })
  registrar(base, quem, a, 'editado', null, antes, agora)
}

/** Correção administrativa de status (espelha public.corrigir_status_agendamento). */
export function corrigirStatus(base: BaseDemo, perfil: Perfil | null, id: string, status: StatusAgendamento, justificativa: string, versao: number, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin'])
  const limpo = exigirMotivo(justificativa)
  const a = buscar(base, id)
  exigirVersao(a, versao)
  if (status === a.status) falhar(`O agendamento já está com o status "${ROTULO(status)}".`)
  if (status === 'faltou' && agora.getTime() < Date.parse(instante(a.data, a.horaInicio))) falhar('A falta só pode ser registrada após o horário previsto.')
  if (ocupaPeriodo(status) && !ocupaPeriodo(a.status)) {
    validarOcupacaoProfissional(base, a.profissionalId, a.data, inicioEmMinutos(a), ocupadoAteEmMinutos(a), a.id)
    validarRecursos(base, a.recursos, a.data, inicioEmMinutos(a), ocupadoAteEmMinutos(a), a.id, false)
    const conflito = base.agendamentos.find(o => o.id !== a.id && o.clienteId === a.clienteId && o.data === a.data && ocupaPeriodo(o.status)
      && sobrepoe(inicioEmMinutos(a), fimEmMinutos(a), inicioEmMinutos(o), fimEmMinutos(o)) && !o.conflitoJustificativa && !a.conflitoJustificativa)
    if (conflito) falhar(`A cliente já tem outro atendimento nesse período: ${descreverAtendimento(base, conflito)}. Resolva esse atendimento antes de corrigir o status.`, 'conflito_cliente')
  }
  const antes = retrato(base, a)
  Object.assign(a, {
    status, versao: a.versao + 1,
    motivoCancelamento: status === 'cancelado' ? limpo : null, canceladoEm: status === 'cancelado' ? agora.toISOString() : null,
  })
  registrar(base, quem, a, 'status_corrigido', limpo, antes, agora)
}

// ---------------- Comunicações ----------------

export function registrarComunicacao(base: BaseDemo, perfil: Perfil | null, id: string, agendamentoId: string, tipo: TipoComunicacao, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (base.comunicacoes.some(c => c.id === id)) return
  const a = buscar(base, agendamentoId)
  if (tipo === 'cancelamento' && a.status !== 'cancelado') falhar('O aviso de cancelamento só pode ser registrado para agendamentos cancelados.')
  if (tipo !== 'cancelamento' && a.status !== 'agendado' && a.status !== 'confirmado') falhar('Esta mensagem só pode ser registrada para agendamentos aguardando confirmação ou com presença confirmada.')
  base.comunicacoes.push({ id, agendamentoId, tipo, registradoEm: agora.toISOString(), registradoPor: quem.nome, inicioReferencia: instante(a.data, a.horaInicio), profissionalReferencia: a.profissionalId })
}

export function listarComunicacoes(base: BaseDemo, perfil: Perfil | null, agendamentoId: string): Comunicacao[] {
  exigirPapel(perfil, ['admin', 'secretaria'])
  const a = buscar(base, agendamentoId)
  return base.comunicacoes.filter(c => c.agendamentoId === agendamentoId).sort((x, y) => y.registradoEm.localeCompare(x.registradoEm))
    .map(c => ({ id: c.id, tipo: c.tipo, registradoEm: c.registradoEm, registradoPor: c.registradoPor, desatualizada: c.inicioReferencia !== instante(a.data, a.horaInicio) || c.profissionalReferencia !== a.profissionalId }))
}

// ---------------- Lista de espera ----------------

function registrarContato(base: BaseDemo, perfil: Perfil, listaEsperaId: string, anterior: StatusEspera | null, novo: StatusEspera, observacao: string | null, agora: Date) {
  base.contatosEspera.push({ id: base.contatosEspera.length + 1, listaEsperaId, ocorridoEm: agora.toISOString(), usuarioNome: perfil.nome, statusAnterior: anterior, statusNovo: novo, observacao })
}

export function criarEntradaEspera(base: BaseDemo, perfil: Perfil | null, e: { id: string; clienteId: string; servicoId: string; profissionalId: string | null; dataInicio: string; dataFim: string; horaInicio: string | null; horaFim: string | null; observacao: string }, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (!e.clienteId || !e.servicoId || !e.dataInicio || !e.dataFim) falhar('Preencha cliente, serviço e o período de datas.')
  if (base.listaEspera.some(x => x.id === e.id)) return
  const hoje = agoraNoFuso(FUSO_DEMO, agora).data
  if (e.dataFim < e.dataInicio || e.dataFim < hoje) falhar('Informe um período de datas válido, que termine hoje ou depois.')
  if (Date.parse(e.dataFim) - Date.parse(e.dataInicio) > 180 * 86_400_000) falhar('O período pode ter no máximo 180 dias.')
  if (Boolean(e.horaInicio) !== Boolean(e.horaFim) || (e.horaInicio && e.horaFim && e.horaInicio >= e.horaFim)) falhar('Informe a faixa de horário completa (início antes do fim) ou deixe as duas em branco.')
  if (e.observacao.length > 300) falhar('A observação deve ter no máximo 300 caracteres.')
  if (!base.servicos.some(s => s.id === e.servicoId && s.ativo)) falhar('O serviço selecionado está inativo ou não foi encontrado.')
  if (e.profissionalId && duracaoEfetiva(base, e.profissionalId, e.servicoId) === null) falhar('Este profissional não está habilitado para o serviço selecionado.')
  const emAberto = (x: EsperaDemo) => x.status === 'aguardando' || x.status === 'contatado'
  if (base.listaEspera.some(x => emAberto(x) && x.clienteId === e.clienteId && x.servicoId === e.servicoId && (x.profissionalId ?? '') === (e.profissionalId ?? ''))) {
    falhar('Esta cliente já está na lista de espera para este serviço e profissional. Atualize a entrada existente.')
  }
  base.listaEspera.push({ ...e, observacao: e.observacao.trim() || null, status: 'aguardando', agendamentoId: null, versao: 1, criadoEm: agora.toISOString(), criadoPor: quem.nome })
  registrarContato(base, quem, e.id, null, 'aguardando', 'Entrada na lista de espera', agora)
}

export function atualizarEntradaEspera(base: BaseDemo, perfil: Perfil | null, id: string, status: StatusEspera, observacao: string, versao: number, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (!['aguardando', 'contatado', 'desistiu'].includes(status)) falhar('Situação inválida. A situação "agendado" é definida ao criar o agendamento.')
  const texto = observacao.trim() || null
  if ((texto?.length ?? 0) > 300) falhar('A observação deve ter no máximo 300 caracteres.')
  const e = base.listaEspera.find(x => x.id === id) ?? falhar('Entrada da lista de espera não encontrada.')
  if (versao !== e.versao) falhar('Esta entrada foi alterada por outra pessoa. Atualize a lista e tente de novo.', 'versao_desatualizada')
  if (e.status === 'agendado') falhar('Esta entrada já foi agendada e não pode mudar de situação.')
  if (status === e.status && !texto) falhar('Informe uma observação do contato ou escolha outra situação.')
  if (status !== 'desistiu' && e.status === 'desistiu' && base.listaEspera.some(x => x.id !== e.id && (x.status === 'aguardando' || x.status === 'contatado')
    && x.clienteId === e.clienteId && x.servicoId === e.servicoId && (x.profissionalId ?? '') === (e.profissionalId ?? ''))) {
    falhar('Já existe outra entrada em aberto para esta cliente, serviço e profissional.')
  }
  const anterior = e.status
  Object.assign(e, { status, versao: e.versao + 1 })
  registrarContato(base, quem, e.id, anterior, status, texto, agora)
}

export function listarListaEspera(base: BaseDemo, perfil: Perfil | null, status?: StatusEspera): EntradaEspera[] {
  exigirPapel(perfil, ['admin', 'secretaria'])
  const ordem: Record<StatusEspera, number> = { aguardando: 0, contatado: 1, agendado: 2, desistiu: 2 }
  return base.listaEspera.filter(e => !status || e.status === status)
    .sort((a, b) => ordem[a.status] - ordem[b.status] || a.criadoEm.localeCompare(b.criadoEm))
    .map(e => {
      const cliente = base.clientes.find(c => c.id === e.clienteId)
      const ultimo = base.contatosEspera.filter(c => c.listaEsperaId === e.id).at(-1)
      return {
        id: e.id, clienteId: e.clienteId, clienteNome: cliente?.nome ?? 'Cliente', clienteTelefone: cliente?.telefone ?? '', servicoId: e.servicoId,
        servicoNome: base.servicos.find(s => s.id === e.servicoId)?.nome ?? 'Serviço', profissionalId: e.profissionalId,
        profissionalNome: e.profissionalId ? base.profissionais.find(p => p.id === e.profissionalId)?.nome ?? null : null,
        dataInicio: e.dataInicio, dataFim: e.dataFim, horaInicio: e.horaInicio, horaFim: e.horaFim, observacao: e.observacao, status: e.status,
        agendamentoId: e.agendamentoId, versao: e.versao, criadoEm: e.criadoEm, criadoPor: e.criadoPor, ultimoContatoEm: ultimo?.ocorridoEm ?? null, ultimoContatoPor: ultimo?.usuarioNome ?? null,
      }
    })
}

export function contatosDaEntrada(base: BaseDemo, perfil: Perfil | null, id: string): ContatoEspera[] {
  exigirPapel(perfil, ['admin', 'secretaria'])
  return base.contatosEspera.filter(c => c.listaEsperaId === id).map(({ listaEsperaId: _id, ...c }) => c)
}

/** Candidatos para a vaga [inicio, ocupadoAte) liberada de um profissional (espelha public.candidatos_lista_espera). */
export function candidatosListaEspera(base: BaseDemo, perfil: Perfil | null, profissionalId: string, inicio: string, ocupadoAte: string, agora = new Date()): CandidatoEspera[] {
  exigirPapel(perfil, ['admin', 'secretaria'])
  if (Date.parse(inicio) <= agora.getTime() || Date.parse(ocupadoAte) <= Date.parse(inicio)) return []
  const local = agoraNoFuso(FUSO_DEMO, new Date(inicio))
  const janela = (Date.parse(ocupadoAte) - Date.parse(inicio)) / 60000
  return base.listaEspera.filter(e => e.status === 'aguardando' || e.status === 'contatado').flatMap(e => {
    const servico = base.servicos.find(s => s.id === e.servicoId && s.ativo)
    const duracao = duracaoEfetiva(base, profissionalId, e.servicoId)
    if (!servico || duracao === null || (e.profissionalId && e.profissionalId !== profissionalId)) return []
    if (duracao + servico.preparacaoMinutos > janela || local.data < e.dataInicio || local.data > e.dataFim) return []
    if (e.horaInicio && e.horaFim && (local.hora < e.horaInicio || paraMinutos(local.hora) + duracao > paraMinutos(e.horaFim))) return []
    return [{
      id: e.id, clienteId: e.clienteId, clienteNome: base.clientes.find(c => c.id === e.clienteId)?.nome ?? 'Cliente', servicoId: e.servicoId, servicoNome: servico.nome,
      duracaoMinutos: duracao, profissionalPreferido: e.profissionalId ? base.profissionais.find(p => p.id === e.profissionalId)?.nome ?? null : null,
      dataInicio: e.dataInicio, dataFim: e.dataFim, horaInicio: e.horaInicio, horaFim: e.horaFim, observacao: e.observacao, status: e.status, versao: e.versao,
    }]
  }).sort((a, b) => (base.listaEspera.find(x => x.id === a.id)?.criadoEm ?? '').localeCompare(base.listaEspera.find(x => x.id === b.id)?.criadoEm ?? ''))
}

// ---------------- Recursos ----------------

/** Desativar ou reduzir capacidade exige tratar antes as reservas futuras ativas (espelha private.validar_alteracao_recurso). */
export function validarAlteracaoRecurso(base: BaseDemo, atual: Recurso, novo: { ativo: boolean; capacidade: number }, agora = new Date()) {
  if (!((atual.ativo && !novo.ativo) || novo.capacidade < atual.capacidade)) return
  const futuras = base.agendamentos.filter(a => a.recursos.includes(atual.id) && ocupaHorario(a.status)
    && Date.parse(instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos + a.preparacaoMinutos))) > agora.getTime())
  const afetadas = futuras.filter(a => !novo.ativo || base.agendamentos.filter(b => b.recursos.includes(atual.id) && b.data === a.data && ocupaPeriodo(b.status)
    && inicioEmMinutos(b) <= inicioEmMinutos(a) && ocupadoAteEmMinutos(b) > inicioEmMinutos(a)).length > novo.capacidade)
  if (afetadas.length) falhar(`O recurso está reservado em ${afetadas.length} agendamento(s) futuro(s): ${descrever(base, afetadas)}. Reagende ou cancele essas reservas antes de ${!novo.ativo ? 'desativar' : 'reduzir a capacidade'}.`)
}

// ---------------- Jornada e bloqueios ----------------

/** RN08: lista reservas futuras ativas que deixariam de caber na jornada. */
export function reservasForaDaJornada(base: BaseDemo, profissionalId: string, agora = new Date()) {
  return base.agendamentos.filter(a => a.profissionalId === profissionalId && ocupaHorario(a.status)
    && Date.parse(instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos))) > agora.getTime()
    && !cabeNaJornada(base, profissionalId, a.data, inicioEmMinutos(a), ocupadoAteEmMinutos(a)).cabe)
}

export function descrever(base: BaseDemo, lista: AgendamentoDemo[]) {
  return [...lista].sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`)).slice(0, 5)
    .map(a => `${a.data.slice(8, 10)}/${a.data.slice(5, 7)} ${a.horaInicio} – ${base.clientes.find(c => c.id === a.clienteId)?.nome ?? 'Cliente'}`).join('; ')
}

/** Bloqueios: um contínuo (dia inteiro) ou um por dia no mesmo horário. Recusa se atingir reservas ativas (RN08). */
export function criarBloqueio(base: BaseDemo, perfil: Perfil | null, b: { profissionalId: string; dataInicio: string; dataFim: string; horaInicio: string; horaFim: string; motivo: string; diaInteiro: boolean }, novoId: () => string) {
  exigirPapel(perfil, ['admin', 'secretaria'])
  const motivo = b.motivo.trim()
  if (motivo.length < 3 || motivo.length > 200) falhar('Informe o motivo do bloqueio (de 3 a 200 caracteres).')
  if (!b.dataInicio || !b.dataFim || b.dataFim < b.dataInicio) falhar('Informe um período de datas válido.')
  if (!b.diaInteiro && (!b.horaInicio || !b.horaFim || b.horaInicio >= b.horaFim)) falhar('O horário final deve ser posterior ao inicial.')
  const periodos: { inicio: string; fim: string }[] = []
  if (b.diaInteiro) {
    periodos.push({ inicio: instante(b.dataInicio, '00:00'), fim: instante(somarDias(b.dataFim, 1), '00:00') })
  } else {
    for (let dia = b.dataInicio; dia <= b.dataFim; dia = somarDias(dia, 1)) periodos.push({ inicio: instante(dia, b.horaInicio), fim: instante(dia, b.horaFim) })
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

// ---------------- Marcação com vários serviços e séries (espelham a migração 012) ----------------

/** Executa tudo ou nada: se qualquer passo falhar, os dados voltam ao estado anterior. */
function atomico<T>(base: BaseDemo, acao: () => T): T {
  const copia = JSON.stringify(base)
  try { return acao() } catch (erro) { Object.assign(base, JSON.parse(copia)); throw erro }
}

/** Relança o erro com prefixo (ex.: "Etapa 2: ..."), preservando a dica. */
function comPrefixo<T>(prefixo: string, acao: () => T): T {
  try { return acao() } catch (erro) {
    if (erro instanceof ErroDeOperacao) throw new ErroDeOperacao(`${prefixo}: ${erro.message}`, erro.dica)
    throw erro
  }
}

function exigirVersoes(base: BaseDemo, ids: string[], versoes: Record<string, number>) {
  const vistos = Object.keys(versoes)
  if ([...ids, ...vistos].some(id => versoes[id] !== base.agendamentos.find(a => a.id === id)?.versao)) {
    falhar('Alguma das reservas afetadas foi alterada por outra pessoa. Confira os dados atuais e tente de novo.', 'versao_desatualizada')
  }
}

/** Confere uma reserva já movida, com as demais reservas afetadas também nas novas posições. */
function revalidar(base: BaseDemo, perfil: Perfil, a: AgendamentoDemo, justificativa: string | undefined, agora: Date) {
  if (noPassado(a.data, a.horaInicio, agora)) falhar('Não é possível reagendar para data ou horário que já passou.')
  validarReserva(base, { profissionalId: a.profissionalId, servicoId: a.servicoId, data: a.data, inicio: inicioEmMinutos(a), ocupadoAte: ocupadoAteEmMinutos(a), ignorarId: a.id })
  validarRecursos(base, a.recursos, a.data, inicioEmMinutos(a), ocupadoAteEmMinutos(a), a.id)
  a.conflitoJustificativa = resolverConflitoCliente(base, perfil, a.clienteId, a.data, inicioEmMinutos(a), fimEmMinutos(a), a.id, justificativa)
}

export interface EtapaDemo { servicoId: string; profissionalId: string; data: string; hora: string }

export function criarMarcacao(base: BaseDemo, perfil: Perfil | null, m: { id: string; clienteId: string; etapas: EtapaDemo[]; observacao: string; justificativaConflito?: string }, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (m.etapas.length < 2 || m.etapas.length > 6) falhar('Uma marcação com vários serviços tem de 2 a 6 etapas.')
  if (m.etapas.some(e => !e.servicoId || !e.profissionalId || !e.data || !e.hora)) falhar('Preencha serviço, profissional, data e horário de todas as etapas.')
  const existente = base.grupos.find(g => g.id === m.id)
  if (existente) {
    if (existente.clienteId === m.clienteId && existente.criadoPor === quem.usuarioId) return
    falhar('Esta marcação já foi registrada.')
  }
  atomico(base, () => {
    base.grupos.push({ id: m.id, clienteId: m.clienteId, criadoPor: quem.usuarioId })
    m.etapas.forEach((e, i) => comPrefixo(`Etapa ${i + 1}`, () => criarAgendamento(base, quem, {
      id: `${m.id}-${i + 1}`, clienteId: m.clienteId, servicoId: e.servicoId, profissionalId: e.profissionalId, data: e.data, hora: e.hora,
      observacao: m.observacao, encaixe: false, justificativaConflito: m.justificativaConflito,
      grupoId: m.id, grupoOrdem: i + 1, motivoHistorico: `Marcação com ${m.etapas.length} serviços (etapa ${i + 1})`,
    }, agora)))
  })
}

const doGrupo = (base: BaseDemo, grupoId: string) => base.agendamentos.filter(a => a.grupoId === grupoId).sort((x, y) => (x.grupoOrdem ?? 0) - (y.grupoOrdem ?? 0))

export function cancelarMarcacao(base: BaseDemo, perfil: Perfil | null, grupoId: string, motivo: string, versoes: Record<string, number>, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(motivo)
  const afetadas = doGrupo(base, grupoId).filter(a => ['agendado', 'confirmado', 'chegou'].includes(a.status))
  if (!afetadas.length) falhar('Nenhuma etapa desta marcação pode ser cancelada.')
  exigirVersoes(base, afetadas.map(a => a.id), versoes)
  for (const a of afetadas) {
    const antes = retrato(base, a)
    Object.assign(a, { status: 'cancelado', motivoCancelamento: limpo, canceladoEm: agora.toISOString(), versao: a.versao + 1 })
    registrar(base, quem, a, 'cancelado', `${limpo} (marcação inteira)`, antes, agora)
  }
  return afetadas.length
}

/** Converte um instante em data e hora da clínica. */
const local = (ms: number) => agoraNoFuso(FUSO_DEMO, new Date(ms))

export function reagendarMarcacao(base: BaseDemo, perfil: Perfil | null, grupoId: string, novo: { data: string; hora: string; motivo: string; justificativaConflito?: string }, versoes: Record<string, number>, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(novo.motivo)
  const etapas = doGrupo(base, grupoId)
  if (!etapas.length) falhar('Marcação não encontrada.')
  const bloqueada = etapas.find(a => a.status !== 'agendado' && a.status !== 'confirmado')
  if (bloqueada) falhar(`A etapa ${bloqueada.grupoOrdem} (${ROTULO(bloqueada.status)}) não pode ser reagendada. Reagende as etapas pendentes individualmente.`)
  exigirVersoes(base, etapas.map(a => a.id), versoes)
  const deslocamento = Date.parse(instante(novo.data, novo.hora)) - Date.parse(instante(etapas[0].data, etapas[0].horaInicio))
  if (deslocamento === 0) falhar('Informe um horário diferente do atual.')
  atomico(base, () => {
    const retratos = new Map(etapas.map(a => [a.id, retrato(base, a)]))
    for (const a of etapas) {
      const nova = local(Date.parse(instante(a.data, a.horaInicio)) + deslocamento)
      Object.assign(a, { data: nova.data, horaInicio: nova.hora, versao: a.versao + 1 })
    }
    for (const a of etapas) {
      comPrefixo(`Etapa ${a.grupoOrdem}`, () => revalidar(base, quem, a, novo.justificativaConflito, agora))
      registrar(base, quem, a, 'reagendado', `${limpo} (marcação inteira)`, retratos.get(a.id) ?? null, agora)
    }
  })
  return etapas.length
}

export function agendamentosVinculados(base: BaseDemo, perfil: Perfil | null, v: { grupoId?: string; serieId?: string }) {
  exigirPapel(perfil, ['admin', 'secretaria'])
  return base.agendamentos.filter(a => (v.grupoId && a.grupoId === v.grupoId) || (v.serieId && a.serieId === v.serieId))
    .sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`)).map(a => paraItem(base, a))
}

// ---- Séries ----

export interface SerieDadosDemo {
  clienteId: string; servicoId: string; profissionalId: string; dataInicial: string; hora: string; frequencia: FrequenciaSerie
  quantidade: number | null; dataFinal: string | null; diaInexistente: DiaInexistente | null; justificativaConflito?: string
}

/** Datas da série (espelha private.datas_serie). Limite: 52 ocorrências e até 1 ano. */
export function datasSerie(s: Pick<SerieDadosDemo, 'dataInicial' | 'frequencia' | 'quantidade' | 'dataFinal' | 'diaInexistente'>) {
  if (!['semanal', 'quinzenal', 'mensal'].includes(s.frequencia)) falhar('Frequência inválida.')
  if ((s.quantidade === null) === (s.dataFinal === null)) falhar('Informe a quantidade de ocorrências ou a data final.')
  if (s.quantidade !== null && (s.quantidade < 2 || s.quantidade > 52)) falhar('A série pode ter de 2 a 52 ocorrências.')
  if (s.dataFinal !== null && (s.dataFinal <= s.dataInicial || Date.parse(s.dataFinal) - Date.parse(s.dataInicial) > 366 * 86_400_000)) falhar('A data final deve ser posterior à inicial, em até 1 ano.')
  const dia = Number(s.dataInicial.slice(8))
  const resultado: { ordem: number | null; data: string; situacao: null | 'ultimo_dia' | 'pulada' | 'inexistente' }[] = []
  let ordem = 0
  for (let k = 0; k <= 60; k++) {
    let data: string
    let situacao: null | 'ultimo_dia' | 'pulada' | 'inexistente' = null
    if (s.frequencia === 'mensal') {
      const mes = somarMeses(s.dataInicial, k)
      const ultimo = fimDoMes(mes)
      if (dia <= Number(ultimo.slice(8))) data = `${mes.slice(0, 8)}${String(dia).padStart(2, '0')}`
      else { data = ultimo; situacao = s.diaInexistente === 'ultimo_dia' ? 'ultimo_dia' : s.diaInexistente === 'pular' ? 'pulada' : 'inexistente' }
    } else data = somarDias(s.dataInicial, k * (s.frequencia === 'semanal' ? 7 : 14))
    if (s.dataFinal && data > s.dataFinal) break
    if (situacao !== 'pulada') { ordem++; if (ordem > 52) falhar('A série ultrapassa o limite de 52 ocorrências. Reduza o período.') }
    resultado.push({ ordem: situacao === 'pulada' ? null : ordem, data, situacao })
    if (s.quantidade !== null && ordem >= s.quantidade) break
  }
  return resultado
}

function validarOcorrencia(base: BaseDemo, perfil: Perfil, s: SerieDadosDemo, data: string, agora: Date) {
  const servico = base.servicos.find(x => x.id === s.servicoId) ?? falhar('Serviço não encontrado.')
  const duracao = duracaoEfetiva(base, s.profissionalId, s.servicoId) ?? falhar('Este profissional não está habilitado para o serviço selecionado.')
  if (noPassado(data, s.hora, agora)) falhar('Não é possível agendar em data ou horário que já passou.')
  const inicio = paraMinutos(s.hora)
  const ocupadoAte = inicio + duracao + servico.preparacaoMinutos
  validarReserva(base, { profissionalId: s.profissionalId, servicoId: s.servicoId, data, inicio, ocupadoAte })
  validarRecursos(base, base.servicoRecursos.filter(v => v.servicoId === s.servicoId).map(v => v.recursoId), data, inicio, ocupadoAte)
  resolverConflitoCliente(base, perfil, s.clienteId, data, inicio, inicio + duracao, undefined, s.justificativaConflito)
}

export function preverSerie(base: BaseDemo, perfil: Perfil | null, s: SerieDadosDemo, agora = new Date()): OcorrenciaPrevista[] {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const dia = Number(s.dataInicial.slice(8))
  return datasSerie(s).map(d => {
    if (d.situacao === 'pulada') return { ordem: null, data: d.data, situacao: 'pulada', motivo: `O dia ${dia} não existe neste mês; mês pulado por escolha.` }
    if (d.situacao === 'inexistente') return { ordem: d.ordem, data: d.data, situacao: 'dia_inexistente', motivo: `O dia ${dia} não existe neste mês. Escolha usar o último dia do mês ou pular.` }
    try {
      validarOcorrencia(base, quem, s, d.data, agora)
      return { ordem: d.ordem, data: d.data, situacao: 'disponivel', motivo: d.situacao === 'ultimo_dia' ? `O dia ${dia} não existe neste mês; usado o último dia, por escolha.` : null }
    } catch (erro) {
      return { ordem: d.ordem, data: d.data, situacao: 'indisponivel', motivo: erro instanceof Error ? erro.message : 'Indisponível.' }
    }
  })
}

export function criarSerie(base: BaseDemo, perfil: Perfil | null, id: string, s: SerieDadosDemo, datas: string[], observacao: string, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  if (!datas.length) falhar('Escolha ao menos uma data da série.')
  const existente = base.series.find(x => x.id === id)
  if (existente) {
    if (existente.clienteId === s.clienteId && existente.criadoPor === quem.usuarioId) return base.agendamentos.filter(a => a.serieId === id).length
    falhar('Esta série já foi registrada.')
  }
  const lista = datasSerie(s)
  if (lista.some(d => d.situacao === 'inexistente')) falhar(`Alguns meses não têm o dia ${Number(s.dataInicial.slice(8))}. Escolha usar o último dia do mês ou pular esses meses.`)
  const validas = lista.filter(d => d.ordem !== null)
  if (datas.some(d => !validas.some(v => v.data === d))) falhar('As datas escolhidas não correspondem à série. Gere a prévia novamente.')
  return atomico(base, () => {
    base.series.push({ id, clienteId: s.clienteId, servicoId: s.servicoId, profissionalId: s.profissionalId, frequencia: s.frequencia, dataInicial: s.dataInicial, hora: s.hora,
      quantidade: s.quantidade, dataFinal: s.dataFinal, diaInexistente: s.diaInexistente, criadoPor: quem.usuarioId })
    const escolhidas = validas.filter(v => datas.includes(v.data))
    for (const d of escolhidas) {
      comPrefixo(`Ocorrência de ${d.data.split('-').reverse().join('/')}`, () => criarAgendamento(base, quem, {
        id: `${id}-${d.ordem}`, clienteId: s.clienteId, servicoId: s.servicoId, profissionalId: s.profissionalId, data: d.data, hora: s.hora,
        observacao, encaixe: false, justificativaConflito: s.justificativaConflito, serieId: id, serieOrdem: d.ordem ?? 0,
        motivoHistorico: `Série ${s.frequencia} (${d.ordem} de ${validas.length})`,
      }, agora))
    }
    return escolhidas.length
  })
}

/** Aguardando ou confirmadas e futuras; com aPartirDe, somente essa ocorrência e as seguintes. */
function ocorrenciasElegiveis(base: BaseDemo, serieId: string, aPartirDe: string | null, agora: Date) {
  const ordemInicial = aPartirDe ? base.agendamentos.find(a => a.id === aPartirDe && a.serieId === serieId)?.serieOrdem ?? Infinity : -Infinity
  return base.agendamentos.filter(a => a.serieId === serieId && (a.status === 'agendado' || a.status === 'confirmado')
    && Date.parse(instante(a.data, a.horaInicio)) > agora.getTime() && (a.serieOrdem ?? 0) >= ordemInicial)
    .sort((x, y) => (x.serieOrdem ?? 0) - (y.serieOrdem ?? 0))
}

const escopo = (aPartirDe: string | null) => aPartirDe ? ' (esta e as próximas da série)' : ' (toda a série)'

export function cancelarSerie(base: BaseDemo, perfil: Perfil | null, serieId: string, aPartirDe: string | null, motivo: string, versoes: Record<string, number>, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(motivo)
  const afetadas = ocorrenciasElegiveis(base, serieId, aPartirDe, agora)
  if (!afetadas.length) falhar('Nenhuma ocorrência futura desta série pode ser cancelada.')
  exigirVersoes(base, afetadas.map(a => a.id), versoes)
  for (const a of afetadas) {
    const antes = retrato(base, a)
    Object.assign(a, { status: 'cancelado', motivoCancelamento: limpo, canceladoEm: agora.toISOString(), versao: a.versao + 1 })
    registrar(base, quem, a, 'cancelado', limpo + escopo(aPartirDe), antes, agora)
  }
  return afetadas.length
}

export function reagendarSerie(base: BaseDemo, perfil: Perfil | null, serieId: string, aPartirDe: string | null, novo: { hora: string; profissionalId: string | null; motivo: string; justificativaConflito?: string }, versoes: Record<string, number>, agora = new Date()) {
  const quem = exigirPapel(perfil, ['admin', 'secretaria'])
  const limpo = exigirMotivo(novo.motivo)
  if (!novo.hora) falhar('Informe o novo horário.')
  const afetadas = ocorrenciasElegiveis(base, serieId, aPartirDe, agora)
  if (!afetadas.length) falhar('Nenhuma ocorrência futura desta série pode ser alterada.')
  exigirVersoes(base, afetadas.map(a => a.id), versoes)
  const profissionalId = novo.profissionalId ?? afetadas[0].profissionalId
  if (afetadas.every(a => a.horaInicio === novo.hora && a.profissionalId === profissionalId)) falhar('Informe um horário ou profissional diferente do atual.')
  atomico(base, () => {
    const retratos = new Map(afetadas.map(a => [a.id, retrato(base, a)]))
    for (const a of afetadas) {
      const duracao = a.profissionalId === profissionalId ? a.duracaoMinutos : duracaoEfetiva(base, profissionalId, a.servicoId) ?? falhar('Este profissional não está habilitado para o serviço da série.')
      Object.assign(a, { horaInicio: novo.hora, profissionalId, duracaoMinutos: duracao, versao: a.versao + 1 })
    }
    for (const a of afetadas) {
      comPrefixo(`Ocorrência de ${a.data.split('-').reverse().join('/')}`, () => revalidar(base, quem, a, novo.justificativaConflito, agora))
      registrar(base, quem, a, 'reagendado', limpo + escopo(aPartirDe), retratos.get(a.id) ?? null, agora)
    }
  })
  return afetadas.length
}

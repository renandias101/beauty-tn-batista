// Dados fictícios da demonstração. Nomes, telefones (DDD 00), jornadas e bloqueios são apenas exemplos:
// não representam regras, horários ou cadastros oficiais da clínica.
// Cada reserva é criada pelo motor de regras, com horários escolhidos entre os livres, então respeita
// duração do serviço, jornada, bloqueios e a ausência de sobreposição por profissional.
import { agoraNoFuso, diaDaSemana, fimDoMes, inicioDoMes, paraMinutos, somarDias, somarMinutos, deMinutos } from '../lib/datas'
import { bloqueioNaData, calcularHorariosLivres } from '../lib/horariosLivres'
import { ocupaPeriodo } from '../lib/status'
import type { Perfil } from '../types'
import { FUSO_DEMO, alterarStatus, cancelarAgendamento, criarAgendamento, criarBloqueio, criarEntradaEspera, criarMarcacao, criarSerie, duracaoEfetiva, horariosLivres, preverSerie, instante, reagendarAgendamento, registrarComunicacao, type AgendamentoDemo, type BaseDemo } from './motor'

const CORES = ['#9A6A20', '#7F9877', '#B68B5D', '#806456', '#8B789B', '#6D8FA3', '#A56F75', '#708B84']

const PROFISSIONAIS = ['Bianca Demo', 'Camila Demo', 'Daniela Demo', 'Eduarda Demo', 'Fernanda Demo', 'Gabriel Demo', 'Helena Demo', 'Isabela Demo']
const [BIANCA, CAMILA, DANIELA, EDUARDA, FERNANDA, GABRIEL, HELENA, ISABELA] = PROFISSIONAIS.map((_, i) => `demo-prof-${i + 1}`)

const SERVICOS: [string, number, string, boolean?, number?][] = [
  ['Maquiagem social', 60, 'Maquiagem'], ['Maquiagem para noivas', 120, 'Maquiagem'],
  ['Depilação de pernas', 45, 'Depilação'], ['Depilação de axilas', 15, 'Depilação'], ['Depilação completa', 90, 'Depilação'],
  ['Corte feminino', 60, 'Cabelos'], ['Escova', 45, 'Cabelos'], ['Coloração', 150, 'Cabelos'],
  ['Design de sobrancelhas', 30, 'Sobrancelhas'], ['Design com henna', 45, 'Sobrancelhas'],
  ['Micropigmentação de sobrancelhas', 150, 'Micropigmentação', true, 15], ['Retoque de micropigmentação', 90, 'Micropigmentação', true, 15],
  ['Extensão de cílios fio a fio', 120, 'Cílios', true, 10], ['Manutenção de cílios', 60, 'Cílios'], ['Lash lifting', 60, 'Cílios'],
  ['Massagem relaxante', 60, 'Massagem'], ['Drenagem linfática', 50, 'Massagem'], ['Massagem com pedras quentes', 75, 'Massagem', false],
]
const servico = (n: number) => `demo-serv-${n}`

const HABILITACOES: Record<string, number[]> = {
  [BIANCA]: [1, 2, 9], [CAMILA]: [9, 10, 13, 14, 15], [DANIELA]: [3, 4, 5], [EDUARDA]: [6, 7, 8],
  [FERNANDA]: [11, 12, 9], [GABRIEL]: [16, 17, 18], [HELENA]: [6, 7, 1], [ISABELA]: [13, 14, 15, 10],
}

// Jornadas de exemplo: [dias da semana, faixas]. Duas faixas no mesmo dia representam o intervalo.
type Faixas = [string, string][]
const JORNADAS: Record<string, [number[], Faixas][]> = {
  [BIANCA]: [[[2, 3, 4, 5], [['10:00', '13:00'], ['14:00', '19:00']]], [[6], [['08:00', '14:00']]]],
  [CAMILA]: [[[1, 2, 3, 4, 5], [['09:00', '12:00'], ['13:00', '18:00']]], [[6], [['08:00', '13:00']]]],
  [DANIELA]: [[[1, 2, 3, 4, 5], [['08:00', '12:00'], ['13:00', '17:00']]], [[6], [['08:00', '12:00']]]],
  [EDUARDA]: [[[1, 2, 4, 5], [['09:00', '12:00'], ['13:00', '18:00']]], [[6], [['08:00', '13:00']]]],
  [FERNANDA]: [[[1, 2, 3, 4], [['13:00', '20:00']]]],
  [GABRIEL]: [[[1, 2, 3, 4, 5], [['09:00', '13:00'], ['14:00', '19:00']]], [[6], [['09:00', '13:00']]]],
  [HELENA]: [[[3, 4, 5], [['09:00', '12:00'], ['13:00', '18:00']]], [[6], [['08:00', '13:00']]]],
  [ISABELA]: [[[1, 2, 3, 4, 5], [['09:00', '12:00'], ['13:00', '18:00']]], [[6], [['08:00', '13:00']]]],
}

const CLIENTES = [
  'Ana Exemplo', 'Beatriz Fictícia', 'Carla Exemplo', 'Débora Fictícia', 'Elaine Exemplo', 'Fabiana Fictícia', 'Giovana Exemplo',
  'Heloísa Fictícia', 'Ingrid Exemplo', 'Jéssica Fictícia', 'Karina Exemplo', 'Larissa Fictícia', 'Melissa Exemplo', 'Natália Fictícia',
  'Olívia Exemplo', 'Patrícia Fictícia', 'Raquel Exemplo', 'Sabrina Fictícia', 'Tatiane Exemplo', 'Úrsula Fictícia', 'Vanessa Exemplo',
  'Wanda Fictícia', 'Yasmin Exemplo', 'Zuleide Fictícia', 'Marcos Exemplo',
]
const telefoneFicticio = (n: number) => `(00) 90000-${String(n).padStart(4, '0')}`

const OBSERVACOES = ['Prefere contato pelo WhatsApp à tarde (exemplo).', 'Chegará com acompanhante (exemplo).', 'Pediu lembrete na véspera (exemplo).', 'Primeira visita à clínica (exemplo).']
const MOTIVOS_CANCELAMENTO = ['Cliente desmarcou por mensagem (exemplo).', 'Imprevisto de trabalho da cliente (exemplo).', 'Cliente remarcará depois (exemplo).', 'Viagem de última hora (exemplo).']

/** Gerador pseudoaleatório com semente fixa: a mesma data gera sempre a mesma demonstração. */
function sorteador(semente: number) {
  let estado = semente >>> 0
  const proximo = () => {
    estado = (estado + 0x6D2B79F5) >>> 0
    let t = estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { numero: proximo, escolher: <T,>(lista: T[]) => lista[Math.floor(proximo() * lista.length)] }
}

export function gerarBaseDemo(agora = new Date()): BaseDemo {
  const hoje = agoraNoFuso(FUSO_DEMO, agora).data
  const sorte = sorteador(Number(hoje.replace(/-/g, '')))
  let sequencia = 0
  const novoId = (prefixo: string) => () => `${prefixo}-${++sequencia}`

  const perfilDe = (usuarioId: string, nome: string, papel: Perfil['papel']): Perfil => ({ usuarioId, nome, papel, profissionalId: null, fusoHorario: FUSO_DEMO })
  const admin = perfilDe('demo-u-admin', 'Demo Administração', 'admin')
  const recepcao = perfilDe('demo-u-recepcao', 'Demo Recepção', 'secretaria')

  const base: BaseDemo = {
    versao: 1,
    geradaEm: agora.toISOString(),
    usuarios: [
      { usuarioId: admin.usuarioId, nome: admin.nome, usuario: 'demo.admin', papel: 'admin', ativo: true },
      { usuarioId: recepcao.usuarioId, nome: recepcao.nome, usuario: 'demo.recepcao', papel: 'secretaria', ativo: true },
      ...PROFISSIONAIS.map((nome, i) => ({ usuarioId: `demo-u-prof-${i + 1}`, nome, usuario: `demo.${nome.split(' ')[0].toLowerCase()}`, papel: 'profissional' as const, ativo: true })),
    ],
    profissionais: PROFISSIONAIS.map((nome, i) => ({ id: `demo-prof-${i + 1}`, nome, telefone: `(00) 98000-${String(i + 1).padStart(4, '0')}`, cor: CORES[i], ativo: true, usuarioId: `demo-u-prof-${i + 1}` })),
    servicos: SERVICOS.map(([nome, duracaoMinutos, categoria, ativo = true, preparacaoMinutos = 0], i) => ({ id: servico(i + 1), nome, duracaoMinutos, preparacaoMinutos, categoria, descricao: null, ativo })),
    // Exemplo de duração específica: Isabela faz a extensão de cílios em 150 minutos (padrão do serviço: 120).
    habilitacoes: Object.entries(HABILITACOES).flatMap(([profissionalId, lista]) => lista.map(n => ({ profissionalId, servicoId: servico(n), duracaoMinutos: profissionalId === ISABELA && n === 13 ? 150 : null }))),
    disponibilidades: Object.entries(JORNADAS).flatMap(([profissionalId, blocos]) => blocos.flatMap(([dias, faixas]) =>
      dias.flatMap(diaSemana => faixas.map(([horaInicio, horaFim]) => ({ id: `demo-disp-${++sequencia}`, profissionalId, diaSemana, horaInicio, horaFim }))))),
    excecoes: [],
    bloqueios: [],
    // Heloísa e Ingrid compartilham o telefone para demonstrar o alerta de possível duplicidade.
    clientes: CLIENTES.map((nome, i) => {
      const telefone = telefoneFicticio(i === 8 ? 8 : i + 1)
      return { id: `demo-cli-${String(i + 1).padStart(2, '0')}`, nome, telefone, telefoneDigitos: telefone.replace(/\D/g, '') }
    }),
    agendamentos: [],
    historico: [],
    // Recursos de exemplo: uma sala exclusiva e duas macas de massagem (capacidade 2).
    recursos: [
      { id: 'demo-rec-1', nome: 'Sala de micropigmentação', tipo: 'sala', capacidade: 1, ativo: true },
      { id: 'demo-rec-2', nome: 'Macas de massagem', tipo: 'equipamento', capacidade: 2, ativo: true },
    ],
    servicoRecursos: [
      { servicoId: servico(11), recursoId: 'demo-rec-1' }, { servicoId: servico(12), recursoId: 'demo-rec-1' },
      { servicoId: servico(16), recursoId: 'demo-rec-2' }, { servicoId: servico(17), recursoId: 'demo-rec-2' }, { servicoId: servico(18), recursoId: 'demo-rec-2' },
    ],
    comunicacoes: [],
    listaEspera: [],
    contatosEspera: [],
    grupos: [],
    series: [],
  }

  const atende = (profissionalId: string, data: string) =>
    base.disponibilidades.some(d => d.profissionalId === profissionalId && d.diaSemana === diaDaSemana(data))
    || base.excecoes.some(e => e.profissionalId === profissionalId && e.data === data)
  const proximoDia = (profissionalId: string, data: string) => {
    for (let i = 0; i < 7; i++) if (atende(profissionalId, somarDias(data, i))) return somarDias(data, i)
    return data
  }

  // Exceção de exemplo: abre um sábado à manhã para a micropigmentação, fora da jornada habitual.
  const sabado = somarDias(hoje, ((6 - diaDaSemana(hoje) + 7) % 7) || 7)
  base.excecoes.push({ id: 'demo-exc-1', profissionalId: FERNANDA, data: sabado, horaInicio: '09:00', horaFim: '13:00', motivo: 'Mutirão de micropigmentação (exemplo)', removidoEm: null })
  // Se hoje ninguém atende (domingo), abre uma manhã de exemplo para a agenda de hoje não ficar vazia.
  if (![CAMILA, EDUARDA, DANIELA, GABRIEL].some(p => atende(p, hoje))) {
    for (const profissionalId of [CAMILA, EDUARDA, DANIELA, GABRIEL]) {
      base.excecoes.push({ id: `demo-exc-${profissionalId}`, profissionalId, data: hoje, horaInicio: '09:00', horaFim: '14:00', motivo: 'Atendimento especial (exemplo)', removidoEm: null })
    }
  }

  // Bloqueios de exemplo, criados antes das reservas para que os horários os respeitem.
  const bloquear = (profissionalId: string, dataInicio: string, dataFim: string, horaInicio: string, horaFim: string, motivo: string, diaInteiro = false) => {
    try { criarBloqueio(base, admin, { profissionalId, dataInicio, dataFim, horaInicio, horaFim, motivo, diaInteiro }, novoId('demo-bloq')) } catch { /* exemplo dispensável */ }
  }
  const diaDaniela = proximoDia(DANIELA, hoje)
  bloquear(DANIELA, diaDaniela, diaDaniela, '10:00', '11:00', 'Manutenção da sala (exemplo)')
  const diaCamila = proximoDia(CAMILA, somarDias(hoje, 1))
  bloquear(CAMILA, diaCamila, diaCamila, '14:00', '16:00', 'Consulta médica (exemplo)')
  const diaIsabela = proximoDia(ISABELA, somarDias(hoje, 2))
  bloquear(ISABELA, diaIsabela, diaIsabela, '09:00', '10:00', 'Reunião de equipe (exemplo)')
  const diaEduarda = proximoDia(EDUARDA, somarDias(hoje, 8))
  bloquear(EDUARDA, diaEduarda, diaEduarda, '', '', 'Curso de coloração (exemplo)', true)
  bloquear(GABRIEL, somarDias(hoje, 15), somarDias(hoje, 17), '', '', 'Férias (exemplo)', true)

  // ---------- Reservas ----------
  let contadorCliente = 0
  const clientesNoDia = new Map<string, Set<string>>()
  const escolherCliente = (data: string) => {
    const usados = clientesNoDia.get(data) ?? new Set<string>()
    let cliente = base.clientes[contadorCliente++ % base.clientes.length]
    for (let tentativa = 0; usados.has(cliente.id) && tentativa < base.clientes.length; tentativa++) cliente = base.clientes[contadorCliente++ % base.clientes.length]
    usados.add(cliente.id)
    clientesNoDia.set(data, usados)
    return cliente.id
  }

  const ocupados = (profissionalId: string, data: string, ignorarId?: string) => [
    ...base.bloqueios.filter(b => b.profissionalId === profissionalId && !b.removidoEm).map(b => bloqueioNaData(b, data, FUSO_DEMO)).filter(Boolean) as { inicio: number; fim: number }[],
    ...base.agendamentos.filter(a => a.id !== ignorarId && a.profissionalId === profissionalId && a.data === data && ocupaPeriodo(a.status))
      .map(a => ({ inicio: paraMinutos(a.horaInicio), fim: paraMinutos(a.horaInicio) + a.duracaoMinutos + a.preparacaoMinutos })),
  ]
  const faixasDoDia = (profissionalId: string, data: string) => [
    ...base.disponibilidades.filter(d => d.profissionalId === profissionalId && d.diaSemana === diaDaSemana(data)),
    ...base.excecoes.filter(e => e.profissionalId === profissionalId && e.data === data),
  ]
  const livres = (profissionalId: string, data: string, duracao: number, preparacao = 0, ignorarId?: string, aPartirDe = 0) =>
    calcularHorariosLivres({ faixas: faixasDoDia(profissionalId, data), ocupados: ocupados(profissionalId, data, ignorarId), duracaoMinutos: duracao, preparacaoMinutos: preparacao, aPartirDeMinutos: aPartirDe })

  let observacoes = 0
  const colocar = (profissionalId: string, dataDesejada: string, sequencial: boolean, encaixe = false) => {
    const data = proximoDia(profissionalId, dataDesejada)
    const opcoes = base.servicos.filter(s => s.ativo && base.habilitacoes.some(h => h.profissionalId === profissionalId && h.servicoId === s.id))
    for (let tentativa = 0; tentativa < opcoes.length; tentativa++) {
      const s = tentativa === 0 ? sorte.escolher(opcoes) : opcoes[tentativa]
      const lista = livres(profissionalId, data, duracaoEfetiva(base, profissionalId, s.id) ?? s.duracaoMinutos, s.preparacaoMinutos)
      if (!lista.length) continue
      const redondos = lista.filter(m => m % 30 === 0)
      const minuto = sequencial ? lista[0] : sorte.escolher(redondos.length ? redondos : lista)
      const comObservacao = observacoes < OBSERVACOES.length && sorte.numero() < 0.15
      try {
        return criarAgendamento(base, sorte.numero() < 0.7 ? recepcao : admin, {
          id: `demo-ag-${String(base.agendamentos.length + 1).padStart(2, '0')}`, clienteId: escolherCliente(data), servicoId: s.id, profissionalId,
          data, hora: deMinutos(minuto), observacao: comObservacao ? OBSERVACOES[observacoes++] : '', encaixe,
        }, agora, { permitirPassado: true })
      } catch {
        // O motor recusou (não deveria, pois o horário veio da lista de livres): o exemplo é descartado.
      }
    }
    return null
  }

  // Hoje: agendas movimentadas para três profissionais e uma reserva avulsa.
  const repetir = (vezes: number, acao: () => void) => { for (let i = 0; i < vezes; i++) acao() }
  repetir(4, () => colocar(CAMILA, hoje, true))
  repetir(3, () => colocar(EDUARDA, hoje, true))
  repetir(3, () => colocar(DANIELA, hoje, true))
  colocar(GABRIEL, hoje, false, true)
  // Próximos dias.
  const proximos: [string, number, number][] = [
    [BIANCA, 1, 2], [ISABELA, 1, 2], [FERNANDA, 1, 1],
    [HELENA, 2, 2], [CAMILA, 2, 1], [GABRIEL, 2, 2],
    [DANIELA, 3, 2], [EDUARDA, 3, 1],
    [ISABELA, 4, 2], [BIANCA, 4, 1],
    [FERNANDA, 5, 1], [HELENA, 5, 1], [GABRIEL, 6, 1],
  ]
  for (const [p, dias, vezes] of proximos) repetir(vezes, () => colocar(p, somarDias(hoje, dias), false))
  // Exceção de sábado em uso.
  colocar(FERNANDA, sabado, false)
  // Outras semanas do mês atual (antes ou depois da semana corrente).
  const primeiro = inicioDoMes(hoje)
  const ultimo = fimDoMes(hoje)
  const candidatos: string[] = []
  for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) if (dia < hoje || dia > somarDias(hoje, 6)) candidatos.push(dia)
  const outras = candidatos.length ? Array.from({ length: 9 }, (_, i) => candidatos[Math.floor((i * candidatos.length) / 9)]) : []
  outras.forEach((dia, i) => colocar(PROFISSIONAIS.map((_, n) => `demo-prof-${n + 1}`)[i % 8], dia, false))

  // ---------- Situações (somente status já implementados) ----------
  const agoraMs = agora.getTime()
  const inicioMs = (a: AgendamentoDemo) => Date.parse(instante(a.data, a.horaInicio))
  const fimMs = (a: AgendamentoDemo) => Date.parse(instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos)))
  const recepcaoCom = (a: AgendamentoDemo, tipo: 'confirmacao' | 'lembrete') => registrarComunicacao(base, recepcao, `demo-com-${base.comunicacoes.length + 1}`, a.id, tipo, agora)
  const ordenados = [...base.agendamentos].sort((x, y) => inicioMs(x) - inicioMs(y))
  const passado = ordenados.filter(a => fimMs(a) <= agoraMs)
  const emAndamento = ordenados.filter(a => inicioMs(a) <= agoraMs && fimMs(a) > agoraMs)
  const futuro = ordenados.filter(a => inicioMs(a) > agoraMs)
  const caminho = (a: AgendamentoDemo, passos: AgendamentoDemo['status'][]) => passos.forEach(status => alterarStatus(base, recepcao, a.id, status, a.versao, agora))
  let motivos = 0

  passado.forEach((a, i) => {
    if (i % 7 === 3) caminho(a, ['faltou'])
    else if (i % 7 === 5) cancelarAgendamento(base, recepcao, a.id, MOTIVOS_CANCELAMENTO[motivos++ % MOTIVOS_CANCELAMENTO.length], a.versao, agora)
    else caminho(a, ['confirmado', 'chegou', 'em_atendimento', 'concluido'])
  })
  emAndamento.forEach(a => caminho(a, ['confirmado', 'chegou', 'em_atendimento']))

  const futurosDeOutrosDias = futuro.filter(a => a.data !== hoje)
  // Cancelamentos futuros liberam horários na agenda.
  const aCancelar = [futurosDeOutrosDias[2], futurosDeOutrosDias[9], futurosDeOutrosDias[16]].filter(Boolean)
  aCancelar.forEach(a => cancelarAgendamento(base, recepcao, a.id, MOTIVOS_CANCELAMENTO[motivos++ % MOTIVOS_CANCELAMENTO.length], a.versao, agora))
  // Reagendamentos com histórico: o novo horário é escolhido entre os livres do mesmo profissional.
  for (const a of [futurosDeOutrosDias[5], futurosDeOutrosDias[12]].filter(Boolean)) {
    for (const dias of [1, 2, 3]) {
      const data = proximoDia(a.profissionalId, somarDias(a.data, dias))
      const lista = livres(a.profissionalId, data, a.duracaoMinutos, a.preparacaoMinutos, a.id)
      if (!lista.length) continue
      recepcaoCom(a, 'confirmacao')
      reagendarAgendamento(base, recepcao, a.id, { data, hora: deMinutos(lista[Math.floor(lista.length / 2)]), profissionalId: a.profissionalId, motivo: 'Cliente pediu outro horário (exemplo).' }, a.versao, agora)
      break
    }
  }
  futuro.filter(a => a.status === 'agendado').forEach(a => {
    const minutosParaComecar = (inicioMs(a) - agoraMs) / 60000
    if (a.data === hoje && minutosParaComecar <= 30) caminho(a, ['confirmado', 'chegou'])
    else if (sorte.numero() < 0.55) { recepcaoCom(a, 'confirmacao'); caminho(a, ['confirmado']) }
    // Algumas mensagens enviadas ainda sem resposta: mensagem enviada não é presença confirmada.
    else if (sorte.numero() < 0.4) recepcaoCom(a, 'confirmacao')
  })

  // Lista de espera de exemplo (não reserva horários).
  const esperar = (id: string, cliente: number, servicoN: number, profissionalId: string | null, dias: number, faixa: [string, string] | null, observacao: string) => {
    try {
      criarEntradaEspera(base, recepcao, { id, clienteId: base.clientes[cliente].id, servicoId: servico(servicoN), profissionalId, dataInicio: hoje, dataFim: somarDias(hoje, dias),
        horaInicio: faixa?.[0] ?? null, horaFim: faixa?.[1] ?? null, observacao }, agora)
    } catch { /* exemplo dispensável */ }
  }
  // Marcação de exemplo com dois serviços em sequência (corte com Eduarda e design com Camila) e uma série semanal.
  for (let dias = 2; dias <= 7; dias++) {
    const data = somarDias(hoje, dias)
    const corte = horariosLivres(base, { servicoId: servico(6), profissionalId: EDUARDA, data }, agora)
    const encaixe = corte.find(h => horariosLivres(base, { servicoId: servico(9), profissionalId: CAMILA, data }, agora).includes(somarMinutos(h, 60)))
    if (!encaixe) continue
    try {
      criarMarcacao(base, recepcao, { id: 'demo-grupo-1', clienteId: base.clientes[22].id, observacao: '', etapas: [
        { servicoId: servico(6), profissionalId: EDUARDA, data, hora: encaixe },
        { servicoId: servico(9), profissionalId: CAMILA, data, hora: somarMinutos(encaixe, 60) },
      ] }, agora)
      break
    } catch { /* exemplo dispensável */ }
  }
  try {
    // Dia útil (às 17h o Gabriel atende de segunda a sexta).
    let inicioSerie = somarDias(hoje, 3)
    while (diaDaSemana(inicioSerie) === 0 || diaDaSemana(inicioSerie) === 6) inicioSerie = somarDias(inicioSerie, 1)
    const serie = { clienteId: base.clientes[16].id, servicoId: servico(17), profissionalId: GABRIEL, dataInicial: inicioSerie, hora: '17:00', frequencia: 'semanal' as const, quantidade: 6, dataFinal: null, diaInexistente: null }
    const datas = preverSerie(base, recepcao, serie, agora).filter(p => p.situacao === 'disponivel').map(p => p.data)
    if (datas.length) criarSerie(base, recepcao, 'demo-serie-1', serie, datas, 'Pacote de drenagem (exemplo).', agora)
  } catch { /* exemplo dispensável */ }

  esperar('demo-esp-1', 3, 9, null, 14, ['09:00', '12:00'], 'Prefere manhã (exemplo).')
  esperar('demo-esp-2', 6, 14, CAMILA, 10, null, 'Aceita encaixe com aviso no mesmo dia (exemplo).')
  esperar('demo-esp-3', 11, 6, null, 21, ['13:00', '18:00'], 'Somente à tarde (exemplo).')

  return base
}

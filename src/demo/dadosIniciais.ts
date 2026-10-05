// Dados fictícios da demonstração: existem somente no navegador e nunca vão para o Supabase.
// Simulam uma clínica em uso há algumas semanas. Cada reserva, mudança de status, reagendamento, cancelamento,
// mensagem registrada, marcação, série e entrada da lista de espera passa pelo motor de regras (motor.ts), no instante
// em que teria acontecido; assim o histórico é coerente e os dados obedecem às mesmas regras do sistema real.
// Nomes e telefones (DDD 00) são inventados. Jornadas, serviços e recursos são exemplos, não cadastros oficiais da clínica.
// Os cenários essenciais vêm de um roteiro fixo; o sorteio (semente = data de hoje) só varia o preenchimento da agenda.
import { agoraNoFuso, deMinutos, diaDaSemana, paraMinutos, somarDias } from '../lib/datas'
import type { Perfil, TipoComunicacao } from '../types'
import {
  FUSO_DEMO, alterarStatus, atualizarEntradaEspera, cancelarAgendamento, corrigirStatus, criarAgendamento, criarBloqueio, criarEntradaEspera, criarMarcacao,
  criarSerie, duracaoEfetiva, editarAgendamento, horariosLivres, instante, preverSerie, reagendarAgendamento, recursoDisponivel, registrarComunicacao,
  validarReserva, type BaseDemo, type SerieDadosDemo,
} from './motor'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

// ---------- Equipe e acessos ----------

const perfil = (usuarioId: string, nome: string, papel: Perfil['papel']): Perfil => ({ usuarioId, nome, papel, profissionalId: null, fusoHorario: FUSO_DEMO })
const ADMIN = perfil('demo-u-helena', 'Helena Vasconcelos', 'admin')
const CAROLINA = perfil('demo-u-carolina', 'Carolina Duarte', 'secretaria')
const MIRELA = perfil('demo-u-mirela', 'Mirela Fonseca', 'secretaria')
// Recepcionista que saiu da clínica: aparece no histórico antigo, mas a conta está desativada.
const PAULA = perfil('demo-u-paula', 'Paula Siqueira', 'secretaria')

const P = {
  luana: 'demo-prof-luana', renata: 'demo-prof-renata', thais: 'demo-prof-thais', priscila: 'demo-prof-priscila', juliana: 'demo-prof-juliana',
  aline: 'demo-prof-aline', rafael: 'demo-prof-rafael', simone: 'demo-prof-simone', marta: 'demo-prof-marta',
}

// Thaís e Rafael atendem sem conta de acesso. Marta saiu da clínica: profissional e conta inativos, histórico preservado.
const PROFISSIONAIS = [
  { id: P.luana, nome: 'Luana Ribeiro', telefone: '(00) 98101-2201', cor: '#9A6A20', usuarioId: 'demo-u-luana', usuario: 'luana.ribeiro' },
  { id: P.renata, nome: 'Renata Moraes', telefone: '(00) 98102-3302', cor: '#7F9877', usuarioId: 'demo-u-renata', usuario: 'renata.moraes' },
  { id: P.thais, nome: 'Thaís Andrade', telefone: '(00) 98103-4403', cor: '#B68B5D', usuarioId: null, usuario: null },
  { id: P.priscila, nome: 'Priscila Nogueira', telefone: '(00) 98104-5504', cor: '#806456', usuarioId: 'demo-u-priscila', usuario: 'priscila.nogueira' },
  { id: P.juliana, nome: 'Juliana Prado', telefone: '(00) 98105-6605', cor: '#8B789B', usuarioId: 'demo-u-juliana', usuario: 'juliana.prado' },
  { id: P.aline, nome: 'Aline Cardoso', telefone: '(00) 98106-7706', cor: '#6D8FA3', usuarioId: 'demo-u-aline', usuario: 'aline.cardoso' },
  { id: P.rafael, nome: 'Rafael Teixeira', telefone: null, cor: '#A56F75', usuarioId: null, usuario: null },
  { id: P.simone, nome: 'Simone Freitas', telefone: '(00) 3210-0008', cor: '#708B84', usuarioId: 'demo-u-simone', usuario: 'simone.freitas' },
  { id: P.marta, nome: 'Marta Leal', telefone: '(00) 98109-9909', cor: '#9C8F7A', usuarioId: 'demo-u-marta', usuario: 'marta.leal' },
]
const ATIVOS = [P.luana, P.renata, P.thais, P.priscila, P.juliana, P.aline, P.rafael, P.simone]

// ---------- Serviços, habilitações e recursos ----------

const S = {
  maqSocial: 'demo-serv-maquiagem-social', maqNoiva: 'demo-serv-maquiagem-noiva', depPernas: 'demo-serv-depilacao-pernas', depAxilas: 'demo-serv-depilacao-axilas',
  depCompleta: 'demo-serv-depilacao-completa', corte: 'demo-serv-corte', escova: 'demo-serv-escova', coloracao: 'demo-serv-coloracao', hidratacao: 'demo-serv-hidratacao',
  progressiva: 'demo-serv-progressiva', design: 'demo-serv-design', henna: 'demo-serv-henna', microSobrancelha: 'demo-serv-micro-sobrancelha',
  retoque: 'demo-serv-retoque-micro', microLabial: 'demo-serv-micro-labial', extensao: 'demo-serv-extensao-cilios', manutencao: 'demo-serv-manutencao-cilios',
  lashLifting: 'demo-serv-lash-lifting', relaxante: 'demo-serv-massagem-relaxante', drenagem: 'demo-serv-drenagem', pedras: 'demo-serv-pedras-quentes',
}

// [id, nome, duração, preparação, categoria, descrição, ativo]
const SERVICOS: [string, string, number, number, string, string | null, boolean][] = [
  [S.maqSocial, 'Maquiagem social', 60, 0, 'Maquiagem', 'Maquiagem para eventos, formaturas e ocasiões especiais.', true],
  [S.maqNoiva, 'Maquiagem para noivas', 120, 15, 'Maquiagem', 'Inclui preparação da pele e fixação para longa duração.', true],
  [S.depPernas, 'Depilação de pernas', 45, 10, 'Depilação', null, true],
  [S.depAxilas, 'Depilação de axilas', 15, 5, 'Depilação', null, true],
  [S.depCompleta, 'Depilação completa', 90, 10, 'Depilação', 'Pernas, axilas e virilha.', true],
  [S.corte, 'Corte feminino', 60, 0, 'Cabelos', null, true],
  [S.escova, 'Escova', 45, 0, 'Cabelos', null, true],
  [S.coloracao, 'Coloração', 150, 15, 'Cabelos', 'Coloração completa com finalização.', true],
  [S.hidratacao, 'Hidratação capilar', 60, 0, 'Cabelos', null, true],
  // Descontinuado: tem atendimentos antigos no histórico, mas não aparece para novas reservas.
  [S.progressiva, 'Escova progressiva', 180, 15, 'Cabelos', 'Serviço descontinuado.', false],
  [S.design, 'Design de sobrancelhas', 30, 0, 'Sobrancelhas', null, true],
  [S.henna, 'Design com henna', 45, 0, 'Sobrancelhas', 'Design com aplicação de henna para preenchimento.', true],
  [S.microSobrancelha, 'Micropigmentação de sobrancelhas', 150, 15, 'Micropigmentação', 'Realizada na sala de procedimentos.', true],
  [S.retoque, 'Retoque de micropigmentação', 90, 15, 'Micropigmentação', null, true],
  // Ativo, mas só a profissional inativa era habilitada: a página pública mostra o serviço sem profissional disponível.
  [S.microLabial, 'Micropigmentação labial', 120, 15, 'Micropigmentação', 'Realce do contorno e da cor dos lábios.', true],
  [S.extensao, 'Extensão de cílios fio a fio', 120, 10, 'Cílios', 'Aplicação fio a fio; manutenção recomendada a cada 15 a 20 dias.', true],
  [S.manutencao, 'Manutenção de cílios', 60, 0, 'Cílios', null, true],
  [S.lashLifting, 'Lash lifting', 60, 0, 'Cílios', null, true],
  [S.relaxante, 'Massagem relaxante', 60, 10, 'Massagem', 'Sessão de 60 minutos com óleos neutros.', true],
  [S.drenagem, 'Drenagem linfática', 50, 10, 'Massagem', null, true],
  [S.pedras, 'Massagem com pedras quentes', 75, 15, 'Massagem', 'Temporariamente indisponível.', false],
]

// [profissional, serviço, duração específica]. Sem duração específica vale a padrão do serviço.
const HABILITACOES: [string, string, number?][] = [
  [P.luana, S.maqSocial], [P.luana, S.maqNoiva], [P.luana, S.design], [P.luana, S.henna],
  [P.renata, S.corte], [P.renata, S.escova], [P.renata, S.coloracao, 180], [P.renata, S.hidratacao], [P.renata, S.progressiva],
  [P.thais, S.corte, 45], [P.thais, S.escova], [P.thais, S.maqSocial],
  [P.priscila, S.depPernas], [P.priscila, S.depAxilas], [P.priscila, S.depCompleta],
  [P.juliana, S.design], [P.juliana, S.henna], [P.juliana, S.microSobrancelha], [P.juliana, S.retoque],
  [P.aline, S.extensao, 150], [P.aline, S.manutencao], [P.aline, S.lashLifting], [P.aline, S.design],
  [P.rafael, S.relaxante], [P.rafael, S.drenagem], [P.rafael, S.pedras],
  [P.simone, S.drenagem, 60], [P.simone, S.relaxante],
  [P.marta, S.microLabial], [P.marta, S.microSobrancelha],
]

const R = { sala: 'demo-rec-sala', macas: 'demo-rec-macas', cabine: 'demo-rec-cabine', bancada: 'demo-rec-bancada', pedras: 'demo-rec-pedras' }
const RECURSOS = [
  { id: R.sala, nome: 'Sala de procedimentos', tipo: 'sala' as const, capacidade: 1, ativo: true },
  { id: R.macas, nome: 'Macas de massagem', tipo: 'equipamento' as const, capacidade: 2, ativo: true },
  { id: R.cabine, nome: 'Cabine de depilação', tipo: 'sala' as const, capacidade: 1, ativo: true },
  { id: R.bancada, nome: 'Bancada de maquiagem', tipo: 'outro' as const, capacidade: 1, ativo: true },
  { id: R.pedras, nome: 'Kit de pedras quentes', tipo: 'equipamento' as const, capacidade: 1, ativo: false },
]
// Cabelos, sobrancelhas, manutenção de cílios e lash lifting não exigem recurso.
const SERVICO_RECURSOS: [string, string][] = [
  [S.microSobrancelha, R.sala], [S.retoque, R.sala], [S.microLabial, R.sala], [S.extensao, R.sala],
  [S.relaxante, R.macas], [S.drenagem, R.macas], [S.pedras, R.macas], [S.pedras, R.pedras],
  [S.depPernas, R.cabine], [S.depAxilas, R.cabine], [S.depCompleta, R.cabine],
  [S.maqSocial, R.bancada], [S.maqNoiva, R.bancada],
]

// Jornadas: [dias da semana (0 = domingo), faixas]. Duas faixas no mesmo dia representam o intervalo.
const JORNADAS: Record<string, [number[], [string, string][]][]> = {
  [P.luana]: [[[2, 3, 4, 5], [['10:00', '13:00'], ['14:00', '19:00']]], [[6], [['08:00', '16:00']]]],
  [P.renata]: [[[1, 2, 3, 4, 5], [['09:00', '12:00'], ['13:00', '18:00']]], [[6], [['08:00', '13:00']]]],
  [P.thais]: [[[3, 4, 5, 6], [['12:00', '20:00']]]],
  [P.priscila]: [[[1, 2, 3, 4, 5], [['08:00', '12:00'], ['13:00', '17:00']]]],
  [P.juliana]: [[[1, 3, 5], [['09:00', '12:30'], ['14:00', '18:30']]], [[6], [['09:00', '13:00']]]],
  [P.aline]: [[[1, 2, 3, 4, 5], [['10:00', '19:00']]], [[6], [['09:00', '14:00']]]],
  [P.rafael]: [[[1, 2, 3, 4, 5], [['13:00', '21:00']]]],
  [P.simone]: [[[2, 4], [['08:00', '12:00'], ['13:30', '17:30']]], [[6], [['08:00', '12:00']]]],
  [P.marta]: [[[1, 2, 3, 4], [['09:00', '17:00']]]],
}

// ---------- Clientes ----------

const CLIENTES = [
  'Mariana Lopes', 'Beatriz Almeida', 'Camila Rezende', 'Daniela Fontes', 'Eduarda Pacheco', 'Gabriela Torres', 'Isabela Martins', 'Larissa Campos',
  'Natália Rocha', 'Olívia Barreto', 'Patrícia Gomes', 'Raquel Antunes', 'Sabrina Moura', 'Tatiana Lacerda', 'Vanessa Quintela', 'Yasmin Carvalho',
  'Adriana Peixoto', 'Bruna Mendes', 'Cláudia Mendes', 'Denise Araújo', 'Elisa Farias', 'Flávia Guerra', 'Giovana Sampaio', 'Heloísa Brandão',
  'Ingrid Vasques', 'Jéssica Nascimento', 'Kátia Lemos', 'Letícia Macedo', 'Manuela Coutinho', 'Nicole Bastos', 'Pâmela Rangel', 'Rebeca Salles',
  'Sílvia Matos', 'Tânia Figueira', 'Valéria Pimentel', 'Viviane Dantas', 'Lorena Cavalcanti', 'Alice Medeiros', 'Cecília Valente', 'Débora Lins',
  'Joana Bittencourt', 'Lívia Albuquerque', 'Marcos Vieira', 'Clara Rosário', 'Sofia Arantes',
]
// Bruna e Cláudia Mendes (mãe e filha) usam o mesmo telefone: demonstra o aviso de possível duplicidade.
const TELEFONE_COMPARTILHADO = [17, 18]
const telefoneFicticio = (i: number) => {
  const n = TELEFONE_COMPARTILHADO.includes(i) ? TELEFONE_COMPARTILHADO[0] : i
  return `(00) 9${String(8100 + n).padStart(4, '0')}-${String(2000 + n * 37).padStart(4, '0')}`
}

// ---------- Textos operacionais (sem dados de saúde ou sensíveis) ----------

const OBSERVACOES = [
  'Prefere ser chamada pelo WhatsApp.',
  'Pediu lembrete na véspera.',
  'Primeira visita à clínica.',
  'Pode atrasar uns 10 minutos.',
  'Cliente pediu para confirmar o horário na véspera pela manhã e avisou que pode chegar até 10 minutos atrasada por causa da saída do trabalho. Se atrasar mais do que isso, prefere remarcar.',
  'Vem acompanhada da filha, que vai aguardar na recepção.',
  'Indicação de outra cliente. Quer conhecer os demais serviços ao final do atendimento; separar o folheto de serviços na recepção.',
]
const MOTIVOS_CANCELAMENTO = [
  'Cliente solicitou o cancelamento.', 'Imprevisto pessoal da cliente.', 'Viagem de última hora.', 'Incompatibilidade de horário.', 'Cliente pediu para remarcar posteriormente.',
]

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
  return gerarDemonstracao(agora).base
}

/**
 * Gera a base e lista os cenários do roteiro que não puderam ser criados (deve ficar vazia; os testes conferem).
 * Uma falha num cenário nunca impede a demonstração de abrir: o cenário é apenas omitido.
 */
export function gerarDemonstracao(agora = new Date()): { base: BaseDemo; pendencias: string[] } {
  const agoraMs = agora.getTime()
  const { data: hoje, hora: horaAgora } = agoraNoFuso(FUSO_DEMO, agora)
  const minutoAgora = paraMinutos(horaAgora)
  const sorte = sorteador(Number(hoje.replace(/-/g, '')))
  const dia = (deslocamento: number) => somarDias(hoje, deslocamento)
  const ms = (data: string, hora: string) => Date.parse(instante(data, hora))
  const iso = (t: number) => new Date(t).toISOString()
  const pendencias: string[] = []
  const roteiro = (nome: string, acao: () => unknown) => {
    try { if (!acao()) pendencias.push(nome) } catch (erro) { pendencias.push(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`) }
  }

  const base: BaseDemo = {
    versao: 1,
    geradaEm: agora.toISOString(),
    usuarios: [
      { usuarioId: ADMIN.usuarioId, nome: ADMIN.nome, usuario: 'helena.admin', papel: 'admin', ativo: true },
      { usuarioId: CAROLINA.usuarioId, nome: CAROLINA.nome, usuario: 'carolina.recepcao', papel: 'secretaria', ativo: true },
      { usuarioId: MIRELA.usuarioId, nome: MIRELA.nome, usuario: 'mirela.recepcao', papel: 'secretaria', ativo: true },
      { usuarioId: PAULA.usuarioId, nome: PAULA.nome, usuario: 'paula.recepcao', papel: 'secretaria', ativo: false },
      ...PROFISSIONAIS.filter(p => p.usuarioId).map(p => ({ usuarioId: p.usuarioId!, nome: p.nome, usuario: p.usuario!, papel: 'profissional' as const, ativo: p.id !== P.marta })),
    ],
    // Marta começa ativa para registrar os atendimentos antigos; é inativada logo depois.
    profissionais: PROFISSIONAIS.map(p => ({ id: p.id, nome: p.nome, telefone: p.telefone, cor: p.cor, ativo: true, usuarioId: p.usuarioId })),
    // A escova progressiva começa ativa pelo mesmo motivo (atendimento antigo no histórico).
    servicos: SERVICOS.map(([id, nome, duracaoMinutos, preparacaoMinutos, categoria, descricao, ativo]) =>
      ({ id, nome, duracaoMinutos, preparacaoMinutos, categoria, descricao, ativo: ativo || id === S.progressiva })),
    habilitacoes: HABILITACOES.map(([profissionalId, servicoId, duracaoMinutos]) => ({ profissionalId, servicoId, duracaoMinutos: duracaoMinutos ?? null })),
    disponibilidades: Object.entries(JORNADAS).flatMap(([profissionalId, blocos]) => blocos.flatMap(([dias, faixas]) =>
      dias.flatMap(diaSemana => faixas.map(([horaInicio, horaFim]) => ({ id: `demo-disp-${profissionalId.slice(10)}-${diaSemana}-${horaInicio.replace(':', '')}`, profissionalId, diaSemana, horaInicio, horaFim }))))),
    excecoes: [],
    bloqueios: [],
    clientes: CLIENTES.map((nome, i) => {
      const telefone = telefoneFicticio(i)
      return { id: `demo-cli-${String(i + 1).padStart(2, '0')}`, nome, telefone, telefoneDigitos: telefone.replace(/\D/g, '') }
    }),
    agendamentos: [],
    historico: [],
    configuracao: { whatsapp: '00999990000', horizonteDias: 30 },
    recursos: RECURSOS.map(r => ({ ...r })),
    servicoRecursos: SERVICO_RECURSOS.map(([servicoId, recursoId]) => ({ servicoId, recursoId })),
    comunicacoes: [],
    listaEspera: [],
    contatosEspera: [],
    grupos: [],
    series: [],
    // Um pedido de nova senha em aberto (conta ativa) e dois já encerrados pela administração.
    pedidosSenha: [
      { id: 'demo-pedido-senha-1', usuarioId: 'demo-u-renata', solicitadoEm: iso(agoraMs - 12 * DIA - 3 * HORA), encerradoEm: iso(agoraMs - 12 * DIA - 2 * HORA), encerradoPor: ADMIN.usuarioId, resolucao: 'senha_redefinida' },
      { id: 'demo-pedido-senha-2', usuarioId: 'demo-u-priscila', solicitadoEm: iso(agoraMs - 5 * DIA - 6 * HORA), encerradoEm: iso(agoraMs - 5 * DIA - 5 * HORA), encerradoPor: ADMIN.usuarioId, resolucao: 'descartado' },
      { id: 'demo-pedido-senha-3', usuarioId: MIRELA.usuarioId, solicitadoEm: iso(agoraMs - 35 * MINUTO), encerradoEm: null, encerradoPor: null, resolucao: null },
    ],
  }

  // ---------- Consultas auxiliares ----------

  const cliente = (i: number) => base.clientes[i].id
  const ag = (id: string) => base.agendamentos.find(a => a.id === id)!
  const preparo = (servicoId: string) => base.servicos.find(s => s.id === servicoId)!.preparacaoMinutos
  const faixasDe = (prof: string, data: string) => [
    ...base.disponibilidades.filter(d => d.profissionalId === prof && d.diaSemana === diaDaSemana(data)),
    ...base.excecoes.filter(e => !e.removidoEm && e.profissionalId === prof && e.data === data),
  ]
  const atende = (prof: string, data: string) => faixasDe(prof, data).length > 0
  const servicosDe = (prof: string) => base.habilitacoes
    .filter(h => h.profissionalId === prof && base.servicos.some(s => s.id === h.servicoId && s.ativo)).map(h => h.servicoId)
  /** Primeiro dia a partir de `desde` (andando `passo` dias) que satisfaz a condição. */
  const procurarDia = (desde: string, condicao: (data: string) => boolean, passo = 1, limite = 28) => {
    for (let i = 0; i < limite; i++) { const d = somarDias(desde, i * passo); if (condicao(d)) return d }
    return null
  }
  /** Horários livres (mesma regra da agenda); consulta "na véspera" para não descartar horários pelo relógio. */
  const livres = (servicoId: string, prof: string, data: string, ignorarId?: string) =>
    horariosLivres(base, { servicoId, profissionalId: prof, data, ignorarId }, new Date(ms(data, '00:00') - DIA))
  /** Confere se cabe uma reserva num horário qualquer (fora da grade de horários sugeridos). */
  const cabe = (prof: string, servicoId: string, data: string, hora: string) => {
    const duracao = duracaoEfetiva(base, prof, servicoId)
    if (!duracao) return false
    const inicio = paraMinutos(hora)
    const ate = inicio + duracao + preparo(servicoId)
    try { validarReserva(base, { profissionalId: prof, servicoId, data, inicio, ocupadoAte: ate }) } catch { return false }
    return base.servicoRecursos.filter(v => v.servicoId === servicoId)
      .every(v => base.recursos.find(r => r.id === v.recursoId)?.ativo && recursoDisponivel(base, v.recursoId, data, inicio, ate))
  }
  let numeroExcecao = 0
  const abrirExcecao = (prof: string, data: string, horaInicio: string, horaFim: string, motivo: string) => {
    const id = `demo-exc-${++numeroExcecao}`
    base.excecoes.push({ id, profissionalId: prof, data, horaInicio, horaFim, motivo, removidoEm: null })
    return id
  }
  const sobrepoeFaixas = (prof: string, data: string, inicio: number, fim: number) =>
    faixasDe(prof, data).some(f => paraMinutos(f.horaInicio) < fim && inicio < paraMinutos(f.horaFim))

  // ---------- Operações com instante (sempre no passado e em ordem para cada reserva) ----------

  // Quem opera: quem estava na recepção naquele momento (a Paula até três semanas atrás).
  let revezamento = 0
  const equipe = (t: number) => (t < agoraMs - 21 * DIA ? PAULA : [CAROLINA, CAROLINA, MIRELA, ADMIN][revezamento++ % 4])
  const ultimaOperacao = new Map<string, number>()
  const criadoEm = new Map<string, number>()
  const marcarInstante = (id: string, t: number) => {
    const valor = Math.min(Math.max(t, ultimaOperacao.get(id) ?? 0), agoraMs - MINUTO)
    ultimaOperacao.set(id, valor)
    return new Date(valor)
  }
  const inicioMs = (id: string) => ms(ag(id).data, ag(id).horaInicio)
  const fimMs = (id: string) => inicioMs(id) + ag(id).duracaoMinutos * MINUTO
  /** Instante entre a criação e o início (fração de 0 a 1), sempre antes do início e nunca no futuro. */
  const antesDoInicio = (id: string, fracao: number) => {
    const criado = criadoEm.get(id) ?? inicioMs(id) - DIA
    const limite = Math.min(inicioMs(id) - 30 * MINUTO, agoraMs - MINUTO)
    return limite <= criado ? criado : criado + (limite - criado) * fracao
  }

  const tratados = new Set<string>()
  const clientesNoDia = new Map<string, Set<number>>()
  let numeroReserva = 0
  let numeroMensagem = 0

  const reservar = (o: {
    cliente: number; servico: string; prof: string; data: string; hora: string; criado?: number; antecedencia?: number; quem?: Perfil
    observacao?: string; encaixe?: boolean; listaEsperaId?: string; justificativa?: string
  }) => {
    const inicio = ms(o.data, o.hora)
    const criado = Math.min(o.criado ?? inicio - (o.antecedencia ?? 3 * DIA), inicio - 10 * MINUTO, agoraMs - 30 * MINUTO)
    const id = `demo-ag-${String(numeroReserva + 1).padStart(3, '0')}`
    try {
      criarAgendamento(base, o.quem ?? equipe(criado), {
        id, clienteId: cliente(o.cliente), servicoId: o.servico, profissionalId: o.prof, data: o.data, hora: o.hora, observacao: o.observacao ?? '',
        encaixe: o.encaixe ?? false, listaEsperaId: o.listaEsperaId, justificativaConflito: o.justificativa,
      }, new Date(criado))
    } catch {
      return null
    }
    numeroReserva++
    criadoEm.set(id, criado)
    ultimaOperacao.set(id, criado)
    const usados = clientesNoDia.get(o.data) ?? new Set<number>()
    usados.add(o.cliente)
    clientesNoDia.set(o.data, usados)
    return id
  }
  const comunicar = (id: string, tipo: TipoComunicacao, t: number) => {
    const quando = marcarInstante(id, t)
    registrarComunicacao(base, equipe(quando.getTime()), `demo-msg-${String(++numeroMensagem).padStart(3, '0')}`, id, tipo, quando)
  }
  const mudar = (id: string, status: 'confirmado' | 'chegou' | 'em_atendimento' | 'concluido' | 'faltou', t: number) => {
    const quando = marcarInstante(id, t)
    alterarStatus(base, equipe(quando.getTime()), id, status, ag(id).versao, quando)
  }
  const cancelar = (id: string, motivo: string, t: number) => {
    const quando = marcarInstante(id, t)
    cancelarAgendamento(base, equipe(quando.getTime()), id, motivo, ag(id).versao, quando)
  }
  const reagendar = (id: string, novo: { data: string; hora: string; prof?: string }, motivo: string, t: number) => {
    const quando = marcarInstante(id, t)
    reagendarAgendamento(base, equipe(quando.getTime()), id, { data: novo.data, hora: novo.hora, profissionalId: novo.prof ?? ag(id).profissionalId, motivo }, ag(id).versao, quando)
  }
  const confirmar = (id: string, comMensagem = true) => {
    if (comMensagem) comunicar(id, 'confirmacao', antesDoInicio(id, 0.55))
    mudar(id, 'confirmado', antesDoInicio(id, 0.7))
  }
  const concluir = (id: string, comConfirmacao = true) => {
    if (comConfirmacao) confirmar(id)
    mudar(id, 'chegou', Math.max(inicioMs(id) - 5 * MINUTO, antesDoInicio(id, 0.9)))
    mudar(id, 'em_atendimento', inicioMs(id))
    mudar(id, 'concluido', fimMs(id))
    tratados.add(id)
  }
  const faltar = (id: string, comConfirmacao = true) => {
    if (comConfirmacao) confirmar(id)
    mudar(id, 'faltou', inicioMs(id) + 30 * MINUTO)
    tratados.add(id)
  }
  /** Reserva no primeiro dia livre a partir de `desde` (até `limite` dias, opcionalmente só até `ate`). */
  const reservarNoPrimeiroLivre = (o: { cliente: number; servico: string; prof: string; desde: string; ate?: string; limite?: number; preferir?: (hora: string) => boolean; antecedencia?: number; observacao?: string }) => {
    for (let i = 0; i < (o.limite ?? 14); i++) {
      const data = somarDias(o.desde, i)
      if (o.ate && data > o.ate) break
      if (clientesNoDia.get(data)?.has(o.cliente)) continue
      const lista = livres(o.servico, o.prof, data)
      const hora = lista.find(h => o.preferir?.(h)) ?? lista[0]
      if (!hora) continue
      const id = reservar({ cliente: o.cliente, servico: o.servico, prof: o.prof, data, hora, antecedencia: o.antecedencia, observacao: o.observacao })
      if (id) return id
    }
    return null
  }
  const manha = (h: string) => h >= '09:00' && h <= '11:00'
  const tarde = (h: string) => h >= '14:00' && h <= '16:30'

  // ================= 1. Exceções de jornada =================

  // Domingo: plantão especial para a agenda de hoje não ficar vazia.
  if (diaDaSemana(hoje) === 0) for (const prof of [P.renata, P.aline, P.luana]) abrirExcecao(prof, hoje, '09:00', '15:00', 'Plantão especial de domingo')
  // Quinta-feira com mutirão de retoques (Juliana não atende às quintas).
  const quintaMutirao = procurarDia(dia(1), d => diaDaSemana(d) === 4)!
  abrirExcecao(P.juliana, quintaMutirao, '14:00', '18:00', 'Mutirão de retoques de micropigmentação')
  // Expediente estendido logo após o fim da jornada (18h).
  const diaEstendido = procurarDia(dia(2), d => diaDaSemana(d) >= 1 && diaDaSemana(d) <= 5)!
  abrirExcecao(P.renata, diaEstendido, '18:00', '20:00', 'Expediente estendido para atender clientes após o trabalho')
  // Sábado especial: Priscila não atende aos sábados.
  const sabadoEspecial = procurarDia(dia(1), d => diaDaSemana(d) === 6)!
  abrirExcecao(P.priscila, sabadoEspecial, '08:00', '12:00', 'Sábado especial de depilação')
  // Exceção já passada: cobertura de agenda numa terça (Thaís não atende às terças).
  const tercaPassada = procurarDia(dia(-2), d => diaDaSemana(d) === 2, -1)!
  abrirExcecao(P.thais, tercaPassada, '12:00', '18:00', 'Cobertura de agenda de outra profissional')

  // ================= 2. Bloqueios (antes das reservas, para que os horários os respeitem) =================

  let numeroBloqueio = 0
  const bloquear = (prof: string, dataInicio: string, dataFim: string, horaInicio: string, horaFim: string, motivo: string, diaInteiro = false) =>
    roteiro(`bloqueio ${motivo}`, () => criarBloqueio(base, ADMIN, { profissionalId: prof, dataInicio, dataFim, horaInicio, horaFim, motivo, diaInteiro }, () => `demo-bloq-${++numeroBloqueio}`))
  const diaRenata = procurarDia(dia(1), d => atende(P.renata, d))!
  bloquear(P.renata, diaRenata, diaRenata, '11:00', '12:00', 'Reunião com fornecedor de cosméticos')
  const diaAline = procurarDia(dia(2), d => atende(P.aline, d) && diaDaSemana(d) !== 6)!
  bloquear(P.aline, diaAline, diaAline, '15:00', '17:30', 'Compromisso pessoal')
  // Dia de jornada habitual (não o sábado especial, que é exceção).
  const diaCurso = procurarDia(dia(7), d => base.disponibilidades.some(x => x.profissionalId === P.priscila && x.diaSemana === diaDaSemana(d)))!
  bloquear(P.priscila, diaCurso, diaCurso, '', '', 'Curso de capacitação em técnicas de depilação', true)
  bloquear(P.rafael, dia(10), dia(14), '', '', 'Férias', true)
  bloquear(P.thais, dia(3), dia(5), '12:00', '14:00', 'Curso online de visagismo')
  const tercaReuniao = procurarDia(dia(1), d => diaDaSemana(d) === 2)!
  bloquear(P.luana, tercaReuniao, tercaReuniao, '10:00', '11:00', 'Reunião de equipe')
  bloquear(P.aline, tercaReuniao, tercaReuniao, '10:00', '11:00', 'Reunião de equipe')
  const diaSimonePassado = procurarDia(dia(-3), d => atende(P.simone, d), -1)!
  bloquear(P.simone, diaSimonePassado, diaSimonePassado, '', '', 'Compromisso pessoal', true)
  // Bloqueio de hoje, visível na agenda do dia.
  const profBloqueioHoje = [P.luana, P.renata, P.aline].find(p => atende(p, hoje)) ?? P.renata
  bloquear(profBloqueioHoje, hoje, hoje, '16:00', '17:00', 'Reunião com a administração')

  // ================= 3. Agenda de agora: um atendimento em andamento e uma cliente já presente =================

  /** Procura um horário em torno de agora; se ninguém atende neste momento (noite, domingo), abre um horário especial. */
  const aoVivo = (tipo: 'em_atendimento' | 'chegou', clienteIndice: number, evitar: string[]) => {
    const arredondar = (x: number) => Math.floor(x / 5) * 5
    const inicios = (duracao: number) => [...new Set(tipo === 'em_atendimento'
      ? [arredondar(minutoAgora - duracao / 3), arredondar(minutoAgora - 10), arredondar(minutoAgora - duracao + 10), 0]
        .filter(x => x >= 0 && x <= minutoAgora && x + duracao > minutoAgora)
      // Cliente presente: horário daqui a pouco ou, perto da meia-noite, um que atrasou alguns minutos.
      : [15, 10, 25, -5, -10, -15].map(d => arredondar(minutoAgora + d)).filter(x => x >= 0))]
    for (const comExcecao of [false, true]) {
      for (const prof of ATIVOS.filter(p => !evitar.includes(p))) {
        for (const servico of servicosDe(prof)) {
          const duracao = duracaoEfetiva(base, prof, servico)!
          for (const inicio of inicios(duracao)) {
            const fim = inicio + duracao + preparo(servico)
            if (fim > 24 * 60) continue
            let excecao: string | null = null
            if (comExcecao) {
              if (sobrepoeFaixas(prof, hoje, inicio, fim)) continue
              excecao = abrirExcecao(prof, hoje, deMinutos(inicio), deMinutos(fim), 'Horário especial de atendimento')
            }
            const id = reservar({ cliente: clienteIndice, servico, prof, data: hoje, hora: deMinutos(inicio), antecedencia: 2 * DIA })
            if (id) return id
            if (excecao) base.excecoes = base.excecoes.filter(e => e.id !== excecao)
          }
        }
      }
    }
    return null
  }
  roteiro('atendimento em andamento agora', () => {
    const id = aoVivo('em_atendimento', 19, [])
    if (!id) return false
    confirmar(id)
    mudar(id, 'chegou', inicioMs(id) - 5 * MINUTO)
    mudar(id, 'em_atendimento', inicioMs(id))
    tratados.add(id)
    return true
  })
  roteiro('cliente presente aguardando', () => {
    const emAndamento = base.agendamentos.find(a => a.status === 'em_atendimento')
    const id = aoVivo('chegou', 20, emAndamento ? [emAndamento.profissionalId] : [])
    if (!id) return false
    confirmar(id)
    mudar(id, 'chegou', agoraMs - 3 * MINUTO)
    tratados.add(id)
    return true
  })

  // ================= 4. Profissional inativa e serviço descontinuado, com histórico =================

  roteiro('histórico da profissional inativa', () => {
    const primeira = reservarNoPrimeiroLivre({ cliente: 37, servico: S.microLabial, prof: P.marta, desde: dia(-27), ate: dia(-22), antecedencia: 6 * DIA, preferir: manha })
    const segunda = reservarNoPrimeiroLivre({ cliente: 38, servico: S.microSobrancelha, prof: P.marta, desde: dia(-20), ate: dia(-15), antecedencia: 5 * DIA, preferir: tarde })
    if (!primeira || !segunda) return false
    concluir(primeira)
    concluir(segunda, false)
    return true
  })
  roteiro('histórico do serviço descontinuado', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 39, servico: S.progressiva, prof: P.renata, desde: dia(-26), ate: dia(-19), antecedencia: 7 * DIA, preferir: manha })
    if (!id) return false
    concluir(id)
    return true
  })
  // Marta saiu da clínica (sem reservas futuras) e a escova progressiva foi descontinuada.
  base.profissionais.find(p => p.id === P.marta)!.ativo = false
  base.servicos.find(s => s.id === S.progressiva)!.ativo = false

  // ================= 5. Exceções em uso =================

  roteiro('reserva na exceção de quinta-feira', () => reservar({ cliente: 32, servico: S.retoque, prof: P.juliana, data: quintaMutirao, hora: '14:00', antecedencia: 5 * DIA }))
  roteiro('reserva no expediente estendido', () => reservar({ cliente: 33, servico: S.escova, prof: P.renata, data: diaEstendido, hora: '18:30', antecedencia: 4 * DIA, observacao: OBSERVACOES[0] }))
  roteiro('reservas no sábado especial', () =>
    reservar({ cliente: 34, servico: S.depCompleta, prof: P.priscila, data: sabadoEspecial, hora: '08:00', antecedencia: 6 * DIA })
    && reservar({ cliente: 35, servico: S.depAxilas, prof: P.priscila, data: sabadoEspecial, hora: '10:00', antecedencia: 2 * DIA }))
  roteiro('atendimento na exceção passada', () => {
    const id = reservar({ cliente: 36, servico: S.corte, prof: P.thais, data: tercaPassada, hora: '13:00', antecedencia: 3 * DIA })
    if (!id) return false
    concluir(id)
    return true
  })

  // ================= 6. Recursos: capacidade 2 em uso simultâneo e capacidade 1 em sequência =================

  roteiro('duas massagens ao mesmo tempo (macas, capacidade 2)', () => {
    for (let i = 1; i <= 21; i++) {
      const data = dia(i)
      if (![2, 4].includes(diaDaSemana(data)) || !cabe(P.rafael, S.relaxante, data, '14:00') || !cabe(P.simone, S.drenagem, data, '14:00')) continue
      return reservar({ cliente: 26, servico: S.relaxante, prof: P.rafael, data, hora: '14:00', antecedencia: 6 * DIA })
        && reservar({ cliente: 27, servico: S.drenagem, prof: P.simone, data, hora: '14:00', antecedencia: 3 * DIA })
    }
    return false
  })
  roteiro('sala de procedimentos em sequência (capacidade 1)', () => {
    for (let i = 1; i <= 21; i++) {
      const data = dia(i)
      if (![1, 3, 5].includes(diaDaSemana(data)) || !cabe(P.juliana, S.microSobrancelha, data, '09:00')) continue
      const micro = reservar({ cliente: 28, servico: S.microSobrancelha, prof: P.juliana, data, hora: '09:00', antecedencia: 10 * DIA, observacao: OBSERVACOES[2] })
      // A sala fica ocupada até 11:45 (atendimento + preparação); a extensão de cílios usa a mesma sala em seguida.
      return micro && reservar({ cliente: 29, servico: S.extensao, prof: P.aline, data, hora: '11:45', antecedencia: 4 * DIA })
    }
    return false
  })
  roteiro('noiva e maquiagem social na mesma bancada', () => {
    for (let i = 1; i <= 21; i++) {
      const data = dia(i)
      if (diaDaSemana(data) !== 6 || !cabe(P.luana, S.maqNoiva, data, '09:00') || !cabe(P.thais, S.maqSocial, data, '12:00')) continue
      return reservar({ cliente: 30, servico: S.maqNoiva, prof: P.luana, data, hora: '09:00', antecedencia: 20 * DIA, observacao: OBSERVACOES[5] })
        && reservar({ cliente: 31, servico: S.maqSocial, prof: P.thais, data, hora: '12:00', antecedencia: 5 * DIA })
    }
    return false
  })

  // ================= 7. Cliente com histórico completo (tela Clientes) =================

  roteiro('cliente com histórico completo', () => {
    const corte = reservarNoPrimeiroLivre({ cliente: 0, servico: S.corte, prof: P.renata, desde: dia(-26), ate: dia(-20), antecedencia: 5 * DIA, preferir: manha })
    const design = reservarNoPrimeiroLivre({ cliente: 0, servico: S.design, prof: P.luana, desde: dia(-17), ate: dia(-12), antecedencia: 3 * DIA, preferir: tarde })
    const henna = reservarNoPrimeiroLivre({ cliente: 0, servico: S.henna, prof: P.juliana, desde: dia(-11), ate: dia(-8), antecedencia: 6 * DIA })
    const lifting = reservarNoPrimeiroLivre({ cliente: 0, servico: S.lashLifting, prof: P.aline, desde: dia(-7), ate: dia(-5), antecedencia: 4 * DIA, preferir: tarde })
    const drenagem = reservarNoPrimeiroLivre({ cliente: 0, servico: S.drenagem, prof: P.simone, desde: dia(-6), ate: dia(-1), antecedencia: 3 * DIA })
    const escova = reservarNoPrimeiroLivre({ cliente: 0, servico: S.escova, prof: P.renata, desde: dia(2), antecedencia: 5 * DIA, preferir: manha })
    const maquiagem = reservarNoPrimeiroLivre({ cliente: 0, servico: S.maqSocial, prof: P.luana, desde: dia(9), antecedencia: 2 * DIA, preferir: tarde, observacao: OBSERVACOES[6] })
    if (!corte || !design || !henna || !lifting || !drenagem || !escova || !maquiagem) return false
    concluir(corte)
    concluir(design, false)
    cancelar(henna, 'Viagem de última hora.', antesDoInicio(henna, 0.8))
    comunicar(henna, 'cancelamento', antesDoInicio(henna, 0.85))
    tratados.add(henna)
    concluir(lifting)
    faltar(drenagem)
    confirmar(escova)
    comunicar(escova, 'lembrete', antesDoInicio(escova, 0.95))
    tratados.add(escova)
    tratados.add(maquiagem)
    return true
  })

  // ================= 8. Reagendamentos, mensagens e correção de status =================

  roteiro('reagendamento no mesmo dia com aviso enviado', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 21, servico: S.design, prof: P.luana, desde: dia(2), antecedencia: 7 * DIA, preferir: manha })
    if (!id) return false
    comunicar(id, 'confirmacao', agoraMs - 2 * DIA)
    const nova = livres(S.design, P.luana, ag(id).data, id).filter(h => h >= '14:00')[0]
    if (!nova) return false
    reagendar(id, { data: ag(id).data, hora: nova }, 'Cliente pediu outro horário no mesmo dia.', agoraMs - DIA)
    comunicar(id, 'reagendamento', agoraMs - DIA + 10 * MINUTO)
    tratados.add(id)
    return true
  })
  roteiro('reagendamento de data com mensagem desatualizada', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 22, servico: S.depPernas, prof: P.priscila, desde: dia(1), antecedencia: 8 * DIA, preferir: manha })
    if (!id) return false
    comunicar(id, 'confirmacao', agoraMs - 3 * DIA)
    mudar(id, 'confirmado', agoraMs - 3 * DIA + 2 * HORA)
    const destino = procurarDia(somarDias(ag(id).data, 2), d => livres(S.depPernas, P.priscila, d, id).length > 0, 1, 10)
    if (!destino) return false
    // Sem novo aviso depois de reagendar: a agenda indica que a mensagem ficou desatualizada.
    reagendar(id, { data: destino, hora: livres(S.depPernas, P.priscila, destino, id)[0] }, 'Cliente pediu para mudar a data.', agoraMs - 5 * HORA)
    tratados.add(id)
    return true
  })
  roteiro('reagendamento com troca de profissional', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 23, servico: S.corte, prof: P.renata, desde: dia(2), antecedencia: 6 * DIA })
    if (!id) return false
    const destino = procurarDia(dia(3), d => d !== ag(id).data && livres(S.corte, P.thais, d, id).length > 0, 1, 14)
    if (!destino) return false
    reagendar(id, { data: destino, hora: livres(S.corte, P.thais, destino, id).find(tarde) ?? livres(S.corte, P.thais, destino, id)[0], prof: P.thais },
      'Ajuste de agenda: atendimento transferido para outra profissional habilitada.', agoraMs - 2 * DIA)
    comunicar(id, 'reagendamento', agoraMs - 2 * DIA + 15 * MINUTO)
    confirmar(id, false)
    tratados.add(id)
    return true
  })
  roteiro('reagendamento antigo seguido de atendimento concluído', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 24, servico: S.manutencao, prof: P.aline, desde: dia(-14), ate: dia(-11), antecedencia: 6 * DIA })
    if (!id) return false
    const destino = procurarDia(somarDias(ag(id).data, 2), d => d < dia(-1) && livres(S.manutencao, P.aline, d, id).length > 0, 1, 6)
    if (!destino) return false
    reagendar(id, { data: destino, hora: livres(S.manutencao, P.aline, destino, id)[0] }, 'Cliente pediu para mudar a data.', antesDoInicio(id, 0.5))
    concluir(id)
    return true
  })
  roteiro('correção de status pela administração', () => {
    const id = reservarNoPrimeiroLivre({ cliente: 25, servico: S.design, prof: P.luana, desde: dia(-9), ate: dia(-3), antecedencia: 5 * DIA, preferir: manha })
    if (!id) return false
    faltar(id)
    const quando = marcarInstante(id, inicioMs(id) + 3 * HORA)
    corrigirStatus(base, ADMIN, id, 'concluido', 'A cliente compareceu; a falta foi registrada por engano.', ag(id).versao, quando)
    return true
  })

  // ================= 9. Conflito da cliente autorizado pela administração (um único exemplo) =================

  roteiro('exceção de conflito da cliente', () => {
    for (let i = 2; i <= 23; i++) {
      const data = dia(i)
      if (!atende(P.juliana, data) || !atende(P.renata, data)) continue
      for (const hora of livres(S.hidratacao, P.renata, data)) {
        const design = deMinutos(paraMinutos(hora) + 15)
        if (!cabe(P.juliana, S.design, data, design)) continue
        const hidratacao = reservar({ cliente: 1, servico: S.hidratacao, prof: P.renata, data, hora, antecedencia: 7 * DIA })
        return hidratacao && reservar({ cliente: 1, servico: S.design, prof: P.juliana, data, hora: design, antecedencia: 7 * DIA - HORA, quem: ADMIN,
          justificativa: 'Design feito durante a pausa da hidratação capilar, a pedido da cliente.' })
      }
    }
    return false
  })

  // ================= 10. Marcações com vários serviços =================

  /** Etapas em sequência para a mesma cliente: cada uma começa quando a anterior termina. */
  const marcar = (id: string, clienteIndice: number, etapas: [string, string][], desde: string, ate: string, criado: number) => {
    for (let data = desde; data <= ate; data = somarDias(data, 1)) {
      for (const hora of livres(etapas[0][0], etapas[0][1], data)) {
        const plano: { servicoId: string; profissionalId: string; data: string; hora: string }[] = []
        let minuto = paraMinutos(hora)
        for (const [servicoId, profissionalId] of etapas) {
          plano.push({ servicoId, profissionalId, data, hora: deMinutos(minuto) })
          minuto += duracaoEfetiva(base, profissionalId, servicoId) ?? 24 * 60
        }
        if (minuto > 24 * 60 || plano.slice(1).some(e => !cabe(e.profissionalId, e.servicoId, e.data, e.hora))) continue
        try {
          criarMarcacao(base, equipe(criado), { id, clienteId: cliente(clienteIndice), observacao: '', etapas: plano }, new Date(criado))
        } catch { continue }
        plano.forEach((_, i) => { criadoEm.set(`${id}-${i + 1}`, criado); ultimaOperacao.set(`${id}-${i + 1}`, criado) })
        return true
      }
    }
    return false
  }
  roteiro('marcação com 2 serviços seguidos (mesma profissional)', () => marcar('demo-marcacao-1', 2, [[S.corte, P.renata], [S.escova, P.renata]], dia(2), dia(12), agoraMs - 3 * DIA))
  roteiro('marcação com 3 serviços', () => marcar('demo-marcacao-2', 3, [[S.lashLifting, P.aline], [S.henna, P.luana], [S.maqSocial, P.luana]], dia(4), dia(16), agoraMs - 4 * DIA))
  roteiro('marcação com profissionais diferentes', () => marcar('demo-marcacao-3', 4, [[S.depPernas, P.priscila], [S.design, P.juliana]], dia(1), dia(14), agoraMs - 2 * DIA))
  roteiro('marcação já realizada', () => {
    if (!marcar('demo-marcacao-4', 40, [[S.hidratacao, P.renata], [S.maqSocial, P.luana]], dia(-12), dia(-4), ms(dia(-12), '10:00') - 6 * DIA)) return false
    base.agendamentos.filter(a => a.grupoId === 'demo-marcacao-4').forEach(a => concluir(a.id))
    return true
  })

  // ================= 11. Séries recorrentes =================

  const serie = (id: string, dados: SerieDadosDemo, criado: number, observacao: string, exigir?: (previa: ReturnType<typeof preverSerie>) => boolean) => {
    const quem = equipe(criado)
    const previa = preverSerie(base, quem, dados, new Date(criado))
    const datas = previa.filter(p => p.situacao === 'disponivel').map(p => p.data)
    if (datas.length < 2 || (exigir && !exigir(previa))) return false
    criarSerie(base, quem, id, dados, datas, observacao, new Date(criado))
    base.agendamentos.filter(a => a.serieId === id).forEach(a => { criadoEm.set(a.id, criado); ultimaOperacao.set(a.id, criado) })
    return true
  }
  const dadosSerie = (clienteIndice: number, servicoId: string, prof: string, dataInicial: string, hora: string, frequencia: SerieDadosDemo['frequencia'], quantidade: number, diaInexistente: SerieDadosDemo['diaInexistente'] = null): SerieDadosDemo =>
    ({ clienteId: cliente(clienteIndice), servicoId, profissionalId: prof, dataInicial, hora, frequencia, quantidade, dataFinal: null, diaInexistente })
  roteiro('série semanal', () => {
    const inicial = procurarDia(dia(-20), d => diaDaSemana(d) >= 1 && diaDaSemana(d) <= 5)!
    // As semanas de férias do Rafael aparecem como indisponíveis na prévia e ficam de fora.
    return serie('demo-serie-1', dadosSerie(42, S.drenagem, P.rafael, inicial, '18:00', 'semanal', 8), ms(inicial, '12:00') - 3 * DIA, 'Pacote de drenagem semanal.')
  })
  roteiro('série quinzenal', () => {
    const inicial = procurarDia(dia(-7), d => diaDaSemana(d) >= 1 && diaDaSemana(d) <= 5)!
    return serie('demo-serie-2', dadosSerie(18, S.manutencao, P.aline, inicial, '16:00', 'quinzenal', 6), ms(inicial, '12:00') - 4 * DIA, 'Manutenção a cada 15 dias.')
  })
  const dias31: string[] = []
  for (let d = dia(1); dias31.length < 4; d = somarDias(d, 1)) if (d.endsWith('-31')) dias31.push(d)
  roteiro('série mensal usando o último dia do mês', () => dias31.some(inicial =>
    serie('demo-serie-3', dadosSerie(17, S.lashLifting, P.aline, inicial, '10:00', 'mensal', 4, 'ultimo_dia'), agoraMs - 2 * DIA, 'Lash lifting mensal.',
      previa => previa.some(p => p.situacao === 'disponivel' && Boolean(p.motivo?.includes('último dia'))))))
  roteiro('série mensal pulando meses sem o dia', () => dias31.some(inicial =>
    serie('demo-serie-4', dadosSerie(41, S.hidratacao, P.renata, inicial, '10:00', 'mensal', 4, 'pular'), agoraMs - DIA, 'Hidratação mensal.',
      previa => previa.some(p => p.situacao === 'pulada'))))

  // ================= 12. Lista de espera e vagas liberadas =================

  const esperar = (id: string, clienteIndice: number, servicoId: string, prof: string | null, inicio: string, fim: string, faixa: [string, string] | null, observacao: string, criado: number) => {
    criarEntradaEspera(base, equipe(criado), { id, clienteId: cliente(clienteIndice), servicoId, profissionalId: prof, dataInicio: inicio, dataFim: fim,
      horaInicio: faixa?.[0] ?? null, horaFim: faixa?.[1] ?? null, observacao }, new Date(Math.min(criado, agoraMs - MINUTO)))
    return true
  }
  const contato = (id: string, status: 'contatado' | 'desistiu', observacao: string, t: number) => {
    const entrada = base.listaEspera.find(e => e.id === id)!
    atualizarEntradaEspera(base, equipe(t), id, status, observacao, entrada.versao, new Date(Math.min(t, agoraMs - MINUTO)))
    return true
  }
  roteiro('lista de espera: aguardando', () =>
    esperar('demo-espera-01', 5, S.design, null, dia(-3), dia(21), ['08:00', '12:00'], 'Prefere horários pela manhã.', agoraMs - 3 * DIA)
    && esperar('demo-espera-02', 6, S.manutencao, P.aline, dia(-5), dia(14), ['13:00', '18:00'], '', agoraMs - 5 * DIA)
    && esperar('demo-espera-03', 7, S.drenagem, null, dia(-2), dia(30), null, 'Aceita encaixe com aviso no mesmo dia.', agoraMs - 2 * DIA)
    && esperar('demo-espera-10', 14, S.henna, P.juliana, dia(-1), dia(30), ['09:00', '12:30'], 'Quer o primeiro horário disponível.', agoraMs - DIA)
    && esperar('demo-espera-11', 15, S.extensao, P.aline, dia(0), dia(30), null, '', agoraMs - 4 * HORA)
    && esperar('demo-espera-13', 44, S.maqSocial, null, dia(5), dia(25), ['14:00', '19:00'], 'Para formatura; quer horário à tarde.', agoraMs - 6 * DIA))
  roteiro('lista de espera: contatadas', () =>
    esperar('demo-espera-04', 8, S.coloracao, P.renata, dia(-6), dia(20), null, '', agoraMs - 6 * DIA)
    && contato('demo-espera-04', 'contatado', 'Mensagem enviada com dois horários; aguardando resposta.', agoraMs - DIA)
    && esperar('demo-espera-05', 9, S.relaxante, null, dia(-9), dia(15), ['13:00', '18:00'], '', agoraMs - 9 * DIA)
    && contato('demo-espera-05', 'contatado', 'Não atendeu a ligação; mensagem enviada.', agoraMs - 4 * DIA)
    && contato('demo-espera-05', 'contatado', 'Pediu para avisar se abrir vaga no fim da tarde.', agoraMs - DIA)
    && esperar('demo-espera-12', 16, S.depPernas, P.priscila, dia(-4), dia(10), ['08:00', '12:00'], '', agoraMs - 4 * DIA)
    && contato('demo-espera-12', 'contatado', 'Prefere segunda ou quarta.', agoraMs - 2 * DIA))
  roteiro('lista de espera: desistências', () =>
    esperar('demo-espera-08', 12, S.extensao, P.aline, dia(-12), dia(10), null, '', agoraMs - 12 * DIA)
    && contato('demo-espera-08', 'contatado', 'Ofertados dois horários; a cliente vai verificar.', agoraMs - 10 * DIA)
    && contato('demo-espera-08', 'desistiu', 'Cliente informou que não tem mais interesse no momento.', agoraMs - 6 * DIA)
    && esperar('demo-espera-09', 13, S.depCompleta, null, dia(-8), dia(12), null, '', agoraMs - 8 * DIA)
    && contato('demo-espera-09', 'desistiu', 'Cliente desistiu por mudança de planos.', agoraMs - 3 * DIA))
  roteiro('lista de espera: agendada no passado', () => {
    esperar('demo-espera-07', 11, S.hidratacao, P.renata, dia(-25), dia(-5), null, 'Quer manter a rotina de hidratação.', ms(dia(-25), '11:00'))
    for (let data = dia(-16); data <= dia(-12); data = somarDias(data, 1)) {
      const hora = livres(S.hidratacao, P.renata, data)[0]
      if (!hora) continue
      const id = reservar({ cliente: 11, servico: S.hidratacao, prof: P.renata, data, hora, antecedencia: 3 * DIA, listaEsperaId: 'demo-espera-07' })
      if (!id) continue
      concluir(id)
      return true
    }
    return false
  })
  roteiro('vaga liberada ocupada pela lista de espera', () => {
    // Uma cliente cancela; a vaga é oferecida a quem estava na lista de espera e agendada a partir da entrada.
    const original = reservarNoPrimeiroLivre({ cliente: 38, servico: S.corte, prof: P.renata, desde: dia(3), antecedencia: 9 * DIA, preferir: tarde })
    if (!original) return false
    const { data, horaInicio } = ag(original)
    esperar('demo-espera-06', 10, S.corte, null, dia(-9), dia(20), null, 'Qualquer profissional serve.', agoraMs - 9 * DIA)
    cancelar(original, 'Cliente pediu para remarcar posteriormente.', agoraMs - 2 * DIA)
    comunicar(original, 'cancelamento', agoraMs - 2 * DIA + 10 * MINUTO)
    tratados.add(original)
    contato('demo-espera-06', 'contatado', 'Avisada da vaga liberada; aceitou o horário.', agoraMs - 2 * DIA + HORA)
    const novo = reservar({ cliente: 10, servico: S.corte, prof: P.renata, data, hora: horaInicio, criado: agoraMs - 2 * DIA + 90 * MINUTO, listaEsperaId: 'demo-espera-06' })
    if (!novo) return false
    comunicar(novo, 'confirmacao', agoraMs - 2 * DIA + 100 * MINUTO)
    tratados.add(novo)
    return true
  })
  roteiro('vaga livre compatível com a lista de espera', () => {
    // Cancelamento recente: o horário da Juliana pela manhã ficou livre e combina com a entrada demo-espera-10.
    const id = reservarNoPrimeiroLivre({ cliente: 37, servico: S.henna, prof: P.juliana, desde: dia(2), antecedencia: 8 * DIA, preferir: manha })
    if (!id) return false
    cancelar(id, 'Incompatibilidade de horário.', agoraMs - 20 * HORA)
    comunicar(id, 'cancelamento', agoraMs - 19 * HORA)
    tratados.add(id)
    return true
  })
  // Reservas futuras que, se canceladas na demonstração, mostram candidatas compatíveis da lista de espera.
  roteiro('reserva para testar vaga liberada (cílios, manhã)', () => {
    for (let i = 2; i <= 21; i++) {
      const data = dia(i)
      if (![1, 2, 3, 4, 5].includes(diaDaSemana(data)) || !cabe(P.aline, S.extensao, data, '10:00')) continue
      const id = reservar({ cliente: 43, servico: S.extensao, prof: P.aline, data, hora: '10:00', antecedencia: 5 * DIA })
      if (id) { confirmar(id); tratados.add(id); return true }
    }
    return false
  })
  roteiro('reserva para testar vaga liberada (massagem, tarde)', () => {
    for (let i = 1; i <= 21; i++) {
      const data = dia(i)
      if (!cabe(P.rafael, S.relaxante, data, '15:00')) continue
      const id = reservar({ cliente: 44, servico: S.relaxante, prof: P.rafael, data, hora: '15:00', antecedencia: 4 * DIA })
      if (id) { tratados.add(id); return true }
    }
    return false
  })

  // ================= 13. Preenchimento da agenda (variedade secundária, com sorteio) =================

  // Algumas clientes voltam com frequência; outras vieram uma única vez.
  const frequencia = CLIENTES.map((_, i) => (i < 12 ? 3 : i < 30 ? 2 : 1))
  const sacola = frequencia.flatMap((vezes, i) => Array.from({ length: vezes }, () => i))
  let ponteiro = Math.floor(sorte.numero() * sacola.length)
  const clienteLivre = (data: string) => {
    for (let tentativa = 0; tentativa < sacola.length; tentativa++) {
      const indice = sacola[(ponteiro += 7) % sacola.length]
      if (!clientesNoDia.get(data)?.has(indice)) return indice
    }
    return 0
  }
  let preenchidas = 0
  // Só reservas do preenchimento podem ser canceladas no andamento: as do roteiro precisam continuar demonstrando o cenário.
  const doPreenchimento = new Set<string>()
  const colocar = (prof: string, data: string) => {
    const opcoes = servicosDe(prof)
    const primeiro = Math.floor(sorte.numero() * opcoes.length)
    for (let k = 0; k < opcoes.length; k++) {
      const servico = opcoes[(primeiro + k) % opcoes.length]
      const lista = livres(servico, prof, data)
      if (!lista.length) continue
      const redondos = lista.filter(h => paraMinutos(h) % 30 === 0)
      const hora = sorte.escolher(redondos.length ? redondos : lista)
      const indice = preenchidas
      const encaixe = indice % 19 === 9
      const antecedencia = encaixe ? (2 + Math.floor(sorte.numero() * 4)) * HORA : (1 + Math.floor(sorte.numero() * 14)) * DIA + Math.floor(sorte.numero() * 5) * HORA
      const observacao = indice % 6 === 2 ? OBSERVACOES[(indice / 6 | 0) % OBSERVACOES.length] : ''
      const id = reservar({ cliente: clienteLivre(data), servico, prof, data, hora, antecedencia, encaixe, observacao })
      if (id) { preenchidas++; doPreenchimento.add(id); return id }
    }
    return null
  }
  // Hoje a agenda fica movimentada: até três atendimentos por profissional.
  for (const prof of ATIVOS) if (atende(prof, hoje)) for (let k = 0; k < 3; k++) colocar(prof, hoje)
  // O restante segue um total fixo, repartido por período: passado com histórico, próxima semana cheia
  // e semanas seguintes cada vez mais livres. O sorteio escolhe apenas quais profissionais e dias recebem.
  const TOTAL_DESEJADO = 122
  const restante = Math.max(0, TOTAL_DESEJADO - base.agendamentos.length)
  const periodos: [number, number, number][] = [[-28, -1, 0.42], [1, 7, 0.3], [8, 14, 0.16], [15, 28, 0.12]]
  for (const [de, ate, fatia] of periodos) {
    const pares: [string, string][] = []
    for (let deslocamento = de; deslocamento <= ate; deslocamento++) {
      for (const prof of ATIVOS) if (atende(prof, dia(deslocamento))) pares.push([prof, dia(deslocamento)])
    }
    for (let i = pares.length - 1; i > 0; i--) { const j = Math.floor(sorte.numero() * (i + 1)); [pares[i], pares[j]] = [pares[j], pares[i]] }
    let meta = Math.round(restante * fatia)
    for (let volta = 0; volta < 3 && meta > 0; volta++) for (const [prof, data] of pares) if (meta > 0 && colocar(prof, data)) meta--
  }

  // ================= 14. Andamento das reservas conforme o horário =================

  const pendentes = base.agendamentos.filter(a => a.status === 'agendado' && !tratados.has(a.id))
    .sort((x, y) => `${x.data}${x.horaInicio}${x.id}`.localeCompare(`${y.data}${y.horaInicio}${y.id}`))
  let passadas = 0
  let futuras = 0
  let motivo = 0
  for (const a of pendentes) {
    const id = a.id
    try {
      if (fimMs(id) <= agoraMs) {
        const k = passadas++
        if (k % 9 === 4 && doPreenchimento.has(id)) {
          cancelar(id, MOTIVOS_CANCELAMENTO[motivo++ % MOTIVOS_CANCELAMENTO.length], antesDoInicio(id, 0.75))
          if (k % 2 === 0) comunicar(id, 'cancelamento', antesDoInicio(id, 0.8))
        } else if (k % 9 === 7) faltar(id, k % 2 === 1)
        else concluir(id, k % 3 !== 0)
      } else if (inicioMs(id) <= agoraMs) {
        confirmar(id)
        mudar(id, 'chegou', inicioMs(id) - 5 * MINUTO)
        mudar(id, 'em_atendimento', inicioMs(id))
      } else if (inicioMs(id) - agoraMs <= 30 * MINUTO) {
        confirmar(id)
        mudar(id, 'chegou', agoraMs - 2 * MINUTO)
      } else {
        const k = futuras++
        if (k % 13 === 6 && doPreenchimento.has(id)) {
          cancelar(id, MOTIVOS_CANCELAMENTO[motivo++ % MOTIVOS_CANCELAMENTO.length], antesDoInicio(id, 0.8))
          comunicar(id, 'cancelamento', antesDoInicio(id, 0.85))
        } else if (k % 4 <= 1) {
          confirmar(id)
          if (inicioMs(id) - agoraMs < 2 * DIA && k % 2 === 0) comunicar(id, 'lembrete', antesDoInicio(id, 0.95))
        } else if (k % 4 === 2) comunicar(id, 'confirmacao', antesDoInicio(id, 0.6)) // mensagem enviada, ainda sem resposta
      }
    } catch { /* andamento dispensável: a reserva continua aguardando confirmação */ }
  }

  // ================= 15. Edições de observação e encaixe =================

  roteiro('edições registradas no histórico', () => {
    const futurasAtivas = base.agendamentos.filter(a => (a.status === 'agendado' || a.status === 'confirmado') && !a.grupoId && !a.serieId && inicioMs(a.id) > agoraMs)
      .sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`))
    const alvos = [futurasAtivas[1], futurasAtivas[5], futurasAtivas[9]].filter(Boolean)
    if (alvos.length < 3) return false
    const edicoes: [string, boolean | null][] = [
      ['Cliente pediu para ser atendida na sala mais silenciosa, se possível.', null],
      ['', true],
      ['Vai chegar 15 minutos antes para preencher o cadastro na recepção.', null],
    ]
    alvos.forEach((a, i) => {
      const [texto, encaixe] = edicoes[i]
      const quando = marcarInstante(a.id, Math.max(agoraMs - (6 - i) * HORA, ultimaOperacao.get(a.id) ?? 0))
      editarAgendamento(base, equipe(quando.getTime()), a.id, texto || (a.observacao ?? ''), encaixe ?? a.encaixe, a.versao, quando)
    })
    return true
  })

  return { base, pendencias }
}

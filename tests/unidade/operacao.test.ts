// Regras de operação da agenda espelhadas na demonstração (migração 011 no servidor).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ErroDeOperacao, dicaDoErro } from '../../src/lib/erros'
import { calcularHorariosLivres } from '../../src/lib/horariosLivres'
import { textoDaMensagem, tiposPermitidos } from '../../src/lib/mensagens'
import { filtrarPorStatus } from '../../src/lib/resumo'
import { ocupaHorario, ocupaPeriodo } from '../../src/lib/status'
import * as motor from '../../src/demo/motor'
import type { BaseDemo } from '../../src/demo/motor'
import type { ItemAgenda, Perfil } from '../../src/types'

// Segunda-feira, 05/10/2026, 09:00 em São Paulo. Reservas de teste em 12/10/2026 (segunda).
const AGORA = new Date('2026-10-05T12:00:00Z')
const D = '2026-10-12'
const admin: Perfil = { usuarioId: 'u-admin', nome: 'Admin', papel: 'admin', profissionalId: null, fusoHorario: motor.FUSO_DEMO }
const secretaria: Perfil = { usuarioId: 'u-sec', nome: 'Secretaria', papel: 'secretaria', profissionalId: null, fusoHorario: motor.FUSO_DEMO }
const profissional: Perfil = { usuarioId: 'u-prof', nome: 'Prof A', papel: 'profissional', profissionalId: 'pA', fusoHorario: motor.FUSO_DEMO }

function novaBase(): BaseDemo {
  const jornada = (profissionalId: string) => [0, 1, 2, 3, 4, 5, 6].flatMap(dia => [
    { id: `${profissionalId}-${dia}-m`, profissionalId, diaSemana: dia, horaInicio: '08:00', horaFim: '12:00' },
    { id: `${profissionalId}-${dia}-t`, profissionalId, diaSemana: dia, horaInicio: '13:00', horaFim: '18:00' },
  ])
  return {
    versao: 1, geradaEm: AGORA.toISOString(), usuarios: [],
    profissionais: [{ id: 'pA', nome: 'Prof A', telefone: null, cor: '#9A6A20', ativo: true, usuarioId: 'u-prof' }, { id: 'pB', nome: 'Prof B', telefone: null, cor: '#7F9877', ativo: true, usuarioId: null }],
    servicos: [
      { id: 'sSimples', nome: 'Simples', duracaoMinutos: 60, preparacaoMinutos: 0, categoria: null, descricao: null, ativo: true },
      { id: 'sPrep', nome: 'Com preparação', duracaoMinutos: 60, preparacaoMinutos: 15, categoria: null, descricao: null, ativo: true },
      { id: 'sSala', nome: 'Usa sala', duracaoMinutos: 30, preparacaoMinutos: 0, categoria: null, descricao: null, ativo: true },
    ],
    habilitacoes: ['pA', 'pB'].flatMap(p => ['sSimples', 'sPrep', 'sSala'].map(s => ({ profissionalId: p, servicoId: s, duracaoMinutos: p === 'pB' && s === 'sSimples' ? 90 : null }))),
    disponibilidades: [...jornada('pA'), ...jornada('pB')], excecoes: [], bloqueios: [],
    clientes: ['c1', 'c2', 'c3'].map((id, i) => ({ id, nome: `Cliente ${i + 1} Sobrenome`, telefone: `(00) 90000-000${i + 1}`, telefoneDigitos: `0090000000${i + 1}` })),
    agendamentos: [], historico: [],
    recursos: [{ id: 'sala', nome: 'Sala 1', tipo: 'sala', capacidade: 1, ativo: true }], servicoRecursos: [{ servicoId: 'sSala', recursoId: 'sala' }],
    comunicacoes: [], listaEspera: [], contatosEspera: [],
  }
}

let seq = 0
const criar = (base: BaseDemo, perfil: Perfil, o: { hora: string; cliente?: string; servico?: string; prof?: string; data?: string; just?: string; espera?: string }) =>
  motor.criarAgendamento(base, perfil, {
    id: `ag-${++seq}`, clienteId: o.cliente ?? 'c1', servicoId: o.servico ?? 'sSimples', profissionalId: o.prof ?? 'pA', data: o.data ?? D, hora: o.hora,
    observacao: '', encaixe: false, justificativaConflito: o.just, listaEsperaId: o.espera,
  }, AGORA)
const erroDe = (acao: () => unknown) => { try { acao(); return null } catch (e) { return e as ErroDeOperacao } }

describe('conflito de horários da cliente', () => {
  it('recusa a mesma cliente com outro profissional e mostra o atendimento conflitante', () => {
    const base = novaBase()
    criar(base, secretaria, { hora: '09:00' })
    const erro = erroDe(() => criar(base, secretaria, { hora: '09:30', prof: 'pB' }))
    assert.equal(dicaDoErro(erro), 'conflito_cliente')
    assert.match(erro!.message, /12\/10, 09:00–10:00, Simples com Prof A/)
  })
  it('somente a administração autoriza a exceção, com justificativa registrada no histórico', () => {
    const base = novaBase()
    criar(base, secretaria, { hora: '09:00' })
    assert.match(erroDe(() => criar(base, secretaria, { hora: '09:30', prof: 'pB', just: 'Pedido da cliente' }))!.message, /Somente a administração/)
    assert.match(erroDe(() => criar(base, admin, { hora: '09:30', prof: 'pB' }))!.message, /justificativa/)
    const excecao = criar(base, admin, { hora: '09:30', prof: 'pB', just: 'Atendimento em dupla' })
    assert.equal(excecao.conflitoJustificativa, 'Atendimento em dupla')
    assert.match(base.historico.at(-1)!.motivo ?? '', /Atendimento em dupla/)
  })
})

describe('horário passado, preparação e duração por profissional', () => {
  it('não cria nem reagenda no passado', () => {
    const base = novaBase()
    assert.match(erroDe(() => criar(base, secretaria, { hora: '08:00', data: '2026-10-05' }))!.message, /já passou/)
    const a = criar(base, secretaria, { hora: '09:00' })
    assert.match(erroDe(() => motor.reagendarAgendamento(base, secretaria, a.id, { data: '2026-10-01', hora: '09:00', profissionalId: 'pA', motivo: 'Teste' }, a.versao, AGORA))!.message, /já passou/)
  })
  it('a preparação ocupa a agenda e precisa caber na jornada, sem aumentar a duração do atendimento', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '13:00', servico: 'sPrep' })
    assert.equal(a.duracaoMinutos, 60)
    assert.equal(a.preparacaoMinutos, 15)
    assert.match(erroDe(() => criar(base, secretaria, { hora: '14:00', cliente: 'c2' }))!.message, /preparação/)
    assert.ok(criar(base, secretaria, { hora: '14:15', cliente: 'c2' }))
    assert.match(erroDe(() => criar(base, secretaria, { hora: '17:00', servico: 'sPrep', cliente: 'c3', prof: 'pB' }))!.message, /jornada/)
  })
  it('usa a duração específica do profissional e preserva reservas após mudanças no cadastro', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '08:00', prof: 'pB' })
    assert.equal(a.duracaoMinutos, 90)
    base.habilitacoes.find(h => h.profissionalId === 'pB' && h.servicoId === 'sSimples')!.duracaoMinutos = 30
    base.servicos.find(s => s.id === 'sSimples')!.duracaoMinutos = 45
    assert.equal(base.agendamentos.find(x => x.id === a.id)!.duracaoMinutos, 90)
    assert.deepEqual(motor.horariosLivres(base, { servicoId: 'sSimples', profissionalId: 'pB', data: D }, AGORA).slice(0, 3), ['09:30', '10:00', '10:30'])
  })
  it('horários livres usam passo de atendimento + preparação', () => {
    const livres = calcularHorariosLivres({ faixas: [{ horaInicio: '13:00', horaFim: '18:00' }], ocupados: [], duracaoMinutos: 60, preparacaoMinutos: 15 })
    assert.deepEqual(livres.map(m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`), ['13:00', '14:15', '15:30', '16:45'])
  })
})

describe('ocupação, conclusão antecipada e falta', () => {
  it('concluído continua ocupando; cancelado e faltou liberam', () => {
    assert.deepEqual(['agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido', 'cancelado', 'faltou'].filter(s => ocupaPeriodo(s as never)), ['agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido'])
    assert.equal(ocupaHorario('concluido'), false, 'concluído não é reserva ativa a resolver')
  })
  it('concluir antes do fim não libera o período, e cancelar libera', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '10:00' })
    for (const s of ['confirmado', 'chegou', 'em_atendimento', 'concluido'] as const) motor.alterarStatus(base, secretaria, a.id, s, a.versao, AGORA)
    assert.match(erroDe(() => criar(base, secretaria, { hora: '10:30', cliente: 'c2', servico: 'sSala' }))!.message, /período/)
    assert.ok(!motor.horariosLivres(base, { servicoId: 'sSala', profissionalId: 'pA', data: D }, AGORA).includes('10:30'))
    const b = criar(base, secretaria, { hora: '15:00', cliente: 'c2' })
    motor.cancelarAgendamento(base, secretaria, b.id, 'Desistiu', b.versao, AGORA)
    assert.ok(criar(base, secretaria, { hora: '15:00', cliente: 'c3' }))
  })
})

describe('controle de versão', () => {
  it('recusa gravação com versão antiga e preserva a alteração mais recente', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '09:00' })
    const versaoAberta = a.versao
    motor.editarAgendamento(base, secretaria, a.id, 'Sessão 1', false, versaoAberta, AGORA)
    const erro = erroDe(() => motor.editarAgendamento(base, admin, a.id, 'Sessão 2', false, versaoAberta, AGORA))
    assert.equal(dicaDoErro(erro), 'versao_desatualizada')
    assert.equal(a.observacao, 'Sessão 1')
  })
})

describe('correção administrativa de status', () => {
  it('é exclusiva da administração, exige justificativa e registra anterior e novo', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '09:00' })
    motor.cancelarAgendamento(base, secretaria, a.id, 'Engano', a.versao, AGORA)
    assert.match(erroDe(() => motor.corrigirStatus(base, secretaria, a.id, 'agendado', 'Cancelado por engano', a.versao, AGORA))!.message, /permissão/)
    assert.match(erroDe(() => motor.corrigirStatus(base, profissional, a.id, 'agendado', 'Cancelado por engano', a.versao, AGORA))!.message, /permissão/)
    assert.match(erroDe(() => motor.corrigirStatus(base, admin, a.id, 'agendado', ' ', a.versao, AGORA))!.message, /motivo/)
    motor.corrigirStatus(base, admin, a.id, 'agendado', 'Cancelado por engano', a.versao, AGORA)
    const registro = base.historico.at(-1)!
    assert.equal(registro.acao, 'status_corrigido')
    assert.equal((registro.valoresAnteriores as { status: string }).status, 'cancelado')
    assert.equal((registro.valoresNovos as { status: string }).status, 'agendado')
    assert.equal(a.motivoCancelamento, null, 'dados de cancelamento saem do registro (ficam no histórico)')
  })
  it('recusa voltar a ocupar uma vaga já comprometida', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '09:00' })
    motor.cancelarAgendamento(base, secretaria, a.id, 'Engano', a.versao, AGORA)
    criar(base, secretaria, { hora: '09:00', cliente: 'c2' })
    assert.match(erroDe(() => motor.corrigirStatus(base, admin, a.id, 'agendado', 'Engano', a.versao, AGORA))!.message, /período/)
    assert.equal(a.status, 'cancelado')
  })
})

describe('recursos compartilhados', () => {
  it('recurso de capacidade 1 não é usado ao mesmo tempo; serviço sem recurso não é afetado', () => {
    const base = novaBase()
    criar(base, secretaria, { hora: '10:00', servico: 'sSala' })
    assert.match(erroDe(() => criar(base, secretaria, { hora: '10:15', servico: 'sSala', prof: 'pB', cliente: 'c2' }))!.message, /Sala 1/)
    assert.ok(criar(base, secretaria, { hora: '10:00', servico: 'sSimples', prof: 'pB', cliente: 'c2' }))
  })
  it('não desativa recurso com reservas futuras', () => {
    const base = novaBase()
    criar(base, secretaria, { hora: '10:00', servico: 'sSala' })
    assert.match(erroDe(() => motor.validarAlteracaoRecurso(base, base.recursos[0], { ativo: false, capacidade: 1 }, AGORA))!.message, /desativar/)
  })
})

describe('lista de espera', () => {
  it('sugere candidatos para a vaga liberada e só marca agendado após criar a reserva', () => {
    const base = novaBase()
    motor.criarEntradaEspera(base, secretaria, { id: 'e1', clienteId: 'c3', servicoId: 'sSimples', profissionalId: null, dataInicio: D, dataFim: '2026-10-20', horaInicio: '08:00', horaFim: '12:00', observacao: '' }, AGORA)
    assert.match(erroDe(() => motor.criarEntradaEspera(base, secretaria, { id: 'e2', clienteId: 'c3', servicoId: 'sSimples', profissionalId: null, dataInicio: D, dataFim: D, horaInicio: null, horaFim: null, observacao: '' }, AGORA))!.message, /já está na lista/)
    const vaga = criar(base, secretaria, { hora: '09:00' })
    const item = motor.paraItem(base, vaga)
    motor.cancelarAgendamento(base, secretaria, vaga.id, 'Desmarcou', vaga.versao, AGORA)
    assert.deepEqual(motor.candidatosListaEspera(base, secretaria, 'pA', item.inicio, item.ocupadoAte, AGORA).map(c => c.id), ['e1'])
    criar(base, secretaria, { hora: '13:00', cliente: 'c2' })
    assert.ok(erroDe(() => criar(base, secretaria, { hora: '13:00', cliente: 'c3', espera: 'e1' })))
    assert.equal(base.listaEspera[0].status, 'aguardando', 'falha na reserva mantém a entrada aguardando')
    const reserva = criar(base, secretaria, { hora: '09:00', cliente: 'c3', espera: 'e1' })
    assert.equal(base.listaEspera[0].status, 'agendado')
    assert.equal(base.listaEspera[0].agendamentoId, reserva.id)
    assert.match(erroDe(() => criar(base, secretaria, { hora: '15:00', cliente: 'c3', espera: 'e1' }))!.message, /encerrada/)
    assert.equal(base.agendamentos.filter(a => a.clienteId === 'c3').length, 1, 'nenhuma reserva duplicada')
  })
})

describe('mensagens pelo WhatsApp', () => {
  it('o texto não inclui observações internas nem telefone, e usa só o primeiro nome', () => {
    const item = { clienteNome: 'Maria da Silva', servicoNome: 'Design de sobrancelhas', profissionalNome: 'Camila', data: '2026-10-12', horaInicio: '09:00', observacao: 'Alergia a henna', clienteTelefone: '(11) 98765-4321' }
    for (const tipo of ['confirmacao', 'lembrete', 'cancelamento', 'reagendamento'] as const) {
      const texto = textoDaMensagem(tipo, item)
      assert.match(texto, /Olá, Maria!/)
      assert.ok(!texto.includes('Alergia') && !texto.includes('Silva') && !texto.includes('98765'))
    }
    assert.deepEqual(tiposPermitidos('cancelado'), ['cancelamento'])
    assert.deepEqual(tiposPermitidos('concluido'), [])
  })
  it('envio só existe quando registrado; reagendar torna a mensagem anterior desatualizada', () => {
    const base = novaBase()
    const a = criar(base, secretaria, { hora: '09:00' })
    assert.equal(motor.paraItem(base, a).ultimaComunicacao, null)
    motor.registrarComunicacao(base, secretaria, 'm1', a.id, 'confirmacao', AGORA)
    motor.registrarComunicacao(base, secretaria, 'm1', a.id, 'confirmacao', AGORA)
    assert.equal(base.comunicacoes.length, 1, 'o mesmo registro repetido não duplica')
    assert.equal(a.status, 'agendado', 'mensagem enviada não é presença confirmada')
    motor.reagendarAgendamento(base, secretaria, a.id, { data: D, hora: '11:00', profissionalId: 'pA', motivo: 'Pedido' }, a.versao, AGORA)
    assert.equal(motor.paraItem(base, a).comunicacaoDesatualizada, true)
    assert.match(erroDe(() => motor.registrarComunicacao(base, profissional, 'm2', a.id, 'lembrete', AGORA))!.message, /permissão/)
  })
})

describe('resumo do dia', () => {
  it('conta por status, separa presença confirmada de mensagem enviada e respeita o filtro', () => {
    const item = (status: ItemAgenda['status'], comMensagem = false) => ({ status, ultimaComunicacao: comMensagem ? { tipo: 'confirmacao', em: '', por: '' } : null, comunicacaoDesatualizada: false }) as ItemAgenda
    const itens = [item('agendado', true), item('agendado'), item('confirmado'), item('chegou'), item('concluido'), item('cancelado'), item('faltou')]
    assert.equal(filtrarPorStatus(itens, '').length, 6, 'total exclui cancelados')
    assert.equal(filtrarPorStatus(itens, 'confirmado').length, 1)
    assert.equal(filtrarPorStatus(itens, 'sem_mensagem').length, 2, 'agendado sem mensagem e confirmado sem mensagem')
    assert.equal(filtrarPorStatus(itens, 'todos').length, 7)
  })
})

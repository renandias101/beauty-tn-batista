// Marcação com vários serviços e séries recorrentes espelhadas na demonstração (migração 012 no servidor).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ErroDeOperacao, dicaDoErro } from '../../src/lib/erros'
import * as motor from '../../src/demo/motor'
import type { BaseDemo } from '../../src/demo/motor'
import type { Perfil } from '../../src/types'

const AGORA = new Date('2026-10-05T12:00:00Z') // segunda, 09:00 em São Paulo
const D = '2026-10-12'
const admin: Perfil = { usuarioId: 'u-admin', nome: 'Admin', papel: 'admin', profissionalId: null, fusoHorario: motor.FUSO_DEMO }
const sec: Perfil = { usuarioId: 'u-sec', nome: 'Secretaria', papel: 'secretaria', profissionalId: null, fusoHorario: motor.FUSO_DEMO }
const prof: Perfil = { usuarioId: 'u-prof', nome: 'Prof', papel: 'profissional', profissionalId: 'pA', fusoHorario: motor.FUSO_DEMO }

function novaBase(): BaseDemo {
  const jornada = (p: string) => [0, 1, 2, 3, 4, 5, 6].flatMap(d => [
    { id: `${p}-${d}-m`, profissionalId: p, diaSemana: d, horaInicio: '08:00', horaFim: '12:00' },
    { id: `${p}-${d}-t`, profissionalId: p, diaSemana: d, horaInicio: '13:00', horaFim: '18:00' },
  ])
  return motor.normalizarBase({
    versao: 1, geradaEm: '', usuarios: [],
    profissionais: ['pA', 'pB'].map(id => ({ id, nome: `Prof ${id.slice(1)}`, telefone: null, cor: '#9A6A20', ativo: true, usuarioId: null })),
    servicos: [
      { id: 'cabelo', nome: 'Cabelo', duracaoMinutos: 60, preparacaoMinutos: 10, categoria: null, descricao: null, ativo: true },
      { id: 'sobrancelha', nome: 'Sobrancelha', duracaoMinutos: 30, preparacaoMinutos: 0, categoria: null, descricao: null, ativo: true },
    ],
    habilitacoes: ['pA', 'pB'].flatMap(p => ['cabelo', 'sobrancelha'].map(s => ({ profissionalId: p, servicoId: s, duracaoMinutos: null }))),
    disponibilidades: [...jornada('pA'), ...jornada('pB')], excecoes: [], bloqueios: [],
    clientes: ['c1', 'c2'].map(id => ({ id, nome: `Cliente ${id}`, telefone: '(00) 90000-0001', telefoneDigitos: '0090000001' })),
    agendamentos: [], historico: [], recursos: [], servicoRecursos: [], comunicacoes: [], listaEspera: [], contatosEspera: [],
  } as unknown as BaseDemo)
}
const erroDe = (acao: () => unknown) => { try { acao(); return null } catch (e) { return e as ErroDeOperacao } }
const marcacao = (base: BaseDemo, perfil: Perfil, id: string, etapas: [string, string, string, string?][], extra: { cliente?: string; just?: string } = {}) =>
  motor.criarMarcacao(base, perfil, { id, clienteId: extra.cliente ?? 'c1', observacao: '', justificativaConflito: extra.just, etapas: etapas.map(([servicoId, profissionalId, hora, data = D]) => ({ servicoId, profissionalId, hora, data })) }, AGORA)
const versoes = (base: BaseDemo, filtro: (a: motor.AgendamentoDemo) => boolean) => Object.fromEntries(base.agendamentos.filter(filtro).map(a => [a.id, a.versao]))

describe('marcação com vários serviços', () => {
  it('cria etapas consecutivas com profissionais diferentes e não duplica no reenvio', () => {
    const base = novaBase()
    marcacao(base, sec, 'g1', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '10:00']])
    marcacao(base, sec, 'g1', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '10:00']])
    const etapas = base.agendamentos.filter(a => a.grupoId === 'g1')
    assert.equal(etapas.length, 2)
    assert.deepEqual(etapas.map(a => [a.grupoOrdem, a.horaInicio, a.duracaoMinutos]), [[1, '09:00', 60], [2, '10:00', 30]])
  })
  it('falha em uma etapa não cria nenhuma reserva', () => {
    const base = novaBase()
    motor.criarBloqueio(base, admin, { profissionalId: 'pB', dataInicio: D, dataFim: D, horaInicio: '10:00', horaFim: '11:00', motivo: 'Feriado', diaInteiro: false }, () => 'b1')
    const erro = erroDe(() => marcacao(base, sec, 'g2', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '10:00']]))
    assert.match(erro!.message, /^Etapa 2: .*bloqueado/)
    assert.equal(base.agendamentos.length, 0)
    assert.equal(base.grupos.length, 0)
  })
  it('sobreposição da cliente entre etapas só com exceção da administração', () => {
    const base = novaBase()
    const erro = erroDe(() => marcacao(base, sec, 'g3', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '09:30']]))
    assert.equal(dicaDoErro(erro), 'conflito_cliente')
    marcacao(base, admin, 'g3', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '09:30']], { just: 'Simultâneo combinado' })
    assert.equal(base.agendamentos.find(a => a.grupoOrdem === 2)?.conflitoJustificativa, 'Simultâneo combinado')
  })
  it('reagenda o grupo inteiro mantendo a sequência, e nada muda se uma etapa falhar', () => {
    const base = novaBase()
    marcacao(base, sec, 'g1', [['cabelo', 'pA', '08:00'], ['sobrancelha', 'pA', '09:10']])
    motor.reagendarMarcacao(base, sec, 'g1', { data: D, hora: '08:30', motivo: 'Atraso' }, versoes(base, a => a.grupoId === 'g1'), AGORA)
    assert.deepEqual(base.agendamentos.map(a => a.horaInicio), ['08:30', '09:40'])
    motor.criarBloqueio(base, admin, { profissionalId: 'pA', dataInicio: '2026-10-13', dataFim: '2026-10-13', horaInicio: '09:30', horaFim: '10:00', motivo: 'Curso', diaInteiro: false }, () => 'b2')
    const erro = erroDe(() => motor.reagendarMarcacao(base, sec, 'g1', { data: '2026-10-13', hora: '08:20', motivo: 'Teste' }, versoes(base, a => a.grupoId === 'g1'), AGORA))
    assert.match(erro!.message, /^Etapa 2/)
    assert.deepEqual(base.agendamentos.map(a => [a.data, a.horaInicio]), [[D, '08:30'], [D, '09:40']])
  })
  it('cancela uma etapa ou o grupo; versão antiga é recusada sem mudança parcial', () => {
    const base = novaBase()
    marcacao(base, sec, 'g1', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '10:00']])
    const vistas = versoes(base, a => a.grupoId === 'g1')
    const [e1, e2] = base.agendamentos
    motor.cancelarAgendamento(base, sec, e2.id, 'Só a sobrancelha', e2.versao, AGORA)
    assert.equal(dicaDoErro(erroDe(() => motor.cancelarMarcacao(base, sec, 'g1', 'Tudo', vistas, AGORA))), 'versao_desatualizada')
    assert.equal(e1.status, 'agendado')
    assert.match(erroDe(() => motor.reagendarMarcacao(base, sec, 'g1', { data: D, hora: '13:00', motivo: 'Teste' }, versoes(base, a => a.grupoId === 'g1'), AGORA))!.message, /etapa 2/)
    assert.equal(motor.cancelarMarcacao(base, sec, 'g1', 'Tudo', versoes(base, a => a.grupoId === 'g1'), AGORA), 1)
    assert.ok(base.agendamentos.every(a => a.status === 'cancelado'))
  })
  it('profissional não cria marcações', () => {
    assert.match(erroDe(() => marcacao(novaBase(), prof, 'g9', [['cabelo', 'pA', '09:00'], ['sobrancelha', 'pB', '10:00']]))!.message, /permissão/)
  })
})

describe('séries recorrentes', () => {
  const serie = (extra: Partial<motor.SerieDadosDemo> = {}): motor.SerieDadosDemo => ({
    clienteId: 'c1', servicoId: 'sobrancelha', profissionalId: 'pA', dataInicial: D, hora: '16:00', frequencia: 'semanal', quantidade: 4, dataFinal: null, diaInexistente: null, ...extra,
  })
  it('mostra feriado bloqueado na prévia e não cria série parcial sem escolha explícita', () => {
    const base = novaBase()
    motor.criarBloqueio(base, admin, { profissionalId: 'pA', dataInicio: '2026-10-26', dataFim: '2026-10-26', horaInicio: '', horaFim: '', motivo: 'Feriado municipal', diaInteiro: true }, () => 'f1')
    const previa = motor.preverSerie(base, sec, serie(), AGORA)
    assert.deepEqual(previa.map(p => p.situacao), ['disponivel', 'disponivel', 'indisponivel', 'disponivel'])
    assert.match(erroDe(() => motor.criarSerie(base, sec, 's1', serie(), previa.map(p => p.data), '', AGORA))!.message, /^Ocorrência de 26\/10\/2026: .*bloqueado/)
    assert.equal(base.agendamentos.length, 0)
    assert.equal(base.series.length, 0)
    const criadas = motor.criarSerie(base, sec, 's1', serie(), previa.filter(p => p.situacao === 'disponivel').map(p => p.data), '', AGORA)
    assert.equal(criadas, 3)
    assert.equal(motor.criarSerie(base, sec, 's1', serie(), previa.filter(p => p.situacao === 'disponivel').map(p => p.data), '', AGORA), 3, 'reenvio não duplica')
    assert.equal(base.agendamentos.length, 3)
    assert.deepEqual(base.agendamentos.map(a => a.serieOrdem), [1, 2, 4])
  })
  it('limite de 52 ocorrências e dia inexistente no mensal com escolha explícita', () => {
    assert.match(erroDe(() => motor.datasSerie({ dataInicial: D, frequencia: 'semanal', quantidade: 53, dataFinal: null, diaInexistente: null }))!.message, /52/)
    const base = novaBase()
    const mensal = (diaInexistente: motor.SerieDadosDemo['diaInexistente']) => serie({ dataInicial: '2027-01-31', frequencia: 'mensal', quantidade: 3, diaInexistente, hora: '09:00' })
    assert.equal(motor.preverSerie(base, sec, mensal(null), AGORA)[1].situacao, 'dia_inexistente')
    assert.match(erroDe(() => motor.criarSerie(base, sec, 's2', mensal(null), ['2027-01-31'], '', AGORA))!.message, /último dia/)
    assert.equal(motor.preverSerie(base, sec, mensal('ultimo_dia'), AGORA)[1].data, '2027-02-28')
    const pular = motor.preverSerie(base, sec, mensal('pular'), AGORA)
    // Fevereiro e abril não têm dia 31: os dois são pulados e a série completa 3 ocorrências em janeiro, março e maio.
    assert.deepEqual(pular.map(p => p.situacao), ['disponivel', 'pulada', 'disponivel', 'pulada', 'disponivel'])
  })
  it('esta e as próximas / toda a série, preservando ocorrências concluídas', () => {
    const base = novaBase()
    const datas = motor.preverSerie(base, sec, serie({ hora: '13:00' }), AGORA).map(p => p.data)
    motor.criarSerie(base, sec, 's3', serie({ hora: '13:00' }), datas, '', AGORA)
    const [o1, , o3] = base.agendamentos
    o1.status = 'concluido'
    const elegiveis = (filtro: (a: motor.AgendamentoDemo) => boolean) => versoes(base, a => a.serieId === 's3' && a.status === 'agendado' && filtro(a))
    motor.reagendarSerie(base, sec, 's3', o3.id, { hora: '17:00', profissionalId: null, motivo: 'Mudança' }, elegiveis(a => (a.serieOrdem ?? 0) >= 3), AGORA)
    assert.deepEqual(base.agendamentos.map(a => a.horaInicio), ['13:00', '13:00', '17:00', '17:00'])
    assert.equal(motor.cancelarSerie(base, sec, 's3', null, 'Encerrou', elegiveis(() => true), AGORA), 3)
    assert.deepEqual(base.agendamentos.map(a => a.status), ['concluido', 'cancelado', 'cancelado', 'cancelado'])
  })
})

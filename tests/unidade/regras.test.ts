import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FORMATO_USUARIO, emailDeAcesso, usuarioDoEmail } from '../../src/lib/acesso'
import { agoraNoFuso, diaDaSemana, fimDoMes, gradeDoMes, inicioDaSemana, somarDias, somarMeses, somarMinutos } from '../../src/lib/datas'
import { bloqueioNaData, calcularHorariosLivres } from '../../src/lib/horariosLivres'
import { PROXIMOS_STATUS, ocupaHorario, podeCancelar, podeReagendar } from '../../src/lib/status'
import { formatarTelefone, linkWhatsApp, telefoneValido } from '../../src/lib/telefone'

describe('datas no fuso da clínica', () => {
  it('soma dias atravessando mês e ano', () => {
    assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
    assert.equal(somarDias('2026-03-01', -1), '2026-02-28')
  })
  it('semana começa na segunda-feira', () => {
    assert.equal(diaDaSemana('2026-10-04'), 0) // domingo
    assert.equal(inicioDaSemana('2026-10-04'), '2026-09-28')
    assert.equal(inicioDaSemana('2026-09-28'), '2026-09-28')
  })
  it('mês e grade do calendário', () => {
    assert.equal(fimDoMes('2026-02-10'), '2026-02-28')
    assert.equal(somarMeses('2026-01-31', 1), '2026-02-01')
    const grade = gradeDoMes('2026-10-15')
    assert.equal(grade.length % 7, 0)
    assert.equal(grade[0], '2026-09-28')
    assert.equal(grade[grade.length - 1], '2026-11-01')
  })
  it('soma minutos a um horário', () => {
    assert.equal(somarMinutos('09:30', 45), '10:15')
  })
  it('converte o instante para o fuso America/Sao_Paulo (RN10)', () => {
    // 02:30 UTC de 4/10 ainda é 3/10 às 23:30 em São Paulo.
    assert.deepEqual(agoraNoFuso('America/Sao_Paulo', new Date('2026-10-04T02:30:00Z')), { data: '2026-10-03', hora: '23:30' })
  })
})

describe('horários livres (RN01, RN03, CA04, CA05)', () => {
  const faixas = [{ horaInicio: '08:00', horaFim: '12:00' }, { horaInicio: '13:00', horaFim: '18:00' }]
  const em = (lista: number[]) => lista.map(m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)

  it('o atendimento inteiro precisa caber na faixa: não atravessa o intervalo nem o fim da jornada', () => {
    const livres = em(calcularHorariosLivres({ faixas, ocupados: [], duracaoMinutos: 60 }))
    assert.ok(livres.includes('11:00'))
    assert.ok(!livres.includes('11:30'), '11:30 + 60 min atravessaria o intervalo')
    assert.ok(livres.includes('17:00'))
    assert.ok(!livres.includes('17:30'), '17:30 + 60 min passaria do fim da jornada')
  })
  it('permite começar exatamente no término de outro atendimento', () => {
    const ocupados = [{ inicio: 9 * 60, fim: 10 * 60 }]
    const livres = em(calcularHorariosLivres({ faixas, ocupados, duracaoMinutos: 60 }))
    assert.ok(livres.includes('08:00'), 'termina exatamente quando o outro começa')
    assert.ok(livres.includes('10:00'), 'começa exatamente quando o outro termina')
    assert.ok(!livres.includes('08:30') && !livres.includes('09:00') && !livres.includes('09:30'))
  })
  it('respeita bloqueios e o horário atual', () => {
    const livres = em(calcularHorariosLivres({ faixas, ocupados: [{ inicio: 14 * 60, fim: 16 * 60 }], duracaoMinutos: 60, aPartirDeMinutos: 13 * 60 + 1 }))
    assert.deepEqual(livres, ['16:00', '17:00'])
  })
  it('encaixa um atendimento após o outro pela duração do serviço', () => {
    const livres = em(calcularHorariosLivres({ faixas: [{ horaInicio: '08:00', horaFim: '12:00' }], ocupados: [], duracaoMinutos: 45 }))
    assert.deepEqual(livres, ['08:00', '08:45', '09:30', '10:15', '11:00'], 'cabem 5 atendimentos de 45 min entre 08:00 e 12:00')
  })
  it('depois de uma ocupação recomeça a contagem no fim dela', () => {
    const livres = em(calcularHorariosLivres({ faixas: [{ horaInicio: '09:00', horaFim: '12:00' }], ocupados: [{ inicio: 10 * 60, fim: 10 * 60 + 30 }], duracaoMinutos: 50 }))
    assert.deepEqual(livres, ['09:00', '10:30'])
  })
  it('sem jornada ou com duração inválida não sugere horários', () => {
    assert.deepEqual(calcularHorariosLivres({ faixas: [], ocupados: [], duracaoMinutos: 30 }), [])
    assert.deepEqual(calcularHorariosLivres({ faixas, ocupados: [], duracaoMinutos: 0 }), [])
  })
  it('recorta bloqueios de vários dias para a data consultada', () => {
    const ferias = { inicio: '2026-10-05T03:00:00Z', fim: '2026-10-08T03:00:00Z' } // 05/10 00:00 a 08/10 00:00 em São Paulo
    assert.deepEqual(bloqueioNaData(ferias, '2026-10-06', 'America/Sao_Paulo'), { inicio: 0, fim: 1440 })
    assert.equal(bloqueioNaData(ferias, '2026-10-08', 'America/Sao_Paulo'), null)
    const almoco = { inicio: '2026-10-05T15:00:00Z', fim: '2026-10-05T16:00:00Z' }
    assert.deepEqual(bloqueioNaData(almoco, '2026-10-05', 'America/Sao_Paulo'), { inicio: 12 * 60, fim: 13 * 60 })
  })
})

describe('estados do agendamento (seção 6, RN04)', () => {
  it('somente agendado, confirmado, chegou e em atendimento ocupam o horário', () => {
    assert.deepEqual(['agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido', 'cancelado', 'faltou'].filter(s => ocupaHorario(s as never)), ['agendado', 'confirmado', 'chegou', 'em_atendimento'])
  })
  it('estados finais não têm próximos passos nem permitem reagendar', () => {
    for (const s of ['concluido', 'cancelado', 'faltou'] as const) {
      assert.equal(PROXIMOS_STATUS[s].length, 0)
      assert.equal(podeReagendar(s), false)
      assert.equal(podeCancelar(s), false)
    }
  })
})

describe('telefone', () => {
  it('formata celular e fixo com DDD', () => {
    assert.equal(formatarTelefone('11987654321'), '(11) 98765-4321')
    assert.equal(formatarTelefone('1134567890'), '(11) 3456-7890')
  })
  it('valida quantidade de dígitos e gera link do WhatsApp com DDI', () => {
    assert.equal(telefoneValido('(11) 9'), false)
    assert.equal(telefoneValido('(11) 98765-4321'), true)
    assert.equal(linkWhatsApp('(11) 98765-4321'), 'https://wa.me/5511987654321')
  })
})

describe('login por usuário', () => {
  it('converte o usuário no e-mail técnico e de volta', () => {
    assert.equal(emailDeAcesso('  RenanDias101 '), 'renandias101@usuarios.beautytn.invalid')
    assert.equal(usuarioDoEmail('renandias101@usuarios.beautytn.invalid'), 'renandias101')
  })
  it('aceita e-mail completo e valida o formato do usuário', () => {
    assert.equal(emailDeAcesso('alguem@exemplo.com'), 'alguem@exemplo.com')
    assert.ok(FORMATO_USUARIO.test('thais.batista'))
    assert.ok(!FORMATO_USUARIO.test('ab'))
    assert.ok(!FORMATO_USUARIO.test('Com Espaço'))
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { paraMinutos } from '../../src/lib/datas'
import { bloqueioNaData } from '../../src/lib/horariosLivres'
import { ocupaPeriodo } from '../../src/lib/status'
import { gerarBaseDemo } from '../../src/demo/dadosIniciais'
import { FUSO_DEMO, cabeNaJornada, duracaoEfetiva, recursoDisponivel, type BaseDemo } from '../../src/demo/motor'

// Armazenamento falso do navegador, com chaves que não pertencem à demonstração.
class ArmazenamentoFalso {
  dados = new Map<string, string>()
  getItem(chave: string) { return this.dados.get(chave) ?? null }
  setItem(chave: string, valor: string) { this.dados.set(chave, String(valor)) }
  removeItem(chave: string) { this.dados.delete(chave) }
}
const local = new ArmazenamentoFalso()
const sessao = new ArmazenamentoFalso()
Object.assign(globalThis, { localStorage: local, sessionStorage: sessao })

// Segunda 10h, quarta 15h, sábado 19h, domingo 11h e último dia do mês (horário de Brasília).
const REFERENCIAS = ['2026-10-05T13:00:00Z', '2026-10-07T18:00:00Z', '2026-10-03T22:00:00Z', '2026-10-04T14:00:00Z', '2026-10-30T12:00:00Z']

function verificarConsistencia(base: BaseDemo) {
  const ativos = base.agendamentos.filter(a => ocupaPeriodo(a.status))
  for (const a of base.agendamentos) {
    const servico = base.servicos.find(s => s.id === a.servicoId)!
    // Duração efetiva (específica do profissional ou padrão do serviço) e preparação gravadas na reserva.
    assert.equal(a.duracaoMinutos, duracaoEfetiva(base, a.profissionalId, a.servicoId), `${a.id}: duração diferente da efetiva`)
    assert.equal(a.preparacaoMinutos, servico.preparacaoMinutos, `${a.id}: preparação diferente da do serviço`)
    assert.ok(base.habilitacoes.some(h => h.profissionalId === a.profissionalId && h.servicoId === a.servicoId), `${a.id}: profissional não habilitado`)
  }
  for (const a of ativos) {
    const ini = paraMinutos(a.horaInicio)
    // Período ocupado inclui a preparação; reservas concluídas continuam ocupando.
    const fim = ini + a.duracaoMinutos + a.preparacaoMinutos
    assert.ok(cabeNaJornada(base, a.profissionalId, a.data, ini, fim).cabe, `${a.id}: fora da jornada`)
    for (const recursoId of a.recursos) assert.ok(recursoDisponivel(base, recursoId, a.data, ini, fim, a.id), `${a.id}: recurso sem capacidade`)
    const mesmaCliente = ativos.some(o => o.id !== a.id && o.clienteId === a.clienteId && o.data === a.data && !o.conflitoJustificativa && !a.conflitoJustificativa
      && paraMinutos(a.horaInicio) < paraMinutos(o.horaInicio) + o.duracaoMinutos && paraMinutos(a.horaInicio) + a.duracaoMinutos > paraMinutos(o.horaInicio))
    assert.ok(!mesmaCliente, `${a.id}: mesma cliente em dois atendimentos ao mesmo tempo`)
    const bloqueado = base.bloqueios.some(b => !b.removidoEm && b.profissionalId === a.profissionalId && (() => {
      const t = bloqueioNaData(b, a.data, FUSO_DEMO)
      return t !== null && ini < t.fim && fim > t.inicio
    })())
    assert.ok(!bloqueado, `${a.id}: atravessa um bloqueio`)
    const sobreposto = ativos.some(o => o.id !== a.id && o.profissionalId === a.profissionalId && o.data === a.data
      && ini < paraMinutos(o.horaInicio) + o.duracaoMinutos + o.preparacaoMinutos && fim > paraMinutos(o.horaInicio))
    assert.ok(!sobreposto, `${a.id}: sobreposto a outro atendimento do mesmo profissional`)
  }
}

describe('dados fictícios da demonstração', () => {
  for (const referencia of REFERENCIAS) {
    it(`são consistentes e variados em ${referencia}`, () => {
      const base = gerarBaseDemo(new Date(referencia))
      assert.equal(base.profissionais.length, 8)
      assert.equal(base.clientes.length, 25)
      assert.ok(base.clientes.every(c => c.telefone.startsWith('(00)')), 'telefones devem ser ilustrativos (DDD 00)')
      const categorias = new Set(base.servicos.map(s => s.categoria))
      for (const c of ['Maquiagem', 'Depilação', 'Cabelos', 'Sobrancelhas', 'Micropigmentação', 'Cílios', 'Massagem']) assert.ok(categorias.has(c), `falta ${c}`)
      assert.ok(base.agendamentos.filter(x => !x.grupoId && !x.serieId).length >= 35 && base.agendamentos.length <= 60, `agendamentos: ${base.agendamentos.length}`)
      assert.ok(base.bloqueios.filter(b => !b.removidoEm).length >= 4, 'bloqueios de exemplo')
      assert.ok(base.excecoes.length >= 1, 'exceção de exemplo')
      verificarConsistencia(base)

      const status = new Set(base.agendamentos.map(a => a.status))
      assert.ok(status.has('cancelado'), 'deve haver cancelamentos')
      assert.ok(status.has('agendado') || status.has('confirmado'), 'deve haver reservas futuras')
      assert.ok(base.historico.some(h => h.acao === 'reagendado' && h.motivo), 'deve haver reagendamento com motivo no histórico')
      assert.ok(base.agendamentos.some(a => a.encaixe), 'deve haver um encaixe')
      assert.equal(base.agendamentos.filter(a => a.grupoId).length, 2, 'marcação de exemplo com dois serviços')
      assert.ok(base.agendamentos.filter(a => a.serieId).length >= 3, 'série semanal de exemplo')
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DEMO }).format(new Date(referencia))
      assert.ok(base.agendamentos.some(a => a.data === hoje), 'deve haver atendimentos hoje')
    })
  }

  it('são reproduzíveis para a mesma data', () => {
    const a = gerarBaseDemo(new Date(REFERENCIAS[0]))
    const b = gerarBaseDemo(new Date(REFERENCIAS[0]))
    assert.deepEqual(a.agendamentos, b.agendamentos)
  })
})

describe('armazenamento da demonstração', () => {
  it('carrega uma única vez, não recria e só altera a própria chave', async () => {
    // Chaves alheias: sessão do Supabase e dados do sistema antigo devem permanecer intactos.
    local.setItem('sb-xffgansmrgqhbfxocajh-auth-token', 'sessao-real')
    local.setItem('beauty-tn-batista:clients', '[{"id":"real"}]')
    local.setItem('beauty-tn-batista:demo-seeded-v1', 'true')
    const existente = { ...gerarBaseDemo(new Date(REFERENCIAS[0])), geradaEm: 'MARCADOR' }
    local.setItem('beauty-tn-batista:demo:v1', JSON.stringify(existente))

    const estado = await import('../../src/demo/estado')
    const primeira = estado.obterBase()
    assert.equal(primeira.geradaEm, 'MARCADOR', 'deve reaproveitar os dados já salvos')
    assert.equal(estado.obterBase(), primeira, 'segunda leitura não recria')
    assert.equal(primeira.agendamentos.length, existente.agendamentos.length, 'não duplica reservas')

    estado.restaurarDemonstracao()
    assert.notEqual(estado.obterBase().geradaEm, 'MARCADOR', 'restaurar gera os dados fictícios de novo')
    assert.equal(local.getItem('sb-xffgansmrgqhbfxocajh-auth-token'), 'sessao-real')
    assert.equal(local.getItem('beauty-tn-batista:clients'), '[{"id":"real"}]')
    assert.equal(local.getItem('beauty-tn-batista:demo-seeded-v1'), 'true')
    assert.deepEqual([...local.dados.keys()].sort(), ['beauty-tn-batista:clients', 'beauty-tn-batista:demo-seeded-v1', 'beauty-tn-batista:demo:v1', 'sb-xffgansmrgqhbfxocajh-auth-token'])
  })
})

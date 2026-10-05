import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agoraNoFuso, paraMinutos, somarMinutos } from '../../src/lib/datas'
import { bloqueioNaData } from '../../src/lib/horariosLivres'
import { LISTA_STATUS, ocupaHorario, ocupaPeriodo } from '../../src/lib/status'
import { gerarBaseDemo, gerarDemonstracao } from '../../src/demo/dadosIniciais'
import { FUSO_DEMO, cabeNaJornada, candidatosListaEspera, duracaoEfetiva, instante, paraItem, recursoDisponivel, type BaseDemo } from '../../src/demo/motor'
import type { Perfil } from '../../src/types'

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

// Horário de Brasília: segunda 10h, quarta 15h, sábado 19h, domingo 11h, sexta 9h (fim do mês), terça 6h30 (antes da abertura),
// quinta 23h40 (noite), domingo 21h, véspera de Ano-Novo e fim de janeiro (séries mensais atravessando fevereiro).
const REFERENCIAS = [
  '2026-10-05T13:00:00Z', '2026-10-07T18:00:00Z', '2026-10-03T22:00:00Z', '2026-10-04T14:00:00Z', '2026-10-30T12:00:00Z',
  '2026-10-06T09:30:00Z', '2026-10-09T02:40:00Z', '2026-10-12T00:00:00Z', '2026-12-31T15:00:00Z', '2027-01-29T20:00:00Z',
]

const ADMIN: Perfil = { usuarioId: 'demo-u-helena', nome: 'Helena Vasconcelos', papel: 'admin', profissionalId: null, fusoHorario: FUSO_DEMO }

/** Regras que o servidor garante: nenhuma reserva fictícia pode violá-las. */
function verificarConsistencia(base: BaseDemo, agora: Date) {
  const ativos = base.agendamentos.filter(a => ocupaPeriodo(a.status))
  const hoje = agoraNoFuso(FUSO_DEMO, agora).data
  for (const a of base.agendamentos) {
    const servico = base.servicos.find(s => s.id === a.servicoId)
    assert.ok(servico, `${a.id}: serviço inexistente`)
    assert.ok(base.clientes.some(c => c.id === a.clienteId), `${a.id}: cliente inexistente`)
    const profissional = base.profissionais.find(p => p.id === a.profissionalId)
    assert.ok(profissional, `${a.id}: profissional inexistente`)
    assert.ok(LISTA_STATUS.includes(a.status), `${a.id}: status inválido`)
    assert.ok(a.duracaoMinutos > 0 && a.duracaoMinutos <= 720, `${a.id}: duração inválida`)
    // Duração efetiva (específica do profissional ou padrão do serviço) e preparação gravadas na reserva.
    assert.equal(a.duracaoMinutos, duracaoEfetiva(base, a.profissionalId, a.servicoId), `${a.id}: duração diferente da efetiva`)
    assert.equal(a.preparacaoMinutos, servico.preparacaoMinutos, `${a.id}: preparação diferente da do serviço`)
    assert.ok(base.habilitacoes.some(h => h.profissionalId === a.profissionalId && h.servicoId === a.servicoId), `${a.id}: profissional não habilitado`)
    assert.deepEqual([...a.recursos].sort(), base.servicoRecursos.filter(v => v.servicoId === a.servicoId).map(v => v.recursoId).sort(), `${a.id}: recursos diferentes dos do serviço`)
    // ocupado_ate = fim do atendimento + preparação, dentro do mesmo dia.
    const item = paraItem(base, a)
    assert.equal(item.horaOcupadoAte, somarMinutos(item.horaFim, a.preparacaoMinutos), `${a.id}: ocupado até incoerente`)
    assert.ok(paraMinutos(item.horaOcupadoAte) <= 24 * 60, `${a.id}: passa da meia-noite`)
    if (a.status === 'cancelado') assert.ok(a.motivoCancelamento && a.canceladoEm, `${a.id}: cancelamento sem motivo ou momento`)
    // Inativos não recebem reservas novas: só podem aparecer em atendimentos já resolvidos no passado.
    if (!profissional.ativo || !servico.ativo) assert.ok(a.data < hoje && !ocupaHorario(a.status), `${a.id}: reserva vigente para profissional ou serviço inativo`)
    // Histórico: começa pela criação, em ordem cronológica e nunca no futuro.
    const historico = base.historico.filter(h => h.agendamentoId === a.id)
    assert.equal(historico[0]?.acao, 'criado', `${a.id}: histórico não começa pela criação`)
    historico.forEach((h, i) => {
      assert.ok(Date.parse(h.ocorridoEm) <= agora.getTime(), `${a.id}: histórico no futuro`)
      if (i) assert.ok(h.ocorridoEm >= historico[i - 1].ocorridoEm, `${a.id}: histórico fora de ordem`)
    })
    if (a.status === 'faltou') assert.ok(Date.parse(historico.at(-1)!.ocorridoEm) >= Date.parse(instante(a.data, a.horaInicio)), `${a.id}: falta antes do horário`)
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
  // Status em andamento só fazem sentido hoje.
  for (const a of base.agendamentos.filter(x => x.status === 'chegou' || x.status === 'em_atendimento')) assert.equal(a.data, hoje, `${a.id}: ${a.status} fora de hoje`)

  // Marcações: mesma cliente, de 2 a 6 etapas numeradas em sequência.
  for (const g of base.grupos) {
    const etapas = base.agendamentos.filter(a => a.grupoId === g.id).sort((x, y) => (x.grupoOrdem ?? 0) - (y.grupoOrdem ?? 0))
    assert.ok(etapas.length >= 2 && etapas.length <= 6, `${g.id}: quantidade de etapas`)
    assert.ok(etapas.every((a, i) => a.clienteId === g.clienteId && a.grupoOrdem === i + 1), `${g.id}: etapas incoerentes`)
  }
  // Séries: ocorrências da mesma cliente, serviço e profissional, com ordens distintas.
  for (const s of base.series) {
    const ocorrencias = base.agendamentos.filter(a => a.serieId === s.id)
    assert.ok(ocorrencias.length >= 2 && ocorrencias.length <= 52, `${s.id}: quantidade de ocorrências`)
    assert.ok(ocorrencias.every(a => a.clienteId === s.clienteId && a.servicoId === s.servicoId && a.profissionalId === s.profissionalId), `${s.id}: ocorrência incoerente`)
    assert.equal(new Set(ocorrencias.map(a => a.serieOrdem)).size, ocorrencias.length, `${s.id}: ordens repetidas`)
  }
  // Lista de espera: "agendado" sempre ligado a uma reserva da mesma cliente e serviço; contatos registrados.
  for (const e of base.listaEspera) {
    if (e.status === 'agendado') {
      const reserva = base.agendamentos.find(a => a.id === e.agendamentoId)
      assert.ok(reserva && reserva.clienteId === e.clienteId && reserva.servicoId === e.servicoId, `${e.id}: vínculo com a reserva`)
    } else assert.equal(e.agendamentoId, null, `${e.id}: vínculo sem estar agendado`)
    const contatos = base.contatosEspera.filter(c => c.listaEsperaId === e.id)
    assert.ok(contatos.length >= 1 && contatos.at(-1)!.statusNovo === e.status, `${e.id}: contatos incoerentes com a situação`)
    assert.ok(contatos.every(c => Date.parse(c.ocorridoEm) <= agora.getTime()), `${e.id}: contato no futuro`)
  }
  for (const c of base.comunicacoes) {
    assert.ok(base.agendamentos.some(a => a.id === c.agendamentoId), `${c.id}: mensagem sem reserva`)
    assert.ok(Date.parse(c.registradoEm) <= agora.getTime(), `${c.id}: mensagem no futuro`)
  }
  for (const v of base.servicoRecursos) assert.ok(base.servicos.some(s => s.id === v.servicoId) && base.recursos.some(r => r.id === v.recursoId), 'vínculo de recurso inexistente')
  for (const h of base.habilitacoes) assert.ok(base.servicos.some(s => s.id === h.servicoId) && base.profissionais.some(p => p.id === h.profissionalId), 'habilitação inexistente')
  for (const p of base.profissionais) if (p.usuarioId) assert.ok(base.usuarios.some(u => u.usuarioId === p.usuarioId && u.papel === 'profissional'), `${p.id}: usuário vinculado inexistente`)
}

describe('dados fictícios da demonstração', () => {
  for (const referencia of REFERENCIAS) {
    it(`são consistentes e cobrem todos os cenários em ${referencia}`, () => {
      const agora = new Date(referencia)
      const { base, pendencias } = gerarDemonstracao(agora)
      assert.deepEqual(pendencias, [], 'todos os cenários do roteiro devem ser criados')
      verificarConsistencia(base, agora)
      const hoje = agoraNoFuso(FUSO_DEMO, agora).data

      // Cadastros.
      assert.equal(base.profissionais.filter(p => p.ativo).length, 8)
      assert.equal(base.profissionais.filter(p => !p.ativo).length, 1)
      assert.ok(base.profissionais.some(p => p.ativo && !p.usuarioId), 'profissional ativo sem usuário')
      assert.ok(base.profissionais.some(p => p.ativo && p.usuarioId), 'profissional ativo com usuário')
      assert.ok(base.habilitacoes.some(h => h.duracaoMinutos), 'duração específica por profissional')
      const ativos = base.servicos.filter(s => s.ativo)
      assert.ok(base.servicos.length >= 18 && base.servicos.length <= 22, `serviços: ${base.servicos.length}`)
      assert.ok(base.servicos.filter(s => !s.ativo).length >= 2, 'serviços inativos')
      for (const c of ['Maquiagem', 'Depilação', 'Cabelos', 'Sobrancelhas', 'Micropigmentação', 'Cílios', 'Massagem']) assert.ok(ativos.some(s => s.categoria === c), `falta ${c}`)
      assert.ok(ativos.some(s => !base.habilitacoes.some(h => h.servicoId === s.id && base.profissionais.find(p => p.id === h.profissionalId)?.ativo)), 'serviço ativo sem profissional ativo')
      assert.ok(base.recursos.some(r => r.capacidade === 1) && base.recursos.some(r => r.capacidade > 1) && base.recursos.some(r => !r.ativo), 'variedade de recursos')
      assert.ok(base.clientes.length >= 40 && base.clientes.length <= 50, `clientes: ${base.clientes.length}`)
      assert.ok(base.clientes.every(c => c.telefone.startsWith('(00)')), 'telefones devem ser ilustrativos (DDD 00)')
      assert.ok(base.clientes.some((c, i) => base.clientes.some((o, j) => j !== i && o.telefoneDigitos === c.telefoneDigitos)), 'telefone compartilhado')
      assert.ok(base.usuarios.filter(u => u.papel === 'secretaria' && u.ativo).length >= 2, 'mais de uma recepção ativa')
      assert.ok(base.usuarios.some(u => !u.ativo), 'usuário inativo')
      assert.ok(base.pedidosSenha.some(p => !p.encerradoEm && base.usuarios.find(u => u.usuarioId === p.usuarioId)?.ativo), 'pedido de senha aberto de conta ativa')
      assert.match(base.configuracao?.whatsapp ?? '', /^00\d{8,13}$/, 'WhatsApp fictício configurado')

      // Jornada, exceções e bloqueios.
      assert.ok(base.disponibilidades.some(d => d.diaSemana === 6), 'atendimento aos sábados')
      assert.ok(base.excecoes.some(e => e.data > hoje && base.agendamentos.some(a => a.profissionalId === e.profissionalId && a.data === e.data
        && paraMinutos(a.horaInicio) >= paraMinutos(e.horaInicio) && ocupaHorario(a.status))), 'exceção futura em uso')
      const bloqueios = base.bloqueios.filter(b => !b.removidoEm)
      const horas = (b: { inicio: string; fim: string }) => (Date.parse(b.fim) - Date.parse(b.inicio)) / 3_600_000
      assert.ok(bloqueios.some(b => horas(b) === 1) && bloqueios.some(b => horas(b) >= 24) && bloqueios.some(b => horas(b) >= 72), 'bloqueios de 1 hora, dia inteiro e vários dias')
      for (const motivo of ['Férias', 'Compromisso pessoal', 'Reunião de equipe']) assert.ok(bloqueios.some(b => b.motivo === motivo), `bloqueio: ${motivo}`)
      assert.ok(bloqueios.some(b => /curso/i.test(b.motivo)), 'bloqueio de curso')

      // Agenda.
      assert.ok(base.agendamentos.length >= 100 && base.agendamentos.length <= 140, `agendamentos: ${base.agendamentos.length}`)
      for (const status of LISTA_STATUS) assert.ok(base.agendamentos.some(a => a.status === status), `falta o status ${status}`)
      assert.ok(base.agendamentos.filter(a => a.data === hoje).length >= 10, 'agenda de hoje movimentada')
      assert.ok(base.agendamentos.some(a => a.data < hoje) && base.agendamentos.some(a => a.data > hoje), 'passado e futuro')
      assert.ok(base.agendamentos.some(a => a.data > somarDiasTexto(hoje, 14)), 'próximas semanas')
      assert.ok(base.agendamentos.filter(a => a.status === 'faltou').length >= 3, 'faltas')
      assert.ok(new Set(base.agendamentos.filter(a => a.status === 'cancelado').map(a => a.motivoCancelamento)).size >= 5, 'motivos de cancelamento variados')
      assert.ok(base.agendamentos.filter(a => a.encaixe).length >= 3, 'encaixes')
      assert.ok(base.agendamentos.some(a => a.preparacaoMinutos > 0 && ocupaPeriodo(a.status)), 'preparação')
      assert.ok(base.agendamentos.some(a => base.habilitacoes.find(h => h.profissionalId === a.profissionalId && h.servicoId === a.servicoId)?.duracaoMinutos), 'reserva com duração específica')
      assert.equal(base.agendamentos.filter(a => a.conflitoJustificativa).length, 1, 'uma exceção de conflito da cliente')
      const macas = base.agendamentos.filter(a => a.recursos.includes('demo-rec-macas') && ocupaPeriodo(a.status))
      assert.ok(macas.some(a => macas.some(o => o.id !== a.id && o.data === a.data && o.horaInicio === a.horaInicio)), 'duas reservas simultâneas no recurso de capacidade 2')
      const observacoes = base.agendamentos.map(a => a.observacao?.length ?? 0)
      assert.ok(observacoes.some(n => n === 0) && observacoes.some(n => n > 0 && n < 60) && observacoes.some(n => n > 120), 'observações variadas')

      // Histórico e mensagens.
      for (const acao of ['criado', 'status_alterado', 'reagendado', 'cancelado', 'editado', 'status_corrigido'] as const) assert.ok(base.historico.some(h => h.acao === acao), `histórico sem ${acao}`)
      assert.ok(base.historico.some(h => h.acao === 'reagendado' && h.valoresAnteriores?.profissional_id !== h.valoresNovos?.profissional_id), 'reagendamento com troca de profissional')
      assert.ok(base.historico.some(h => h.acao === 'reagendado' && h.valoresAnteriores?.data !== h.valoresNovos?.data), 'reagendamento de data')
      assert.ok(base.historico.some(h => h.acao === 'reagendado' && h.valoresAnteriores?.data === h.valoresNovos?.data && h.valoresAnteriores?.profissional_id === h.valoresNovos?.profissional_id), 'reagendamento de horário')
      for (const tipo of ['confirmacao', 'lembrete', 'cancelamento', 'reagendamento'] as const) assert.ok(base.comunicacoes.some(c => c.tipo === tipo), `mensagem ${tipo}`)
      assert.ok(base.agendamentos.some(a => paraItem(base, a).comunicacaoDesatualizada && ocupaHorario(a.status)), 'mensagem desatualizada após reagendar')
      assert.ok(base.agendamentos.some(a => ocupaHorario(a.status) && a.data > hoje && !base.comunicacoes.some(c => c.agendamentoId === a.id)), 'reserva ainda sem mensagem')

      // Marcações e séries.
      assert.ok(base.grupos.length >= 3, 'marcações')
      const etapas = (id: string) => base.agendamentos.filter(a => a.grupoId === id)
      assert.ok(base.grupos.some(g => etapas(g.id).length === 3), 'marcação com 3 serviços')
      assert.ok(base.grupos.some(g => new Set(etapas(g.id).map(a => a.profissionalId)).size > 1), 'marcação com profissionais diferentes')
      for (const f of ['semanal', 'quinzenal', 'mensal'] as const) assert.ok(base.series.some(s => s.frequencia === f), `série ${f}`)
      assert.ok(base.series.some(s => s.diaInexistente === 'ultimo_dia') && base.series.some(s => s.diaInexistente === 'pular'), 'séries mensais com as duas escolhas')
      assert.ok(base.series.some(s => base.agendamentos.filter(a => a.serieId === s.id && a.data > hoje).length >= 3), 'série com várias ocorrências futuras')

      // Lista de espera e vaga liberada.
      assert.ok(base.listaEspera.length >= 10 && base.listaEspera.length <= 15, `lista de espera: ${base.listaEspera.length}`)
      for (const status of ['aguardando', 'contatado', 'agendado', 'desistiu'] as const) assert.ok(base.listaEspera.some(e => e.status === status), `lista de espera sem ${status}`)
      assert.ok(base.listaEspera.some(e => e.profissionalId) && base.listaEspera.some(e => !e.profissionalId), 'preferência de profissional')
      assert.ok(base.listaEspera.some(e => !e.horaInicio) && base.listaEspera.some(e => e.horaFim && e.horaFim <= '12:30') && base.listaEspera.some(e => e.horaInicio && e.horaInicio >= '13:00'), 'preferências de horário')
      const comCandidatas = base.agendamentos.filter(a => ocupaHorario(a.status) && Date.parse(instante(a.data, a.horaInicio)) > agora.getTime())
        .filter(a => { const item = paraItem(base, a); return candidatosListaEspera(base, ADMIN, a.profissionalId, item.inicio, item.ocupadoAte, agora).length > 0 })
      assert.ok(comCandidatas.length >= 2, 'reservas cuja vaga liberada tem candidatas na lista de espera')
    })
  }

  it('são reproduzíveis para a mesma data', () => {
    const a = gerarBaseDemo(new Date(REFERENCIAS[0]))
    const b = gerarBaseDemo(new Date(REFERENCIAS[0]))
    assert.deepEqual(a, b)
  })
})

function somarDiasTexto(data: string, dias: number) {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

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

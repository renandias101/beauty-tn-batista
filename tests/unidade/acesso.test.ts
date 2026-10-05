import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gerarBaseDemo } from '../../src/demo/dadosIniciais'
import { encerrarPedidoSenha, pedidosSenhaAbertos, solicitarRedefinicaoSenha } from '../../src/demo/motor'
import { CHAVE_LEMBRAR_ACESSO, criarArmazenamentoSessao, type Canal } from '../../src/lib/lembrarAcesso'
import type { Perfil } from '../../src/types'

class ArmazenamentoFalso {
  dados = new Map<string, string>()
  getItem(chave: string) { return this.dados.get(chave) ?? null }
  setItem(chave: string, valor: string) { this.dados.set(chave, String(valor)) }
  removeItem(chave: string) { this.dados.delete(chave) }
}

const CHAVE = 'sb-projeto-auth-token'

describe('Lembrar de mim', () => {
  it('desmarcado (padrão): a sessão fica só no armazenamento da aba', () => {
    const local = new ArmazenamentoFalso(), sessao = new ArmazenamentoFalso()
    const s = criarArmazenamentoSessao(local, sessao)
    assert.equal(s.lembrar(), false)
    s.armazenamento.setItem(CHAVE, 'token')
    assert.equal(sessao.getItem(CHAVE), 'token')
    assert.equal(local.getItem(CHAVE), null)
    assert.equal(s.armazenamento.getItem(CHAVE), 'token')
  })

  it('marcado: a sessão fica no armazenamento permanente e sai do da aba', () => {
    const local = new ArmazenamentoFalso(), sessao = new ArmazenamentoFalso()
    const s = criarArmazenamentoSessao(local, sessao)
    s.armazenamento.setItem(CHAVE, 'antigo')
    s.definirLembrar(true)
    assert.equal(local.getItem(CHAVE_LEMBRAR_ACESSO), '1')
    s.armazenamento.setItem(CHAVE, 'novo')
    assert.equal(local.getItem(CHAVE), 'novo')
    assert.equal(sessao.getItem(CHAVE), null)
    s.definirLembrar(false)
    assert.equal(local.getItem(CHAVE_LEMBRAR_ACESSO), null)
  })

  it('sessão gravada antes da opção continua sendo lida e sair apaga dos dois lugares', () => {
    const local = new ArmazenamentoFalso(), sessao = new ArmazenamentoFalso()
    local.setItem(CHAVE, 'legado')
    const s = criarArmazenamentoSessao(local, sessao)
    assert.equal(s.armazenamento.getItem(CHAVE), 'legado')
    sessao.setItem(CHAVE, 'outro')
    s.armazenamento.removeItem(CHAVE)
    assert.equal(local.getItem(CHAVE), null)
    assert.equal(sessao.getItem(CHAVE), null)
  })

  it('armazenamento bloqueado pelo navegador não quebra a entrada', () => {
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') }, removeItem: () => { throw new Error('bloqueado') } }
    const s = criarArmazenamentoSessao(quebrado, quebrado)
    assert.equal(s.lembrar(), false)
    assert.doesNotThrow(() => { s.definirLembrar(true); s.armazenamento.setItem(CHAVE, 'x'); s.armazenamento.removeItem(CHAVE) })
    assert.equal(s.armazenamento.getItem(CHAVE), null)
  })
})

// Canal falso entre abas: entrega a mensagem às outras abas de forma assíncrona, como o BroadcastChannel.
function criarBarramento() {
  const abas: Canal[] = []
  return () => {
    const canal: Canal = {
      onmessage: null,
      postMessage: mensagem => { for (const outra of abas) if (outra !== canal) queueMicrotask(() => outra.onmessage?.({ data: mensagem })) },
    }
    abas.push(canal)
    return canal
  }
}

describe('Lembrar de mim desmarcado com várias abas', () => {
  it('uma aba nova recebe a sessão de uma aba já aberta', async () => {
    const local = new ArmazenamentoFalso(), abrirCanal = criarBarramento()
    const aba1 = criarArmazenamentoSessao(local, new ArmazenamentoFalso(), abrirCanal())
    aba1.armazenamento.setItem(CHAVE, 'token')
    const sessaoAba2 = new ArmazenamentoFalso()
    const aba2 = criarArmazenamentoSessao(local, sessaoAba2, abrirCanal())
    assert.equal(await aba2.armazenamento.getItem(CHAVE), 'token')
    assert.equal(sessaoAba2.getItem(CHAVE), 'token', 'a aba nova guarda a sessão recebida')
    assert.equal(local.getItem(CHAVE), null, 'nada vai para o armazenamento permanente')
  })

  it('renovação e saída em uma aba valem para as outras', async () => {
    const local = new ArmazenamentoFalso(), abrirCanal = criarBarramento()
    const sessaoAba1 = new ArmazenamentoFalso(), sessaoAba2 = new ArmazenamentoFalso()
    const aba1 = criarArmazenamentoSessao(local, sessaoAba1, abrirCanal())
    const aba2 = criarArmazenamentoSessao(local, sessaoAba2, abrirCanal())
    let encerradas = 0
    aba2.aoEncerrarEmOutraAba(() => encerradas++)
    aba1.armazenamento.setItem(CHAVE, 'token-1')
    await new Promise(r => setTimeout(r, 5))
    aba1.armazenamento.setItem(CHAVE, 'token-renovado')
    await new Promise(r => setTimeout(r, 5))
    assert.equal(sessaoAba2.getItem(CHAVE), 'token-renovado')
    aba1.armazenamento.removeItem(CHAVE)
    await new Promise(r => setTimeout(r, 5))
    assert.equal(sessaoAba2.getItem(CHAVE), null)
    assert.equal(encerradas, 1, 'a outra aba é avisada da saída uma única vez')
  })

  it('sem outras abas abertas, segue sem sessão depois do prazo', async () => {
    const aba = criarArmazenamentoSessao(new ArmazenamentoFalso(), new ArmazenamentoFalso(), criarBarramento()(), 20)
    assert.equal(await aba.armazenamento.getItem(CHAVE), null)
  })

  it('com "lembrar" marcado, não usa o canal entre abas', () => {
    const local = new ArmazenamentoFalso()
    const aba = criarArmazenamentoSessao(local, new ArmazenamentoFalso(), criarBarramento()())
    aba.definirLembrar(true)
    assert.equal(aba.armazenamento.getItem(CHAVE), null, 'resposta imediata, sem esperar outras abas')
  })
})

describe('Esqueci a senha (demonstração, espelho da migração 013)', () => {
  const perfil = (papel: Perfil['papel'], usuarioId = 'demo-u-helena'): Perfil => ({ usuarioId, nome: 'Teste', papel, profissionalId: null, fusoHorario: 'America/Sao_Paulo' })
  const admin = perfil('admin')

  it('gera um único pedido em aberto por conta e ignora contas desconhecidas ou desativadas', () => {
    const base = gerarBaseDemo(new Date('2026-10-05T13:00:00Z'))
    base.pedidosSenha = []
    solicitarRedefinicaoSenha(base, '  CAROLINA.Recepcao ')
    solicitarRedefinicaoSenha(base, 'carolina.recepcao')
    solicitarRedefinicaoSenha(base, 'nao.existe')
    solicitarRedefinicaoSenha(base, '')
    base.usuarios.find(u => u.usuario === 'helena.admin')!.ativo = false
    solicitarRedefinicaoSenha(base, 'helena.admin')
    const abertos = pedidosSenhaAbertos(base, admin)
    assert.deepEqual(abertos.map(p => p.usuario), ['carolina.recepcao'])
  })

  it('somente a administração lista e encerra pedidos', () => {
    const base = gerarBaseDemo(new Date('2026-10-05T13:00:00Z'))
    assert.throws(() => pedidosSenhaAbertos(base, perfil('secretaria', 'demo-u-carolina')), /permissão/)
    assert.throws(() => pedidosSenhaAbertos(base, null), /permissão/)
    assert.throws(() => encerrarPedidoSenha(base, perfil('profissional', 'demo-u-luana'), 'demo-u-luana', 'descartado'), /permissão/)
  })

  it('encerrar registra quem atendeu e libera um novo pedido depois', () => {
    const base = gerarBaseDemo(new Date('2026-10-05T13:00:00Z'))
    assert.equal(pedidosSenhaAbertos(base, admin).length, 1)
    const alvo = pedidosSenhaAbertos(base, admin)[0].usuarioId
    encerrarPedidoSenha(base, admin, alvo, 'senha_redefinida')
    assert.equal(pedidosSenhaAbertos(base, admin).length, 0)
    const encerrado = base.pedidosSenha.find(p => p.usuarioId === alvo)!
    assert.equal(encerrado.resolucao, 'senha_redefinida')
    assert.equal(encerrado.encerradoPor, 'demo-u-helena')
    // Sem pedido em aberto, encerrar não faz nada.
    assert.doesNotThrow(() => encerrarPedidoSenha(base, admin, alvo, 'descartado'))
    const usuario = base.usuarios.find(u => u.usuarioId === alvo)!.usuario
    solicitarRedefinicaoSenha(base, usuario)
    assert.equal(pedidosSenhaAbertos(base, admin).length, 1)
  })

  it('depois de um descarte, a mesma conta espera 30 minutos para gerar outro aviso', () => {
    const base = gerarBaseDemo(new Date('2026-10-05T13:00:00Z'))
    base.pedidosSenha = []
    const t0 = new Date('2026-10-05T13:00:00Z')
    const depois = (minutos: number) => new Date(t0.getTime() + minutos * 60_000)
    solicitarRedefinicaoSenha(base, 'carolina.recepcao', t0)
    encerrarPedidoSenha(base, admin, 'demo-u-carolina', 'descartado', depois(1))
    solicitarRedefinicaoSenha(base, 'carolina.recepcao', depois(10))
    assert.equal(pedidosSenhaAbertos(base, admin).length, 0, 'pedido logo após o descarte não gera aviso')
    solicitarRedefinicaoSenha(base, 'carolina.recepcao', depois(32))
    assert.equal(pedidosSenhaAbertos(base, admin).length, 1, 'após 30 minutos, o aviso volta a ser gerado')
    // Senha redefinida não impõe espera.
    encerrarPedidoSenha(base, admin, 'demo-u-carolina', 'senha_redefinida', depois(33))
    solicitarRedefinicaoSenha(base, 'carolina.recepcao', depois(34))
    assert.equal(pedidosSenhaAbertos(base, admin).length, 1)
  })

  it('pedidos encerrados há mais de 180 dias são apagados ao encerrar outro', () => {
    const base = gerarBaseDemo(new Date('2026-10-05T13:00:00Z'))
    base.pedidosSenha = [{ id: 'antigo', usuarioId: 'demo-u-luana', solicitadoEm: '2026-01-01T12:00:00.000Z', encerradoEm: '2026-01-01T13:00:00.000Z', encerradoPor: 'demo-u-helena', resolucao: 'senha_redefinida' }]
    solicitarRedefinicaoSenha(base, 'carolina.recepcao', new Date('2026-10-05T13:00:00Z'))
    encerrarPedidoSenha(base, admin, 'demo-u-carolina', 'senha_redefinida', new Date('2026-10-05T13:10:00Z'))
    assert.deepEqual(base.pedidosSenha.map(p => p.usuarioId), ['demo-u-carolina'])
  })
})

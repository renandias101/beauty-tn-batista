// Teste de integração contra o banco de desenvolvimento, com as contas de .env.test.local.
// Cobre os critérios de aceite que dependem do servidor (CA02–CA09, CA11) e as regras RN01–RN09.
// Os dados criados ficam identificados com "Teste" e as reservas ativas são canceladas ao final.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const lerEnv = arquivo => Object.fromEntries(readFileSync(arquivo, 'utf8').split(/\r?\n/)
  .filter(linha => linha && !linha.startsWith('#') && linha.includes('='))
  .map(linha => [linha.slice(0, linha.indexOf('=')).trim(), linha.slice(linha.indexOf('=') + 1).trim()]))
const env = { ...lerEnv('.env.local'), ...lerEnv('.env.test.local') }
const emailDe = usuario => `${usuario}@usuarios.beautytn.invalid`
const novoCliente = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const resultados = []
const verificar = (nome, condicao, detalhe = '') => {
  resultados.push({ nome, ok: Boolean(condicao) })
  console.log(`${condicao ? '✔' : '✘'} ${nome}${!condicao && detalhe ? ` — ${detalhe}` : ''}`)
}
const exigir = ({ data, error }, contexto) => { if (error) throw new Error(`${contexto}: ${error.message}`); return data }

async function entrar(usuario, senha) {
  const email = emailDe(usuario)
  const cliente = novoCliente()
  exigir(await cliente.auth.signInWithPassword({ email, password: senha }), `login ${email}`)
  return cliente
}

const admin = await entrar(env.TESTE_ADMIN_USUARIO, env.TESTE_ADMIN_SENHA)
const secretaria = await entrar(env.TESTE_SECRETARIA_USUARIO, env.TESTE_SECRETARIA_SENHA)
const prof1 = await entrar(env.TESTE_PROF1_USUARIO, env.TESTE_PROF1_SENHA)
const prof2 = await entrar(env.TESTE_PROF2_USUARIO, env.TESTE_PROF2_SENHA)
const anonimo = novoCliente()

// ---------- Preparação (cadastros reaproveitados entre execuções) ----------
async function obterOuCriar(tabela, filtro, valores) {
  const existentes = exigir(await admin.from(tabela).select('*').match(filtro), `consultar ${tabela}`)
  if (existentes.length) return existentes[0]
  return exigir(await admin.from(tabela).insert(valores).select('*').single(), `criar ${tabela}`)
}

const profA = await obterOuCriar('profissionais', { nome: 'Teste Profissional A' }, { nome: 'Teste Profissional A', cor: '#7F9877' })
const profB = await obterOuCriar('profissionais', { nome: 'Teste Profissional B' }, { nome: 'Teste Profissional B', cor: '#8B789B' })
for (const p of [profA, profB]) if (!p.ativo) exigir(await admin.from('profissionais').update({ ativo: true }).eq('id', p.id), 'reativar profissional')
const serv60 = await obterOuCriar('servicos', { nome: 'Teste Serviço 60 min' }, { nome: 'Teste Serviço 60 min', duracao_minutos: 60 })
const serv30 = await obterOuCriar('servicos', { nome: 'Teste Serviço 30 min' }, { nome: 'Teste Serviço 30 min', duracao_minutos: 30 })
exigir(await admin.from('servicos').update({ duracao_minutos: 60, ativo: true }).eq('id', serv60.id), 'restaurar serviço 60')
exigir(await admin.from('servicos').update({ ativo: true }).eq('id', serv30.id), 'ativar serviço 30')
const habilitacoes = exigir(await admin.from('profissional_servicos').select('*'), 'habilitações')
for (const [profissional_id, servico_id] of [[profA.id, serv60.id], [profB.id, serv60.id], [profA.id, serv30.id]]) {
  if (!habilitacoes.some(h => h.profissional_id === profissional_id && h.servico_id === servico_id)) {
    exigir(await admin.from('profissional_servicos').insert({ profissional_id, servico_id }), 'habilitar')
  }
}
const jornada = [0, 1, 2, 3, 4, 5, 6].flatMap(dia => [
  { dia_semana: dia, hora_inicio: '08:00', hora_fim: '12:00' },
  { dia_semana: dia, hora_inicio: '13:00', hora_fim: '18:00' },
])
exigir(await admin.rpc('salvar_disponibilidade', { p_profissional_id: profA.id, p_faixas: jornada }), 'jornada A')
exigir(await admin.rpc('salvar_disponibilidade', { p_profissional_id: profB.id, p_faixas: jornada }), 'jornada B')
// Consulta pública: profissional C atende somente de segunda a sexta; um serviço fica sem profissional habilitado.
const profC = await obterOuCriar('profissionais', { nome: 'Teste Profissional C' }, { nome: 'Teste Profissional C', cor: '#6D8FA3' })
if (!profC.ativo) exigir(await admin.from('profissionais').update({ ativo: true }).eq('id', profC.id), 'reativar profissional C')
const servSemProf = await obterOuCriar('servicos', { nome: 'Teste Serviço sem profissional' }, { nome: 'Teste Serviço sem profissional', duracao_minutos: 40 })
for (const servico_id of [serv60.id, serv30.id]) {
  if (!habilitacoes.some(h => h.profissional_id === profC.id && h.servico_id === servico_id)) {
    exigir(await admin.from('profissional_servicos').insert({ profissional_id: profC.id, servico_id }), 'habilitar C')
  }
}
exigir(await admin.rpc('salvar_disponibilidade', { p_profissional_id: profC.id, p_faixas: jornada.filter(f => f.dia_semana >= 1 && f.dia_semana <= 5) }), 'jornada C')
const cliente = await obterOuCriar('clientes', { nome: 'Cliente Teste Integração' }, { nome: 'Cliente Teste Integração', telefone: '(11) 90000-0001' })

// Vincula as contas de profissional pela função gerenciar-usuarios (também testa a função).
const usuarios = exigir(await admin.rpc('listar_usuarios'), 'listar usuários')
const contaProf1 = usuarios.find(u => u.email === emailDe(env.TESTE_PROF1_USUARIO))
const contaProf2 = usuarios.find(u => u.email === emailDe(env.TESTE_PROF2_USUARIO))
for (const [conta, profissional] of [[contaProf1, profA], [contaProf2, profB]]) {
  const { error } = await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: conta.usuario_id, nome: conta.nome, papel: 'profissional', ativo: true, profissional_id: profissional.id } })
  verificar(`Administração vincula ${conta.nome} ao cadastro do profissional (função gerenciar-usuarios)`, !error, error?.message)
}
const negado = await secretaria.functions.invoke('gerenciar-usuarios', { body: { acao: 'redefinir_senha', usuario_id: contaProf1.usuario_id, senha: 'qualquer-coisa-123' } })
verificar('Secretaria não consegue gerenciar usuários', negado.error && negado.error.context?.status === 403, negado.error?.message ?? 'sem erro')

// Data distante e aleatória para não colidir com execuções anteriores.
const base = new Date(Date.UTC(2027, 0, 4))
base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 600))
const D = base.toISOString().slice(0, 10)
console.log(`\nData de teste: ${D}\n`)

const criados = []
const criar = async (quem, { hora, servico = serv60, profissional = profA, id = randomUUID(), data = D }) => {
  const resposta = await quem.rpc('criar_agendamento', { p_id: id, p_cliente_id: cliente.id, p_servico_id: servico.id, p_profissional_id: profissional.id, p_data: data, p_hora: hora })
  if (!resposta.error) criados.push(id)
  return { id, error: resposta.error }
}
const agendaDoDia = async (quem, profissionalId = null) => exigir(await quem.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D, p_profissional_id: profissionalId }), 'listar agenda')
const bloqueiosCriados = []
const datasPublicas = []
const hojeClinica = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const agoraClinica = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
const somarDiasTexto = (data, dias) => { const d = new Date(`${data}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10) }
const diaSemanaTexto = data => new Date(`${data}T12:00:00Z`).getUTCDay()

try {
  // ---------- CA02 ----------
  const r09 = await criar(secretaria, { hora: '09:00' })
  verificar('CA02: secretaria cria reserva válida', !r09.error, r09.error?.message)
  verificar('CA02: reserva aparece na agenda geral', (await agendaDoDia(admin)).some(i => i.id === r09.id))
  const agendaProf1 = await agendaDoDia(prof1)
  verificar('CA02: reserva aparece na agenda do profissional', agendaProf1.some(i => i.id === r09.id))
  const doCliente = exigir(await secretaria.rpc('agendamentos_do_cliente', { p_cliente_id: cliente.id }), 'agendamentos do cliente')
  verificar('CA02: reserva aparece na consulta do cliente', doCliente.some(i => i.id === r09.id))
  verificar('Histórico registra a criação com o responsável', (exigir(await admin.rpc('historico_do_agendamento', { p_id: r09.id }), 'histórico')).some(h => h.acao === 'criado' && h.usuario_nome === 'Secretaria Teste'))

  // ---------- CA05 e RN01 ----------
  const r10 = await criar(admin, { hora: '10:00' })
  verificar('CA05: atendimento começa exatamente no término de outro', !r10.error, r10.error?.message)
  const sobreposto = await criar(admin, { hora: '09:30' })
  verificar('RN01: sobreposição parcial é recusada', sobreposto.error?.code === 'P0001', sobreposto.error?.message)

  // ---------- CA03: concorrência ----------
  const tentativas = await Promise.all([
    ['11:00', admin], ['11:00', secretaria], ['11:15', admin], ['11:15', secretaria], ['11:00', secretaria], ['11:15', admin],
  ].map(([hora, quem]) => criar(quem, { hora, servico: serv30 })))
  const sucessos = tentativas.filter(t => !t.error).length
  verificar(`CA03: 6 tentativas simultâneas sobrepostas resultam em exatamente 1 reserva (obtidas: ${sucessos})`, sucessos === 1)
  const ocupando = (await agendaDoDia(admin, profA.id)).filter(i => ['agendado', 'confirmado', 'chegou', 'em_atendimento'].includes(i.status))
  const conflitos = ocupando.some((a, i) => ocupando.some((b, j) => i < j && a.inicio < b.fim && b.inicio < a.fim))
  verificar('CA03: nenhuma sobreposição gravada na agenda do profissional', !conflitos)

  // ---------- CA04 e RN02 ----------
  const intervalo = await criar(admin, { hora: '11:30' })
  verificar('CA04: reserva que atravessa o intervalo é recusada', intervalo.error?.message?.includes('jornada'), intervalo.error?.message)
  const fimJornada = await criar(admin, { hora: '17:30' })
  verificar('CA04: reserva que passa do fim da jornada é recusada', fimJornada.error?.message?.includes('jornada'), fimJornada.error?.message)
  const bloqueio = await admin.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: D, p_data_fim: D, p_hora_inicio: '15:00', p_hora_fim: '16:00', p_motivo: 'Teste de bloqueio', p_dia_inteiro: false })
  verificar('Administração cria bloqueio', !bloqueio.error, bloqueio.error?.message)
  const noBloqueio = await criar(admin, { hora: '14:30' })
  verificar('CA04: reserva que atravessa um bloqueio é recusada', noBloqueio.error?.message?.includes('bloqueado'), noBloqueio.error?.message)
  const naoHabilitado = await criar(admin, { hora: '14:00', servico: serv30, profissional: profB })
  verificar('RN02: profissional não habilitado para o serviço é recusado', naoHabilitado.error?.message?.includes('habilitado'), naoHabilitado.error?.message)

  // ---------- CA11: idempotência ----------
  const idRepetido = randomUUID()
  const primeira = await criar(secretaria, { hora: '13:00', id: idRepetido })
  const segunda = await secretaria.rpc('criar_agendamento', { p_id: idRepetido, p_cliente_id: cliente.id, p_servico_id: serv60.id, p_profissional_id: profA.id, p_data: D, p_hora: '13:00' })
  const copias = (await agendaDoDia(admin, profA.id)).filter(i => i.hora_inicio === '13:00' && i.status !== 'cancelado').length
  verificar('CA11: reenvio do mesmo pedido não duplica a reserva', !primeira.error && !segunda.error && copias === 1, `${primeira.error?.message ?? ''} ${segunda.error?.message ?? ''} cópias=${copias}`)

  // ---------- RN08 ----------
  const bloqueioSobreReserva = await admin.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: D, p_data_fim: D, p_hora_inicio: '09:00', p_hora_fim: '10:00', p_motivo: 'Teste', p_dia_inteiro: false })
  verificar('RN08: bloqueio sobre reserva existente é recusado e lista a reserva', bloqueioSobreReserva.error?.message?.includes('Cliente Teste'), bloqueioSobreReserva.error?.message)
  const jornadaMenor = await admin.rpc('salvar_disponibilidade', { p_profissional_id: profA.id, p_faixas: jornada.filter(f => f.hora_inicio !== '08:00') })
  const faixasDepois = exigir(await admin.from('disponibilidades').select('id').eq('profissional_id', profA.id).is('removido_em', null), 'faixas')
  verificar('RN08: reduzir a jornada sobre reservas futuras é recusado e nada muda', jornadaMenor.error && faixasDepois.length === 14, jornadaMenor.error?.message)
  const inativar = await admin.from('profissionais').update({ ativo: false }).eq('id', profA.id)
  verificar('Inativar profissional com reservas futuras exige revisão antes', inativar.error?.message?.includes('Reagende ou cancele'), inativar.error?.message)

  // ---------- CA06: reagendamento ----------
  const ocupado = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '10:00', p_profissional_id: profA.id, p_motivo: 'Teste conflito' })
  const r09Depois = (await agendaDoDia(admin, profA.id)).find(i => i.id === r09.id)
  verificar('CA06: reagendar para horário ocupado falha e mantém o horário original', ocupado.error && r09Depois.hora_inicio === '09:00', ocupado.error?.message)
  const semMotivo = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: '' })
  verificar('RN06: reagendamento exige motivo', semMotivo.error?.message?.includes('motivo'), semMotivo.error?.message)
  const reag = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: 'Cliente pediu outro horário' })
  verificar('CA06: reagendamento válido é gravado', !reag.error, reag.error?.message)
  const historico = exigir(await admin.rpc('historico_do_agendamento', { p_id: r09.id }), 'histórico')
  const regReag = historico.find(h => h.acao === 'reagendado')
  verificar('CA06: histórico guarda horário anterior, novo, responsável e motivo',
    regReag?.valores_anteriores?.hora_inicio === '09:00' && regReag?.valores_novos?.hora_inicio === '16:00' && regReag?.motivo === 'Cliente pediu outro horário' && regReag?.usuario_nome === 'Secretaria Teste')
  const novo09 = await criar(admin, { hora: '09:00' })
  verificar('CA06: horário anterior foi liberado após o reagendamento', !novo09.error, novo09.error?.message)
  const duracaoSecretaria = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: 'Teste duração', p_duracao_minutos: 90 })
  verificar('Ajuste de duração é restrito à administração', duracaoSecretaria.error?.message?.includes('administração'), duracaoSecretaria.error?.message)

  // ---------- CA07: cancelamento ----------
  const cancSemMotivo = await secretaria.rpc('cancelar_agendamento', { p_id: r10.id, p_motivo: ' ' })
  verificar('RN07: cancelamento exige motivo', cancSemMotivo.error?.message?.includes('motivo'), cancSemMotivo.error?.message)
  const canc = await secretaria.rpc('cancelar_agendamento', { p_id: r10.id, p_motivo: 'Cliente desistiu' })
  const registro = exigir(await admin.from('agendamentos').select('status, cancelado_por, cancelado_em, motivo_cancelamento').eq('id', r10.id).single(), 'reserva cancelada')
  verificar('CA07: cancelamento preserva o registro com responsável, momento e motivo',
    !canc.error && registro.status === 'cancelado' && registro.cancelado_por === contaSecretaria() && registro.cancelado_em && registro.motivo_cancelamento === 'Cliente desistiu', canc.error?.message)
  const novo10 = await criar(admin, { hora: '10:00' })
  verificar('CA07: cancelamento libera o horário', !novo10.error, novo10.error?.message)

  // ---------- Andamento (RF07) ----------
  const passos = ['confirmado', 'chegou', 'em_atendimento', 'concluido']
  let andamentoOk = true
  for (const status of passos) {
    const { error } = await secretaria.rpc('alterar_status_agendamento', { p_id: novo09.id, p_status: status })
    if (error) { andamentoOk = false; console.log(`   ${status}: ${error.message}`) }
  }
  verificar('RF07: confirmar, chegada, início e conclusão em sequência', andamentoOk)
  const voltar = await secretaria.rpc('alterar_status_agendamento', { p_id: novo09.id, p_status: 'agendado' })
  verificar('Concluído não volta para outro estado', voltar.error?.code === 'P0001', voltar.error?.message)
  const faltaAntes = await secretaria.rpc('alterar_status_agendamento', { p_id: novo10.id, p_status: 'faltou' })
  verificar('Falta só pode ser registrada após o horário previsto', faltaAntes.error?.message?.includes('após o horário'), faltaAntes.error?.message)

  // ---------- CA08 ----------
  exigir(await admin.from('servicos').update({ duracao_minutos: 45 }).eq('id', serv60.id), 'alterar duração')
  const aposMudanca = (await agendaDoDia(admin, profA.id)).find(i => i.id === novo10.id)
  verificar('CA08: alterar a duração do serviço não modifica reservas existentes', aposMudanca.duracao_minutos === 60 && aposMudanca.hora_fim === '11:00')
  exigir(await admin.from('servicos').update({ duracao_minutos: 60 }).eq('id', serv60.id), 'restaurar duração')

  // ---------- CA09: permissões ----------
  const prof1Outro = await agendaDoDia(prof1, profB.id)
  verificar('CA09: profissional não consulta a agenda de outro, mesmo pedindo pelo id', prof1Outro.every(i => i.profissional_id === profA.id) && prof1Outro.length > 0)
  verificar('CA09: profissional não recebe telefone nem observação', prof1Outro.every(i => i.cliente_telefone === null && i.observacao === null))
  const diretoAgendamentos = await prof1.from('agendamentos').select('id')
  const diretoClientes = await prof1.from('clientes').select('id')
  verificar('CA09: profissional não lê agendamentos nem clientes por chamada direta', !diretoAgendamentos.error && diretoAgendamentos.data.length === 0 && diretoClientes.data?.length === 0)
  const prof2Agenda = await agendaDoDia(prof2)
  verificar('CA09: outro profissional vê somente a própria agenda', prof2Agenda.every(i => i.profissional_id === profB.id))
  const profCria = await criar(prof1, { hora: '17:00' })
  verificar('Profissional não cria agendamentos (somente consulta)', profCria.error?.code === '42501', profCria.error?.message)
  const profStatus = await prof1.rpc('alterar_status_agendamento', { p_id: novo10.id, p_status: 'confirmado' })
  verificar('Profissional não altera status (pendente de definição no PRD)', profStatus.error?.code === '42501', profStatus.error?.message)
  const secJornada = await secretaria.rpc('salvar_disponibilidade', { p_profissional_id: profA.id, p_faixas: jornada })
  verificar('Secretaria não altera jornadas', secJornada.error?.code === '42501', secJornada.error?.message)
  const secProf = await secretaria.from('profissionais').update({ nome: 'Invasão' }).eq('id', profA.id).select('id')
  verificar('Secretaria não altera cadastro de profissionais', secProf.data?.length === 0 || secProf.error)
  const secDireto = await secretaria.from('agendamentos').update({ status: 'concluido' }).eq('id', novo10.id).select('id')
  verificar('Gravação direta na tabela de agendamentos é bloqueada', Boolean(secDireto.error), 'atualização direta foi aceita')
  const anon = await anonimo.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D })
  const anonClientes = await anonimo.from('clientes').select('id')
  verificar('Visitante sem login não acessa agenda nem clientes', Boolean(anon.error) && (Boolean(anonClientes.error) || anonClientes.data.length === 0))

  // ================= Níveis de acesso e consulta pública (pedido de 04/10/2026) =================

  // ---------- Secretária: permitido ----------
  const secBloq = await secretaria.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: D, p_data_fim: D, p_hora_inicio: '08:00', p_hora_fim: '08:30', p_motivo: 'Reunião rápida (teste)', p_dia_inteiro: false })
  verificar('Secretária cria bloqueio pontual com motivo', !secBloq.error, secBloq.error?.message)
  const secBloqCurto = await secretaria.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: D, p_data_fim: D, p_hora_inicio: '08:30', p_hora_fim: '08:45', p_motivo: 'x', p_dia_inteiro: false })
  verificar('Bloqueio sem motivo válido é recusado', secBloqCurto.error?.message?.includes('motivo'), secBloqCurto.error?.message)
  const [bloqSec] = exigir(await secretaria.from('bloqueios').select('id').eq('profissional_id', profA.id).eq('motivo', 'Reunião rápida (teste)').is('removido_em', null), 'bloqueio da secretária')
  const remSemMotivo = await secretaria.rpc('remover_bloqueio', { p_id: bloqSec.id, p_motivo: '' })
  verificar('Remover bloqueio exige motivo', remSemMotivo.error?.message?.includes('motivo'), remSemMotivo.error?.message)
  const remAntiga = await secretaria.rpc('remover_bloqueio', { p_id: bloqSec.id })
  verificar('A versão antiga, sem motivo, não é mais chamável', Boolean(remAntiga.error), 'versão antiga aceita')
  const remSec = await secretaria.rpc('remover_bloqueio', { p_id: bloqSec.id, p_motivo: 'Reunião desmarcada (teste)' })
  const regRem = exigir(await admin.from('bloqueios').select('removido_em, removido_por, motivo_remocao').eq('id', bloqSec.id).single(), 'bloqueio removido')
  verificar('Secretária remove bloqueio; o registro guarda responsável, data e motivo', !remSec.error && regRem.removido_por === contaSecretaria() && regRem.motivo_remocao === 'Reunião desmarcada (teste)' && Boolean(regRem.removido_em), remSec.error?.message)
  const histSec = await secretaria.rpc('historico_do_agendamento', { p_id: r09.id })
  verificar('Secretária consulta o histórico dos agendamentos', !histSec.error && histSec.data.length > 0, histSec.error?.message)
  const agendaSec = await agendaDoDia(secretaria)
  verificar('Secretária vê todas as agendas, com telefone do cliente', agendaSec.some(i => i.cliente_telefone))

  // ---------- Secretária: negado ----------
  const secServ = await secretaria.from('servicos').update({ duracao_minutos: 5 }).eq('id', serv60.id).select('id')
  verificar('Secretária não altera serviços nem duração', Boolean(secServ.error) || secServ.data.length === 0)
  const secHab = await secretaria.from('profissional_servicos').insert({ profissional_id: profB.id, servico_id: serv30.id })
  verificar('Secretária não altera vínculos profissional–serviço', Boolean(secHab.error))
  const secExc = await secretaria.rpc('criar_excecao_disponibilidade', { p_profissional_id: profA.id, p_data: D, p_hora_inicio: '19:00', p_hora_fim: '20:00', p_motivo: 'teste' })
  verificar('Secretária não altera horários regulares nem exceções', secExc.error?.code === '42501', secExc.error?.message)
  const secConfig = await secretaria.from('configuracao_clinica').update({ horizonte_publico_dias: 90 }).eq('id', true).select('id')
  verificar('Secretária não altera configurações da clínica', Boolean(secConfig.error) || secConfig.data.length === 0)
  const secAud = await secretaria.rpc('listar_auditoria', {})
  verificar('Secretária não consulta a auditoria geral', secAud.error?.code === '42501', secAud.error?.message)
  const secUsuarios = await secretaria.rpc('listar_usuarios')
  verificar('Secretária não lista nem gerencia usuários', secUsuarios.error?.code === '42501', secUsuarios.error?.message)

  // ---------- Elevação do próprio acesso ----------
  const secElevar = await secretaria.from('perfis').update({ papel: 'admin' }).eq('usuario_id', contaSecretaria()).select('usuario_id')
  verificar('Secretária não eleva o próprio perfil pela tabela', Boolean(secElevar.error) || secElevar.data.length === 0)
  const secFuncao = await secretaria.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: contaSecretaria(), nome: 'Secretaria Teste', papel: 'admin', ativo: true } })
  verificar('Secretária não eleva o próprio perfil pela função de usuários', secFuncao.error?.context?.status === 403)
  const profElevar = await prof1.from('perfis').update({ papel: 'admin' }).eq('usuario_id', contaProf1.usuario_id).select('usuario_id')
  verificar('Profissional não eleva o próprio perfil', Boolean(profElevar.error) || profElevar.data.length === 0)
  exigir(await secretaria.auth.updateUser({ data: { papel: 'admin', role: 'admin' } }), 'metadados')
  await secretaria.auth.refreshSession()
  const metaExc = await secretaria.rpc('criar_excecao_disponibilidade', { p_profissional_id: profA.id, p_data: D, p_hora_inicio: '19:00', p_hora_fim: '20:00', p_motivo: 'teste' })
  verificar('Metadados editáveis pelo usuário não concedem acesso de administração', metaExc.error?.code === '42501', metaExc.error?.message)
  const perfisDepois = exigir(await admin.from('perfis').select('papel').eq('usuario_id', contaSecretaria()).single(), 'perfil da secretária')
  verificar('O perfil da secretária continua "secretaria" no banco', perfisDepois.papel === 'secretaria')

  // ---------- Profissional: negado ----------
  const profHist = await prof1.rpc('historico_do_agendamento', { p_id: r09.id })
  verificar('Profissional não consulta histórico de agendamentos', profHist.error?.code === '42501', profHist.error?.message)
  const profBloq = await prof1.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: D, p_data_fim: D, p_hora_inicio: '08:00', p_hora_fim: '08:30', p_motivo: 'Folga (teste)', p_dia_inteiro: false })
  verificar('Profissional não cria bloqueios', profBloq.error?.code === '42501', profBloq.error?.message)
  const profJornada = await prof1.rpc('salvar_disponibilidade', { p_profissional_id: profA.id, p_faixas: jornada })
  verificar('Profissional não altera a própria disponibilidade', profJornada.error?.code === '42501', profJornada.error?.message)
  const profCliente = await prof1.rpc('agendamentos_do_cliente', { p_cliente_id: cliente.id })
  verificar('Profissional não acessa o histórico geral do cliente', profCliente.error?.code === '42501', profCliente.error?.message)
  const profCancela = await prof1.rpc('cancelar_agendamento', { p_id: novo10.id, p_motivo: 'Tentativa (teste)' })
  const profReag = await prof1.rpc('reagendar_agendamento', { p_id: novo10.id, p_data: D, p_hora: '13:00', p_profissional_id: profA.id, p_motivo: 'Tentativa (teste)' })
  verificar('Profissional não cancela nem remarca', profCancela.error?.code === '42501' && profReag.error?.code === '42501')
  const profAgendaB = await prof1.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D, p_profissional_id: profB.id })
  verificar('Profissional que troca o identificador na chamada continua vendo só a própria agenda', !profAgendaB.error && profAgendaB.data.every(i => i.profissional_id === profA.id))
  const profAud = await prof1.from('auditoria').select('id')
  verificar('Profissional não lê a auditoria', Boolean(profAud.error) || profAud.data.length === 0)

  // ---------- Administração vinculada ao próprio cadastro de profissional ----------
  const contaAdmin = usuarios.find(u => u.email === emailDe(env.TESTE_ADMIN_USUARIO))
  const vinculoAdmin = await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: contaAdmin.usuario_id, nome: contaAdmin.nome, papel: 'admin', ativo: true, profissional_id: profC.id } })
  const usuariosDepois = exigir(await admin.rpc('listar_usuarios'), 'listar usuários')
  const adminDepois = usuariosDepois.find(u => u.usuario_id === contaAdmin.usuario_id)
  verificar('Administradora que também atende fica vinculada ao próprio cadastro, com uma só conta', !vinculoAdmin.error && adminDepois.profissional_id === profC.id && adminDepois.papel === 'admin', vinculoAdmin.error?.message)
  verificar('O vínculo não reduz o acesso: a administração continua vendo todas as agendas', (await agendaDoDia(admin)).some(i => i.profissional_id === profA.id))

  // ---------- Usuário desativado perde o acesso ----------
  const nomeTemp = 'teste.desativado'
  const senhaTemp = `Tmp-${Math.random().toString(36).slice(2, 10)}A1`
  let contaTemp = usuariosDepois.find(u => u.email === emailDe(nomeTemp))
  if (!contaTemp) {
    const criado = await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'criar', usuario: nomeTemp, nome: 'Usuário Teste Desativação', papel: 'secretaria', senha: senhaTemp } })
    contaTemp = { usuario_id: criado.data?.usuario_id }
  } else {
    await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: contaTemp.usuario_id, nome: 'Usuário Teste Desativação', papel: 'secretaria', ativo: true } })
    await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'redefinir_senha', usuario_id: contaTemp.usuario_id, senha: senhaTemp } })
  }
  const temp = await entrar(nomeTemp, senhaTemp)
  const antesDesativar = await temp.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D })
  const desativar = await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: contaTemp.usuario_id, nome: 'Usuário Teste Desativação', papel: 'secretaria', ativo: false } })
  const depoisDesativar = await temp.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D })
  const novoLogin = await novoCliente().auth.signInWithPassword({ email: emailDe(nomeTemp), password: senhaTemp })
  verificar('Usuário desativado perde as operações protegidas, mesmo com a sessão aberta', !antesDesativar.error && !desativar.error && depoisDesativar.error?.code === '42501', depoisDesativar.error?.message)
  verificar('Usuário desativado não consegue entrar de novo', Boolean(novoLogin.error), 'login aceito')

  // ---------- Último administrador ----------
  const autoDesativar = await admin.functions.invoke('gerenciar-usuarios', { body: { acao: 'atualizar', usuario_id: contaAdmin.usuario_id, nome: contaAdmin.nome, papel: 'admin', ativo: false, profissional_id: profC.id } })
  const msgAuto = autoDesativar.error ? await autoDesativar.error.context.json().then(j => j.erro).catch(() => '') : ''
  verificar('Administração não remove o próprio acesso', Boolean(autoDesativar.error) && /próprio acesso/.test(msgAuto), msgAuto)

  // ---------- Auditoria ----------
  const auditoria = exigir(await admin.rpc('listar_auditoria', { p_limite: 200 }), 'auditoria')
  verificar('Auditoria registra a remoção do bloqueio com o autor', auditoria.some(a => a.tabela === 'bloqueios' && a.registro_id === bloqSec.id && a.operacao === 'update' && a.usuario_nome === 'Secretaria Teste'))
  verificar('Auditoria registra alterações de perfis feitas pela função de usuários com o autor', auditoria.some(a => a.tabela === 'perfis' && a.usuario_nome === 'Admin Teste'))
  verificar('Auditoria registra o vínculo de profissional com o autor', auditoria.some(a => a.tabela === 'profissionais' && a.registro_id === profC.id && a.usuario_nome === 'Admin Teste'))
  const audApagar = await admin.from('auditoria').delete().gt('id', 0).select('id')
  const audAlterar = await admin.from('auditoria').update({ operacao: 'insert' }).gt('id', 0).select('id')
  const histApagar = await admin.from('historico_agendamentos').delete().eq('agendamento_id', r09.id).select('id')
  verificar('Nenhum perfil edita ou apaga auditoria e histórico pela aplicação', Boolean(audApagar.error) && Boolean(audAlterar.error) && Boolean(histApagar.error))

  // ---------- Visitante (consulta pública sem login) ----------
  const pubServicos = await anonimo.rpc('servicos_publicos')
  verificar('Visitante lista serviços ativos', !pubServicos.error && pubServicos.data.some(s => s.id === serv60.id), pubServicos.error?.message)
  verificar('Serviço ativo sem profissional habilitado aparece (a página mostra o aviso de falta de profissionais)', pubServicos.data?.some(s => s.id === servSemProf.id))
  verificar('Serviços públicos trazem somente id, nome, duração, categoria e descrição', pubServicos.data?.every(s => Object.keys(s).sort().join() === 'categoria,descricao,duracao_minutos,id,nome'))
  const pubProf = await anonimo.rpc('profissionais_publicos', { p_servico_id: serv60.id })
  verificar('Visitante vê só profissionais ativos vinculados ao serviço, com id e nome', !pubProf.error && pubProf.data.some(p => p.id === profC.id) && pubProf.data.every(p => Object.keys(p).sort().join() === 'id,nome'), pubProf.error?.message)
  const pubSemProf = await anonimo.rpc('profissionais_publicos', { p_servico_id: servSemProf.id })
  const horSemProf = await anonimo.rpc('horarios_disponiveis', { p_servico_id: servSemProf.id, p_profissional_id: profC.id, p_data_inicio: hojeClinica(), p_data_fim: hojeClinica() })
  verificar('Serviço sem profissional: nenhuma profissional e consulta de horários recusada', !pubSemProf.error && pubSemProf.data.length === 0 && Boolean(horSemProf.error))
  const horNaoHabilitado = await anonimo.rpc('horarios_disponiveis', { p_servico_id: serv30.id, p_profissional_id: profB.id, p_data_inicio: hojeClinica(), p_data_fim: hojeClinica() })
  verificar('Profissional não vinculado ao serviço é recusado na consulta', Boolean(horNaoHabilitado.error))

  // Inativos não aparecem para o visitante (e voltam ao reativar).
  exigir(await admin.from('servicos').update({ ativo: false }).eq('id', servSemProf.id), 'inativar serviço')
  const semInativo = exigir(await anonimo.rpc('servicos_publicos'), 'serviços sem o inativo')
  exigir(await admin.from('servicos').update({ ativo: true }).eq('id', servSemProf.id), 'reativar serviço')
  verificar('Serviço inativo não aparece para o visitante', !semInativo.some(s => s.id === servSemProf.id))
  const inativarB = await admin.from('profissionais').update({ ativo: false }).eq('id', profB.id)
  const profsSemB = exigir(await anonimo.rpc('profissionais_publicos', { p_servico_id: serv60.id }), 'profissionais sem B')
  const horariosB = await anonimo.rpc('horarios_disponiveis', { p_servico_id: serv60.id, p_profissional_id: profB.id, p_data_inicio: hojeClinica(), p_data_fim: hojeClinica() })
  exigir(await admin.from('profissionais').update({ ativo: true }).eq('id', profB.id), 'reativar profissional B')
  verificar('Profissional inativo não aparece e não tem horários consultáveis', !inativarB.error && !profsSemB.some(p => p.id === profB.id) && Boolean(horariosB.error), inativarB.error?.message)
  const contato = exigir(await anonimo.rpc('configuracao_publica'), 'contato público')[0]
  verificar('Contato público traz somente WhatsApp, horizonte e fuso', Object.keys(contato).sort().join() === 'fuso_horario,horizonte_dias,whatsapp')

  // Próximo dia útil (2 a 8 dias à frente) e próximo sábado, dentro do horizonte.
  let Dp = somarDiasTexto(hojeClinica(), 2)
  while ([0, 6].includes(diaSemanaTexto(Dp))) Dp = somarDiasTexto(Dp, 1)
  let sabado = somarDiasTexto(hojeClinica(), 1)
  while (diaSemanaTexto(sabado) !== 6) sabado = somarDiasTexto(sabado, 1)
  datasPublicas.push(Dp)
  const horarios = async (servico, dia = Dp) => exigir(await anonimo.rpc('horarios_disponiveis', { p_servico_id: servico.id, p_profissional_id: profC.id, p_data_inicio: dia, p_data_fim: dia }), 'horários públicos')
  const livres60 = await horarios(serv60)
  verificar('Horários retornam somente dia e horário', livres60.every(h => Object.keys(h).sort().join() === 'dia,horario'))
  verificar('Horários encaixados pela duração do serviço (08:00, 09:00 … 17:00)', livres60.map(h => h.horario).join() === '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00,17:00', livres60.map(h => h.horario).join())
  verificar('Atendimento que ultrapassaria o expediente ou o intervalo não é oferecido', !livres60.some(h => ['11:30', '12:00', '17:30'].includes(h.horario)))
  const livresSabado = await horarios(serv60, sabado)
  verificar('Dia sem jornada não oferece horários', livresSabado.length === 0, livresSabado.map(h => h.horario).join())
  const livresHoje = exigir(await anonimo.rpc('horarios_disponiveis', { p_servico_id: serv60.id, p_profissional_id: profC.id, p_data_inicio: hojeClinica(), p_data_fim: hojeClinica() }), 'horários de hoje')
  verificar('Horários passados não são apresentados', livresHoje.every(h => h.horario > agoraClinica()))
  const longe = exigir(await anonimo.rpc('horarios_disponiveis', { p_servico_id: serv60.id, p_profissional_id: profC.id, p_data_inicio: somarDiasTexto(hojeClinica(), 40), p_data_fim: somarDiasTexto(hojeClinica(), 45) }), 'além do horizonte')
  verificar('Datas além do horizonte configurado não são consultáveis', longe.length === 0)

  // Bloqueio retira o período sem revelar o motivo.
  exigir(await admin.rpc('criar_bloqueio', { p_profissional_id: profC.id, p_data_inicio: Dp, p_data_fim: Dp, p_hora_inicio: '10:00', p_hora_fim: '11:00', p_motivo: 'Motivo privado (teste)', p_dia_inteiro: false }), 'bloqueio C')
  const comBloqueio = await horarios(serv60)
  verificar('Bloqueio retira o horário da consulta pública', !comBloqueio.some(h => h.horario === '10:00') && comBloqueio.some(h => h.horario === '11:00'), comBloqueio.map(h => h.horario).join())
  verificar('A consulta pública não contém o motivo do bloqueio', !JSON.stringify(comBloqueio).includes('Motivo privado'))
  const [bloqC] = exigir(await admin.from('bloqueios').select('id').eq('profissional_id', profC.id).eq('motivo', 'Motivo privado (teste)').is('removido_em', null), 'bloqueio C')
  exigir(await admin.rpc('remover_bloqueio', { p_id: bloqC.id, p_motivo: 'Fim do teste de bloqueio' }), 'remover bloqueio C')

  // Horário ocupado depois da consulta inicial: a nova consulta (feita antes de abrir o WhatsApp) não o oferece mais.
  const consultaInicial = (await horarios(serv60)).map(h => h.horario)
  const ocupadoDepois = randomUUID()
  exigir(await secretaria.rpc('criar_agendamento', { p_id: ocupadoDepois, p_cliente_id: cliente.id, p_servico_id: serv60.id, p_profissional_id: profC.id, p_data: Dp, p_hora: '14:00' }), 'reserva 14h')
  const novaConsulta = (await horarios(serv60)).map(h => h.horario)
  verificar('Horário ocupado após a consulta inicial deixa de ser oferecido na nova consulta', consultaInicial.includes('14:00') && !novaConsulta.includes('14:00'))
  exigir(await secretaria.rpc('cancelar_agendamento', { p_id: ocupadoDepois, p_motivo: 'Fim do teste de reconsulta' }), 'cancelar 14h')

  // Reserva pendente e confirmada ocupam; cancelamento libera.
  const reservaC = randomUUID()
  exigir(await admin.rpc('criar_agendamento', { p_id: reservaC, p_cliente_id: cliente.id, p_servico_id: serv60.id, p_profissional_id: profC.id, p_data: Dp, p_hora: '09:00' }), 'reserva C')
  const comPendente = (await horarios(serv60)).map(h => h.horario)
  exigir(await admin.rpc('alterar_status_agendamento', { p_id: reservaC, p_status: 'confirmado' }), 'confirmar C')
  const comConfirmada = (await horarios(serv60)).map(h => h.horario)
  verificar('Reserva pendente (agendado) ocupa o horário', !comPendente.includes('09:00'))
  verificar('Reserva confirmada ocupa o horário', !comConfirmada.includes('09:00'))
  const livres30 = (await horarios(serv30)).map(h => h.horario)
  verificar('Serviço de 30 min não se sobrepõe à reserva das 09:00', !livres30.some(h => h >= '09:00' && h < '10:00'), livres30.join())
  exigir(await admin.rpc('cancelar_agendamento', { p_id: reservaC, p_motivo: 'Teste de liberação' }), 'cancelar C')
  verificar('Cancelamento libera o horário na consulta pública', (await horarios(serv60)).map(h => h.horario).includes('09:00'))

  // Visitante não lê dados privados nem grava.
  const leiturasVisitante = await Promise.all([
    anonimo.from('clientes').select('id'), anonimo.from('agendamentos').select('id'), anonimo.from('bloqueios').select('motivo'),
    anonimo.from('perfis').select('papel'), anonimo.from('historico_agendamentos').select('id'), anonimo.from('auditoria').select('id'),
    anonimo.from('configuracao_clinica').select('*'), anonimo.from('profissionais').select('telefone'),
    anonimo.rpc('listar_agenda', { p_data_inicio: Dp, p_data_fim: Dp }), anonimo.rpc('agendamentos_do_cliente', { p_cliente_id: cliente.id }),
    anonimo.rpc('historico_do_agendamento', { p_id: r09.id }), anonimo.rpc('listar_auditoria', {}), anonimo.rpc('listar_usuarios'),
  ])
  verificar('Visitante não consulta clientes, agendamentos, bloqueios, perfis, histórico, auditoria nem configurações', leiturasVisitante.every(r => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0)))
  const gravacoes = await Promise.all([
    anonimo.rpc('criar_agendamento', { p_id: randomUUID(), p_cliente_id: cliente.id, p_servico_id: serv60.id, p_profissional_id: profC.id, p_data: Dp, p_hora: '10:00' }),
    anonimo.from('clientes').insert({ nome: 'Visitante', telefone: '(11) 90000-0000' }),
    anonimo.rpc('criar_bloqueio', { p_profissional_id: profC.id, p_data_inicio: Dp, p_data_fim: Dp, p_hora_inicio: '10:00', p_hora_fim: '11:00', p_motivo: 'Visitante', p_dia_inteiro: false }),
    anonimo.from('configuracao_clinica').update({ horizonte_publico_dias: 90 }).eq('id', true),
  ])
  verificar('Visitante não cria reservas nem altera o sistema', gravacoes.every(r => Boolean(r.error)))
} finally {
  // ---------- Limpeza ----------
  const ativos = (await agendaDoDia(admin)).filter(i => ['agendado', 'confirmado', 'chegou'].includes(i.status))
  for (const item of ativos) await admin.rpc('cancelar_agendamento', { p_id: item.id, p_motivo: 'Limpeza do teste de integração' })
  const bloqueios = exigir(await admin.from('bloqueios').select('id').eq('profissional_id', profA.id).is('removido_em', null), 'bloqueios')
  for (const b of bloqueios) await admin.rpc('remover_bloqueio', { p_id: b.id, p_motivo: 'Limpeza do teste de integração' })
  for (const dia of datasPublicas) {
    const doDia = exigir(await admin.rpc('listar_agenda', { p_data_inicio: dia, p_data_fim: dia, p_profissional_id: profC.id }), 'agenda C')
    for (const item of doDia.filter(i => ['agendado', 'confirmado', 'chegou'].includes(i.status))) await admin.rpc('cancelar_agendamento', { p_id: item.id, p_motivo: 'Limpeza do teste de integração' })
  }
  await secretaria.auth.updateUser({ data: { papel: null, role: null } })
  bloqueiosCriados.length = 0
}

function contaSecretaria() { return usuarios.find(u => u.email === emailDe(env.TESTE_SECRETARIA_USUARIO))?.usuario_id }

const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações passaram.`)
process.exitCode = falhas.length ? 1 : 0

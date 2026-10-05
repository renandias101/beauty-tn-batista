// Teste de integração contra o banco de desenvolvimento, com as contas de .env.test.local.
// Cobre os critérios de aceite que dependem do servidor (CA02–CA09, CA11), as regras RN01–RN09 e a operação da agenda
// (migração 011: conflito da cliente, versão, horário passado, preparação, duração por profissional, recursos,
// correção de status, comunicações e lista de espera), inclusive gravações simultâneas reais.
// Requer a migração 011 aplicada. Nenhuma mensagem real é enviada: comunicações são apenas registros.
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
const novoAgendamento = ({ id, cli = cliente, servico = serv60, profissional = profA, data = D, hora, justificativa = null, espera = null }) => ({
  p_id: id, p_cliente_id: cli.id, p_servico_id: servico.id, p_profissional_id: profissional.id, p_data: data, p_hora: hora,
  p_observacao: null, p_encaixe: false, p_justificativa_conflito: justificativa, p_lista_espera_id: espera,
})
const versao = async id => exigir(await admin.from('agendamentos').select('versao').eq('id', id).single(), 'versão').versao
const criar = async (quem, { hora, servico = serv60, profissional = profA, id = randomUUID(), data = D, cli = cliente, justificativa = null, espera = null }) => {
  const resposta = await quem.rpc('criar_agendamento', novoAgendamento({ id, cli, servico, profissional, data, hora, justificativa, espera }))
  if (!resposta.error) criados.push(id)
  return { id, error: resposta.error }
}
const agendaDoDia = async (quem, profissionalId = null) => exigir(await quem.rpc('listar_agenda', { p_data_inicio: D, p_data_fim: D, p_profissional_id: profissionalId }), 'listar agenda')
const agendaDoDiaEm = async (quem, data) => exigir(await quem.rpc('listar_agenda', { p_data_inicio: data, p_data_fim: data }), 'listar agenda')
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
  const segunda = await secretaria.rpc('criar_agendamento', novoAgendamento({ id: idRepetido, hora: '13:00' }))
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
  const ocupado = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '10:00', p_profissional_id: profA.id, p_motivo: 'Teste conflito', p_duracao_minutos: null, p_versao: await versao(r09.id), p_justificativa_conflito: null })
  const r09Depois = (await agendaDoDia(admin, profA.id)).find(i => i.id === r09.id)
  verificar('CA06: reagendar para horário ocupado falha e mantém o horário original', ocupado.error && r09Depois.hora_inicio === '09:00', ocupado.error?.message)
  const semMotivo = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: '', p_duracao_minutos: null, p_versao: await versao(r09.id), p_justificativa_conflito: null })
  verificar('RN06: reagendamento exige motivo', semMotivo.error?.message?.includes('motivo'), semMotivo.error?.message)
  const reag = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: 'Cliente pediu outro horário', p_duracao_minutos: null, p_versao: await versao(r09.id), p_justificativa_conflito: null })
  verificar('CA06: reagendamento válido é gravado', !reag.error, reag.error?.message)
  const historico = exigir(await admin.rpc('historico_do_agendamento', { p_id: r09.id }), 'histórico')
  const regReag = historico.find(h => h.acao === 'reagendado')
  verificar('CA06: histórico guarda horário anterior, novo, responsável e motivo',
    regReag?.valores_anteriores?.hora_inicio === '09:00' && regReag?.valores_novos?.hora_inicio === '16:00' && regReag?.motivo === 'Cliente pediu outro horário' && regReag?.usuario_nome === 'Secretaria Teste')
  const novo09 = await criar(admin, { hora: '09:00' })
  verificar('CA06: horário anterior foi liberado após o reagendamento', !novo09.error, novo09.error?.message)
  const duracaoSecretaria = await secretaria.rpc('reagendar_agendamento', { p_id: r09.id, p_data: D, p_hora: '16:00', p_profissional_id: profA.id, p_motivo: 'Teste duração', p_duracao_minutos: 90, p_versao: await versao(r09.id), p_justificativa_conflito: null })
  verificar('Ajuste de duração é restrito à administração', duracaoSecretaria.error?.message?.includes('administração'), duracaoSecretaria.error?.message)

  // ---------- CA07: cancelamento ----------
  const cancSemMotivo = await secretaria.rpc('cancelar_agendamento', { p_id: r10.id, p_motivo: ' ', p_versao: await versao(r10.id) })
  verificar('RN07: cancelamento exige motivo', cancSemMotivo.error?.message?.includes('motivo'), cancSemMotivo.error?.message)
  const canc = await secretaria.rpc('cancelar_agendamento', { p_id: r10.id, p_motivo: 'Cliente desistiu', p_versao: await versao(r10.id) })
  const registro = exigir(await admin.from('agendamentos').select('status, cancelado_por, cancelado_em, motivo_cancelamento').eq('id', r10.id).single(), 'reserva cancelada')
  verificar('CA07: cancelamento preserva o registro com responsável, momento e motivo',
    !canc.error && registro.status === 'cancelado' && registro.cancelado_por === contaSecretaria() && registro.cancelado_em && registro.motivo_cancelamento === 'Cliente desistiu', canc.error?.message)
  const novo10 = await criar(admin, { hora: '10:00' })
  verificar('CA07: cancelamento libera o horário', !novo10.error, novo10.error?.message)

  // ---------- Andamento (RF07) ----------
  const passos = ['confirmado', 'chegou', 'em_atendimento', 'concluido']
  let andamentoOk = true
  for (const status of passos) {
    const { error } = await secretaria.rpc('alterar_status_agendamento', { p_id: novo09.id, p_status: status, p_versao: await versao(novo09.id) })
    if (error) { andamentoOk = false; console.log(`   ${status}: ${error.message}`) }
  }
  verificar('RF07: confirmar, chegada, início e conclusão em sequência', andamentoOk)
  const voltar = await secretaria.rpc('alterar_status_agendamento', { p_id: novo09.id, p_status: 'agendado', p_versao: await versao(novo09.id) })
  verificar('Concluído não volta para outro estado', voltar.error?.code === 'P0001', voltar.error?.message)
  const faltaAntes = await secretaria.rpc('alterar_status_agendamento', { p_id: novo10.id, p_status: 'faltou', p_versao: await versao(novo10.id) })
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
  const profStatus = await prof1.rpc('alterar_status_agendamento', { p_id: novo10.id, p_status: 'confirmado', p_versao: await versao(novo10.id) })
  verificar('Profissional não altera status', profStatus.error?.code === '42501', profStatus.error?.message)
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
  const profCancela = await prof1.rpc('cancelar_agendamento', { p_id: novo10.id, p_motivo: 'Tentativa (teste)', p_versao: await versao(novo10.id) })
  const profReag = await prof1.rpc('reagendar_agendamento', { p_id: novo10.id, p_data: D, p_hora: '13:00', p_profissional_id: profA.id, p_motivo: 'Tentativa (teste)', p_duracao_minutos: null, p_versao: await versao(novo10.id), p_justificativa_conflito: null })
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
  exigir(await secretaria.rpc('criar_agendamento', novoAgendamento({ id: ocupadoDepois, profissional: profC, data: Dp, hora: '14:00' })), 'reserva 14h')
  const novaConsulta = (await horarios(serv60)).map(h => h.horario)
  verificar('Horário ocupado após a consulta inicial deixa de ser oferecido na nova consulta', consultaInicial.includes('14:00') && !novaConsulta.includes('14:00'))
  exigir(await secretaria.rpc('cancelar_agendamento', { p_id: ocupadoDepois, p_motivo: 'Fim do teste de reconsulta', p_versao: await versao(ocupadoDepois) }), 'cancelar 14h')

  // Reserva pendente e confirmada ocupam; cancelamento libera.
  const reservaC = randomUUID()
  exigir(await admin.rpc('criar_agendamento', novoAgendamento({ id: reservaC, profissional: profC, data: Dp, hora: '09:00' })), 'reserva C')
  const comPendente = (await horarios(serv60)).map(h => h.horario)
  exigir(await admin.rpc('alterar_status_agendamento', { p_id: reservaC, p_status: 'confirmado', p_versao: await versao(reservaC) }), 'confirmar C')
  const comConfirmada = (await horarios(serv60)).map(h => h.horario)
  verificar('Reserva pendente (agendado) ocupa o horário', !comPendente.includes('09:00'))
  verificar('Reserva confirmada ocupa o horário', !comConfirmada.includes('09:00'))
  const livres30 = (await horarios(serv30)).map(h => h.horario)
  verificar('Serviço de 30 min não se sobrepõe à reserva das 09:00', !livres30.some(h => h >= '09:00' && h < '10:00'), livres30.join())
  exigir(await admin.rpc('cancelar_agendamento', { p_id: reservaC, p_motivo: 'Teste de liberação', p_versao: await versao(reservaC) }), 'cancelar C')
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
    anonimo.rpc('criar_agendamento', novoAgendamento({ id: randomUUID(), profissional: profC, data: Dp, hora: '10:00' })),
    anonimo.from('clientes').insert({ nome: 'Visitante', telefone: '(11) 90000-0000' }),
    anonimo.rpc('criar_bloqueio', { p_profissional_id: profC.id, p_data_inicio: Dp, p_data_fim: Dp, p_hora_inicio: '10:00', p_hora_fim: '11:00', p_motivo: 'Visitante', p_dia_inteiro: false }),
    anonimo.from('configuracao_clinica').update({ horizonte_publico_dias: 90 }).eq('id', true),
  ])
  verificar('Visitante não cria reservas nem altera o sistema', gravacoes.every(r => Boolean(r.error)))
  // ================= Operação da agenda (migração 011) =================
  const cliente2 = await obterOuCriar('clientes', { nome: 'Cliente Teste Integração 2' }, { nome: 'Cliente Teste Integração 2', telefone: '(11) 90000-0002' })
  const cliente3 = await obterOuCriar('clientes', { nome: 'Cliente Teste Integração 3' }, { nome: 'Cliente Teste Integração 3', telefone: '(11) 90000-0003' })
  const D2 = somarDiasTexto(D, 1)

  // Assinaturas antigas (sem as novas validações) não são chamáveis.
  const antiga = await secretaria.rpc('criar_agendamento', { p_id: randomUUID(), p_cliente_id: cliente.id, p_servico_id: serv60.id, p_profissional_id: profA.id, p_data: D2, p_hora: '08:00' })
  const antigaStatus = await secretaria.rpc('alterar_status_agendamento', { p_id: novo10.id, p_status: 'confirmado' })
  verificar('Assinaturas antigas de criação e status não são chamáveis', Boolean(antiga.error) && Boolean(antigaStatus.error), `${antiga.error?.message ?? 'aceita'} / ${antigaStatus.error?.message ?? 'aceita'}`)

  // Conflito da cliente com profissionais diferentes, inclusive em gravações simultâneas reais.
  const base8 = await criar(secretaria, { hora: '08:00', data: D2, cli: cliente2 })
  const conflitoCli = await criar(secretaria, { hora: '08:30', data: D2, cli: cliente2, profissional: profB })
  verificar('Mesma cliente com outro profissional no mesmo período é recusada', conflitoCli.error?.hint === 'conflito_cliente' && /Teste Profissional A/.test(conflitoCli.error.message), conflitoCli.error?.message)
  const secJust = await criar(secretaria, { hora: '08:30', data: D2, cli: cliente2, profissional: profB, justificativa: 'Tentativa de contornar' })
  verificar('Secretaria não contorna o conflito enviando justificativa pela API', secJust.error?.hint === 'conflito_cliente', secJust.error?.message)
  const admExc = await criar(admin, { hora: '08:30', data: D2, cli: cliente2, profissional: profB, justificativa: 'Atendimento em dupla (teste)' })
  const histExc = admExc.error ? [] : exigir(await admin.rpc('historico_do_agendamento', { p_id: admExc.id }), 'histórico exceção')
  verificar('Administração autoriza a exceção com justificativa registrada no histórico', !admExc.error && histExc.some(h => h.motivo?.includes('Atendimento em dupla')), admExc.error?.message)
  const simultaneasCli = await Promise.all([
    criar(secretaria, { hora: '13:00', data: D2, cli: cliente3, profissional: profA }),
    criar(admin, { hora: '13:00', data: D2, cli: cliente3, profissional: profB }),
  ])
  verificar(`Gravações simultâneas da mesma cliente com profissionais diferentes resultam em 1 reserva (obtidas: ${simultaneasCli.filter(r => !r.error).length})`, simultaneasCli.filter(r => !r.error).length === 1)

  // Horário passado pela API.
  const ontem = somarDiasTexto(hojeClinica(), -1)
  const passadoCria = await criar(secretaria, { hora: '09:00', data: ontem, cli: cliente3 })
  const passadoReag = await secretaria.rpc('reagendar_agendamento', { p_id: base8.id, p_data: ontem, p_hora: '09:00', p_profissional_id: profA.id, p_motivo: 'Teste passado', p_duracao_minutos: null, p_versao: await versao(base8.id), p_justificativa_conflito: null })
  verificar('Criação e reagendamento no passado são recusados pela API', /já passou/.test(passadoCria.error?.message ?? '') && /já passou/.test(passadoReag.error?.message ?? ''), `${passadoCria.error?.message} / ${passadoReag.error?.message}`)

  // Controle de versão entre duas sessões.
  const vAberta = await versao(base8.id)
  const sessao1 = await secretaria.rpc('editar_agendamento', { p_id: base8.id, p_observacao: 'Sessão 1 (teste)', p_encaixe: false, p_versao: vAberta })
  const sessao2 = await admin.rpc('editar_agendamento', { p_id: base8.id, p_observacao: 'Sessão 2 com dados antigos', p_encaixe: false, p_versao: vAberta })
  const obsFinal = exigir(await admin.from('agendamentos').select('observacao').eq('id', base8.id).single(), 'observação').observacao
  verificar('Gravação com versão antiga é recusada e a alteração recente é preservada', !sessao1.error && sessao2.error?.hint === 'versao_desatualizada' && obsFinal === 'Sessão 1 (teste)', sessao2.error?.message)

  // Conclusão antecipada não libera o período.
  const ocupadoAposConclusao = await criar(secretaria, { hora: '09:30', servico: serv30, cli: cliente3 })
  verificar('Período de atendimento concluído antes do fim continua ocupado', /período/.test(ocupadoAposConclusao.error?.message ?? ''), ocupadoAposConclusao.error?.message)

  // Correção de status.
  const secCorrige = await secretaria.rpc('corrigir_status_agendamento', { p_id: novo09.id, p_status: 'em_atendimento', p_justificativa: 'Teste', p_versao: await versao(novo09.id) })
  const profCorrige = await prof1.rpc('corrigir_status_agendamento', { p_id: novo09.id, p_status: 'em_atendimento', p_justificativa: 'Teste', p_versao: await versao(novo09.id) })
  verificar('Secretaria e profissional não corrigem status', secCorrige.error?.code === '42501' && profCorrige.error?.code === '42501')
  const corrige = await admin.rpc('corrigir_status_agendamento', { p_id: novo09.id, p_status: 'em_atendimento', p_justificativa: 'Concluído por engano (teste)', p_versao: await versao(novo09.id) })
  const histCorr = exigir(await admin.rpc('historico_do_agendamento', { p_id: novo09.id }), 'histórico').find(h => h.acao === 'status_corrigido')
  verificar('Administração corrige status com justificativa e histórico', !corrige.error && histCorr?.valores_anteriores?.status === 'concluido' && histCorr?.valores_novos?.status === 'em_atendimento' && histCorr?.usuario_nome === 'Admin Teste', corrige.error?.message)
  exigir(await admin.rpc('corrigir_status_agendamento', { p_id: novo09.id, p_status: 'concluido', p_justificativa: 'Retorna ao concluído (teste)', p_versao: await versao(novo09.id) }), 'restaurar concluído')
  const voltaOcupar = await admin.rpc('corrigir_status_agendamento', { p_id: r10.id, p_status: 'agendado', p_justificativa: 'Cancelado por engano (teste)', p_versao: await versao(r10.id) })
  verificar('Correção que voltaria a ocupar vaga já comprometida é recusada', /período/.test(voltaOcupar.error?.message ?? ''), voltaOcupar.error?.message)

  // Preparação e duração por profissional.
  const servPrep = await obterOuCriar('servicos', { nome: 'Teste Serviço com preparação' }, { nome: 'Teste Serviço com preparação', duracao_minutos: 60, preparacao_minutos: 15 })
  exigir(await admin.from('servicos').update({ duracao_minutos: 60, preparacao_minutos: 15, ativo: true }).eq('id', servPrep.id), 'serviço com preparação')
  const habPrep = exigir(await admin.from('profissional_servicos').select('profissional_id').eq('servico_id', servPrep.id), 'habilitação preparação')
  for (const p of [profA, profB]) if (!habPrep.some(h => h.profissional_id === p.id)) exigir(await admin.from('profissional_servicos').insert({ profissional_id: p.id, servico_id: servPrep.id }), 'habilitar preparação')
  const comPrep = await criar(secretaria, { hora: '15:00', data: D2, servico: servPrep, cli: cliente3, profissional: profB })
  const naPrep = await criar(secretaria, { hora: '16:00', data: D2, cli: cliente2, profissional: profB })
  verificar('A preparação ocupa a agenda do profissional após o atendimento', !comPrep.error && /preparação/.test(naPrep.error?.message ?? ''), comPrep.error?.message ?? naPrep.error?.message)
  const secDuracao = await secretaria.from('profissional_servicos').update({ duracao_minutos: 90 }).eq('profissional_id', profB.id).eq('servico_id', serv60.id).select('servico_id')
  verificar('Secretaria não altera a duração por profissional', Boolean(secDuracao.error) || secDuracao.data.length === 0)
  exigir(await admin.from('profissional_servicos').update({ duracao_minutos: 90 }).eq('profissional_id', profB.id).eq('servico_id', serv60.id), 'duração específica')
  const dur90 = await criar(secretaria, { hora: '09:00', data: somarDiasTexto(D, 2), profissional: profB })
  const durGravada = dur90.error ? null : exigir(await admin.from('agendamentos').select('duracao_minutos, preparacao_minutos').eq('id', dur90.id).single(), 'duração gravada')
  exigir(await admin.from('profissional_servicos').update({ duracao_minutos: null }).eq('profissional_id', profB.id).eq('servico_id', serv60.id), 'restaurar duração')
  const durDepois = dur90.error ? null : exigir(await admin.from('agendamentos').select('duracao_minutos').eq('id', dur90.id).single(), 'duração depois')
  verificar('Reserva usa e preserva a duração específica do profissional', durGravada?.duracao_minutos === 90 && durDepois?.duracao_minutos === 90, dur90.error?.message)

  // Recursos compartilhados com gravações simultâneas reais.
  const sala = await obterOuCriar('recursos', { nome: 'Teste Sala Integração' }, { nome: 'Teste Sala Integração', capacidade: 1 })
  exigir(await admin.from('recursos').update({ ativo: true, capacidade: 1 }).eq('id', sala.id), 'ativar sala')
  // O vínculo é desfeito na limpeza; reservas anteriores ao vínculo não reservam a sala (recursos gravados na criação).
  const vinculoSala = exigir(await admin.from('servico_recursos').select('servico_id').eq('servico_id', serv60.id).eq('recurso_id', sala.id), 'vínculo sala')
  if (!vinculoSala.length) exigir(await admin.from('servico_recursos').insert({ servico_id: serv60.id, recurso_id: sala.id }), 'vincular sala')
  const D3 = somarDiasTexto(D, 3)
  const simultaneasSala = await Promise.all([
    criar(secretaria, { hora: '10:00', data: D3, cli: cliente2, profissional: profA }),
    criar(admin, { hora: '10:00', data: D3, cli: cliente3, profissional: profB }),
  ])
  verificar(`Recurso de uso exclusivo em gravações simultâneas resulta em 1 reserva (obtidas: ${simultaneasSala.filter(r => !r.error).length})`, simultaneasSala.filter(r => !r.error).length === 1)
  const desativarSala = await admin.from('recursos').update({ ativo: false }).eq('id', sala.id).select('id')
  verificar('Recurso com reservas futuras não é desativado sem tratar as reservas', /desativar/.test(desativarSala.error?.message ?? ''), desativarSala.error?.message)
  const secSala = await secretaria.from('recursos').insert({ nome: 'Sala indevida (teste)' }).select('id')
  verificar('Secretaria não cadastra recursos', Boolean(secSala.error))

  // Comunicações (somente registro; nenhuma mensagem real é enviada).
  const semRegistro = exigir(await secretaria.rpc('listar_comunicacoes', { p_agendamento_id: base8.id }), 'comunicações')
  const idMsg = randomUUID()
  const reg1 = await secretaria.rpc('registrar_comunicacao', { p_id: idMsg, p_agendamento_id: base8.id, p_tipo: 'confirmacao' })
  const reg2 = await secretaria.rpc('registrar_comunicacao', { p_id: idMsg, p_agendamento_id: base8.id, p_tipo: 'confirmacao' })
  const comRegistro = exigir(await secretaria.rpc('listar_comunicacoes', { p_agendamento_id: base8.id }), 'comunicações')
  const statusBase8 = (await agendaDoDiaEm(admin, D2)).find(i => i.id === base8.id)
  verificar('Envio só existe quando registrado, sem duplicar, e não confirma presença', semRegistro.length === 0 && !reg1.error && !reg2.error && comRegistro.length === 1 && statusBase8?.status === 'agendado' && statusBase8?.ultima_comunicacao_tipo === 'confirmacao')
  const profMsg = await prof1.rpc('registrar_comunicacao', { p_id: randomUUID(), p_agendamento_id: base8.id, p_tipo: 'lembrete' })
  verificar('Profissional não registra comunicações', profMsg.error?.code === '42501')
  exigir(await secretaria.rpc('reagendar_agendamento', { p_id: base8.id, p_data: D2, p_hora: '10:00', p_profissional_id: profA.id, p_motivo: 'Teste de comunicação', p_duracao_minutos: null, p_versao: await versao(base8.id), p_justificativa_conflito: null }), 'reagendar base8')
  verificar('Após reagendar, a agenda indica que é preciso avisar a cliente de novo', (await agendaDoDiaEm(admin, D2)).find(i => i.id === base8.id)?.comunicacao_desatualizada === true)

  // Lista de espera.
  const existentes = exigir(await admin.from('lista_espera').select('id, versao').eq('cliente_id', cliente3.id).in('status', ['aguardando', 'contatado']), 'entradas antigas')
  for (const e of existentes) await admin.rpc('atualizar_lista_espera', { p_id: e.id, p_status: 'desistiu', p_observacao: 'Limpeza de execução anterior', p_versao: e.versao })
  const idEspera = randomUUID()
  const espera = await secretaria.rpc('criar_lista_espera', { p_id: idEspera, p_cliente_id: cliente3.id, p_servico_id: serv60.id, p_profissional_id: null, p_data_inicio: D, p_data_fim: somarDiasTexto(D, 30), p_hora_inicio: null, p_hora_fim: null, p_observacao: 'Teste de integração' })
  const duplicada = await secretaria.rpc('criar_lista_espera', { p_id: randomUUID(), p_cliente_id: cliente3.id, p_servico_id: serv60.id, p_profissional_id: null, p_data_inicio: D, p_data_fim: somarDiasTexto(D, 30), p_hora_inicio: null, p_hora_fim: null, p_observacao: null })
  verificar('Lista de espera aceita a entrada e recusa duplicidade acidental', !espera.error && /já está na lista/.test(duplicada.error?.message ?? ''), espera.error?.message ?? duplicada.error?.message)
  const vagaLib = await criar(secretaria, { hora: '16:00', data: somarDiasTexto(D, 4), cli: cliente2 })
  const vagaReg = exigir(await admin.from('agendamentos').select('inicio, ocupado_ate').eq('id', vagaLib.id).single(), 'vaga')
  exigir(await secretaria.rpc('cancelar_agendamento', { p_id: vagaLib.id, p_motivo: 'Libera vaga (teste)', p_versao: await versao(vagaLib.id) }), 'cancelar vaga')
  const candidatos = exigir(await secretaria.rpc('candidatos_lista_espera', { p_profissional_id: profA.id, p_inicio: vagaReg.inicio, p_ocupado_ate: vagaReg.ocupado_ate }), 'candidatos')
  verificar('Vaga liberada apresenta candidatos compatíveis da lista de espera', candidatos.some(c => c.id === idEspera))
  const viaLista = await criar(secretaria, { hora: '16:00', data: somarDiasTexto(D, 4), cli: cliente3, espera: idEspera })
  const entradaDepois = exigir(await admin.from('lista_espera').select('status, agendamento_id').eq('id', idEspera).single(), 'entrada')
  const deNovo = await criar(secretaria, { hora: '09:00', data: somarDiasTexto(D, 5), cli: cliente3, espera: idEspera })
  verificar('Agendar pela lista cria uma única reserva e só então marca "agendado"', !viaLista.error && entradaDepois.status === 'agendado' && entradaDepois.agendamento_id === viaLista.id && /encerrada/.test(deNovo.error?.message ?? ''), viaLista.error?.message)
  const profEspera = await prof1.rpc('listar_lista_espera', {})
  verificar('Profissional não acessa a lista de espera', profEspera.error?.code === '42501')

  // Consulta pública e sinal de sincronização.
  const durPub = exigir(await anonimo.rpc('duracao_publica', { p_servico_id: servPrep.id, p_profissional_id: profB.id }), 'duração pública')
  verificar('Visitante recebe a duração do atendimento sem a preparação', durPub === 60, String(durPub))
  const anonNovas = await Promise.all([anonimo.from('recursos').select('id'), anonimo.from('lista_espera').select('id'), anonimo.from('comunicacoes').select('id'), anonimo.from('agenda_revisoes').select('profissional_id'), anonimo.rpc('horarios_livres', { p_servico_id: serv60.id, p_profissional_id: profA.id, p_data: D, p_ignorar_id: null, p_duracao_minutos: null })])
  verificar('Visitante não acessa recursos, lista de espera, comunicações, sinal da agenda nem horários internos', anonNovas.every(r => Boolean(r.error) || r.data.length === 0))
  const sinalProf = exigir(await prof1.from('agenda_revisoes').select('profissional_id'), 'sinal do profissional')
  verificar('Profissional recebe somente o sinal da própria agenda', sinalProf.length > 0 && sinalProf.every(x => x.profissional_id === profA.id))

  // ================= Vários serviços e recorrência (migração 012) =================
  const D6 = somarDiasTexto(D, 6)
  const etapas = lista => lista.map(([servico, profissional, hora, data = D6]) => ({ servico_id: servico.id, profissional_id: profissional.id, data, hora }))
  const doGrupo = async id => exigir(await admin.from('agendamentos').select('id, status, versao, inicio, grupo_ordem').eq('grupo_id', id).order('grupo_ordem'), 'etapas')
  const g1 = randomUUID()
  const grupo = await secretaria.rpc('criar_grupo_agendamentos', { p_grupo_id: g1, p_cliente_id: cliente2.id, p_etapas: etapas([[serv60, profA, '08:00'], [serv60, profB, '09:00']]), p_observacao: null, p_justificativa_conflito: null })
  const reenvio = await secretaria.rpc('criar_grupo_agendamentos', { p_grupo_id: g1, p_cliente_id: cliente2.id, p_etapas: etapas([[serv60, profA, '08:00'], [serv60, profB, '09:00']]), p_observacao: null, p_justificativa_conflito: null })
  verificar('Marcação com dois serviços consecutivos é criada uma única vez (reenvio não duplica)', !grupo.error && !reenvio.error && (await doGrupo(g1)).length === 2, grupo.error?.message)
  exigir(await admin.rpc('criar_bloqueio', { p_profissional_id: profB.id, p_data_inicio: D6, p_data_fim: D6, p_hora_inicio: '15:00', p_hora_fim: '16:00', p_motivo: 'Bloqueio (teste de marcação)', p_dia_inteiro: false }), 'bloqueio marcação')
  const g2 = randomUUID()
  const falhaG2 = await secretaria.rpc('criar_grupo_agendamentos', { p_grupo_id: g2, p_cliente_id: cliente3.id, p_etapas: etapas([[serv60, profA, '14:00'], [serv60, profB, '15:00']]), p_observacao: null, p_justificativa_conflito: null })
  verificar('Falha em uma etapa não cria nenhuma reserva da marcação', /^Etapa 2/.test(falhaG2.error?.message ?? '') && (await doGrupo(g2)).length === 0, falhaG2.error?.message)
  const simultaneasGrupo = await Promise.all([
    secretaria.rpc('criar_grupo_agendamentos', { p_grupo_id: randomUUID(), p_cliente_id: cliente3.id, p_etapas: etapas([[serv60, profA, '10:00'], [serv60, profB, '11:00']]), p_observacao: null, p_justificativa_conflito: null }),
    admin.rpc('criar_grupo_agendamentos', { p_grupo_id: randomUUID(), p_cliente_id: cliente3.id, p_etapas: etapas([[serv60, profB, '10:00'], [serv60, profA, '11:00']]), p_observacao: null, p_justificativa_conflito: null }),
  ])
  verificar(`Duas marcações simultâneas para a mesma cliente no mesmo período: apenas uma é criada (obtidas: ${simultaneasGrupo.filter(r => !r.error).length})`, simultaneasGrupo.filter(r => !r.error).length === 1)
  const antesG1 = await doGrupo(g1)
  const reagG1 = await secretaria.rpc('reagendar_grupo', { p_grupo_id: g1, p_data: D6, p_hora: '13:00', p_motivo: 'Teste do grupo', p_versoes: Object.fromEntries(antesG1.map(e => [e.id, e.versao])), p_justificativa_conflito: null })
  verificar('Reagendar a marcação inteira move todas as etapas', !reagG1.error && (await doGrupo(g1)).every((e, i) => new Date(e.inicio).getTime() - new Date(antesG1[i].inicio).getTime() === 5 * 3600000), reagG1.error?.message)
  const cancG1 = await secretaria.rpc('cancelar_grupo', { p_grupo_id: g1, p_motivo: 'Fim do teste do grupo', p_versoes: Object.fromEntries((await doGrupo(g1)).map(e => [e.id, e.versao])) })
  verificar('Cancelar a marcação inteira cancela as etapas', !cancG1.error && (await doGrupo(g1)).every(e => e.status === 'cancelado'), cancG1.error?.message)

  const S0 = somarDiasTexto(D, 7)
  const serieArgs = { p_cliente_id: cliente2.id, p_servico_id: serv30.id, p_profissional_id: profA.id, p_data_inicial: S0, p_hora: '17:00', p_frequencia: 'semanal', p_quantidade: 3, p_data_final: null, p_dia_inexistente: null, p_justificativa_conflito: null }
  exigir(await admin.rpc('criar_bloqueio', { p_profissional_id: profA.id, p_data_inicio: somarDiasTexto(S0, 7), p_data_fim: somarDiasTexto(S0, 7), p_hora_inicio: null, p_hora_fim: null, p_motivo: 'Feriado (teste de série)', p_dia_inteiro: true }), 'feriado série')
  const previa = exigir(await secretaria.rpc('prever_serie', serieArgs), 'prévia')
  verificar('Prévia da série mostra o feriado como indisponível', previa.length === 3 && previa[1].situacao === 'indisponivel')
  const s1 = randomUUID()
  const { p_justificativa_conflito: _j, ...semJust } = serieArgs
  const parcialSilenciosa = await secretaria.rpc('criar_serie', { p_serie_id: s1, ...semJust, p_datas: previa.map(p => p.data), p_observacao: null, p_justificativa_conflito: null })
  verificar('Série com data indisponível não é criada parcialmente', Boolean(parcialSilenciosa.error) && exigir(await admin.from('agendamentos').select('id').eq('serie_id', s1), 'série vazia').length === 0)
  const disponiveis = previa.filter(p => p.situacao === 'disponivel').map(p => p.data)
  const serie = await secretaria.rpc('criar_serie', { p_serie_id: s1, ...semJust, p_datas: disponiveis, p_observacao: null, p_justificativa_conflito: null })
  await secretaria.rpc('criar_serie', { p_serie_id: s1, ...semJust, p_datas: disponiveis, p_observacao: null, p_justificativa_conflito: null })
  const ocorrencias = exigir(await admin.from('agendamentos').select('id, versao, serie_ordem').eq('serie_id', s1).order('serie_ordem'), 'ocorrências')
  verificar('Série criada só com as datas escolhidas, sem duplicar no reenvio', !serie.error && ocorrencias.length === 2, serie.error?.message)
  const cancSerie = await secretaria.rpc('cancelar_serie', { p_serie_id: s1, p_a_partir_de: null, p_motivo: 'Fim do teste da série', p_versoes: Object.fromEntries(ocorrencias.map(o => [o.id, o.versao])) })
  verificar('Cancelar toda a série cancela as ocorrências futuras', cancSerie.data === 2, cancSerie.error?.message)
  const profSerie = await prof1.rpc('prever_serie', serieArgs)
  verificar('Profissional não cria séries nem marcações', profSerie.error?.code === '42501')

  // ---------- "Esqueci a senha" (migrações 013 e 014) ----------
  const contaProf2 = usuarios.find(u => u.email === emailDe(env.TESTE_PROF2_USUARIO))?.usuario_id
  // Encerra como atendido (o descarte imporia 30 minutos de espera e afetaria execuções seguidas).
  await admin.rpc('encerrar_pedido_senha', { p_usuario_id: contaProf2, p_resolucao: 'senha_redefinida' })
  const pedidoReal = await anonimo.rpc('solicitar_redefinicao_senha', { p_usuario: ` ${env.TESTE_PROF2_USUARIO.toUpperCase()} ` })
  const pedidoRepetido = await anonimo.rpc('solicitar_redefinicao_senha', { p_usuario: env.TESTE_PROF2_USUARIO })
  const pedidoInexistente = await anonimo.rpc('solicitar_redefinicao_senha', { p_usuario: `nao.existe.${randomUUID().slice(0, 8)}` })
  verificar('Visitante pede nova senha; a resposta é igual para conta existente ou não', !pedidoReal.error && !pedidoRepetido.error && !pedidoInexistente.error && pedidoReal.data === pedidoInexistente.data,
    pedidoReal.error?.message ?? pedidoInexistente.error?.message)
  const pedidos = exigir(await admin.rpc('listar_pedidos_senha'), 'pedidos de senha')
  verificar('Pedido repetido gera um único aviso para a administração', pedidos.filter(p => p.usuario_id === contaProf2).length === 1)
  verificar('Usuário inexistente não gera aviso', pedidos.every(p => !p.email.startsWith('nao.existe.')))
  const [secPedidos, anonPedidos, secEncerrar, anonTabela] = await Promise.all([
    secretaria.rpc('listar_pedidos_senha'), anonimo.rpc('listar_pedidos_senha'),
    secretaria.rpc('encerrar_pedido_senha', { p_usuario_id: contaProf2, p_resolucao: 'descartado' }),
    anonimo.from('pedidos_redefinicao_senha').select('id'),
  ])
  verificar('Somente a administração vê e encerra pedidos de senha', secPedidos.error?.code === '42501' && Boolean(anonPedidos.error) && secEncerrar.error?.code === '42501' && Boolean(anonTabela.error))
  const resolucaoInvalida = await admin.rpc('encerrar_pedido_senha', { p_usuario_id: contaProf2, p_resolucao: 'qualquer' })
  verificar('Resolução inválida é recusada', resolucaoInvalida.error?.code === 'P0001')
  exigir(await admin.rpc('encerrar_pedido_senha', { p_usuario_id: contaProf2, p_resolucao: 'senha_redefinida' }), 'encerrar pedido')
  const depoisDeEncerrar = exigir(await admin.rpc('listar_pedidos_senha'), 'pedidos de senha')
  verificar('Pedido atendido sai da lista da administração', !depoisDeEncerrar.some(p => p.usuario_id === contaProf2))
  // Outra conta: pede, a administração descarta e um novo pedido logo em seguida não gera aviso (espera de 30 minutos).
  const contaProf1Senha = usuarios.find(u => u.email === emailDe(env.TESTE_PROF1_USUARIO))?.usuario_id
  await anonimo.rpc('solicitar_redefinicao_senha', { p_usuario: env.TESTE_PROF1_USUARIO })
  exigir(await admin.rpc('encerrar_pedido_senha', { p_usuario_id: contaProf1Senha, p_resolucao: 'descartado' }), 'descartar pedido')
  const aposDescarte = await anonimo.rpc('solicitar_redefinicao_senha', { p_usuario: env.TESTE_PROF1_USUARIO })
  const pedidosAposDescarte = exigir(await admin.rpc('listar_pedidos_senha'), 'pedidos após descarte')
  verificar('Após um descarte, novo pedido da mesma conta não gera aviso por 30 minutos', !aposDescarte.error && !pedidosAposDescarte.some(p => p.usuario_id === contaProf1Senha), aposDescarte.error?.message)
} finally {
  // ---------- Limpeza ----------
  const diasTeste = [0, 1, 2, 3, 4, 5, 6, 7, 14, 21].map(n => somarDiasTexto(D, n))
  const ativos = (await Promise.all(diasTeste.map(dia => agendaDoDiaEm(admin, dia)))).flat().filter(i => ['agendado', 'confirmado', 'chegou'].includes(i.status))
  for (const item of ativos) await admin.rpc('cancelar_agendamento', { p_id: item.id, p_motivo: 'Limpeza do teste de integração', p_versao: item.versao })
  const emAndamento = (await Promise.all(diasTeste.map(dia => agendaDoDiaEm(admin, dia)))).flat().filter(i => i.status === 'em_atendimento')
  for (const item of emAndamento) await admin.rpc('alterar_status_agendamento', { p_id: item.id, p_status: 'concluido', p_versao: item.versao })
  const salaTeste = (await admin.from('recursos').select('id').eq('nome', 'Teste Sala Integração')).data?.[0]
  if (salaTeste) {
    await admin.from('servico_recursos').delete().eq('recurso_id', salaTeste.id)
    await admin.from('recursos').update({ ativo: false }).eq('id', salaTeste.id)
  }
  const bloqueios = exigir(await admin.from('bloqueios').select('id').in('profissional_id', [profA.id, profB.id]).is('removido_em', null).gte('inicio', `${D}T00:00:00Z`), 'bloqueios')
  for (const b of bloqueios) await admin.rpc('remover_bloqueio', { p_id: b.id, p_motivo: 'Limpeza do teste de integração' })
  for (const dia of datasPublicas) {
    const doDia = exigir(await admin.rpc('listar_agenda', { p_data_inicio: dia, p_data_fim: dia, p_profissional_id: profC.id }), 'agenda C')
    for (const item of doDia.filter(i => ['agendado', 'confirmado', 'chegou'].includes(i.status))) await admin.rpc('cancelar_agendamento', { p_id: item.id, p_motivo: 'Limpeza do teste de integração', p_versao: item.versao })
  }
  await secretaria.auth.updateUser({ data: { papel: null, role: null } })
  bloqueiosCriados.length = 0
}

function contaSecretaria() { return usuarios.find(u => u.email === emailDe(env.TESTE_SECRETARIA_USUARIO))?.usuario_id }

const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações passaram.`)
process.exitCode = falhas.length ? 1 : 0

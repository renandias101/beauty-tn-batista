// Mesmas assinaturas de src/services, operando sobre os dados fictícios do navegador.
// Usado somente quando modoDemo é verdadeiro.
import { agoraNoFuso, deMinutos, diaDaSemana, paraMinutos, somarDias, somarMinutos } from '../lib/datas'
import { bloqueioNaData, calcularHorariosLivres } from '../lib/horariosLivres'
import { ErroDeOperacao } from '../lib/erros'
import { FORMATO_USUARIO } from '../lib/acesso'
import { ocupaHorario } from '../lib/status'
import { novoUuid } from '../lib/uuid'
import type { NovoAgendamento } from '../services/agenda'
import type { Bloqueio, Cliente, Disponibilidade, Excecao, FaixaJornada, Habilitacao, ItemAgenda, Papel, Profissional, RegistroHistorico, Servico, StatusAgendamento, Usuario } from '../types'
import { gravar, obterBase, perfilDemo } from './estado'
import * as motor from './motor'

const copia = <T,>(valor: T): T => JSON.parse(JSON.stringify(valor))
const falhar = (mensagem: string): never => { throw new ErroDeOperacao(mensagem) }
const alterar = <T,>(acao: () => T): T => { const resultado = acao(); gravar(); return resultado }
const equipe: Papel[] = ['admin', 'secretaria']

// ---------- Agenda ----------

export async function listarAgenda(dataInicio: string, dataFim: string, profissionalId?: string): Promise<ItemAgenda[]> {
  const base = obterBase()
  const perfil = motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  // O profissional vê somente a própria agenda e dados mínimos, como no servidor.
  const alvo = perfil.papel === 'profissional' ? perfil.profissionalId ?? falhar('Seu usuário não está vinculado a um profissional.') : profissionalId
  return base.agendamentos
    .filter(a => a.data >= dataInicio && a.data <= dataFim && (!alvo || a.profissionalId === alvo))
    .map(a => motor.paraItem(base, a, perfil.papel !== 'profissional'))
    .sort((x, y) => `${x.data}${x.horaInicio}${x.profissionalNome}`.localeCompare(`${y.data}${y.horaInicio}${y.profissionalNome}`))
}

export async function agendamentosDoCliente(clienteId: string) {
  const base = obterBase()
  motor.exigirPapel(perfilDemo(), equipe)
  return base.agendamentos.filter(a => a.clienteId === clienteId).map(a => motor.paraItem(base, a))
    .sort((x, y) => `${y.data}${y.horaInicio}`.localeCompare(`${x.data}${x.horaInicio}`))
}

export const criarAgendamento = async (a: NovoAgendamento) => { alterar(() => motor.criarAgendamento(obterBase(), perfilDemo(), a)) }
export const alterarStatus = async (id: string, status: StatusAgendamento) => alterar(() => motor.alterarStatus(obterBase(), perfilDemo(), id, status))
export const cancelarAgendamento = async (id: string, motivo: string) => alterar(() => motor.cancelarAgendamento(obterBase(), perfilDemo(), id, motivo))
export const reagendarAgendamento = async (id: string, novo: { data: string; hora: string; profissionalId: string; motivo: string; duracaoMinutos?: number }) =>
  alterar(() => motor.reagendarAgendamento(obterBase(), perfilDemo(), id, novo))
export const editarAgendamento = async (id: string, observacao: string, encaixe: boolean) => alterar(() => motor.editarAgendamento(obterBase(), perfilDemo(), id, observacao, encaixe))

export async function historicoDoAgendamento(id: string): Promise<RegistroHistorico[]> {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria'])
  return copia(obterBase().historico.filter(h => h.agendamentoId === id))
}

// ---------- Cadastros ----------

export async function listarClientes(): Promise<Cliente[]> {
  motor.exigirPapel(perfilDemo(), equipe)
  return copia([...obterBase().clientes].sort((a, b) => a.nome.localeCompare(b.nome)))
}

export async function clientesComTelefone(digitos: string, ignorarId?: string): Promise<Cliente[]> {
  motor.exigirPapel(perfilDemo(), equipe)
  return copia(obterBase().clientes.filter(c => c.telefoneDigitos === digitos && c.id !== ignorarId))
}

export async function salvarCliente(cliente: { id?: string; nome: string; telefone: string }): Promise<Cliente> {
  motor.exigirPapel(perfilDemo(), equipe)
  const nome = cliente.nome.trim()
  const telefone = cliente.telefone.trim()
  const telefoneDigitos = telefone.replace(/\D/g, '')
  if (!nome || nome.length > 150) falhar('Informe o nome completo (até 150 caracteres).')
  if (telefoneDigitos.length < 8 || telefoneDigitos.length > 15) falhar('Informe um telefone com DDD.')
  return alterar(() => {
    const base = obterBase()
    const existente = cliente.id ? base.clientes.find(c => c.id === cliente.id) ?? falhar('Cliente não encontrado.') : null
    const salvo = existente ? Object.assign(existente, { nome, telefone, telefoneDigitos }) : { id: novoUuid(), nome, telefone, telefoneDigitos }
    if (!existente) base.clientes.push(salvo)
    return copia(salvo)
  })
}

export async function listarProfissionais(): Promise<Profissional[]> {
  const perfil = motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  return copia(obterBase().profissionais.filter(p => perfil.papel !== 'profissional' || p.id === perfil.profissionalId).sort((a, b) => a.nome.localeCompare(b.nome)))
}

export async function salvarProfissional(p: { id?: string; nome: string; telefone: string; cor: string; ativo: boolean }): Promise<Profissional> {
  motor.exigirPapel(perfilDemo(), ['admin'])
  if (!p.nome.trim()) falhar('Informe o nome.')
  return alterar(() => {
    const base = obterBase()
    const existente = p.id ? base.profissionais.find(x => x.id === p.id) ?? falhar('Profissional não encontrado.') : null
    if (existente?.ativo && !p.ativo) {
      // Inativar exige revisar antes as reservas futuras (seção 5 do PRD).
      const futuras = base.agendamentos.filter(a => a.profissionalId === existente.id && ocupaHorario(a.status) && Date.parse(motor.instante(a.data, somarMinutos(a.horaInicio, a.duracaoMinutos))) > Date.now())
      if (futuras.length) falhar(`Existem ${futuras.length} agendamento(s) futuro(s) para este profissional: ${motor.descrever(base, futuras)}. Reagende ou cancele antes de inativar.`)
    }
    const valores = { nome: p.nome.trim(), telefone: p.telefone.trim() || null, cor: p.cor, ativo: p.ativo }
    const salvo = existente ? Object.assign(existente, valores) : { id: novoUuid(), usuarioId: null, ...valores }
    if (!existente) base.profissionais.push(salvo)
    return copia(salvo)
  })
}

export async function listarServicos(): Promise<Servico[]> {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  return copia([...obterBase().servicos].sort((a, b) => a.nome.localeCompare(b.nome)))
}

export async function salvarServico(s: { id?: string; nome: string; duracaoMinutos: number; categoria: string; descricao: string; ativo: boolean }): Promise<Servico> {
  motor.exigirPapel(perfilDemo(), ['admin'])
  if (!s.nome.trim()) falhar('Informe o nome do serviço.')
  if (!Number.isInteger(s.duracaoMinutos) || s.duracaoMinutos <= 0 || s.duracaoMinutos > 720) falhar('A duração deve ser maior que zero e de no máximo 720 minutos.')
  return alterar(() => {
    const base = obterBase()
    const existente = s.id ? base.servicos.find(x => x.id === s.id) ?? falhar('Serviço não encontrado.') : null
    // Reservas guardam a própria duração: mudar a duração padrão não as altera (CA08).
    const valores = { nome: s.nome.trim(), duracaoMinutos: s.duracaoMinutos, categoria: s.categoria.trim() || null, descricao: s.descricao.trim() || null, ativo: s.ativo }
    const salvo = existente ? Object.assign(existente, valores) : { id: novoUuid(), ...valores }
    if (!existente) base.servicos.push(salvo)
    return copia(salvo)
  })
}

export async function listarHabilitacoes(): Promise<Habilitacao[]> {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  return copia(obterBase().habilitacoes)
}

export async function definirHabilitacoes(atuais: Habilitacao[], desejadas: Habilitacao[]) {
  motor.exigirPapel(perfilDemo(), ['admin'])
  const chave = (h: Habilitacao) => `${h.profissionalId}:${h.servicoId}`
  const retirar = new Set(atuais.map(chave))
  alterar(() => {
    const base = obterBase()
    base.habilitacoes = [...base.habilitacoes.filter(h => !retirar.has(chave(h))), ...desejadas]
  })
}

// ---------- Jornada, exceções e bloqueios ----------

export async function listarDisponibilidades(profissionalId?: string): Promise<Disponibilidade[]> {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  return copia(obterBase().disponibilidades.filter(d => !profissionalId || d.profissionalId === profissionalId)
    .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio)))
}

export const salvarJornada = async (profissionalId: string, faixas: FaixaJornada[]) =>
  alterar(() => motor.salvarJornada(obterBase(), perfilDemo(), profissionalId, faixas, novoUuid))

export async function listarExcecoes(filtro: { profissionalId?: string; aPartirDe?: string; data?: string }): Promise<Excecao[]> {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  return copia(obterBase().excecoes.filter(e => !e.removidoEm && (!filtro.profissionalId || e.profissionalId === filtro.profissionalId)
    && (!filtro.aPartirDe || e.data >= filtro.aPartirDe) && (!filtro.data || e.data === filtro.data))
    .sort((a, b) => `${a.data}${a.horaInicio}`.localeCompare(`${b.data}${b.horaInicio}`)))
}

export async function criarExcecao(e: { profissionalId: string; data: string; horaInicio: string; horaFim: string; motivo: string }) {
  motor.exigirPapel(perfilDemo(), ['admin'])
  if (!e.data || !e.horaInicio || !e.horaFim || e.horaInicio >= e.horaFim) falhar('Informe data e um período válido.')
  const base = obterBase()
  const dia = new Date(`${e.data}T00:00:00Z`).getUTCDay()
  const sobrepoe = (f: { horaInicio: string; horaFim: string }) => e.horaInicio < f.horaFim && f.horaInicio < e.horaFim
  if (base.disponibilidades.some(d => d.profissionalId === e.profissionalId && d.diaSemana === dia && sobrepoe(d))) falhar('A exceção deve abrir um período fora da jornada habitual desse dia.')
  if (base.excecoes.some(x => !x.removidoEm && x.profissionalId === e.profissionalId && x.data === e.data && sobrepoe(x))) falhar('Já existe uma exceção sobreposta nesta data.')
  alterar(() => base.excecoes.push({ id: novoUuid(), profissionalId: e.profissionalId, data: e.data, horaInicio: e.horaInicio, horaFim: e.horaFim, motivo: e.motivo.trim() || null, removidoEm: null }))
}

export async function removerExcecao(id: string) {
  motor.exigirPapel(perfilDemo(), ['admin'])
  const base = obterBase()
  const excecao = base.excecoes.find(e => e.id === id && !e.removidoEm) ?? falhar('Exceção não encontrada.')
  excecao.removidoEm = new Date().toISOString()
  // RN08: não remove a exceção que sustenta uma reserva futura.
  const fora = motor.reservasForaDaJornada(base, excecao.profissionalId)
  if (fora.length) {
    excecao.removidoEm = null
    falhar(`A alteração deixaria ${fora.length} agendamento(s) futuro(s) fora da jornada: ${motor.descrever(base, fora)}. Reagende ou cancele essas reservas antes.`)
  }
  gravar()
}

export async function listarBloqueios(filtro: { de: string; ate: string; profissionalId?: string }): Promise<Bloqueio[]> {
  const perfil = motor.exigirPapel(perfilDemo(), ['admin', 'secretaria', 'profissional'])
  const alvo = perfil.papel === 'profissional' ? perfil.profissionalId : filtro.profissionalId
  return copia(obterBase().bloqueios
    .filter(b => !b.removidoEm && Date.parse(b.inicio) < Date.parse(filtro.ate) && Date.parse(b.fim) > Date.parse(filtro.de) && (!alvo || b.profissionalId === alvo))
    .map(({ removidoEm: _removido, motivoRemocao: _motivo, ...b }) => b)
    .sort((a, b) => a.inicio.localeCompare(b.inicio)))
}

export const criarBloqueio = async (b: { profissionalId: string; dataInicio: string; dataFim: string; horaInicio: string; horaFim: string; motivo: string; diaInteiro: boolean }) =>
  alterar(() => motor.criarBloqueio(obterBase(), perfilDemo(), b, novoUuid))

export async function removerBloqueio(id: string, motivo: string) {
  motor.exigirPapel(perfilDemo(), ['admin', 'secretaria'])
  const limpo = motivo.trim()
  if (limpo.length < 3 || limpo.length > 300) falhar('Informe o motivo da remoção do bloqueio (de 3 a 300 caracteres).')
  alterar(() => {
    const bloqueio = obterBase().bloqueios.find(b => b.id === id && !b.removidoEm) ?? falhar('Bloqueio não encontrado.')
    bloqueio.removidoEm = new Date().toISOString()
    bloqueio.motivoRemocao = limpo
  })
}

// ---------- Configuração, auditoria e consulta pública ----------

const configuracaoDemo = () => obterBase().configuracao ?? { whatsapp: null, horizonteDias: 30 }

export async function obterConfiguracao() {
  motor.exigirPapel(perfilDemo(), ['admin'])
  return { ...configuracaoDemo(), fusoHorario: motor.FUSO_DEMO }
}

export async function salvarConfiguracao(c: { whatsapp: string | null; horizonteDias: number }) {
  motor.exigirPapel(perfilDemo(), ['admin'])
  if (c.whatsapp !== null && !/^[0-9]{10,15}$/.test(c.whatsapp)) falhar('Informe o WhatsApp com DDD, somente números (10 a 15 dígitos).')
  if (!Number.isInteger(c.horizonteDias) || c.horizonteDias < 1 || c.horizonteDias > 90) falhar('O horizonte deve ser de 1 a 90 dias.')
  alterar(() => { obterBase().configuracao = { whatsapp: c.whatsapp, horizonteDias: c.horizonteDias } })
}

/** A demonstração não mantém auditoria geral de cadastros; o histórico dos agendamentos continua disponível. */
export async function listarAuditoria() {
  motor.exigirPapel(perfilDemo(), ['admin'])
  return []
}

// A consulta pública não exige perfil, como no sistema real.
export async function configuracaoPublica() {
  return { ...configuracaoDemo(), fusoHorario: motor.FUSO_DEMO }
}

const habilitadosAtivos = (servicoId: string) => {
  const base = obterBase()
  return base.profissionais.filter(p => p.ativo && base.habilitacoes.some(h => h.profissionalId === p.id && h.servicoId === servicoId))
}

export async function servicosPublicos() {
  // Como no banco (migração 010): todos os serviços ativos; sem profissional, a página mostra o aviso.
  return obterBase().servicos.filter(s => s.ativo)
    .map(({ id, nome, duracaoMinutos, categoria, descricao }) => ({ id, nome, duracaoMinutos, categoria, descricao }))
    .sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '') || a.nome.localeCompare(b.nome))
}

export async function profissionaisPublicos(servicoId: string) {
  const servico = obterBase().servicos.find(s => s.id === servicoId && s.ativo)
  if (!servico) return []
  return habilitadosAtivos(servicoId).map(p => ({ id: p.id, nome: p.nome })).sort((a, b) => a.nome.localeCompare(b.nome))
}

export async function horariosDisponiveis(servicoId: string, profissionalId: string, dataInicio: string, dataFim: string) {
  const base = obterBase()
  const servico = base.servicos.find(s => s.id === servicoId && s.ativo) ?? falhar('Serviço indisponível para consulta.')
  if (!habilitadosAtivos(servicoId).some(p => p.id === profissionalId)) falhar('Profissional indisponível para este serviço.')
  const agora = agoraNoFuso(motor.FUSO_DEMO)
  const ultimo = somarDias(agora.data, configuracaoDemo().horizonteDias)
  const resultado: { data: string; hora: string }[] = []
  for (let data = dataInicio < agora.data ? agora.data : dataInicio; data <= dataFim && data <= ultimo; data = somarDias(data, 1)) {
    const faixas = [
      ...base.disponibilidades.filter(d => d.profissionalId === profissionalId && d.diaSemana === diaDaSemana(data)),
      ...base.excecoes.filter(e => !e.removidoEm && e.profissionalId === profissionalId && e.data === data),
    ]
    const ocupados = [
      ...base.bloqueios.filter(b => !b.removidoEm && b.profissionalId === profissionalId).map(b => bloqueioNaData(b, data, motor.FUSO_DEMO)).filter(Boolean) as { inicio: number; fim: number }[],
      ...base.agendamentos.filter(a => a.profissionalId === profissionalId && a.data === data && ocupaHorario(a.status))
        .map(a => ({ inicio: paraMinutos(a.horaInicio), fim: paraMinutos(a.horaInicio) + a.duracaoMinutos })),
    ]
    const livres = calcularHorariosLivres({ faixas, ocupados, duracaoMinutos: servico.duracaoMinutos, aPartirDeMinutos: data === agora.data ? paraMinutos(agora.hora) + 1 : 0 })
    for (const minuto of livres) resultado.push({ data, hora: deMinutos(minuto) })
  }
  return resultado
}

// ---------- Usuários (sem senhas: a demonstração não autentica) ----------

export async function listarUsuarios(): Promise<Usuario[]> {
  motor.exigirPapel(perfilDemo(), ['admin'])
  const base = obterBase()
  return base.usuarios.map(u => {
    const profissional = base.profissionais.find(p => p.usuarioId === u.usuarioId)
    return { usuarioId: u.usuarioId, nome: u.nome, usuario: u.usuario, papel: u.papel, ativo: u.ativo, profissionalId: profissional?.id ?? null, profissionalNome: profissional?.nome ?? null, ultimoAcesso: null }
  }).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome))
}

function vincular(usuarioId: string, papel: Papel, profissionalId: string | null) {
  const base = obterBase()
  base.profissionais.forEach(p => { if (p.usuarioId === usuarioId) p.usuarioId = null })
  if (papel !== 'profissional') return
  const alvo = base.profissionais.find(p => p.id === profissionalId) ?? falhar('Selecione o profissional vinculado a esta conta.')
  if (alvo.usuarioId && alvo.usuarioId !== usuarioId) falhar('Este profissional já está vinculado a outra conta.')
  alvo.usuarioId = usuarioId
}

export async function criarUsuario(u: { nome: string; usuario: string; senha: string; papel: Papel; profissionalId: string | null }) {
  motor.exigirPapel(perfilDemo(), ['admin'])
  if (!FORMATO_USUARIO.test(u.usuario)) falhar('Usuário inválido.')
  if (obterBase().usuarios.some(x => x.usuario === u.usuario)) falhar('Este usuário já existe.')
  alterar(() => {
    const usuarioId = novoUuid()
    vincular(usuarioId, u.papel, u.profissionalId)
    obterBase().usuarios.push({ usuarioId, nome: u.nome.trim(), usuario: u.usuario, papel: u.papel, ativo: true })
  })
}

export async function atualizarUsuario(u: { usuarioId: string; nome: string; papel: Papel; ativo: boolean; profissionalId: string | null }) {
  const perfil = motor.exigirPapel(perfilDemo(), ['admin'])
  if (u.usuarioId === perfil.usuarioId && (!u.ativo || u.papel !== 'admin')) falhar('Você não pode remover o próprio acesso de administração.')
  alterar(() => {
    const usuario = obterBase().usuarios.find(x => x.usuarioId === u.usuarioId) ?? falhar('Usuário não encontrado.')
    vincular(u.usuarioId, u.papel, u.profissionalId)
    Object.assign(usuario, { nome: u.nome.trim(), papel: u.papel, ativo: u.ativo })
  })
}

export async function redefinirSenha(_usuarioId: string, _senha: string) {
  motor.exigirPapel(perfilDemo(), ['admin'])
}

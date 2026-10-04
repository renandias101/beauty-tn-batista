import type { Papel } from '../types'

// Mapa de permissões usado só para mostrar ou esconder ações na interface.
// O controle de acesso de verdade fica no banco (RLS e funções que conferem o perfil).
const PERMISSOES = {
  verAgendaGeral: ['admin', 'secretaria'],
  gerenciarAgendamentos: ['admin', 'secretaria'],
  gerenciarClientes: ['admin', 'secretaria'],
  gerenciarBloqueios: ['admin', 'secretaria'],
  verHistoricoAgendamento: ['admin', 'secretaria'],
  gerenciarListaEspera: ['admin', 'secretaria'],
  registrarComunicacoes: ['admin', 'secretaria'],
  gerenciarCadastros: ['admin'],
  ajustarDuracaoReserva: ['admin'],
  corrigirStatus: ['admin'],
  autorizarConflitoCliente: ['admin'],
  gerenciarUsuarios: ['admin'],
  verAuditoria: ['admin'],
  configurarClinica: ['admin'],
} satisfies Record<string, Papel[]>

export type Permissao = keyof typeof PERMISSOES

export const pode = (papel: Papel, permissao: Permissao) => (PERMISSOES[permissao] as Papel[]).includes(papel)

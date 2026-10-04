export type Papel = 'admin' | 'secretaria' | 'profissional'
export type StatusAgendamento = 'agendado' | 'confirmado' | 'chegou' | 'em_atendimento' | 'concluido' | 'cancelado' | 'faltou'

export interface Perfil { usuarioId: string; nome: string; papel: Papel; profissionalId: string | null; fusoHorario: string }

export interface Cliente { id: string; nome: string; telefone: string; telefoneDigitos: string }
export interface Profissional { id: string; nome: string; telefone: string | null; cor: string; ativo: boolean; usuarioId: string | null }
export interface Servico { id: string; nome: string; duracaoMinutos: number; categoria: string | null; descricao: string | null; ativo: boolean }
export interface Habilitacao { profissionalId: string; servicoId: string }

/** Faixa de atendimento de um dia da semana (0 = domingo). Horários no formato HH:MM. */
export interface FaixaJornada { diaSemana: number; horaInicio: string; horaFim: string }
export interface Disponibilidade extends FaixaJornada { id: string; profissionalId: string }
export interface Excecao { id: string; profissionalId: string; data: string; horaInicio: string; horaFim: string; motivo: string | null }
export interface Bloqueio { id: string; profissionalId: string; inicio: string; fim: string; motivo: string }

/** Linha da agenda devolvida por listar_agenda. data em YYYY-MM-DD e horas em HH:MM no fuso da clínica. */
export interface ItemAgenda {
  id: string
  clienteId: string
  clienteNome: string
  clienteTelefone: string | null
  servicoId: string
  servicoNome: string
  profissionalId: string
  profissionalNome: string
  profissionalCor: string
  inicio: string
  fim: string
  data: string
  horaInicio: string
  horaFim: string
  duracaoMinutos: number
  status: StatusAgendamento
  encaixe: boolean
  observacao: string | null
  motivoCancelamento: string | null
}

export interface RegistroHistorico {
  id: number
  acao: 'criado' | 'status_alterado' | 'reagendado' | 'cancelado' | 'editado'
  usuarioNome: string
  ocorridoEm: string
  motivo: string | null
  valoresAnteriores: Record<string, unknown> | null
  valoresNovos: Record<string, unknown> | null
}

export interface Usuario { usuarioId: string; nome: string; usuario: string; papel: Papel; ativo: boolean; profissionalId: string | null; profissionalNome: string | null; ultimoAcesso: string | null }

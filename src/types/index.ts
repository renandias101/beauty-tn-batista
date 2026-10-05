export type Papel = 'admin' | 'secretaria' | 'profissional'
export type StatusAgendamento = 'agendado' | 'confirmado' | 'chegou' | 'em_atendimento' | 'concluido' | 'cancelado' | 'faltou'

export interface Perfil { usuarioId: string; nome: string; papel: Papel; profissionalId: string | null; fusoHorario: string }

export interface Cliente { id: string; nome: string; telefone: string; telefoneDigitos: string }
export interface Profissional { id: string; nome: string; telefone: string | null; cor: string; ativo: boolean; usuarioId: string | null }
/** preparacaoMinutos: intervalo após o atendimento (limpeza, organização); ocupa a agenda, mas não é informado à cliente. */
export interface Servico { id: string; nome: string; duracaoMinutos: number; preparacaoMinutos: number; categoria: string | null; descricao: string | null; ativo: boolean }
/** duracaoMinutos: duração específica do profissional para o serviço; null usa a duração padrão do serviço. */
export interface Habilitacao { profissionalId: string; servicoId: string; duracaoMinutos?: number | null }

export type TipoRecurso = 'sala' | 'equipamento' | 'outro'
export interface Recurso { id: string; nome: string; tipo: TipoRecurso; capacidade: number; ativo: boolean }
export interface ServicoRecurso { servicoId: string; recursoId: string }

/** Faixa de atendimento de um dia da semana (0 = domingo). Horários no formato HH:MM. */
export interface FaixaJornada { diaSemana: number; horaInicio: string; horaFim: string }
export interface Disponibilidade extends FaixaJornada { id: string; profissionalId: string }
export interface Excecao { id: string; profissionalId: string; data: string; horaInicio: string; horaFim: string; motivo: string | null }
export interface Bloqueio { id: string; profissionalId: string; inicio: string; fim: string; motivo: string }

export type TipoComunicacao = 'confirmacao' | 'lembrete' | 'cancelamento' | 'reagendamento'
export interface UltimaComunicacao { tipo: TipoComunicacao; em: string; por: string }
export interface Comunicacao { id: string; tipo: TipoComunicacao; registradoEm: string; registradoPor: string; desatualizada: boolean }

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
  /** Preparação gravada na reserva e fim do período ocupado (atendimento + preparação). */
  preparacaoMinutos: number
  ocupadoAte: string
  horaOcupadoAte: string
  /** Versão do registro: alterações com versão antiga são recusadas pelo servidor. */
  versao: number
  excecaoConflitoCliente: string | null
  recursos: string | null
  ultimaComunicacao: UltimaComunicacao | null
  /** O horário ou o profissional mudou depois da última mensagem registrada. */
  comunicacaoDesatualizada: boolean
  /** Marcação com vários serviços: etapa grupoOrdem de grupoTotal. */
  grupoId: string | null
  grupoOrdem: number | null
  grupoTotal: number | null
  /** Série recorrente: ocorrência serieOrdem de serieTotal. */
  serieId: string | null
  serieOrdem: number | null
  serieTotal: number | null
  serieFrequencia: FrequenciaSerie | null
}

export type FrequenciaSerie = 'semanal' | 'quinzenal' | 'mensal'
/** Mensal: o que fazer quando o dia escolhido não existe no mês (escolha explícita). */
export type DiaInexistente = 'ultimo_dia' | 'pular'
export interface OcorrenciaPrevista { ordem: number | null; data: string; situacao: 'disponivel' | 'indisponivel' | 'dia_inexistente' | 'pulada'; motivo: string | null }

export interface RegistroHistorico {
  id: number
  acao: 'criado' | 'status_alterado' | 'reagendado' | 'cancelado' | 'editado' | 'status_corrigido'
  usuarioNome: string
  ocorridoEm: string
  motivo: string | null
  valoresAnteriores: Record<string, unknown> | null
  valoresNovos: Record<string, unknown> | null
}

export type StatusEspera = 'aguardando' | 'contatado' | 'agendado' | 'desistiu'
export interface EntradaEspera {
  id: string
  clienteId: string
  clienteNome: string
  clienteTelefone: string
  servicoId: string
  servicoNome: string
  profissionalId: string | null
  profissionalNome: string | null
  dataInicio: string
  dataFim: string
  horaInicio: string | null
  horaFim: string | null
  observacao: string | null
  status: StatusEspera
  agendamentoId: string | null
  versao: number
  criadoEm: string
  criadoPor: string
  ultimoContatoEm: string | null
  ultimoContatoPor: string | null
}
export interface ContatoEspera { id: number; ocorridoEm: string; usuarioNome: string; statusAnterior: StatusEspera | null; statusNovo: StatusEspera; observacao: string | null }
/** Candidato da lista de espera para uma vaga liberada. */
export interface CandidatoEspera {
  id: string; clienteId: string; clienteNome: string; servicoId: string; servicoNome: string; duracaoMinutos: number
  profissionalPreferido: string | null; dataInicio: string; dataFim: string; horaInicio: string | null; horaFim: string | null
  observacao: string | null; status: StatusEspera; versao: number
}

export interface Usuario { usuarioId: string; nome: string; usuario: string; papel: Papel; ativo: boolean; profissionalId: string | null; profissionalNome: string | null; ultimoAcesso: string | null }
/** Pedido de "Esqueci a senha" em aberto, aguardando a administração. */
export interface PedidoSenha { usuarioId: string; nome: string; usuario: string; ativo: boolean; solicitadoEm: string }

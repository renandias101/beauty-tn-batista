// Converte erros do Supabase em mensagens claras, sem expor detalhes internos (RF10).

interface ErroComCodigo { code?: string; message?: string; name?: string; context?: unknown }

export class ErroDeOperacao extends Error {}

export const mensagemDeErro = (erro: unknown): string => {
  if (erro instanceof ErroDeOperacao) return erro.message
  const e = (erro ?? {}) as ErroComCodigo
  // P0001: regra de negócio; 42501: permissão. Ambas trazem mensagem escrita para o usuário.
  if ((e.code === 'P0001' || e.code === '42501') && e.message) return e.message
  if (e.code === '23P01') return 'Já existe uma reserva ou bloqueio nesse horário. Atualize a agenda e escolha outro horário.'
  if (e.code === '23505') return 'Este registro já existe.'
  if (e.code === '23514') return 'Há dados inválidos. Revise os campos e tente novamente.'
  if (e.code === 'PGRST301' || e.code === '401') return 'Sua sessão expirou. Entre novamente.'
  if (erro instanceof TypeError || /fetch|network|Failed to fetch/i.test(e.message ?? '')) {
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente; nada foi salvo.'
  }
  return 'Não foi possível concluir a operação. Tente novamente.'
}

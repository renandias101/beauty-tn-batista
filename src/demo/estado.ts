// Armazenamento da demonstração. Usa somente as chaves abaixo: nunca lê, altera ou remove outras chaves
// do navegador (sessão do Supabase ou dados do sistema antigo).
import type { Perfil } from '../types'
import { gerarBaseDemo } from './dadosIniciais'
import { FUSO_DEMO, type BaseDemo } from './motor'

export const CHAVE_DADOS_DEMO = 'beauty-tn-batista:demo:v1'
export const CHAVE_PERFIL_DEMO = 'beauty-tn-batista:demo:v1:perfil'

let base: BaseDemo | null = null

const ler = (armazenamento: Storage | undefined, chave: string) => { try { return armazenamento?.getItem(chave) ?? null } catch { return null } }
const escrever = (armazenamento: Storage | undefined, chave: string, valor: string | null) => {
  try { if (valor === null) armazenamento?.removeItem(chave); else armazenamento?.setItem(chave, valor) } catch { /* armazenamento indisponível: segue em memória */ }
}
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage)
const sessao = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)

const valida = (dados: unknown): dados is BaseDemo =>
  typeof dados === 'object' && dados !== null && (dados as BaseDemo).versao === 1 && Array.isArray((dados as BaseDemo).agendamentos)

/** Carrega os exemplos uma única vez: se já existem no navegador, são reaproveitados sem recriar nem duplicar. */
export function obterBase(): BaseDemo {
  if (base) return base
  const salvo = ler(local(), CHAVE_DADOS_DEMO)
  if (salvo) {
    try {
      const dados = JSON.parse(salvo)
      if (valida(dados)) return (base = dados)
    } catch { /* conteúdo ilegível da própria demonstração: gera de novo abaixo */ }
  }
  base = gerarBaseDemo()
  gravar()
  return base
}

export function gravar() {
  if (base) escrever(local(), CHAVE_DADOS_DEMO, JSON.stringify(base))
}

/** Recria somente os dados fictícios (com datas a partir de hoje). Nenhuma outra chave é tocada. */
export function restaurarDemonstracao() {
  base = gerarBaseDemo()
  gravar()
}

// ---------- Perfil escolhido na entrada da demonstração (não é autenticação) ----------

export function perfilDemo(): Perfil | null {
  const usuarioId = ler(sessao(), CHAVE_PERFIL_DEMO)
  if (!usuarioId) return null
  const usuario = obterBase().usuarios.find(u => u.usuarioId === usuarioId && u.ativo)
  if (!usuario) return null
  const profissional = obterBase().profissionais.find(p => p.usuarioId === usuario.usuarioId)
  return { usuarioId: usuario.usuarioId, nome: usuario.nome, papel: usuario.papel, profissionalId: usuario.papel === 'profissional' ? profissional?.id ?? null : null, fusoHorario: FUSO_DEMO }
}

export const entrarComoDemo = (usuarioId: string) => escrever(sessao(), CHAVE_PERFIL_DEMO, usuarioId)
export const sairDaDemo = () => escrever(sessao(), CHAVE_PERFIL_DEMO, null)

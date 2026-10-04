// Gestão de usuários pela Administração (seção 4 do PRD).
// Criar contas e bloquear acesso exige a chave de serviço, que nunca vai para o navegador.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Login por nome de usuário: o Supabase Auth exige e-mail, então cada conta usa <usuario>@DOMINIO_LOGIN.
// O domínio .invalid é reservado e nunca recebe mensagens. Mesmo valor de src/lib/acesso.ts.
const DOMINIO_LOGIN = 'usuarios.beautytn.invalid'
const FORMATO_USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/

const papeis = ['admin', 'secretaria', 'profissional'] as const
type Papel = typeof papeis[number]

class ErroDeUso extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } })

const texto = (valor: unknown, campo: string, max: number) => {
  const limpo = typeof valor === 'string' ? valor.trim() : ''
  if (!limpo) throw new ErroDeUso(`Informe ${campo}.`)
  if (limpo.length > max) throw new ErroDeUso(`${campo[0].toUpperCase()}${campo.slice(1)} deve ter no máximo ${max} caracteres.`)
  return limpo
}

const validarPapel = (valor: unknown): Papel => {
  if (!papeis.includes(valor as Papel)) throw new ErroDeUso('Perfil inválido.')
  return valor as Papel
}

const validarSenha = (valor: unknown) => {
  if (typeof valor !== 'string' || valor.length < 8 || valor.length > 72) throw new ErroDeUso('A senha deve ter entre 8 e 72 caracteres.')
  return valor
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos })
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new ErroDeUso('Sessão expirada. Entre novamente.', 401)
    const { data: autenticado, error: erroSessao } = await admin.auth.getUser(token)
    if (erroSessao || !autenticado.user) throw new ErroDeUso('Sessão expirada. Entre novamente.', 401)
    const solicitante = autenticado.user.id

    const { data: perfil } = await admin.from('perfis').select('papel, ativo').eq('usuario_id', solicitante).maybeSingle()
    if (!perfil?.ativo || perfil.papel !== 'admin') throw new ErroDeUso('Você não tem permissão para esta ação.', 403)

    const corpo = await req.json().catch(() => null)
    if (!corpo || typeof corpo !== 'object') throw new ErroDeUso('Requisição inválida.')
    const { acao } = corpo as { acao?: string }

    // Vincula a conta ao cadastro do profissional (no máximo um vínculo por conta e por profissional).
    // Obrigatório para o perfil profissional; opcional para a administradora que também atende.
    // O vínculo não concede acesso: as permissões vêm somente de perfis.papel.
    const vincularProfissional = async (usuarioId: string, papel: Papel, profissionalId: unknown) => {
      const { error: erroLimpeza } = await admin.from('profissionais').update({ usuario_id: null, atualizado_por: solicitante }).eq('usuario_id', usuarioId)
      if (erroLimpeza) throw erroLimpeza
      if (papel === 'secretaria') return
      if (papel === 'admin' && (typeof profissionalId !== 'string' || !profissionalId)) return
      if (typeof profissionalId !== 'string' || !profissionalId) throw new ErroDeUso('Selecione o profissional vinculado a esta conta.')
      const { data: alvo } = await admin.from('profissionais').select('id, usuario_id').eq('id', profissionalId).maybeSingle()
      if (!alvo) throw new ErroDeUso('Profissional não encontrado.')
      if (alvo.usuario_id && alvo.usuario_id !== usuarioId) throw new ErroDeUso('Este profissional já está vinculado a outra conta.')
      const { error } = await admin.from('profissionais').update({ usuario_id: usuarioId, atualizado_por: solicitante }).eq('id', profissionalId)
      if (error) throw error
    }

    if (acao === 'criar') {
      const usuario = texto(corpo.usuario, 'o usuário', 30).toLowerCase()
      if (!FORMATO_USUARIO.test(usuario)) throw new ErroDeUso('O usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado, começando por letra ou número.')
      const email = `${usuario}@${DOMINIO_LOGIN}`
      const nome = texto(corpo.nome, 'o nome', 120)
      const papel = validarPapel(corpo.papel)
      const senha = validarSenha(corpo.senha)

      const { data: criado, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new ErroDeUso('Este usuário já existe.')
        throw error
      }
      const usuarioId = criado.user.id
      try {
        const { error: erroPerfil } = await admin.from('perfis').insert({ usuario_id: usuarioId, nome, papel, atualizado_por: solicitante })
        if (erroPerfil) throw erroPerfil
        await vincularProfissional(usuarioId, papel, corpo.profissional_id)
      } catch (falha) {
        // Desfaz a conta recém-criada para não deixar acesso sem perfil.
        await admin.auth.admin.deleteUser(usuarioId)
        throw falha
      }
      return resposta({ usuario_id: usuarioId })
    }

    if (acao === 'atualizar') {
      const usuarioId = texto(corpo.usuario_id, 'o usuário', 64)
      const nome = texto(corpo.nome, 'o nome', 120)
      const papel = validarPapel(corpo.papel)
      const ativo = corpo.ativo !== false
      if (usuarioId === solicitante && (!ativo || papel !== 'admin')) {
        throw new ErroDeUso('Você não pode remover o próprio acesso de administração.')
      }
      const { data: existente } = await admin.from('perfis').select('usuario_id').eq('usuario_id', usuarioId).maybeSingle()
      if (!existente) throw new ErroDeUso('Usuário não encontrado.')

      // O banco recusa deixar a clínica sem administrador ativo (gatilho perfis_preservar_ultimo_admin).
      const { error } = await admin.from('perfis').update({ nome, papel, ativo, atualizado_por: solicitante }).eq('usuario_id', usuarioId)
      if (error) throw error
      await vincularProfissional(usuarioId, papel, corpo.profissional_id)
      // Conta desativada perde o login; o perfil e o histórico permanecem.
      const { error: erroBloqueio } = await admin.auth.admin.updateUserById(usuarioId, { ban_duration: ativo ? 'none' : '876000h' })
      if (erroBloqueio) throw erroBloqueio
      return resposta({ ok: true })
    }

    if (acao === 'redefinir_senha') {
      const usuarioId = texto(corpo.usuario_id, 'o usuário', 64)
      const senha = validarSenha(corpo.senha)
      const { error } = await admin.auth.admin.updateUserById(usuarioId, { password: senha })
      if (error) throw error
      return resposta({ ok: true })
    }

    throw new ErroDeUso('Ação desconhecida.')
  } catch (falha) {
    if (falha instanceof ErroDeUso) return resposta({ erro: falha.message }, falha.status)
    // Regras do banco (código P0001) trazem mensagem escrita para o usuário.
    if (falha && typeof falha === 'object' && (falha as { code?: string }).code === 'P0001') {
      return resposta({ erro: (falha as { message: string }).message }, 400)
    }
    console.error('gerenciar-usuarios', falha instanceof Error ? falha.message : falha)
    return resposta({ erro: 'Não foi possível concluir a operação. Tente novamente.' }, 500)
  }
})

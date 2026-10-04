// Login por nome de usuário: o Supabase Auth exige e-mail, então cada conta usa <usuario>@DOMINIO_LOGIN.
// O domínio .invalid é reservado e nunca recebe mensagens. Mesmo valor da função gerenciar-usuarios.
export const DOMINIO_LOGIN = 'usuarios.beautytn.invalid'

export const FORMATO_USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/

/** Aceita o nome de usuário (caminho normal) ou um e-mail completo. */
export const emailDeAcesso = (usuario: string) => {
  const limpo = usuario.trim().toLowerCase()
  return limpo.includes('@') ? limpo : `${limpo}@${DOMINIO_LOGIN}`
}

export const usuarioDoEmail = (email: string) => email.endsWith(`@${DOMINIO_LOGIN}`) ? email.slice(0, -(DOMINIO_LOGIN.length + 1)) : email

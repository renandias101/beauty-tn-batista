export const somenteDigitos = (valor: string) => valor.replace(/\D/g, '')

/** Formata enquanto digita: (11) 98765-4321 ou (11) 3456-7890. Números fora do padrão ficam como digitados. */
export const formatarTelefone = (valor: string) => {
  const digitos = somenteDigitos(valor)
  if (digitos.length > 11) return valor
  if (digitos.length <= 2) return digitos ? `(${digitos}` : ''
  const ddd = digitos.slice(0, 2)
  const numero = digitos.slice(2)
  if (numero.length <= 4) return `(${ddd}) ${numero}`
  const corte = numero.length === 9 ? 5 : 4
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`
}

export const telefoneValido = (valor: string) => {
  const total = somenteDigitos(valor).length
  return total >= 8 && total <= 15
}

/** Link para contato manual pelo WhatsApp (seção 5 do PRD). Assume DDI 55 quando o número tem DDD brasileiro. */
export const linkWhatsApp = (valor: string) => {
  const digitos = somenteDigitos(valor)
  const completo = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
  return `https://wa.me/${completo}`
}

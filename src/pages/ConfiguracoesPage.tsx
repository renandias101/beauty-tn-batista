import { useEffect, useState, type FormEvent } from 'react'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { usePerfil } from '../auth/Sessao'
import { useAvisos } from '../components/Avisos'
import { CabecalhoPagina, Carregando, FalhaCarregamento } from '../components/Basicos'
import { mensagemDeErro } from '../lib/erros'
import { formatarTelefone, somenteDigitos } from '../lib/telefone'
import { useCarregar } from '../lib/useCarregar'
import { obterConfiguracao, salvarConfiguracao } from '../services/administracao'

/** Configurações da clínica usadas pela consulta pública (perfil Administração). */
export function ConfiguracoesPage() {
  const perfil = usePerfil()
  const avisar = useAvisos()
  const config = useCarregar(obterConfiguracao, [])
  const [whatsapp, setWhatsapp] = useState('')
  const [horizonte, setHorizonte] = useState('30')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const linkPublico = `${window.location.origin}/#/horarios`

  useEffect(() => {
    if (!config.dados) return
    setWhatsapp(config.dados.whatsapp ? formatarTelefone(config.dados.whatsapp) : '')
    setHorizonte(String(config.dados.horizonteDias))
  }, [config.dados])

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return
    const digitos = somenteDigitos(whatsapp)
    const dias = Number(horizonte)
    if (digitos && (digitos.length < 10 || digitos.length > 15)) { setErro('Informe o WhatsApp com DDD (10 a 15 dígitos).'); return }
    if (!Number.isInteger(dias) || dias < 1 || dias > 90) { setErro('O horizonte deve ser de 1 a 90 dias.'); return }
    setSalvando(true)
    setErro('')
    try {
      await salvarConfiguracao({ whatsapp: digitos || null, horizonteDias: dias }, perfil.usuarioId)
      avisar('Configurações salvas.')
      config.recarregar()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setSalvando(false)
    }
  }

  const copiar = async () => {
    try { await navigator.clipboard.writeText(linkPublico); avisar('Link copiado.') } catch { avisar('Não foi possível copiar. Selecione o endereço e copie manualmente.', 'erro') }
  }

  return (
    <div>
      <CabecalhoPagina sobretitulo="Administração" titulo="Configurações" descricao="Dados usados pela página pública de consulta de horários." />
      {config.erro ? <FalhaCarregamento mensagem={config.erro} onTentar={config.recarregar} /> : !config.dados ? <Carregando /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={salvar} className="cartao space-y-4 p-5">
            <h2 className="titulo text-lg">Consulta pública</h2>
            <label className="rotulo">WhatsApp da clínica
              <input className="campo" inputMode="tel" maxLength={20} placeholder="(11) 98765-4321" value={whatsapp} onChange={e => setWhatsapp(formatarTelefone(e.target.value))} />
              <span className="mt-1 block font-normal">Recebe as solicitações dos visitantes. Sem número, o botão “Solicitar pelo WhatsApp” fica desativado.</span>
            </label>
            <label className="rotulo">Dias à frente que o visitante pode consultar
              <input className="campo" type="number" min={1} max={90} required value={horizonte} onChange={e => setHorizonte(e.target.value)} />
            </label>
            <div>
              <div className="rotulo">Fuso da clínica</div>
              <p className="mt-1 text-sm">{config.dados.fusoHorario} <span className="text-muted-foreground">(alterado somente na implantação)</span></p>
            </div>
            {erro && <p role="alert" className="alerta-erro">{erro}</p>}
            <div className="flex justify-end"><button type="submit" disabled={salvando} className="botao botao-primario">{salvando && <Loader2 size={16} className="animate-spin" />}Salvar</button></div>
          </form>
          <section className="cartao space-y-3 p-5">
            <h2 className="titulo text-lg">Link para visitantes</h2>
            <p className="text-sm text-muted-foreground">Compartilhe este endereço para que clientes consultem horários livres sem login. A página não mostra dados de clientes nem cria reservas.</p>
            <p className="break-all rounded-lg bg-muted p-3 text-sm font-semibold">{linkPublico}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copiar} className="botao botao-secundario botao-pequeno"><Copy size={14} />Copiar link</button>
              <a href="#/horarios" target="_blank" rel="noreferrer" className="botao botao-texto botao-pequeno"><ExternalLink size={14} />Abrir página</a>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

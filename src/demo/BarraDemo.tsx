import { useState } from 'react'
import { RotateCcw, UserRoundCog } from 'lucide-react'
import { useSessao } from '../auth/Sessao'
import { Modal } from '../components/Modal'
import { FaixaDemo } from './EntradaDemo'
import { restaurarDemonstracao } from './estado'

/** Faixa da área logada: identifica a demonstração, permite trocar de perfil e restaurar os dados fictícios. */
export function BarraDemo() {
  const { sair } = useSessao()
  const [confirmando, setConfirmando] = useState(false)
  const restaurar = () => { restaurarDemonstracao(); window.location.reload() }

  return (
    <>
      <FaixaDemo fixa>
        <button type="button" onClick={sair} aria-label="Trocar perfil" className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold underline-offset-2 hover:underline"><UserRoundCog size={14} /><span className="hidden sm:inline">Trocar perfil</span></button>
        <button type="button" onClick={() => setConfirmando(true)} aria-label="Restaurar demonstração" className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold underline-offset-2 hover:underline"><RotateCcw size={14} /><span className="hidden sm:inline">Restaurar demonstração</span></button>
      </FaixaDemo>
      {confirmando && (
        <Modal titulo="Restaurar demonstração" onFechar={() => setConfirmando(false)}
          rodape={<>
            <button type="button" onClick={() => setConfirmando(false)} className="botao botao-texto">Voltar</button>
            <button type="button" onClick={restaurar} className="botao botao-primario">Restaurar dados fictícios</button>
          </>}>
          <p className="text-sm text-muted-foreground">
            Os dados fictícios voltam ao estado inicial, com datas a partir de hoje. Alterações feitas durante a demonstração serão descartadas.
            Somente os dados da demonstração deste navegador são afetados; nenhum dado real é lido ou alterado.
          </p>
        </Modal>
      )}
    </>
  )
}

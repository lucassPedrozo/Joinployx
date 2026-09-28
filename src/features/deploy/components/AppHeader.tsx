import { Loader2, RefreshCcw, Settings, ShieldCheck } from 'lucide-react'

type AppHeaderProps = {
  organization: string
  isRefreshing: boolean
  onRefresh: () => void
  /** Ausente quando o painel é acessado de outra máquina da rede. */
  onOpenSettings?: () => void
}

export function AppHeader({ organization, isRefreshing, onRefresh, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Joinvix Deploy — início">
        <span className="brand-mark"><img src="/favicon.png" alt="" /></span>
        <span>
          <strong>Joinvix Deploy</strong>
          <small>Painel de publicação</small>
        </span>
      </a>
      <div className="header-actions">
        <span className="connection-badge" title={`API conectada à organização ${organization}`}>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>API protegida</span>
        </span>
        <button type="button" className="button button-secondary" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCcw size={16} aria-hidden="true" />}
          Atualizar
        </button>
        {onOpenSettings ? (
          <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="Configurações do painel" title="Configurações do painel">
            <Settings size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

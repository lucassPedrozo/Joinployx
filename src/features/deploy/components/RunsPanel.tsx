import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCcw, XCircle } from 'lucide-react'
import type { WorkflowRun } from '../../../shared/deploy'
import { isRunActive } from '../runs'

type RunsPanelProps = {
  runs: WorkflowRun[]
  isLoading: boolean
  isLive: boolean
  hasRepo: boolean
  onRefresh: () => void
  formatDate: (value?: string) => string
}

const describe = (run: WorkflowRun) => {
  if (isRunActive(run)) return { label: 'Em execução', tone: 'running' as const, Icon: Loader2 }
  switch (run.conclusion) {
    case 'success': return { label: 'Sucesso', tone: 'success' as const, Icon: CheckCircle2 }
    case 'failure': return { label: 'Falhou', tone: 'failure' as const, Icon: XCircle }
    case 'cancelled': return { label: 'Cancelado', tone: 'neutral' as const, Icon: XCircle }
    case 'skipped': return { label: 'Ignorado', tone: 'neutral' as const, Icon: Clock3 }
    case 'timed_out': return { label: 'Tempo esgotado', tone: 'failure' as const, Icon: AlertTriangle }
    default: return { label: run.conclusion ?? 'Concluído', tone: 'neutral' as const, Icon: AlertTriangle }
  }
}

export function RunsPanel({ runs, isLoading, isLive, hasRepo, onRefresh, formatDate }: RunsPanelProps) {
  return (
    <section className="panel runs-panel" aria-labelledby="runs-title">
      <div className="panel-heading workflow-heading">
        <span className="step-badge step-subtle">5</span>
        <div><p className="panel-kicker">Acompanhamento</p><h2 id="runs-title">Execuções recentes</h2></div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={!hasRepo || isLoading} aria-label="Atualizar execuções">
          {isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
        </button>
      </div>

      {isLive ? <p className="runs-live"><Loader2 className="spin" size={14} aria-hidden="true" /> Atualizando automaticamente enquanto houver execução em andamento.</p> : null}

      <div className="runs-list" aria-live="polite">
        {!hasRepo ? (
          <div className="empty-state"><Clock3 size={26} /><strong>Escolha um repositório</strong><p>O histórico do GitHub Actions aparece aqui.</p></div>
        ) : runs.length === 0 ? (
          <div className="empty-state"><Clock3 size={26} /><strong>Nenhuma execução ainda</strong><p>{isLoading ? 'Consultando o GitHub…' : 'Publique para ver o progresso em tempo real.'}</p></div>
        ) : runs.map((run) => {
          const { label, tone, Icon } = describe(run)
          return (
            <article className={`run-row run-${tone}`} key={run.id}>
              <span className="run-icon"><Icon size={18} className={tone === 'running' ? 'spin' : ''} aria-hidden="true" /></span>
              <div className="run-body">
                <strong>{run.name} #{run.runNumber}</strong>
                <p>{run.title || run.event} · {formatDate(run.updatedAt)}</p>
              </div>
              <span className={`run-status run-status-${tone}`}>{label}</span>
              <a className="icon-button" href={run.url} target="_blank" rel="noreferrer noopener" aria-label={`Abrir execução ${run.runNumber} no GitHub`}>
                <ExternalLink size={16} />
              </a>
            </article>
          )
        })}
      </div>
    </section>
  )
}

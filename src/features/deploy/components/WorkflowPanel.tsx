import { AlertTriangle, Eye, FileCode2, Loader2, PlayCircle, Rocket, Trash2 } from 'lucide-react'
import type { RepoOption, WorkflowFile } from '../../../shared/deploy'

type WorkflowPanelProps = {
  selectedRepo?: RepoOption
  files: WorkflowFile[]
  totalSize: string
  isChecking: boolean
  isPublishing: boolean
  isClearing: boolean
  isDispatching: boolean
  canDeploy: boolean
  dryRun: boolean
  outdatedWorkflows: string[]
  onPreview: (file: WorkflowFile) => void
  onClear: () => void
  onDeploy: () => void
  onDryRunChange: (value: boolean) => void
  formatBytes: (value: number) => string
}

export function WorkflowPanel(props: WorkflowPanelProps) {
  const {
    selectedRepo, files, totalSize, isChecking, isPublishing, isClearing, isDispatching,
    canDeploy, dryRun, outdatedWorkflows, onPreview, onClear, onDeploy, onDryRunChange, formatBytes,
  } = props
  const status = isChecking ? 'Verificando' : files.length ? 'Pronto' : selectedRepo ? 'Sem workflows' : 'Aguardando'
  const busy = isPublishing || isClearing || isDispatching

  return (
    <section className="panel workflow-panel" aria-labelledby="workflow-title">
      <div className="panel-heading workflow-heading">
        <span className="step-badge">3</span>
        <div><p className="panel-kicker">Revisão</p><h2 id="workflow-title">Workflows atuais</h2></div>
        <span className={`status-badge status-${status.toLowerCase().replace(' ', '-')}`}>
          {isChecking ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}{status}
        </span>
      </div>

      <div className="workflow-summary" aria-label="Resumo dos workflows">
        <div><strong>{files.length}</strong><span>arquivos</span></div>
        <div><strong>{totalSize}</strong><span>tamanho total</span></div>
        <div><strong>{selectedRepo?.defaultBranch ?? '—'}</strong><span>branch</span></div>
      </div>

      <div className="workflow-list" aria-live="polite" aria-busy={isChecking}>
        {isChecking ? (
          <div className="empty-state"><Loader2 className="spin" size={26} /><strong>Consultando o GitHub</strong><p>Isso deve levar apenas alguns segundos.</p></div>
        ) : files.length ? files.map((file) => (
          <article className="workflow-row" key={file.sha}>
            <span className="file-icon"><FileCode2 size={18} aria-hidden="true" /></span>
            <div className="workflow-file"><strong>{file.name}</strong><p>{file.path}</p></div>
            <span className="file-size">{formatBytes(file.size)}</span>
            <button type="button" className="icon-button" onClick={() => onPreview(file)} aria-label={`Visualizar ${file.name}`}><Eye size={17} /></button>
          </article>
        )) : (
          <div className="empty-state"><FileCode2 size={28} /><strong>{selectedRepo ? 'Nenhum workflow encontrado' : 'Escolha um repositório'}</strong><p>{selectedRepo ? 'Os dois workflows padrão serão criados ao publicar.' : 'Os arquivos aparecerão aqui para revisão.'}</p></div>
        )}
      </div>

      {outdatedWorkflows.length ? (
        <p className="workflow-outdated" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>Workflow desatualizado</strong> — {outdatedWorkflows.join(' e ')} {outdatedWorkflows.length > 1 ? 'foram gerados' : 'foi gerado'} por
            uma versão anterior do painel. Use <strong>Salvar configuração</strong> para atualizar antes de publicar.
          </span>
        </p>
      ) : null}

      <div className="action-area">
        <div className="action-copy">
          <span className="step-badge step-subtle">4</span>
          <div><strong>Configurar e publicar</strong><p>Grava secrets e workflows; em seguida dispara o deploy.</p></div>
        </div>

        <label className="inline-check">
          <input type="checkbox" checked={dryRun} onChange={(event) => onDryRunChange(event.target.checked)} disabled={busy} />
          <span>Simular envio (dry-run)</span>
        </label>

        <div className="action-buttons">
          <button type="button" className="button button-danger" onClick={onClear} disabled={!selectedRepo || !files.length || isChecking || busy}>
            {isClearing ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}<span>Limpar</span>
          </button>
          <button type="submit" className="button button-secondary" disabled={!selectedRepo || busy}>
            {isPublishing ? <Loader2 className="spin" size={16} /> : <Rocket size={16} />}{isPublishing ? 'Configurando…' : 'Salvar configuração'}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onDeploy}
            disabled={!selectedRepo || !canDeploy || busy}
            title={canDeploy ? undefined : 'Salve a configuração primeiro para criar o workflow de deploy.'}
          >
            {isDispatching ? <Loader2 className="spin" size={16} /> : <PlayCircle size={16} />}
            {isDispatching ? 'Enviando…' : dryRun ? 'Simular publicação' : 'Publicar agora'}
          </button>
        </div>
      </div>
    </section>
  )
}

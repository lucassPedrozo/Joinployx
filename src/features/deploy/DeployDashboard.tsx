import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, FileCode2, GitBranch, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { ApiError, deployApi, getStoredAccessToken, storeAccessToken } from '../../lib/api'
import type {
  ApiStatus,
  DeleteWorkflowResult,
  PublicationResult,
  PublicationSettings,
  RepoOption,
  WorkflowFile,
  WorkflowRun,
} from '../../shared/deploy'
import { AccessGate } from './components/AccessGate'
import { AppHeader } from './components/AppHeader'
import { NoticeBanner } from './components/NoticeBanner'
import { RepositoryPanel } from './components/RepositoryPanel'
import { RunsPanel } from './components/RunsPanel'
import { SettingsScreen } from './components/SettingsScreen'
import { WorkflowPanel } from './components/WorkflowPanel'
import type { Notice, PreviewContent, ValidationErrors } from './deploy.types'
import { isRunActive } from './runs'
import { emptySettings, getLastFtpServer, loadSettings, saveSettings } from './settings-store'

const DEFAULT_DEPLOY_WORKFLOW = 'Deploy-via-FTP.yml'
const RUN_POLL_INTERVAL_MS = 6_000

const formatDate = (value?: string) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : '—'

const formatBytes = (value: number) => {
  if (!value) return '0 KB'
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

const isValidDomain = (value: string) => /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value)
const isValidHost = (value: string) => /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value)

const initialSettings = (): PublicationSettings => ({
  ...emptySettings,
  ftpServer: getLastFtpServer(),
  ftpPassword: '',
})

export function DeployDashboard() {
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [startupError, setStartupError] = useState('')
  const [accessRequired, setAccessRequired] = useState(false)
  const [accessError, setAccessError] = useState('')
  const [repos, setRepos] = useState<RepoOption[]>([])
  const [selectedRepoId, setSelectedRepoId] = useState('')
  const [workflowFiles, setWorkflowFiles] = useState<WorkflowFile[]>([])
  const [settings, setSettings] = useState<PublicationSettings>(initialSettings)
  const [showPassword, setShowPassword] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [isCheckingWorkflow, setIsCheckingWorkflow] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isDispatching, setIsDispatching] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isClearModalOpen, setIsClearModalOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState<PreviewContent | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [publicationResult, setPublicationResult] = useState<PublicationResult | null>(null)
  const [deleteResult, setDeleteResult] = useState<DeleteWorkflowResult | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId),
    [repos, selectedRepoId]
  )
  const totalWorkflowSize = useMemo(
    () => formatBytes(workflowFiles.reduce((total, file) => total + file.size, 0)),
    [workflowFiles]
  )
  const deployWorkflowFile = status?.deployWorkflowFile ?? DEFAULT_DEPLOY_WORKFLOW
  const canDeploy = useMemo(
    () => workflowFiles.some((file) => file.name.toLowerCase() === deployWorkflowFile.toLowerCase()),
    [workflowFiles, deployWorkflowFile]
  )
  const hasActiveRun = useMemo(() => runs.some(isRunActive), [runs])
  // Só os workflows gerados pelo painel trazem templateVersion; um valor
  // diferente do atual significa que o repositório roda uma versão antiga.
  const outdatedWorkflows = useMemo(
    () => workflowFiles
      .filter((file) => file.templateVersion !== undefined && file.templateVersion !== status?.workflowTemplateVersion)
      .map((file) => file.name),
    [workflowFiles, status?.workflowTemplateVersion]
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3200)
  }, [])

  const handleApiError = useCallback((error: unknown, title: string) => {
    if (error instanceof ApiError && error.status === 401) {
      storeAccessToken('')
      setAccessError(error.message)
      setAccessRequired(true)
      return
    }
    setNotice({
      kind: 'error',
      title,
      message: error instanceof Error ? error.message : 'Tente novamente em alguns instantes.',
    })
  }, [])

  const loadRepos = useCallback(async () => {
    try {
      setIsLoadingRepos(true)
      const data = await deployApi.listRepos()
      setRepos(data)
      setSelectedRepoId((current) => data.some((repo) => repo.id === current) ? current : '')
      if (!data.length) {
        setNotice({ kind: 'warning', title: 'Nenhum repositório encontrado', message: 'Verifique o acesso do token à organização configurada.' })
      }
      return true
    } catch (error) {
      handleApiError(error, 'Não foi possível carregar os repositórios')
      return false
    } finally {
      setIsLoadingRepos(false)
    }
  }, [handleApiError])

  const initialize = useCallback(async () => {
    try {
      setStartupError('')
      const apiStatus = await deployApi.getStatus()
      setStatus(apiStatus)
      if (apiStatus.defaultFtpHost) {
        setSettings((current) => (current.ftpServer ? current : { ...current, ftpServer: apiStatus.defaultFtpHost }))
      }
      if (!apiStatus.githubConfigured) {
        setNotice({ kind: 'warning', title: 'GitHub não configurado', message: 'Defina GITHUB_TOKEN no servidor antes de usar o painel.' })
      }
      if (apiStatus.authenticationRequired && !getStoredAccessToken()) {
        setAccessRequired(true)
      } else {
        await loadRepos()
      }
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'A API web não respondeu.')
    }
  }, [loadRepos])

  useEffect(() => {
    void Promise.resolve().then(initialize)
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [initialize])

  const refreshWorkflows = useCallback(async (repo: RepoOption) => {
    try {
      setIsCheckingWorkflow(true)
      setWorkflowFiles(await deployApi.listWorkflowFiles(repo.owner, repo.name, repo.defaultBranch))
    } catch (error) {
      setWorkflowFiles([])
      handleApiError(error, 'Falha ao verificar workflows')
    } finally {
      setIsCheckingWorkflow(false)
    }
  }, [handleApiError])

  const refreshRuns = useCallback(async (repo: RepoOption, options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setIsLoadingRuns(true)
      setRuns(await deployApi.listRuns(repo.owner, repo.name, repo.defaultBranch, deployWorkflowFile))
    } catch (error) {
      // O histórico é informativo: falhar aqui não deve interromper o fluxo.
      if (!options.silent) handleApiError(error, 'Não foi possível carregar as execuções')
    } finally {
      if (!options.silent) setIsLoadingRuns(false)
    }
  }, [deployWorkflowFile, handleApiError])

  useEffect(() => {
    void Promise.resolve().then(async () => {
      if (!selectedRepo) {
        setWorkflowFiles([])
        setRuns([])
        return
      }

      // A senha continua em memória: só os dados não sensíveis são recuperados.
      setSettings((current) => ({ ...loadSettings(selectedRepo.fullName), ftpPassword: current.ftpPassword }))
      await Promise.all([refreshWorkflows(selectedRepo), refreshRuns(selectedRepo)])
    })
  }, [refreshRuns, refreshWorkflows, selectedRepo])

  // Enquanto houver execução em andamento o painel se atualiza sozinho, para o
  // operador não precisar abrir o GitHub para saber se o deploy terminou.
  useEffect(() => {
    if (!selectedRepo || !hasActiveRun) return

    const timer = window.setInterval(() => {
      void refreshRuns(selectedRepo, { silent: true })
    }, RUN_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [hasActiveRun, refreshRuns, selectedRepo])

  const handleAccess = async (token: string) => {
    storeAccessToken(token)
    setAccessError('')
    const success = await loadRepos()
    if (success) setAccessRequired(false)
    else setAccessError('Não foi possível entrar com esta chave.')
  }

  const updateSettings = (patch: Partial<PublicationSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof ValidationErrors]
      return next
    })
  }

  const validate = () => {
    const nextErrors: ValidationErrors = {}
    if (!selectedRepo) nextErrors.repo = 'Selecione um repositório.'
    if (!settings.domain.trim()) nextErrors.domain = 'Informe o domínio.'
    else if (!isValidDomain(settings.domain.trim())) nextErrors.domain = 'Use apenas o domínio, sem https:// ou caminho.'
    if (!settings.ftpServer.trim()) nextErrors.ftpServer = 'Informe o servidor FTP.'
    else if (!isValidHost(settings.ftpServer.trim())) nextErrors.ftpServer = 'Use apenas o host, sem ftp:// ou barra.'
    if (!settings.ftpLogin.trim()) nextErrors.ftpLogin = 'Informe o login FTP.'
    if (!settings.ftpPassword.trim()) nextErrors.ftpPassword = 'Informe a senha FTP.'
    if (settings.serverDir.includes('..')) nextErrors.serverDir = 'A pasta remota não pode conter "..".'
    if (settings.port.trim() && !/^\d{1,5}$/.test(settings.port.trim())) nextErrors.port = 'Informe apenas números.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handlePublish = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate() || !selectedRepo) {
      showToast('Revise os campos destacados.')
      return
    }

    try {
      setIsPublishing(true)
      setNotice({ kind: 'info', title: 'Configurando publicação', message: 'Criando secrets e atualizando workflows com segurança.' })
      setPublicationResult(null)
      setDeleteResult(null)
      const result = await deployApi.configurePublication({
        ...settings,
        domain: settings.domain.trim(),
        ftpServer: settings.ftpServer.trim(),
        ftpLogin: settings.ftpLogin.trim(),
        serverDir: settings.serverDir.trim(),
        port: settings.port.trim(),
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedRepo.defaultBranch,
      })
      setPublicationResult(result)
      // Tudo menos a senha volta preenchido na próxima publicação.
      saveSettings(selectedRepo.fullName, {
        domain: settings.domain.trim(),
        ftpServer: settings.ftpServer.trim(),
        ftpLogin: settings.ftpLogin.trim(),
        serverDir: settings.serverDir.trim(),
        protocol: settings.protocol,
        port: settings.port.trim(),
        autoDeploy: settings.autoDeploy,
        buildEnv: settings.buildEnv,
      })
      setNotice({ kind: 'success', title: 'Publicação configurada', message: 'Agora use "Publicar agora" para disparar o deploy.' })
      showToast('Configuração salva com sucesso.')
      await refreshWorkflows(selectedRepo)
    } catch (error) {
      handleApiError(error, 'Falha ao configurar publicação')
      showToast('Não foi possível concluir a configuração.')
    } finally {
      setIsPublishing(false)
    }
  }

  const handleDeploy = async () => {
    if (!selectedRepo) return
    try {
      setIsDispatching(true)
      await deployApi.dispatchDeploy(selectedRepo.owner, selectedRepo.name, selectedRepo.defaultBranch, dryRun, deployWorkflowFile)
      setNotice({
        kind: 'success',
        title: dryRun ? 'Simulação iniciada' : 'Publicação iniciada',
        message: 'Acompanhe o progresso na lista de execuções abaixo.',
      })
      showToast(dryRun ? 'Simulação enviada.' : 'Deploy enviado ao GitHub Actions.')
      // O run leva alguns segundos para aparecer na API.
      window.setTimeout(() => { void refreshRuns(selectedRepo, { silent: true }) }, 2500)
      await refreshRuns(selectedRepo, { silent: true })
    } catch (error) {
      handleApiError(error, 'Falha ao disparar a publicação')
    } finally {
      setIsDispatching(false)
    }
  }

  const confirmClear = async () => {
    if (!selectedRepo || !workflowFiles.length) return
    setIsClearModalOpen(false)
    try {
      setIsClearing(true)
      setPublicationResult(null)
      setDeleteResult(null)
      const result = await deployApi.deleteWorkflowFiles({
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedRepo.defaultBranch,
        files: workflowFiles,
      })
      setDeleteResult(result)
      setNotice({
        kind: result.status === 'success' ? 'success' : 'warning',
        title: result.status === 'success' ? 'Workflows removidos' : 'Limpeza concluída com ressalvas',
        message: result.status === 'success' ? 'Os arquivos gerenciáveis foram removidos.' : 'Alguns arquivos não puderam ser removidos; consulte o resumo.',
      })
      await refreshWorkflows(selectedRepo)
    } catch (error) {
      handleApiError(error, 'Falha ao limpar workflows')
    } finally {
      setIsClearing(false)
    }
  }

  const previewFile = async (file: WorkflowFile) => {
    if (!selectedRepo) return
    try {
      const content = await deployApi.getWorkflowPreview(selectedRepo.owner, selectedRepo.name, selectedRepo.defaultBranch, file.path)
      setPreviewContent({ name: file.name, content })
    } catch (error) {
      handleApiError(error, 'Preview indisponível')
    }
  }

  const clearFtpFields = () => {
    setSettings({ ...emptySettings, ftpPassword: '' })
    setErrors({})
    setPublicationResult(null)
    setDeleteResult(null)
    showToast('Campos de publicação limpos.')
  }

  const closeClearModal = useCallback(() => setIsClearModalOpen(false), [])
  const closePreview = useCallback(() => setPreviewContent(null), [])
  const handleRefreshRuns = useCallback(() => {
    if (selectedRepo) void refreshRuns(selectedRepo)
  }, [refreshRuns, selectedRepo])

  if (!status && !startupError) {
    return <main className="loading-page"><Loader2 className="spin" size={28} /><strong>Preparando o painel…</strong></main>
  }

  if (startupError) {
    return (
      <main className="loading-page error-page">
        <span className="access-icon"><ShieldCheck size={24} /></span>
        <strong>Não foi possível conectar à API</strong><p>{startupError}</p>
        <button type="button" className="button button-primary" onClick={initialize}>Tentar novamente</button>
      </main>
    )
  }

  if (accessRequired) return <AccessGate message={accessError} onSubmit={handleAccess} />

  const setupRequired = status?.setupRequired ?? false

  if (setupRequired && !status?.configurable) {
    return (
      <main className="loading-page error-page">
        <span className="access-icon"><ShieldCheck size={24} /></span>
        <strong>Painel ainda não configurado</strong>
        <p>
          O token do GitHub e a organização precisam ser definidos na máquina que executa o painel.
          Abra o painel em <code>http://localhost:{'{'}porta{'}'}</code> nessa máquina para concluir a configuração.
        </p>
      </main>
    )
  }

  if (showSettings || setupRequired) {
    return (
      <SettingsScreen
        isOnboarding={setupRequired}
        onClose={() => setShowSettings(false)}
        onError={handleApiError}
        onSaved={() => {
          setShowSettings(false)
          showToast('Configurações salvas.')
          void initialize()
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <AppHeader
        organization={status?.organization ?? ''}
        isRefreshing={isLoadingRepos}
        onRefresh={loadRepos}
        onOpenSettings={status?.configurable ? () => setShowSettings(true) : undefined}
      />
      <main className="page-container">
        <section className="hero">
          <div><p className="eyebrow">GitHub Actions + FTP</p><h1>Deploys consistentes, sem credenciais expostas.</h1><p className="hero-description">Configure secrets, revise workflows, dispare a publicação e acompanhe o resultado sem sair do painel.</p></div>
          <div className="active-repository"><span>Repositório ativo</span><strong>{selectedRepo?.fullName ?? 'Nenhum selecionado'}</strong><small>{selectedRepo ? selectedRepo.defaultBranch : 'Aguardando configuração'}</small></div>
        </section>

        {notice ? <NoticeBanner notice={notice} onClose={() => setNotice(null)} /> : null}

        <section className="metrics-grid" aria-label="Resumo operacional">
          <article className="metric-card"><span><GitBranch size={19} /></span><div><strong>{repos.length}</strong><p>repositórios acessíveis</p></div></article>
          <article className="metric-card"><span><FileCode2 size={19} /></span><div><strong>{workflowFiles.length}</strong><p>workflows encontrados</p></div></article>
          <article className="metric-card"><span><ShieldCheck size={19} /></span><div><strong>{status?.organization}</strong><p>organização protegida</p></div></article>
        </section>

        <form className="deploy-grid" onSubmit={handlePublish} noValidate>
          <RepositoryPanel
            repos={repos} selectedRepo={selectedRepo} selectedRepoId={selectedRepoId}
            settings={settings} showPassword={showPassword}
            errors={errors} isLoading={isLoadingRepos} formatDate={formatDate}
            onRepoChange={(id) => { setSelectedRepoId(id); setErrors((current) => ({ ...current, repo: undefined })); setPublicationResult(null); setDeleteResult(null) }}
            onSettingsChange={updateSettings}
            onTogglePassword={() => setShowPassword((current) => !current)}
          />
          <WorkflowPanel
            selectedRepo={selectedRepo} files={workflowFiles} totalSize={totalWorkflowSize}
            isChecking={isCheckingWorkflow} isPublishing={isPublishing} isClearing={isClearing}
            isDispatching={isDispatching} canDeploy={canDeploy} dryRun={dryRun}
            outdatedWorkflows={outdatedWorkflows}
            onPreview={previewFile} onClear={() => setIsClearModalOpen(true)}
            onDeploy={handleDeploy} onDryRunChange={setDryRun} formatBytes={formatBytes}
          />
        </form>

        <RunsPanel
          runs={runs} isLoading={isLoadingRuns} isLive={hasActiveRun}
          hasRepo={Boolean(selectedRepo)} onRefresh={handleRefreshRuns} formatDate={formatDate}
        />

        <section className="assurance-grid">
          <article><KeyRound size={19} /><div><strong>Secrets protegidos</strong><p>As credenciais trafegam somente até a API e não são persistidas no navegador.</p></div></article>
          <article><Trash2 size={19} /><div><strong>Limpeza limitada</strong><p>Somente arquivos YAML dentro de .github/workflows podem ser removidos.</p></div></article>
          <button type="button" className="button button-secondary" onClick={clearFtpFields}>Limpar campos</button>
        </section>

        {publicationResult ? <section className="operation-summary operation-success"><CheckCircle2 size={20} /><div><strong>Workflows gravados em {publicationResult.workflowBranch}</strong><p>{publicationResult.workflowStatuses.map((item) => `${item.path} (${item.action === 'created' ? 'criado' : 'atualizado'})`).join(' · ')}</p><p>Secrets: {publicationResult.secretNames.join(', ')}</p></div></section> : null}
        {deleteResult ? <section className={`operation-summary ${deleteResult.status === 'success' ? 'operation-success' : 'operation-warning'}`}><Trash2 size={20} /><div><strong>{deleteResult.removed.length} removido(s), {deleteResult.failed.length} falha(s)</strong><p>{deleteResult.failed.length ? deleteResult.failed.map((item) => `${item.path}: ${item.message}`).join(' · ') : 'A pasta não possui mais workflows gerenciáveis.'}</p></div></section> : null}
      </main>

      {isClearModalOpen ? <Modal title="Limpar workflows?" description={`Esta ação removerá ${workflowFiles.length} arquivo(s) YAML de ${selectedRepo?.fullName}.`} onClose={closeClearModal}><div className="modal-warning"><Trash2 size={20} /><p>Essa alteração será commitada diretamente na branch <strong>{selectedRepo?.defaultBranch}</strong>.</p></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeClearModal}>Cancelar</button><button type="button" className="button button-danger-solid" onClick={confirmClear}>Sim, remover workflows</button></div></Modal> : null}
      {previewContent ? <Modal title={previewContent.name} description="Conteúdo atual no repositório" onClose={closePreview} size="wide"><pre className="code-preview"><code>{previewContent.content}</code></pre></Modal> : null}
      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  )
}

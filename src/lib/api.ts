import type {
  AccessCheckResult,
  ApiStatus,
  ConfigurePublicationInput,
  DeleteWorkflowInput,
  DeleteWorkflowResult,
  DispatchResult,
  PanelSettings,
  PanelSettingsInput,
  PublicationResult,
  RepoOption,
  WorkflowFile,
  WorkflowRun,
} from '../shared/deploy'

const ACCESS_TOKEN_KEY = 'joinvix-deploy-access-token'
const REQUEST_TIMEOUT_MS = 60_000

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const getStoredAccessToken = () => {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export const storeAccessToken = (token: string) => {
  try {
    if (token) sessionStorage.setItem(ACCESS_TOKEN_KEY, token)
    else sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  } catch {
    // Navegador com armazenamento bloqueado: o painel segue funcionando na aba.
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const accessToken = getStoredAccessToken()

  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(504, 'A API local não respondeu dentro do tempo limite.')
    }
    throw new ApiError(0, 'Não foi possível falar com a API local. Verifique se o servidor está ativo.')
  }

  const body = await response.json().catch(() => null) as { message?: string } | null
  if (!response.ok) {
    throw new ApiError(response.status, body?.message ?? 'Não foi possível concluir a solicitação.')
  }
  return body as T
}

const repositoryPath = (owner: string, repo: string) =>
  `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

export const deployApi = {
  getStatus: () => request<ApiStatus>('/api/status'),
  getSettings: () => request<PanelSettings>('/api/config'),
  saveSettings: (input: PanelSettingsInput) =>
    request<PanelSettings>('/api/config', { method: 'POST', body: JSON.stringify(input) }),
  checkAccess: (input: { githubToken?: string; organization?: string }) =>
    request<AccessCheckResult>('/api/config/check', { method: 'POST', body: JSON.stringify(input) }),
  listRepos: () => request<RepoOption[]>('/api/repositories'),
  listWorkflowFiles: (owner: string, repo: string, branch: string) =>
    request<WorkflowFile[]>(
      `${repositoryPath(owner, repo)}/workflows?branch=${encodeURIComponent(branch)}`
    ),
  listRuns: (owner: string, repo: string, branch: string, workflow?: string) => {
    const search = new URLSearchParams({ branch })
    if (workflow) search.set('workflow', workflow)
    return request<WorkflowRun[]>(`${repositoryPath(owner, repo)}/runs?${search.toString()}`)
  },
  configurePublication: (input: ConfigurePublicationInput) =>
    request<PublicationResult>(`${repositoryPath(input.owner, input.repo)}/publication`, {
      method: 'POST',
      body: JSON.stringify({
        branch: input.branch,
        domain: input.domain,
        ftpServer: input.ftpServer,
        ftpLogin: input.ftpLogin,
        ftpPassword: input.ftpPassword,
        serverDir: input.serverDir,
        protocol: input.protocol,
        port: input.port,
        buildEnv: input.buildEnv,
        autoDeploy: input.autoDeploy,
      }),
    }),
  dispatchDeploy: (owner: string, repo: string, branch: string, dryRun: boolean, workflow?: string) =>
    request<DispatchResult>(`${repositoryPath(owner, repo)}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ branch, dryRun, workflow }),
    }),
  deleteWorkflowFiles: (input: DeleteWorkflowInput) =>
    request<DeleteWorkflowResult>(`${repositoryPath(input.owner, input.repo)}/workflows`, {
      method: 'DELETE',
      body: JSON.stringify({ files: input.files, branch: input.branch }),
    }),
  getWorkflowPreview: async (owner: string, repo: string, branch: string, path: string) => {
    const result = await request<{ content: string }>(
      `${repositoryPath(owner, repo)}/workflows/preview?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
    )
    return result.content
  },
}

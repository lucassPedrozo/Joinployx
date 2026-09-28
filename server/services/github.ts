export type GitHubConfig = {
  token: string
  baseUrl: string
  userAgent: string
}

export type GitHubRepo = {
  id: number
  name: string
  full_name: string
  private: boolean
  created_at: string
  updated_at: string
  pushed_at?: string
  default_branch: string
  archived?: boolean
}

export type GitHubWorkflowRun = {
  id: number
  name: string | null
  display_title: string | null
  status: string | null
  conclusion: string | null
  run_number: number
  html_url: string
  event: string
  created_at: string
  updated_at: string
}

export type GitHubContentItem = {
  sha: string
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  size?: number
}

type GitHubContentFile = GitHubContentItem & {
  content: string
  encoding: string
}

export class GitHubRequestError extends Error {
  status: number
  /** Permissão exigida pelo endpoint, quando o GitHub informa no 403. */
  requiredPermission?: string

  constructor(message: string, status: number, requiredPermission?: string) {
    super(message)
    this.status = status
    this.requiredPermission = requiredPermission
  }
}

const defaultConfig: GitHubConfig = {
  token: '',
  baseUrl: 'https://api.github.com',
  userAgent: 'joinployx-deploy-panel',
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const MAX_PAGES = 10

export const getGitHubConfig = (
  overrides: Partial<GitHubConfig> = {}
): GitHubConfig => {
  return {
    ...defaultConfig,
    ...overrides,
  }
}

export const createGitHubHeaders = (config: GitHubConfig) => {
  const token = assertValidGitHubToken(config.token)

  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': config.userAgent,
  } satisfies Record<string, string>
}

export const getGitHubBaseUrl = (config: GitHubConfig) => config.baseUrl

const allowedTokenPrefixes = ['github_pat_']

export const assertValidGitHubToken = (token: string) => {
  const normalized = token.trim()

  if (!normalized) {
    throw new Error(
      'GitHub token não definido. Configure GITHUB_TOKEN no arquivo .env antes de continuar.'
    )
  }

  const isValidPrefix = allowedTokenPrefixes.some((prefix) =>
    normalized.startsWith(prefix)
  )

  if (!isValidPrefix) {
    throw new Error(
      'GITHUB_TOKEN inválido. Use um fine-grained personal access token (prefixo github_pat_).'
    )
  }

  return normalized
}

// A API do GitHub devolve um JSON detalhado; repassar o corpo inteiro polui a
// interface e pode vazar dados internos. Aqui fica apenas a mensagem curta.
export const describeGitHubFailure = (status: number, rawBody: string, requiredPermission?: string) => {
  let detail: string
  try {
    const parsed = JSON.parse(rawBody) as { message?: string; errors?: Array<{ message?: string }> }
    detail = parsed.message ?? ''
    const first = parsed.errors?.find((item) => item.message)?.message
    if (first && first !== detail) detail = `${detail} ${first}`.trim()
  } catch {
    detail = rawBody.slice(0, 120)
  }

  const friendly: Record<number, string> = {
    401: 'Token do GitHub inválido ou expirado.',
    403: 'O token não tem permissão para esta operação, ou o limite de uso foi atingido.',
    404: 'Recurso não encontrado no GitHub.',
    409: 'Conflito ao gravar no repositório; tente novamente.',
    422: 'O GitHub recusou os dados enviados.',
  }

  const prefix = friendly[status] ?? `A API do GitHub respondeu ${status}.`
  const parts = [prefix]
  if (status === 403 && requiredPermission) {
    parts.push(`Permissão exigida pelo token: ${requiredPermission.slice(0, 120)}.`)
  }
  if (detail) parts.push(`(${detail.slice(0, 200)})`)
  return parts.join(' ')
}

const isRetryableStatus = (status: number) =>
  status === 429 || status === 408 || (status >= 500 && status < 600)

const getRetryDelayMs = (response: Response | null, attempt: number) => {
  const retryAfter = Number(response?.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000)

  const reset = Number(response?.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const waitMs = reset * 1000 - Date.now()
    if (waitMs > 0) return Math.min(waitMs, 10_000)
  }

  return Math.min(500 * 2 ** attempt, 4_000)
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const requestRaw = async (
  url: string,
  config: GitHubConfig,
  init: RequestInit
): Promise<Response> => {
  const method = (init.method ?? 'GET').toUpperCase()
  const isIdempotent = method === 'GET' || method === 'HEAD'
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          ...createGitHubHeaders(config),
          ...(init.headers ?? {}),
        },
      })
    } catch (error) {
      lastError = error
      // Timeout e falha de rede só são repetidos em leituras: repetir uma
      // escrita sem idempotência poderia duplicar commits ou secrets.
      if (!isIdempotent || attempt === MAX_RETRIES) {
        const reason = error instanceof Error && error.name === 'TimeoutError'
          ? 'O GitHub não respondeu dentro do tempo limite.'
          : 'Não foi possível alcançar a API do GitHub.'
        throw new GitHubRequestError(reason, 504)
      }
      await wait(getRetryDelayMs(null, attempt))
      continue
    }

    if (response.ok) return response

    if (isIdempotent && isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      const delay = getRetryDelayMs(response, attempt)
      await response.body?.cancel().catch(() => undefined)
      await wait(delay)
      continue
    }

    const body = await response.text().catch(() => '')
    // Em tokens fine-grained não há como listar as permissões concedidas, mas o
    // GitHub diz no 403 qual permissão o endpoint exigia.
    const requiredPermission = response.headers.get('x-accepted-github-permissions') ?? undefined
    throw new GitHubRequestError(
      describeGitHubFailure(response.status, body, requiredPermission),
      response.status,
      requiredPermission
    )
  }

  throw new GitHubRequestError(
    lastError instanceof Error ? lastError.message : 'Falha ao comunicar com o GitHub.',
    504
  )
}

const requestJson = async <T>(
  url: string,
  config: GitHubConfig,
  init: RequestInit
): Promise<T> => {
  const response = await requestRaw(url, config, init)
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

const requestNoContent = async (
  url: string,
  config: GitHubConfig,
  init: RequestInit
) => {
  const response = await requestRaw(url, config, init)
  await response.body?.cancel().catch(() => undefined)
}

const getJson = async <T>(url: string, config: GitHubConfig): Promise<T> => {
  return requestJson<T>(url, config, { method: 'GET' })
}

const parseNextLink = (linkHeader: string | null) => {
  if (!linkHeader) return null
  const match = linkHeader.split(',').find((part) => /rel="next"/.test(part))
  return match?.match(/<([^>]+)>/)?.[1] ?? null
}

// Sem paginação a listagem parava nos primeiros 100 repositórios.
const getAllPages = async <T>(url: string, config: GitHubConfig): Promise<T[]> => {
  const items: T[] = []
  let next: string | null = url

  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const response: Response = await requestRaw(next, config, { method: 'GET' })
    const text = await response.text()
    const parsed = (text ? JSON.parse(text) : []) as T[]
    if (!Array.isArray(parsed)) break
    items.push(...parsed)
    next = parseNextLink(response.headers.get('link'))
  }

  return items
}

const toBase64 = (content: string) => Buffer.from(content, 'utf8').toString('base64')

const assertValidWorkflowPath = (path: string) => {
  if (path.startsWith('main/')) {
    throw new Error(
      'Caminho inválido: não inclua "main/". Use apenas .github/workflows/arquivo.yml.'
    )
  }

  if (!path.startsWith('.github/workflows/')) {
    throw new Error(
      'Caminho inválido: o workflow deve ficar em .github/workflows/.'
    )
  }
}

const withRef = (url: string, branch?: string) =>
  branch ? `${url}?${new URLSearchParams({ ref: branch }).toString()}` : url

const getFileSha = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  path: string
  branch?: string
}) => {
  assertValidWorkflowPath(params.path)
  const url = withRef(
    `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    params.branch
  )

  try {
    const response = await getJson<GitHubContentItem>(url, params.config)
    return response.sha
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) {
      return null
    }

    throw error
  }
}

export const checkFileExists = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  path: string
  branch?: string
}) => {
  const sha = await getFileSha(params)
  return Boolean(sha)
}

export const createOrUpdateFile = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  path: string
  content: string
  message: string
  branch?: string
}) => {
  assertValidWorkflowPath(params.path)
  const sha = await getFileSha(params)
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  const payload: {
    message: string
    content: string
    sha?: string
    branch?: string
  } = {
    message: params.message,
    content: toBase64(params.content),
  }

  if (params.branch) {
    payload.branch = params.branch
  }

  if (sha) {
    payload.sha = sha
  }

  await requestJson(url, params.config, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return {
    path: params.path,
    action: sha ? 'updated' : 'created',
  } as const
}

export const deleteFile = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  path: string
  sha: string
  message: string
  branch?: string
}) => {
  assertValidWorkflowPath(params.path)
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  const payload: {
    message: string
    sha: string
    branch?: string
  } = {
    message: params.message,
    sha: params.sha,
  }

  if (params.branch) {
    payload.branch = params.branch
  }

  return requestJson(url, params.config, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export const listRepos = async (
  config: GitHubConfig,
  options: {
    /** Obrigatória: não existe organização padrão embutida no código. */
    organization: string
    visibility?: 'all' | 'private' | 'public'
    perPage?: number
  }
): Promise<GitHubRepo[]> => {
  const { organization } = options
  if (!organization) throw new Error('Organização do GitHub não informada.')
  const perPage = String(Math.min(options.perPage ?? 100, 100))

  const orgParams = new URLSearchParams({
    type: options.visibility ?? 'all',
    per_page: perPage,
    sort: 'pushed',
    direction: 'desc',
  })
  const orgUrl = `${getGitHubBaseUrl(config)}/orgs/${organization}/repos?${orgParams.toString()}`

  // O endpoint da organização é a fonte preferencial; tokens fine-grained
  // limitados a repositórios específicos recebem 403/404 e caem no /user/repos.
  try {
    const orgRepos = await getAllPages<GitHubRepo>(orgUrl, config)
    if (orgRepos.length > 0) return orgRepos
  } catch (error) {
    if (
      !(error instanceof GitHubRequestError) ||
      ![401, 403, 404].includes(error.status)
    ) {
      throw error
    }
  }

  const userParams = new URLSearchParams({
    per_page: perPage,
    sort: 'pushed',
    direction: 'desc',
    visibility: options.visibility ?? 'all',
    affiliation: 'organization_member,collaborator,owner',
  })
  const userUrl = `${getGitHubBaseUrl(config)}/user/repos?${userParams.toString()}`

  try {
    const userRepos = await getAllPages<GitHubRepo>(userUrl, config)
    return userRepos.filter((repo) =>
      repo.full_name.toLowerCase().startsWith(`${organization.toLowerCase()}/`)
    )
  } catch (error) {
    if (error instanceof GitHubRequestError && [401, 403, 404].includes(error.status)) {
      return []
    }

    throw error
  }
}

const isWorkflowFile = (name: string) => {
  const lower = name.toLowerCase()
  return lower.endsWith('.yml') || lower.endsWith('.yaml')
}

export const listWorkflowFiles = async (
  config: GitHubConfig,
  params: {
    owner: string
    repo: string
    branch?: string
  }
): Promise<
  Array<{
    name: string
    path: string
    sha: string
    size: number
  }>
> => {
  const url = withRef(
    `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/contents/.github/workflows`,
    params.branch
  )

  try {
    const response = await getJson<GitHubContentItem[] | GitHubContentItem>(
      url,
      config
    )

    if (!Array.isArray(response)) {
      if (response.type === 'file' && isWorkflowFile(response.name)) {
        return [
          {
            name: response.name,
            path: response.path,
            sha: response.sha,
            size: response.size ?? 0,
          },
        ]
      }

      return []
    }

    return response
      .filter((item) => item.type === 'file' && isWorkflowFile(item.name))
      .map((item) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        size: item.size ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) {
      return []
    }

    throw error
  }
}

export const getWorkflowFileContent = async (
  config: GitHubConfig,
  params: {
    owner: string
    repo: string
    path: string
    branch?: string
  }
) => {
  assertValidWorkflowPath(params.path)
  const url = withRef(
    `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    params.branch
  )
  const response = await getJson<GitHubContentFile>(url, config)

  if (response.encoding !== 'base64') {
    throw new Error('Formato de conteúdo do workflow não suportado.')
  }

  return Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8')
}

export const listWorkflowRuns = async (
  config: GitHubConfig,
  params: {
    owner: string
    repo: string
    perPage?: number
    branch?: string
    workflowFile?: string
    status?: 'completed' | 'in_progress' | 'queued'
  }
): Promise<GitHubWorkflowRun[]> => {
  const search = new URLSearchParams({
    per_page: String(params.perPage ?? 10),
  })

  if (params.status) search.set('status', params.status)
  if (params.branch) search.set('branch', params.branch)

  const base = `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/actions`
  const url = params.workflowFile
    ? `${base}/workflows/${encodeURIComponent(params.workflowFile)}/runs?${search.toString()}`
    : `${base}/runs?${search.toString()}`

  try {
    const response = await getJson<{ workflow_runs: GitHubWorkflowRun[] }>(url, config)
    return response?.workflow_runs ?? []
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return []
    throw error
  }
}

export const dispatchWorkflow = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  workflowFile: string
  ref: string
  inputs?: Record<string, string>
}) => {
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/actions/workflows/${encodeURIComponent(params.workflowFile)}/dispatches`

  await requestNoContent(url, params.config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: params.ref,
      ...(params.inputs ? { inputs: params.inputs } : {}),
    }),
  })
}

export type GitHubIdentity = {
  login: string
  tokenExpiresAt: string | null
}

const normalizeExpiration = (raw: string | null) => {
  if (!raw) return null
  // O header vem como "2026-12-31 23:59:59 UTC"; ISO é mais fácil de formatar.
  const parsed = new Date(raw.replace(' UTC', 'Z').replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString()
}

export const getAuthenticatedUser = async (config: GitHubConfig): Promise<GitHubIdentity> => {
  const response = await requestRaw(`${getGitHubBaseUrl(config)}/user`, config, { method: 'GET' })
  const body = (await response.json()) as { login?: string }

  return {
    login: body.login ?? 'desconhecido',
    tokenExpiresAt: normalizeExpiration(response.headers.get('github-authentication-token-expiration')),
  }
}

export type AccessCheckId = 'identity' | 'organization' | 'secrets' | 'actions'

export type AccessCheck = {
  id: AccessCheckId
  label: string
  ok: boolean
  detail: string
}

/**
 * Uma página só: o diagnóstico precisa de um repositório qualquer para sondar
 * secrets e Actions, não da listagem inteira.
 */
const probeFirstRepo = async (config: GitHubConfig, organization: string) => {
  const orgUrl = `${getGitHubBaseUrl(config)}/orgs/${organization}/repos?per_page=1&type=all`

  try {
    const repos = await getJson<GitHubRepo[]>(orgUrl, config)
    if (repos.length > 0) return repos[0]
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || ![401, 403, 404].includes(error.status)) throw error
  }

  const userUrl = `${getGitHubBaseUrl(config)}/user/repos?per_page=100&affiliation=organization_member,collaborator,owner`
  const repos = await getJson<GitHubRepo[]>(userUrl, config)
  const prefix = `${organization.toLowerCase()}/`
  return repos.find((repo) => repo.full_name.toLowerCase().startsWith(prefix))
}

const describeProbeFailure = (error: unknown, fallback: string) => {
  if (error instanceof GitHubRequestError) {
    if (error.status === 403 && error.requiredPermission) {
      return `Falta a permissão "${error.requiredPermission}" no token.`
    }
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

/**
 * Diagnóstico do token antes do primeiro deploy. Só faz leituras, então
 * confirma o acesso mas não prova as permissões de escrita: essas só são
 * exercidas de fato ao salvar a configuração de um repositório.
 */
export const checkAccess = async (
  config: GitHubConfig,
  options: { organization: string }
): Promise<{ identity: GitHubIdentity | null; checks: AccessCheck[] }> => {
  const checks: AccessCheck[] = []
  let identity: GitHubIdentity | null = null

  try {
    identity = await getAuthenticatedUser(config)
    checks.push({
      id: 'identity',
      label: 'Token do GitHub',
      ok: true,
      detail: `Autenticado como ${identity.login}.`,
    })
  } catch (error) {
    checks.push({
      id: 'identity',
      label: 'Token do GitHub',
      ok: false,
      detail: describeProbeFailure(error, 'Não foi possível validar o token.'),
    })
    return { identity, checks }
  }

  let firstRepo: GitHubRepo | undefined
  try {
    firstRepo = await probeFirstRepo(config, options.organization)
    checks.push({
      id: 'organization',
      label: `Repositórios de ${options.organization}`,
      ok: Boolean(firstRepo),
      detail: firstRepo
        ? `Acesso confirmado (${firstRepo.full_name} está visível).`
        : 'O token não enxerga nenhum repositório desta organização.',
    })
  } catch (error) {
    checks.push({
      id: 'organization',
      label: `Repositórios de ${options.organization}`,
      ok: false,
      detail: describeProbeFailure(error, 'Não foi possível listar os repositórios.'),
    })
  }

  if (!firstRepo) return { identity, checks }

  const [owner = options.organization, repo = firstRepo.name] = firstRepo.full_name.split('/')

  try {
    await getJson(`${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/secrets/public-key`, config)
    checks.push({ id: 'secrets', label: 'Actions secrets', ok: true, detail: 'Leitura da chave pública confirmada.' })
  } catch (error) {
    checks.push({
      id: 'secrets',
      label: 'Actions secrets',
      ok: false,
      detail: describeProbeFailure(error, 'Sem acesso aos secrets do repositório.'),
    })
  }

  try {
    await getJson(`${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/runs?per_page=1`, config)
    checks.push({ id: 'actions', label: 'GitHub Actions', ok: true, detail: 'Leitura das execuções confirmada.' })
  } catch (error) {
    checks.push({
      id: 'actions',
      label: 'GitHub Actions',
      ok: false,
      detail: describeProbeFailure(error, 'Sem acesso ao GitHub Actions.'),
    })
  }

  return { identity, checks }
}

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ApiStatus,
  ConfigurePublicationInput,
  DeleteWorkflowInput,
  DeleteWorkflowResult,
  DispatchResult,
  FtpProtocol,
  PanelSettings,
  PanelSettingsInput,
  RepoOption,
  WorkflowFile,
  WorkflowRun,
} from '../../src/shared/deploy'
import { ftpProtocols } from '../../src/shared/deploy'
import { editableSettings, getEnvFilePath, getServerConfig, maskSecret, saveSettings, type EditableSetting } from '../config/env'
import { isLoopbackAddress } from '../security/network'
import { AuthThrottle, RateLimiter } from '../security/throttle'
import {
  checkAccess,
  deleteFile,
  dispatchWorkflow,
  getGitHubConfig,
  getWorkflowFileContent,
  GitHubRequestError,
  listRepos,
  listWorkflowFiles,
  listWorkflowRuns,
  type GitHubRepo,
} from '../services/github'
import { configurePublication, type PublicationSecret } from '../services/publication'
import {
  BUILD_WORKFLOW_FILE,
  buildWorkflowFiles,
  DEPLOY_WORKFLOW_FILE,
  readTemplateVersion,
  WORKFLOW_TEMPLATE_VERSION,
} from '../services/workflow-template'

class HttpError extends Error {
  status: number
  headers?: Record<string, string>

  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message)
    this.status = status
    this.headers = headers
  }
}

const authThrottle = new AuthThrottle()
const mutationLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 })

const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

const safeCompare = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

const getClientKey = (req: IncomingMessage) => req.socket.remoteAddress ?? 'desconhecido'

const assertAuthenticated = (req: IncomingMessage) => {
  const { panelAccessToken } = getServerConfig()
  if (!panelAccessToken) return

  const key = getClientKey(req)
  const blocked = authThrottle.check(key)
  if (!blocked.allowed) {
    throw new HttpError(429, 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.', {
      'Retry-After': String(blocked.retryAfterSeconds),
    })
  }

  const authorization = req.headers.authorization ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || !safeCompare(token, panelAccessToken)) {
    authThrottle.registerFailure(key)
    throw new HttpError(401, 'Chave de acesso inválida ou ausente.')
  }

  authThrottle.reset(key)
}

const assertMutationAllowed = (req: IncomingMessage) => {
  const decision = mutationLimiter.consume(getClientKey(req))
  if (!decision.allowed) {
    throw new HttpError(429, 'Muitas operações em sequência. Aguarde alguns segundos.', {
      'Retry-After': String(decision.retryAfterSeconds),
    })
  }
}

const readJson = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new HttpError(413, 'A requisição excede o limite permitido.')
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
  } catch {
    throw new HttpError(400, 'Corpo JSON inválido.')
  }
}

const assertIdentifier = (value: string, label: string) => {
  if (!/^[a-z0-9_.-]+$/i.test(value)) throw new HttpError(400, `${label} inválido.`)
  return value
}

const assertBranch = (value: unknown) => {
  if (typeof value !== 'string' || !/^(?!.*\.\.)[a-z0-9._/-]+$/i.test(value)) {
    throw new HttpError(400, 'Branch inválida.')
  }
  return value
}

const assertWorkflowPath = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^\.github\/workflows\/[a-z0-9._-]+\.ya?ml$/i.test(value)
  ) {
    throw new HttpError(400, 'Caminho de workflow inválido.')
  }
  return value
}

const assertWorkflowFileName = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z0-9._-]+\.ya?ml$/i.test(value)) {
    throw new HttpError(400, 'Nome de workflow inválido.')
  }
  return value
}

const domainPattern = /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const hostPattern = /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i

const assertDomain = (value: unknown) => {
  const domain = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!domainPattern.test(domain)) throw new HttpError(400, 'Domínio inválido. Informe apenas o domínio, sem https:// ou caminho.')
  return domain
}

const assertFtpServer = (value: unknown) => {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!hostPattern.test(host)) throw new HttpError(400, 'Servidor FTP inválido. Informe apenas o host, sem ftp:// ou caminho.')
  return host
}

const assertRequiredText = (value: unknown, label: string, maxLength = 200) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new HttpError(400, `${label} é obrigatório.`)
  if (text.length > maxLength) throw new HttpError(400, `${label} excede ${maxLength} caracteres.`)
  return text
}

const assertServerDir = (value: unknown) => {
  const dir = typeof value === 'string' ? value.trim() : ''
  if (!dir) return ''
  if (dir.includes('..')) throw new HttpError(400, 'A pasta remota não pode conter "..".')
  if (!/^[a-z0-9._/-]{1,255}$/i.test(dir)) throw new HttpError(400, 'Pasta remota inválida.')
  return dir.replace(/\/+$/, '')
}

const assertProtocol = (value: unknown): FtpProtocol => {
  if (value === undefined || value === null || value === '') return 'auto'
  if (typeof value !== 'string' || !ftpProtocols.includes(value as FtpProtocol)) {
    throw new HttpError(400, 'Protocolo de transferência inválido.')
  }
  return value as FtpProtocol
}

const assertPort = (value: unknown) => {
  if (value === undefined || value === null || value === '') return ''
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, 'Porta FTP inválida.')
  }
  return String(port)
}

const assertBuildEnv = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  if (text.length > 16 * 1024) throw new HttpError(400, 'As variáveis de build excedem o limite de 16 KB.')
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#')) continue
    if (!/^[A-Z_][A-Z0-9_]*=/i.test(entry)) {
      throw new HttpError(400, `Variável de build inválida: "${entry.slice(0, 40)}". Use o formato CHAVE=valor.`)
    }
  }
  return text
}

const assertRepositoryScope = (owner: string) => {
  const { organization } = getServerConfig()
  if (!organization || owner.toLowerCase() !== organization.toLowerCase()) {
    throw new HttpError(403, 'O repositório está fora da organização configurada.')
  }
}

/** As rotas de repositório só fazem sentido com token e organização definidos. */
const assertConfigured = () => {
  const { githubToken, organization } = getServerConfig()
  if (!githubToken) {
    throw new HttpError(503, 'O token do GitHub ainda não foi configurado. Abra as configurações do painel.')
  }
  if (!organization) {
    throw new HttpError(503, 'A organização do GitHub ainda não foi configurada. Abra as configurações do painel.')
  }
}

/**
 * A tela de configuração grava o token em disco, então ela exige loopback:
 * quem configura o painel é quem está na máquina que o executa. Enquanto não
 * existe chave de painel, o loopback é a única barreira — e basta, porque
 * qualquer processo local já poderia ler o próprio .env.
 */
const assertLocalAdmin = (req: IncomingMessage) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    throw new HttpError(403, 'As configurações só podem ser alteradas na própria máquina que executa o painel.')
  }
  assertAuthenticated(req)
}

const getConfig = () => getGitHubConfig({ token: getServerConfig().githubToken })

const readPanelSettings = (): PanelSettings => {
  const config = getServerConfig()
  return {
    envPath: getEnvFilePath(),
    githubConfigured: Boolean(config.githubToken),
    // O token nunca volta para o navegador; a dica só serve para a pessoa
    // reconhecer qual token está gravado.
    githubTokenHint: maskSecret(config.githubToken),
    organization: config.organization,
    defaultFtpHost: config.defaultFtpHost,
    panelAccessTokenSet: Boolean(config.panelAccessToken),
    serverHost: config.serverHost,
    port: config.port,
  }
}

const settingKeyByField: Record<keyof PanelSettingsInput, EditableSetting> = {
  githubToken: 'GITHUB_TOKEN',
  organization: 'GITHUB_ORG',
  defaultFtpHost: 'DEFAULT_FTP_HOST',
  panelAccessToken: 'PANEL_ACCESS_TOKEN',
}

const parseSettingsPayload = (body: unknown) => {
  const input = (body ?? {}) as Record<string, unknown>
  const updates: Partial<Record<EditableSetting, string>> = {}

  if (typeof input.githubToken === 'string' && input.githubToken.trim()) {
    const token = input.githubToken.trim()
    if (!token.startsWith('github_pat_')) {
      throw new HttpError(400, 'Use um fine-grained personal access token (prefixo github_pat_).')
    }
    if (token.length > 512) throw new HttpError(400, 'Token do GitHub inválido.')
    updates.GITHUB_TOKEN = token
  }

  if (typeof input.organization === 'string') {
    const organization = input.organization.trim()
    if (organization && !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(organization)) {
      throw new HttpError(400, 'Organização inválida. Use o identificador do GitHub, sem espaços.')
    }
    updates.GITHUB_ORG = organization
  }

  if (typeof input.defaultFtpHost === 'string') {
    const host = input.defaultFtpHost.trim().toLowerCase()
    if (host && !hostPattern.test(host)) {
      throw new HttpError(400, 'Servidor FTP padrão inválido. Informe apenas o host.')
    }
    updates.DEFAULT_FTP_HOST = host
  }

  if (typeof input.panelAccessToken === 'string') {
    const token = input.panelAccessToken.trim()
    if (token && token.length < 16) {
      throw new HttpError(400, 'A chave do painel precisa de pelo menos 16 caracteres.')
    }
    if (token.length > 256) throw new HttpError(400, 'Chave do painel muito longa.')
    updates.PANEL_ACCESS_TOKEN = token
  }

  const unknownField = Object.keys(input).find((field) => !(field in settingKeyByField))
  if (unknownField) throw new HttpError(400, `Campo desconhecido: ${unknownField}.`)

  if (Object.keys(updates).length === 0) throw new HttpError(400, 'Nenhuma configuração informada.')
  if (!editableSettings.some((key) => key in updates)) throw new HttpError(400, 'Nenhuma configuração válida.')

  return updates
}

const mapRepo = (repo: GitHubRepo): RepoOption => {
  const [owner = '', name = repo.name] = repo.full_name.split('/')
  return {
    id: String(repo.id),
    name,
    owner,
    fullName: repo.full_name,
    createdAt: repo.created_at,
    updatedAt: repo.pushed_at || repo.updated_at,
    private: repo.private,
    defaultBranch: repo.default_branch || 'main',
  }
}

const mapRun = (run: {
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
}): WorkflowRun => ({
  id: run.id,
  name: run.name ?? 'Workflow',
  title: run.display_title ?? '',
  status: run.status ?? 'unknown',
  conclusion: run.conclusion,
  runNumber: run.run_number,
  url: run.html_url,
  event: run.event,
  createdAt: run.created_at,
  updatedAt: run.updated_at,
})

const parseRepositoryRoute = (pathname: string) => {
  const match = pathname.match(/^\/api\/repositories\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!match) return null

  const owner = assertIdentifier(decodeURIComponent(match[1]), 'Organização')
  const repo = assertIdentifier(decodeURIComponent(match[2]), 'Repositório')
  assertRepositoryScope(owner)
  return { owner, repo, suffix: match[3] ?? '' }
}

const deleteWorkflows = async (input: DeleteWorkflowInput): Promise<DeleteWorkflowResult> => {
  const removed: string[] = []
  const failed: DeleteWorkflowResult['failed'] = []

  for (const file of input.files) {
    try {
      assertWorkflowPath(file.path)
      await deleteFile({
        config: getConfig(),
        owner: input.owner,
        repo: input.repo,
        path: file.path,
        sha: file.sha,
        message: `Remover workflow ${file.name}`,
        branch: input.branch,
      })
      removed.push(file.path)
    } catch (error) {
      failed.push({
        path: file.path,
        message: error instanceof Error ? error.message : 'Falha ao remover workflow.',
      })
    }
  }

  return {
    removed,
    failed,
    status: failed.length === 0 ? 'success' : removed.length > 0 ? 'partial' : 'failed',
  }
}

const managedWorkflowNames = new Set(
  [BUILD_WORKFLOW_FILE, DEPLOY_WORKFLOW_FILE].map((name) => name.toLowerCase())
)

/**
 * Lê o marcador de versão dos workflows gerados pelo painel, para a interface
 * poder avisar quando o repositório ainda roda um template antigo.
 */
const describeManagedWorkflows = async (params: {
  owner: string
  repo: string
  branch: string
  files: Array<{ name: string; path: string; sha: string; size: number }>
}): Promise<WorkflowFile[]> =>
  Promise.all(
    params.files.map(async (file) => {
      if (!managedWorkflowNames.has(file.name.toLowerCase())) return file

      try {
        const content = await getWorkflowFileContent(getConfig(), {
          owner: params.owner,
          repo: params.repo,
          path: file.path,
          branch: params.branch,
        })
        return { ...file, templateVersion: readTemplateVersion(content) }
      } catch {
        // A versão é um detalhe informativo; falhar aqui não pode derrubar a
        // listagem inteira de workflows.
        return file
      }
    })
  )

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * O GitHub leva alguns segundos para registrar um workflow recém-commitado;
 * até lá o endpoint de dispatch responde 404.
 */
const isUnexpectedInputError = (error: unknown) =>
  error instanceof GitHubRequestError &&
  error.status === 422 &&
  /unexpected inputs/i.test(error.message)

const dispatchWithRetry = async (params: {
  owner: string
  repo: string
  workflowFile: string
  ref: string
  inputs?: Record<string, string>
}) => {
  const delays = [0, 1500, 3000, 5000]
  let lastError: unknown

  for (const delay of delays) {
    if (delay) await sleep(delay)
    try {
      await dispatchWorkflow({ config: getConfig(), ...params })
      return
    } catch (error) {
      lastError = error
      // Repositórios configurados por uma versão anterior do painel têm um
      // workflow sem o input dry_run. Ignorar o erro rodaria uma publicação
      // real no lugar da simulação pedida, então é melhor avisar.
      if (isUnexpectedInputError(error)) {
        throw new HttpError(
          409,
          'O workflow deste repositório ainda não aceita simulação. Use "Salvar configuração" para atualizá-lo e tente novamente.'
        )
      }
      if (!(error instanceof GitHubRequestError) || error.status !== 404) throw error
    }
  }

  console.error('[api] dispatch falhou após novas tentativas:', lastError)
  throw new HttpError(
    404,
    `O workflow ${params.workflowFile} ainda não está disponível no GitHub. Configure a publicação e tente novamente em alguns segundos.`
  )
}

export const handleApiRequest = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const config = getServerConfig()
      sendJson(res, 200, {
        service: 'online',
        githubConfigured: Boolean(config.githubToken),
        organization: config.organization,
        authenticationRequired: Boolean(config.panelAccessToken),
        defaultFtpHost: config.defaultFtpHost,
        deployWorkflowFile: DEPLOY_WORKFLOW_FILE,
        workflowTemplateVersion: WORKFLOW_TEMPLATE_VERSION,
        setupRequired: !config.githubToken || !config.organization,
        // A interface só oferece a tela de configuração para quem está na
        // máquina do painel; os demais veem uma instrução em vez do formulário.
        configurable: isLoopbackAddress(req.socket.remoteAddress),
      } satisfies ApiStatus)
      return
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      assertLocalAdmin(req)
      sendJson(res, 200, readPanelSettings())
      return
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      assertLocalAdmin(req)
      assertMutationAllowed(req)
      const updates = parseSettingsPayload(await readJson(req))
      const envPath = saveSettings(updates)
      console.log(`[config] configurações gravadas em ${envPath}`)
      sendJson(res, 200, readPanelSettings())
      return
    }

    if (url.pathname === '/api/config/check' && req.method === 'POST') {
      assertLocalAdmin(req)
      assertMutationAllowed(req)
      const body = await readJson<{ githubToken?: string; organization?: string }>(req)
      const stored = getServerConfig()
      const token = typeof body.githubToken === 'string' && body.githubToken.trim()
        ? body.githubToken.trim()
        : stored.githubToken
      const organization = typeof body.organization === 'string' && body.organization.trim()
        ? body.organization.trim()
        : stored.organization

      if (!token) throw new HttpError(400, 'Informe o token do GitHub para validar.')
      if (!organization) throw new HttpError(400, 'Informe a organização do GitHub para validar.')

      sendJson(res, 200, await checkAccess(getGitHubConfig({ token }), { organization }))
      return
    }

    assertAuthenticated(req)

    if (url.pathname === '/api/repositories' && req.method === 'GET') {
      assertConfigured()
      const repos = await listRepos(getConfig(), {
        organization: getServerConfig().organization,
        perPage: 100,
      })
      sendJson(
        res,
        200,
        repos
          .map(mapRepo)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      )
      return
    }

    assertConfigured()
    const route = parseRepositoryRoute(url.pathname)
    if (!route) throw new HttpError(404, 'Rota não encontrada.')

    if (route.suffix === '/workflows' && req.method === 'GET') {
      const branch = assertBranch(url.searchParams.get('branch') ?? 'main')
      const files = await listWorkflowFiles(getConfig(), { ...route, branch })
      sendJson(res, 200, await describeManagedWorkflows({ ...route, branch, files }))
      return
    }

    if (route.suffix === '/workflows/preview' && req.method === 'GET') {
      const branch = assertBranch(url.searchParams.get('branch') ?? 'main')
      const path = assertWorkflowPath(url.searchParams.get('path'))
      const content = await getWorkflowFileContent(getConfig(), { ...route, path, branch })
      sendJson(res, 200, { content })
      return
    }

    if (route.suffix === '/runs' && req.method === 'GET') {
      const branch = assertBranch(url.searchParams.get('branch') ?? 'main')
      const workflowParam = url.searchParams.get('workflow')
      const workflowFile = workflowParam ? assertWorkflowFileName(workflowParam) : undefined
      const runs = await listWorkflowRuns(getConfig(), { ...route, branch, workflowFile, perPage: 8 })
      sendJson(res, 200, runs.map(mapRun))
      return
    }

    if (route.suffix === '/publication' && req.method === 'POST') {
      assertMutationAllowed(req)
      const body = await readJson<Partial<ConfigurePublicationInput>>(req)
      const branch = assertBranch(body.branch)
      const domain = assertDomain(body.domain)
      const ftpServer = assertFtpServer(body.ftpServer)
      const ftpLogin = assertRequiredText(body.ftpLogin, 'Login FTP')
      const ftpPassword = assertRequiredText(body.ftpPassword, 'Senha FTP', 512)
      const serverDir = assertServerDir(body.serverDir)
      const protocol = assertProtocol(body.protocol)
      const port = assertPort(body.port)
      const buildEnv = assertBuildEnv(body.buildEnv)
      const autoDeploy = body.autoDeploy === true

      const secrets: PublicationSecret[] = [
        { name: 'DEPLOY_DOMAIN', value: domain },
        { name: 'FTP_SERVER', value: ftpServer },
        { name: 'FTP_LOGIN', value: ftpLogin },
        { name: 'FTP_PASSWORD', value: ftpPassword },
        // Valores opcionais: quando vazios o secret é removido para não deixar
        // configuração antiga ativa no repositório.
        { name: 'FTP_SERVER_DIR', value: serverDir || null },
        { name: 'FTP_PROTOCOL', value: protocol === 'auto' ? null : protocol },
        { name: 'FTP_PORT', value: port || null },
        { name: 'BUILD_ENV_FILE', value: buildEnv || null },
      ]

      const result = await configurePublication({
        config: getConfig(),
        owner: route.owner,
        repo: route.repo,
        workflowBranch: branch,
        secrets,
        workflows: buildWorkflowFiles({ branch, autoDeploy }),
      })
      sendJson(res, 200, result)
      return
    }

    if (route.suffix === '/deploy' && req.method === 'POST') {
      assertMutationAllowed(req)
      const body = await readJson<{ branch?: string; dryRun?: boolean; workflow?: string }>(req)
      const branch = assertBranch(body.branch)
      const workflowFile = body.workflow ? assertWorkflowFileName(body.workflow) : DEPLOY_WORKFLOW_FILE
      const dryRun = body.dryRun === true

      await dispatchWithRetry({
        owner: route.owner,
        repo: route.repo,
        workflowFile,
        ref: branch,
        // Só enviar o input quando ele muda algo: assim o disparo continua
        // funcionando em workflows que não declaram dry_run.
        inputs: dryRun ? { dry_run: 'true' } : undefined,
      })

      sendJson(res, 202, {
        dispatched: true,
        workflow: workflowFile,
        branch,
        dryRun,
      } satisfies DispatchResult)
      return
    }

    if (route.suffix === '/workflows' && req.method === 'DELETE') {
      assertMutationAllowed(req)
      const body = await readJson<Pick<DeleteWorkflowInput, 'files' | 'branch'>>(req)
      const branch = assertBranch(body.branch)
      if (!Array.isArray(body.files) || body.files.length > 100) {
        throw new HttpError(400, 'Lista de workflows inválida.')
      }
      const files: WorkflowFile[] = body.files.map((file) => ({
        name: assertIdentifier(String(file.name), 'Nome do arquivo'),
        path: assertWorkflowPath(file.path),
        sha: assertIdentifier(String(file.sha), 'SHA'),
        size: Number(file.size) || 0,
      }))
      sendJson(res, 200, await deleteWorkflows({ ...route, files, branch }))
      return
    }

    throw new HttpError(405, 'Método não permitido.')
  } catch (error) {
    const isKnown = error instanceof HttpError || error instanceof GitHubRequestError
    const status = isKnown ? error.status : 500
    // As mensagens vindas do GitHub já passaram por describeGitHubFailure, então
    // é seguro devolvê-las; qualquer outra exceção fica só no log do servidor.
    const message = error instanceof Error ? error.message : 'Erro interno inesperado.'
    const headers = error instanceof HttpError ? error.headers : undefined
    console.error(`[api] ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} -> ${status}:`, error)
    sendJson(res, status, { message }, headers)
  }
}

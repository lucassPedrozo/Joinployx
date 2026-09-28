export type RepoOption = {
  id: string
  name: string
  owner: string
  fullName: string
  createdAt: string
  updatedAt: string
  private: boolean
  defaultBranch: string
}

export type WorkflowFile = {
  name: string
  path: string
  sha: string
  size: number
  /** Versão do template do painel gravada no arquivo, quando ele é gerenciado. */
  templateVersion?: string | null
}

/** `auto` deixa o workflow testar FTPS e cair para FTP apenas se necessário. */
export type FtpProtocol = 'auto' | 'ftps' | 'ftps-legacy' | 'ftp'

export const ftpProtocols: FtpProtocol[] = ['auto', 'ftps', 'ftps-legacy', 'ftp']

export type PublicationSettings = {
  domain: string
  ftpServer: string
  ftpLogin: string
  ftpPassword: string
  serverDir: string
  protocol: FtpProtocol
  port: string
  autoDeploy: boolean
  buildEnv: string
}

export type ConfigurePublicationInput = PublicationSettings & {
  owner: string
  repo: string
  branch: string
}

export type WorkflowWriteStatus = {
  path: string
  action: 'created' | 'updated'
}

export type PublicationResult = {
  workflowPaths: string[]
  workflowBranch: string
  secretNames: string[]
  workflowStatuses: WorkflowWriteStatus[]
}

export type DeleteWorkflowInput = {
  owner: string
  repo: string
  files: WorkflowFile[]
  branch: string
}

export type DeleteWorkflowResult = {
  removed: string[]
  failed: Array<{
    path: string
    message: string
  }>
  status: 'success' | 'partial' | 'failed'
}

export type WorkflowRun = {
  id: number
  name: string
  title: string
  status: string
  conclusion: string | null
  runNumber: number
  url: string
  event: string
  createdAt: string
  updatedAt: string
}

export type DispatchResult = {
  dispatched: true
  workflow: string
  branch: string
  dryRun: boolean
}

export type ApiStatus = {
  service: 'online'
  githubConfigured: boolean
  organization: string
  authenticationRequired: boolean
  defaultFtpHost: string
  deployWorkflowFile: string
  workflowTemplateVersion: string
  /** Falta token ou organização: o painel abre direto na tela de configuração. */
  setupRequired: boolean
  /** A requisição veio da própria máquina do painel e pode alterar o .env. */
  configurable: boolean
}

/** Estado da configuração local. Nenhum segredo é devolvido, só a dica. */
export type PanelSettings = {
  envPath: string
  githubConfigured: boolean
  githubTokenHint: string
  organization: string
  defaultFtpHost: string
  panelAccessTokenSet: boolean
  serverHost: string
  port: number
}

export type PanelSettingsInput = {
  githubToken?: string
  organization?: string
  defaultFtpHost?: string
  panelAccessToken?: string
}

export type AccessCheck = {
  id: 'identity' | 'organization' | 'secrets' | 'actions'
  label: string
  ok: boolean
  detail: string
}

export type AccessCheckResult = {
  identity: { login: string; tokenExpiresAt: string | null } | null
  checks: AccessCheck[]
}

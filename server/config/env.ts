import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalNetworkAddress } from '../security/network.ts'
import { parseEnvFile, upsertEnvFile } from './env-file.ts'

export { maskSecret, parseEnvFile, upsertEnvFile } from './env-file.ts'

// O `npm start` pode ser disparado de outro diretório (serviço do Windows,
// atalho, agendador), então o .env também é procurado a partir do módulo.
const moduleDirectory = () => dirname(fileURLToPath(import.meta.url))

const envCandidates = (cwd: string) => [
  resolve(cwd, '.env'),
  resolve(moduleDirectory(), '..', '.env'),
  resolve(moduleDirectory(), '..', '..', '.env'),
  resolve(moduleDirectory(), '..', '..', '..', '.env'),
]

const findEnvFile = (cwd: string) =>
  envCandidates(cwd).find((candidate) => existsSync(candidate)) ?? null

/** Onde o `.env` será gravado quando ainda não existir. */
export const getEnvFilePath = (cwd = process.cwd()) =>
  findEnvFile(cwd) ?? envCandidates(cwd)[0]

export const loadLocalEnv = (cwd = process.cwd()) => {
  const envPath = findEnvFile(cwd)
  if (!envPath) return

  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(envPath, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadLocalEnv()

const getPort = () => {
  const port = Number(process.env.PORT ?? 4173)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.')
  }
  return port
}

const getServerHost = () => {
  const host = (process.env.SERVER_HOST ?? '127.0.0.1').trim().toLowerCase()
  if (host !== '0.0.0.0' && host !== 'localhost' && !isLocalNetworkAddress(host)) {
    throw new Error('SERVER_HOST deve apontar para loopback ou um endereço IP privado da rede local.')
  }
  return host
}

const getAllowedHosts = () => (process.env.LAN_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)

export type ServerConfig = {
  githubToken: string
  organization: string
  panelAccessToken: string
  port: number
  serverHost: string
  allowedHosts: string[]
  defaultFtpHost: string
}

/** Chaves que a tela de configuração pode gravar no `.env`. */
export const editableSettings = ['GITHUB_TOKEN', 'GITHUB_ORG', 'DEFAULT_FTP_HOST', 'PANEL_ACCESS_TOKEN'] as const
export type EditableSetting = (typeof editableSettings)[number]

let cachedConfig: ServerConfig | null = null

// A configuração é lida uma única vez: ela é consultada a cada requisição e
// revalidar o .env nesse caminho quente não traz benefício algum.
export const getServerConfig = (): ServerConfig => {
  if (cachedConfig) return cachedConfig

  cachedConfig = {
    githubToken: (process.env.GITHUB_TOKEN ?? process.env.DEPLOY_GITHUB_TOKEN ?? '').trim(),
    organization: (process.env.GITHUB_ORG ?? '').trim(),
    panelAccessToken: (process.env.PANEL_ACCESS_TOKEN ?? '').trim(),
    port: getPort(),
    serverHost: getServerHost(),
    allowedHosts: getAllowedHosts(),
    defaultFtpHost: (process.env.DEFAULT_FTP_HOST ?? '').trim(),
  }

  return cachedConfig
}

export const resetServerConfigCache = () => {
  cachedConfig = null
}

/**
 * Grava as configurações no `.env` da máquina e recarrega o cache, para o
 * painel passar a usar os novos valores sem reiniciar o servidor.
 * `PORT` e `SERVER_HOST` são exceções: eles são lidos na subida do processo.
 */
export const saveSettings = (updates: Partial<Record<EditableSetting, string>>, cwd = process.cwd()) => {
  const envPath = getEnvFilePath(cwd)
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined) as Array<[string, string]>

  if (entries.length === 0) return envPath

  writeFileSync(envPath, upsertEnvFile(current, Object.fromEntries(entries)), { encoding: 'utf8', mode: 0o600 })

  for (const [key, value] of entries) process.env[key] = value
  resetServerConfigCache()

  return envPath
}

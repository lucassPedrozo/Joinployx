import { ftpProtocols, type FtpProtocol, type PublicationSettings } from '../../shared/deploy'

const STORAGE_KEY = 'joinvix-deploy-settings-v1'

/** A senha nunca entra aqui: ela existe apenas na memória do formulário. */
export type StoredSettings = Omit<PublicationSettings, 'ftpPassword'>

type SettingsFile = {
  lastFtpServer?: string
  repositories?: Record<string, Partial<StoredSettings>>
}

export const emptySettings: StoredSettings = {
  domain: '',
  ftpServer: '',
  serverDir: '',
  protocol: 'auto',
  port: '',
  autoDeploy: false,
  buildEnv: '',
  ftpLogin: '',
}

const readFile = (): SettingsFile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SettingsFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeFile = (file: SettingsFile) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
  } catch {
    // Sem armazenamento o painel apenas deixa de pré-preencher os campos.
  }
}

const sanitize = (value: Partial<StoredSettings> | undefined): StoredSettings => ({
  domain: typeof value?.domain === 'string' ? value.domain : '',
  ftpServer: typeof value?.ftpServer === 'string' ? value.ftpServer : '',
  ftpLogin: typeof value?.ftpLogin === 'string' ? value.ftpLogin : '',
  serverDir: typeof value?.serverDir === 'string' ? value.serverDir : '',
  protocol: ftpProtocols.includes(value?.protocol as FtpProtocol) ? (value?.protocol as FtpProtocol) : 'auto',
  port: typeof value?.port === 'string' ? value.port : '',
  autoDeploy: value?.autoDeploy === true,
  buildEnv: typeof value?.buildEnv === 'string' ? value.buildEnv : '',
})

/**
 * Republicar um site já configurado é o caso mais comum, então os dados não
 * sensíveis do último envio voltam preenchidos.
 */
export const loadSettings = (repoFullName: string): StoredSettings => {
  const file = readFile()
  const stored = sanitize(file.repositories?.[repoFullName])
  return stored.ftpServer ? stored : { ...stored, ftpServer: file.lastFtpServer ?? '' }
}

export const saveSettings = (repoFullName: string, settings: StoredSettings) => {
  const file = readFile()
  writeFile({
    lastFtpServer: settings.ftpServer || file.lastFtpServer,
    repositories: {
      ...file.repositories,
      [repoFullName]: sanitize(settings),
    },
  })
}

export const getLastFtpServer = () => readFile().lastFtpServer ?? ''

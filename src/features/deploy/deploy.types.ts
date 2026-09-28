export type Notice = {
  kind: 'success' | 'warning' | 'error' | 'info'
  title: string
  message: string
}

export type ValidationErrors = Partial<{
  repo: string
  domain: string
  ftpServer: string
  ftpLogin: string
  ftpPassword: string
  serverDir: string
  port: string
  buildEnv: string
}>

export type PreviewContent = {
  name: string
  content: string
}

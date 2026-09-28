import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { getServerConfig } from './server/config/env'
import {
  allowLocalNetworkRequest,
  evaluateIncomingNetworkAccess,
} from './server/security/network'

const localNetworkPlugin = (allowedHosts: string[]): Plugin => ({
  name: 'joinvix-local-network-only',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (allowLocalNetworkRequest(req, res, allowedHosts)) next()
    })

    server.httpServer?.prependListener('upgrade', (req, socket) => {
      if (!evaluateIncomingNetworkAccess(req, allowedHosts).allowed) socket.destroy()
    })
  },
})

const apiDevelopmentPlugin = (): Plugin => ({
  name: 'joinvix-deploy-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) {
        next()
        return
      }

      try {
        const api = await server.ssrLoadModule('/server/api/handler.ts')
        await api.handleApiRequest(req, res)
      } catch (error) {
        server.ssrFixStacktrace(error as Error)
        next(error as Error)
      }
    })
  },
})

export default defineConfig(({ isSsrBuild }) => {
  const { serverHost, allowedHosts } = getServerConfig()
  return {
    publicDir: isSsrBuild ? false : 'public',
    plugins: [react(), localNetworkPlugin(allowedHosts), apiDevelopmentPlugin()],
    server: {
      host: serverHost,
      allowedHosts: true,
      cors: false,
      fs: {
        deny: ['.env', '.env.*', '*.pem', '*.key', '.git/**'],
      },
    },
    ssr: { noExternal: ['libsodium-wrappers', 'libsodium'] },
  }
})

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getServerConfig } from './config/env'
import { handleApiRequest } from './api/handler'
import { allowLocalNetworkRequest, isLocalNetworkAddress } from './security/network'

// O bundle roda em dist-server/, então a raiz estática fica um nível acima.
// Resolver pelo módulo evita depender do diretório de onde o `npm start` partiu.
const bundleDirectory = dirname(fileURLToPath(import.meta.url))

const resolveStaticDirectory = () => {
  const candidates = [
    process.env.STATIC_DIR,
    resolve(process.cwd(), 'dist'),
    resolve(bundleDirectory, '..', 'dist'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const absolute = resolve(candidate)
    if (existsSync(resolve(absolute, 'index.html'))) return absolute
  }

  return resolve(candidates[0])
}

const staticDirectory = resolveStaticDirectory()

const mimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()',
}

const { port, serverHost, organization, githubToken, panelAccessToken, allowedHosts } = getServerConfig()

const server = createServer(async (req, res) => {
  if (!allowLocalNetworkRequest(req, res, allowedHosts)) return

  if ((req.url ?? '').startsWith('/api/')) {
    await handleApiRequest(req, res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, securityHeaders).end()
    return
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Requisição inválida.')
    return
  }

  const candidate = resolve(staticDirectory, `.${pathname}`)
  const isSafe = candidate === staticDirectory || candidate.startsWith(`${staticDirectory}${sep}`)
  const requestedFile = isSafe && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : resolve(staticDirectory, 'index.html')

  if (!existsSync(requestedFile)) {
    res.writeHead(503, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Build web não encontrado. Execute npm run build.')
    return
  }

  const extension = extname(requestedFile).toLowerCase()
  const immutable = requestedFile.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') res.end()
  else createReadStream(requestedFile).pipe(res)
})

server.headersTimeout = 10_000
server.requestTimeout = 30_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 100

const getLanUrls = (lanPort: number) => Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === 'IPv4' && !address.internal && isLocalNetworkAddress(address.address))
  .map((address) => `http://${address.address}:${lanPort}`)

server.listen(port, serverHost, () => {
  console.log(`Joinvix Deploy disponível em http://localhost:${port}`)
  for (const url of getLanUrls(port)) console.log(`Rede local: ${url}`)
  console.log(`Organização: ${organization}`)
  console.log(`Arquivos estáticos: ${staticDirectory}`)
  console.log('Política de rede: somente loopback e endereços privados; proxies são bloqueados.')
  if (!githubToken || !organization) {
    console.warn(`Configuração pendente: abra http://localhost:${port} nesta máquina para informar o token do GitHub e a organização.`)
  }
  // Em loopback a chave é dispensável: só processos locais alcançam a porta.
  if (!panelAccessToken && serverHost !== '127.0.0.1' && serverHost !== 'localhost') {
    console.warn('Aviso: o painel está exposto à rede sem PANEL_ACCESS_TOKEN. Defina uma chave no .env.')
  }
})

server.on('error', (error) => {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') {
    console.error(`A porta ${port} já está em uso. Encerre o outro processo ou defina PORT no .env.`)
  } else {
    console.error('Falha no servidor:', error)
  }
  process.exitCode = 1
})

let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${signal} recebido; encerrando o painel.`)
  server.close(() => process.exit(0))
  // Conexões keep-alive não fecham sozinhas dentro de um prazo aceitável.
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

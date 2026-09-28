import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'

type NetworkRequestContext = {
  remoteAddress?: string
  host?: string
  origin?: string
  hasForwardingHeaders?: boolean
  allowedHosts?: string[]
}

export type NetworkAccessDecision = {
  allowed: boolean
  reason?: 'public-address' | 'invalid-host' | 'forwarded-request' | 'cross-origin'
}

const normalizeAddress = (address: string) => {
  const withoutZone = address.trim().toLowerCase().split('%')[0]
  return withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone
}

const isPrivateIpv4 = (address: string) => {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }

  const [first, second] = octets
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

const isPrivateIpv6 = (address: string) => {
  if (address === '::1') return true
  if (/^f[cd][0-9a-f]{0,2}:/i.test(address)) return true
  return /^fe[89ab][0-9a-f]?:/i.test(address)
}

/**
 * Só a própria máquina. A tela de configuração grava o token do GitHub em
 * disco, então ela é restrita ao loopback mesmo quando o painel escuta a LAN:
 * quem configura o painel é quem está sentado nele.
 */
export const isLoopbackAddress = (rawAddress?: string) => {
  if (!rawAddress) return false
  const address = normalizeAddress(rawAddress)
  if (address === '::1') return true
  return isIP(address) === 4 && address.split('.')[0] === '127'
}

export const isLocalNetworkAddress = (rawAddress?: string) => {
  if (!rawAddress) return false
  const address = normalizeAddress(rawAddress)
  const version = isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return false
}

const getHostname = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

export const isAllowedLocalHost = (host: string | undefined, allowedHosts: string[] = []) => {
  if (!host) return false
  const hostname = getHostname(host)
  if (!hostname) return false
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (isLocalNetworkAddress(hostname)) return true
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) return true
  if (hostname.endsWith('.local')) return true
  return allowedHosts.some((allowedHost) => hostname === allowedHost.toLowerCase())
}

export const evaluateNetworkAccess = (context: NetworkRequestContext): NetworkAccessDecision => {
  if (!isLocalNetworkAddress(context.remoteAddress)) {
    return { allowed: false, reason: 'public-address' }
  }

  if (!isAllowedLocalHost(context.host, context.allowedHosts)) {
    return { allowed: false, reason: 'invalid-host' }
  }

  if (context.hasForwardingHeaders) {
    return { allowed: false, reason: 'forwarded-request' }
  }

  if (context.origin) {
    try {
      const origin = new URL(context.origin)
      if (!/^https?:$/.test(origin.protocol) || origin.host.toLowerCase() !== context.host?.toLowerCase()) {
        return { allowed: false, reason: 'cross-origin' }
      }
    } catch {
      return { allowed: false, reason: 'cross-origin' }
    }
  }

  return { allowed: true }
}

const hasForwardingHeaders = (req: IncomingMessage) => Boolean(
  req.headers.forwarded ||
  req.headers['x-forwarded-for'] ||
  req.headers['x-forwarded-host'] ||
  req.headers['x-forwarded-proto'] ||
  req.headers['x-real-ip']
)

export const evaluateIncomingNetworkAccess = (
  req: IncomingMessage,
  allowedHosts: string[] = []
) => evaluateNetworkAccess({
  remoteAddress: req.socket.remoteAddress,
  host: req.headers.host,
  origin: req.headers.origin,
  hasForwardingHeaders: hasForwardingHeaders(req),
  allowedHosts,
})

export const allowLocalNetworkRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  allowedHosts: string[] = []
) => {
  const decision = evaluateIncomingNetworkAccess(req, allowedHosts)

  if (decision.allowed) return true

  res.writeHead(403, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end('Acesso permitido somente pela rede local.')
  return false
}

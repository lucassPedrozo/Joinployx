export type ThrottleDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

export type AuthThrottleOptions = {
  /** Falhas toleradas antes do primeiro bloqueio. */
  maxFailures?: number
  /** Janela em que as falhas são contadas. */
  windowMs?: number
  /** Duração do primeiro bloqueio; dobra a cada nova falha. */
  baseBlockMs?: number
  maxBlockMs?: number
  now?: () => number
}

type AuthEntry = {
  failures: number
  firstFailureAt: number
  blockedUntil: number
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 }

/**
 * Bloqueio progressivo por origem para tentativas de autenticação.
 * A comparação da chave já é feita em tempo constante; isto evita que alguém
 * na LAN tente adivinhá-la por força bruta.
 */
export class AuthThrottle {
  #entries = new Map<string, AuthEntry>()
  #maxFailures: number
  #windowMs: number
  #baseBlockMs: number
  #maxBlockMs: number
  #now: () => number

  constructor(options: AuthThrottleOptions = {}) {
    this.#maxFailures = options.maxFailures ?? 5
    this.#windowMs = options.windowMs ?? 5 * 60_000
    this.#baseBlockMs = options.baseBlockMs ?? 15_000
    this.#maxBlockMs = options.maxBlockMs ?? 10 * 60_000
    this.#now = options.now ?? Date.now
  }

  check(key: string): ThrottleDecision {
    const entry = this.#entries.get(key)
    if (!entry) return ALLOWED

    const now = this.#now()

    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) }
    }

    if (now - entry.firstFailureAt > this.#windowMs) {
      this.#entries.delete(key)
    }

    return ALLOWED
  }

  registerFailure(key: string): ThrottleDecision {
    const now = this.#now()
    const current = this.#entries.get(key)
    const entry: AuthEntry =
      current && now - current.firstFailureAt <= this.#windowMs
        ? current
        : { failures: 0, firstFailureAt: now, blockedUntil: 0 }

    entry.failures += 1

    if (entry.failures >= this.#maxFailures) {
      const exponent = entry.failures - this.#maxFailures
      const blockMs = Math.min(this.#baseBlockMs * 2 ** exponent, this.#maxBlockMs)
      entry.blockedUntil = now + blockMs
    }

    this.#entries.set(key, entry)
    return this.check(key)
  }

  reset(key: string) {
    this.#entries.delete(key)
  }

  /** Remove entradas expiradas para o mapa não crescer indefinidamente. */
  prune() {
    const now = this.#now()
    for (const [key, entry] of this.#entries) {
      if (entry.blockedUntil <= now && now - entry.firstFailureAt > this.#windowMs) {
        this.#entries.delete(key)
      }
    }
  }
}

export type RateLimiterOptions = {
  limit: number
  windowMs: number
  now?: () => number
}

/** Janela deslizante simples para proteger as rotas que alteram repositórios. */
export class RateLimiter {
  #hits = new Map<string, number[]>()
  #limit: number
  #windowMs: number
  #now: () => number

  constructor(options: RateLimiterOptions) {
    this.#limit = options.limit
    this.#windowMs = options.windowMs
    this.#now = options.now ?? Date.now
  }

  consume(key: string): ThrottleDecision {
    const now = this.#now()
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < this.#windowMs)

    if (recent.length >= this.#limit) {
      const retryAfterSeconds = Math.ceil((this.#windowMs - (now - recent[0])) / 1000)
      this.#hits.set(key, recent)
      return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) }
    }

    recent.push(now)
    this.#hits.set(key, recent)
    return ALLOWED
  }
}

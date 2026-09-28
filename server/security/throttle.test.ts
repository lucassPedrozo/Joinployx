import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthThrottle, RateLimiter } from './throttle.ts'

const clock = () => {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

test('libera o acesso enquanto as falhas estão abaixo do limite', () => {
  const time = clock()
  const throttle = new AuthThrottle({ maxFailures: 3, now: time.now })

  throttle.registerFailure('192.168.0.5')
  throttle.registerFailure('192.168.0.5')

  assert.equal(throttle.check('192.168.0.5').allowed, true)
})

test('bloqueia após o limite e libera quando o tempo passa', () => {
  const time = clock()
  const throttle = new AuthThrottle({ maxFailures: 3, baseBlockMs: 10_000, now: time.now })

  throttle.registerFailure('10.0.0.2')
  throttle.registerFailure('10.0.0.2')
  const blocked = throttle.registerFailure('10.0.0.2')

  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds, 10)

  time.advance(10_001)
  assert.equal(throttle.check('10.0.0.2').allowed, true)
})

test('o bloqueio cresce a cada nova falha e respeita o teto', () => {
  const time = clock()
  const throttle = new AuthThrottle({ maxFailures: 1, baseBlockMs: 10_000, maxBlockMs: 30_000, now: time.now })

  assert.equal(throttle.registerFailure('10.0.0.3').retryAfterSeconds, 10)
  time.advance(10_001)
  assert.equal(throttle.registerFailure('10.0.0.3').retryAfterSeconds, 20)
  time.advance(20_001)
  assert.equal(throttle.registerFailure('10.0.0.3').retryAfterSeconds, 30)
  time.advance(30_001)
  assert.equal(throttle.registerFailure('10.0.0.3').retryAfterSeconds, 30)
})

test('um acesso válido zera o histórico da origem', () => {
  const time = clock()
  const throttle = new AuthThrottle({ maxFailures: 2, baseBlockMs: 10_000, now: time.now })

  throttle.registerFailure('10.0.0.4')
  throttle.reset('10.0.0.4')
  assert.equal(throttle.registerFailure('10.0.0.4').allowed, true)
})

test('as origens são contadas de forma independente', () => {
  const time = clock()
  const throttle = new AuthThrottle({ maxFailures: 1, now: time.now })

  throttle.registerFailure('10.0.0.5')
  assert.equal(throttle.check('10.0.0.5').allowed, false)
  assert.equal(throttle.check('10.0.0.6').allowed, true)
})

test('a janela deslizante limita as operações por minuto', () => {
  const time = clock()
  const limiter = new RateLimiter({ limit: 2, windowMs: 60_000, now: time.now })

  assert.equal(limiter.consume('10.0.0.7').allowed, true)
  assert.equal(limiter.consume('10.0.0.7').allowed, true)

  const blocked = limiter.consume('10.0.0.7')
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds, 60)

  time.advance(60_001)
  assert.equal(limiter.consume('10.0.0.7').allowed, true)
})

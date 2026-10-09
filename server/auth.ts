import { digestPassword, hmac, safeEqual, verifyPassword, type PasswordDigest } from './secrets'

export const SESSION_COOKIE = 'town_admin'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const LOGIN_WINDOW_MS = 5 * 60 * 1000
export const LOGIN_MAX_FAILURES = 5

interface SessionPayload {
  iat: number
  exp: number
}

/** 会话令牌：base64url(JSON) + "." + HMAC，只有服务端能签发和校验。 */
export function signSession(key: Buffer, now: number, ttl = SESSION_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ttl } satisfies SessionPayload)).toString('base64url')
  return `${payload}.${hmac(key, payload)}`
}

export function verifySession(key: Buffer, token: string | undefined, now: number): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  if (!safeEqual(token.slice(dot + 1), hmac(key, payload))) return false
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionPayload>
    return typeof parsed.exp === 'number' && parsed.exp > now
  } catch {
    return false
  }
}

/** 登录失败限流：同一来源在窗口内失败达到上限后，直到窗口结束都拒绝。 */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max = LOGIN_MAX_FAILURES,
    private readonly window = LOGIN_WINDOW_MS,
  ) {}

  /** 还要等多少秒才能再试；0 表示可以尝试。 */
  retryAfter(key: string, now: number): number {
    const entry = this.failures.get(key)
    if (!entry || entry.resetAt <= now) return 0
    return entry.count >= this.max ? Math.ceil((entry.resetAt - now) / 1000) : 0
  }

  fail(key: string, now: number): void {
    const entry = this.failures.get(key)
    if (!entry || entry.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + this.window })
    else entry.count += 1
    // 顺手清理过期记录，避免长期运行时无限增长
    if (this.failures.size > 1000) for (const [k, v] of this.failures) if (v.resetAt <= now) this.failures.delete(k)
  }

  clear(key: string): void {
    this.failures.delete(key)
  }
}

/** 管理员密码：只在内存里保留 scrypt 摘要。 */
export class AdminPassword {
  private readonly digest: PasswordDigest

  constructor(password: string) {
    this.digest = digestPassword(password)
  }

  matches(attempt: string): boolean {
    return verifyPassword(this.digest, attempt)
  }
}

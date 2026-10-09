// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LoginLimiter, signSession, verifySession } from './auth'
import { decryptText, deriveSecrets, digestPassword, encryptText, verifyPassword } from './secrets'

const SECRET = 'x'.repeat(40)

describe('secrets', () => {
  it('TOWN_SECRET 太短时拒绝启动；同一个密钥派生的两把子密钥不同', () => {
    expect(() => deriveSecrets('short')).toThrow('至少需要 32')
    const keys = deriveSecrets(SECRET)
    expect(keys.sessionKey.equals(keys.configKey)).toBe(false)
    expect(deriveSecrets(SECRET).configKey.equals(keys.configKey)).toBe(true)
  })

  it('加密后能解回原文，每次密文不同；被改动或换了密钥就解不开', () => {
    const { configKey } = deriveSecrets(SECRET)
    const a = encryptText(configKey, 'p@ss 带空格')
    const b = encryptText(configKey, 'p@ss 带空格')
    expect(a).not.toBe(b)
    expect(a).not.toContain('p@ss')
    expect(decryptText(configKey, a)).toBe('p@ss 带空格')
    const tampered = a.slice(0, -2) + (a.endsWith('A') ? 'BB' : 'AA')
    expect(() => decryptText(configKey, tampered)).toThrow()
    expect(() => decryptText(deriveSecrets('y'.repeat(40)).configKey, a)).toThrow()
    expect(() => decryptText(configKey, 'plain')).toThrow('无法识别')
  })

  it('管理员密码只比较 scrypt 摘要', () => {
    const digest = digestPassword('correct horse')
    expect(verifyPassword(digest, 'correct horse')).toBe(true)
    expect(verifyPassword(digest, 'correct horse ')).toBe(false)
  })
})

describe('session', () => {
  const { sessionKey } = deriveSecrets(SECRET)

  it('签发的会话在有效期内有效，过期、伪造或换密钥都无效', () => {
    const token = signSession(sessionKey, 1_000, 60_000)
    expect(verifySession(sessionKey, token, 30_000)).toBe(true)
    expect(verifySession(sessionKey, token, 61_000)).toBe(false)
    const [payload] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ iat: 1_000, exp: 9e15 })).toString('base64url')
    expect(verifySession(sessionKey, `${forged}.${token.split('.')[1]}`, 30_000)).toBe(false)
    expect(verifySession(sessionKey, `${payload}.`, 30_000)).toBe(false)
    expect(verifySession(deriveSecrets('z'.repeat(40)).sessionKey, token, 30_000)).toBe(false)
    expect(verifySession(sessionKey, undefined, 30_000)).toBe(false)
  })
})

describe('LoginLimiter', () => {
  it('窗口内失败达到上限后拒绝，窗口过后恢复；成功登录清零', () => {
    const limiter = new LoginLimiter(3, 60_000)
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.retryAfter('ip', 1_000)).toBe(0)
      limiter.fail('ip', 1_000)
    }
    expect(limiter.retryAfter('ip', 2_000)).toBe(59)
    expect(limiter.retryAfter('other', 2_000)).toBe(0)
    expect(limiter.retryAfter('ip', 61_001)).toBe(0)
    limiter.fail('a', 0)
    limiter.clear('a')
    expect(limiter.retryAfter('a', 0)).toBe(0)
  })
})

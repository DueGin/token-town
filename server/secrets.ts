import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * 服务端用到的密钥都由 TOWN_SECRET 派生：会话签名一把、配置加密一把，互不复用。
 * 更换 TOWN_SECRET 后，已签发的会话和已保存的数据库密码都会失效。
 */
export const MIN_SECRET_LENGTH = 32

export interface Secrets {
  sessionKey: Buffer
  configKey: Buffer
}

export function deriveSecrets(secret: string): Secrets {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`TOWN_SECRET 至少需要 ${MIN_SECRET_LENGTH} 个字符`)
  }
  const ikm = Buffer.from(secret, 'utf8')
  const salt = Buffer.from('token-town', 'utf8')
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', ikm, salt, info, 32))
  return { sessionKey: derive('session-v1'), configKey: derive('config-v1') }
}

const CIPHER_PREFIX = 'v1.'
const IV_BYTES = 12
const TAG_BYTES = 16

/** AES-256-GCM 加密，输出 “v1.” + base64url(iv | tag | 密文)。 */
export function encryptText(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return CIPHER_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

/** 解密 encryptText 的结果；密文被改动或密钥不对时抛错。 */
export function decryptText(key: Buffer, token: string): string {
  if (!token.startsWith(CIPHER_PREFIX)) throw new Error('无法识别的密文格式')
  const raw = Buffer.from(token.slice(CIPHER_PREFIX.length), 'base64url')
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('密文长度不对')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES))
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
}

export function hmac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** 等长时恒定时间比较；长度不同直接判否（长度本身不是秘密）。 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** 管理员密码：启动时加随机盐做一次 scrypt，之后只比较摘要。 */
export interface PasswordDigest {
  salt: Buffer
  hash: Buffer
}

export function digestPassword(password: string, salt: Buffer = randomBytes(16)): PasswordDigest {
  return { salt, hash: scryptSync(password, salt, 32) }
}

export function verifyPassword(digest: PasswordDigest, attempt: string): boolean {
  const hash = scryptSync(attempt, digest.salt, 32)
  return timingSafeEqual(hash, digest.hash)
}

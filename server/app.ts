import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { ImportError, MAX_IMPORT_BYTES, parseUsageText } from '@/lib/import-data'
import { compareLabs, KNOWN_LABS, OTHER_LAB, resolveLab, type LabIdentity } from '@/lib/labs'
import { listWeeks, type TownDataset } from '@/lib/town-data'
import { AdminPassword, LoginLimiter, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './auth'
import { SOURCE_KINDS, sub2apiSettingsSchema, type SourceKind, type Sub2apiSettings, type TownConfig } from './config-store'
import type { DatasetService } from './dataset-service'
import { encryptText, type Secrets } from './secrets'
import { classifyError } from './sources/sub2api'

export interface AppOptions {
  service: DatasetService
  secrets: Secrets
  /** 未设置 ADMIN_PASSWORD 时为 null，后台接口一律 503。 */
  admin: AdminPassword | null
  limiter?: LoginLimiter
  cookieSecure?: boolean
  /** 反向代理后面部署时信任 X-Forwarded-For / X-Forwarded-Host。 */
  trustProxy?: boolean
  clientIp?: (c: Context) => string
  now?: () => number
}

const JSON_LIMIT = 64 * 1024
const UPLOAD_LIMIT = MAX_IMPORT_BYTES + 512 * 1024

export interface AdminShop extends LabIdentity {
  tokens: number
  hasData: boolean
  visible: boolean
}

/** 后台的厂商列表：厂商表里的全部厂商，加上数据里出现的表外厂商和“其他厂商”，带最新一周用量。 */
export function adminShops(dataset: TownDataset, hidden: readonly string[]): AdminShop[] {
  const latest = listWeeks(dataset).at(-1)
  const infoLab = new Map(dataset.models.map((info) => [info.model.trim().toLowerCase(), info.lab]))
  const labs = new Map<string, { identity: LabIdentity; tokens: number }>()
  for (const lab of KNOWN_LABS) {
    labs.set(lab.id, { identity: { id: lab.id, name: lab.name, color: lab.color, monogram: lab.monogram }, tokens: 0 })
  }
  labs.set(OTHER_LAB.id, { identity: OTHER_LAB, tokens: 0 })
  const seen = new Set<string>()
  for (const row of dataset.rows) {
    if (row.week !== latest) continue
    const identity = resolveLab(row.lab ?? infoLab.get(row.model.trim().toLowerCase()), row.model)
    const entry = labs.get(identity.id) ?? { identity, tokens: 0 }
    entry.tokens += row.tokens
    labs.set(identity.id, entry)
    seen.add(identity.id)
  }
  // 已隐藏但这批数据里没有的厂商也列出来，方便恢复展示
  for (const id of hidden) {
    if (!labs.has(id)) labs.set(id, { identity: { id, name: id, color: OTHER_LAB.color, monogram: id.slice(0, 1).toUpperCase() }, tokens: 0 })
  }
  const hiddenSet = new Set(hidden)
  return Array.from(labs.values())
    .map(({ identity, tokens }) => ({ ...identity, tokens, hasData: seen.has(identity.id), visible: !hiddenSet.has(identity.id) }))
    .sort((a, b) => compareLabs(a, b))
}

/** 返回给后台的数据源配置：永远不带密码，只告诉是否已保存。 */
export function sourceView(config: TownConfig) {
  const { passwordEnc, ...sub2api } = config.source.sub2api
  return { active: config.source.active, sub2api: { ...sub2api, hasPassword: Boolean(passwordEnc) }, file: config.source.file ?? null }
}

const loginSchema = z.object({ password: z.string().min(1).max(256) })
const shopsSchema = z.object({ hidden: z.array(z.string().trim().min(1).max(80)).max(200) })
/** password：不传表示保留原值，空串表示清除，其余为新密码。 */
const passwordField = z.string().max(256).optional()
const sourceSchema = z.object({
  active: z.enum(SOURCE_KINDS),
  sub2api: sub2apiSettingsSchema,
  password: passwordField,
})
const testSchema = z.object({ sub2api: sub2apiSettingsSchema, password: passwordField })
const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  text: z.string().max(MAX_IMPORT_BYTES),
  activate: z.boolean().optional(),
})

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体不是有效的 JSON')
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.') || '请求体'
    throw new HttpError(400, 'invalid_params', issue?.message && /[一-龥]/.test(issue.message) ? issue.message : `参数不正确：${field}`)
  }
  return result.data
}

export function createApp(options: AppOptions): Hono {
  const { service, secrets, admin } = options
  const limiter = options.limiter ?? new LoginLimiter()
  const now = options.now ?? Date.now
  const clientIp =
    options.clientIp ??
    ((c: Context) => (options.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ?? 'local')
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: { code: error.code, message: error.message } }, error.status)
    console.error('[token-town] 未处理的错误', error)
    return c.json({ error: { code: 'internal', message: '服务器内部错误' } }, 500)
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/town/dataset', (c) => {
    const { body, etag } = service.publicDataset()
    c.header('ETag', etag)
    c.header('Cache-Control', 'no-cache')
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(body)
  })

  // —— 后台 ——
  app.use('/api/admin/*', async (c, next) => {
    if (!admin) throw new HttpError(503, 'admin_disabled', '没有设置 ADMIN_PASSWORD，控制后台未启用')
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin')
      if (origin) {
        let originHost = ''
        try {
          originHost = new URL(origin).host
        } catch {
          // 非法 Origin 按不同源处理
        }
        const host = (options.trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host')
        if (originHost !== host) throw new HttpError(403, 'bad_origin', '请求来源不被允许')
      }
      if (!c.req.header('content-type')?.includes('application/json')) throw new HttpError(415, 'json_required', '请求体需要是 JSON')
    }
    const path = c.req.path
    if (path !== '/api/admin/login' && path !== '/api/admin/session' && path !== '/api/admin/logout') {
      if (!verifySession(secrets.sessionKey, getCookie(c, SESSION_COOKIE), now())) throw new HttpError(401, 'unauthorized', '请先登录控制后台')
    }
    await next()
  })

  const limitJson = bodyLimit({ maxSize: JSON_LIMIT, onError: () => { throw new HttpError(413, 'too_large', '请求体过大') } })

  app.post('/api/admin/login', limitJson, async (c) => {
    const ip = clientIp(c)
    const wait = limiter.retryAfter(ip, now())
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      throw new HttpError(429, 'too_many_attempts', `尝试次数过多，请 ${Math.ceil(wait / 60)} 分钟后再试`)
    }
    const { password } = await readJson(c, loginSchema)
    if (!admin!.matches(password)) {
      limiter.fail(ip, now())
      throw new HttpError(401, 'wrong_password', '密码不正确')
    }
    limiter.clear(ip)
    setCookie(c, SESSION_COOKIE, signSession(secrets.sessionKey, now()), {
      httpOnly: true,
      sameSite: 'Strict',
      secure: options.cookieSecure ?? false,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    })
    return c.json({ ok: true })
  })

  app.post('/api/admin/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/session', (c) => c.json({ authenticated: verifySession(secrets.sessionKey, getCookie(c, SESSION_COOKIE), now()) }))

  app.get('/api/admin/status', (c) => c.json(service.status()))

  app.get('/api/admin/shops', (c) => c.json({ shops: adminShops(service.rawDataset(), service.currentConfig.shops.hidden) }))

  app.put('/api/admin/shops', limitJson, async (c) => {
    const { hidden } = await readJson(c, shopsSchema)
    const config = service.currentConfig
    await service.applyConfig({ ...config, shops: { hidden: Array.from(new Set(hidden)) }, updatedAt: new Date(now()).toISOString() })
    return c.json({ shops: adminShops(service.rawDataset(), service.currentConfig.shops.hidden) })
  })

  app.get('/api/admin/source', (c) => c.json(sourceView(service.currentConfig)))

  app.put('/api/admin/source', limitJson, async (c) => {
    const body = await readJson(c, sourceSchema)
    const config = service.currentConfig
    const passwordEnc =
      body.password === undefined ? config.source.sub2api.passwordEnc : body.password === '' ? undefined : encryptText(secrets.configKey, body.password)
    assertActivatable(body.active, body.sub2api, Boolean(config.source.file))
    await service.applyConfig({
      ...config,
      source: { ...config.source, active: body.active, sub2api: { ...body.sub2api, ...(passwordEnc ? { passwordEnc } : {}) } },
      updatedAt: new Date(now()).toISOString(),
    })
    return c.json({ source: sourceView(service.currentConfig), status: service.status() })
  })

  app.post('/api/admin/source/test', limitJson, async (c) => {
    const body = await readJson(c, testSchema)
    const password = body.password === undefined ? service.savedPassword() : body.password
    try {
      const summary = await service.test(service.connectionFrom(body.sub2api, password))
      return c.json({ ok: true, summary })
    } catch (error) {
      const failure = classifyError(error)
      return c.json({ ok: false, error: { code: failure.code, message: failure.message } })
    }
  })

  app.post('/api/admin/source/refresh', limitJson, async (c) => {
    await service.refresh({ full: true })
    return c.json(service.status())
  })

  app.post(
    '/api/admin/source/file',
    bodyLimit({ maxSize: UPLOAD_LIMIT, onError: () => { throw new HttpError(413, 'too_large', '文件超过 5 MB') } }),
    async (c) => {
      const body = await readJson(c, uploadSchema)
      let result
      try {
        result = parseUsageText(body.text, body.fileName)
      } catch (error) {
        if (error instanceof ImportError) {
          return c.json({ error: { code: 'import_failed', message: error.message, detail: error.detail ?? null } }, 400)
        }
        throw error
      }
      service.saveUploadedDataset(result.dataset)
      const config = service.currentConfig
      await service.applyConfig({
        ...config,
        source: {
          ...config.source,
          active: body.activate ? 'file' : config.source.active,
          file: { label: result.dataset.label, fileName: body.fileName, uploadedAt: new Date(now()).toISOString(), rows: result.accepted },
        },
        updatedAt: new Date(now()).toISOString(),
      })
      return c.json({
        accepted: result.accepted,
        skipped: result.skipped,
        firstIssue: result.firstIssue ?? null,
        source: sourceView(service.currentConfig),
        status: service.status(),
      })
    },
  )

  app.all('/api/*', () => {
    throw new HttpError(404, 'not_found', '接口不存在')
  })

  return app
}

function assertActivatable(active: SourceKind, sub2api: Sub2apiSettings, hasFile: boolean): void {
  if (active === 'sub2api' && (!sub2api.host || !sub2api.user)) {
    throw new HttpError(400, 'incomplete', '启用 Sub2API 数据源前，请填写数据库主机和用户名')
  }
  if (active === 'file' && !hasFile) throw new HttpError(400, 'incomplete', '请先上传数据文件')
}

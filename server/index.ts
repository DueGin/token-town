import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from './app'
import { AdminPassword } from './auth'
import { ConfigStore, DEFAULT_SUB2API, defaultConfig, SSL_MODES, type TownConfig } from './config-store'
import { DatasetService } from './dataset-service'
import { deriveSecrets, encryptText, type Secrets } from './secrets'

/**
 * 服务端入口：同一个进程提供小镇（/）、控制后台（/admin）和接口（/api）。
 * 环境变量见 README 的“部署”一节；密码和密钥只从环境变量读，不写日志。
 */

function fail(message: string): never {
  console.error(`[token-town] ${message}`)
  process.exit(1)
}

function flag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? '')
}

/** 首次启动且没有配置文件时，用 SUB2API_DATABASE_* 预填 Sub2API 数据源，方便 Compose 一键接入。 */
function seedConfig(secrets: Secrets): TownConfig {
  const config = defaultConfig()
  const host = process.env.SUB2API_DATABASE_HOST?.trim()
  if (!host) return config
  const port = Number(process.env.SUB2API_DATABASE_PORT ?? DEFAULT_SUB2API.port)
  const sslmode = (SSL_MODES as readonly string[]).includes(process.env.SUB2API_DATABASE_SSLMODE ?? '')
    ? (process.env.SUB2API_DATABASE_SSLMODE as (typeof SSL_MODES)[number])
    : DEFAULT_SUB2API.sslmode
  const password = process.env.SUB2API_DATABASE_PASSWORD ?? ''
  config.source.active = 'sub2api'
  config.source.sub2api = {
    ...DEFAULT_SUB2API,
    host,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_SUB2API.port,
    database: process.env.SUB2API_DATABASE_DBNAME?.trim() || DEFAULT_SUB2API.database,
    user: process.env.SUB2API_DATABASE_USER?.trim() ?? '',
    sslmode,
    ...(password ? { passwordEnc: encryptText(secrets.configKey, password) } : {}),
  }
  return config
}

const secret = process.env.TOWN_SECRET ?? ''
if (!secret) fail('缺少环境变量 TOWN_SECRET（至少 32 个字符，用来签发后台会话和加密数据库密码）')
let secrets: Secrets
try {
  secrets = deriveSecrets(secret)
} catch (error) {
  fail((error as Error).message)
}

const store = new ConfigStore(path.resolve(process.env.DATA_DIR ?? 'data'))
let config: TownConfig
try {
  const loaded = store.load()
  config = loaded ?? seedConfig(secrets)
  if (!loaded) store.save(config)
} catch (error) {
  fail((error as Error).message)
}

const trustProxy = flag('TRUST_PROXY')
const adminPassword = process.env.ADMIN_PASSWORD ?? ''
if (!adminPassword) console.warn('[token-town] 没有设置 ADMIN_PASSWORD，控制后台不可用；小镇照常运行')

const service = new DatasetService(store, secrets, config)
const api = createApp({
  service,
  secrets,
  admin: adminPassword ? new AdminPassword(adminPassword) : null,
  cookieSecure: flag('COOKIE_SECURE'),
  trustProxy,
  clientIp: (c) =>
    (trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ?? getConnInfo(c).remote.address ?? 'unknown',
})

const app = new Hono()
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  if (c.req.path === '/admin' || c.req.path.startsWith('/admin/') || c.req.path.startsWith('/api/admin')) c.header('X-Frame-Options', 'DENY')
})
app.route('/', api)

const staticRoot = path.resolve(process.env.STATIC_DIR ?? 'dist')
if (existsSync(staticRoot)) {
  const noCache = (_path: string, c: { header: (name: string, value: string) => void }) => c.header('Cache-Control', 'no-cache')
  app.use(
    '/assets/*',
    serveStatic({ root: staticRoot, onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }),
  )
  app.get('/admin', serveStatic({ root: staticRoot, path: 'admin.html', onFound: noCache }))
  app.get('/admin/*', serveStatic({ root: staticRoot, path: 'admin.html', onFound: noCache }))
  app.get('/', serveStatic({ root: staticRoot, path: 'index.html', onFound: noCache }))
  app.use('*', serveStatic({ root: staticRoot }))
} else {
  console.warn(`[token-town] 找不到前端构建产物 ${staticRoot}，只提供 /api 接口（开发时由 Vite 提供页面）`)
}

const port = Number(process.env.PORT ?? 3200)
const hostname = process.env.HOST ?? '0.0.0.0'
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[token-town] 已启动：http://${hostname}:${info.port}（数据源：${config.source.active}）`)
})
void service.start()

// 兜底：单个请求或后台刷新里漏掉的异常只记日志，不让整个小镇停掉
process.on('unhandledRejection', (reason) => {
  console.error('[token-town] 未处理的异步错误', reason instanceof Error ? reason.message : reason)
})

let closing = false
function shutdown() {
  if (closing) return
  closing = true
  server.close()
  void service.stop().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

import pg from 'pg'
import { OTHER_LAB, resolveLab } from '@/lib/labs'
import type { UsageRow } from '@/lib/town-data'
import type { Sub2apiSettings } from '../config-store'

/**
 * Sub2API 数据源：只读连接 Sub2API 的 PostgreSQL，按“模型 × 周”聚合 usage_logs。
 *
 * - 连接参数里打开 default_transaction_read_only 和 statement_timeout，查询再包一层 BEGIN READ ONLY；
 * - 先探测列再拼 SQL，兼容不同版本的表结构；时区、周数都走参数，列名只来自固定白名单；
 * - 模型名默认用 Sub2API 官方统计口径 COALESCE(NULLIF(TRIM(requested_model), ''), model)；
 * - 失败请求是占位行，官方统计用 actual_cost > 0 排除。
 */

export type Sub2apiConnection = Sub2apiSettings & { password: string }

export type SourceErrorCode =
  | 'not_configured'
  | 'unreachable'
  | 'auth_failed'
  | 'database_missing'
  | 'missing_table'
  | 'missing_column'
  | 'permission'
  | 'timeout'
  | 'ssl'
  | 'unknown'

/** 给管理员看的错误：只有分类和中文说明，不带 DSN、SQL 或堆栈。 */
export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

const STATEMENT_TIMEOUT_MS = 15_000
const REQUIRED_COLUMNS = ['model', 'created_at', 'input_tokens', 'output_tokens'] as const
const TOKEN_COLUMNS = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'] as const

/** Sub2API 上游平台到小镇厂商的映射；只在模型名认不出厂商时使用。 */
const PLATFORM_LABS: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
  grok: 'xai',
  kimi: 'moonshot',
  zhipu: 'zhipu',
  deepseek: 'deepseek',
  minimax: 'minimax',
}

export interface SchemaColumns {
  /** usage_logs 的列名 → data_type。 */
  usage: Map<string, string>
  accounts: Set<string>
  groups: Set<string>
}

export interface QueryClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
}

export async function probeColumns(client: QueryClient): Promise<SchemaColumns> {
  const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN ('usage_logs', 'accounts', 'groups')`,
  )
  const columns: SchemaColumns = { usage: new Map(), accounts: new Set(), groups: new Set() }
  for (const row of rows) {
    if (row.table_name === 'usage_logs') columns.usage.set(row.column_name, row.data_type)
    else if (row.table_name === 'accounts') columns.accounts.add(row.column_name)
    else if (row.table_name === 'groups') columns.groups.add(row.column_name)
  }
  return columns
}

type QueryOptions = Pick<Sub2apiSettings, 'modelField' | 'successOnly' | 'platformAssist'>

/**
 * 按探测到的列拼出聚合 SQL。参数：$1 时区（IANA），$2 往前回溯的整周数（0 表示只查本周）。
 * 输出列：model、week（周一，YYYY-MM-DD）、platform、tokens、visitors。
 */
export function buildUsageQuery(columns: SchemaColumns, options: QueryOptions): string {
  const { usage } = columns
  if (!usage.size) throw new SourceError('missing_table', '当前库里找不到 usage_logs 表，请确认连的是 Sub2API 的数据库')
  const missing = REQUIRED_COLUMNS.filter((name) => !usage.has(name))
  if (missing.length) throw new SourceError('missing_column', `usage_logs 缺少列：${missing.join('、')}`)

  const fallback = options.modelField === 'upstream' ? 'upstream_model' : 'requested_model'
  const model = usage.has(fallback) ? `COALESCE(NULLIF(TRIM(u.${fallback}), ''), u.model)` : 'u.model'
  // 老版本的 created_at 不带时区（按 UTC 存），先换成带时区的时刻再比较
  const createdAt = usage.get('created_at') === 'timestamp without time zone' ? `(u.created_at AT TIME ZONE 'UTC')` : 'u.created_at'
  const tokens = TOKEN_COLUMNS.filter((name) => usage.has(name))
    .map((name) => `COALESCE(u.${name}, 0)`)
    .join(' + ')
  const visitors = usage.has('user_id') ? 'COUNT(DISTINCT u.user_id)::bigint' : 'NULL::bigint'
  const joinPlatform =
    options.platformAssist &&
    usage.has('group_id') &&
    usage.has('account_id') &&
    columns.groups.has('platform') &&
    columns.accounts.has('platform')
  const platform = joinPlatform
    ? `CASE WHEN g.platform = 'composite' THEN a.platform ELSE COALESCE(NULLIF(g.platform, ''), a.platform) END`
    : 'NULL::text'
  const joins = joinPlatform ? `\n  LEFT JOIN groups g ON g.id = u.group_id\n  LEFT JOIN accounts a ON a.id = u.account_id` : ''
  const success = options.successOnly && usage.has('actual_cost') ? '\n  AND u.actual_cost > 0' : ''

  return `SELECT ${model} AS model,
       to_char(date_trunc('week', ${createdAt} AT TIME ZONE $1), 'YYYY-MM-DD') AS week,
       ${platform} AS platform,
       SUM(${tokens})::bigint AS tokens,
       ${visitors} AS visitors
  FROM usage_logs u${joins}
 WHERE ${createdAt} >= ((date_trunc('week', now() AT TIME ZONE $1) - make_interval(weeks => $2::int)) AT TIME ZONE $1)${success}
   AND NULLIF(TRIM(${model}), '') IS NOT NULL
 GROUP BY 1, 2, 3
HAVING SUM(${tokens}) > 0`
}

interface RawUsageRow extends Record<string, unknown> {
  model: string | null
  week: string
  platform: string | null
  tokens: string | number | null
  visitors: string | number | null
}

/** 查询结果转成小镇的用量行；模型名认不出厂商时按上游平台归类，同一“厂商 × 模型 × 周”合并。 */
export function toUsageRows(raw: RawUsageRow[]): UsageRow[] {
  const merged = new Map<string, UsageRow>()
  for (const row of raw) {
    const model = String(row.model ?? '').trim().slice(0, 100)
    const tokens = Number(row.tokens)
    if (!model || !(tokens > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(row.week)) continue
    const mapped = row.platform ? PLATFORM_LABS[row.platform.trim().toLowerCase()] : undefined
    const lab = mapped && resolveLab(undefined, model).id === OTHER_LAB.id ? mapped : undefined
    const visitors = row.visitors === null || row.visitors === undefined ? undefined : Number(row.visitors)
    const key = `${lab ?? ''}\u0000${model}\u0000${row.week}`
    const existing = merged.get(key)
    if (existing) {
      existing.tokens += tokens
      if (visitors !== undefined) existing.visitors = (existing.visitors ?? 0) + visitors
    } else {
      merged.set(key, { ...(lab ? { lab } : {}), model, week: row.week, tokens, ...(visitors !== undefined ? { visitors } : {}) })
    }
  }
  return Array.from(merged.values())
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'])

/** 把驱动和网络错误归成几类，管理员据此知道该检查哪一项。 */
export function classifyError(error: unknown): SourceError {
  if (error instanceof SourceError) return error
  const err = error as { code?: string; message?: string }
  const code = err?.code ?? ''
  const message = err?.message ?? ''
  if (code === '28P01' || code === '28000') return new SourceError('auth_failed', '数据库用户名或密码不对')
  if (code === '3D000') return new SourceError('database_missing', '数据库不存在，请检查库名')
  if (code === '42P01') return new SourceError('missing_table', '找不到 usage_logs 表，请确认连的是 Sub2API 的数据库')
  if (code === '42703') return new SourceError('missing_column', 'usage_logs 的列和预期不一致，Sub2API 版本可能不兼容')
  if (code === '42501') return new SourceError('permission', '账号没有读取 usage_logs（或 accounts、groups）的权限')
  if (code === '57014') return new SourceError('timeout', `查询超过 ${STATEMENT_TIMEOUT_MS / 1000} 秒被取消，可以减少统计周数`)
  if (/ssl|certificate|self[- ]signed/i.test(message) || code.startsWith('ERR_SSL') || code.includes('CERT')) {
    return new SourceError('ssl', 'SSL 连接失败，请检查 SSL 模式与服务器证书')
  }
  if (NETWORK_CODES.has(code) || /timeout expired|connection terminated|connect/i.test(message)) {
    return new SourceError('unreachable', '连不上数据库，请检查主机、端口和网络')
  }
  return new SourceError('unknown', '读取 Sub2API 数据失败')
}

export interface PoolLike {
  connect(): Promise<QueryClient & { release(): void }>
  end(): Promise<void>
}

export type PoolFactory = (connection: Sub2apiConnection) => PoolLike

export const createPgPool: PoolFactory = (connection) => {
  const pool = new pg.Pool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl:
      connection.sslmode === 'disable' ? false : { rejectUnauthorized: connection.sslmode === 'verify-full' },
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    application_name: 'token-town',
    options: `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  })
  // 数据库重启或网络断开时，空闲连接会在池子上抛 error；不监听的话整个进程会退出。
  // 坏连接已被池子丢弃，下次查询会重连，失败由 fetch 归类并标记数据过期。
  pool.on('error', (error) => {
    console.warn(`[token-town] Sub2API 空闲连接断开：${classifyError(error).message}`)
  })
  return pool as unknown as PoolLike
}

export interface TestSummary {
  latencyMs: number
  latestWeek: string | null
  weeks: number
  models: number
  top: { model: string; tokens: number }[]
}

/** 一个 Sub2API 连接（连接池），用完调用 close。 */
export class Sub2apiSource {
  private readonly pool: PoolLike

  constructor(
    readonly connection: Sub2apiConnection,
    createPool: PoolFactory = createPgPool,
  ) {
    if (!connection.host || !connection.user) throw new SourceError('not_configured', '还没有填写数据库主机和用户名')
    this.pool = createPool(connection)
  }

  /** 读取最近 backWeeks 个整周加本周的用量（backWeeks 为 0 时只读本周）。 */
  async fetch(backWeeks: number): Promise<UsageRow[]> {
    let client: (QueryClient & { release(): void }) | null = null
    try {
      client = await this.pool.connect()
      await client.query('BEGIN READ ONLY')
      const sql = buildUsageQuery(await probeColumns(client), this.connection)
      const { rows } = await client.query<RawUsageRow>(sql, [this.connection.timezone, backWeeks])
      await client.query('COMMIT')
      return toUsageRows(rows)
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined)
      throw classifyError(error)
    } finally {
      client?.release()
    }
  }

  /** 测试连接：读一遍完整窗口，汇总最新一周的情况。 */
  async test(): Promise<TestSummary> {
    const started = Date.now()
    const rows = await this.fetch(this.connection.weeks - 1)
    const weeks = Array.from(new Set(rows.map((row) => row.week))).sort()
    const latestWeek = weeks.at(-1) ?? null
    const latest = new Map<string, number>()
    for (const row of rows) if (row.week === latestWeek) latest.set(row.model, (latest.get(row.model) ?? 0) + row.tokens)
    const top = Array.from(latest.entries())
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)
    return { latencyMs: Date.now() - started, latestWeek, weeks: weeks.length, models: latest.size, top }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined)
  }
}

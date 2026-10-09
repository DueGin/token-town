// @vitest-environment node
/**
 * Sub2API 数据源的集成测试：连真实的 PostgreSQL，按 Sub2API v0.2.14 的表结构造数据。
 * 只在设置了 TEST_DATABASE_URL（需要能建表、建角色的账号）时运行，例如：
 *
 *   docker run -d --name token-town-it-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sub2api -p 127.0.0.1:55491:5432 postgres:18-alpine
 *   TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55491/sub2api pnpm exec vitest run server/sources/sub2api.integration.test.ts
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { READONLY_SQL } from '@/admin/readonly-sql'
import { DEFAULT_SUB2API } from '../config-store'
import { currentWeekIn } from '../dataset-service'
import { Sub2apiSource, type Sub2apiConnection } from './sub2api'

const url = process.env.TEST_DATABASE_URL
const READER_PASSWORD = 'reader-it-pw'

const SCHEMA = `
DROP TABLE IF EXISTS usage_logs, accounts, groups;
CREATE TABLE groups (id bigserial PRIMARY KEY, name varchar(100) NOT NULL, platform varchar(50) NOT NULL DEFAULT 'anthropic');
CREATE TABLE accounts (id bigserial PRIMARY KEY, name varchar(100) NOT NULL, platform varchar(50) NOT NULL);
CREATE TABLE usage_logs (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  api_key_id bigint NOT NULL DEFAULT 0,
  account_id bigint NOT NULL,
  request_id varchar(64) NOT NULL DEFAULT md5(random()::text),
  model varchar(100) NOT NULL,
  requested_model varchar(100),
  upstream_model varchar(100),
  group_id bigint,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  total_cost numeric(20,10) NOT NULL DEFAULT 0,
  actual_cost numeric(20,10) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO groups (id, name, platform) VALUES (1, 'claude', 'anthropic'), (2, 'mix', 'composite'), (3, 'kimi', 'kimi');
INSERT INTO accounts (id, name, platform) VALUES (1, 'a-anthropic', 'anthropic'), (2, 'a-openai', 'openai'), (3, 'a-kimi', 'kimi');
`

/** 删掉只读账号；数据库级的 CONNECT 授权要先用 DROP OWNED 收回，否则 DROP ROLE 会失败。 */
async function dropReader(client: pg.Client) {
  const { rows } = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'token_town'`)
  if (!rows.length) return
  await client.query('DROP OWNED BY token_town')
  await client.query('DROP ROLE token_town')
}

function connection(overrides: Partial<Sub2apiConnection> = {}): Sub2apiConnection {
  const parsed = new URL(url!)
  return {
    ...DEFAULT_SUB2API,
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: parsed.pathname.slice(1),
    user: 'token_town',
    password: READER_PASSWORD,
    ...overrides,
  }
}

describe.skipIf(!url)('Sub2API 数据源（真实 PostgreSQL）', () => {
  let admin: pg.Client
  /** 上海时区的本周周一，以及上周周一。 */
  let thisWeek = ''
  let lastWeek = ''

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await dropReader(admin)
    await admin.query(SCHEMA)
    await admin.query(READONLY_SQL.replace('请替换为强密码', READER_PASSWORD))

    thisWeek = currentWeekIn('Asia/Shanghai', new Date())
    const monday = new Date(`${thisWeek}T00:00:00+08:00`)
    lastWeek = new Date(monday.getTime() - 7 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10)
    // 时刻都相对“上海本周一 00:00”：
    // - 本周一 00:30 上海 = 上周日 16:30 UTC，按上海时区应算本周
    // - 本周一前 30 分钟，应算上周
    const rows: [string, number, number, string | null, string, number, number, number, number, number][] = [
      // model, user, account, requested_model, offset, input, output, cacheCreate, cacheRead, actual_cost
      ['claude-sonnet-4-5', 1, 1, null, '30 minutes', 100, 50, 10, 5, 0.01],
      ['claude-sonnet-4-5', 2, 1, null, '1 hour', 200, 0, 0, 0, 0.02],
      ['claude-sonnet-4-5', 3, 1, null, '-30 minutes', 1_000, 0, 0, 0, 0.1],
      // 失败请求的占位行（actual_cost = 0）：默认不统计
      ['claude-sonnet-4-5', 4, 1, null, '2 hours', 9_999, 0, 0, 0, 0],
      // 映射过的请求：requested_model 是客户端请求的名字
      ['gpt-5-codex-upstream', 1, 2, 'gpt-5', '3 hours', 70, 30, 0, 0, 0.01],
      // 认不出厂商的模型：组是 composite，按账号平台 kimi 归到 Kimi
      ['house-model-x', 5, 3, null, '4 hours', 40, 0, 0, 0, 0.01],
    ]
    for (const [model, user, account, requested, offset, input, output, cc, cr, cost] of rows) {
      await admin.query(
        `INSERT INTO usage_logs (user_id, account_id, group_id, model, requested_model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, actual_cost, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ($11::date::timestamp AT TIME ZONE 'Asia/Shanghai') + $12::interval)`,
        [user, account, account === 3 ? 2 : 1, model, requested, input, output, cc, cr, cost, thisWeek, offset],
      )
    }
  })

  afterAll(async () => {
    if (!admin) return
    await admin.query('DROP TABLE IF EXISTS usage_logs, accounts, groups').catch(() => undefined)
    await dropReader(admin).catch(() => undefined)
    await admin.end()
  })

  it('用只读账号按上海时区分周聚合，只统计成功请求，模型名用客户端请求的名字', async () => {
    const source = new Sub2apiSource(connection())
    try {
      const rows = await source.fetch(7)
      const byKey = new Map(rows.map((row) => [`${row.model}@${row.week}`, row]))
      // 本周一 00:30 与 01:00 的两次成功请求：(100+50+10+5) + 200，两位用户
      expect(byKey.get(`claude-sonnet-4-5@${thisWeek}`)).toMatchObject({ tokens: 365, visitors: 2 })
      expect(byKey.get(`claude-sonnet-4-5@${lastWeek}`)).toMatchObject({ tokens: 1_000, visitors: 1 })
      expect(byKey.get(`gpt-5@${thisWeek}`)).toMatchObject({ tokens: 100 })
      expect(byKey.has(`gpt-5-codex-upstream@${thisWeek}`)).toBe(false)
      // 模型名认不出厂商时，按有效平台（composite 组取账号平台）归到 Kimi
      expect(byKey.get(`house-model-x@${thisWeek}`)).toMatchObject({ lab: 'moonshot', tokens: 40 })

      const current = await source.fetch(0)
      expect(new Set(current.map((row) => row.week))).toEqual(new Set([thisWeek]))
    } finally {
      await source.close()
    }
  })

  it('按 UTC 分周时，上海周一凌晨的请求归到上一周；关闭“只统计成功”会计入失败占位行', async () => {
    const utc = new Sub2apiSource(connection({ timezone: 'UTC', successOnly: false, modelField: 'upstream' }))
    try {
      const rows = await utc.fetch(7)
      const claude = rows.filter((row) => row.model === 'claude-sonnet-4-5')
      const total = claude.reduce((sum, row) => sum + row.tokens, 0)
      expect(total).toBe(365 + 1_000 + 9_999)
      expect(rows.some((row) => row.model === 'gpt-5-codex-upstream')).toBe(true)
    } finally {
      await utc.close()
    }
  })

  it('连接是只读的：即使有写权限也写不进去', async () => {
    await admin.query('GRANT INSERT ON usage_logs TO token_town')
    const client = new pg.Client({ ...connection(), options: '-c default_transaction_read_only=on' })
    await client.connect()
    try {
      await expect(client.query(`INSERT INTO usage_logs (user_id, account_id, model) VALUES (1, 1, 'x')`)).rejects.toMatchObject({ code: '25006' })
    } finally {
      await client.end()
      await admin.query('REVOKE INSERT ON usage_logs FROM token_town')
    }
  })

  it('密码错误、库不存在、连不上时给出对应的分类', async () => {
    await expect(new Sub2apiSource(connection({ password: 'wrong' })).fetch(0)).rejects.toMatchObject({ code: 'auth_failed' })
    await expect(new Sub2apiSource(connection({ database: 'no_such_db' })).fetch(0)).rejects.toMatchObject({ code: 'database_missing' })
    await expect(new Sub2apiSource(connection({ port: 1 })).fetch(0)).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('读不了 accounts 时退化为不按平台识别；读不了 usage_logs 时提示权限不足', async () => {
    // 没有权限的表在 information_schema 里也看不到，探测列时自然跳过平台辅助识别
    await admin.query('REVOKE SELECT ON accounts FROM token_town')
    try {
      const rows = await new Sub2apiSource(connection()).fetch(0)
      expect(rows.find((row) => row.model === 'house-model-x')).toMatchObject({ tokens: 40 })
      expect(rows.find((row) => row.model === 'house-model-x')?.lab).toBeUndefined()
    } finally {
      await admin.query('GRANT SELECT ON accounts TO token_town')
    }
    await admin.query('REVOKE SELECT ON usage_logs FROM token_town')
    try {
      await expect(new Sub2apiSource(connection()).fetch(0)).rejects.toMatchObject({ code: 'missing_table' })
    } finally {
      await admin.query('GRANT SELECT ON usage_logs TO token_town')
    }
  })

  it('数据库断开空闲连接（例如重启）时进程不崩溃，下次查询自动重连', async () => {
    const source = new Sub2apiSource(connection())
    try {
      await source.fetch(0)
      // 模拟数据库重启：把小镇的连接全部踢掉，池子里的空闲连接会收到错误
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'token_town' AND pid <> pg_backend_pid()`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const rows = await source.fetch(0)
      expect(rows.length).toBeGreaterThan(0)
    } finally {
      await source.close()
    }
  })

  it('测试连接汇总最新一周的模型', async () => {
    const source = new Sub2apiSource(connection())
    try {
      const summary = await source.test()
      expect(summary.latestWeek).toBe(thisWeek)
      expect(summary.top[0]).toEqual({ model: 'claude-sonnet-4-5', tokens: 365 })
    } finally {
      await source.close()
    }
  })
})

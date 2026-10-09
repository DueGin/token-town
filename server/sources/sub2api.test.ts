// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUB2API } from '../config-store'
import { fakePool, SUB2API_COLUMNS } from '../test-helpers'
import { buildUsageQuery, classifyError, SourceError, Sub2apiSource, toUsageRows, type SchemaColumns } from './sub2api'

function schema(columns: [string, string, string][] = SUB2API_COLUMNS): SchemaColumns {
  const result: SchemaColumns = { usage: new Map(), accounts: new Set(), groups: new Set() }
  for (const [table, column, type] of columns) {
    if (table === 'usage_logs') result.usage.set(column, type)
    else if (table === 'accounts') result.accounts.add(column)
    else result.groups.add(column)
  }
  return result
}

const OPTIONS = { modelField: 'requested', successOnly: true, platformAssist: true } as const

describe('buildUsageQuery', () => {
  it('默认按官方口径：请求模型名、四类 token 合计、只统计成功请求、按有效平台归类', () => {
    const sql = buildUsageQuery(schema(), OPTIONS)
    expect(sql).toContain(`COALESCE(NULLIF(TRIM(u.requested_model), ''), u.model) AS model`)
    expect(sql).toContain('COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0) + COALESCE(u.cache_creation_tokens, 0) + COALESCE(u.cache_read_tokens, 0)')
    expect(sql).toContain('AND u.actual_cost > 0')
    expect(sql).toContain(`CASE WHEN g.platform = 'composite' THEN a.platform`)
    expect(sql).toContain('LEFT JOIN groups g ON g.id = u.group_id')
    expect(sql).toContain('COUNT(DISTINCT u.user_id)')
    // 时区与周数都是参数
    expect(sql).toContain('AT TIME ZONE $1')
    expect(sql).toContain('make_interval(weeks => $2::int)')
    expect(sql).not.toMatch(/Asia\/Shanghai/)
  })

  it('可选列缺失时自动退化；上游模型口径；关掉选项就不拼对应子句', () => {
    const old = SUB2API_COLUMNS.filter(([table, column]) => table === 'usage_logs' && !['requested_model', 'upstream_model', 'cache_read_tokens', 'actual_cost', 'user_id'].includes(column))
    const sql = buildUsageQuery(schema(old), OPTIONS)
    expect(sql).toContain('SELECT u.model AS model')
    expect(sql).not.toContain('cache_read_tokens')
    expect(sql).not.toContain('actual_cost')
    expect(sql).toContain('NULL::bigint AS visitors')
    // 没有 accounts / groups 的平台列，就不 JOIN
    expect(sql).toContain('NULL::text AS platform')
    expect(sql).not.toContain('JOIN')

    const upstream = buildUsageQuery(schema(), { modelField: 'upstream', successOnly: false, platformAssist: false })
    expect(upstream).toContain(`COALESCE(NULLIF(TRIM(u.upstream_model), ''), u.model) AS model`)
    expect(upstream).not.toContain('actual_cost')
    expect(upstream).not.toContain('JOIN')
  })

  it('老版本不带时区的 created_at 按 UTC 理解', () => {
    const cols = SUB2API_COLUMNS.map(([t, c, type]): [string, string, string] => (c === 'created_at' ? [t, c, 'timestamp without time zone'] : [t, c, type]))
    expect(buildUsageQuery(schema(cols), OPTIONS)).toContain(`(u.created_at AT TIME ZONE 'UTC') >=`)
  })

  it('没有 usage_logs 表或缺少必需列时给出明确的错误', () => {
    expect(() => buildUsageQuery(schema([]), OPTIONS)).toThrow(SourceError)
    const noOutput = SUB2API_COLUMNS.filter(([, column]) => column !== 'output_tokens')
    expect(() => buildUsageQuery(schema(noOutput), OPTIONS)).toThrow('usage_logs 缺少列：output_tokens')
  })
})

describe('toUsageRows', () => {
  it('认不出厂商的模型按上游平台归类；认得出的不受平台影响；同一组合并', () => {
    const rows = toUsageRows([
      { model: 'my-internal-coder', week: '2026-09-21', platform: 'anthropic', tokens: '100', visitors: '3' },
      { model: 'my-internal-coder', week: '2026-09-21', platform: 'anthropic', tokens: '50', visitors: '2' },
      { model: 'my-internal-coder', week: '2026-09-21', platform: 'composite', tokens: '7', visitors: null },
      { model: 'gpt-5', week: '2026-09-21', platform: 'anthropic', tokens: 10, visitors: 1 },
      { model: '  ', week: '2026-09-21', platform: null, tokens: 10, visitors: 1 },
      { model: 'zero', week: '2026-09-21', platform: null, tokens: '0', visitors: 1 },
    ])
    expect(rows).toEqual([
      { lab: 'anthropic', model: 'my-internal-coder', week: '2026-09-21', tokens: 150, visitors: 5 },
      { model: 'my-internal-coder', week: '2026-09-21', tokens: 7 },
      { model: 'gpt-5', week: '2026-09-21', tokens: 10, visitors: 1 },
    ])
  })
})

describe('classifyError', () => {
  it('把驱动和网络错误归成几类，不带出原始信息', () => {
    expect(classifyError({ code: '28P01', message: 'password authentication failed for user "x"' })).toMatchObject({ code: 'auth_failed' })
    expect(classifyError({ code: '3D000' }).code).toBe('database_missing')
    expect(classifyError({ code: '42P01' }).code).toBe('missing_table')
    expect(classifyError({ code: '42501' }).code).toBe('permission')
    expect(classifyError({ code: '57014' }).code).toBe('timeout')
    expect(classifyError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:5432' })).toMatchObject({
      code: 'unreachable',
      message: '连不上数据库，请检查主机、端口和网络',
    })
    expect(classifyError(new Error('The server does not support SSL connections')).code).toBe('ssl')
    expect(classifyError(new Error('something odd at host db.internal')).message).not.toContain('db.internal')
  })
})

describe('Sub2apiSource', () => {
  const connection = { ...DEFAULT_SUB2API, host: 'db', user: 'reader', password: 'secret' }

  it('在只读事务里探测列再查询，时区和回溯周数作为参数', async () => {
    const pool = fakePool({ usage: () => [{ model: 'claude-x', week: '2026-09-21', platform: 'anthropic', tokens: '42', visitors: '1' }] })
    const source = new Sub2apiSource(connection, pool.factory)
    const rows = await source.fetch(7)
    expect(rows).toEqual([{ model: 'claude-x', week: '2026-09-21', tokens: 42, visitors: 1 }])
    expect(pool.calls.map((call) => call.text.split('\n')[0].trim())).toEqual([
      'BEGIN READ ONLY',
      'SELECT table_name, column_name, data_type',
      `SELECT COALESCE(NULLIF(TRIM(u.requested_model), ''), u.model) AS model,`,
      'COMMIT',
    ])
    expect(pool.calls[2].params).toEqual(['Asia/Shanghai', 7])
    expect(pool.released).toBe(1)
    await source.close()
    expect(pool.ended).toBe(1)
  })

  it('查询失败时回滚、归还连接，并抛出分类后的错误', async () => {
    const pool = fakePool({ fail: { on: 'usage', error: { code: '57014' } } })
    const source = new Sub2apiSource(connection, pool.factory)
    await expect(source.fetch(0)).rejects.toMatchObject({ code: 'timeout' })
    expect(pool.calls.at(-1)?.text).toBe('ROLLBACK')
    expect(pool.released).toBe(1)
  })

  it('没填主机或用户名时不建连接', () => {
    expect(() => new Sub2apiSource({ ...connection, host: '' }, fakePool({}).factory)).toThrow('还没有填写')
  })

  it('测试连接汇总最新一周的模型', async () => {
    const pool = fakePool({
      usage: () => [
        { model: 'a', week: '2026-09-14', platform: null, tokens: 5, visitors: 1 },
        { model: 'a', week: '2026-09-21', platform: null, tokens: 30, visitors: 1 },
        { model: 'b', week: '2026-09-21', platform: null, tokens: 70, visitors: 1 },
      ],
    })
    const summary = await new Sub2apiSource(connection, pool.factory).test()
    expect(summary).toMatchObject({ latestWeek: '2026-09-21', weeks: 2, models: 2, top: [{ model: 'b', tokens: 70 }, { model: 'a', tokens: 30 }] })
    expect(pool.calls.find((call) => call.params)?.params).toEqual(['Asia/Shanghai', 7])
  })
})

// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigStore, DEFAULT_SUB2API, defaultConfig, type TownConfig } from './config-store'
import { currentWeekIn, DatasetService, FULL_REFRESH_MS, SUB2API_LABEL, type PublicDataset } from './dataset-service'
import { deriveSecrets, encryptText } from './secrets'
import { fakePool } from './test-helpers'

const secrets = deriveSecrets('s'.repeat(40))

function tempStore() {
  return new ConfigStore(mkdtempSync(path.join(tmpdir(), 'token-town-')))
}

function sub2apiConfig(): TownConfig {
  const config = defaultConfig()
  config.source.active = 'sub2api'
  config.source.sub2api = { ...DEFAULT_SUB2API, host: 'db', user: 'reader', passwordEnc: encryptText(secrets.configKey, 'pw') }
  return config
}

function parse(service: DatasetService): PublicDataset {
  return JSON.parse(service.publicDataset().body) as PublicDataset
}

describe('currentWeekIn', () => {
  it('按指定时区算本周周一：UTC 周日晚上在上海已经是周一', () => {
    const sundayNightUtc = new Date('2026-09-27T18:00:00Z')
    expect(currentWeekIn('UTC', sundayNightUtc)).toBe('2026-09-21')
    expect(currentWeekIn('Asia/Shanghai', sundayNightUtc)).toBe('2026-09-28')
  })
})

describe('ConfigStore', () => {
  it('保存后能读回；内容损坏时报错而不是悄悄重置', async () => {
    const store = tempStore()
    expect(store.load()).toBeNull()
    const config = sub2apiConfig()
    store.save(config)
    expect(store.load()).toEqual(config)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(store.dir, 'config.json'), '{"version":2}')
    expect(() => store.load()).toThrow('内容无效')
  })
})

describe('DatasetService', () => {
  it('示例数据开箱可用；隐藏的厂商不会出现在公开数据里，ETag 随之变化', async () => {
    const service = new DatasetService(tempStore(), secrets, defaultConfig())
    await service.start()
    const before = service.publicDataset()
    const all = parse(service)
    expect(all.source).toBe('sample')
    expect(all.rows.some((row) => /^gpt/i.test(row.model))).toBe(true)

    await service.applyConfig({ ...service.currentConfig, shops: { hidden: ['openai'] } })
    const after = service.publicDataset()
    expect(after.etag).not.toBe(before.etag)
    const filtered = parse(service)
    expect(filtered.rows.some((row) => /^gpt/i.test(row.model))).toBe(false)
    expect(filtered.models.some((info) => /^gpt/i.test(info.model))).toBe(false)
    // 后台仍然能看到完整数据
    expect(service.rawDataset().rows.length).toBe(all.rows.length)
    await service.stop()
  })

  it('Sub2API：第一次读完整窗口，之后只重查本周；跨周或满一小时再读完整窗口', async () => {
    let now = new Date('2026-09-24T04:00:00Z')
    const pool = fakePool({
      usage: (back) =>
        back > 0
          ? [
              { model: 'claude-x', week: '2026-09-14', platform: null, tokens: 100, visitors: 1 },
              { model: 'claude-x', week: '2026-09-21', platform: null, tokens: 10, visitors: 1 },
            ]
          : [{ model: 'claude-x', week: currentWeekIn('Asia/Shanghai', now), platform: null, tokens: 25, visitors: 2 }],
    })
    const service = new DatasetService(tempStore(), secrets, sub2apiConfig(), { now: () => now, createPool: pool.factory })
    await service.start()
    const weeksQueried = () => pool.calls.filter((call) => call.params).map((call) => call.params?.[1])
    expect(weeksQueried()).toEqual([7])
    expect(parse(service)).toMatchObject({ source: 'sub2api', label: SUB2API_LABEL, stale: false, updatedAt: now.toISOString() })

    now = new Date(now.getTime() + 60_000)
    await service.refresh()
    expect(weeksQueried()).toEqual([7, 0])
    // 过去的周保留，本周换成最新的数
    expect(parse(service).rows).toEqual([
      { model: 'claude-x', week: '2026-09-14', tokens: 100, visitors: 1 },
      { model: 'claude-x', week: '2026-09-21', tokens: 25, visitors: 2 },
    ])

    now = new Date(now.getTime() + FULL_REFRESH_MS)
    await service.refresh()
    now = new Date('2026-09-28T01:00:00Z')
    await service.refresh()
    expect(weeksQueried()).toEqual([7, 0, 7, 7])
    await service.stop()
    expect(pool.ended).toBe(1)
  })

  it('刷新失败时继续提供上一次的数据并标记过期；从没成功过就是空数据', async () => {
    let fail = false
    const pool = fakePool({
      usage: () => {
        if (fail) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
        return [{ model: 'claude-x', week: '2026-09-21', platform: null, tokens: 10, visitors: 1 }]
      },
    })
    const service = new DatasetService(tempStore(), secrets, sub2apiConfig(), { now: () => new Date('2026-09-24T04:00:00Z'), createPool: pool.factory })
    await service.start()
    fail = true
    await service.refresh({ full: true })
    expect(parse(service)).toMatchObject({ stale: true, rows: [{ model: 'claude-x' }] })
    expect(service.status()).toMatchObject({ stale: true, error: { code: 'unreachable' } })
    await service.stop()

    const broken = fakePool({ fail: { on: 'connect', error: { code: '28P01' } } })
    const empty = new DatasetService(tempStore(), secrets, sub2apiConfig(), { createPool: broken.factory })
    await empty.start()
    expect(parse(empty)).toMatchObject({ stale: false, updatedAt: null, rows: [] })
    expect(empty.status().error).toMatchObject({ code: 'auth_failed', message: '数据库用户名或密码不对' })
    await empty.stop()
  })

  it('只改隐藏名单不重查数据库；改连接参数会换连接池重查', async () => {
    const pool = fakePool({ usage: () => [] })
    const service = new DatasetService(tempStore(), secrets, sub2apiConfig(), { createPool: pool.factory })
    await service.start()
    const queries = () => pool.calls.filter((call) => call.params).length
    expect(queries()).toBe(1)
    await service.applyConfig({ ...service.currentConfig, shops: { hidden: ['xai'] } })
    expect(queries()).toBe(1)
    const config = service.currentConfig
    await service.applyConfig({ ...config, source: { ...config.source, sub2api: { ...config.source.sub2api, weeks: 4 } } })
    expect(queries()).toBe(2)
    expect(pool.calls.filter((call) => call.params).at(-1)?.params).toEqual(['Asia/Shanghai', 3])
    expect(pool.ended).toBe(1)
    await service.stop()
  })

  it('保存的密码解不开时（换了 TOWN_SECRET）当作没有密码', () => {
    const config = sub2apiConfig()
    config.source.sub2api.passwordEnc = encryptText(deriveSecrets('o'.repeat(40)).configKey, 'pw')
    expect(new DatasetService(tempStore(), secrets, config).savedPassword()).toBe('')
  })
})

// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { AdminPassword, LoginLimiter } from './auth'
import { ConfigStore, DEFAULT_SUB2API, defaultConfig } from './config-store'
import { DatasetService } from './dataset-service'
import { deriveSecrets } from './secrets'
import { fakePool } from './test-helpers'

const secrets = deriveSecrets('a'.repeat(40))
const ORIGIN = 'http://town.test'

function setup(options: { admin?: boolean; usage?: Parameters<typeof fakePool>[0]['usage'] } = {}) {
  const store = new ConfigStore(mkdtempSync(path.join(tmpdir(), 'token-town-app-')))
  const pool = fakePool({ usage: options.usage ?? (() => [{ model: 'claude-x', week: '2026-09-21', platform: null, tokens: 10, visitors: 1 }]) })
  const service = new DatasetService(store, secrets, defaultConfig(), { createPool: pool.factory })
  const app = createApp({
    service,
    secrets,
    admin: options.admin === false ? null : new AdminPassword('open sesame'),
    limiter: new LoginLimiter(3, 60_000),
  })
  let cookie = ''
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`${ORIGIN}${url}`, {
      method,
      headers: {
        host: 'town.test',
        ...(body !== undefined ? { 'content-type': 'application/json', origin: ORIGIN } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return res
  }
  const login = () => call('POST', '/api/admin/login', { password: 'open sesame' })
  return { store, pool, service, app, call, login, setCookie: (value: string) => (cookie = value) }
}

describe('公开接口', () => {
  it('返回小镇数据并支持 ETag', async () => {
    const { call, service } = setup()
    await service.start()
    const res = await call('GET', '/api/town/dataset')
    expect(res.status).toBe(200)
    const etag = res.headers.get('etag')!
    const data = await res.json()
    expect(data).toMatchObject({ source: 'sample', pollSeconds: 30 })
    expect(data.rows.length).toBeGreaterThan(0)
    const again = await call('GET', '/api/town/dataset', undefined, { 'if-none-match': etag })
    expect(again.status).toBe(304)
  })

  it('未知接口返回 404 JSON', async () => {
    const res = await setup().call('GET', '/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: '接口不存在' } })
  })
})

describe('后台登录', () => {
  it('没设置管理员密码时后台不可用', async () => {
    const res = await setup({ admin: false }).call('GET', '/api/admin/status')
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('admin_disabled')
  })

  it('未登录 401；密码错误 401 并计入限流，连续失败后 429；登录成功下发 HttpOnly + SameSite=Strict 的会话', async () => {
    const { call, setCookie } = setup()
    expect((await call('GET', '/api/admin/status')).status).toBe(401)
    expect(await (await call('GET', '/api/admin/session')).json()).toEqual({ authenticated: false })
    for (let i = 0; i < 3; i += 1) expect((await call('POST', '/api/admin/login', { password: 'nope' })).status).toBe(401)
    const limited = await call('POST', '/api/admin/login', { password: 'open sesame' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()

    const fresh = setup()
    const ok = await fresh.login()
    expect(ok.status).toBe(200)
    const header = ok.headers.get('set-cookie')!
    expect(header).toMatch(/town_admin=/)
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Strict/)
    expect((await fresh.call('GET', '/api/admin/status')).status).toBe(200)
    expect(await (await fresh.call('GET', '/api/admin/session')).json()).toEqual({ authenticated: true })

    // 伪造的 Cookie 无效
    setCookie('town_admin=eyJleHAiOjk5OTk5OTk5OTk5OTl9.forged')
    expect((await call('GET', '/api/admin/status')).status).toBe(401)
  })

  it('写请求必须同源、必须是 JSON', async () => {
    const { call, login } = setup()
    await login()
    const crossSite = await call('PUT', '/api/admin/shops', { hidden: [] }, { origin: 'https://evil.example' })
    expect(crossSite.status).toBe(403)
    const form = await call('PUT', '/api/admin/shops', { hidden: [] }, { 'content-type': 'text/plain' })
    expect(form.status).toBe(415)
  })
})

describe('店铺展示', () => {
  it('列出全部厂商和本周用量；隐藏后公开数据里就没有这家店', async () => {
    const { call, login, service } = setup()
    await service.start()
    await login()
    const list = await (await call('GET', '/api/admin/shops')).json()
    const openai = list.shops.find((shop: { id: string }) => shop.id === 'openai')
    expect(openai).toMatchObject({ name: 'OpenAI', visible: true, hasData: true })
    expect(openai.tokens).toBeGreaterThan(0)
    expect(list.shops.some((shop: { id: string }) => shop.id === 'other')).toBe(true)

    const saved = await (await call('PUT', '/api/admin/shops', { hidden: ['openai', 'openai', 'gone-lab'] })).json()
    expect(saved.shops.find((shop: { id: string }) => shop.id === 'openai').visible).toBe(false)
    // 已隐藏但数据里没有的厂商也列出来，方便恢复
    expect(saved.shops.find((shop: { id: string }) => shop.id === 'gone-lab')).toMatchObject({ visible: false, hasData: false })
    expect(service.currentConfig.shops.hidden).toEqual(['openai', 'gone-lab'])
    const town = await (await call('GET', '/api/town/dataset')).json()
    expect(town.rows.some((row: { model: string }) => /^gpt/i.test(row.model))).toBe(false)
  })
})

describe('数据源', () => {
  const settings = { ...DEFAULT_SUB2API, host: 'db', user: 'reader' }

  it('保存时加密密码、接口永不返回密码；不传保留、空串清除', async () => {
    const { call, login, store } = setup()
    await login()
    const first = await (await call('PUT', '/api/admin/source', { active: 'sub2api', sub2api: settings, password: 'hunter2' })).json()
    expect(first.source).toMatchObject({ active: 'sub2api', sub2api: { host: 'db', hasPassword: true } })
    expect(JSON.stringify(first)).not.toContain('hunter2')
    expect(JSON.stringify(first)).not.toContain('passwordEnc')
    const raw = JSON.stringify(store.load())
    expect(raw).not.toContain('hunter2')
    expect(store.load()?.source.sub2api.passwordEnc).toMatch(/^v1\./)

    const kept = await (await call('PUT', '/api/admin/source', { active: 'sub2api', sub2api: { ...settings, weeks: 4 } })).json()
    expect(kept.source.sub2api).toMatchObject({ weeks: 4, hasPassword: true })
    const cleared = await (await call('PUT', '/api/admin/source', { active: 'sample', sub2api: settings, password: '' })).json()
    expect(cleared.source).toMatchObject({ active: 'sample', sub2api: { hasPassword: false } })
  })

  it('参数不合法或启用条件不满足时 400', async () => {
    const { call, login } = setup()
    await login()
    const badZone = await call('PUT', '/api/admin/source', { active: 'sample', sub2api: { ...settings, timezone: 'Mars/Olympus' } })
    expect(badZone.status).toBe(400)
    expect((await badZone.json()).error.message).toBe('时区无效')
    const noHost = await call('PUT', '/api/admin/source', { active: 'sub2api', sub2api: { ...settings, host: '' } })
    expect((await noHost.json()).error.message).toContain('请填写数据库主机')
    const noFile = await call('PUT', '/api/admin/source', { active: 'file', sub2api: settings })
    expect((await noFile.json()).error.message).toBe('请先上传数据文件')
  })

  it('测试连接用表单里的参数，不传密码时用已保存的；失败给出分类原因', async () => {
    const { call, login, pool } = setup()
    await login()
    const ok = await (await call('POST', '/api/admin/source/test', { sub2api: settings, password: 'x' })).json()
    expect(ok).toMatchObject({ ok: true, summary: { latestWeek: '2026-09-21', models: 1 } })
    expect(pool.ended).toBe(1)
    const missing = await (await call('POST', '/api/admin/source/test', { sub2api: { ...settings, host: '' } })).json()
    expect(missing).toEqual({ ok: false, error: { code: 'not_configured', message: '还没有填写数据库主机和用户名' } })
  })

  it('启用 Sub2API 后小镇显示实时数据', async () => {
    const { call, login, service } = setup()
    await service.start()
    await login()
    await call('PUT', '/api/admin/source', { active: 'sub2api', sub2api: settings, password: 'pw' })
    const town = await (await call('GET', '/api/town/dataset')).json()
    expect(town).toMatchObject({ source: 'sub2api', label: 'Sub2API · 实时', rows: [{ model: 'claude-x', tokens: 10 }] })
    const status = await (await call('POST', '/api/admin/source/refresh', {})).json()
    expect(status).toMatchObject({ active: 'sub2api', rows: 1, latestWeek: '2026-09-21', error: null })
    await service.stop()
  })

  it('上传 CSV：解析并保存，可同时启用；解析失败给出原因', async () => {
    const { call, login, service } = setup()
    await service.start()
    await login()
    const text = ['lab,model,week,tokens', 'OpenAI,gpt-up,2026-09-21,900', ',bad-row,not-a-date,1'].join('\n')
    const res = await (await call('POST', '/api/admin/source/file', { fileName: 'usage.csv', text, activate: true })).json()
    expect(res).toMatchObject({ accepted: 1, skipped: 1, source: { active: 'file', file: { fileName: 'usage.csv', rows: 1 } } })
    expect(res.firstIssue).toBeTruthy()
    const town = await (await call('GET', '/api/town/dataset')).json()
    expect(town).toMatchObject({ source: 'file', rows: [{ model: 'gpt-up', tokens: 900 }] })

    const broken = await call('POST', '/api/admin/source/file', { fileName: 'x.csv', text: 'foo,bar\n1,2' })
    expect(broken.status).toBe(400)
    expect((await broken.json()).error.code).toBe('import_failed')
    await service.stop()
  })
})

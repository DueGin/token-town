import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApp } from '@/admin/AdminApp'

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('sonner')>()), toast: toastMock }))

type Handler = (body: Record<string, unknown> | undefined) => { status?: number; body: unknown }

const STATUS = {
  active: 'sub2api',
  label: 'Sub2API · 实时',
  updatedAt: '2026-09-30T06:00:00Z',
  lastAttemptAt: '2026-09-30T06:00:00Z',
  error: null,
  stale: false,
  rows: 120,
  latestWeek: '2026-09-28',
  refreshing: false,
}

const SUB2API = {
  host: 'postgres',
  port: 5432,
  database: 'sub2api',
  user: 'token_town',
  sslmode: 'disable',
  timezone: 'Asia/Shanghai',
  weeks: 8,
  refreshSeconds: 60,
  modelField: 'requested',
  successOnly: true,
  platformAssist: true,
}

const SOURCE = { active: 'sub2api', sub2api: { ...SUB2API, hasPassword: true }, file: null }

const SHOPS = [
  { id: 'openai', name: 'OpenAI', color: '#10a37f', monogram: 'O', tokens: 5_000_000, hasData: true, visible: true },
  { id: 'xai', name: 'xAI', color: '#111111', monogram: 'X', tokens: 0, hasData: false, visible: false },
]

/** 后台接口的替身：按“方法 路径”分派，记录每次请求体。 */
function mockServer(overrides: Record<string, Handler> = {}) {
  const calls: { key: string; body?: Record<string, unknown> }[] = []
  const handlers: Record<string, Handler> = {
    'GET /api/admin/session': () => ({ body: { authenticated: true } }),
    'POST /api/admin/login': (body) =>
      body?.password === 'right' ? { body: { ok: true } } : { status: 401, body: { error: { code: 'wrong_password', message: '密码不正确' } } },
    'POST /api/admin/logout': () => ({ body: { ok: true } }),
    'GET /api/admin/status': () => ({ body: STATUS }),
    'POST /api/admin/source/refresh': () => ({ body: STATUS }),
    'GET /api/admin/shops': () => ({ body: { shops: SHOPS } }),
    'PUT /api/admin/shops': (body) => ({
      body: { shops: SHOPS.map((shop) => ({ ...shop, visible: !(body?.hidden as string[]).includes(shop.id) })) },
    }),
    'GET /api/admin/source': () => ({ body: SOURCE }),
    'PUT /api/admin/source': () => ({ body: { source: SOURCE, status: STATUS } }),
    'POST /api/admin/source/test': () => ({
      body: { ok: true, summary: { latencyMs: 42, latestWeek: '2026-09-28', weeks: 8, models: 2, top: [{ model: 'claude-x', tokens: 9_000_000 }, { model: 'gpt-y', tokens: 1_000 }] } },
    }),
    'POST /api/admin/source/file': (body) => ({
      body: { accepted: 3, skipped: 0, firstIssue: null, source: { ...SOURCE, active: 'file', file: { label: '导入', fileName: String(body?.fileName), uploadedAt: '2026-09-30T06:00:00Z', rows: 3 } }, status: STATUS },
    }),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const key = `${method} ${url}`
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      calls.push({ key, body })
      const handler = handlers[key]
      if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: '接口不存在' } }), { status: 404 })
      const reply = handler(body)
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('控制后台', () => {
  it('未登录时显示登录页：密码错误提示在表单里，登录后进入概览', async () => {
    const user = userEvent.setup()
    const calls = mockServer({ 'GET /api/admin/session': () => ({ body: { authenticated: false } }) })
    render(<AdminApp />)
    const field = await screen.findByLabelText('管理员密码')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入管理员密码')
    await user.type(field, 'wrong')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('密码不正确')
    expect(field).toHaveAttribute('aria-invalid', 'true')

    await user.clear(field)
    await user.type(field, 'right{Enter}')
    expect(await screen.findByRole('heading', { name: 'Token 商店小镇 · 控制后台' })).toBeInTheDocument()
    expect(await screen.findByText('Sub2API 数据库')).toBeInTheDocument()
    expect(calls.filter((call) => call.key === 'POST /api/admin/login').map((call) => call.body)).toEqual([{ password: 'wrong' }, { password: 'right' }])
  })

  it('服务端没设管理员密码时说明后台未启用', async () => {
    mockServer({ 'GET /api/admin/session': () => ({ status: 503, body: { error: { code: 'admin_disabled', message: '未启用' } } }) })
    render(<AdminApp />)
    expect(await screen.findByText('控制后台未启用')).toBeInTheDocument()
    expect(screen.getByText('ADMIN_PASSWORD')).toBeInTheDocument()
  })

  it('概览里手动刷新给出通知；会话过期时回到登录页', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<AdminApp />)
    await user.click(await screen.findByRole('button', { name: '立即刷新' }))
    expect(toastMock.success).toHaveBeenCalledWith('数据已刷新', { description: '共 120 行' })

    mockServer({ 'POST /api/admin/source/refresh': () => ({ status: 401, body: { error: { code: 'unauthorized', message: '请先登录控制后台' } } }) })
    await user.click(screen.getByRole('button', { name: '立即刷新' }))
    expect(await screen.findByLabelText('管理员密码')).toBeInTheDocument()
    expect(toastMock.warning).toHaveBeenCalledWith('登录已过期，请重新登录')
  })

  it('店铺展示：开关改的是草稿，保存时提交隐藏名单', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    window.location.hash = '#shops'
    render(<AdminApp />)
    const openai = await screen.findByRole('switch', { name: '在小镇展示 OpenAI' })
    expect(openai).toBeChecked()
    expect(screen.getByRole('switch', { name: '在小镇展示 xAI' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    await user.click(openai)
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销修改' }))
    expect(openai).toBeChecked()

    await user.click(screen.getByRole('button', { name: '全部展示' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(calls.find((call) => call.key === 'PUT /api/admin/shops')?.body).toEqual({ hidden: [] })
    expect(toastMock.success).toHaveBeenCalledWith('店铺展示已保存', expect.anything())
    expect(await screen.findByRole('switch', { name: '在小镇展示 xAI' })).toBeChecked()
  })

  it('数据源：已保存的密码不回显；必填项校验；测试连接显示结果；保存时不传密码表示保留', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    window.location.hash = '#source'
    render(<AdminApp />)
    const passwordField = await screen.findByLabelText('密码')
    expect(passwordField).toHaveValue('')
    expect(passwordField).toHaveAttribute('placeholder', '已保存，留空则不修改')

    const host = screen.getByLabelText('主机')
    await user.clear(host)
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByText('请填写数据库主机')).toBeInTheDocument()
    expect(host).toHaveAttribute('aria-invalid', 'true')
    expect(calls.some((call) => call.key === 'POST /api/admin/source/test')).toBe(false)

    await user.type(host, 'db.internal')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    const result = await screen.findByRole('status')
    expect(result).toHaveTextContent('连接成功，用时 42 毫秒')
    expect(within(result).getAllByRole('listitem')).toHaveLength(2)
    expect(calls.find((call) => call.key === 'POST /api/admin/source/test')?.body).toEqual({ sub2api: { ...SUB2API, host: 'db.internal' } })

    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = calls.find((call) => call.key === 'PUT /api/admin/source')?.body
    expect(saved).toEqual({ active: 'sub2api', sub2api: { ...SUB2API, host: 'db.internal' } })
    expect(toastMock.success).toHaveBeenCalledWith('数据源已保存', expect.anything())
  })

  it('数据源：可以清除已保存的密码；测试失败在表单里显示原因', async () => {
    const user = userEvent.setup()
    const calls = mockServer({
      'POST /api/admin/source/test': () => ({ body: { ok: false, error: { code: 'auth_failed', message: '数据库用户名或密码不对' } } }),
    })
    window.location.hash = '#source'
    render(<AdminApp />)
    await user.click(await screen.findByRole('button', { name: '清除已保存的密码' }))
    expect(screen.getByText('保存后会清除已保存的密码')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('数据库用户名或密码不对')).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/admin/source/test')?.body).toMatchObject({ password: '' })
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(calls.find((call) => call.key === 'PUT /api/admin/source')?.body).toMatchObject({ password: '' })
  })

  it('切到上传文件：上传后提示行数，按钮提示保存后切换', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    window.location.hash = '#source'
    render(<AdminApp />)
    await user.click(await screen.findByRole('radio', { name: /上传文件/ }))
    expect(screen.getByRole('button', { name: '保存并切换到上传文件' })).toBeInTheDocument()
    const file = new File(['model,week,tokens\na,2026-09-21,1'], 'usage.csv', { type: 'text/csv' })
    await user.upload(screen.getByTestId('upload-file-input'), file)
    expect(toastMock.success).toHaveBeenCalledWith('已上传 3 行用量数据', { description: '点“保存并切换”后生效。' })
    expect(calls.find((call) => call.key === 'POST /api/admin/source/file')?.body).toEqual({
      fileName: 'usage.csv',
      text: 'model,week,tokens\na,2026-09-21,1',
      activate: false,
    })
  })
})

import { act, cleanup as cleanupApp, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createSampleDataset } from '@/lib/sample-data'
import { buildSnapshot } from '@/lib/town-data'

const sceneMock = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'error', message: '', resetView: vi.fn() }))

// jsdom 没有 WebGL：用一个只汇报状态的替身代替三维场景
vi.mock('@/components/TownCanvas', () => ({
  TownCanvas: forwardRef<
    { resetView(): void },
    { focusId: string | null; label: string; doorSpeed: number; onStatus: (status: 'ready' | 'error', message?: string) => void }
  >(function TownCanvasStub({ focusId, label, doorSpeed, onStatus }, ref) {
    useImperativeHandle(ref, () => ({ resetView: sceneMock.resetView }))
    useEffect(() => {
      onStatus(sceneMock.status, sceneMock.message || undefined)
      // 只在挂载时汇报一次，与真实场景一致
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div role="img" aria-label={label} data-testid="town-canvas" data-focus={focusId ?? ''} data-door-speed={doorSpeed} />
  }),
}))

const sampleShops = buildSnapshot(createSampleDataset()).shops

function currentShop() {
  return screen.getByRole('heading', { level: 2 }).textContent
}

/** 小镇服务 /api/town/dataset 的响应。 */
function apiPayload(overrides: Record<string, unknown> = {}) {
  const dataset = createSampleDataset()
  return { source: 'sample', label: dataset.label, updatedAt: null, stale: false, pollSeconds: 30, rows: dataset.rows, models: dataset.models, ...overrides }
}

function mockApi(...responses: (Record<string, unknown> | Error)[]) {
  const queue = [...responses]
  const fetchMock = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0] ?? apiPayload()
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next), { status: 200, headers: { ETag: '"v1"', 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 渲染并等数据到达（首屏要先读接口）。 */
async function renderApp() {
  const view = render(<App />)
  await screen.findByRole('heading', { level: 2 })
  return view
}

beforeEach(() => {
  mockApi(apiPayload())
  window.localStorage.clear()
  document.documentElement.classList.add('dark')
  sceneMock.status = 'ready'
  sceneMock.message = ''
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('开箱从小镇服务读取数据并停在第一家门口', async () => {
    await renderApp()
    expect(sampleShops.length).toBeGreaterThan(3)
    expect(screen.getByRole('heading', { level: 1, name: 'Token 商店小镇' })).toBeInTheDocument()
    expect(currentShop()).toBe(sampleShops[0].name)
    expect(screen.getByText('示例数据 · 虚构')).toBeInTheDocument()
    expect(screen.getByTestId('town-canvas')).toHaveAttribute('data-focus', sampleShops[0].id)
  })

  it('方向键和 Home / End 切换店铺，并循环', async () => {
    const user = userEvent.setup()
    await renderApp()
    const last = sampleShops[sampleShops.length - 1]

    await user.keyboard('{ArrowRight}')
    expect(currentShop()).toBe(sampleShops[1].name)
    expect(screen.getByTestId('town-canvas')).toHaveAttribute('data-focus', sampleShops[1].id)

    await user.keyboard('{Home}{ArrowLeft}')
    expect(currentShop()).toBe(last.name)

    await user.keyboard('{ArrowRight}')
    expect(currentShop()).toBe(sampleShops[0].name)

    await user.keyboard('{End}')
    expect(currentShop()).toBe(last.name)
  })

  it('上一家 / 下一家按钮与计数同步', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: '下一家' }))
    expect(currentShop()).toBe(sampleShops[1].name)
    expect(screen.getByText(`第 2 家，共 ${sampleShops.length} 家`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '上一家' }))
    expect(currentShop()).toBe(sampleShops[0].name)
  })

  it('弹窗打开或带修饰键时，方向键不切换店铺', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}')
    expect(currentShop()).toBe(sampleShops[0].name)

    await user.click(screen.getByRole('button', { name: '关于小镇' }))
    expect(await screen.findByRole('dialog', { name: '关于 Token 商店小镇' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(currentShop()).toBe(sampleShops[0].name)
  })

  it('关闭弹窗后焦点回到打开它的按钮', async () => {
    const user = userEvent.setup()
    await renderApp()
    const trigger = screen.getByRole('button', { name: '关于小镇' })
    act(() => trigger.focus())
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: '关于 Token 商店小镇' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('数据表中点“查看”会走到对应店铺并关闭抽屉', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: '本周数据' }))
    const sheet = await screen.findByRole('dialog', { name: '本周数据' })
    expect(within(sheet).queryByRole('columnheader', { name: /排名/ })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: `在小镇中查看 ${sampleShops[2].name}` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(currentShop()).toBe(sampleShops[2].name)
  })

  it('在数据卡上指定主推模型：卡片和数据表跟着变，刷新后仍记得，可改回默认', async () => {
    const user = userEvent.setup()
    const first = sampleShops[0]
    const [top, other] = first.models
    expect(other).toBeDefined()
    const { unmount } = await renderApp()
    const card = screen.getByRole('region', { name: first.name })
    await user.click(within(card).getByRole('combobox', { name: `主推模型：${top.model}，本周用量最高` }))
    await user.click(await screen.findByRole('option', { name: new RegExp(`^${other.model}`) }))
    expect(within(card).getByRole('combobox', { name: `主推模型：${other.model}，本机指定` })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '本周数据' }))
    const sheet = await screen.findByRole('dialog', { name: '本周数据' })
    expect(within(sheet).getByText(other.model)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    unmount()

    await renderApp()
    const restored = screen.getByRole('region', { name: first.name })
    await user.click(within(restored).getByRole('combobox', { name: `主推模型：${other.model}，本机指定` }))
    await user.click(await screen.findByRole('option', { name: /^默认/ }))
    expect(within(restored).getByRole('combobox', { name: `主推模型：${top.model}，本周用量最高` })).toBeInTheDocument()
    expect(window.localStorage.getItem('token-town:pref:featured')).toBe('{}')
  })

  it('小镇时间默认跟随系统时区的当前时间', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 9, 5))
    try {
      await renderApp()
      expect(screen.getByRole('button', { name: /^小镇时间 09:05，上午，跟随实时/ })).toBeInTheDocument()
      expect(document.documentElement).not.toHaveClass('dark')
      expect(screen.getByTestId('town-canvas')).toHaveAttribute('aria-label', expect.stringContaining('小镇时间 09:05（上午）'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('手动调节时间：预设切换天色与界面主题，并记住设置', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderApp()
    await user.click(screen.getByRole('button', { name: /^小镇时间/ }))
    const panel = await screen.findByRole('dialog')
    await user.click(within(panel).getByRole('radio', { name: '手动调节' }))
    expect(within(panel).getByRole('slider', { name: '小镇时间' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: '正午' }))
    expect(within(panel).getByRole('slider', { name: '小镇时间' })).toHaveAttribute('aria-valuetext', '12:00，正午')
    expect(document.documentElement).not.toHaveClass('dark')

    await user.click(within(panel).getByRole('button', { name: '深夜' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByRole('button', { name: /^小镇时间 22:30，深夜，手动调节/ })).toBeInTheDocument()
    unmount()

    await renderApp()
    expect(screen.getByRole('button', { name: /^小镇时间 22:30，深夜，手动调节/ })).toBeInTheDocument()
  })

  it('时间面板里的方向键调节滑块，不切换店铺', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: /^小镇时间/ }))
    const panel = await screen.findByRole('dialog')
    await user.click(within(panel).getByRole('radio', { name: '手动调节' }))
    await user.click(within(panel).getByRole('button', { name: '正午' }))
    act(() => within(panel).getByRole('slider', { name: '小镇时间' }).focus())
    await user.keyboard('{ArrowRight}')
    expect(within(panel).getByRole('slider', { name: '小镇时间' })).toHaveAttribute('aria-valuetext', '12:15，正午')
    expect(currentShop()).toBe(sampleShops[0].name)
  })

  it('进出速度默认 3 倍，可以调整并记住；面板里的方向键不切换店铺', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderApp()
    const canvas = screen.getByTestId('town-canvas')
    expect(canvas).toHaveAttribute('data-door-speed', '3')

    await user.click(screen.getByRole('button', { name: '进出速度 3 倍' }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('radio', { name: '3 倍' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(panel).getByRole('radio', { name: '1 倍（原速）' }))
    expect(canvas).toHaveAttribute('data-door-speed', '1')
    expect(screen.getByRole('button', { name: '进出速度 1 倍' })).toBeInTheDocument()

    // 再点已选中的一项不会清空选择
    await user.click(within(panel).getByRole('radio', { name: '1 倍（原速）' }))
    expect(canvas).toHaveAttribute('data-door-speed', '1')

    act(() => within(panel).getByRole('radio', { name: '1 倍（原速）' }).focus())
    await user.keyboard('{ArrowRight}')
    expect(within(panel).getByRole('radio', { name: '2 倍' })).toHaveFocus()
    expect(currentShop()).toBe(sampleShops[0].name)
    await user.keyboard('{Enter}')
    expect(canvas).toHaveAttribute('data-door-speed', '2')
    unmount()

    await renderApp()
    expect(screen.getByTestId('town-canvas')).toHaveAttribute('data-door-speed', '2')
    expect(screen.getByRole('button', { name: '进出速度 2 倍' })).toBeInTheDocument()
  })

  it('重置视角调用场景', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: '重置视角' }))
    expect(sceneMock.resetView).toHaveBeenCalledTimes(1)
  })

  it('WebGL 不可用时给出回退说明，数据仍可通过数据表阅读', async () => {
    sceneMock.status = 'error'
    sceneMock.message = '当前浏览器无法启用 WebGL，3D 小镇暂时无法显示。'
    const user = userEvent.setup()
    await renderApp()

    expect(await screen.findByText('3D 小镇暂时无法显示')).toBeInTheDocument()
    expect(screen.getByText(sceneMock.message)).toBeInTheDocument()
    expect(screen.queryByTestId('town-canvas')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置视角' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '景深' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^进出速度/ })).toBeDisabled()
    // 场景不可用时依然可以切店
    await act(async () => {
      await user.keyboard('{ArrowRight}')
    })
    expect(currentShop()).toBe(sampleShops[1].name)

    await user.click(screen.getByRole('button', { name: '查看本周数据' }))
    expect(await screen.findByRole('dialog', { name: '本周数据' })).toBeInTheDocument()
  })

  it('访客页面没有导入入口；旧版本存在浏览器里的导入数据会被清掉', async () => {
    window.localStorage.setItem('token-town:dataset:v1', '{"version":1}')
    await renderApp()
    expect(screen.queryByRole('button', { name: '导入数据' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('token-town:dataset:v1')).toBeNull()
  })

  it('展示 Sub2API 实时数据；服务端读取失败时标记数据可能过期', async () => {
    const fetchMock = mockApi(apiPayload({ source: 'sub2api', label: 'Sub2API · 实时', updatedAt: '2026-09-30T06:00:00Z' }))
    await renderApp()
    expect(fetchMock).toHaveBeenCalledWith('/api/town/dataset', expect.objectContaining({ cache: 'no-store' }))
    expect(screen.getByLabelText('Sub2API · 实时')).toBeInTheDocument()
    cleanupApp()

    mockApi(apiPayload({ source: 'sub2api', label: 'Sub2API · 实时', updatedAt: '2026-09-30T06:00:00Z', stale: true }))
    await renderApp()
    expect(screen.getByLabelText('Sub2API · 实时，数据可能已过期')).toBeInTheDocument()
  })

  it('连不上小镇服务时回退到示例数据', async () => {
    mockApi(new TypeError('Failed to fetch'))
    await renderApp()
    expect(currentShop()).toBe(sampleShops[0].name)
    expect(screen.getByLabelText('示例数据 · 虚构')).toBeInTheDocument()
  })

  it('隐藏店铺后服务端不再返回它，小镇里就没有这家店', async () => {
    const dataset = createSampleDataset()
    const rows = dataset.rows.filter((row) => !/^gpt/i.test(row.model))
    mockApi(apiPayload({ rows }))
    await renderApp()
    expect(screen.queryByRole('radio', { name: 'OpenAI' })).not.toBeInTheDocument()
    expect(currentShop()).toBe('Anthropic')
  })
})

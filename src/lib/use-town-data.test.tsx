import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTownData } from '@/lib/use-town-data'

type Reply = { status: 200; body: Record<string, unknown> } | { status: 304 } | Error

function payload(tokens: number, extra: Record<string, unknown> = {}) {
  return {
    source: 'sub2api',
    label: 'Sub2API · 实时',
    updatedAt: '2026-09-30T06:00:00Z',
    stale: false,
    pollSeconds: 30,
    rows: [{ model: 'claude-x', week: '2026-09-28', tokens }],
    models: [],
    ...extra,
  }
}

function server(replies: Reply[]) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    void init
    const reply = replies.shift() ?? { status: 304 }
    if (reply instanceof Error) throw reply
    if (reply.status === 304) return new Response(null, { status: 304, headers: { ETag: '"same"' } })
    return new Response(JSON.stringify(reply.body), { status: 200, headers: { ETag: `"${String(reply.body.rows)}"` } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** 假定时器下不能用 waitFor（它自己也靠 setTimeout），手动把请求链跑完。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await tick(0)
}

describe('useTownData', () => {
  it('按服务端给的间隔轮询，带 If-None-Match；304 时数据对象不变，新数据到达时替换', async () => {
    const fetchMock = server([{ status: 200, body: payload(10) }, { status: 304 }, { status: 200, body: payload(25) }])
    const { result } = renderHook(() => useTownData())
    await settle()
    expect(result.current.dataset).not.toBeNull()
    const first = result.current.dataset
    expect(result.current.info).toEqual({ kind: 'sub2api', label: 'Sub2API · 实时', updatedAt: '2026-09-30T06:00:00Z', stale: false })

    await tick(30_000)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-None-Match')).toBeTruthy()
    expect(result.current.dataset).toBe(first)

    await tick(30_000)
    await settle()
    expect(result.current.dataset?.rows[0].tokens).toBe(25)
  })

  it('之前成功过、后来断线时保留数据并标记过期，恢复后还原', async () => {
    server([{ status: 200, body: payload(10) }, new TypeError('Failed to fetch'), { status: 304 }])
    const { result } = renderHook(() => useTownData())
    await settle()
    expect(result.current.dataset).not.toBeNull()
    await tick(30_000)
    await settle()
    expect(result.current.info.stale).toBe(true)
    expect(result.current.dataset?.rows[0].tokens).toBe(10)
    await tick(30_000)
    await settle()
    expect(result.current.info.stale).toBe(false)
  })

  it('第一次就连不上时回退示例数据，之后服务恢复会换成真实数据', async () => {
    server([new TypeError('Failed to fetch'), { status: 200, body: payload(10) }])
    const { result } = renderHook(() => useTownData())
    await settle()
    expect(result.current.info.kind).toBe('fallback')
    expect(result.current.dataset?.rows.length).toBeGreaterThan(10)
    await tick(30_000)
    await settle()
    expect(result.current.info.kind).toBe('sub2api')
  })

  it('页面在后台时暂停轮询，回到前台立即刷新一次', async () => {
    const fetchMock = server([{ status: 200, body: payload(10) }])
    const { result } = renderHook(() => useTownData())
    await settle()
    expect(result.current.dataset).not.toBeNull()
    visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await tick(120_000)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

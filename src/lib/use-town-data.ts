import { useEffect, useRef, useState } from 'react'
import { createSampleDataset } from '@/lib/sample-data'
import type { ModelInfo, TownDataset, UsageRow } from '@/lib/town-data'

/** 数据从哪里来：服务端的三种数据源，或连不上服务时回退的示例数据。 */
export type DataSourceKind = 'sample' | 'file' | 'sub2api' | 'fallback'

export interface DataSourceInfo {
  kind: DataSourceKind
  label: string
  /** 数据最近一次成功读取的时间（ISO）；示例数据为 null。 */
  updatedAt: string | null
  /** 服务端最近一次读取失败，或浏览器暂时连不上服务，正在展示旧数据。 */
  stale: boolean
}

export interface TownData {
  /** 首次加载完成前为 null。 */
  dataset: TownDataset | null
  info: DataSourceInfo
}

interface DatasetResponse {
  source: 'sample' | 'file' | 'sub2api'
  label: string
  updatedAt: string | null
  stale: boolean
  pollSeconds: number
  rows: UsageRow[]
  models: ModelInfo[]
}

const DEFAULT_POLL_SECONDS = 30
/** 旧版本把访客导入的数据存在浏览器里；导入改到后台后清掉它。 */
const LEGACY_STORAGE_KEY = 'token-town:dataset:v1'

export function datasetUrl(): string {
  return `${import.meta.env.BASE_URL}api/town/dataset`
}

function isResponse(value: unknown): value is DatasetResponse {
  const data = value as Partial<DatasetResponse> | null
  return Boolean(data && typeof data.label === 'string' && Array.isArray(data.rows) && Array.isArray(data.models))
}

function fallback(): TownData {
  const dataset = createSampleDataset()
  return { dataset, info: { kind: 'fallback', label: dataset.label, updatedAt: null, stale: false } }
}

/**
 * 从小镇服务读取数据并定时轮询：带 If-None-Match，数据没变时服务端只回 304。
 * 第一次就连不上（例如纯静态部署）时回退到示例数据；之后断线则保留当前数据并标记为过期。
 * 页面在后台时暂停轮询，回到前台立即刷新一次。
 */
export function useTownData(): TownData {
  const [data, setData] = useState<TownData>({ dataset: null, info: { kind: 'sample', label: '', updatedAt: null, stale: false } })
  const etag = useRef<string | null>(null)
  const loaded = useRef(false)
  /** 服务端最后一次告诉我们的过期状态；断线恢复后据此还原。 */
  const serverStale = useRef(false)

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // 存储不可用时无需处理
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let pollSeconds = DEFAULT_POLL_SECONDS
    let controller: AbortController | null = null

    const schedule = () => {
      clearTimeout(timer)
      if (!disposed && document.visibilityState !== 'hidden') timer = setTimeout(load, pollSeconds * 1000)
    }

    async function load() {
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch(datasetUrl(), {
          cache: 'no-store',
          headers: etag.current ? { 'If-None-Match': etag.current } : {},
          signal: controller.signal,
        })
        if (disposed) return
        if (response.status === 304) {
          // 数据没变；之前因为断线标了过期的话，恢复成服务端的状态
          setData((current) =>
            current.info.stale === serverStale.current ? current : { ...current, info: { ...current.info, stale: serverStale.current } },
          )
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body: unknown = await response.json()
          if (!isResponse(body)) throw new Error('数据格式不对')
          if (disposed) return
          etag.current = response.headers.get('ETag')
          serverStale.current = body.stale
          pollSeconds = Math.max(10, body.pollSeconds || DEFAULT_POLL_SECONDS)
          loaded.current = true
          setData({
            dataset: { source: body.source === 'sample' ? 'sample' : 'import', label: body.label, rows: body.rows, models: body.models },
            info: { kind: body.source, label: body.label, updatedAt: body.updatedAt, stale: body.stale },
          })
        }
      } catch (error) {
        if (disposed || (error as Error).name === 'AbortError') return
        if (!loaded.current) {
          loaded.current = true
          setData(fallback())
        } else {
          setData((current) => (current.info.kind === 'fallback' ? current : { ...current, info: { ...current.info, stale: true } }))
        }
      }
      schedule()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer)
      else void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void load()
    return () => {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return data
}

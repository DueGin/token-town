import { createHash } from 'node:crypto'
import { normalizeRecords } from '@/lib/import-data'
import { resolveLab } from '@/lib/labs'
import { createSampleDataset } from '@/lib/sample-data'
import type { ModelInfo, TownDataset, UsageRow } from '@/lib/town-data'
import { weekStartOf } from '@/lib/week'
import type { ConfigStore, SourceKind, Sub2apiSettings, TownConfig } from './config-store'
import { decryptText, type Secrets } from './secrets'
import { classifyError, createPgPool, SourceError, Sub2apiSource, type PoolFactory, type Sub2apiConnection } from './sources/sub2api'

/** 访客页轮询间隔（秒）：配合 ETag，没变化时只回 304。 */
export const POLL_SECONDS = 30
/** Sub2API 数据源每隔这么久重查一次完整窗口，其余时间只查本周。 */
export const FULL_REFRESH_MS = 60 * 60 * 1000

export const SUB2API_LABEL = 'Sub2API · 实时'

export interface PublicDataset {
  source: SourceKind
  label: string
  /** 数据最近一次成功读取的时间；示例数据为 null。 */
  updatedAt: string | null
  /** 最近一次刷新失败、正在展示上一次的数据。 */
  stale: boolean
  pollSeconds: number
  rows: UsageRow[]
  models: ModelInfo[]
}

export interface SourceStatus {
  active: SourceKind
  label: string
  updatedAt: string | null
  lastAttemptAt: string | null
  error: { code: string; message: string } | null
  stale: boolean
  rows: number
  latestWeek: string | null
  refreshing: boolean
}

interface Snapshot {
  dataset: TownDataset
  updatedAt: string | null
}

/** 某个时区“现在”所在周的周一。 */
export function currentWeekIn(timeZone: string, now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return weekStartOf(day) ?? day
}

function emptyDataset(source: TownDataset['source'], label: string): TownDataset {
  return { source, label, rows: [], models: [] }
}

/** 连接参数（含密码）是否变了：变了就要换一个连接池。 */
function connectionKey(connection: Sub2apiConnection): string {
  const { refreshSeconds: _refresh, ...rest } = connection
  return JSON.stringify(rest)
}

export interface DatasetServiceOptions {
  now?: () => Date
  createPool?: PoolFactory
}

/**
 * 当前生效的数据集：示例、上传文件或 Sub2API。
 * Sub2API 已经过去的整周缓存起来，定时只重查本周；跨周、每小时或配置变化时重查完整窗口。
 * 刷新失败时继续提供上一次成功的数据，并标记 stale。
 */
export class DatasetService {
  private config: TownConfig
  private snapshot: Snapshot
  private source: Sub2apiSource | null = null
  private sourceKey = ''
  private pastRows: UsageRow[] = []
  private currentRows: UsageRow[] = []
  private cachedWeek = ''
  private lastFull = 0
  private lastAttemptAt: string | null = null
  private error: SourceError | null = null
  private refreshing: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private published: { body: string; etag: string } | null = null
  private readonly now: () => Date
  private readonly createPool: PoolFactory

  constructor(
    private readonly store: ConfigStore,
    private readonly secrets: Secrets,
    config: TownConfig,
    options: DatasetServiceOptions = {},
  ) {
    this.config = config
    this.now = options.now ?? (() => new Date())
    this.createPool = options.createPool ?? createPgPool
    this.snapshot = this.staticSnapshot()
  }

  get currentConfig(): TownConfig {
    return this.config
  }

  /** 首次刷新并开始定时；Sub2API 以外的数据源不需要定时。 */
  async start(): Promise<void> {
    await this.refresh()
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.refreshing?.catch(() => undefined)
    await this.closeSource()
  }

  /** 保存新配置；数据源设置变化时清掉缓存并立即刷新，只改隐藏名单时只重新生成公开数据。 */
  async applyConfig(next: TownConfig): Promise<void> {
    const sourceChanged = JSON.stringify(next.source) !== JSON.stringify(this.config.source)
    this.store.save(next)
    this.config = next
    this.published = null
    if (!sourceChanged) return
    this.resetCache()
    this.error = null
    this.snapshot = this.staticSnapshot()
    await this.refresh({ full: true })
  }

  /** 解密已保存的数据库密码；密钥更换或密文损坏时视为没有密码。 */
  savedPassword(): string {
    const encrypted = this.config.source.sub2api.passwordEnc
    if (!encrypted) return ''
    try {
      return decryptText(this.secrets.configKey, encrypted)
    } catch {
      return ''
    }
  }

  /** 保存后台上传的数据；启用与否由配置决定。 */
  saveUploadedDataset(dataset: TownDataset): void {
    this.store.saveDataset({ rows: dataset.rows, models: dataset.models })
  }

  connectionFrom(settings: Sub2apiSettings, password: string): Sub2apiConnection {
    return { ...settings, password }
  }

  /** 用尚未保存的参数测试连接。 */
  async test(connection: Sub2apiConnection) {
    const source = new Sub2apiSource(connection, this.createPool)
    try {
      return await source.test()
    } finally {
      await source.close()
    }
  }

  refresh(options: { full?: boolean } = {}): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.doRefresh(options.full ?? false).finally(() => {
      this.refreshing = null
      this.schedule()
    })
    return this.refreshing
  }

  status(): SourceStatus {
    const { dataset, updatedAt } = this.snapshot
    const weeks = dataset.rows.map((row) => row.week).sort()
    return {
      active: this.config.source.active,
      label: dataset.label,
      updatedAt,
      lastAttemptAt: this.lastAttemptAt,
      error: this.error ? { code: this.error.code, message: this.error.message } : null,
      stale: this.error !== null && updatedAt !== null,
      rows: dataset.rows.length,
      latestWeek: weeks.at(-1) ?? null,
      refreshing: this.refreshing !== null,
    }
  }

  /** 未过滤的数据集，供后台统计各厂商用量。 */
  rawDataset(): TownDataset {
    return this.snapshot.dataset
  }

  /** 访客看到的数据：隐藏的厂商在这里剔除，不会出现在公开接口里。 */
  publicDataset(): { body: string; etag: string } {
    if (this.published) return this.published
    const hidden = new Set(this.config.shops.hidden)
    const { dataset, updatedAt } = this.snapshot
    const infoLab = new Map(dataset.models.map((info) => [info.model.trim().toLowerCase(), info.lab]))
    const visible = (lab: string | undefined, model: string) => !hidden.has(resolveLab(lab ?? infoLab.get(model.trim().toLowerCase()), model).id)
    const payload: PublicDataset = {
      source: this.config.source.active,
      label: dataset.label,
      updatedAt,
      stale: this.error !== null && updatedAt !== null,
      pollSeconds: POLL_SECONDS,
      rows: dataset.rows.filter((row) => visible(row.lab, row.model)),
      models: dataset.models.filter((info) => visible(info.lab, info.model)),
    }
    const body = JSON.stringify(payload)
    this.published = { body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` }
    return this.published
  }

  private async doRefresh(forceFull: boolean): Promise<void> {
    const { active } = this.config.source
    if (active !== 'sub2api') {
      await this.closeSource()
      this.resetCache()
      this.error = null
      this.snapshot = this.staticSnapshot()
      this.published = null
      return
    }
    const now = this.now()
    this.lastAttemptAt = now.toISOString()
    try {
      const source = this.ensureSource()
      const week = currentWeekIn(source.connection.timezone, now)
      const full = forceFull || week !== this.cachedWeek || now.getTime() - this.lastFull >= FULL_REFRESH_MS
      if (full) {
        const rows = await source.fetch(source.connection.weeks - 1)
        this.pastRows = rows.filter((row) => row.week < week)
        this.currentRows = rows.filter((row) => row.week >= week)
        this.cachedWeek = week
        this.lastFull = now.getTime()
      } else {
        this.currentRows = await source.fetch(0)
      }
      this.error = null
      this.snapshot = {
        dataset: { source: 'import', label: SUB2API_LABEL, rows: [...this.pastRows, ...this.currentRows], models: [] },
        updatedAt: now.toISOString(),
      }
    } catch (error) {
      this.error = classifyError(error)
      if (this.snapshot.dataset.source !== 'import' || this.snapshot.updatedAt === null) {
        this.snapshot = { dataset: emptyDataset('import', SUB2API_LABEL), updatedAt: null }
      }
    }
    this.published = null
  }

  private ensureSource(): Sub2apiSource {
    const connection = this.connectionFrom(this.config.source.sub2api, this.savedPassword())
    const key = connectionKey(connection)
    if (this.source && key === this.sourceKey) return this.source
    void this.source?.close()
    this.source = new Sub2apiSource(connection, this.createPool)
    this.sourceKey = key
    this.resetCache()
    return this.source
  }

  private async closeSource(): Promise<void> {
    const source = this.source
    this.source = null
    this.sourceKey = ''
    await source?.close()
  }

  private resetCache(): void {
    this.pastRows = []
    this.currentRows = []
    this.cachedWeek = ''
    this.lastFull = 0
  }

  /** 示例或上传文件的数据集；上传文件读回时重新走一遍导入校验。 */
  private staticSnapshot(): Snapshot {
    const { active, file } = this.config.source
    if (active === 'file') {
      const stored = this.store.loadDataset() as { rows?: unknown[]; models?: unknown[] } | null
      if (stored && Array.isArray(stored.rows) && Array.isArray(stored.models) && file) {
        const { dataset, accepted } = normalizeRecords([...stored.rows, ...stored.models], file.label)
        if (accepted > 0) return { dataset, updatedAt: file.uploadedAt }
      }
      return { dataset: emptyDataset('import', file?.label ?? '上传的数据'), updatedAt: null }
    }
    if (active === 'sub2api') return { dataset: emptyDataset('import', SUB2API_LABEL), updatedAt: null }
    return { dataset: createSampleDataset(), updatedAt: null }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.config.source.active !== 'sub2api') return
    this.timer = setTimeout(() => void this.refresh(), this.config.source.sub2api.refreshSeconds * 1000)
    this.timer.unref?.()
  }
}

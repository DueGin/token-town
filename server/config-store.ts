import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const SOURCE_KINDS = ['sample', 'file', 'sub2api'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const SSL_MODES = ['disable', 'require', 'verify-full'] as const
export const MODEL_FIELDS = ['requested', 'upstream'] as const

/** Sub2API 数据源的可调参数（不含密码）；后台表单和接口共用这份校验。 */
export const sub2apiSettingsSchema = z.object({
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(128),
  user: z.string().trim().max(128),
  sslmode: z.enum(SSL_MODES),
  timezone: z.string().trim().refine(isTimeZone, '时区无效'),
  weeks: z.number().int().min(2).max(26),
  refreshSeconds: z.number().int().min(30).max(3600),
  modelField: z.enum(MODEL_FIELDS),
  successOnly: z.boolean(),
  platformAssist: z.boolean(),
})
export type Sub2apiSettings = z.infer<typeof sub2apiSettingsSchema>

export const DEFAULT_SUB2API: Sub2apiSettings = {
  host: '',
  port: 5432,
  database: 'sub2api',
  user: '',
  sslmode: 'disable',
  timezone: 'Asia/Shanghai',
  weeks: 8,
  refreshSeconds: 60,
  modelField: 'requested',
  successOnly: true,
  platformAssist: true,
}

const uploadedFileSchema = z.object({
  label: z.string().max(120),
  fileName: z.string().max(200),
  uploadedAt: z.string(),
  rows: z.number().int().min(0),
})
export type UploadedFile = z.infer<typeof uploadedFileSchema>

const configSchema = z.object({
  version: z.literal(1),
  shops: z.object({ hidden: z.array(z.string().max(80)).max(200) }),
  source: z.object({
    active: z.enum(SOURCE_KINDS),
    sub2api: sub2apiSettingsSchema.extend({ passwordEnc: z.string().max(4096).optional() }),
    file: uploadedFileSchema.optional(),
  }),
  updatedAt: z.string(),
})
export type TownConfig = z.infer<typeof configSchema>

export function defaultConfig(now = new Date()): TownConfig {
  return {
    version: 1,
    shops: { hidden: [] },
    source: { active: 'sample', sub2api: { ...DEFAULT_SUB2API } },
    updatedAt: now.toISOString(),
  }
}

const CONFIG_FILE = 'config.json'
const DATASET_FILE = 'dataset.json'

/**
 * 配置与上传数据都存在 DATA_DIR 里：写入先落到临时文件再改名，进程中途退出也不会留下半个文件；
 * 文件权限 600，配置里的数据库密码另外加密。
 */
export class ConfigStore {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  /** 读取配置；文件不存在时返回 null，内容损坏时抛错（不悄悄覆盖管理员的设置）。 */
  load(): TownConfig | null {
    const raw = this.read(CONFIG_FILE)
    if (raw === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`${path.join(this.dir, CONFIG_FILE)} 不是有效的 JSON，请修复或删除后重启`)
    }
    const result = configSchema.safeParse(parsed)
    if (!result.success) throw new Error(`${path.join(this.dir, CONFIG_FILE)} 内容无效：${result.error.issues[0]?.message ?? '未知错误'}`)
    return result.data
  }

  save(config: TownConfig): void {
    this.write(CONFIG_FILE, JSON.stringify(configSchema.parse(config), null, 2))
  }

  loadDataset(): unknown | null {
    const raw = this.read(DATASET_FILE)
    if (raw === null) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  saveDataset(payload: unknown): void {
    this.write(DATASET_FILE, JSON.stringify(payload))
  }

  private read(name: string): string | null {
    try {
      return readFileSync(path.join(this.dir, name), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private write(name: string, content: string): void {
    const target = path.join(this.dir, name)
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, content, { mode: 0o600 })
    renameSync(temp, target)
  }
}

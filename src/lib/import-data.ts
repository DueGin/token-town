import { MODALITIES, type ModelInfo, type Modality, type TownDataset, type UsageRow } from '@/lib/town-data'
import { parseDay, toDayString, weekStartOf } from '@/lib/week'

/**
 * 用量数据导入：支持 JSON（数组或 { rows, models }）与 CSV（首行为表头）。
 * 解析完全在浏览器本地进行，文件不会上传到任何服务器。
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000
const MAX_LAB_LENGTH = 40
const MAX_MODEL_LENGTH = 120
const MAX_TOKENS = 1e16

export class ImportError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

export interface ImportResult {
  dataset: TownDataset
  accepted: number
  skipped: number
  /** 第一条被跳过的原因，用于提示用户检查数据。 */
  firstIssue?: string
}

type Field =
  | 'lab'
  | 'model'
  | 'week'
  | 'date'
  | 'tokens'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheCreationTokens'
  | 'cacheReadTokens'
  | 'visitors'
  | 'priceIn'
  | 'priceOut'
  | 'context'
  | 'modalities'
  | 'released'
  | 'featured'

const FIELD_ALIASES: Record<Field, string[]> = {
  lab: ['lab', 'provider', 'vendor', 'company', 'labname', '厂商', '供应商', '公司'],
  model: ['model', 'modelname', 'modelid', '模型', '模型名'],
  week: ['week', 'weekstart', 'weekof', '周', '周一'],
  date: ['date', 'day', 'createdat', 'usagedate', '日期'],
  tokens: ['tokens', 'totaltokens', 'token', 'tokencount', '用量', 'token用量', '总token'],
  inputTokens: ['inputtokens', 'prompttokens', '输入token'],
  outputTokens: ['outputtokens', 'completiontokens', '输出token'],
  cacheCreationTokens: ['cachecreationtokens', 'cachewritetokens'],
  cacheReadTokens: ['cachereadtokens', 'cachedtokens'],
  visitors: ['visitors', 'users', 'uniqueusers', 'uniquevisitors', '访客', '用户数', '访客数'],
  priceIn: ['pricein', 'inputprice', 'promptprice', '输入价格'],
  priceOut: ['priceout', 'outputprice', 'completionprice', '输出价格'],
  context: ['context', 'contextwindow', 'contextlength', '上下文', '上下文长度'],
  modalities: ['modalities', 'modality', 'capabilities', '模态', '能力'],
  released: ['released', 'releasedate', 'releasedat', 'launchdate', '发布日期', '上架日期'],
  featured: ['featured', 'isfeatured', 'primary', 'pinned', '主推', '主推模型'],
}

const KEY_TO_FIELD = new Map<string, Field>()
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
  for (const alias of aliases) KEY_TO_FIELD.set(alias, field)
}

const MODALITY_ALIASES: Record<string, Modality> = {
  text: 'text',
  文本: 'text',
  txt: 'text',
  image: 'image',
  images: 'image',
  vision: 'image',
  img: 'image',
  图像: 'image',
  图片: 'image',
  视觉: 'image',
  audio: 'audio',
  voice: 'audio',
  speech: 'audio',
  音频: 'audio',
  语音: 'audio',
  video: 'video',
  视频: 'video',
  file: 'file',
  files: 'file',
  pdf: 'file',
  document: 'file',
  文件: 'file',
  文档: 'file',
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-.]/g, '')
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  // 去掉控制字符，避免奇怪的输入破坏画布文字或表格布局
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text ? text.slice(0, maxLength) : undefined
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[,\s$¥￥]/g, '')
  if (!text) return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function parseContext(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const match = /^\s*([\d.]+)\s*([kKmM])?\s*$/.exec(value.replace(/,/g, ''))
    if (!match) return undefined
    const base = Number(match[1])
    const unit = match[2]?.toLowerCase()
    const tokens = unit === 'm' ? base * 1_000_000 : unit === 'k' ? base * 1_000 : base
    return Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : undefined
  }
  const number = parseNumber(value)
  return number && number > 0 ? Math.round(number) : undefined
}

function parseModalities(value: unknown): Modality[] | undefined {
  const parts = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[|;,、，/\s]+/)
      : []
  const found = new Set<Modality>()
  for (const part of parts) {
    const modality = MODALITY_ALIASES[part.trim().toLowerCase()]
    if (modality) found.add(modality)
  }
  return found.size ? MODALITIES.filter((m) => found.has(m)) : undefined
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', '是', '主推'])

/** 只认明确的“是”；其余一律视为未指定，不会因为写了 false 反而被标成主推。 */
function parseFlag(value: unknown): true | undefined {
  if (value === true || value === 1) return true
  return typeof value === 'string' && TRUTHY.has(value.trim().toLowerCase()) ? true : undefined
}

function parseDate(value: unknown): string | undefined {
  const text = cleanText(value, 40)
  const date = text ? parseDay(text) : null
  return date ? toDayString(date) : undefined
}

function mapFields(record: Record<string, unknown>): Partial<Record<Field, unknown>> {
  const mapped: Partial<Record<Field, unknown>> = {}
  for (const [key, value] of Object.entries(record)) {
    const field = KEY_TO_FIELD.get(normalizeKey(key))
    if (field && mapped[field] === undefined && value !== '' && value !== null) mapped[field] = value
  }
  return mapped
}

function extractInfo(fields: Partial<Record<Field, unknown>>, lab: string | undefined, model: string): ModelInfo | null {
  const priceIn = parseNumber(fields.priceIn)
  const priceOut = parseNumber(fields.priceOut)
  const info: ModelInfo = {
    lab,
    model,
    released: parseDate(fields.released),
    context: parseContext(fields.context),
    modalities: parseModalities(fields.modalities),
    priceIn: priceIn !== undefined && priceIn >= 0 ? priceIn : undefined,
    priceOut: priceOut !== undefined && priceOut >= 0 ? priceOut : undefined,
    featured: parseFlag(fields.featured),
  }
  const hasDetail = [info.released, info.context, info.modalities, info.priceIn, info.priceOut, info.featured].some((v) => v !== undefined)
  return hasDetail ? info : null
}

function mergeInfo(target: Map<string, ModelInfo>, info: ModelInfo) {
  const key = info.model.toLowerCase()
  const existing = target.get(key)
  if (!existing) {
    target.set(key, info)
    return
  }
  // 同一模型多次出现时，先出现的非空字段优先，后续行只补空缺
  for (const field of ['lab', 'released', 'context', 'modalities', 'priceIn', 'priceOut', 'featured'] as const) {
    if (existing[field] === undefined && info[field] !== undefined) {
      Object.assign(existing, { [field]: info[field] })
    }
  }
}

function resolveTokens(fields: Partial<Record<Field, unknown>>): number | undefined {
  const total = parseNumber(fields.tokens)
  if (total !== undefined) return total
  const parts = [fields.inputTokens, fields.outputTokens, fields.cacheCreationTokens, fields.cacheReadTokens]
    .map(parseNumber)
    .filter((n): n is number => n !== undefined)
  return parts.length ? parts.reduce((sum, n) => sum + n, 0) : undefined
}

/** 把任意来源的记录对象归一成用量行和模型资料；无效行计入 skipped。 */
export function normalizeRecords(records: unknown[], label: string, rowOffset = 1): ImportResult {
  if (records.length > MAX_IMPORT_ROWS) {
    throw new ImportError(`数据超过 ${MAX_IMPORT_ROWS.toLocaleString('zh-CN')} 行`, '请先按周、按模型聚合后再导入。')
  }
  const rows: UsageRow[] = []
  const infos = new Map<string, ModelInfo>()
  let skipped = 0
  let firstIssue: string | undefined
  const skip = (index: number, reason: string) => {
    skipped += 1
    firstIssue ??= `第 ${index + rowOffset} 行：${reason}`
  }

  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      skip(index, '不是有效的对象')
      return
    }
    const fields = mapFields(record as Record<string, unknown>)
    const model = cleanText(fields.model, MAX_MODEL_LENGTH)
    if (!model) {
      skip(index, '缺少模型名（model）')
      return
    }
    const lab = cleanText(fields.lab, MAX_LAB_LENGTH)
    const info = extractInfo(fields, lab, model)
    if (info) mergeInfo(infos, info)

    const tokens = resolveTokens(fields)
    const dateText = cleanText(fields.week ?? fields.date, 40)
    if (tokens === undefined && dateText === undefined) {
      // 只有模型资料、没有用量的行（例如 JSON 的 models 列表）不算错误
      if (!info) skip(index, '缺少 token 数量')
      return
    }
    if (tokens === undefined || tokens < 0 || tokens > MAX_TOKENS) {
      skip(index, 'token 数量无效')
      return
    }
    const week = dateText ? weekStartOf(dateText) : null
    if (!week) {
      skip(index, '缺少有效的日期或周（YYYY-MM-DD）')
      return
    }
    const visitors = parseNumber(fields.visitors)
    rows.push({
      lab,
      model,
      week,
      tokens: Math.round(tokens),
      visitors: visitors !== undefined && visitors >= 0 ? Math.round(visitors) : undefined,
    })
  })

  return {
    dataset: { source: 'import', label, rows, models: Array.from(infos.values()) },
    accepted: rows.length,
    skipped,
    firstIssue,
  }
}

/** RFC 4180 风格的 CSV 解析：支持引号、转义引号和引号内换行。 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.slice(0, source.search(/\r?\n|$/))
  const delimiter = [',', '\t', ';'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function recordsFromCsv(text: string): unknown[] {
  const [header, ...body] = parseCsv(text)
  if (!header) throw new ImportError('CSV 文件是空的')
  const keys = header.map((key) => key.trim())
  if (!keys.some((key) => KEY_TO_FIELD.get(normalizeKey(key)) === 'model')) {
    throw new ImportError('CSV 表头缺少 model 列', '第一行需要是表头，至少包含 model、week（或 date）和 tokens。')
  }
  return body.map((cells) => Object.fromEntries(keys.map((key, i) => [key, cells[i] ?? ''])))
}

function recordsFromJson(text: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ImportError('JSON 格式不正确', '请检查括号、引号和逗号是否完整。')
  }
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const container = parsed as Record<string, unknown>
    const rows = container.rows ?? container.usage ?? container.data
    const models = Array.isArray(container.models) ? container.models : []
    if (Array.isArray(rows)) return [...rows, ...models]
  }
  throw new ImportError('JSON 结构无法识别', '顶层应是数组，或包含 rows 数组的对象。')
}

export function parseUsageText(text: string, fileName: string): ImportResult {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart()
  const isJson = /\.json$/i.test(fileName) || trimmed.startsWith('[') || trimmed.startsWith('{')
  const records = isJson ? recordsFromJson(trimmed) : recordsFromCsv(text)
  // CSV 第 1 行是表头，所以数据行从第 2 行算起
  const result = normalizeRecords(records, `导入 · ${fileName.slice(0, 60)}`, isJson ? 1 : 2)
  if (result.accepted === 0) {
    throw new ImportError('没有找到可用的用量数据', result.firstIssue)
  }
  return result
}

export async function importUsageFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError('文件超过 5 MB', '请先按周、按模型聚合后再导入。')
  }
  if (!/\.(csv|tsv|txt|json)$/i.test(file.name)) {
    throw new ImportError('只支持 CSV 或 JSON 文件')
  }
  return parseUsageText(await file.text(), file.name)
}

export const CSV_TEMPLATE = [
  'lab,model,week,tokens,visitors,price_in,price_out,context,modalities,released,featured',
  'OpenAI,示例模型-A,2026-09-21,125000000,420,2.00,8.00,1M,text|image|file,2026-09-10,',
  'OpenAI,示例模型-A,2026-09-14,98000000,380,,,,,,',
  'OpenAI,示例模型-B,2026-09-21,36000000,150,0.40,1.60,400K,text,2026-09-10,true',
  ',deepseek-示例,2026-09-21,56000000,210,0.28,1.10,128K,text,,',
].join('\n')

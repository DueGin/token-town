import { compareLabs, OTHER_LAB, resolveLab, type LabIdentity } from '@/lib/labs'
import { addDays, daysBetween } from '@/lib/week'

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file'

export const MODALITIES: readonly Modality[] = ['text', 'image', 'audio', 'video', 'file']

/** 一行用量：某模型在某一周（周一日期）的 token 总量。 */
export interface UsageRow {
  lab?: string
  model: string
  week: string
  tokens: number
  visitors?: number
}

/** 模型的静态资料，用于数据卡；全部可选。价格单位为 USD / 百万 token。 */
export interface ModelInfo {
  lab?: string
  model: string
  released?: string
  context?: number
  modalities?: Modality[]
  priceIn?: number
  priceOut?: number
  /** 数据文件指定的主推模型；同一厂商有多个时取本周用量最高的那个。 */
  featured?: boolean
}

export interface TownDataset {
  source: 'sample' | 'import'
  label: string
  rows: UsageRow[]
  models: ModelInfo[]
}

export interface ModelStat {
  model: string
  weekTokens: number
  info?: ModelInfo
  isNew: boolean
}

export interface WeekPoint {
  week: string
  tokens: number
}

/** 主推模型的来源：本机设置、数据文件指定，或本周用量最高。 */
export type FeaturedSource = 'pinned' | 'data' | 'usage'

export interface LabShop extends LabIdentity {
  featured: ModelStat
  featuredBy: FeaturedSource
  /** 本机指定的主推模型这一周没有用量时记下它的名字，界面据此提示。 */
  missingPin?: string
  /** 本周有用量的模型，按用量降序。 */
  models: ModelStat[]
  weekTokens: number
  /** 上一周用量；数据里没有上一周时为 null。 */
  prevWeekTokens: number | null
  /** 较上周的相对变化；上一周为 0 或缺失时为 null。 */
  change: number | null
  history: WeekPoint[]
  /** 各模型访客数相加，同一用户用多个模型会被重复计入；数据未提供时为 null。 */
  visitors: number | null
  /** 门口排队人数，按用量平方根缩放。 */
  queue: number
}

export interface TownSnapshot {
  week: string
  weeks: string[]
  shops: LabShop[]
  totalTokens: number
}

export const MAX_SHOPS = 20
export const MAX_QUEUE = 24
export const HISTORY_WEEKS = 6
/** 发布日期距数据周结束不超过该天数时，挂“新上架”牌。 */
export const NEW_MODEL_DAYS = 28

interface LabAccumulator {
  identity: LabIdentity
  weekly: Map<string, number>
  modelWeek: Map<string, number>
  modelNames: Map<string, string>
  visitors: number
  hasVisitors: boolean
}

function modelKey(model: string): string {
  return model.trim().toLowerCase()
}

/** 数据里出现过的所有周（升序）。 */
export function listWeeks(dataset: TownDataset): string[] {
  return Array.from(new Set(dataset.rows.map((row) => row.week))).sort()
}

/** 排队人数：最大店铺排满 MAX_QUEUE，其余按用量平方根缩放，有用量的店至少 1 人。 */
export function queueSize(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0
  return Math.max(1, Math.min(MAX_QUEUE, Math.round(Math.sqrt(tokens / maxTokens) * MAX_QUEUE)))
}

export function isNewRelease(released: string | undefined, week: string): boolean {
  if (!released) return false
  const age = daysBetween(released, addDays(week, 6))
  return Number.isFinite(age) && age >= 0 && age <= NEW_MODEL_DAYS
}

/** 不看本机设置时的主推模型：数据文件指定的优先，否则取本周用量最高。models 需按用量降序。 */
export function defaultFeatured(models: ModelStat[]): { model: ModelStat; by: 'data' | 'usage' } {
  const flagged = models.find((stat) => stat.info?.featured)
  return flagged ? { model: flagged, by: 'data' } : { model: models[0], by: 'usage' }
}

/**
 * 把原始用量行聚合成某一周的小镇快照：每个厂商一间店，按厂商表的固定顺序排列（不按用量排名）。
 * 超过 MAX_SHOPS 的长尾厂商合并进“其他厂商”。
 */
export function buildSnapshot(dataset: TownDataset, requestedWeek?: string): TownSnapshot {
  const weeks = listWeeks(dataset)
  const week = requestedWeek && weeks.includes(requestedWeek) ? requestedWeek : weeks[weeks.length - 1]
  if (!week) return { week: '', weeks, shops: [], totalTokens: 0 }

  const historyWeeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(week, (i - HISTORY_WEEKS + 1) * 7))
  const prevWeek = historyWeeks[HISTORY_WEEKS - 2]
  const inWindow = new Set(historyWeeks)

  const infoByModel = new Map<string, ModelInfo>()
  for (const info of dataset.models) infoByModel.set(modelKey(info.model), info)

  const labs = new Map<string, LabAccumulator>()
  for (const row of dataset.rows) {
    if (!inWindow.has(row.week)) continue
    const info = infoByModel.get(modelKey(row.model))
    const identity = resolveLab(row.lab ?? info?.lab, row.model)
    let lab = labs.get(identity.id)
    if (!lab) {
      lab = { identity, weekly: new Map(), modelWeek: new Map(), modelNames: new Map(), visitors: 0, hasVisitors: false }
      labs.set(identity.id, lab)
    }
    lab.weekly.set(row.week, (lab.weekly.get(row.week) ?? 0) + row.tokens)
    if (row.week === week) {
      const key = modelKey(row.model)
      lab.modelWeek.set(key, (lab.modelWeek.get(key) ?? 0) + row.tokens)
      if (!lab.modelNames.has(key)) lab.modelNames.set(key, row.model.trim())
      if (row.visitors !== undefined) {
        lab.visitors += row.visitors
        lab.hasVisitors = true
      }
    }
  }

  const active = Array.from(labs.values()).filter((lab) => (lab.weekly.get(week) ?? 0) > 0)
  const folded = foldLongTail(active, week)
  folded.sort((a, b) => compareLabs(a.identity, b.identity))

  const maxTokens = folded.reduce((max, lab) => Math.max(max, lab.weekly.get(week) ?? 0), 0)
  const shops: LabShop[] = folded.map((lab) => {
    const weekTokens = lab.weekly.get(week) ?? 0
    const hasPrev = weeks.includes(prevWeek)
    const prevWeekTokens = hasPrev ? (lab.weekly.get(prevWeek) ?? 0) : null
    const models = Array.from(lab.modelWeek.entries())
      .map(([key, tokens]): ModelStat => {
        const info = infoByModel.get(key)
        return { model: lab.modelNames.get(key) ?? key, weekTokens: tokens, info, isNew: isNewRelease(info?.released, week) }
      })
      .sort((a, b) => b.weekTokens - a.weekTokens || a.model.localeCompare(b.model))
    const initial = defaultFeatured(models)
    return {
      ...lab.identity,
      featured: initial.model,
      featuredBy: initial.by,
      models,
      weekTokens,
      prevWeekTokens,
      change: prevWeekTokens ? (weekTokens - prevWeekTokens) / prevWeekTokens : null,
      history: historyWeeks.map((w) => ({ week: w, tokens: lab.weekly.get(w) ?? 0 })),
      visitors: lab.hasVisitors ? lab.visitors : null,
      queue: queueSize(weekTokens, maxTokens),
    }
  })

  return { week, weeks, shops, totalTokens: shops.reduce((sum, shop) => sum + shop.weekTokens, 0) }
}

function mergeInto(target: LabAccumulator, source: LabAccumulator) {
  for (const [w, tokens] of source.weekly) target.weekly.set(w, (target.weekly.get(w) ?? 0) + tokens)
  for (const [key, tokens] of source.modelWeek) {
    target.modelWeek.set(key, (target.modelWeek.get(key) ?? 0) + tokens)
    if (!target.modelNames.has(key)) target.modelNames.set(key, source.modelNames.get(key) ?? key)
  }
  target.visitors += source.visitors
  target.hasVisitors ||= source.hasVisitors
}

function foldLongTail(labs: LabAccumulator[], week: string): LabAccumulator[] {
  if (labs.length <= MAX_SHOPS) return labs
  const named = labs
    .filter((lab) => lab.identity.id !== OTHER_LAB.id)
    .sort((a, b) => (b.weekly.get(week) ?? 0) - (a.weekly.get(week) ?? 0))
  const other: LabAccumulator = labs.find((lab) => lab.identity.id === OTHER_LAB.id) ?? {
    identity: OTHER_LAB,
    weekly: new Map(),
    modelWeek: new Map(),
    modelNames: new Map(),
    visitors: 0,
    hasVisitors: false,
  }
  const kept = named.slice(0, MAX_SHOPS - 1)
  for (const lab of named.slice(MAX_SHOPS - 1)) mergeInto(other, lab)
  return [...kept, other]
}

import type { LabShop } from '@/lib/town-data'

/** 本机的主推模型设置：厂商 id → 模型名（比较时不区分大小写），只保存在当前浏览器。 */
export type FeaturedPins = Readonly<Record<string, string>>

export const EMPTY_PINS: FeaturedPins = Object.freeze({})

const MAX_PINS = 64
const MAX_LAB_ID_LENGTH = 80
const MAX_MODEL_LENGTH = 120

function sameModel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 读取存储的设置：只接受“字符串 → 字符串”的对象，超长或多余的条目直接丢弃；整体无效时返回 undefined。 */
export function parseFeaturedPins(raw: string): FeaturedPins | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const pins: Record<string, string> = {}
  for (const [labId, model] of Object.entries(parsed).slice(0, MAX_PINS)) {
    if (!labId || labId.length > MAX_LAB_ID_LENGTH || typeof model !== 'string') continue
    const name = model.trim()
    if (name && name.length <= MAX_MODEL_LENGTH) pins[labId] = name
  }
  return pins
}

export function serializeFeaturedPins(pins: FeaturedPins): string {
  return JSON.stringify(pins)
}

/** 指定或清除（model 为 null）某家店的主推模型，返回新对象。 */
export function setFeaturedPin(pins: FeaturedPins, labId: string, model: string | null): FeaturedPins {
  const next = { ...pins }
  if (model === null) delete next[labId]
  else next[labId] = model
  return next
}

/**
 * 把本机设置套到 buildSnapshot 的店铺上：指定的模型本周有用量就作为主推；没有用量时保留默认主推，并记下 missingPin 供界面提示。
 * 没有设置的店铺原样返回，场景用的快照不受影响。
 */
export function applyFeaturedPins(shops: LabShop[], pins: FeaturedPins): LabShop[] {
  return shops.map((shop) => {
    const pinned = pins[shop.id]
    if (!pinned) return shop
    const stat = shop.models.find((item) => sameModel(item.model, pinned))
    return stat ? { ...shop, featured: stat, featuredBy: 'pinned' } : { ...shop, missingPin: pinned }
  })
}

import { addDays, parseDay } from '@/lib/week'
import type { Modality } from '@/lib/town-data'

export interface CompactNumber {
  value: string
  unit: string
}

const GROUPED = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

function significant(value: number): string {
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)
}

/** 把 token 数折算成中文计数单位（万 / 亿 / 万亿），保留约三位有效数字。 */
export function compactTokens(tokens: number): CompactNumber {
  const abs = Math.abs(tokens)
  if (abs >= 1e12) return { value: significant(tokens / 1e12), unit: '万亿' }
  if (abs >= 1e8) return { value: significant(tokens / 1e8), unit: '亿' }
  if (abs >= 1e4) return { value: significant(tokens / 1e4), unit: '万' }
  return { value: GROUPED.format(tokens), unit: '' }
}

export function formatTokens(tokens: number): string {
  const { value, unit } = compactTokens(tokens)
  return unit ? `${value} ${unit}` : value
}

export function formatInteger(value: number): string {
  return GROUPED.format(value)
}

/** 有符号百分比，负号使用真正的减号（U+2212）。 */
export function formatChange(change: number): string {
  const pct = Math.abs(change * 100)
  const digits = pct >= 100 ? 0 : 1
  const text = pct.toFixed(digits)
  if (Number(text) === 0) return '0%'
  return `${change > 0 ? '+' : '−'}${text}%`
}

export function formatPrice(usdPerMillion: number): string {
  return `$${usdPerMillion.toFixed(usdPerMillion < 0.1 ? 3 : 2)}`
}

/** 上下文窗口按 K/M 显示，这是模型文档里最常见的写法。 */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function monthDay(date: Date): string {
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/** “9月21日–27日” 或跨月时 “9月28日–10月4日”。 */
export function formatWeekRange(week: string): string {
  const start = parseDay(week)
  const end = parseDay(addDays(week, 6))
  if (!start || !end) return week
  if (start.getUTCMonth() === end.getUTCMonth()) return `${monthDay(start)}–${end.getUTCDate()}日`
  return `${monthDay(start)}–${monthDay(end)}`
}

/** 柱状图坐标轴用的短日期 “9/21”。 */
export function formatShortDay(week: string): string {
  const date = parseDay(week)
  return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : week
}

export const MODALITY_LABELS: Record<Modality, string> = {
  text: '文本',
  image: '图像',
  audio: '音频',
  video: '视频',
  file: '文件',
}

export function formatModalities(modalities: readonly Modality[] | undefined): string {
  if (!modalities?.length) return '未提供'
  return modalities.map((m) => MODALITY_LABELS[m]).join(' · ')
}

/** 在厂商色块上选择可读的文字色（按相对亮度判断）。 */
export function readableTextOn(hex: string): '#ffffff' | '#141414' {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // 白字对比度 (1.05)/(L+0.05) 与黑字 (L+0.05)/0.05 取较大者
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#141414'
}

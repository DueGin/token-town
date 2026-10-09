/**
 * 小镇时钟的纯函数：把一天中的小时数（0–24，可带小数）换算成日照、暖色程度和时段文案。
 * 这里不依赖 three，场景主题和界面都从同一套函数取值，保证天色和工具栏一致。
 */
export type ClockMode = 'live' | 'manual'

export interface ClockSettings {
  mode: ClockMode
  /** 手动模式下的小时数，0–24。 */
  manualHours: number
  /** 'system' 表示跟随浏览器所在时区，否则为 IANA 时区名。 */
  timeZone: string
}

export const SYSTEM_TIME_ZONE = 'system'

export function wrapHours(hours: number): number {
  if (!Number.isFinite(hours)) return 12
  const wrapped = hours % 24
  return wrapped < 0 ? wrapped + 24 : wrapped
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 太阳高度的简化模型：6 点日出、12 点最高、18 点日落，取值 -1–1。 */
export function sunElevation(hours: number): number {
  return Math.sin(((wrapHours(hours) - 6) / 12) * Math.PI)
}

/** 日照强度 0–1：太阳略低于地平线时开始泛白，升到一定高度后算作全天光。 */
export function daylightAt(hours: number): number {
  return smoothstep(-0.25, 0.3, sunElevation(hours))
}

/** 晨昏的暖色程度 0–1：太阳贴近地平线时最强，正午和深夜为 0。 */
export function warmthAt(hours: number): number {
  const elevation = sunElevation(hours)
  return Math.max(0, 1 - Math.abs(elevation + 0.05) / 0.4)
}

/** 是否处于傍晚一侧（12–24 点），用来区分黄昏偏橙、清晨偏粉。 */
export function isEvening(hours: number): boolean {
  return wrapHours(hours) >= 12
}

export function formatClock(hours: number): string {
  const totalMinutes = Math.floor(wrapHours(hours) * 60 + 1e-6) % (24 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export type DayPeriod = 'late-night' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'evening'

export function dayPeriod(hours: number): DayPeriod {
  const h = wrapHours(hours)
  if (h < 5) return 'late-night'
  if (h < 7) return 'dawn'
  if (h < 11) return 'morning'
  if (h < 13) return 'noon'
  if (h < 17) return 'afternoon'
  if (h < 19.5) return 'dusk'
  if (h < 22) return 'evening'
  return 'late-night'
}

const PERIOD_LABELS: Record<DayPeriod, string> = {
  'late-night': '深夜',
  dawn: '清晨',
  morning: '上午',
  noon: '正午',
  afternoon: '下午',
  dusk: '黄昏',
  evening: '夜晚',
}

export function periodLabel(hours: number): string {
  return PERIOD_LABELS[dayPeriod(hours)]
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** 把 'system' 解析成具体的 IANA 时区；无效时区回落到系统时区。 */
export function resolveTimeZone(zone: string): string {
  if (zone === SYSTEM_TIME_ZONE || !isValidTimeZone(zone)) return systemTimeZone()
  return zone
}

/** 某一时刻在指定时区里的小时数（带分钟、秒的小数）。 */
export function hoursInTimeZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    return wrapHours(get('hour') + get('minute') / 60 + get('second') / 3600)
  } catch {
    return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  }
}

/** 时区相对 UTC 的偏移，例如 “GMT+8”；取不到时返回空串。 */
export function timeZoneOffsetLabel(timeZone: string, date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date)
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

export const COMMON_TIME_ZONES: readonly { zone: string; label: string }[] = [
  { zone: 'Asia/Shanghai', label: '上海' },
  { zone: 'Asia/Hong_Kong', label: '香港' },
  { zone: 'Asia/Taipei', label: '台北' },
  { zone: 'Asia/Tokyo', label: '东京' },
  { zone: 'Asia/Seoul', label: '首尔' },
  { zone: 'Asia/Singapore', label: '新加坡' },
  { zone: 'Asia/Kolkata', label: '加尔各答' },
  { zone: 'Asia/Dubai', label: '迪拜' },
  { zone: 'Europe/London', label: '伦敦' },
  { zone: 'Europe/Paris', label: '巴黎' },
  { zone: 'Europe/Berlin', label: '柏林' },
  { zone: 'Europe/Moscow', label: '莫斯科' },
  { zone: 'America/New_York', label: '纽约' },
  { zone: 'America/Chicago', label: '芝加哥' },
  { zone: 'America/Denver', label: '丹佛' },
  { zone: 'America/Los_Angeles', label: '洛杉矶' },
  { zone: 'America/Sao_Paulo', label: '圣保罗' },
  { zone: 'Australia/Sydney', label: '悉尼' },
  { zone: 'Pacific/Auckland', label: '奥克兰' },
  { zone: 'UTC', label: '协调世界时' },
]

/**
 * 周相关的日期工具。所有计算都在 UTC 日历日上进行，
 * 避免浏览器时区把 “2026-09-21” 挪到前一天。
 */
const DAY_MS = 86_400_000
const DATE_PREFIX = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/

/** 解析 YYYY-MM-DD（也接受 / . 分隔或带时间后缀），返回 UTC 零点；无效返回 null。 */
export function parseDay(value: string): Date | null {
  const match = DATE_PREFIX.exec(value.trim())
  if (!match) return null
  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}

export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 返回日期所在 ISO 周的周一（YYYY-MM-DD）。 */
export function weekStartOf(value: string): string | null {
  const date = parseDay(value)
  if (!date) return null
  const offset = (date.getUTCDay() + 6) % 7
  return toDayString(new Date(date.getTime() - offset * DAY_MS))
}

export function addDays(day: string, days: number): string {
  const date = parseDay(day)
  if (!date) throw new Error(`无效日期：${day}`)
  return toDayString(new Date(date.getTime() + days * DAY_MS))
}

export function daysBetween(from: string, to: string): number {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return Number.NaN
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

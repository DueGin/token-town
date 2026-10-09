import { describe, expect, it } from 'vitest'
import {
  daylightAt,
  formatClock,
  hoursInTimeZone,
  isValidTimeZone,
  periodLabel,
  resolveTimeZone,
  SYSTEM_TIME_ZONE,
  systemTimeZone,
  timeZoneOffsetLabel,
  warmthAt,
  wrapHours,
} from '@/lib/time-of-day'

describe('time-of-day', () => {
  it('小时数回绕到 0–24，非法值回落正午', () => {
    expect(wrapHours(25.5)).toBe(1.5)
    expect(wrapHours(-1)).toBe(23)
    expect(wrapHours(Number.NaN)).toBe(12)
  })

  it('格式化为 24 小时制 HH:mm', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9 + 5 / 60)).toBe('09:05')
    expect(formatClock(22.5)).toBe('22:30')
    expect(formatClock(23.999)).toBe('23:59')
    expect(formatClock(24)).toBe('00:00')
  })

  it('时段文案覆盖一整天', () => {
    expect([2, 6, 9, 12, 15, 18, 21, 22.5].map(periodLabel)).toEqual([
      '深夜',
      '清晨',
      '上午',
      '正午',
      '下午',
      '黄昏',
      '夜晚',
      '深夜',
    ])
  })

  it('日照：正午满、午夜零，日出前后单调上升', () => {
    expect(daylightAt(12)).toBe(1)
    expect(daylightAt(0)).toBe(0)
    let previous = -1
    for (let h = 3; h <= 12; h += 0.25) {
      const value = daylightAt(h)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    expect(daylightAt(8)).toBeCloseTo(daylightAt(16))
  })

  it('暖色只出现在晨昏', () => {
    expect(warmthAt(12)).toBe(0)
    expect(warmthAt(0)).toBe(0)
    expect(warmthAt(18)).toBeGreaterThan(0.8)
    expect(warmthAt(6)).toBeGreaterThan(0.8)
  })

  it('按指定时区换算当前时刻', () => {
    const instant = new Date(Date.UTC(2026, 8, 30, 1, 30, 0))
    expect(hoursInTimeZone(instant, 'UTC')).toBe(1.5)
    expect(hoursInTimeZone(instant, 'Asia/Shanghai')).toBe(9.5)
    // 跨日：纽约此时仍是前一天晚上（夏令时 UTC−4）
    expect(hoursInTimeZone(instant, 'America/New_York')).toBe(21.5)
    expect(timeZoneOffsetLabel('Asia/Shanghai', instant)).toBe('GMT+8')
  })

  it('“跟随系统”和无效时区都解析成系统时区', () => {
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(resolveTimeZone(SYSTEM_TIME_ZONE)).toBe(systemTimeZone())
    expect(resolveTimeZone('Mars/Olympus')).toBe(systemTimeZone())
  })
})

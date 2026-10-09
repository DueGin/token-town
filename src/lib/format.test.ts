import {
  compactTokens,
  formatChange,
  formatContext,
  formatModalities,
  formatPrice,
  formatWeekRange,
  readableTextOn,
} from '@/lib/format'
import { addDays, weekStartOf } from '@/lib/week'

describe('format', () => {
  it('按中文计数单位压缩 token 数', () => {
    expect(compactTokens(4.82e11)).toEqual({ value: '4,820', unit: '亿' })
    expect(compactTokens(1.234e12)).toEqual({ value: '1.23', unit: '万亿' })
    expect(compactTokens(56_700_000)).toEqual({ value: '5,670', unit: '万' })
    expect(compactTokens(9_876)).toEqual({ value: '9,876', unit: '' })
  })

  it('变化率带符号并使用减号', () => {
    expect(formatChange(0.1234)).toBe('+12.3%')
    expect(formatChange(-0.041)).toBe('−4.1%')
    expect(formatChange(1.5)).toBe('+150%')
    expect(formatChange(0.0001)).toBe('0%')
  })

  it('价格、上下文和模态', () => {
    expect(formatPrice(2)).toBe('$2.00')
    expect(formatPrice(0.04)).toBe('$0.040')
    expect(formatContext(1_000_000)).toBe('1M')
    expect(formatContext(2_500_000)).toBe('2.5M')
    expect(formatContext(128_000)).toBe('128K')
    expect(formatModalities(['text', 'image'])).toBe('文本 · 图像')
    expect(formatModalities(undefined)).toBe('未提供')
  })

  it('周区间处理跨月', () => {
    expect(formatWeekRange('2026-09-21')).toBe('9月21日–27日')
    expect(formatWeekRange('2026-09-28')).toBe('9月28日–10月4日')
  })

  it('按亮度选择徽标文字色', () => {
    expect(readableTextOn('#1f2430')).toBe('#ffffff')
    expect(readableTextOn('#f2a900')).toBe('#141414')
  })
})

describe('week', () => {
  it('任意日期归到所在 ISO 周的周一', () => {
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-21T23:59:00+08:00')).toBe('2026-09-21')
    expect(weekStartOf('2026/9/23')).toBe('2026-09-21')
    expect(weekStartOf('2026-02-30')).toBeNull()
    expect(addDays('2026-09-21', -7)).toBe('2026-09-14')
  })
})

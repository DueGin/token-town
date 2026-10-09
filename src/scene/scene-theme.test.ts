import { describe, expect, it } from 'vitest'
import { mixHex, SCENE_THEMES, sceneThemeAt } from '@/scene/scene-theme'

describe('mixHex', () => {
  it('逐通道线性混合，t 超出范围时夹紧', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#102030', '#305070', 0)).toBe('#102030')
    expect(mixHex('#102030', '#305070', 1)).toBe('#305070')
    expect(mixHex('#102030', '#305070', 2)).toBe('#305070')
  })
})

describe('sceneThemeAt', () => {
  it('正午是白天主题，午夜是夜晚主题', () => {
    const noon = sceneThemeAt(12)
    expect(noon.night).toBe(false)
    expect(noon.nightLevel).toBeCloseTo(0)
    expect(noon.background).toBe(SCENE_THEMES.day.background)

    const midnight = sceneThemeAt(0)
    expect(midnight.night).toBe(true)
    expect(midnight.nightLevel).toBeCloseTo(1)
    expect(midnight.background).toBe(SCENE_THEMES.night.background)
  })

  it('黄昏偏暖、太阳压低，并且从西边照过来', () => {
    const dusk = sceneThemeAt(18)
    const noon = sceneThemeAt(12)
    const [r, , b] = [1, 3, 5].map((i) => parseInt(dusk.background.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(b)
    expect(dusk.sunDirection[1]).toBeLessThan(noon.sunDirection[1])
    // 上午和下午的太阳分居两侧
    expect(Math.sign(sceneThemeAt(9).sunDirection[0])).toBe(-Math.sign(sceneThemeAt(15).sunDirection[0]))
  })

  it('夜色程度随时间连续变化：日出日落各有一两个小时的过渡，没有突变', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const step = Math.abs(sceneThemeAt(h + 0.25).nightLevel - sceneThemeAt(h).nightLevel)
      expect(step).toBeLessThan(0.2)
    }
    expect(sceneThemeAt(6).nightLevel).toBeGreaterThan(0.1)
    expect(sceneThemeAt(6).nightLevel).toBeLessThan(0.9)
  })
})

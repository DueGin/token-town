import { describe, expect, it } from 'vitest'
import { applyFeaturedPins, EMPTY_PINS, parseFeaturedPins, serializeFeaturedPins, setFeaturedPin } from '@/lib/featured-pins'
import { buildSnapshot, type TownDataset } from '@/lib/town-data'

const dataset: TownDataset = {
  source: 'import',
  label: 'test',
  rows: [
    { lab: 'OpenAI', model: 'gpt-a', week: '2026-09-21', tokens: 300 },
    { lab: 'OpenAI', model: 'GPT-B', week: '2026-09-21', tokens: 100 },
    { lab: 'OpenAI', model: 'gpt-old', week: '2026-09-14', tokens: 50 },
    { lab: 'Google', model: 'gemini', week: '2026-09-21', tokens: 80 },
  ],
  models: [{ model: 'gpt-b', priceIn: 1 }],
}

describe('parseFeaturedPins', () => {
  it('只接受字符串映射，丢弃无效条目', () => {
    expect(parseFeaturedPins('{bad')).toBeUndefined()
    expect(parseFeaturedPins('["gpt-a"]')).toBeUndefined()
    expect(parseFeaturedPins('null')).toBeUndefined()
    expect(parseFeaturedPins(JSON.stringify({ openai: ' gpt-a ', google: 3, xai: '', meta: 'm'.repeat(121) }))).toEqual({ openai: 'gpt-a' })
  })

  it('序列化后能读回', () => {
    const pins = setFeaturedPin(EMPTY_PINS, 'openai', 'gpt-b')
    expect(parseFeaturedPins(serializeFeaturedPins(pins))).toEqual({ openai: 'gpt-b' })
  })
})

describe('setFeaturedPin', () => {
  it('返回新对象，null 表示清除', () => {
    const pins = setFeaturedPin(EMPTY_PINS, 'openai', 'gpt-b')
    expect(EMPTY_PINS).toEqual({})
    expect(setFeaturedPin(pins, 'openai', null)).toEqual({})
    expect(pins).toEqual({ openai: 'gpt-b' })
  })
})

describe('applyFeaturedPins', () => {
  const { shops } = buildSnapshot(dataset)

  it('默认主推为本周用量最高；没有设置的店铺原样返回', () => {
    expect(shops[0]).toMatchObject({ id: 'openai', featuredBy: 'usage', featured: { model: 'gpt-a' } })
    const applied = applyFeaturedPins(shops, EMPTY_PINS)
    expect(applied[0]).toBe(shops[0])
    expect(applied[1]).toBe(shops[1])
  })

  it('按模型名（不区分大小写）指定主推，并带上它的资料', () => {
    const [openai, google] = applyFeaturedPins(shops, { openai: 'gpt-b' })
    expect(openai).toMatchObject({ featuredBy: 'pinned', featured: { model: 'GPT-B', weekTokens: 100, info: { priceIn: 1 } } })
    expect(openai.missingPin).toBeUndefined()
    expect(google).toBe(shops[1])
    // 原快照不被修改
    expect(shops[0].featured.model).toBe('gpt-a')
  })

  it('指定的模型本周没有用量时保留默认主推并记下 missingPin', () => {
    const [openai] = applyFeaturedPins(shops, { openai: 'gpt-old' })
    expect(openai).toMatchObject({ featuredBy: 'usage', featured: { model: 'gpt-a' }, missingPin: 'gpt-old' })
  })
})

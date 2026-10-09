import { createSampleDataset, SAMPLE_LATEST_WEEK } from '@/lib/sample-data'
import { buildSnapshot, isNewRelease, MAX_QUEUE, MAX_SHOPS, queueSize, type TownDataset, type UsageRow } from '@/lib/town-data'

function dataset(rows: UsageRow[], models: TownDataset['models'] = []): TownDataset {
  return { source: 'import', label: 'test', rows, models }
}

describe('buildSnapshot', () => {
  it('按厂商聚合、按固定厂商顺序排列（与用量无关），并计算环比与历史', () => {
    const snapshot = buildSnapshot(
      dataset([
        { lab: 'OpenAI', model: 'gpt-a', week: '2026-09-21', tokens: 300, visitors: 3 },
        { lab: 'OpenAI', model: 'gpt-b', week: '2026-09-21', tokens: 100, visitors: 2 },
        { lab: 'OpenAI', model: 'gpt-a', week: '2026-09-14', tokens: 200 },
        { model: 'claude-x', week: '2026-09-21', tokens: 500 },
        { model: 'claude-x', week: '2026-09-07', tokens: 50 },
      ]),
    )
    expect(snapshot.week).toBe('2026-09-21')
    // Anthropic 用量更高，但固定顺序里 OpenAI 在前
    expect(snapshot.shops.map((s) => s.id)).toEqual(['openai', 'anthropic'])
    expect(snapshot.totalTokens).toBe(900)
    expect(snapshot.shops.some((s) => 'rank' in s)).toBe(false)

    const byId = new Map(snapshot.shops.map((s) => [s.id, s]))
    const openai = byId.get('openai')!
    expect(openai.weekTokens).toBe(400)
    expect(openai.prevWeekTokens).toBe(200)
    expect(openai.change).toBeCloseTo(1)
    expect(openai.featured.model).toBe('gpt-a')
    expect(openai.visitors).toBe(5)
    expect(openai.history).toHaveLength(6)
    expect(openai.history.at(-1)).toEqual({ week: '2026-09-21', tokens: 400 })

    const anthropic = byId.get('anthropic')!
    // 上一周没有用量：环比不可计算，而不是显示 +∞
    expect(anthropic.prevWeekTokens).toBe(0)
    expect(anthropic.change).toBeNull()
    expect(anthropic.visitors).toBeNull()
    expect(anthropic.queue).toBe(MAX_QUEUE)
  })

  it('数据文件指定的主推优先于用量最高的模型，本周没有用量时不生效', () => {
    const rows: UsageRow[] = [
      { lab: 'OpenAI', model: 'gpt-a', week: '2026-09-21', tokens: 300 },
      { lab: 'OpenAI', model: 'gpt-b', week: '2026-09-21', tokens: 100 },
      { lab: 'OpenAI', model: 'gpt-c', week: '2026-09-21', tokens: 50 },
      { lab: 'Google', model: 'gemini-a', week: '2026-09-21', tokens: 90 },
      { lab: 'Google', model: 'gemini-b', week: '2026-09-21', tokens: 10 },
    ]
    const snapshot = buildSnapshot(
      dataset(rows, [
        { model: 'GPT-C', featured: true },
        { model: 'gpt-b', featured: true },
        { model: 'gemini-old', featured: true },
      ]),
    )
    const [openai, google] = snapshot.shops
    // 同一厂商标了多款时取本周用量最高的那款
    expect(openai).toMatchObject({ featuredBy: 'data', featured: { model: 'gpt-b' } })
    expect(google).toMatchObject({ featuredBy: 'usage', featured: { model: 'gemini-a' } })
  })

  it('可以查看历史周，并忽略该周没有用量的厂商', () => {
    const snapshot = buildSnapshot(
      dataset([
        { lab: 'OpenAI', model: 'gpt-a', week: '2026-09-21', tokens: 300 },
        { lab: 'Google', model: 'gemini', week: '2026-09-14', tokens: 50 },
      ]),
      '2026-09-14',
    )
    expect(snapshot.week).toBe('2026-09-14')
    expect(snapshot.shops.map((s) => s.id)).toEqual(['google'])
    // 数据中不存在更早一周时环比为 null
    expect(snapshot.shops[0].prevWeekTokens).toBeNull()
  })

  it('长尾厂商合并进“其他厂商”', () => {
    const rows = Array.from({ length: MAX_SHOPS + 5 }, (_, i) => ({
      lab: `Lab ${String.fromCharCode(65 + i)}`,
      model: `m-${i}`,
      week: '2026-09-21',
      tokens: 1000 - i,
    }))
    const snapshot = buildSnapshot(dataset(rows))
    expect(snapshot.shops).toHaveLength(MAX_SHOPS)
    const other = snapshot.shops.find((s) => s.id === 'other')
    expect(other?.models).toHaveLength(6)
    expect(snapshot.totalTokens).toBe(rows.reduce((sum, r) => sum + r.tokens, 0))
  })

  it('空数据返回空快照', () => {
    expect(buildSnapshot(dataset([])).shops).toEqual([])
  })

  it('标记数据周结束前 28 天内发布的新模型', () => {
    expect(isNewRelease('2026-09-10', '2026-09-21')).toBe(true)
    expect(isNewRelease('2026-08-30', '2026-09-21')).toBe(true)
    expect(isNewRelease('2026-08-29', '2026-09-21')).toBe(false)
    expect(isNewRelease('2026-10-01', '2026-09-21')).toBe(false)
    expect(isNewRelease(undefined, '2026-09-21')).toBe(false)
  })

  it('排队人数按平方根缩放且有用量至少 1 人', () => {
    expect(queueSize(100, 100)).toBe(MAX_QUEUE)
    expect(queueSize(25, 100)).toBe(Math.round(0.5 * MAX_QUEUE))
    expect(queueSize(1, 1e9)).toBe(1)
    expect(queueSize(0, 100)).toBe(0)
  })
})

describe('示例数据', () => {
  it('14 家店、8 周，按固定厂商顺序排列且带新上架模型', () => {
    const sample = createSampleDataset()
    const snapshot = buildSnapshot(sample)
    expect(sample.source).toBe('sample')
    expect(snapshot.week).toBe(SAMPLE_LATEST_WEEK)
    expect(snapshot.weeks).toHaveLength(8)
    expect(snapshot.shops).toHaveLength(14)
    expect(snapshot.shops[0].name).toBe('OpenAI')
    expect(snapshot.shops.every((s) => s.featured.info?.priceIn !== undefined)).toBe(true)
    expect(snapshot.shops.find((s) => s.name === 'Kimi')?.featured.isNew).toBe(true)
    // 旧版本只出现在往期，不会出现在本周价目牌上
    expect(snapshot.shops.flatMap((s) => s.models).some((m) => m.model === 'Kimi K2')).toBe(false)
    expect(createSampleDataset()).toEqual(sample)
  })
})

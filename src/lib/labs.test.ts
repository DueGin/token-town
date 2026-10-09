import { compareLabs, KNOWN_LABS, OTHER_LAB, resolveLab } from '@/lib/labs'

describe('resolveLab', () => {
  it('按别名归一显式厂商名（大小写与中英文）', () => {
    expect(resolveLab('  anthropic ', 'x').id).toBe('anthropic')
    expect(resolveLab('阿里云', 'x').name).toBe('通义千问')
    expect(resolveLab('Moonshot AI', 'x').name).toBe('Kimi')
  })

  it('缺少厂商时按模型名推断', () => {
    expect(resolveLab(undefined, 'gpt-5.5-mini').id).toBe('openai')
    expect(resolveLab('', 'o4-mini').id).toBe('openai')
    expect(resolveLab(undefined, 'claude-sonnet-4-5').id).toBe('anthropic')
    expect(resolveLab(undefined, 'qwen3-coder-plus').id).toBe('qwen')
    expect(resolveLab(undefined, 'glm-4.6').id).toBe('zhipu')
    expect(resolveLab(undefined, 'deepseek-chat').id).toBe('deepseek')
    expect(resolveLab(undefined, 'doubao-seed-1-6').id).toBe('bytedance')
  })

  it('无法识别的模型归入其他厂商', () => {
    expect(resolveLab(undefined, 'my-private-model')).toEqual(OTHER_LAB)
  })

  it('表外厂商得到稳定的 id、颜色和首字母徽标', () => {
    const a = resolveLab('Acme Labs', 'acme-1')
    const b = resolveLab('acme labs', 'acme-2')
    expect(a.id).toBe('acme-labs')
    expect(a.color).toBe(b.color)
    expect(a.monogram).toBe('A')
    expect(resolveLab('其他', 'x').id).not.toBe(OTHER_LAB.id)
  })
})

describe('compareLabs', () => {
  it('按厂商表固定顺序排列，表外厂商按名称排在其后，其他厂商最后', () => {
    const labs = [OTHER_LAB, resolveLab('Zeta AI', 'z'), resolveLab('Mistral', 'x'), resolveLab('OpenAI', 'x'), resolveLab('Acme', 'a')]
    expect(labs.sort(compareLabs).map((lab) => lab.id)).toEqual(['openai', 'mistral', 'acme', 'zeta-ai', 'other'])
    expect([...KNOWN_LABS].reverse().sort(compareLabs).map((lab) => lab.id)).toEqual(KNOWN_LABS.map((lab) => lab.id))
  })
})

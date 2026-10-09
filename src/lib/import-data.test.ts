import { CSV_TEMPLATE, ImportError, importUsageFile, MAX_IMPORT_BYTES, parseCsv, parseUsageText } from '@/lib/import-data'
import { buildSnapshot } from '@/lib/town-data'

describe('parseCsv', () => {
  it('处理引号、转义引号、引号内换行、CRLF 和 BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ])
  })

  it('自动识别制表符和分号分隔', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseUsageText', () => {
  it('导入 CSV 模板：字段别名、周归一、模型资料和厂商推断', () => {
    const result = parseUsageText(CSV_TEMPLATE, 'usage.csv')
    expect(result.accepted).toBe(4)
    expect(result.skipped).toBe(0)
    expect(result.dataset.source).toBe('import')
    expect(result.dataset.label).toBe('导入 · usage.csv')
    const info = result.dataset.models.find((m) => m.model === '示例模型-A')
    expect(info).toMatchObject({ lab: 'OpenAI', priceIn: 2, priceOut: 8, context: 1_000_000, modalities: ['text', 'image', 'file'], released: '2026-09-10' })

    expect(info?.featured).toBeUndefined()
    expect(result.dataset.models.find((m) => m.model === '示例模型-B')?.featured).toBe(true)

    const snapshot = buildSnapshot(result.dataset)
    expect(snapshot.shops.map((s) => s.id)).toEqual(['openai', 'deepseek'])
    expect(snapshot.shops[0].change).toBeCloseTo((125 + 36) / 98 - 1)
    // 模板里用 featured 列指定了用量较少的 B 为主推
    expect(snapshot.shops[0]).toMatchObject({ featuredBy: 'data', featured: { model: '示例模型-B' } })
  })

  it('featured 列只认明确的“是”', () => {
    const json = JSON.stringify([
      { model: 'a', week: '2026-09-21', tokens: 1, featured: true },
      { model: 'b', week: '2026-09-21', tokens: 1, 主推: '是' },
      { model: 'c', week: '2026-09-21', tokens: 1, featured: 'false' },
      { model: 'd', week: '2026-09-21', tokens: 1, featured: 0 },
      { model: 'e', week: '2026-09-21', tokens: 1, is_featured: 'Yes' },
    ])
    const flagged = parseUsageText(json, 'x.json').dataset.models.filter((m) => m.featured).map((m) => m.model)
    expect(flagged).toEqual(['a', 'b', 'e'])
  })

  it('按日期的明细行聚合到周，并用输入输出 token 求和', () => {
    const csv = ['模型,日期,input_tokens,output_tokens,用户数', 'glm-4.6,2026-09-22,100,20,1', 'glm-4.6,2026-09-27,50,5,2'].join('\n')
    const snapshot = buildSnapshot(parseUsageText(csv, 'daily.csv').dataset)
    expect(snapshot.week).toBe('2026-09-21')
    expect(snapshot.shops[0]).toMatchObject({ id: 'zhipu', weekTokens: 175, visitors: 3 })
  })

  it('导入 JSON：对象格式与只含资料的模型列表', () => {
    const json = JSON.stringify({
      rows: [{ provider: 'Google', model: 'gemini-x', week: '2026-09-21', total_tokens: '1,000' }],
      models: [{ model: 'gemini-x', price_in: 1.5, modalities: ['text', 'vision', 'unknown'] }],
    })
    const result = parseUsageText(json, 'usage.json')
    expect(result.accepted).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.dataset.rows[0].tokens).toBe(1000)
    expect(result.dataset.models[0]).toMatchObject({ priceIn: 1.5, modalities: ['text', 'image'] })
  })

  it('跳过无效行并记录第一条原因（CSV 行号含表头）', () => {
    const csv = ['model,week,tokens', 'a,2026-09-21,10', ',2026-09-21,10', 'b,不是日期,10', 'c,2026-09-21,-5'].join('\n')
    const result = parseUsageText(csv, 'x.csv')
    expect(result.accepted).toBe(1)
    expect(result.skipped).toBe(3)
    expect(result.firstIssue).toBe('第 3 行：缺少模型名（model）')
  })

  it('清理控制字符并限制名称长度', () => {
    const result = parseUsageText(JSON.stringify([{ lab: 'L\u0007ab', model: 'm'.repeat(300), week: '2026-09-21', tokens: 1 }]), 'x.json')
    expect(result.dataset.rows[0].lab).toBe('Lab')
    expect(result.dataset.rows[0].model).toHaveLength(120)
  })

  it('格式错误或没有可用行时抛出用户可读的 ImportError', () => {
    expect(() => parseUsageText('{bad', 'x.json')).toThrow(ImportError)
    expect(() => parseUsageText('foo,bar\n1,2', 'x.csv')).toThrow('CSV 表头缺少 model 列')
    expect(() => parseUsageText('model,week,tokens\n,,', 'x.csv')).toThrow('没有找到可用的用量数据')
    expect(() => parseUsageText('{"rows": 1}', 'x.json')).toThrow('JSON 结构无法识别')
  })
})

describe('importUsageFile', () => {
  it('拒绝超大文件和不支持的扩展名', async () => {
    const big = new File(['x'], 'big.csv')
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 })
    await expect(importUsageFile(big)).rejects.toThrow('文件超过 5 MB')
    await expect(importUsageFile(new File(['x'], 'a.xlsx'))).rejects.toThrow('只支持 CSV 或 JSON 文件')
  })

  it('读取文件内容', async () => {
    const result = await importUsageFile(new File([CSV_TEMPLATE], 'usage.csv', { type: 'text/csv' }))
    expect(result.accepted).toBe(4)
  })
})

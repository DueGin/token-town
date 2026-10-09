import { createRng, range } from '@/lib/rng'
import type { ModelInfo, Modality, TownDataset, UsageRow } from '@/lib/town-data'
import { addDays, daysBetween } from '@/lib/week'

/**
 * 开箱示例数据。厂商真实，模型名、发布日期、价格、用量与访客全部为虚构，
 * 仅用于演示小镇效果；界面上始终标注“示例数据 · 虚构”。
 */
export const SAMPLE_LABEL = '示例数据 · 虚构'
export const SAMPLE_LATEST_WEEK = '2026-09-21'
const SAMPLE_WEEKS = 8

interface SampleModel {
  model: string
  share: number
  released: string
  context: number
  modalities: Modality[]
  priceIn: number
  priceOut: number
  /** 上架前的旧版本：发布前的用量记在旧版本名下，比例为 carryOver。 */
  predecessor?: string
  carryOver?: number
}

interface SampleLab {
  lab: string
  /** 最新一周的厂商总 token。 */
  latest: number
  /** 每周平均增长率，用于倒推往期用量。 */
  growth: number
  /** 每位访客每周平均消耗的 token，决定访客数量级。 */
  tokensPerVisitor: number
  models: SampleModel[]
}

const TMF: Modality[] = ['text', 'image', 'file']

const SAMPLE_LABS: SampleLab[] = [
  {
    lab: 'OpenAI',
    latest: 4.82e11,
    growth: 0.035,
    tokensPerVisitor: 2.3e7,
    models: [
      { model: 'GPT-5.5', share: 0.6, predecessor: 'GPT-5', released: '2026-08-20', context: 1_000_000, modalities: TMF, priceIn: 2, priceOut: 12 },
      { model: 'GPT-5.5 mini', share: 0.3, predecessor: 'GPT-5 mini', released: '2026-08-20', context: 400_000, modalities: TMF, priceIn: 0.4, priceOut: 2.4 },
      { model: 'GPT-5 Codex', share: 0.1, released: '2025-09-15', context: 400_000, modalities: ['text', 'image'], priceIn: 1.25, priceOut: 10 },
    ],
  },
  {
    lab: 'Anthropic',
    latest: 4.13e11,
    growth: 0.05,
    tokensPerVisitor: 3.1e7,
    models: [
      { model: 'Claude Sonnet 5.5', share: 0.58, predecessor: 'Claude Sonnet 5', carryOver: 0.78, released: '2026-09-08', context: 1_000_000, modalities: TMF, priceIn: 3, priceOut: 15 },
      { model: 'Claude Opus 5.5', share: 0.24, predecessor: 'Claude Opus 5', carryOver: 0.7, released: '2026-09-08', context: 1_000_000, modalities: TMF, priceIn: 12, priceOut: 60 },
      { model: 'Claude Haiku 4.5', share: 0.18, released: '2025-10-15', context: 200_000, modalities: TMF, priceIn: 1, priceOut: 5 },
    ],
  },
  {
    lab: 'Google',
    latest: 3.27e11,
    growth: 0.02,
    tokensPerVisitor: 1.9e7,
    models: [
      { model: 'Gemini 3.5 Pro', share: 0.52, released: '2026-07-22', context: 2_000_000, modalities: ['text', 'image', 'audio', 'video', 'file'], priceIn: 2.5, priceOut: 15 },
      { model: 'Gemini 3.5 Flash', share: 0.48, released: '2026-07-22', context: 1_000_000, modalities: ['text', 'image', 'audio', 'video', 'file'], priceIn: 0.3, priceOut: 2.5 },
    ],
  },
  {
    lab: 'DeepSeek',
    latest: 2.61e11,
    growth: 0.06,
    tokensPerVisitor: 2.6e7,
    models: [
      { model: 'DeepSeek V4', share: 0.72, predecessor: 'DeepSeek V3.2', carryOver: 0.66, released: '2026-08-28', context: 256_000, modalities: ['text', 'file'], priceIn: 0.28, priceOut: 1.1 },
      { model: 'DeepSeek R3', share: 0.28, predecessor: 'DeepSeek R2', carryOver: 0.7, released: '2026-08-28', context: 256_000, modalities: ['text'], priceIn: 0.55, priceOut: 2.2 },
    ],
  },
  {
    lab: '通义千问',
    latest: 1.94e11,
    growth: 0.025,
    tokensPerVisitor: 2.1e7,
    models: [
      { model: 'Qwen4-Max', share: 0.45, released: '2026-06-30', context: 1_000_000, modalities: TMF, priceIn: 1.2, priceOut: 6 },
      { model: 'Qwen4-Coder', share: 0.4, released: '2026-07-15', context: 1_000_000, modalities: ['text'], priceIn: 0.9, priceOut: 3.6 },
      { model: 'Qwen4-VL', share: 0.15, released: '2026-05-20', context: 256_000, modalities: ['text', 'image', 'video'], priceIn: 0.5, priceOut: 1.5 },
    ],
  },
  {
    lab: 'Kimi',
    latest: 1.52e11,
    growth: 0.03,
    tokensPerVisitor: 2.8e7,
    models: [
      { model: 'Kimi K3', share: 0.7, predecessor: 'Kimi K2', carryOver: 0.55, released: '2026-09-10', context: 512_000, modalities: TMF, priceIn: 0.6, priceOut: 2.5 },
      { model: 'Kimi K3 Thinking', share: 0.3, predecessor: 'Kimi K2 Thinking', carryOver: 0.6, released: '2026-09-10', context: 512_000, modalities: ['text', 'file'], priceIn: 0.6, priceOut: 2.5 },
    ],
  },
  {
    lab: '智谱',
    latest: 1.08e11,
    growth: 0.04,
    tokensPerVisitor: 2.4e7,
    models: [
      { model: 'GLM-5', share: 0.75, predecessor: 'GLM-4.6', released: '2026-08-05', context: 256_000, modalities: ['text', 'file'], priceIn: 0.6, priceOut: 2.2 },
      { model: 'GLM-5V', share: 0.25, predecessor: 'GLM-4.5V', released: '2026-08-05', context: 128_000, modalities: ['text', 'image', 'video'], priceIn: 0.4, priceOut: 1.2 },
    ],
  },
  {
    lab: '豆包',
    latest: 8.2e10,
    growth: 0.015,
    tokensPerVisitor: 1.2e7,
    models: [
      { model: 'Doubao-Seed-2.0-Pro', share: 0.8, released: '2026-07-01', context: 256_000, modalities: ['text', 'image', 'video'], priceIn: 0.12, priceOut: 1.2 },
      { model: 'Doubao-Seed-2.0-Lite', share: 0.2, released: '2026-07-01', context: 256_000, modalities: ['text', 'image'], priceIn: 0.04, priceOut: 0.4 },
    ],
  },
  {
    lab: 'MiniMax',
    latest: 6.3e10,
    growth: 0.02,
    tokensPerVisitor: 2.2e7,
    models: [
      { model: 'MiniMax-M3', share: 1, predecessor: 'MiniMax-M2', carryOver: 0.72, released: '2026-09-16', context: 1_000_000, modalities: ['text', 'file'], priceIn: 0.3, priceOut: 1.2 },
    ],
  },
  {
    lab: 'xAI',
    latest: 4.4e10,
    growth: -0.02,
    tokensPerVisitor: 2e7,
    models: [
      { model: 'Grok 5', share: 0.7, released: '2026-06-18', context: 2_000_000, modalities: ['text', 'image'], priceIn: 3, priceOut: 15 },
      { model: 'Grok 5 Fast', share: 0.3, released: '2026-06-18', context: 2_000_000, modalities: ['text', 'image'], priceIn: 0.2, priceOut: 0.5 },
    ],
  },
  {
    lab: '腾讯混元',
    latest: 3.1e10,
    growth: 0.01,
    tokensPerVisitor: 1.5e7,
    models: [
      { model: 'Hunyuan-T2', share: 1, released: '2026-05-28', context: 256_000, modalities: ['text', 'image'], priceIn: 0.14, priceOut: 0.56 },
    ],
  },
  {
    lab: '小米',
    latest: 2.2e10,
    growth: 0.07,
    tokensPerVisitor: 1.4e7,
    models: [
      { model: 'MiMo-V3', share: 1, predecessor: 'MiMo-V2', released: '2026-08-12', context: 128_000, modalities: ['text', 'image', 'audio'], priceIn: 0.1, priceOut: 0.4 },
    ],
  },
  {
    lab: 'Mistral',
    latest: 1.5e10,
    growth: -0.01,
    tokensPerVisitor: 1.8e7,
    models: [
      { model: 'Mistral Large 3', share: 0.6, released: '2026-04-10', context: 256_000, modalities: ['text', 'image'], priceIn: 0.5, priceOut: 1.5 },
      { model: 'Codestral 3', share: 0.4, released: '2026-06-02', context: 256_000, modalities: ['text'], priceIn: 0.3, priceOut: 0.9 },
    ],
  },
  {
    lab: 'Meta',
    latest: 9e9,
    growth: -0.03,
    tokensPerVisitor: 1.6e7,
    models: [
      { model: 'Llama 5 Maverick', share: 1, released: '2026-04-29', context: 1_000_000, modalities: ['text', 'image'], priceIn: 0.2, priceOut: 0.6 },
    ],
  },
]

/** 生成确定性的示例数据集：14 家厂商、8 周。 */
export function createSampleDataset(): TownDataset {
  const rows: UsageRow[] = []
  const models: ModelInfo[] = []
  const weeks = Array.from({ length: SAMPLE_WEEKS }, (_, i) => addDays(SAMPLE_LATEST_WEEK, (i - SAMPLE_WEEKS + 1) * 7))

  for (const lab of SAMPLE_LABS) {
    const rng = createRng(`sample:${lab.lab}`)
    for (const model of lab.models) {
      models.push({
        lab: lab.lab,
        model: model.model,
        released: model.released,
        context: model.context,
        modalities: model.modalities,
        priceIn: model.priceIn,
        priceOut: model.priceOut,
      })
      weeks.forEach((week, index) => {
        const weeksBack = SAMPLE_WEEKS - 1 - index
        // 按增长率倒推往期并叠加 ±6% 波动；最新一周不加波动，保证示例排名稳定。
        const noise = weeksBack === 0 ? 1 : range(rng, 0.94, 1.06)
        const demand = lab.latest * model.share * (1 + lab.growth) ** -weeksBack * noise
        // 发布当周只卖出部分天数，其余天数（以及发布之前）的需求由旧版本承接。
        const sinceRelease = daysBetween(model.released, addDays(week, 6))
        const onShelf = Math.max(0, Math.min(1, (sinceRelease + 1) / 7))
        const push = (name: string, tokens: number) => {
          if (tokens <= 0) return
          const rounded = Math.round(tokens)
          const visitors = Math.max(1, Math.round((rounded / lab.tokensPerVisitor) * range(rng, 0.9, 1.1)))
          rows.push({ lab: lab.lab, model: name, week, tokens: rounded, visitors })
        }
        push(model.model, demand * onShelf)
        if (model.predecessor) push(model.predecessor, demand * (1 - onShelf) * (model.carryOver ?? 0.82))
      })
    }
  }

  return { source: 'sample', label: SAMPLE_LABEL, rows, models }
}

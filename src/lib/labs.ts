import { hashSeed } from '@/lib/rng'

/**
 * 厂商身份表：负责把导入数据里的厂商名或模型名归一到一间店。
 *
 * 颜色只用于店面招牌、雨棚和徽标，店名文字始终同时出现，身份不单靠颜色区分。
 * 厂商 Logo 见 lab-logos.ts（商标归各自所有者）；表外厂商没有 Logo 时回退为文字缩写。
 * 表内顺序就是小镇里店铺的固定排列顺序，与用量高低无关。
 */
export interface LabIdentity {
  id: string
  name: string
  color: string
  monogram: string
}

interface KnownLab extends LabIdentity {
  aliases: string[]
  modelPattern: RegExp
}

export const OTHER_LAB: LabIdentity = {
  id: 'other',
  name: '其他厂商',
  color: '#8a8f98',
  monogram: '…',
}

export const KNOWN_LABS: readonly KnownLab[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    color: '#10a37f',
    monogram: 'O',
    aliases: ['openai', 'open ai'],
    modelPattern: /^(gpt|chatgpt|o\d|codex|dall-e|whisper|sora|tts-|text-embedding)/i,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    color: '#d97757',
    monogram: 'A',
    aliases: ['anthropic', 'claude'],
    modelPattern: /claude/i,
  },
  {
    id: 'google',
    name: 'Google',
    color: '#4285f4',
    monogram: 'G',
    aliases: ['google', 'gemini', 'google deepmind', 'deepmind', '谷歌'],
    modelPattern: /gemini|gemma|imagen|veo-/i,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    color: '#4d6bfe',
    monogram: 'D',
    aliases: ['deepseek', '深度求索'],
    modelPattern: /deepseek/i,
  },
  {
    id: 'qwen',
    name: '通义千问',
    color: '#615ced',
    monogram: '千',
    aliases: ['qwen', 'alibaba', 'aliyun', '阿里', '阿里巴巴', '阿里云', '通义', '通义千问'],
    modelPattern: /qwen|qwq|tongyi/i,
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    color: '#56627e',
    monogram: 'K',
    aliases: ['kimi', 'moonshot', 'moonshot ai', '月之暗面'],
    modelPattern: /kimi|moonshot/i,
  },
  {
    id: 'zhipu',
    name: '智谱',
    color: '#0e9f9a',
    monogram: '智',
    aliases: ['zhipu', 'z.ai', 'zai', '智谱', '智谱ai', '智谱 ai'],
    modelPattern: /^(glm|chatglm|cogview|cogvideo)|zhipu/i,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    color: '#e8445a',
    monogram: 'MM',
    aliases: ['minimax', '稀宇'],
    modelPattern: /minimax|abab/i,
  },
  {
    id: 'bytedance',
    name: '豆包',
    color: '#7b61ff',
    monogram: '豆',
    aliases: ['bytedance', 'doubao', 'volcengine', '字节', '字节跳动', '豆包', '火山引擎'],
    modelPattern: /doubao|seed-|seedream|seedance/i,
  },
  {
    id: 'xai',
    name: 'xAI',
    color: '#6b7280',
    monogram: 'X',
    aliases: ['xai', 'x.ai', 'grok'],
    modelPattern: /grok/i,
  },
  {
    id: 'tencent',
    name: '腾讯混元',
    color: '#1e6fd9',
    monogram: '混',
    aliases: ['tencent', 'hunyuan', '腾讯', '混元', '腾讯混元'],
    modelPattern: /hunyuan/i,
  },
  {
    id: 'xiaomi',
    name: '小米',
    color: '#ff6900',
    monogram: '米',
    aliases: ['xiaomi', 'mimo', '小米'],
    modelPattern: /mimo/i,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    color: '#f2a900',
    monogram: 'M',
    aliases: ['mistral', 'mistral ai'],
    modelPattern: /mistral|mixtral|codestral|magistral|devstral|pixtral|ministral/i,
  },
  {
    id: 'meta',
    name: 'Meta',
    color: '#2d8cf0',
    monogram: 'Me',
    aliases: ['meta', 'llama', 'meta ai'],
    modelPattern: /llama/i,
  },
  {
    id: 'baidu',
    name: '文心',
    color: '#2932e1',
    monogram: '文',
    aliases: ['baidu', 'ernie', '百度', '文心', '文心一言'],
    modelPattern: /ernie|wenxin/i,
  },
]

// 导入了表外厂商时，按名称哈希从这组颜色里取一个，保证同名厂商每次颜色一致。
const FALLBACK_COLORS = ['#c0843d', '#3f8f5f', '#9a5bb5', '#c2553f', '#3b7ea1', '#7a8b2e', '#b0476f', '#4f6d8a']

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || `lab-${hashSeed(value).toString(36)}`
}

function publicIdentity(lab: KnownLab): LabIdentity {
  return { id: lab.id, name: lab.name, color: lab.color, monogram: lab.monogram }
}

/**
 * 解析一行数据所属的厂商。显式厂商名优先；为空时按模型名推断；
 * 都无法识别时归入「其他厂商」。
 */
export function resolveLab(labName: string | undefined, model: string): LabIdentity {
  const explicit = labName?.trim()
  if (explicit) {
    const key = normalizeKey(explicit)
    const known = KNOWN_LABS.find((lab) => lab.id === key || lab.aliases.includes(key))
    if (known) return publicIdentity(known)
    if (key === OTHER_LAB.id || explicit === OTHER_LAB.name) return OTHER_LAB
    const name = explicit.slice(0, 40)
    const id = slugify(name)
    return {
      id: id === OTHER_LAB.id ? `${id}-lab` : id,
      name,
      color: FALLBACK_COLORS[hashSeed(key) % FALLBACK_COLORS.length],
      monogram: Array.from(name)[0]?.toUpperCase() ?? '?',
    }
  }
  const inferred = KNOWN_LABS.find((lab) => lab.modelPattern.test(model.trim()))
  return inferred ? publicIdentity(inferred) : OTHER_LAB
}

const LAB_ORDER = new Map(KNOWN_LABS.map((lab, index) => [lab.id, index]))

/** 固定展示顺序：先按厂商表顺序，表外厂商按名称排在其后，“其他厂商”始终最后。 */
export function compareLabs(a: Pick<LabIdentity, 'id' | 'name'>, b: Pick<LabIdentity, 'id' | 'name'>): number {
  const order = (lab: Pick<LabIdentity, 'id'>) =>
    lab.id === OTHER_LAB.id ? Number.MAX_SAFE_INTEGER : (LAB_ORDER.get(lab.id) ?? KNOWN_LABS.length)
  return order(a) - order(b) || a.name.localeCompare(b.name, 'zh-Hans-CN')
}

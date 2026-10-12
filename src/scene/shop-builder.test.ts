import { describe, expect, it, vi } from 'vitest'
import { GeometryBucket } from '@/scene/geometry-bucket'
import { shopSlot } from '@/scene/layout'
import type { LabShop } from '@/lib/town-data'

// jsdom 没有 Canvas 2D：贴图换成只记录调用的替身
const textures = vi.hoisted(() => ({ plaques: [] as { weekTokens: number; disposed: boolean }[] }))
vi.mock('@/scene/textures', async () => {
  const { Texture } = await import('three')
  const make = () => new Texture()
  return {
    createSignTexture: make,
    createGraffitiTexture: make,
    createPlaqueTexture: (shop: { weekTokens: number }) => {
      const texture = new Texture()
      const record = { weekTokens: shop.weekTokens, disposed: false }
      textures.plaques.push(record)
      texture.dispose = () => {
        record.disposed = true
      }
      return texture
    },
    waitForFonts: async () => undefined,
  }
})

const { buildShop } = await import('@/scene/shop-builder')

function shop(weekTokens: number, id = 'openai'): LabShop {
  const model = { model: 'gpt-5', weekTokens, isNew: false }
  return {
    id,
    name: 'OpenAI',
    color: '#10a37f',
    monogram: 'O',
    featured: model,
    featuredBy: 'usage',
    models: [model],
    weekTokens,
    prevWeekTokens: null,
    change: null,
    history: [],
    visitors: null,
    queue: 8,
  }
}

describe('BuiltShop.refreshPlaque', () => {
  it('挂牌文字没变就不重画；变了换上新贴图并释放旧的', () => {
    const buckets = { solid: new GeometryBucket(), windows: new GeometryBucket(), glow: new GeometryBucket() }
    const built = buildShop(shop(7_650_000), 0, shopSlot(0), buckets, { anisotropy: 1 })
    expect(textures.plaques).toHaveLength(1)

    // 765 万 → 765 万（四舍五入后文字相同）
    built.refreshPlaque(shop(7_651_000))
    expect(textures.plaques).toHaveLength(1)

    built.refreshPlaque(shop(27_650_000))
    expect(textures.plaques).toHaveLength(2)
    expect(textures.plaques[0].disposed).toBe(true)
    expect(textures.plaques[1]).toMatchObject({ weekTokens: 27_650_000, disposed: false })

    built.dispose()
    expect(textures.plaques[1].disposed).toBe(true)
  })
})

describe('BuiltShop.smoke', () => {
  it('只有带烟囱的 Anthropic 店屋顶冒烟，烟挂在门店节点下', () => {
    const buckets = () => ({ solid: new GeometryBucket(), windows: new GeometryBucket(), glow: new GeometryBucket() })
    const anthropic = buildShop(shop(1_000_000, 'anthropic'), 0, shopSlot(0), buckets(), { anisotropy: 1 })
    expect(anthropic.smoke).not.toBeNull()
    expect(anthropic.root.children).toContain(anthropic.smoke!.mesh)
    expect(anthropic.smoke!.puffCount).toBeGreaterThan(0)
    // 出烟口在楼顶之上
    expect(anthropic.smoke!.mesh.position.y).toBeGreaterThan(anthropic.plan.height)

    const openai = buildShop(shop(1_000_000), 1, shopSlot(1), buckets(), { anisotropy: 1 })
    expect(openai.smoke).toBeNull()
    anthropic.dispose()
    openai.dispose()
  })
})

describe('BuiltShop.fountain', () => {
  it('只有屋顶趴着鲸鱼的 DeepSeek 店会喷水，喷泉挂在门店节点下', () => {
    const buckets = () => ({ solid: new GeometryBucket(), windows: new GeometryBucket(), glow: new GeometryBucket() })
    const deepseek = buildShop(shop(1_000_000, 'deepseek'), 0, shopSlot(0), buckets(), { anisotropy: 1 })
    expect(deepseek.fountain).not.toBeNull()
    expect(deepseek.root.children).toContain(deepseek.fountain!.group)
    expect(deepseek.fountain!.dropCount).toBeGreaterThan(0)
    // 出水孔在拱顶之上
    expect(deepseek.fountain!.group.position.y).toBeGreaterThan(deepseek.plan.height)

    const anthropic = buildShop(shop(1_000_000, 'anthropic'), 1, shopSlot(1), buckets(), { anisotropy: 1 })
    expect(anthropic.fountain).toBeNull()
    deepseek.dispose()
    anthropic.dispose()
  })
})

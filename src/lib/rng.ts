/** 可复现的伪随机数：同一种子每次生成同样的小镇和示例数据。 */
export type Rng = () => number

export function hashSeed(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32：周期足够长、足够快，只用于视觉与示例数据，不用于任何安全场景。 */
export function createRng(seed: number | string): Rng {
  let state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

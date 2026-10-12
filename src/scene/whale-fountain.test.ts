import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { WhaleFountain } from '@/scene/whale-fountain'

const matrix = new Matrix4()
const position = new Vector3()
const axis = new Vector3()

/**
 * 读出每颗水珠在出水孔局部坐标里的位置和大小；大小为 0 表示这一格空着。
 * 不用 decompose：零缩放矩阵分解出来的缩放是 1。
 */
function drops(fountain: WhaleFountain) {
  return Array.from({ length: fountain.drops.count }, (_, i) => {
    fountain.drops.getMatrixAt(i, matrix)
    position.setFromMatrixPosition(matrix)
    return { x: position.x, y: position.y, z: position.z, size: axis.setFromMatrixColumn(matrix, 0).length() }
  })
}

/** 以 30 帧/秒推进 seconds 秒。 */
function run(fountain: WhaleFountain, seconds: number, onFrame?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    fountain.update(1 / 30)
    onFrame?.()
  }
}

describe('WhaleFountain', () => {
  it('建好时就在喷水：水柱立在出水孔上，水珠向四周溅开', () => {
    const fountain = new WhaleFountain(new Vector3(3, 12, -5), 'fountain:test')
    expect(fountain.group.position.toArray()).toEqual([3, 12, -5])
    expect(fountain.jetHeight).toBeGreaterThan(0.6)
    expect(fountain.dropCount).toBeGreaterThan(5)
    const alive = drops(fountain).filter((d) => d.size > 0)
    const reach = Math.max(...alive.map((d) => Math.hypot(d.x, d.z)))
    expect(reach).toBeGreaterThan(0.3)
    fountain.dispose()
  })

  it('水柱平时轻轻起伏，每隔几秒猛喷一次', () => {
    const fountain = new WhaleFountain(new Vector3(), 'fountain:burst')
    const heights: number[] = []
    run(fountain, 30, () => heights.push(fountain.jetHeight))
    const low = Math.min(...heights)
    const high = Math.max(...heights)
    expect(high - low).toBeGreaterThan(0.4)
    // 越过高低中点算一次猛喷，回落到中点以下才重新计数
    const mid = (low + high) / 2
    let bursts = 0
    let armed = heights[0] < mid
    for (const h of heights) {
      if (armed && h > mid) {
        bursts += 1
        armed = false
      } else if (h < mid - 0.1) armed = true
    }
    expect(bursts).toBeGreaterThanOrEqual(4)
    expect(bursts).toBeLessThanOrEqual(10)
    fountain.dispose()
  })

  it('水珠先冲高再落下，落回鲸背就消失，不会一直攒着', () => {
    const fountain = new WhaleFountain(new Vector3(), 'fountain:arc')
    let rising = 0
    let falling = 0
    let lowest = 0
    let most = 0
    let previous = drops(fountain)
    run(fountain, 20, () => {
      most = Math.max(most, fountain.dropCount)
      const current = drops(fountain)
      current.forEach((d, i) => {
        if (d.size === 0) return
        lowest = Math.min(lowest, d.y)
        const before = previous[i]
        if (before.size === 0) return
        if (d.y > before.y) rising += 1
        else falling += 1
      })
      previous = current
    })
    expect(rising).toBeGreaterThan(200)
    expect(falling).toBeGreaterThan(rising)
    // 落到出水孔以下一点就消失
    expect(lowest).toBeLessThan(0)
    expect(lowest).toBeGreaterThan(-0.5)
    expect(most).toBeLessThan(fountain.drops.count)
    fountain.dispose()
  })

  it('dt 为 0 时不推进（减少动态效果时停在喷水的那一刻）', () => {
    const fountain = new WhaleFountain(new Vector3(), 'fountain:still')
    const before = { height: fountain.jetHeight, drops: drops(fountain) }
    fountain.update(0)
    expect({ height: fountain.jetHeight, drops: drops(fountain) }).toEqual(before)
    fountain.dispose()
  })
})

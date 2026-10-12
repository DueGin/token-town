import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ChimneySmoke } from '@/scene/chimney-smoke'

const matrix = new Matrix4()
const position = new Vector3()
const axis = new Vector3()

/**
 * 读出每团烟在烟囱局部坐标里的位置和大小；大小为 0 表示这一格空着。
 * 不用 decompose：零缩放矩阵分解出来的缩放是 1。
 */
function puffs(smoke: ChimneySmoke) {
  return Array.from({ length: smoke.mesh.count }, (_, i) => {
    smoke.mesh.getMatrixAt(i, matrix)
    position.setFromMatrixPosition(matrix)
    return { x: position.x, y: position.y, size: axis.setFromMatrixColumn(matrix, 0).length() }
  })
}

/** 以 30 帧/秒推进 seconds 秒。 */
function run(smoke: ChimneySmoke, seconds: number, onFrame?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    smoke.update(1 / 30)
    onFrame?.()
  }
}

describe('ChimneySmoke', () => {
  it('建好时就已经有一整缕烟，烟团从出烟口升起并被风吹偏', () => {
    const smoke = new ChimneySmoke(new Vector3(4, 9, -2), 'smoke:test')
    expect(smoke.mesh.position.toArray()).toEqual([4, 9, -2])
    expect(smoke.puffCount).toBeGreaterThanOrEqual(4)
    expect(smoke.plumeHeight).toBeGreaterThan(2.5)
    const alive = puffs(smoke).filter((p) => p.size > 0)
    expect(alive.every((p) => p.y >= 0)).toBe(true)
    // 越高的烟团离烟囱越远（顺风方向 +x）
    const sorted = [...alive].sort((a, b) => a.y - b.y)
    expect(sorted.at(-1)!.x).toBeGreaterThan(sorted[0].x)
    smoke.dispose()
  })

  it('烟团会动：持续上升，散尽后由新的一团接上，数量保持平稳', () => {
    const smoke = new ChimneySmoke(new Vector3(), 'smoke:loop')
    let min = Infinity
    let max = 0
    let rising = 0
    let sinking = 0
    let born = 0
    let previous = puffs(smoke)
    run(smoke, 30, () => {
      min = Math.min(min, smoke.puffCount)
      max = Math.max(max, smoke.puffCount)
      const current = puffs(smoke)
      current.forEach((p, i) => {
        const before = previous[i]
        if (p.size > 0 && before.size === 0) born += 1
        if (!(p.size > 0 && before.size > 0)) return
        if (p.y > before.y) rising += 1
        else sinking += 1
      })
      previous = current
    })
    expect(min).toBeGreaterThanOrEqual(4)
    expect(max).toBeLessThan(smoke.mesh.count)
    expect(rising).toBeGreaterThan(1000)
    // 还在飘的烟团不会往下掉，也不会被新的一团顶替
    expect(sinking).toBe(0)
    // 30 秒里大约每秒冒出一团
    expect(born).toBeGreaterThan(20)
    expect(born).toBeLessThan(40)
    smoke.dispose()
  })

  it('dt 为 0 时不推进（减少动态效果时整缕烟停在原处）', () => {
    const smoke = new ChimneySmoke(new Vector3(), 'smoke:still')
    const before = puffs(smoke)
    smoke.update(0)
    expect(puffs(smoke)).toEqual(before)
    smoke.dispose()
  })
})

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ObservatoryDome } from '@/scene/observatory-dome'

describe('ObservatoryDome', () => {
  it('穹顶来回转动，望远镜慢慢俯仰', () => {
    const dome = new ObservatoryDome(new Vector3(1, 10, 2), '#c9d0de', '#3b6ff5', 'dome:test')
    expect(dome.group.position.toArray()).toEqual([1, 10, 2])
    const turn: number[] = []
    const tilt: number[] = []
    for (let t = 0; t < 20; t += 1 / 30) {
      dome.update(1 / 30)
      turn.push(dome.turret.rotation.y)
      tilt.push(dome.telescope.rotation.x)
    }
    expect(Math.max(...turn) - Math.min(...turn)).toBeGreaterThan(1)
    expect(Math.max(...tilt) - Math.min(...tilt)).toBeGreaterThan(0.3)
    dome.dispose()
  })

  it('dt 为 0 时不动', () => {
    const dome = new ObservatoryDome(new Vector3(), '#fff', '#000', 'dome:still')
    const before = dome.turret.rotation.y
    dome.update(0)
    expect(dome.turret.rotation.y).toBe(before)
    dome.dispose()
  })
})

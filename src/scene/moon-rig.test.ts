import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MoonRig } from '@/scene/moon-rig'

/** 以 30 帧/秒推进 seconds 秒。 */
function run(moon: MoonRig, seconds: number, onFrame?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    moon.update(1 / 30)
    onFrame?.()
  }
}

describe('MoonRig', () => {
  it('挂在灯杆底部的位置，新月在杆顶之上', () => {
    const moon = new MoonRig(new Vector3(3, 12, -5), 'moon:test')
    expect(moon.group.position.toArray()).toEqual([3, 12, -5])
    expect(moon.pivot.position.y).toBeGreaterThan(2)
    expect(moon.stars).toHaveLength(5)
    moon.dispose()
  })

  it('新月左右摇摆，星星忽明忽暗', () => {
    const moon = new MoonRig(new Vector3(), 'moon:sway')
    const sway: number[] = []
    const star: number[] = []
    run(moon, 10, () => {
      sway.push(moon.pivot.rotation.z)
      star.push(moon.stars[0].scale.x)
    })
    expect(Math.max(...sway) - Math.min(...sway)).toBeGreaterThan(0.4)
    expect(Math.max(...star) - Math.min(...star)).toBeGreaterThan(0.05)
    moon.dispose()
  })

  it('每隔几秒划过一颗流星，划完就消失', () => {
    const moon = new MoonRig(new Vector3(), 'moon:meteor')
    let shows = 0
    let was = moon.meteorVisible
    run(moon, 30, () => {
      if (moon.meteorVisible && !was) shows += 1
      was = moon.meteorVisible
    })
    expect(shows).toBeGreaterThanOrEqual(5)
    expect(shows).toBeLessThanOrEqual(11)
    moon.dispose()
  })

  it('dt 为 0 时不动', () => {
    const moon = new MoonRig(new Vector3(), 'moon:still')
    const before = moon.pivot.rotation.z
    moon.update(0)
    expect(moon.pivot.rotation.z).toBe(before)
    moon.dispose()
  })
})

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ASCENT_HEIGHT, RocketRig, type RocketPhase } from '@/scene/rocket'

/** 以 30 帧/秒推进 seconds 秒，记录经过的阶段和每一帧的状态。 */
function run(rig: RocketRig, seconds: number, onFrame?: () => void) {
  const phases: RocketPhase[] = []
  for (let t = 0; t < seconds; t += 1 / 30) {
    rig.update(1 / 30)
    if (phases.at(-1) !== rig.phase) phases.push(rig.phase)
    onFrame?.()
  }
  return phases
}

describe('RocketRig', () => {
  it('建好后很快就发射：点火、升空飞出画面，再减速落回发射台', () => {
    const rig = new RocketRig(new Vector3(10, 8, -4), 'rocket:test')
    expect(rig.group.position.toArray()).toEqual([10, 8, -4])
    let highest = 0
    let lowestWhileLanding = Infinity
    let smokeSeen = 0
    const phases = run(rig, 40, () => {
      if (rig.phase === 'ascent') highest = Math.max(highest, rig.altitude)
      if (rig.phase === 'landing') lowestWhileLanding = Math.min(lowestWhileLanding, rig.altitude)
      if (rig.phase === 'ignition' || rig.phase === 'ascent') smokeSeen = Math.max(smokeSeen, rig.smokeCount)
      if (rig.phase === 'away') expect(rig.flying).toBe(false)
      if (rig.phase === 'ignition' || rig.phase === 'ascent' || rig.phase === 'landing') expect(rig.firing).toBe(true)
    })
    expect(phases.slice(0, 6)).toEqual(['idle', 'ignition', 'ascent', 'away', 'landing', 'idle'])
    expect(highest).toBeGreaterThan(ASCENT_HEIGHT * 0.9)
    expect(lowestWhileLanding).toBeLessThan(0.1)
    expect(smokeSeen).toBeGreaterThan(20)
    // 落稳后熄火、立在台面上，烟慢慢散尽
    expect(rig.phase).toBe('idle')
    expect(rig.altitude).toBe(0)
    expect(rig.flying).toBe(true)
    expect(rig.firing).toBe(false)
    expect(rig.smokeCount).toBe(0)
    rig.dispose()
  })

  it('两次发射之间会在台上待一阵，不会连着发', () => {
    const rig = new RocketRig(new Vector3(), 'rocket:gap')
    let launches = 0
    let last: RocketPhase = rig.phase
    run(rig, 120, () => {
      if (rig.phase === 'ignition' && last !== 'ignition') launches += 1
      last = rig.phase
    })
    expect(launches).toBeGreaterThanOrEqual(2)
    expect(launches).toBeLessThanOrEqual(4)
    rig.dispose()
  })

  it('reset 让飞到一半的火箭回到台上、熄火并清掉烟', () => {
    const rig = new RocketRig(new Vector3(), 'rocket:reset')
    run(rig, 20)
    rig.reset()
    expect(rig.phase).toBe('idle')
    expect(rig.altitude).toBe(0)
    expect(rig.flying).toBe(true)
    expect(rig.firing).toBe(false)
    expect(rig.smokeCount).toBe(0)
    rig.dispose()
  })
})

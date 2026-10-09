import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { townLayout } from '@/scene/layout'
import { CLEAR_SPAN, createLanes, stepLane, type Lane } from '@/scene/street'
import { pickVehicle, VEHICLES, vehicleBodyGeometry, vehicleLightGeometry } from '@/scene/vehicles'
import { TrafficSignal } from '@/scene/walk-network'

const hidden = () => false

/** 与 Traffic.update 相同的推进方式：信号灯走一步，各车道按本轴绿灯剩余时间行驶。 */
function simulate(lanes: Lane[], seconds: number, onFrame: (signal: TrafficSignal) => void, dt = 1 / 30) {
  const signal = new TrafficSignal()
  for (let t = 0; t < seconds; t += dt) {
    signal.update(dt)
    const green = signal.green()
    for (const lane of lanes) stepLane(lane, dt, green === lane.axis ? signal.remaining() : 0, hidden)
    onFrame(signal)
  }
}

describe('车型', () => {
  it('每种车型都能生成几何，车身长度与跟车用的长度一致', () => {
    for (const spec of VEHICLES) {
      const body = vehicleBodyGeometry(spec)
      body.computeBoundingBox()
      const box = body.boundingBox!
      expect(box.max.x - box.min.x).toBeCloseTo(spec.length, 1)
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01)
      expect(vehicleLightGeometry(spec).getAttribute('position').count).toBeGreaterThan(0)
    }
  })

  it('按权重抽到各种车型', () => {
    const rng = createRng('kinds')
    const seen = new Map<string, number>()
    for (let i = 0; i < 2000; i += 1) {
      const kind = pickVehicle(rng).kind
      seen.set(kind, (seen.get(kind) ?? 0) + 1)
    }
    expect(seen.size).toBe(VEHICLES.length)
    expect(seen.get('sedan')!).toBeGreaterThan(seen.get('bus')!)
  })

  it('小镇路上开着多种车，包括公交车', () => {
    const lanes = createLanes(townLayout(14), createRng('traffic:test'))
    const kinds = new Set(lanes.flatMap((lane) => lane.cars.map((car) => car.spec.kind)))
    expect(kinds.size).toBeGreaterThanOrEqual(6)
    expect(kinds.has('bus')).toBe(true)
  })
})

describe('车流', () => {
  it('按各自车长跟车，长短车混行也不会追尾', () => {
    const lanes = createLanes(townLayout(14), createRng('traffic:gap'))
    let closest = Infinity
    simulate(lanes, 120, () => {
      for (const lane of lanes) {
        for (let i = 0; i + 1 < lane.cars.length; i += 1) {
          const car = lane.cars[i]
          const leader = lane.cars[i + 1]
          closest = Math.min(closest, leader.s - leader.spec.length / 2 - (car.s + car.spec.length / 2))
        }
      }
    })
    expect(closest).toBeGreaterThan(0.5)
  })

  it('对向放行时，路口和人行横道上没有本方向的车身，公交车也会提前停下', () => {
    const lanes = createLanes(townLayout(14), createRng('traffic:box'))
    let checks = 0
    let inBox = 0
    let longStops = 0
    simulate(lanes, 240, (signal) => {
      const green = signal.green()
      for (const lane of lanes) {
        for (const car of lane.cars) {
          const half = car.spec.length / 2
          for (const line of lane.stops) {
            if (car.spec.kind === 'bus' && green !== lane.axis && Math.abs(car.s + half - (line - 0.3)) < 0.2 && car.speed < 0.1) longStops += 1
            if (green === null || green === lane.axis) continue
            checks += 1
            // 车身与“停车线之后到对面人行横道外沿”这一段不能有重叠
            if (car.s + half > line + 0.3 && car.s - half < line + CLEAR_SPAN - 0.3) inBox += 1
          }
        }
      }
    })
    expect(checks).toBeGreaterThan(0)
    expect(inBox).toBe(0)
    expect(longStops).toBeGreaterThan(0)
  })
})

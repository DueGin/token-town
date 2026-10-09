import { describe, expect, it } from 'vitest'
import { KNOWN_LABS } from '@/lib/labs'
import { LOT_D, LOT_W, WALK_INSET } from '@/scene/layout'
import { hasLabStyle, labStyle } from '@/scene/lab-styles'
import { FLOOR_H, GROUND_H, LANE_LENGTH, lanesForQueue, planShop, Polyline, queueLayout } from '@/scene/shop-layout'

const IDS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'lab-9', 'other']

describe('labStyle', () => {
  it('厂商表里每家都有专属风格，屋顶装饰互不重复', () => {
    const ornaments = KNOWN_LABS.map((lab) => labStyle(lab.id).ornament)
    for (const lab of KNOWN_LABS) expect(hasLabStyle(lab.id)).toBe(true)
    expect(new Set(ornaments).size).toBe(KNOWN_LABS.length)
  })

  it('表外厂商按 id 稳定生成，并使用传入的品牌色', () => {
    const style = labStyle('acme', '#123456')
    expect(labStyle('acme', '#123456')).toEqual(style)
    expect(style.accent).toBe('#123456')
    expect(hasLabStyle('acme')).toBe(false)
  })
})

describe('planShop', () => {
  it('同一厂商每次生成相同的平面，楼高由风格里的楼层数决定', () => {
    const a = planShop({ id: 'openai' })
    expect(planShop({ id: 'openai' })).toEqual(a)
    expect(a.upperFloors).toBe(labStyle('openai').upperFloors)
    expect(a.height).toBeCloseTo(GROUND_H + a.upperFloors * FLOOR_H)
  })

  it('建筑在地块内，门开在正立面右侧，挂牌在门右边的墙上', () => {
    for (const id of IDS) {
      const plan = planShop({ id })
      const right = plan.bx + plan.width / 2
      expect(Math.abs(plan.bx) + plan.width / 2).toBeLessThan(LOT_W / 2)
      expect(plan.back).toBeGreaterThan(-LOT_D)
      expect(plan.doorX).toBeGreaterThan(plan.bx)
      expect(plan.plaqueX - 0.55).toBeGreaterThan(plan.doorX + plan.doorW / 2)
      expect(plan.plaqueX + 0.55).toBeLessThan(right)
    }
  })
})

describe('lanesForQueue', () => {
  it('人越多折返的队道越多，最多 3 条', () => {
    expect(lanesForQueue(0)).toBe(1)
    expect(lanesForQueue(8)).toBe(1)
    expect(lanesForQueue(16)).toBe(2)
    expect(lanesForQueue(24)).toBe(3)
    expect(lanesForQueue(200)).toBe(3)
  })
})

describe('queueLayout', () => {
  it('入队和出店路线都从店内出发，终点在人行道步行线上', () => {
    for (const id of IDS) {
      const plan = planShop({ id })
      const layout = queueLayout(plan, 24)
      for (const route of [layout.path, layout.exit]) {
        expect(route[0].z).toBeLessThan(plan.front)
        expect(route[route.length - 1].z).toBe(WALK_INSET)
      }
      expect(layout.path[layout.path.length - 1].x).toBe(layout.joinX)
      expect(layout.exit[layout.exit.length - 1].x).toBe(layout.exitX)
    }
  })

  it('队道在门左侧，出口在门右侧，两条路线不交叉', () => {
    for (const id of IDS) {
      const plan = planShop({ id })
      for (const queue of [1, 12, 24]) {
        const layout = queueLayout(plan, queue)
        expect(layout.laneStartX).toBeLessThan(plan.doorX)
        expect(layout.laneEndX).toBeLessThan(layout.laneStartX)
        expect(layout.exitX).toBeGreaterThan(plan.doorX)
        const lanePoints = layout.path.slice(2)
        const exitPoints = layout.exit.slice(2)
        const laneMax = Math.max(...lanePoints.map((p) => p.x))
        const exitMin = Math.min(...exitPoints.map((p) => p.x))
        expect(exitMin - laneMax).toBeGreaterThan(1.2)
      }
    }
  })

  it('所有路线点都在地块内或临街人行道上', () => {
    for (const id of IDS) {
      for (const queue of [0, 1, 11, 12, 24]) {
        const layout = queueLayout(planShop({ id }), queue)
        for (const point of [...layout.path, ...layout.exit]) {
          expect(Math.abs(point.x)).toBeLessThanOrEqual(LOT_W / 2)
          expect(point.z).toBeLessThanOrEqual(WALK_INSET)
          expect(point.z).toBeGreaterThan(-LOT_D)
        }
      }
    }
  })

  it('满员 24 人时每个站位都落在队道里，不会排到人行道上', () => {
    for (const id of IDS) {
      const plan = planShop({ id })
      const layout = queueLayout(plan, 24)
      const path = new Polyline(layout.path)
      // 最后一条队道的终点是倒数第三个点，之后是地块边线和人行道
      const laneEndS = path.cumulative[path.points.length - 3]
      for (let i = 0; i < 24; i += 1) {
        const s = layout.headS + i * layout.spacing
        expect(s).toBeLessThanOrEqual(laneEndS + 1e-6)
        const p = path.pointAt(s)
        expect(p.x).toBeGreaterThanOrEqual(layout.laneEndX - 1e-6)
        expect(p.x).toBeLessThanOrEqual(layout.laneStartX + 1e-6)
      }
      expect(layout.laneStartX - layout.laneEndX).toBe(LANE_LENGTH)
      expect(layout.headS).toBeGreaterThan(layout.doorS)
    }
  })

  it('队道条数为奇数时从最左端入队，偶数时从门口一侧入队', () => {
    const plan = planShop({ id: 'google' })
    expect(queueLayout(plan, 5).joinX).toBe(queueLayout(plan, 5).laneEndX)
    expect(queueLayout(plan, 16).joinX).toBe(queueLayout(plan, 16).laneStartX)
  })
})

describe('Polyline', () => {
  const line = new Polyline([
    { x: 0, z: 0 },
    { x: 0, z: 4 },
    { x: 3, z: 4 },
  ])

  it('按距离取点并在两端截断', () => {
    expect(line.length).toBe(7)
    expect(line.pointAt(2)).toEqual({ x: 0, z: 2 })
    expect(line.pointAt(5.5)).toEqual({ x: 1.5, z: 4 })
    expect(line.pointAt(-3)).toEqual({ x: 0, z: 0 })
    expect(line.pointAt(99)).toEqual({ x: 3, z: 4 })
  })

  it('朝向指回路线起点（队首方向）', () => {
    const onFirst = line.headingAt(2)
    expect(Math.sin(onFirst)).toBeCloseTo(0)
    expect(Math.cos(onFirst)).toBeCloseTo(-1)
    const onSecond = line.headingAt(6)
    expect(Math.sin(onSecond)).toBeCloseTo(-1)
    expect(Math.cos(onSecond)).toBeCloseTo(0)
  })

  it('复用传入的输出对象', () => {
    const out = { x: 9, z: 9 }
    expect(line.pointAt(1, out)).toBe(out)
    expect(out).toEqual({ x: 0, z: 1 })
  })
})

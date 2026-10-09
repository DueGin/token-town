import { describe, expect, it } from 'vitest'
import { shopSlot, townLayout } from '@/scene/layout'
import { Crowd, crowdStops, type CrowdShop } from '@/scene/people'
import { planShop, Polyline, queueLayout } from '@/scene/shop-layout'
import type { Visibility } from '@/scene/street'
import { buildWalkNetwork, TrafficSignal } from '@/scene/walk-network'

const IDS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'mistral']

function makeShops(queueSize = 10): CrowdShop[] {
  return IDS.map((id, index) => {
    const slot = shopSlot(index)
    const plan = planShop({ id })
    const queue = queueLayout(plan, queueSize)
    const toWorld = (points: { x: number; z: number }[]) => points.map((p) => ({ x: p.x + slot.x, z: p.z + slot.z }))
    return {
      id,
      row: slot.row,
      col: slot.col,
      plan,
      queue,
      queueSize,
      queuePath: new Polyline(toWorld(queue.path)),
      exitPath: new Polyline(toWorld(queue.exit)),
      joinX: slot.x + queue.joinX,
      exitX: slot.x + queue.exitX,
    }
  })
}

function setup(seed = 'test', doorSpeed?: number) {
  const shops = makeShops()
  const { network, stopNodes } = buildWalkNetwork(townLayout(shops.length), crowdStops(shops))
  const signal = new TrafficSignal()
  const crowd = new Crowd({ shops, network, stopNodes, signal, seed, doorSpeed })
  /** 按 dt 推进 seconds 秒；信号灯由车流推进，这里代替它。 */
  const run = (seconds: number, visible: Visibility, onFrame?: () => void, dt = 1 / 20) => {
    for (let t = 0; t < seconds; t += dt) {
      signal.update(dt)
      crowd.update(dt, visible)
      onFrame?.()
    }
  }
  return { shops, crowd, signal, run }
}

const nothingVisible: Visibility = () => false
const everythingVisible: Visibility = () => true

/** 逐帧调用 frame，统计每家店有几位顾客进了店。 */
function serveCounter(crowd: Crowd) {
  const served = new Map<string, number>()
  const wasInside = new Set<string>()
  const frame = () => {
    const insideNow = new Set(crowd.members().flatMap((m) => (m.mode === 'inside' && m.shopId ? [m.shopId] : [])))
    for (const id of insideNow) if (!wasInside.has(id)) served.set(id, (served.get(id) ?? 0) + 1)
    wasInside.clear()
    insideNow.forEach((id) => wasInside.add(id))
  }
  const total = () => [...served.values()].reduce((sum, n) => sum + n, 0)
  return { served, frame, total }
}

describe('Crowd', () => {
  it('开场每家店的队伍按用量排满', () => {
    const { shops, crowd } = setup()
    for (const shop of shops) expect(crowd.shopStatus(shop.id)).toMatchObject({ target: 10, queued: 10 })
    expect(crowd.members().filter((m) => m.mode === 'walk').length).toBeGreaterThan(20)
  })

  it('整座小镇都在画面里时，不会凭空刷出新行人', () => {
    const { crowd, run } = setup()
    const initial = crowd.members().length
    let most = initial
    run(40, everythingVisible, () => {
      most = Math.max(most, crowd.members().length)
    })
    expect(most).toBe(initial)
  })

  it('每家店一次只进一位，出来之后下一位才进，队伍会从远处补人', () => {
    const { shops, crowd, run } = setup()
    const served = new Map<string, number>()
    const wasInside = new Set<string>()
    let exits = 0
    run(60, nothingVisible, () => {
      const members = crowd.members()
      for (const shop of shops) {
        const busy = members.filter((m) => m.shopId === shop.id && (m.mode === 'enter' || m.mode === 'inside'))
        expect(busy.length).toBeLessThanOrEqual(1)
        const inside = busy.some((m) => m.mode === 'inside')
        if (inside && !wasInside.has(shop.id)) served.set(shop.id, (served.get(shop.id) ?? 0) + 1)
        if (inside) wasInside.add(shop.id)
        else wasInside.delete(shop.id)
      }
      exits = Math.max(exits, members.filter((m) => m.mode === 'exit').length)
    })
    expect(exits).toBeGreaterThan(0)
    for (const shop of shops) {
      // 一分钟里每家店都接待了好几位，节奏够快
      expect(served.get(shop.id) ?? 0).toBeGreaterThanOrEqual(6)
      const status = crowd.shopStatus(shop.id)!
      expect(status.queued + status.inbound).toBeGreaterThanOrEqual(status.target - 2)
    }
  })

  it('进出速度调快 3 倍，接待人数也接近 3 倍，队伍照样能从远处补上人', () => {
    const normal = setup('door')
    const normalCount = serveCounter(normal.crowd)
    normal.run(60, nothingVisible, normalCount.frame)

    const fast = setup('door', 3)
    const fastCount = serveCounter(fast.crowd)
    fast.run(60, nothingVisible, () => {
      fastCount.frame()
      for (const shop of fast.shops) {
        const busy = fast.crowd.members().filter((m) => m.shopId === shop.id && (m.mode === 'enter' || m.mode === 'inside'))
        expect(busy.length).toBeLessThanOrEqual(1)
      }
    })
    const ratio = fastCount.total() / normalCount.total()
    expect(ratio).toBeGreaterThan(2.5)
    expect(ratio).toBeLessThan(3.5)
    for (const shop of fast.shops) {
      const status = fast.crowd.shopStatus(shop.id)!
      expect(status.queued + status.inbound).toBeGreaterThanOrEqual(status.target - 2)
    }
  })

  it('进出速度可以在运行中调整', () => {
    const { crowd, run } = setup('door-live')
    run(10, nothingVisible)
    const before = serveCounter(crowd)
    run(30, nothingVisible, before.frame)
    crowd.setDoorSpeed(3)
    const after = serveCounter(crowd)
    run(30, nothingVisible, after.frame)
    expect(after.total()).toBeGreaterThan(before.total() * 2)
  })

  it('排队、赶路、等红灯的人不会叠在一起', () => {
    const { crowd, run } = setup('apart', 3)
    run(15, nothingVisible)
    let frames = 0
    let close = 0
    let queueClose = 0
    run(45, nothingVisible, () => {
      frames += 1
      const shown = crowd.members().filter((m) => m.mode !== 'inside')
      for (let i = 0; i < shown.length; i += 1) {
        for (let j = i + 1; j < shown.length; j += 1) {
          const a = shown[i]
          const b = shown[j]
          if (Math.hypot(a.x - b.x, a.z - b.z) >= 0.25) continue
          close += 1
          if (a.mode === 'queue' && b.mode === 'queue') queueClose += 1
        }
      }
    })
    expect(queueClose).toBe(0)
    // 不避让时约每帧 50 对；路口转角偶尔还会擦肩，允许极少量
    expect(close / frames).toBeLessThan(1.5)
  })

  it('实时数据更新时调整排队目标，人群不重建，队伍逐渐跟上', () => {
    const { shops, crowd, run } = setup('target')
    const id = shops[0].id
    crowd.setQueueTarget(id, 4)
    expect(crowd.shopStatus(id)).toMatchObject({ target: 4 })
    run(40, nothingVisible)
    expect(crowd.shopStatus(id)!.queued).toBeLessThanOrEqual(6)
    crowd.setQueueTarget(id, 16)
    run(90, nothingVisible)
    expect(crowd.shopStatus(id)!.queued + crowd.shopStatus(id)!.inbound).toBeGreaterThanOrEqual(14)
    // 超出队道容量（一条队道约 11 人）的部分截掉
    crowd.setQueueTarget(id, 999)
    expect(crowd.shopStatus(id)!.target).toBeLessThanOrEqual(24)
  })

  it('过马路只在自己方向的绿灯（或清场的全红）里', () => {
    const { crowd, signal, run } = setup('crossing')
    let crossings = 0
    run(90, nothingVisible, () => {
      const green = signal.green()
      for (const member of crowd.members()) {
        if (!member.road) continue
        crossings += 1
        expect(green === null || green === member.road).toBe(true)
      }
    })
    expect(crossings).toBeGreaterThan(0)
  })

  it('同一种子得到相同的人群', () => {
    const a = setup('same')
    const b = setup('same')
    a.run(5, nothingVisible)
    b.run(5, nothingVisible)
    expect(a.crowd.members()).toEqual(b.crowd.members())
  })
})

import { createRng, range } from '@/lib/rng'
import { PLAZA_D, WALK_INSET } from '@/scene/layout'
import { labStyle, type LabStyle, type RoofKind } from '@/scene/lab-styles'

/**
 * 店铺平面规划（纯数据，不依赖 three.js，便于测试）。
 * 坐标均为地块局部坐标：x 向右，z 朝街道为正，建筑正立面位于 z = -PLAZA_D，
 * 地块正面边线在 z = 0，人行道步行线在 z = WALK_INSET。
 *
 * 所有店门都开在正立面右侧，门右边的墙上挂门牌；队伍在门左侧的前院蛇形排开，
 * 出店的人从门口往右拐，走另一条路回到人行道，进出互不交叉。
 */
export interface Point2 {
  x: number
  z: number
}

export interface ShopPlan {
  /** 建筑中心 x。 */
  bx: number
  width: number
  depth: number
  front: number
  back: number
  /** 首层（店面层）高度。 */
  groundH: number
  upperFloors: number
  floorH: number
  height: number
  roof: RoofKind
  style: LabStyle
  doorX: number
  doorW: number
  /** 门右侧挂牌的中心 x。 */
  plaqueX: number
}

export interface QueueLayout {
  lanes: number
  /** 入队路线：店内 → 门口 → 蛇形队道 → 入队口 → 人行道步行线。队伍面朝路线起点。 */
  path: Point2[]
  /** 出店路线：店内 → 门口 → 门右侧 → 人行道步行线。 */
  exit: Point2[]
  /** 门槛到路线起点的距离；走过门槛就算进店或出店。 */
  doorS: number
  /** 队首站位到路线起点的距离。 */
  headS: number
  spacing: number
  laneZ: number[]
  laneStartX: number
  laneEndX: number
  /** 队伍在人行道上的入口 x（入队路线终点）。 */
  joinX: number
  /** 出店路线在人行道上的终点 x。 */
  exitX: number
}

export const GROUND_H = 4.4
export const FLOOR_H = 3.2
export const DOOR_W = 1.6
export const QUEUE_SPACING = 0.9
export const LANE_LENGTH = 9
/** 各条队道离正立面的距离，第一条最靠店。 */
const LANE_OFFSETS = [1.3, 2.7, 4.1]
const SLOTS_PER_LANE = Math.floor(LANE_LENGTH / QUEUE_SPACING) + 1
/** 地块边线内侧一点：先走到这里再上人行道。 */
const LOT_EDGE_Z = -0.4

export function planShop(shop: { id: string; color?: string }): ShopPlan {
  const style = labStyle(shop.id, shop.color)
  const rng = createRng(`shop:${shop.id}`)
  const width = Math.round(range(rng, 13.2, 14.6) * 10) / 10
  const depth = Math.round(range(rng, 10, 11.6) * 10) / 10
  const bx = Math.round(range(rng, -0.6, 0.6) * 10) / 10
  const front = -PLAZA_D
  const doorX = bx + width / 2 - 2.8
  return {
    bx,
    width,
    depth,
    front,
    back: front - depth,
    groundH: GROUND_H,
    upperFloors: style.upperFloors,
    floorH: FLOOR_H,
    height: GROUND_H + style.upperFloors * FLOOR_H,
    roof: style.roof,
    style,
    doorX,
    doorW: DOOR_W,
    plaqueX: doorX + DOOR_W / 2 + 0.85,
  }
}

export function lanesForQueue(queue: number): number {
  return Math.max(1, Math.min(LANE_OFFSETS.length, Math.ceil(queue / SLOTS_PER_LANE)))
}

export function queueLayout(plan: ShopPlan, queue: number): QueueLayout {
  const lanes = lanesForQueue(queue)
  const startX = plan.doorX - 0.8
  const endX = startX - LANE_LENGTH
  const inside: Point2 = { x: plan.doorX, z: plan.front - 1.8 }
  const threshold: Point2 = { x: plan.doorX, z: plan.front + 0.3 }
  const laneZ = LANE_OFFSETS.slice(0, lanes).map((offset) => plan.front + offset)
  const path: Point2[] = [inside, threshold]
  laneZ.forEach((z, i) => {
    // 第一条队道从门口往左，之后来回折返
    const [from, to] = i % 2 === 0 ? [startX, endX] : [endX, startX]
    path.push({ x: from, z }, { x: to, z })
  })
  const joinX = lanes % 2 === 1 ? endX : startX
  path.push({ x: joinX, z: LOT_EDGE_Z }, { x: joinX, z: WALK_INSET })

  const exitX = plan.doorX + 1.6
  const exit: Point2[] = [
    inside,
    threshold,
    { x: plan.doorX + 0.7, z: plan.front + 0.9 },
    { x: exitX, z: plan.front + 1.7 },
    { x: exitX, z: LOT_EDGE_Z },
    { x: exitX, z: WALK_INSET },
  ]
  const doorS = distance(inside, threshold)
  return {
    lanes,
    path: dedupe(path),
    exit,
    doorS,
    headS: doorS + distance(threshold, path[2]),
    spacing: QUEUE_SPACING,
    laneZ,
    laneStartX: startX,
    laneEndX: endX,
    joinX,
    exitX,
  }
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function dedupe(points: Point2[]): Point2[] {
  return points.filter((point, i) => i === 0 || distance(point, points[i - 1]) > 1e-6)
}

/** 预先计算折线累计长度，按距离取点与朝向。 */
export class Polyline {
  readonly cumulative: number[]
  readonly length: number

  constructor(readonly points: Point2[]) {
    this.cumulative = [0]
    for (let i = 1; i < points.length; i += 1) {
      this.cumulative.push(this.cumulative[i - 1] + distance(points[i - 1], points[i]))
    }
    this.length = this.cumulative[this.cumulative.length - 1] ?? 0
  }

  private segmentAt(s: number): number {
    const clamped = Math.max(0, Math.min(this.length, s))
    let i = 1
    while (i < this.cumulative.length - 1 && this.cumulative[i] < clamped) i += 1
    return i
  }

  pointAt(s: number, out: Point2 = { x: 0, z: 0 }): Point2 {
    if (this.points.length === 1) return Object.assign(out, this.points[0])
    const clamped = Math.max(0, Math.min(this.length, s))
    const i = this.segmentAt(clamped)
    const a = this.points[i - 1]
    const b = this.points[i]
    const span = this.cumulative[i] - this.cumulative[i - 1]
    const t = span > 0 ? (clamped - this.cumulative[i - 1]) / span : 0
    out.x = a.x + (b.x - a.x) * t
    out.z = a.z + (b.z - a.z) * t
    return out
  }

  /** 沿路线“往回”（朝起点）方向的角度，供人物朝向使用。 */
  headingAt(s: number): number {
    if (this.points.length < 2) return 0
    const i = this.segmentAt(s)
    const a = this.points[i - 1]
    const b = this.points[i]
    return Math.atan2(a.x - b.x, a.z - b.z)
  }
}

import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three'
import { createRng, pick, range, type Rng } from '@/lib/rng'
import { GeometryBucket } from '@/scene/geometry-bucket'
import {
  BLOCK_D,
  BLOCK_W,
  CROSSWALK_W,
  LOT_D,
  LOT_W,
  ROAD_W,
  SIDEWALK_H,
  SIDEWALK_W,
  STOP_OFFSET,
  type Block,
  type TownLayout,
} from '@/scene/layout'
import { addBench, addFlowerBed, addTree, BENCH, GRASS, HEDGE, LEAVES, POLE, shadeHex, type LightPool, type TownBuckets } from '@/scene/props'
import { pickVehicle, vehicleBodyGeometry, vehicleLightGeometry, VEHICLES, type VehicleKind, type VehicleSpec } from '@/scene/vehicles'
import { SIGNAL_CLEAR, TrafficSignal, type Axis, type WalkNetwork } from '@/scene/walk-network'

/** 信号灯灯头：朝 face 方向，给沿 axis 行驶的车看。 */
export interface SignalHead {
  x: number
  y: number
  z: number
  axis: Axis
  face: [number, number]
}

export interface StreetResult {
  pools: LightPool[]
  /** 路灯灯头位置，夜间点光源的候选。 */
  lampSpots: Vector3[]
  signalHeads: SignalHead[]
}

/** 画面判定：(x, y, z) 附近 radius 范围是否可能出现在镜头里。 */
export type Visibility = (x: number, y: number, z: number, radius: number) => boolean

const Y = SIDEWALK_H
const PAVEMENT = '#b7b1a7'
const JOINT = '#a39d93'
const CURB = '#d6d0c5'
const MARKING = '#e4dfd2'
const CENTER_LINE = '#d9a93a'
const PATH = '#a79f93'
const HOUSING = '#23262b'
const FILLER_WALLS = ['#8f8479', '#a09384', '#7d746c', '#b3a593', '#8a8f94', '#9a8b80']
const FILLER_LIT = ['#ffd48a', '#ffe2b0', '#ffc46b', '#cfe0ff']
const JOINT_STEP = 2.4

function lamp(buckets: TownBuckets, x: number, z: number, dx: number, dz: number, pools: LightPool[], spots: Vector3[]) {
  const { solid, glow } = buckets
  const hx = x + dx * 1.15
  const hz = z + dz * 1.15
  const rotY = dx !== 0 ? Math.PI / 2 : 0
  solid.cylinder(0.14, 0.18, 0.3, x, Y, z, POLE, 8)
  solid.cylinder(0.07, 0.09, 4.7, x, Y, z, POLE, 8)
  solid.segment(new Vector3(x, Y + 4.6, z), new Vector3(x + dx * 1.1, Y + 4.75, z + dz * 1.1), 0.08, POLE)
  solid.box(0.5, 0.12, 0.34, hx, Y + 4.72, hz, POLE, { rotY })
  glow.box(0.36, 0.06, 0.24, hx, Y + 4.64, hz, '#ffe7b8', { rotY })
  spots.push(new Vector3(hx, Y + 4.4, hz))
  pools.push({ x: x + dx * 1.4, z: z + dz * 1.4, y: 0.02, radius: 5.2, color: '#ffcf8a' })
}

/** 街区底座：抬高的人行板、一圈浅色路缘，可步行街区再画上铺装缝。 */
function blockBase(solid: GeometryBucket, block: Block) {
  const cz = block.z - LOT_D / 2
  const { x } = block
  solid.boxOn(BLOCK_W, Y, BLOCK_D, x, 0, cz, PAVEMENT)
  const hw = BLOCK_W / 2 - 0.15
  const hd = BLOCK_D / 2 - 0.15
  solid.boxOn(BLOCK_W, 0.05, 0.3, x, Y, cz + hd, CURB)
  solid.boxOn(BLOCK_W, 0.05, 0.3, x, Y, cz - hd, CURB)
  solid.boxOn(0.3, 0.05, BLOCK_D - 0.6, x - hw, Y, cz, CURB)
  solid.boxOn(0.3, 0.05, BLOCK_D - 0.6, x + hw, Y, cz, CURB)
  if (!block.walkable) return
  const strip = SIDEWALK_W - 0.3
  const front = block.z + SIDEWALK_W / 2 - 0.15
  const back = block.z - LOT_D - SIDEWALK_W / 2 + 0.15
  for (let jx = x - BLOCK_W / 2 + JOINT_STEP; jx < x + BLOCK_W / 2 - 0.5; jx += JOINT_STEP) {
    solid.box(0.06, 0.02, strip, jx, Y + 0.005, front, JOINT)
    solid.box(0.06, 0.02, strip, jx, Y + 0.005, back, JOINT)
  }
  for (let jz = block.z - JOINT_STEP; jz > block.z - LOT_D + 0.5; jz -= JOINT_STEP) {
    solid.box(strip, 0.02, 0.06, x - LOT_W / 2 - SIDEWALK_W / 2 + 0.15, Y + 0.005, jz, JOINT)
    solid.box(strip, 0.02, 0.06, x + LOT_W / 2 + SIDEWALK_W / 2 - 0.15, Y + 0.005, jz, JOINT)
  }
}

/** 背景楼：只有窗户和屋顶设施。 */
function fillerBuilding(buckets: TownBuckets, rng: Rng, cx: number, cz: number, floors: number) {
  const { solid, windows } = buckets
  const w = range(rng, 12, 15)
  const d = range(rng, 13, 18)
  const h = 3.4 + floors * 3
  const wall = pick(rng, FILLER_WALLS)
  solid.boxOn(w, h, d, cx, Y, cz, wall, { shade: 0.72 })
  solid.box(w + 0.3, 0.3, d + 0.3, cx, Y + h, cz, shadeHex(wall, 0.82))
  const colsW = Math.max(3, Math.floor(w / 2.4))
  const colsD = Math.max(3, Math.floor(d / 2.4))
  const lit = (): string => (rng() < 0.42 ? '#1a2030' : pick(rng, FILLER_LIT))
  for (let f = 0; f < floors; f += 1) {
    const y = Y + 3.4 + f * 3 + 0.7
    for (let i = 0; i < colsW; i += 1) {
      const x = cx - w / 2 + (w / colsW) * (i + 0.5)
      windows.boxOn(1.1, 1.5, 0.08, x, y, cz + d / 2 + 0.02, lit())
      windows.boxOn(1.1, 1.5, 0.08, x, y, cz - d / 2 - 0.02, lit())
    }
    for (let j = 0; j < colsD; j += 1) {
      const z = cz - d / 2 + (d / colsD) * (j + 0.5)
      windows.boxOn(0.08, 1.5, 1.1, cx + w / 2 + 0.02, y, z, lit())
      windows.boxOn(0.08, 1.5, 1.1, cx - w / 2 - 0.02, y, z, lit())
    }
  }
  // 首层商铺的暖光
  windows.boxOn(w * 0.6, 2, 0.08, cx, Y + 0.6, cz + d / 2 + 0.03, rng() < 0.7 ? '#ffcf8f' : '#1a2030')
  if (rng() < 0.6) {
    solid.boxOn(1.4, 0.9, 1.1, cx + range(rng, -w / 4, w / 4), Y + h + 0.15, cz + range(rng, -d / 4, d / 4), '#a9adb0')
  }
  if (rng() < 0.3) {
    const x = cx - w / 4
    const z = cz + d / 5
    solid.cylinder(0.9, 0.9, 1.6, x, Y + h + 1.6, z, '#7d5237', 10)
    solid.cylinder(0.05, 1, 0.6, x, Y + h + 3.2, z, '#3d3a37', 10)
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
      solid.boxOn(0.1, 1.6, 0.1, x + dx, Y + h, z + dz, '#4a3526')
    }
  }
}

/** 店铺区里的空位做成小公园：草坪、树、长椅，中间一个小喷泉。 */
function park(buckets: TownBuckets, rng: Rng, block: Block) {
  const { solid, glow } = buckets
  const cx = block.x
  const cz = block.z - LOT_D / 2
  solid.boxOn(LOT_W - 2, 0.12, LOT_D - 3.4, cx, Y, cz - 0.4, GRASS)
  solid.boxOn(1.6, 0.14, LOT_D - 3.4, cx, Y, cz - 0.4, PATH)
  solid.cylinder(1.8, 1.9, 0.5, cx, Y, cz, '#8f877d', 16)
  // 水面放进 glow：白天保持水色，夜里像打了池底灯
  glow.cylinder(1.5, 1.5, 0.08, cx, Y + 0.44, cz, '#6fa8d6', 16)
  solid.cylinder(0.25, 0.35, 1.1, cx, Y + 0.4, cz, '#8f877d', 8)
  glow.cylinder(0.5, 0.2, 0.25, cx, Y + 1.5, cz, '#a9d2f0', 8)
  for (const [dx, dz] of [[-5.6, -4], [5.4, -6.6], [-5, -14], [5.6, -15.5], [0, -18.5]] as const) {
    addTree(solid, rng, cx + dx + range(rng, -0.6, 0.6), Y, block.z + dz, range(rng, 0.9, 1.25))
  }
  addBench(solid, cx - 3, cz + 3.2, 0)
  addBench(solid, cx + 3, cz - 3.2, Math.PI)
  for (let i = 0; i < 6; i += 1) {
    solid.blob(0.5, cx + range(rng, -7, 7), Y + 0.35, block.z - range(rng, 2.5, 20), HEDGE, undefined, 0.7)
  }
}

/** 店铺区前方的绿地：草坪、花坛和朝向店铺的长椅，树种在远离店铺的一侧，不挡店面。 */
function greenLot(buckets: TownBuckets, rng: Rng, block: Block) {
  const { solid } = buckets
  const cx = block.x
  const cz = block.z - LOT_D / 2
  solid.boxOn(LOT_W, 0.12, LOT_D, cx, Y, cz, GRASS)
  solid.boxOn(LOT_W, 0.14, 1.8, cx, Y, block.z - LOT_D + 3, PATH)
  solid.boxOn(1.8, 0.14, LOT_D - 3.9, cx, Y, cz + 1.95, PATH)
  addFlowerBed(solid, rng, cx - 4.8, block.z - LOT_D + 6.2, 5.2, 1.6)
  addFlowerBed(solid, rng, cx + 4.8, block.z - LOT_D + 6.2, 5.2, 1.6)
  // 长椅面朝店铺（-z）
  addBench(solid, cx - 4.6, block.z - LOT_D + 4.4, Math.PI, Y + 0.12)
  addBench(solid, cx + 4.6, block.z - LOT_D + 4.4, Math.PI, Y + 0.12)
  for (const [dx, dz] of [[-6, -3], [6.2, -4], [-3.5, -9], [4, -11]] as const) {
    addTree(solid, rng, cx + dx + range(rng, -0.5, 0.5), Y + 0.1, block.z + dz, range(rng, 0.9, 1.2))
  }
  for (let i = 0; i < 5; i += 1) {
    solid.blob(0.45, cx + range(rng, -8, 8), Y + 0.35, block.z - range(rng, 1.5, 12), pick(rng, LEAVES), undefined, 0.7)
  }
}

/** 信号灯杆：一根立杆、两个灯箱（分别给 x 向、z 向的车看），灯珠由 Traffic 按相位上色。 */
function signalPole(solid: GeometryBucket, px: number, pz: number, fx: number, fz: number, heads: SignalHead[]) {
  const top = Y + 3.1
  solid.cylinder(0.12, 0.15, 0.25, px, Y, pz, POLE, 8)
  solid.cylinder(0.06, 0.07, 3.6, px, Y, pz, POLE, 8)
  const xHead = { x: px + fx * 0.22, z: pz }
  const zHead = { x: px, z: pz + fz * 0.22 }
  solid.box(0.28, 0.86, 0.3, xHead.x, top, xHead.z, HOUSING)
  solid.box(0.3, 0.86, 0.28, zHead.x, top, zHead.z, HOUSING)
  solid.box(0.36, 0.05, 0.36, px, Y + 3.6, pz, HOUSING)
  heads.push({ x: xHead.x, y: top, z: xHead.z, axis: 'x', face: [fx, 0] })
  heads.push({ x: zHead.x, y: top, z: zHead.z, axis: 'z', face: [0, fz] })
}

/** 道路标线：双黄中线（路口内断开）、停车线和人行横道。 */
function roadMarkings(solid: GeometryBucket, layout: TownLayout, network: WalkNetwork) {
  const { extent, roadX, roadZ } = layout
  const line = (from: number, to: number, fixed: number, axis: Axis) => {
    if (to - from < 0.5) return
    for (const side of [-0.12, 0.12]) {
      if (axis === 'x') solid.box(to - from, 0.02, 0.1, (from + to) / 2, 0.01, fixed + side, CENTER_LINE)
      else solid.box(0.1, 0.02, to - from, fixed + side, 0.01, (from + to) / 2, CENTER_LINE)
    }
  }
  const spans = (cuts: number[], min: number, max: number): [number, number][] => {
    const points = [min, ...cuts.flatMap((c) => [c - STOP_OFFSET, c + STOP_OFFSET]), max]
    const result: [number, number][] = []
    for (let i = 0; i < points.length; i += 2) result.push([points[i], points[i + 1]])
    return result
  }
  const tail = LANE_TAIL
  const xs = [...roadX].sort((a, b) => a - b)
  const zs = [...roadZ].sort((a, b) => a - b)
  for (const z of roadZ) {
    for (const [a, b] of spans(xs, extent.minX - tail, extent.maxX + tail)) line(a, b, z, 'x')
    for (const x of roadX) {
      // 靠右行驶：+x 车道在 z 大的一侧，停在路口左边；-x 车道相反
      solid.box(0.35, 0.02, ROAD_W / 2 - 0.4, x - STOP_OFFSET, 0.01, z + ROAD_W / 4, MARKING)
      solid.box(0.35, 0.02, ROAD_W / 2 - 0.4, x + STOP_OFFSET, 0.01, z - ROAD_W / 4, MARKING)
    }
  }
  for (const x of roadX) {
    for (const [a, b] of spans(zs, extent.minZ - tail, extent.maxZ + tail)) line(a, b, x, 'z')
    for (const z of roadZ) {
      solid.box(ROAD_W / 2 - 0.4, 0.02, 0.35, x - ROAD_W / 4, 0.01, z - STOP_OFFSET, MARKING)
      solid.box(ROAD_W / 2 - 0.4, 0.02, 0.35, x + ROAD_W / 4, 0.01, z + STOP_OFFSET, MARKING)
    }
  }
  // 人行横道只画在路网真正过马路的地方，条纹与车流方向平行
  const count = Math.floor((ROAD_W - 0.4) / 0.9)
  for (const edge of network.edges) {
    if (!edge.crossing) continue
    const a = network.nodes[edge.a]
    const b = network.nodes[edge.b]
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    for (let k = 0; k < count; k += 1) {
      const offset = (k - (count - 1) / 2) * 0.9
      if (edge.crossing === 'x') solid.box(0.45, 0.02, CROSSWALK_W, mx + offset, 0.01, mz, MARKING)
      else solid.box(CROSSWALK_W, 0.02, 0.45, mx, 0.01, mz + offset, MARKING)
    }
  }
}

/**
 * 街道：每个街区的人行板和路缘、各类地块（公园、绿地、背景楼）、路灯、行道树、信号灯杆和道路标线。
 * 店铺地块只铺人行板，地块内容由 shop-builder 负责。所有几何都写进共享缓冲，由场景统一生成网格。
 */
export function buildStreets(layout: TownLayout, network: WalkNetwork, buckets: TownBuckets): StreetResult {
  const { solid } = buckets
  const rng = createRng(`streets:${layout.rows}:${layout.parkSlots.length}`)
  const pools: LightPool[] = []
  const lampSpots: Vector3[] = []
  const signalHeads: SignalHead[] = []
  const farRow = layout.rows

  for (const block of layout.blocks) {
    blockBase(solid, block)
    const cz = block.z - LOT_D / 2
    if (block.kind === 'park') park(buckets, rng, block)
    else if (block.kind === 'green') greenLot(buckets, rng, block)
    else if (block.kind === 'filler') {
      const floors = block.walkable ? 2 + Math.floor(rng() * 4) : 4 + Math.floor(rng() * (block.row > farRow ? 6 : 4))
      fillerBuilding(buckets, rng, block.x + range(rng, -0.8, 0.8), cz - range(rng, 0, 1.5), floors)
    }
    if (!block.walkable) continue

    const frontCurb = block.z + SIDEWALK_W - 0.45
    const sideCurb = LOT_W / 2 + SIDEWALK_W - 0.45
    lamp(buckets, block.x - 7.2, frontCurb, 0, 1, pools, lampSpots)
    lamp(buckets, block.x + 7.2, frontCurb, 0, 1, pools, lampSpots)
    lamp(buckets, block.x + sideCurb, cz + 2, 1, 0, pools, lampSpots)
    lamp(buckets, block.x - sideCurb, cz + 0.5, -1, 0, pools, lampSpots)
    // 行道树只种在两侧人行道靠后的位置，不挡店门和挂牌
    const treeX = LOT_W / 2 + SIDEWALK_W - 0.9
    addTree(solid, rng, block.x + treeX, Y, block.z - 14.5, range(rng, 0.75, 0.9))
    addTree(solid, rng, block.x - treeX, Y, block.z - 17, range(rng, 0.75, 0.9))
    addTree(solid, rng, block.x - treeX, Y, block.z - 4.5, range(rng, 0.7, 0.85))
    // 路缘上的灯杆式信号灯，正对路口
    const hx = BLOCK_W / 2 - 0.5
    const hz = BLOCK_D / 2 - 0.5
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      signalPole(solid, block.x + sx * hx, cz + sz * hz, sx, sz, signalHeads)
    }
    if (rng() < 0.5) solid.cylinder(0.32, 0.28, 0.9, block.x - sideCurb + 0.2, Y, cz + 5, '#3d6b4f', 10)
    if (rng() < 0.4) solid.boxOn(0.6, 1, 0.5, block.x + sideCurb - 0.1, Y, cz - 8, BENCH)
  }
  roadMarkings(solid, layout, network)
  return { pools, lampSpots, signalHeads }
}

// ——— 车流 ———

/** 车道在小镇外沿之外再延伸的长度，车辆在雾里掉头。 */
export const LANE_TAIL = 90
/** 跟车时与前车保持的最小间距。 */
const MIN_GAP = 1.6
const CAR_SPACING = 52
const ACCEL = 3.2
const BRAKE = 4
/** 黄灯时能刹住才停，刹不住就直接通过。 */
const HARD_BRAKE = 6
/** 绿灯最后几秒按黄灯处理。 */
export const YELLOW = 2
/** 车头从停车线开到车尾离开对面人行横道要走的距离（不含车长）。 */
export const CLEAR_SPAN = STOP_OFFSET * 2
/** 开场时离停车线不到这么远的车按停在线前处理，免得以巡航速度刹不住闯过路口。 */
const START_CLEAR = 6
/** 离开车道末端后最多再开多远，超过就强制收起。 */
const OVERRUN = 260

export interface Car {
  spec: VehicleSpec
  /** 在同车型实例里的序号。 */
  slot: number
  /** 车身中心沿车道行驶的距离。 */
  s: number
  speed: number
  cruise: number
}

export interface Lane {
  axis: Axis
  dir: 1 | -1
  /** 车道中心线的固定坐标：x 向车道为 z，z 向车道为 x。 */
  offset: number
  /** s = 0 时的坐标。 */
  start: number
  length: number
  /** 各路口停车线的位置（按 s 升序）。 */
  stops: number[]
  /** 行驶中的车，按 s 升序。 */
  cars: Car[]
  /** 开出车道、等在画面外重新入场的车。 */
  waiting: Car[]
}

export function laneCoord(lane: Lane, s: number): number {
  return lane.start + lane.dir * s
}

export function lanePosition(lane: Lane, s: number): { x: number; z: number } {
  const coord = laneCoord(lane, s)
  return lane.axis === 'x' ? { x: coord, z: lane.offset } : { x: lane.offset, z: coord }
}

/** 按靠右行驶生成所有车道和初始车辆（车型按权重随机）；初始时不把车放进路口。 */
export function createLanes(layout: TownLayout, rng: Rng): Lane[] {
  const lanes: Lane[] = []
  const slots = new Map<VehicleKind, number>()
  const addLane = (axis: Axis, dir: 1 | -1, offset: number, min: number, max: number, crossings: number[]) => {
    const length = max - min
    const start = dir > 0 ? min : max
    const stops = crossings.map((c) => (dir > 0 ? c - STOP_OFFSET - min : max - (c + STOP_OFFSET))).sort((a, b) => a - b)
    const lane: Lane = { axis, dir, offset, start, length, stops, cars: [], waiting: [] }
    const count = Math.max(2, Math.round(length / CAR_SPACING))
    const step = length / count
    let lastFront = -Infinity
    for (let i = 0; i < count; i += 1) {
      const spec = pickVehicle(rng)
      const half = spec.length / 2
      let s = step * i + range(rng, 0, step * 0.5)
      // 停在路口里、或离停车线近到刹不住的车，改成停在停车线前等灯
      const blocked = stops.find((line) => s + half > line - START_CLEAR && s - half < line + CLEAR_SPAN + 0.5)
      if (blocked !== undefined) s = blocked - half - 0.3
      if (s - half < lastFront + MIN_GAP) continue
      const cruise = range(rng, ...spec.cruise)
      const slot = slots.get(spec.kind) ?? 0
      slots.set(spec.kind, slot + 1)
      lane.cars.push({ spec, slot, s, speed: blocked === undefined ? cruise : 0, cruise })
      lastFront = s + half
    }
    lanes.push(lane)
  }
  const { extent, roadX, roadZ } = layout
  for (const z of roadZ) {
    addLane('x', 1, z + ROAD_W / 4, extent.minX - LANE_TAIL, extent.maxX + LANE_TAIL, roadX)
    addLane('x', -1, z - ROAD_W / 4, extent.minX - LANE_TAIL, extent.maxX + LANE_TAIL, roadX)
  }
  for (const x of roadX) {
    addLane('z', 1, x - ROAD_W / 4, extent.minZ - LANE_TAIL, extent.maxZ + LANE_TAIL, roadZ)
    addLane('z', -1, x + ROAD_W / 4, extent.minZ - LANE_TAIL, extent.maxZ + LANE_TAIL, roadZ)
  }
  return lanes
}

function nextStop(stops: number[], front: number): number | null {
  for (const line of stops) if (line >= front - 0.05) return line
  return null
}

/**
 * 进这个路口会不会堵在里面：前车几乎停着、路口对面放不下整辆车；或者下个路口来不及通过，
 * 前面的车都会排在两个路口之间，那一段放不下自己。
 */
function spillsBack(lane: Lane, index: number, line: number, greenLeft: number): boolean {
  const { cars } = lane
  const car = cars[index]
  const need = car.spec.length + MIN_GAP
  const leader = cars[index + 1]
  if (leader && leader.speed < 2 && leader.s - leader.spec.length / 2 < line + CLEAR_SPAN + need) return true
  const after = lane.stops.find((stop) => stop > line)
  if (after === undefined) return false
  const front = car.s + car.spec.length / 2
  if (greenLeft >= (after - front) / Math.max(car.speed, 3) + YELLOW) return false
  let used = need
  for (let k = index + 1; k < cars.length; k += 1) {
    const ahead = cars[k]
    if (ahead.s - ahead.spec.length / 2 >= after) break
    used += ahead.spec.length + MIN_GAP
  }
  return used > after - (line + CLEAR_SPAN)
}

/**
 * 推进一条车道：按各自车长跟车；绿灯剩余时间（greenLeft，红灯为 0）不够这辆车在对向放行前开出路口时，
 * 按红灯在停车线前停下，所以长车会比小车更早停；路口对面排着队、放不下整辆车时也不进路口。
 * 已越线或刹不住的车继续通过。
 * 开出车道末端且不在画面里的车收进等待队列，车道起点不在画面里时再放回来。
 */
export function stepLane(lane: Lane, dt: number, greenLeft: number, visible: Visibility): void {
  const { cars } = lane
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i]
    const length = car.spec.length
    const front = car.s + length / 2
    let limit = Infinity
    const leader = cars[i + 1]
    if (leader) limit = leader.s - leader.spec.length / 2 - front - MIN_GAP
    const line = nextStop(lane.stops, front)
    if (line !== null) {
      const dist = line - front
      const clearing = (dist + CLEAR_SPAN + length) / Math.max(car.speed, 3)
      const stop = greenLeft <= YELLOW || greenLeft + SIGNAL_CLEAR < clearing + 0.5 || spillsBack(lane, i, line, greenLeft)
      if (stop && dist > (car.speed * car.speed) / (2 * HARD_BRAKE) - 0.5) limit = Math.min(limit, dist - 0.3)
    }
    const target = Math.min(car.cruise, Math.sqrt(2 * BRAKE * Math.max(0, limit)))
    car.speed = target < car.speed ? target : Math.min(target, car.speed + ACCEL * dt)
  }
  for (const car of cars) car.s += car.speed * dt

  for (;;) {
    const last = cars.at(-1)
    if (!last || last.s <= lane.length) break
    const { x, z } = lanePosition(lane, last.s)
    if (last.s < lane.length + OVERRUN && visible(x, 1, z, last.spec.length)) break
    cars.pop()
    lane.waiting.push(last)
  }
  const first = cars[0]
  const next = lane.waiting[0]
  if (next && (!first || first.s - first.spec.length / 2 > next.spec.length + MIN_GAP)) {
    const { x, z } = lanePosition(lane, 0)
    if (!visible(x, 1, z, next.spec.length)) {
      lane.waiting.shift()
      next.s = 0
      next.speed = next.cruise
      cars.unshift(next)
    }
  }
}

const LENS_LIT = ['#ff4a3d', '#ffc233', '#3ddc84']
const LENS_DIM = ['#3d1714', '#3b3014', '#123a22']
const HIDDEN = new Matrix4().makeScale(0, 0, 0)

/** 当前某个轴的灯色：0 红、1 黄、2 绿。 */
export function lampState(signal: TrafficSignal, axis: Axis): 0 | 1 | 2 {
  if (signal.green() !== axis) return 0
  return signal.remaining() > YELLOW ? 2 : 1
}

interface Fleet {
  bodies: InstancedMesh
  lights: InstancedMesh
}

/**
 * 全城车流：所有道路都是双向车道，轿车、出租车、公交车、货车等混行，跟车行驶并服从统一的两相位信号灯。
 * 每种车型的车身、车灯各一个 InstancedMesh，信号灯珠一个 InstancedMesh。
 */
export class Traffic {
  readonly signal: TrafficSignal
  readonly lenses: InstancedMesh
  private readonly fleets = new Map<VehicleKind, Fleet>()
  private readonly bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, flatShading: true })
  private readonly lightMaterial = new MeshBasicMaterial({ vertexColors: true })
  private readonly lanes: Lane[]
  private readonly heads: SignalHead[]
  private readonly dummy = new Object3D()
  private readonly color = new Color()
  private lensKey = ''

  constructor(layout: TownLayout, heads: SignalHead[], signal = new TrafficSignal()) {
    this.signal = signal
    this.heads = heads
    const rng = createRng(`traffic:${layout.rows}:${layout.roadX.length}`)
    this.lanes = createLanes(layout, rng)
    const counts = new Map<VehicleKind, number>()
    for (const lane of this.lanes) for (const car of lane.cars) counts.set(car.spec.kind, (counts.get(car.spec.kind) ?? 0) + 1)
    for (const spec of VEHICLES) {
      const count = counts.get(spec.kind)
      if (!count) continue
      const bodies = new InstancedMesh(vehicleBodyGeometry(spec), this.bodyMaterial, count)
      const lights = new InstancedMesh(vehicleLightGeometry(spec), this.lightMaterial, count)
      bodies.castShadow = true
      bodies.receiveShadow = true
      bodies.frustumCulled = false
      lights.frustumCulled = false
      this.fleets.set(spec.kind, { bodies, lights })
    }
    for (const lane of this.lanes) {
      for (const car of lane.cars) this.fleets.get(car.spec.kind)!.bodies.setColorAt(car.slot, this.color.set(pick(rng, car.spec.paints)))
    }

    this.lenses = new InstancedMesh(new IcosahedronGeometry(0.085, 1), new MeshBasicMaterial({ toneMapped: false }), Math.max(1, heads.length * 3))
    this.lenses.frustumCulled = false
    const matrix = new Matrix4()
    heads.forEach((head, i) => {
      for (let k = 0; k < 3; k += 1) {
        matrix.makeTranslation(head.x + head.face[0] * 0.16, head.y + 0.26 - k * 0.26, head.z + head.face[1] * 0.16)
        this.lenses.setMatrixAt(i * 3 + k, matrix)
      }
    })
    if (!heads.length) this.lenses.count = 0
    this.update(0)
  }

  get meshes(): InstancedMesh[] {
    return [...[...this.fleets.values()].flatMap((fleet) => [fleet.bodies, fleet.lights]), this.lenses]
  }

  update(dt: number, visible: Visibility = () => false): void {
    this.signal.update(dt)
    const green = this.signal.green()
    const left = this.signal.remaining()
    const greenLeft = { x: green === 'x' ? left : 0, z: green === 'z' ? left : 0 }
    for (const lane of this.lanes) {
      if (dt > 0) stepLane(lane, dt, greenLeft[lane.axis], visible)
      const heading = lane.axis === 'x' ? (lane.dir > 0 ? 0 : Math.PI) : lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2
      for (const car of lane.cars) {
        const { x, z } = lanePosition(lane, car.s)
        this.dummy.position.set(x, 0, z)
        this.dummy.rotation.set(0, heading, 0)
        this.dummy.updateMatrix()
        const fleet = this.fleets.get(car.spec.kind)!
        fleet.bodies.setMatrixAt(car.slot, this.dummy.matrix)
        fleet.lights.setMatrixAt(car.slot, this.dummy.matrix)
      }
      for (const car of lane.waiting) {
        const fleet = this.fleets.get(car.spec.kind)!
        fleet.bodies.setMatrixAt(car.slot, HIDDEN)
        fleet.lights.setMatrixAt(car.slot, HIDDEN)
      }
    }
    for (const fleet of this.fleets.values()) {
      fleet.bodies.instanceMatrix.needsUpdate = true
      fleet.lights.instanceMatrix.needsUpdate = true
    }
    this.updateLenses()
  }

  private updateLenses() {
    const states = { x: lampState(this.signal, 'x'), z: lampState(this.signal, 'z') }
    const key = `${states.x}${states.z}`
    if (key === this.lensKey || !this.heads.length) return
    this.lensKey = key
    this.heads.forEach((head, i) => {
      const lit = states[head.axis]
      for (let k = 0; k < 3; k += 1) {
        // k 与灯色编号一致：0 红灯在上，2 绿灯在下
        this.lenses.setColorAt(i * 3 + k, this.color.set(k === lit ? LENS_LIT[k] : LENS_DIM[k]))
      }
    })
    if (this.lenses.instanceColor) this.lenses.instanceColor.needsUpdate = true
  }

  setNight(night: boolean): void {
    for (const fleet of this.fleets.values()) fleet.lights.visible = night
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    this.bodyMaterial.dispose()
    this.lightMaterial.dispose()
    ;(this.lenses.material as MeshBasicMaterial).dispose()
  }
}

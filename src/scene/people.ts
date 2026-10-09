import {
  Color,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three'
import { createRng, pick, range, type Rng } from '@/lib/rng'
import { MAX_QUEUE } from '@/lib/town-data'
import { GeometryBucket } from '@/scene/geometry-bucket'
import { SIDEWALK_H } from '@/scene/layout'
import type { BuiltShop } from '@/scene/shop-builder'
import { LANE_LENGTH, type Point2, type Polyline } from '@/scene/shop-layout'
import type { Visibility } from '@/scene/street'
import {
  CURB_GAP,
  otherEnd,
  shortestPath,
  type Axis,
  type FrontStop,
  type TrafficSignal,
  type WalkNetwork,
} from '@/scene/walk-network'

/**
 * 小镇行人：每人由腿、手臂、手、躯干、头、眼睛、发型、背包和购物袋拼成，全部用 InstancedMesh 绘制。
 *
 * - 路人沿人行道路网走动，过马路前在路缘等绿灯；只在镜头外出生，走出镜头或走到镜头外的目的地才消失。
 * - 每家店同一时间只放一位顾客进门：进店、停留片刻、提着品牌色购物袋出来，走开一段后下一位才进。
 * - 队伍缺人时，附近的路人会改道去排队；附近没有合适的人，就从镜头外派一位走过来。
 */
export type CrowdShop = Pick<
  BuiltShop,
  'id' | 'row' | 'col' | 'queue' | 'queueSize' | 'queuePath' | 'exitPath' | 'joinX' | 'exitX' | 'plan'
>

export interface CrowdOptions {
  shops: readonly CrowdShop[]
  network: WalkNetwork
  /** buildWalkNetwork(layout, crowdStops(shops)) 返回的 stopNodes：每家店依次是入队点、出店点。 */
  stopNodes: readonly number[]
  /** 与车流共用的信号灯；行人只读取，不推进它的时间。 */
  signal: TrafficSignal
  seed: string
  /** 进出店节奏的倍数，见 Crowd.setDoorSpeed；默认 1。 */
  doorSpeed?: number
}

export interface CrowdHead {
  x: number
  y: number
  z: number
}

export type CrowdMode = 'walk' | 'queue' | 'enter' | 'inside' | 'exit'

/** 行人快照，供测试与调试。road 表示此刻正走在哪个方向的人行横道车行道部分上。 */
export interface CrowdMember {
  mode: CrowdMode
  x: number
  z: number
  road: Axis | null
  shopId: string | null
  heading: string | null
}

/** 每家店在临街步行线上插两个节点：入队点和出店点。 */
export function crowdStops(shops: readonly CrowdShop[]): FrontStop[] {
  return shops.flatMap((shop) => [
    { row: shop.row, col: shop.col, x: shop.joinX },
    { row: shop.row, col: shop.col, x: shop.exitX },
  ])
}

const SHIRTS = ['#d65a4a', '#3f6fb5', '#e0b04a', '#4f9a74', '#8a5bb0', '#e27d3f', '#2f8a9a', '#ece6da', '#5a6272', '#b8506f', '#7aa6c8', '#c5d86d']
const JACKETS = ['#394150', '#6b4f3a', '#7d8b6a', '#9a3b3b', '#2f4f6f', '#c4a484', '#1f2228']
const PANTS = ['#2f3440', '#3c4a63', '#5a4a3c', '#6b6f78', '#1f2228', '#8a7a62', '#4a5a7a']
const SKIN = ['#f1c7a3', '#d9a47c', '#b57a55', '#8a5638', '#f6d6bd', '#e0b48f', '#6b4430']
const HAIR = ['#1d1a18', '#2b211c', '#4a3122', '#8a5a2e', '#c9a064', '#6d6a66', '#b5b0a8', '#7a3a22']
const HATS = ['#d64545', '#2f4f8f', '#1f1f1f', '#e0b04a', '#3f8a5a', '#f2efe9']
const PACKS = ['#2f3440', '#c0503f', '#3f6fb5', '#e0b04a', '#4f7a5a', '#7a5a9a']

const Y = SIDEWALK_H
const HIP_Y = 0.84
const HIP_X = 0.1
const SHOULDER_Y = 1.3
const SHOULDER_X = 0.29
const NECK_Y = 1.36
const HAND_Y = 0.6
/** 头顶高度（1 倍身高时，米），对话气泡锚在这里。 */
const HEAD_TOP = 1.8
/** 门口台阶高度。 */
const STEP_H = 0.12

const QUEUE_SPEED = 1.35
/** 离门槛还有这么远时算进了门。 */
const DOOR_HIDE = 0.1
/** 上一位出店者离开门槛这么远，下一位才进店。 */
const EXIT_CLEAR = 0.9
const DWELL_MIN = 1.1
const DWELL_MAX = 2
/** 一位顾客从进门到让出门口的大致秒数，用来估算要提前派出多少人。 */
const CYCLE_SECONDS = 3.4
/** 赶来的人常被红灯攒成一批到达，队伍允许比目标多排这么几位作缓冲。 */
const QUEUE_BUFFER = 2
/** 派人时在实测路上耗时之外多留的余量。 */
const TRAVEL_SLACK = 1
/** 原速下最多同时派出多少人赶来排队；进出加快时按倍数放宽。 */
const MAX_PIPELINE = 8
/** 进出速度倍数的范围；行人槽位按上限预留。 */
export const MIN_DOOR_SPEED = 0.5
export const MAX_DOOR_SPEED = 5
/** 下一个路口离入队点这么近的路人，可以直接改道去排队（米）。 */
const RECRUIT_RADIUS = 36
/** 平均每多少米人行道有一位路人。 */
const AMBIENT_SPACING = 15
const AMBIENT_MAX = 150
/** 同向行走时与前面的人保持的最小间距（米）。 */
const FOLLOW_GAP = 0.6
/** 同向两人横向相距不到这么多会撞在一起，后面的人只能跟着走或换道。 */
const LANE_CLEAR = 0.5
/** 离路段终点这么近时，也看下一段路上刚走进去的人。 */
const LOOKAHEAD = 2
/** 靠右行走的两条小道：内侧、外侧离步行线的距离范围（米），两条相距不小于 LANE_CLEAR。 */
const INNER_LANE: [number, number] = [0.28, 0.4]
const OUTER_LANE: [number, number] = [0.92, 1.02]
/** 换道时的横向速度（米/秒）。 */
const LANE_SHIFT = 0.9
/** 走到路口时要过的横道是红灯，而另一条绿灯横道绕过去不比原路远这么多（米），就改走绿灯那条。 */
const REROUTE_SLACK = 2
/** 离队伍入口还有这么远时开始靠回内侧小道。 */
const JOIN_APPROACH = 3
/** 被前面的人挡住这么久，就看看另一条小道能不能超过去。 */
const OVERTAKE_AFTER = 0.5
/** 换道前确认另一条小道前后这么长一段没人。 */
const OVERTAKE_CLEAR = 1.4
/** 判断出生点是否在画面里时的包围球半径，留出余量避免在画面边缘冒出来。 */
const SPAWN_MARGIN = 2.5
const BODY_RADIUS = 1.2
const MAX_DT = 0.1
/** 每走一米迈步的相位（一步约 0.72 米）。 */
const STRIDE_PER_METER = Math.PI / 0.72
const HIDDEN = new Matrix4().makeScale(0, 0, 0)
const ONE = new Vector3(1, 1, 1)

const enum Hair {
  Short = 0,
  Long = 1,
  Bun = 2,
  Ponytail = 3,
  Cap = 4,
}
const HAIR_STYLES = 5

interface ShopState {
  shop: CrowdShop
  joinNode: number
  exitNode: number
  target: number
  capacity: number
  /** 队道能容纳的人数上限；行人槽位按它预留，排队目标随实时数据变化也够用。 */
  slots: number
  members: Person[]
  /** 已经派出、正在赶来排队的人数。 */
  inbound: number
  entering: Person | null
  inside: Person | null
  leaving: Person[]
  hideS: number
  /** 门口台阶外沿的 z，走到这里以内要抬高一级台阶。 */
  stepZ: number
  /** 按离入队点由近到远排好的路网节点，用于挑选镜头外的出生点。 */
  spawnOrder: number[]
  /** 从派出到走进队伍的平均实测耗时（秒），包括等红灯和跟在别人后面走的时间。 */
  travel: number
  cooldown: number
  /** 开场时各店错开第一次开门的时间。 */
  delay: number
  bag: string
}

interface Person {
  slot: number
  alive: boolean
  mode: CrowdMode
  // 外观与性格
  scale: number
  girth: number
  hair: number
  pack: boolean
  bag: boolean
  seed: number
  speed: number
  /** 沿行进方向靠右的偏移（米），双向人流因此自然分开；换道时向 laneGoal 平滑移动。 */
  lane: number
  laneGoal: number
  /** 被同向的人挡住了多久（秒）。 */
  blocked: number
  // 本帧开始时在路网上的位置，供其他人判断前面有没有人
  occEdge: number
  occDir: number
  occAlong: number
  /** 快走到路口时：路口节点、离路口还剩多远、要拐进的下一段路（没有则为 -1）。 */
  occNode: number
  occRest: number
  occNext: number
  /** 已经在哪个路口考虑过改走绿灯横道，每个路口只考虑一次。 */
  replanned: number
  /** 过马路时在路缘等候的位置（离步行线的距离）。 */
  gate: number
  // 目标姿态（每帧由状态机写入）与平滑后的实际姿态
  tx: number
  tz: number
  ty: number
  th: number
  tnx: number
  tnz: number
  x: number
  y: number
  z: number
  heading: number
  nx: number
  nz: number
  stride: number
  phase: number
  /** 是否出现过在画面里；出现过的路人走出画面就离开。 */
  seen: boolean
  // 路网行走
  route: number[]
  step: number
  node: number
  dist: number
  granted: boolean
  /** 正赶去排队的店，以及是什么时候派出的。 */
  target: ShopState | null
  dispatchedAt: number
  // 店铺
  shop: ShopState | null
  s: number
  goalS: number
  timer: number
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function built(bucket: GeometryBucket): BufferGeometry {
  const geometry = bucket.build()
  if (!geometry) throw new Error('行人几何生成失败')
  return geometry
}

const WHITE = '#ffffff'
const ball = () => new IcosahedronGeometry(1, 1)
const dome = () => new SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)

// 以下几何都用白色顶点色，实例颜色相乘后就是衣服、皮肤或发色；深色部分（鞋、眼睛）染色后仍然偏暗。

/** 腿：枢轴在胯部，含半边胯、裤腿和鞋。 */
function legGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.boxOn(0.19, 0.16, 0.22, 0, -0.1, 0, WHITE)
  b.cylinder(0.088, 0.074, 0.72, 0, -0.76, 0, WHITE, 6)
  b.boxOn(0.15, 0.09, 0.27, 0, -0.84, 0.045, '#4a4540')
  return built(b)
}

/** 手臂：枢轴在肩部。 */
function armGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.cylinder(0.07, 0.058, 0.54, 0, -0.54, 0, WHITE, 6)
  return built(b)
}

function handGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.custom('ball', ball, 0.062, 0.075, 0.062, 0, -HAND_Y, 0.005, WHITE)
  return built(b)
}

/** 躯干：前后压扁的圆台，加肩头和领口。 */
function torsoGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  const flat = new Matrix4().makeScale(1, 1, 0.64)
  b.cylinder(0.25, 0.205, 0.5, 0, 0.8, 0, WHITE, 8, { parent: flat, shade: 0.82 })
  b.cylinder(0.13, 0.25, 0.06, 0, 1.3, 0, WHITE, 8, { parent: flat })
  for (const side of [-1, 1]) b.custom('ball', ball, 0.1, 0.085, 0.1, side * 0.245, 1.27, 0, WHITE)
  return built(b)
}

/** 头：枢轴在脖子根部，含脖子、鼻子和耳朵。 */
function headGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.cylinder(0.062, 0.07, 0.12, 0, -0.04, 0, WHITE, 6)
  b.custom('ball', ball, 0.165, 0.18, 0.17, 0, 0.21, 0, WHITE)
  b.box(0.035, 0.05, 0.05, 0, 0.19, 0.165, WHITE)
  for (const side of [-1, 1]) b.box(0.03, 0.06, 0.05, side * 0.165, 0.2, 0, WHITE)
  return built(b)
}

function eyeGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  for (const side of [-1, 1]) b.box(0.034, 0.048, 0.022, side * 0.06, 0.225, 0.156, '#1d1a18')
  return built(b)
}

/** 短发：头顶和后脑各一块半球。其他发型在它的基础上加长发、发髻或马尾。 */
function shortHair(b: GeometryBucket) {
  b.custom('dome', dome, 0.182, 0.17, 0.188, 0, 0.25, -0.008, WHITE)
  b.custom('dome', dome, 0.178, 0.19, 0.2, 0, 0.2, -0.01, WHITE, { rotX: -Math.PI / 2 })
}

function hairGeometry(style: Hair): BufferGeometry {
  const b = new GeometryBucket()
  if (style === Hair.Cap) {
    b.custom('dome', dome, 0.184, 0.15, 0.19, 0, 0.27, -0.005, WHITE)
    b.box(0.2, 0.022, 0.15, 0, 0.275, 0.17, WHITE)
    b.custom('ball', ball, 0.025, 0.02, 0.025, 0, 0.42, 0, WHITE)
    b.custom('dome', dome, 0.17, 0.12, 0.16, 0, 0.19, -0.02, '#3b332c', { rotX: -Math.PI / 2 })
    return built(b)
  }
  shortHair(b)
  if (style === Hair.Long) {
    b.boxOn(0.32, 0.34, 0.09, 0, -0.06, -0.12, WHITE)
    for (const side of [-1, 1]) b.boxOn(0.05, 0.28, 0.13, side * 0.162, 0.0, -0.03, WHITE)
  } else if (style === Hair.Bun) {
    b.custom('ball', ball, 0.085, 0.08, 0.085, 0, 0.4, -0.08, WHITE)
  } else if (style === Hair.Ponytail) {
    b.custom('ball', ball, 0.05, 0.05, 0.05, 0, 0.3, -0.19, WHITE)
    b.segment(new Vector3(0, 0.3, -0.2), new Vector3(0, 0.06, -0.25), 0.08, WHITE)
  }
  return built(b)
}

/** 背包：挂在躯干背后，带肩带。 */
function packGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.boxOn(0.3, 0.38, 0.14, 0, 0.9, -0.2, WHITE, { shade: 0.8 })
  b.boxOn(0.31, 0.1, 0.16, 0, 1.2, -0.2, '#d8d8d8')
  b.boxOn(0.22, 0.14, 0.05, 0, 0.94, -0.29, '#cfcfcf')
  for (const side of [-1, 1]) b.box(0.05, 0.03, 0.3, side * 0.12, 1.32, -0.06, '#bdbdbd')
  return built(b)
}

/** 购物袋：原点在手心，袋子侧挂在身体旁边。 */
function bagGeometry(): BufferGeometry {
  const b = new GeometryBucket()
  b.boxOn(0.1, 0.3, 0.26, 0, -0.42, 0, WHITE, { shade: 0.85 })
  b.boxOn(0.104, 0.05, 0.264, 0, -0.2, 0, '#f4f1ea')
  for (const side of [-1, 1]) b.box(0.02, 0.12, 0.02, 0, -0.06, side * 0.06, '#e8e4dc')
  b.box(0.02, 0.02, 0.14, 0, 0, 0, '#e8e4dc')
  return built(b)
}

function wrapAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export class Crowd {
  readonly meshes: InstancedMesh[]
  private readonly legs: InstancedMesh
  private readonly arms: InstancedMesh
  private readonly hands: InstancedMesh
  private readonly torso: InstancedMesh
  private readonly head: InstancedMesh
  private readonly eyes: InstancedMesh
  private readonly hair: InstancedMesh[]
  private readonly pack: InstancedMesh
  private readonly bag: InstancedMesh
  private readonly paired: Set<InstancedMesh>
  private readonly material: MeshStandardMaterial
  private readonly capacity: number
  private readonly used: Uint8Array
  private highWater = 0
  private colorsDirty = true
  private people: Person[] = []
  private readonly shops: ShopState[]
  private readonly network: WalkNetwork
  private readonly signal: TrafficSignal
  private readonly rng: Rng
  private readonly walkEdges: number[] = []
  private readonly walkWeights: number[] = []
  private readonly portals: number[]
  private readonly ambientTarget: number
  private visible: Visibility = () => false
  private time = 0
  private doorSpeed = 1
  /** 每帧开始时各路段上的行人，按路段 id 索引。 */
  private readonly occupancy = new Map<number, Person[]>()
  /** 每帧开始时快走到各路口的行人，按节点 id 索引。 */
  private readonly approaching = new Map<number, Person[]>()

  private readonly base = new Matrix4()
  private readonly part = new Matrix4()
  private readonly out = new Matrix4()
  private readonly quat = new Quaternion()
  private readonly euler = new Euler()
  private readonly partEuler = new Euler()
  private readonly pos = new Vector3()
  private readonly scl = new Vector3()
  private readonly vec = new Vector3()
  private readonly color = new Color()
  private readonly point: Point2 = { x: 0, z: 0 }

  constructor(options: CrowdOptions) {
    const { shops, network, stopNodes, signal, seed } = options
    this.setDoorSpeed(options.doorSpeed ?? 1)
    this.network = network
    this.signal = signal
    this.rng = createRng(`crowd:${seed}`)
    this.portals = network.nodes.flatMap((node, id) => (node.portal && node.edges.length ? [id] : []))
    let total = 0
    network.edges.forEach((edge, id) => {
      if (edge.crossing || edge.length < 0.5) return
      total += edge.length
      this.walkEdges.push(id)
      this.walkWeights.push(total)
    })
    this.ambientTarget = Math.min(AMBIENT_MAX, Math.round(total / AMBIENT_SPACING))
    this.shops = shops.map((shop, index) => this.createShopState(shop, stopNodes[index * 2] ?? -1, stopNodes[index * 2 + 1] ?? -1))

    this.capacity = Math.max(
      1,
      this.shops.reduce((sum, shop) => sum + shop.slots + MAX_PIPELINE * MAX_DOOR_SPEED + 4, 0) + Math.ceil(this.ambientTarget * 1.5) + 16,
    )
    this.used = new Uint8Array(this.capacity)
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true })
    const create = (geometry: BufferGeometry, perSlot: number, colored = true) => {
      const count = this.capacity * perSlot
      const mesh = new InstancedMesh(geometry, this.material, count)
      mesh.castShadow = colored
      mesh.frustumCulled = false
      for (let i = 0; i < count; i += 1) {
        mesh.setMatrixAt(i, HIDDEN)
        if (colored) mesh.setColorAt(i, this.color.set(WHITE))
      }
      mesh.count = 0
      return mesh
    }
    this.legs = create(legGeometry(), 2)
    this.arms = create(armGeometry(), 2)
    this.hands = create(handGeometry(), 2)
    this.torso = create(torsoGeometry(), 1)
    this.head = create(headGeometry(), 1)
    this.eyes = create(eyeGeometry(), 1, false)
    this.hair = Array.from({ length: HAIR_STYLES }, (_, style) => create(hairGeometry(style as Hair), 1))
    this.pack = create(packGeometry(), 1)
    this.bag = create(bagGeometry(), 1)
    this.paired = new Set([this.legs, this.arms, this.hands])
    this.meshes = [this.legs, this.arms, this.hands, this.torso, this.head, this.eyes, ...this.hair, this.pack, this.bag]

    for (const shop of this.shops) {
      for (let i = 0; i < shop.target; i += 1) {
        const person = this.spawn()
        if (!person) break
        person.mode = 'queue'
        person.shop = shop
        person.s = shop.shop.queue.headS + i * shop.shop.queue.spacing
        shop.members.push(person)
        this.slide(person, shop, shop.shop.queuePath, person.s, 0, false)
        this.snap(person)
      }
    }
    for (let i = 0; i < this.ambientTarget; i += 1) this.spawnAmbient(false)
    this.update(0)
  }

  private createShopState(shop: CrowdShop, joinNode: number, exitNode: number): ShopState {
    const { queue, queuePath } = shop
    const target = Math.max(0, Math.min(MAX_QUEUE, Math.round(shop.queueSize)))
    const slots = queue.lanes * (Math.floor(LANE_LENGTH / queue.spacing) + 1)
    const threshold = queuePath.points[1] ?? queuePath.points[0] ?? { x: 0, z: 0 }
    const nodes = this.network.nodes
    const join = nodes[joinNode]
    const spawnOrder = join
      ? nodes
          .map((node, id) => ({ id, d: Math.hypot(node.x - join.x, node.z - join.z) }))
          .filter((entry) => entry.id !== joinNode && nodes[entry.id].edges.length > 0)
          .sort((a, b) => a.d - b.d)
          .map((entry) => entry.id)
      : []
    return {
      shop,
      joinNode,
      exitNode,
      target,
      capacity: Math.max(target, Math.min(slots, target + 6)),
      slots: Math.max(target, slots),
      members: [],
      inbound: 0,
      entering: null,
      inside: null,
      leaving: [],
      hideS: Math.max(0, queue.doorS - DOOR_HIDE),
      stepZ: threshold.z + 0.5,
      spawnOrder,
      travel: 14,
      cooldown: 0,
      delay: range(this.rng, 0, 2.5),
      bag: shop.plan.style.accent,
    }
  }

  // ---------------------------------------------------------------- 生命周期

  private allocate(): number {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.used[i]) continue
      this.used[i] = 1
      this.highWater = Math.max(this.highWater, i + 1)
      return i
    }
    return -1
  }

  /** 分配槽位并随机穿搭；返回的人还没有位置和状态。 */
  private spawn(): Person | null {
    const slot = this.allocate()
    if (slot < 0) return null
    const rng = this.rng
    const c = this.color
    const skin = pick(rng, SKIN)
    const longSleeve = rng() < 0.45
    const top = longSleeve && rng() < 0.5 ? pick(rng, JACKETS) : pick(rng, SHIRTS)
    const sleeve = longSleeve ? top : skin
    const pants = pick(rng, PANTS)
    this.torso.setColorAt(slot, c.set(top))
    this.head.setColorAt(slot, c.set(skin))
    for (const side of [0, 1]) {
      this.legs.setColorAt(slot * 2 + side, c.set(pants))
      this.arms.setColorAt(slot * 2 + side, c.set(sleeve))
      this.hands.setColorAt(slot * 2 + side, c.set(skin))
    }
    const roll = rng()
    const hair =
      roll < 0.32 ? Hair.Short : roll < 0.5 ? Hair.Long : roll < 0.62 ? Hair.Bun : roll < 0.74 ? Hair.Ponytail : roll < 0.9 ? Hair.Cap : -1
    if (hair >= 0) this.hair[hair].setColorAt(slot, c.set(hair === Hair.Cap ? pick(rng, HATS) : pick(rng, HAIR)))
    const pack = rng() < 0.22
    if (pack) this.pack.setColorAt(slot, c.set(pick(rng, PACKS)))
    this.colorsDirty = true

    const person: Person = {
      slot,
      alive: true,
      mode: 'walk',
      scale: range(rng, 0.9, 1.07),
      girth: range(rng, 0.9, 1.12),
      hair,
      pack,
      bag: false,
      seed: rng() * 10,
      speed: range(rng, 1.15, 1.55),
      lane: 0,
      laneGoal: 0,
      blocked: 0,
      occEdge: -1,
      occDir: 1,
      occAlong: 0,
      occNode: -1,
      occRest: 0,
      occNext: -1,
      replanned: -1,
      gate: CURB_GAP - 0.35 + range(rng, -0.25, 0.15),
      tx: 0,
      tz: 0,
      ty: Y,
      th: 0,
      tnx: 0,
      tnz: 0,
      x: 0,
      y: Y,
      z: 0,
      heading: 0,
      nx: 0,
      nz: 0,
      stride: 0,
      phase: rng() * Math.PI * 2,
      seen: false,
      route: [],
      step: 0,
      node: -1,
      dist: 0,
      granted: false,
      target: null,
      dispatchedAt: 0,
      shop: null,
      s: 0,
      goalS: 0,
      timer: 0,
    }
    person.lane = person.laneGoal = rng() < 0.6 ? range(rng, ...INNER_LANE) : range(rng, ...OUTER_LANE)
    this.people.push(person)
    return person
  }

  private despawn(person: Person): void {
    if (!person.alive) return
    person.alive = false
    if (person.target) person.target.inbound -= 1
    person.target = null
    this.used[person.slot] = 0
    this.hide(person.slot)
    while (this.highWater > 0 && !this.used[this.highWater - 1]) this.highWater -= 1
  }

  private hide(slot: number): void {
    for (const mesh of this.meshes) {
      if (this.paired.has(mesh)) {
        mesh.setMatrixAt(slot * 2, HIDDEN)
        mesh.setMatrixAt(slot * 2 + 1, HIDDEN)
      } else {
        mesh.setMatrixAt(slot, HIDDEN)
      }
    }
  }

  /** 直接把实际姿态设为目标姿态（新出生或开场摆位时）。 */
  private snap(person: Person): void {
    person.x = person.tx + person.tnx * person.lane
    person.z = person.tz + person.tnz * person.lane
    person.y = person.ty
    person.heading = person.th
    person.nx = person.tnx
    person.nz = person.tnz
  }

  /** 实际姿态向目标平滑靠拢：转角处侧移和朝向都会画出一小段弧线。 */
  private settle(person: Person, dt: number): void {
    const k = Math.min(1, dt * 6)
    person.nx += (person.tnx - person.nx) * k
    person.nz += (person.tnz - person.nz) * k
    person.x = person.tx + person.nx * person.lane
    person.z = person.tz + person.nz * person.lane
    person.y += (person.ty - person.y) * Math.min(1, dt * 12)
    person.heading += wrapAngle(person.th - person.heading) * Math.min(1, dt * 9)
  }

  private pace(person: Person, moved: number, dt: number): void {
    person.phase += moved * STRIDE_PER_METER
    const goal = moved > 1e-4 ? 1 : 0
    person.stride += (goal - person.stride) * Math.min(1, dt * 6)
  }

  // ---------------------------------------------------------------- 路网行走

  private pickWalkEdge(): number {
    const total = this.walkWeights[this.walkWeights.length - 1] ?? 0
    const r = this.rng() * total
    let lo = 0
    let hi = this.walkWeights.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.walkWeights[mid] < r) lo = mid + 1
      else hi = mid
    }
    return this.walkEdges[lo]
  }

  private randomDestination(from: number): number {
    const nodes = this.network.nodes
    for (let i = 0; i < 6; i += 1) {
      const id = this.portals.length > 1 && this.rng() < 0.55 ? pick(this.rng, this.portals) : Math.floor(this.rng() * nodes.length)
      if (id !== from && nodes[id]?.edges.length) return id
    }
    return -1
  }

  /** 在人行道上随机放一位路人；checkVisible 时只放在镜头外。 */
  private spawnAmbient(checkVisible: boolean): boolean {
    if (!this.walkEdges.length) return false
    const { nodes, edges } = this.network
    const edgeId = this.pickWalkEdge()
    const edge = edges[edgeId]
    const from = this.rng() < 0.5 ? edge.a : edge.b
    const to = otherEnd(edge, from)
    const dist = range(this.rng, 0, edge.length)
    const t = dist / edge.length
    const x = nodes[from].x + (nodes[to].x - nodes[from].x) * t
    const z = nodes[from].z + (nodes[to].z - nodes[from].z) * t
    if (checkVisible && this.visible(x, 1, z, SPAWN_MARGIN)) return false
    const person = this.spawn()
    if (!person) return false
    const dest = this.randomDestination(to)
    person.node = from
    person.dist = dist
    person.route = [edgeId, ...((dest >= 0 && shortestPath(this.network, to, dest)) || [])]
    this.walk(person, 0)
    this.snap(person)
    return true
  }

  /** 走到目的地后换一个新目的地。 */
  private wander(person: Person): void {
    const nodes = this.network.nodes
    const dest = this.randomDestination(person.node)
    const route = dest >= 0 ? shortestPath(this.network, person.node, dest) : null
    person.route = route && route.length ? route : nodes[person.node]?.edges.slice(0, 1) ?? []
    person.step = 0
    person.dist = 0
    person.granted = false
    person.replanned = -1
    if (!person.route.length) this.despawn(person)
  }

  private arrive(person: Person): void {
    const shop = person.target
    if (shop) {
      // 队伍比用量对应的人数多出一点缓冲后，后到的人当作路过，继续去别处逛
      const open = shop.members.length < Math.min(shop.capacity, shop.target + QUEUE_BUFFER)
      const tail = shop.members[shop.members.length - 1]
      // 前一位还没走进队道，先在人行道上等一下，免得叠在一起
      if (open && tail && tail.s > shop.shop.queuePath.length - shop.shop.queue.spacing) return
      person.target = null
      shop.inbound -= 1
      shop.travel = shop.travel * 0.8 + (this.time - person.dispatchedAt) * 0.2
      if (open) {
        person.mode = 'queue'
        person.shop = shop
        person.s = shop.shop.queuePath.length
        shop.members.push(person)
        return
      }
    }
    // 漫步者走到目的地：不在画面里就离开，否则换个方向继续逛
    if (!this.visible(person.x, 1, person.z, BODY_RADIUS)) {
      this.despawn(person)
      return
    }
    this.wander(person)
  }

  /** 沿路线前进；人行横道要等到绿灯剩余时间足够走完才起步，同向前面有人时跟着走或换道超过去。 */
  private walk(person: Person, dt: number): void {
    const { nodes, edges } = this.network
    this.preferGreen(person)
    const free = person.speed * dt
    const room = this.roomAhead(person)
    let move = Math.min(free, Math.max(0, room - FOLLOW_GAP))
    if (dt > 0) {
      person.blocked = move < free * 0.5 ? person.blocked + dt : 0
      if (person.blocked > OVERTAKE_AFTER) {
        person.blocked = 0
        this.overtake(person)
      }
      // 快到队伍入口时先靠回内侧，进队时不会带着横向偏移撞上队尾
      const last = person.route.length - 1
      if (person.target && person.step === last && this.network.edges[person.route[last]].length - person.dist < JOIN_APPROACH) {
        person.laneGoal = INNER_LANE[0]
      }
      const shift = person.laneGoal - person.lane
      person.lane += Math.sign(shift) * Math.min(Math.abs(shift), LANE_SHIFT * dt)
    }
    const budget = move
    while (person.step < person.route.length) {
      const edge = edges[person.route[person.step]]
      let limit = edge.length
      if (edge.crossing && !person.granted) {
        const gate = Math.min(person.gate, edge.length)
        if (person.dist + move >= gate) {
          const seconds = (edge.length - gate) / person.speed + 0.4
          if (this.signal.canCross(edge.crossing, seconds)) person.granted = true
          else limit = Math.max(person.dist, gate)
        }
      }
      if (person.dist + move < limit) {
        person.dist += move
        move = 0
        break
      }
      if (limit < edge.length) {
        move -= limit - person.dist
        person.dist = limit
        break
      }
      move -= edge.length - person.dist
      person.node = otherEnd(edge, person.node)
      person.dist = 0
      person.step += 1
      person.granted = false
    }
    this.pace(person, Math.max(0, budget - move), dt)

    const from = nodes[person.node]
    if (person.step >= person.route.length) {
      person.tx = from.x
      person.tz = from.z
      person.ty = Y
      return
    }
    const edge = edges[person.route[person.step]]
    const to = nodes[otherEnd(edge, person.node)]
    const dx = (to.x - from.x) / edge.length
    const dz = (to.z - from.z) / edge.length
    person.tx = from.x + dx * person.dist
    person.tz = from.z + dz * person.dist
    person.th = Math.atan2(dx, dz)
    person.tnx = -dz
    person.tnz = dx
    if (edge.crossing) {
      // 车行道比人行道低一级，走下路缘时平滑过渡
      const inset = Math.min(person.dist, edge.length - person.dist)
      person.ty = Y * Math.min(1, Math.max(0, (CURB_GAP + 0.2 - inset) / 0.4))
    } else {
      person.ty = Y
    }
  }

  // ---------------------------------------------------------------- 避让

  /** 记下每位路人此刻所在的路段、方向和位置；走完路线的人算作站在最后一段的终点。 */
  private indexWalkers(): void {
    const { edges } = this.network
    for (const list of this.occupancy.values()) list.length = 0
    for (const list of this.approaching.values()) list.length = 0
    for (const person of this.people) {
      person.occEdge = -1
      person.occNode = -1
      if (!person.alive || person.mode !== 'walk' || !person.route.length) continue
      const done = person.step >= person.route.length
      const edgeId = person.route[done ? person.route.length - 1 : person.step]
      const edge = edges[edgeId]
      if (done) {
        person.occDir = person.node === edge.b ? 1 : -1
        person.occAlong = person.occDir > 0 ? edge.length : 0
      } else {
        person.occDir = person.node === edge.a ? 1 : -1
        person.occAlong = person.occDir > 0 ? person.dist : edge.length - person.dist
      }
      person.occEdge = edgeId
      push(this.occupancy, edgeId, person)
      const rest = edge.length - person.dist
      if (done || rest > LOOKAHEAD) continue
      person.occNode = otherEnd(edge, person.node)
      person.occRest = rest
      person.occNext = person.route[person.step + 1] ?? -1
      push(this.approaching, person.occNode, person)
    }
  }

  /** 同向、横向会撞上的人里，离自己最近的那位还有多远；看当前路段，快走完时再看下一段。 */
  private roomAhead(person: Person): number {
    if (person.step >= person.route.length) return Infinity
    const { edges } = this.network
    const edgeId = person.route[person.step]
    const edge = edges[edgeId]
    const dir = person.node === edge.a ? 1 : -1
    const along = dir > 0 ? person.dist : edge.length - person.dist
    const nextId = person.route[person.step + 1]
    let room = Infinity
    for (const other of this.occupancy.get(edgeId) ?? []) {
      if (other === person || other.occDir !== dir || Math.abs(other.lane - person.lane) >= LANE_CLEAR) continue
      const ahead = (other.occAlong - along) * dir
      // 位置完全相同时按槽位先后让行，避免两人一直叠着走
      if (ahead > 0 || (ahead === 0 && other.slot < person.slot)) room = Math.min(room, ahead)
    }
    const rest = edge.length - person.dist
    if (room <= rest || rest > LOOKAHEAD || nextId === undefined) return room
    const node = otherEnd(edge, person.node)
    const next = edges[nextId]
    const nextDir = node === next.a ? 1 : -1
    // 拐弯时靠右的人会抄近路，实际相距比沿路线算的近，所以两种距离取小的
    for (const other of this.occupancy.get(nextId) ?? []) {
      if (other.occDir !== nextDir || Math.abs(other.lane - person.lane) >= LANE_CLEAR) continue
      room = Math.min(room, rest + (nextDir > 0 ? other.occAlong : next.length - other.occAlong), this.apart(person, other))
    }
    // 从别的路段拐进同一段路的人：离路口更近的先走，自己排在他后面
    for (const other of this.approaching.get(node) ?? []) {
      if (other === person || other.occNext !== nextId || other.occEdge === edgeId) continue
      if (Math.abs(other.lane - person.lane) >= LANE_CLEAR) continue
      if (other.occRest < rest || (other.occRest === rest && other.slot < person.slot)) {
        room = Math.min(room, rest - other.occRest, this.apart(person, other))
      }
    }
    return room
  }

  /** 快到路口、下一段要过的横道正亮红灯时，如果另一条绿灯横道走过去一样近，就改走它，路口不会积一大群人。 */
  private preferGreen(person: Person): void {
    const { nodes, edges } = this.network
    const nextId = person.route[person.step + 1]
    if (nextId === undefined) return
    const edge = edges[person.route[person.step]]
    const node = otherEnd(edge, person.node)
    if (person.replanned === node || edge.length - person.dist > LOOKAHEAD) return
    person.replanned = node
    const next = edges[nextId]
    if (!next.crossing || this.signal.canCross(next.crossing, next.length / person.speed + 0.4)) return
    let end = node
    for (let k = person.step + 1; k < person.route.length; k += 1) end = otherEnd(edges[person.route[k]], end)
    const rest = this.routeLength(person.route.slice(person.step + 1))
    for (const id of nodes[node].edges) {
      const alt = edges[id]
      if (id === nextId || !alt.crossing || !this.signal.canCross(alt.crossing, alt.length / person.speed + 0.4)) continue
      const path = shortestPath(this.network, otherEnd(alt, node), end)
      if (!path || alt.length + this.routeLength(path) > rest + REROUTE_SLACK) continue
      person.route = [...person.route.slice(0, person.step + 1), id, ...path]
      return
    }
  }

  private apart(a: Person, b: Person): number {
    return Math.hypot(a.x - b.x, a.z - b.z)
  }

  /** 被挡住时换到另一条小道：那条道前后一段同向没人才换。 */
  private overtake(person: Person): void {
    if (person.step >= person.route.length) return
    const edgeId = person.route[person.step]
    const edge = this.network.edges[edgeId]
    const dir = person.node === edge.a ? 1 : -1
    const along = dir > 0 ? person.dist : edge.length - person.dist
    const inner = person.laneGoal < (INNER_LANE[1] + OUTER_LANE[0]) / 2
    const goal = inner ? range(this.rng, ...OUTER_LANE) : range(this.rng, ...INNER_LANE)
    for (const other of this.occupancy.get(edgeId) ?? []) {
      if (other === person || other.occDir !== dir) continue
      if (Math.abs(other.occAlong - along) < OVERTAKE_CLEAR && Math.abs(other.lane - goal) < LANE_CLEAR) return
    }
    person.laneGoal = goal
  }

  // ---------------------------------------------------------------- 店铺

  /** 沿店铺路线把 s 推向 goal；forward 表示朝路线终点走（出店）。 */
  private slide(person: Person, shop: ShopState, line: Polyline, goal: number, dt: number, forward: boolean): void {
    const delta = goal - person.s
    const move = Math.sign(delta) * Math.min(Math.abs(delta), QUEUE_SPEED * dt)
    person.s += move
    const point = line.pointAt(person.s, this.point)
    person.tx = point.x
    person.tz = point.z
    person.th = line.headingAt(person.s) + (forward ? Math.PI : 0)
    person.tnx = 0
    person.tnz = 0
    person.ty = Y + STEP_H * Math.min(1, Math.max(0, (shop.stepZ - point.z) / 0.15))
    this.pace(person, Math.abs(move), dt)
  }

  private stepShop(shop: ShopState, step: number): void {
    const { queue, queuePath, exitPath } = shop.shop
    // 店门口的一切（排队前移、进门、店内停留、出门）都按进出速度快进
    const dt = step * this.doorSpeed
    shop.members.forEach((person, i) => {
      person.goalS = queue.headS + i * queue.spacing
      // 只往前挪，并和前一位保持一个排队间距，几个人同时进队也不会叠着走
      const ahead = shop.members[i - 1]
      const stop = ahead ? Math.max(person.goalS, ahead.s + queue.spacing) : person.goalS
      this.slide(person, shop, queuePath, Math.min(person.s, stop), dt, false)
    })

    // 店里没人、上一位出店者也走出门口一段，队首才进门
    shop.delay -= dt
    const last = shop.leaving[shop.leaving.length - 1]
    const clear = !last || last.s >= queue.doorS + EXIT_CLEAR
    const front = shop.members[0]
    if (dt > 0 && shop.delay <= 0 && !shop.entering && !shop.inside && clear && front && Math.abs(front.s - front.goalS) < 0.3) {
      shop.members.shift()
      front.mode = 'enter'
      shop.entering = front
    }

    const entering = shop.entering
    if (entering) {
      this.slide(entering, shop, queuePath, shop.hideS, dt, false)
      if (entering.s <= shop.hideS + 1e-3) {
        entering.mode = 'inside'
        entering.timer = range(this.rng, DWELL_MIN, DWELL_MAX)
        shop.entering = null
        shop.inside = entering
      }
    }

    const inside = shop.inside
    if (inside) {
      inside.timer -= dt
      if (inside.timer <= 0) {
        shop.inside = null
        inside.mode = 'exit'
        inside.s = shop.hideS
        inside.bag = true
        this.bag.setColorAt(inside.slot, this.color.set(shop.bag))
        this.colorsDirty = true
        this.slide(inside, shop, exitPath, inside.s, 0, true)
        this.snap(inside)
        shop.leaving.push(inside)
      }
    }

    for (let i = shop.leaving.length - 1; i >= 0; i -= 1) {
      const person = shop.leaving[i]
      this.slide(person, shop, exitPath, exitPath.length, dt, true)
      if (person.s < exitPath.length - 1e-3) continue
      shop.leaving.splice(i, 1)
      person.shop = null
      person.mode = 'walk'
      person.seen = true
      if (shop.exitNode < 0) {
        this.despawn(person)
        continue
      }
      person.node = shop.exitNode
      this.wander(person)
    }
  }

  /** 队伍缺人时派人来排队：优先请附近的路人改道，否则从镜头外最近的地方派一位。 */
  private dispatch(shop: ShopState): boolean {
    const { nodes, edges } = this.network
    const join = nodes[shop.joinNode]
    if (!join) return false
    let best: Person | null = null
    let bestD = RECRUIT_RADIUS
    for (const person of this.people) {
      if (!person.alive || person.mode !== 'walk' || person.target || person.step >= person.route.length) continue
      const edge = edges[person.route[person.step]]
      if (edge.crossing && person.granted) continue
      const next = nodes[otherEnd(edge, person.node)]
      const d = Math.hypot(next.x - join.x, next.z - join.z)
      if (d < bestD) {
        bestD = d
        best = person
      }
    }
    if (best) {
      const edgeId = best.route[best.step]
      const edge = edges[edgeId]
      const next = otherEnd(edge, best.node)
      const path = shortestPath(this.network, next, shop.joinNode)
      if (path) {
        best.route = [edgeId, ...path]
        best.step = 0
        best.replanned = -1
        this.assign(best, shop, edge.length - best.dist + this.routeLength(path))
        return true
      }
    }
    for (const id of shop.spawnOrder) {
      const node = nodes[id]
      if (this.visible(node.x, 1, node.z, SPAWN_MARGIN)) continue
      const path = shortestPath(this.network, id, shop.joinNode)
      if (!path || !path.length) continue
      const person = this.spawn()
      if (!person) return false
      person.node = id
      person.route = path
      this.walk(person, 0)
      this.snap(person)
      this.assign(person, shop, this.routeLength(path))
      return true
    }
    return false
  }

  private assign(person: Person, shop: ShopState, length: number): void {
    person.target = shop
    person.dispatchedAt = this.time
    shop.inbound += 1
    // 还没有人走到时先用路程估一个下限，之后由实测耗时接管
    shop.travel = Math.max(shop.travel, length / person.speed)
  }

  private routeLength(route: readonly number[]): number {
    return route.reduce((sum, id) => sum + this.network.edges[id].length, 0)
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number, visible?: Visibility): void {
    if (visible) this.visible = visible
    const step = Math.min(MAX_DT, Math.max(0, dt))
    this.time += step

    let ambient = 0
    for (const person of this.people) if (person.mode === 'walk' && !person.target) ambient += 1
    this.indexWalkers()

    for (const person of this.people) {
      if (!person.alive || person.mode !== 'walk') continue
      this.walk(person, step)
      if (person.step >= person.route.length) this.arrive(person)
      if (!person.alive || person.mode !== 'walk' || person.target) continue
      if (this.visible(person.x, 1, person.z, BODY_RADIUS)) person.seen = true
      else if (person.seen || ambient > this.ambientTarget * 1.2) {
        // 走出画面就离开；路人过多时，镜头外的人也提前离开
        this.despawn(person)
        ambient -= 1
      }
    }

    for (const shop of this.shops) this.stepShop(shop, step)

    if (step > 0) {
      for (const shop of this.shops) {
        shop.cooldown -= step
        if (shop.cooldown > 0) continue
        // 进出越快，路上要提前派出的人越多
        const limit = Math.ceil(MAX_PIPELINE * this.doorSpeed)
        const pipeline = Math.max(1, Math.min(limit, Math.ceil((shop.travel * TRAVEL_SLACK * this.doorSpeed) / CYCLE_SECONDS)))
        const short = shop.members.length + shop.inbound < shop.target + pipeline && shop.members.length < shop.capacity
        if (!short || shop.target === 0) continue
        shop.cooldown = this.dispatch(shop) ? 0.35 : 1
      }
      for (let i = 0; i < 2 && ambient < this.ambientTarget; i += 1) {
        if (this.spawnAmbient(true)) ambient += 1
      }
    }

    if (this.people.some((person) => !person.alive)) this.people = this.people.filter((person) => person.alive)
    for (const person of this.people) {
      this.settle(person, step)
      this.render(person)
    }
    this.commit()
  }

  private commit(): void {
    for (const mesh of this.meshes) {
      const count = this.highWater * (this.paired.has(mesh) ? 2 : 1)
      mesh.count = count
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(0, count * 16)
      mesh.instanceMatrix.needsUpdate = true
      if (this.colorsDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.colorsDirty = false
  }

  /** 在 base 的局部空间里放一个带旋转的部件，结果写入 out。 */
  private setPart(x: number, y: number, z: number, rx: number, ry: number, rz: number): Matrix4 {
    this.partEuler.set(rx, ry, rz, 'YXZ')
    this.quat.setFromEuler(this.partEuler)
    this.part.compose(this.pos.set(x, y, z), this.quat, ONE)
    return this.out.multiplyMatrices(this.base, this.part)
  }

  private render(person: Person): void {
    const { slot } = person
    if (person.mode === 'inside') {
      this.hide(slot)
      return
    }
    const t = this.time
    const walk = person.stride
    const idle = 1 - walk
    // 走路：摆臂迈腿、身体随步伐起伏并略微前倾；站着：重心左右换、东张西望、偶尔低头看手机
    const swing = Math.sin(person.phase) * 0.62 * walk
    const bob = Math.abs(Math.cos(person.phase)) * 0.045 * walk
    const sway = Math.sin(t * 1.3 + person.seed * 7) * 0.03 * idle
    this.euler.set(0.07 * walk, person.heading, sway, 'YXZ')
    this.quat.setFromEuler(this.euler)
    const width = person.scale * person.girth
    this.base.compose(this.pos.set(person.x, person.y + bob, person.z), this.quat, this.scl.set(width, person.scale, width))
    this.torso.setMatrixAt(slot, this.base)
    if (person.pack) this.pack.setMatrixAt(slot, this.base)

    const look = Math.sin(t * 0.43 + person.seed * 11) * Math.sin(t * 0.19 + person.seed * 5) * 1.1 * idle
    const nod = Math.max(0, Math.sin(t * 0.27 + person.seed * 3) - 0.6) * 0.8 * idle
    const head = this.setPart(0, NECK_Y, 0, nod, look, -sway * 0.8)
    this.head.setMatrixAt(slot, head)
    this.eyes.setMatrixAt(slot, head)
    if (person.hair >= 0) this.hair[person.hair].setMatrixAt(slot, head)

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1
      this.legs.setMatrixAt(slot * 2 + side, this.setPart(sign * HIP_X, HIP_Y, 0, swing * sign, 0, 0))
      // 右手（-x 一侧）提着购物袋时摆幅变小、手臂略向外张
      const carrying = person.bag && side === 1
      const armSwing = -swing * sign * (carrying ? 0.35 : 0.85)
      const spread = sign * (0.07 + (carrying ? 0.1 : 0) + 0.03 * idle)
      const arm = this.setPart(sign * SHOULDER_X, SHOULDER_Y, 0, armSwing, 0, spread)
      this.arms.setMatrixAt(slot * 2 + side, arm)
      this.hands.setMatrixAt(slot * 2 + side, arm)
      if (carrying) {
        this.vec.set(0, -HAND_Y, 0).applyEuler(this.partEuler)
        const bag = this.setPart(sign * SHOULDER_X + this.vec.x - 0.02, SHOULDER_Y + this.vec.y, this.vec.z, armSwing * 0.5, 0, 0)
        this.bag.setMatrixAt(slot, bag)
      }
    }
  }

  // ---------------------------------------------------------------- 对外查询

  /** 实时数据更新时调整某家店的排队目标人数，不重建人群；超出队道容量的部分截掉。 */
  setQueueTarget(shopId: string, queueSize: number): void {
    const shop = this.shops.find((item) => item.shop.id === shopId)
    if (!shop) return
    shop.target = Math.max(0, Math.min(MAX_QUEUE, shop.slots, Math.round(queueSize)))
    shop.capacity = Math.max(shop.target, Math.min(shop.slots, shop.target + 6))
  }

  /**
   * 进出店节奏的倍数：排队前移、进门、店内停留和出门一起加快，路上行人和车流不受影响。
   * 超出 MIN_DOOR_SPEED–MAX_DOOR_SPEED 的值会被截断。
   */
  setDoorSpeed(speed: number): void {
    this.doorSpeed = Number.isFinite(speed) ? Math.min(MAX_DOOR_SPEED, Math.max(MIN_DOOR_SPEED, speed)) : 1
  }

  /** 焦点店铺中随机一位排队者的头顶位置，供对话气泡定位。 */
  randomHead(shopId: string, rng: () => number = Math.random): { key: string; read: () => CrowdHead | null } | null {
    const shop = this.shops.find((s) => s.shop.id === shopId)
    if (!shop) return null
    // 只挑已经站定、离队首不远的人，气泡更容易出现在镜头里
    const candidates = shop.members.slice(0, 14).filter((person) => Math.abs(person.s - person.goalS) < 0.2)
    if (!candidates.length) return null
    const person = candidates[Math.floor(rng() * candidates.length)]
    return {
      key: `${shopId}:${person.slot}:${person.seed.toFixed(4)}`,
      read: () => {
        if (!person.alive || (person.mode !== 'queue' && person.mode !== 'enter')) return null
        return { x: person.x, y: person.y + HEAD_TOP * person.scale, z: person.z }
      },
    }
  }

  /** 当前所有行人的快照（测试与调试用）。 */
  members(): CrowdMember[] {
    const edges = this.network.edges
    return this.people.map((person) => {
      let road: Axis | null = null
      if (person.mode === 'walk' && person.step < person.route.length) {
        const edge = edges[person.route[person.step]]
        const inset = Math.min(person.dist, edge.length - person.dist)
        if (edge.crossing && inset > CURB_GAP) road = edge.crossing
      }
      return {
        mode: person.mode,
        x: person.x,
        z: person.z,
        road,
        shopId: person.shop?.shop.id ?? null,
        heading: person.target?.shop.id ?? null,
      }
    })
  }

  /** 某家店的队伍状态（测试与调试用）。 */
  shopStatus(shopId: string): { target: number; queued: number; inbound: number; busy: boolean; leaving: number } | null {
    const shop = this.shops.find((s) => s.shop.id === shopId)
    if (!shop) return null
    return {
      target: shop.target,
      queued: shop.members.length,
      inbound: shop.inbound,
      busy: Boolean(shop.entering || shop.inside),
      leaving: shop.leaving.length,
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    this.material.dispose()
  }
}

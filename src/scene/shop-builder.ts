import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three'
import { formatTokens } from '@/lib/format'
import { getLoadedLogo } from '@/lib/lab-logos'
import { createRng, pick, range, type Rng } from '@/lib/rng'
import type { LabShop } from '@/lib/town-data'
import type { LabStyle, Ornament } from '@/scene/lab-styles'
import { LOT_D, LOT_W, SIDEWALK_H, type LotSlot } from '@/scene/layout'
import {
  addBench,
  addFlowerBed,
  addTree,
  GRASS,
  HEDGE,
  LEAVES,
  shadeHex,
  type LightPool,
  type TownBuckets,
} from '@/scene/props'
import { RocketRig } from '@/scene/rocket'
import { planShop, Polyline, queueLayout, type QueueLayout, type ShopPlan } from '@/scene/shop-layout'
import { createGraffitiTexture, createPlaqueTexture, createSignTexture } from '@/scene/textures'

/**
 * 一家厂商门店：整块地块（前院、侧院、绿篱）、楼体、正立面、屋顶和屋顶装饰。
 * 静态几何写进共享的顶点色缓冲，招牌、挂牌和背墙涂鸦是带贴图的平面，挂在 root 下。
 * 店门统一开在正立面右侧，门牌挂在门右边的墙上；门左侧是蛇形排队区。
 */
export interface BuiltShop {
  id: string
  index: number
  row: number
  col: number
  root: Group
  hitBox: Mesh
  plan: ShopPlan
  queue: QueueLayout
  /** 门口排队人数。 */
  queueSize: number
  /** 世界坐标下的入队路线（起点在店内，终点在人行道步行线）。 */
  queuePath: Polyline
  /** 世界坐标下的出店路线。 */
  exitPath: Polyline
  /** 入队口与出店口在人行道步行线上的世界坐标 x。 */
  joinX: number
  exitX: number
  focus: Vector3
  labelAnchor: Vector3
  /** 夜间点光源候选位置（店门前）。 */
  lightSpot: Vector3
  pools: LightPool[]
  /** 贴图平面材质，昼夜切换时按 weight 调节自发光强度。 */
  glowMaterials: { material: MeshStandardMaterial; weight: number }[]
  /** 屋顶会定时发射的火箭（xAI 店），其他店为 null。 */
  rocket: RocketRig | null
  /** 实时数据更新时重画门旁挂牌上的本周用量；文字没变就不重画。 */
  refreshPlaque(shop: LabShop): void
  dispose(): void
}

export interface BuildShopOptions {
  anisotropy: number
}

const Y = SIDEWALK_H
const CREAM = '#f3eee4'
const METAL = '#2b2c31'
const BRASS = '#c9a34a'
const WOOD = '#6b4a33'
const WOOD_DARK = '#4a3526'
const LIT = ['#ffd48a', '#ffe2b0', '#ffc46b', '#ffdca0', '#bcd6ff']
const UNLIT = '#1a2030'
const INTERIOR = '#ffd9a0'
const FLOWERS = ['#e0607a', '#f2c14e', '#f6f1e6', '#9c6ade', '#ef8a4c']
const GABLE_H = 2.4
const BARREL_RISE = 2.2
const SAWTOOTH_H = 1.5
const HIT_MATERIAL = new MeshBasicMaterial({ visible: false })
/** 有火箭的店镜头焦点抬高的距离（米）。 */
const ROCKET_VIEW_LIFT = 5

/** 需要台座才能立在坡屋顶上的装饰；灯笼、月亮、云、烟囱、水塔和鲸鱼自己处理落点。 */
const PEDESTAL = new Set<Ornament>(['garden', 'blocks', 'dish', 'wave', 'bean', 'rocket', 'car', 'pixels', 'loop', 'scroll'])
/** 各装饰在落点之上的大致高度，用来估算悬停标签的位置。 */
const ORNAMENT_H: Record<Ornament, number> = {
  garden: 2.2,
  chimney: 1.2,
  blocks: 2.3,
  whale: 2.8,
  lanterns: 0,
  moon: 5.5,
  dish: 2.6,
  wave: 2.4,
  bean: 3.2,
  rocket: 5.6,
  cloud: 2.8,
  car: 1.6,
  pixels: 2.4,
  loop: 2.9,
  scroll: 1.2,
  tower: 4.2,
}

// 自定义单位几何，交给 GeometryBucket 按 key 缓存
const ico1 = () => new IcosahedronGeometry(1, 1)
/** 直边在上、圆弧朝下的半圆片，厚度沿 z。 */
const halfDisc = () =>
  new CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2)
const hemisphere = () => new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
/** 沿 x 的半圆筒，向 +y 拱起。 */
const barrelVault = () => new CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)
const crescent = () => new TorusGeometry(1, 0.28, 8, 24, Math.PI * 1.25)
const ring = () => new TorusGeometry(1, 0.22, 10, 28)
const capsule = () => new CapsuleGeometry(0.8, 1.0, 6, 12)
const diamond = () => new OctahedronGeometry(1, 0)

/** 单位四坡顶：底面 [-0.5, 0.5]²，高 1，屋脊沿 x。 */
function hipRoof(): BufferGeometry {
  const inset = 0.28
  const a = [-0.5, 0, -0.5]
  const b = [0.5, 0, -0.5]
  const c = [0.5, 0, 0.5]
  const d = [-0.5, 0, 0.5]
  const r1 = [-0.5 + inset, 1, 0]
  const r2 = [0.5 - inset, 1, 0]
  const triangles = [d, c, r2, d, r2, r1, b, a, r1, b, r1, r2, a, d, r1, c, b, r2]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(triangles.flat(), 3))
  geometry.computeVertexNormals()
  return geometry
}

function v(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z)
}

/** 组合件（小车、书）的父级变换，只用来摆放顶点，不创建场景节点。 */
function frameMatrix(x: number, y: number, z: number, rotY = 0, rotX = 0): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(rotX, rotY, 0)).setPosition(x, y, z)
}

function litWindow(rng: Rng): string {
  if (rng() < 0.3) return UNLIT
  return rng() < 0.08 ? LIT[4] : pick(rng, LIT.slice(0, 4))
}

/** 深色外墙的石材装饰要提亮，浅色外墙则压暗。 */
function stoneTone(wall: string): string {
  const { l } = new Color(wall).getHSL({ h: 0, s: 0, l: 0 })
  return shadeHex(wall, l < 0.35 ? 1.7 : 0.86)
}

interface Ctx extends TownBuckets {
  rng: Rng
  /** 屋顶火箭的发射台台面中心；只有 rocket 装饰会设置。 */
  rocketPad?: Vector3
  style: LabStyle
  plan: ShopPlan
  ox: number
  oz: number
  bx: number
  W: number
  D: number
  front: number
  back: number
  cz: number
  top: number
  doorX: number
}

interface Deck {
  x: number
  z: number
  /** 装饰落点高度。 */
  y: number
  /** 屋顶本身最高点。 */
  peak: number
}

// ---------------------------------------------------------------- 地块

function buildLot(c: Ctx, queue: QueueLayout): void {
  const { solid, rng, ox, oz, bx, W, front, back } = c
  const lotL = ox - LOT_W / 2 + 0.2
  const lotR = ox + LOT_W / 2 - 0.2
  const backZ = oz - LOT_D + 0.2

  // 前院铺装与铺装缝
  const yardD = oz - 0.2 - front
  solid.boxOn(LOT_W - 0.4, 0.03, yardD, ox, Y, front + yardD / 2, '#c9bfb0')
  for (let z = front + 1.5; z < oz - 0.3; z += 1.5) solid.boxOn(LOT_W - 0.4, 0.04, 0.04, ox, Y, z, '#b5ab9b')

  // 侧院与后院草地
  const grass = (x0: number, x1: number, z0: number, z1: number) => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return
    solid.boxOn(x1 - x0, 0.05, z1 - z0, (x0 + x1) / 2, Y, (z0 + z1) / 2, GRASS)
  }
  grass(lotL, bx - W / 2, backZ, front)
  grass(bx + W / 2, lotR, backZ, front)
  grass(bx - W / 2, bx + W / 2, backZ, back)

  // 绿篱：两侧从前院中段一直到后院，后侧一道矮篱
  for (const side of [-1, 1]) solid.boxOn(0.55, 0.85, 18.4, ox + side * 8.55, Y, oz - 12.4, HEDGE)
  solid.boxOn(LOT_W - 0.4, 0.6, 0.5, ox, Y, oz - LOT_D + 0.45, HEDGE)

  // 临街低路缘，在入队口和出店口各留一个缺口
  const curb = (a: number, b: number) => {
    if (b - a > 0.05) solid.boxOn(b - a, 0.12, 0.25, (a + b) / 2, Y, oz - 0.12, '#a39a8e')
  }
  let x0 = lotL
  for (const gap of [ox + queue.joinX, ox + queue.exitX].sort((a, b) => a - b)) {
    curb(x0, gap - 0.9)
    x0 = gap + 0.9
  }
  curb(x0, lotR)

  addTree(solid, rng, ox - 7.9, Y, oz - 1.6, 0.9)
  const bedL = ox + queue.laneEndX + 1.2
  const bedR = ox + queue.laneStartX - 1.6
  addFlowerBed(solid, rng, (bedL + bedR) / 2, oz - 2.3, bedR - bedL, 1.1)
  addBench(solid, ox + 7.8, oz - 4, -Math.PI / 2)

  // 后院垃圾桶
  const binZ = back - 0.42
  for (const [dx, color] of [
    [0.7, '#3f6f4a'],
    [1.5, '#4a5566'],
  ] as const) {
    const x = bx - W / 2 + dx
    solid.boxOn(0.7, 0.95, 0.5, x, Y, binZ, color)
    solid.boxOn(0.76, 0.06, 0.56, x, Y + 0.95, binZ, shadeHex(color, 0.8))
  }
}

// ---------------------------------------------------------------- 楼体

function buildBody(c: Ctx): void {
  const { solid, windows, style, plan, bx, W, D, cz, front, back } = c
  solid.boxOn(W, plan.height, D, bx, Y, cz, style.wall, { shade: 0.74 })
  for (const side of [-1, 1]) {
    // 落水管
    solid.cylinder(0.07, 0.07, plan.height - 0.2, bx + side * (W / 2 + 0.08), Y, back + 0.3, '#5d6068', 6)
    // 首层侧墙靠前的一扇窗
    solid.boxOn(0.08, 2.1, 2.6, bx + side * (W / 2 + 0.02), Y + 0.5, front - 1.8, style.trim)
    windows.boxOn(0.06, 1.9, 2.4, bx + side * (W / 2 + 0.05), Y + 0.6, front - 1.8, INTERIOR)
  }
}

/** 首层店面：壁柱、橱窗、右侧店门、门右墙上的挂牌底座。返回橱窗范围供雨棚使用。 */
function buildStorefront(c: Ctx): { winR: number; winCx: number } {
  const { solid, windows, glow, rng, style, plan, bx, W, front, doorX } = c
  const trim = style.trim
  const gh = plan.groundH

  for (const side of [-1, 1]) solid.boxOn(0.4, gh, 0.2, bx + side * (W / 2 - 0.2), Y, front + 0.1, trim)
  solid.box(W + 0.1, 0.3, 0.3, bx, Y + gh, front + 0.15, trim)
  solid.boxOn(W, 0.35, 0.12, bx, Y, front + 0.06, '#4a4541')

  // 橱窗
  const winL = bx - W / 2 + 0.7
  const winR = doorX - plan.doorW / 2 - 0.45
  const winW = winR - winL
  const winCx = (winL + winR) / 2
  windows.boxOn(winW, 2.15, 0.1, winCx, Y + 0.55, front + 0.07, INTERIOR)
  solid.boxOn(winW + 0.3, 0.1, 0.3, winCx, Y + 0.45, front + 0.15, trim)
  solid.boxOn(winW + 0.3, 0.16, 0.2, winCx, Y + 2.7, front + 0.1, trim)
  const panes = Math.max(2, Math.ceil(winW / 2.3))
  for (let i = 1; i < panes; i += 1) solid.boxOn(0.1, 2.15, 0.14, winL + (winW * i) / panes, Y + 0.55, front + 0.1, trim)
  for (const x of [winL, winR]) solid.boxOn(0.12, 2.15, 0.16, x, Y + 0.55, front + 0.1, trim)
  // 橱窗里的“营业中”灯牌和几件陈列品
  glow.box(0.9, 0.28, 0.04, winR - 0.8, Y + 2.25, front + 0.15, style.accent)
  for (let i = 0; i < 3; i += 1) {
    const x = winL + 0.9 + i * 1.3 + range(rng, -0.2, 0.2)
    solid.boxOn(0.5, range(rng, 0.35, 0.6), 0.3, x, Y + 0.55, front + 0.25, pick(rng, [style.accent, CREAM, trim]))
  }

  // 双开门
  const dw = plan.doorW
  solid.boxOn(dw + 0.34, 2.78, 0.14, doorX, Y, front + 0.05, trim)
  windows.boxOn(dw, 2.56, 0.06, doorX, Y, front + 0.12, '#ffc877')
  solid.boxOn(0.06, 2.56, 0.08, doorX, Y, front + 0.14, trim)
  solid.boxOn(dw, 0.3, 0.08, doorX, Y, front + 0.14, trim)
  for (const side of [-1, 1]) solid.boxOn(0.05, 0.5, 0.06, doorX + side * 0.14, Y + 1.0, front + 0.19, BRASS)
  solid.boxOn(dw + 0.7, 0.12, 0.7, doorX, Y, front + 0.35, '#8e877f')
  solid.boxOn(1.4, 0.03, 0.8, doorX, Y, front + 1.15, style.accent)
  // 门头雨罩与斜撑
  solid.box(dw + 0.3, 0.1, 0.9, doorX, Y + 2.95, front + 0.45, style.accent, { rotX: 0.12 })
  for (const side of [-1, 1]) {
    const x = doorX + side * (dw / 2 + 0.05)
    solid.segment(v(x, Y + 2.55, front + 0.02), v(x, Y + 2.92, front + 0.8), 0.04, METAL)
  }

  // 挂牌底座与上方壁灯（贴图平面在 buildShop 里加）
  const plaqueX = c.ox + plan.plaqueX
  solid.box(1.08, 1.43, 0.06, plaqueX, Y + 1.75, front + 0.03, '#6d5020')
  solid.segment(v(plaqueX, Y + 2.55, front + 0.02), v(plaqueX, Y + 2.62, front + 0.35), 0.04, METAL)
  glow.box(0.22, 0.08, 0.16, plaqueX, Y + 2.58, front + 0.38, '#ffe6b0')

  // 墙角花盆，顶端低于挂牌下沿
  const potX = bx + W / 2 - 0.35
  solid.cylinder(0.3, 0.24, 0.5, potX, Y, front + 0.5, '#8d6e5a', 8)
  solid.blob(0.28, potX, Y + 0.7, front + 0.5, pick(rng, LEAVES), undefined, 0.9)

  // 门头招牌背框与鹅颈灯
  const signW = signWidth(W)
  solid.box(signW + 0.3, SIGN_H + 0.26, 0.22, bx, Y + SIGN_Y, front + 0.26, '#26221f')
  for (const k of [-1, 0, 1]) {
    const x = bx + (signW / 3) * k
    solid.segment(v(x, Y + 4.6, front + 0.3), v(x, Y + 4.9, front + 0.7), 0.05, METAL)
    solid.segment(v(x, Y + 4.9, front + 0.7), v(x, Y + 4.78, front + 0.95), 0.05, METAL)
    glow.box(0.34, 0.07, 0.18, x, Y + 4.75, front + 0.97, '#fff1d0')
  }
  return { winR, winCx }
}

const SIGN_H = 1.2
const SIGN_Y = 3.78

function signWidth(width: number): number {
  return Math.min(width - 2.8, 10.6)
}

// ---------------------------------------------------------------- 雨棚

function buildAwning(c: Ctx, winR: number): void {
  const { solid, glow, style, bx, W, front } = c
  if (style.awning === 'none') return
  const awL = bx - W / 2 + 0.35
  const awR = winR + 0.2
  const awW = awR - awL
  const awCx = (awL + awR) / 2
  const colors = style.awningColors.length ? style.awningColors : [style.accent]

  if (style.awning === 'canopy') {
    // 平板雨篷用墙上的膝撑托住，不用上拉杆，免得穿过招牌
    solid.box(awW, 0.12, 1.5, awCx, Y + 2.95, front + 0.75, colors[0])
    for (const x of [awL + 0.3, awCx, awR - 0.3]) solid.segment(v(x, Y + 2.45, front + 0.02), v(x, Y + 2.9, front + 1.2), 0.05, METAL)
    glow.box(awW, 0.05, 0.05, awCx, Y + 2.87, front + 1.5, '#fff1d0')
    return
  }

  const depth = 2.2
  const drop = 0.55
  const tilt = Math.atan2(drop, depth)
  const slope = Math.hypot(drop, depth)
  const topY = Y + 3.05
  const edgeY = topY - drop
  const face = (x: number, w: number, color: string) =>
    solid.box(w, 0.07, slope, x, topY - drop / 2, front + depth / 2, color, { rotX: tilt })
  const valance = (x: number, w: number, color: string) =>
    solid.box(w, 0.32, 0.05, x, edgeY - 0.16, front + depth + 0.01, color)

  if (style.awning === 'stripes') {
    const n = Math.max(2, Math.round(awW / 0.55))
    const sw = awW / n
    for (let i = 0; i < n; i += 1) {
      const color = colors.length > 1 ? colors[i % colors.length] : i % 2 === 0 ? colors[0] : CREAM
      const x = awL + sw * (i + 0.5)
      face(x, sw, color)
      valance(x, sw, color)
    }
  } else if (style.awning === 'solid') {
    face(awCx, awW, colors[0])
    valance(awCx, awW, shadeHex(colors[0], 0.85))
  } else {
    face(awCx, awW, colors[0])
    const n = Math.max(3, Math.round(awW / 0.6))
    const r = awW / n / 2
    for (let i = 0; i < n; i += 1) {
      solid.custom('halfdisc', halfDisc, r, r, 0.05, awL + r * (2 * i + 1), edgeY, front + depth + 0.01, colors[i % colors.length])
    }
  }
  for (const x of [awL + 0.1, awR - 0.1]) solid.segment(v(x, Y + 2.35, front + 0.02), v(x, edgeY + 0.02, front + depth - 0.1), 0.05, METAL)
}

// ---------------------------------------------------------------- 上层

function upperWindow(c: Ctx, x: number, y0: number): void {
  c.solid.boxOn(1.4, 1.95, 0.08, x, y0 + 0.63, c.front + 0.02, c.style.trim)
  c.windows.boxOn(1.15, 1.7, 0.06, x, y0 + 0.75, c.front + 0.05, litWindow(c.rng))
  c.solid.boxOn(1.6, 0.08, 0.2, x, y0 + 0.55, c.front + 0.08, c.style.trim)
}

function spread(from: number, to: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count)
}

function buildUpperFloors(c: Ctx): void {
  const { solid, windows, rng, style, plan, bx, W, D, cz, front, back } = c
  const trim = style.trim
  const fh = plan.floorH
  for (let k = 0; k < plan.upperFloors; k += 1) {
    const y0 = Y + plan.groundH + k * fh
    const topFloor = k === plan.upperFloors - 1
    if (k > 0) solid.box(W + 0.04, 0.22, 0.08, bx, y0 + 0.05, front + 0.02, trim)

    switch (style.facade) {
      case 'glass': {
        const span = W - 0.6
        const cols = Math.max(3, Math.round(span / 1.6))
        const pw = span / cols
        const h = fh - 0.5
        for (let i = 0; i < cols; i += 1) windows.boxOn(pw, h, 0.06, bx - span / 2 + pw * (i + 0.5), y0 + 0.3, front + 0.04, litWindow(rng))
        for (let i = 0; i <= cols; i += 1) solid.boxOn(0.08, h, 0.1, bx - span / 2 + pw * i, y0 + 0.3, front + 0.05, trim)
        solid.box(W + 0.04, 0.3, 0.1, bx, y0 + 0.15, front + 0.03, trim)
        break
      }
      case 'brick': {
        const cols = Math.max(2, Math.floor((W - 1.4) / 2.6))
        solid.box(W + 0.06, 0.14, 0.08, bx, y0 + 0.5, front + 0.02, trim)
        for (const x of spread(bx - W / 2 + 0.7, bx + W / 2 - 0.7, cols)) {
          upperWindow(c, x, y0)
          solid.boxOn(1.6, 0.22, 0.1, x, y0 + 2.58, front + 0.04, shadeHex(style.wall, 0.8))
        }
        break
      }
      case 'timber': {
        const cols = Math.max(2, Math.floor((W - 1.4) / 2.6))
        const left = bx - W / 2 + 0.2
        const bay = (W - 0.4) / cols
        solid.box(W + 0.04, 0.2, 0.1, bx, y0 + 0.12, front + 0.03, trim)
        solid.box(W + 0.04, 0.2, 0.1, bx, y0 + fh - 0.12, front + 0.03, trim)
        for (let i = 0; i <= cols; i += 1) solid.boxOn(0.18, fh, 0.1, left + bay * i, y0, front + 0.03, trim)
        for (let i = 0; i < cols; i += 1) {
          const x = left + bay * (i + 0.5)
          upperWindow(c, x, y0)
          for (const s of [-1, 1]) {
            solid.segment(v(x + s * (bay / 2 - 0.1), y0 + 0.2, front + 0.05), v(x + s * 0.75, y0 + 0.62, front + 0.05), 0.09, trim)
          }
        }
        break
      }
      case 'stucco': {
        const cols = Math.max(2, Math.floor((W - 1.4) / 2.8))
        for (const x of spread(bx - W / 2 + 0.7, bx + W / 2 - 0.7, cols)) {
          upperWindow(c, x, y0)
          for (const s of [-1, 1]) solid.boxOn(0.5, 1.7, 0.06, x + s * 0.98, y0 + 0.75, front + 0.03, style.accent)
          solid.boxOn(1.3, 0.28, 0.3, x, y0 + 0.3, front + 0.15, '#8d6e5a')
          for (let f = 0; f < 4; f += 1) solid.blob(0.16, x - 0.45 + f * 0.3, y0 + 0.66, front + 0.2, pick(rng, FLOWERS), undefined, 0.8)
        }
        break
      }
      case 'panel': {
        solid.box(W + 0.02, 0.05, 0.04, bx, y0 + 0.02, front + 0.01, shadeHex(style.wall, 0.82))
        const cols = Math.max(2, Math.round((W - 1.2) / 3.2))
        const seg = (W - 1.2) / cols
        for (const x of spread(bx - W / 2 + 0.6, bx + W / 2 - 0.6, cols)) {
          solid.boxOn(seg - 0.2, 1.5, 0.08, x, y0 + 0.8, front + 0.02, trim)
          windows.boxOn(seg - 0.4, 1.3, 0.06, x, y0 + 0.9, front + 0.05, litWindow(rng))
        }
        if (topFloor) solid.box(W + 0.02, 0.25, 0.06, bx, y0 + fh - 0.5, front + 0.02, style.accent)
        break
      }
      case 'stone': {
        const tone = stoneTone(style.wall)
        const cols = Math.max(2, Math.floor((W - 1.4) / 2.6))
        for (const x of spread(bx - W / 2 + 0.7, bx + W / 2 - 0.7, cols)) {
          upperWindow(c, x, y0)
          solid.boxOn(1.7, 0.3, 0.14, x, y0 + 2.58, front + 0.05, tone)
          solid.boxOn(0.3, 0.42, 0.2, x, y0 + 2.54, front + 0.08, shadeHex(tone, 0.9))
        }
        // 转角隅石，长短交替
        for (let q = 0; q < 5; q += 1) {
          const w = q % 2 === 0 ? 0.8 : 0.5
          const qy = y0 + 0.1 + q * 0.62
          for (const s of [-1, 1]) solid.box(w, 0.5, w, bx + s * (W / 2 - w / 2 + 0.04), qy + 0.25, front - w / 2 + 0.04, tone)
        }
        break
      }
    }

    // 侧窗与背窗
    if (style.facade === 'glass') {
      for (const s of [-1, 1]) {
        windows.boxOn(0.06, fh - 0.5, D - 1.2, bx + s * (W / 2 + 0.03), y0 + 0.3, cz, litWindow(rng))
        for (const z of spread(back + 0.6, front - 0.6, 3).concat([back + 0.6, front - 0.6])) {
          solid.boxOn(0.1, fh - 0.5, 0.08, bx + s * (W / 2 + 0.05), y0 + 0.3, z, trim)
        }
      }
    } else {
      const sideCols = Math.max(2, Math.floor((D - 1.4) / 2.4))
      for (const s of [-1, 1]) {
        for (const z of spread(back + 0.7, front - 0.7, sideCols)) {
          solid.boxOn(0.08, 1.95, 1.4, bx + s * (W / 2 + 0.02), y0 + 0.63, z, trim)
          windows.boxOn(0.06, 1.7, 1.15, bx + s * (W / 2 + 0.05), y0 + 0.75, z, litWindow(rng))
        }
      }
    }
    const backCols = Math.max(2, Math.floor((W - 1.4) / 2.8))
    for (const x of spread(bx - W / 2 + 0.7, bx + W / 2 - 0.7, backCols)) {
      solid.boxOn(1.4, 1.95, 0.08, x, y0 + 0.63, back - 0.02, trim)
      windows.boxOn(1.15, 1.7, 0.06, x, y0 + 0.75, back - 0.05, litWindow(rng))
    }
  }
}

// ---------------------------------------------------------------- 屋顶

function flatRoof(c: Ctx, withStair: boolean): void {
  const { solid, style, bx, W, D, cz, front, back, top } = c
  solid.box(W - 0.44, 0.04, D - 0.44, bx, top + 0.04, cz, style.roofColor)
  const parapet = shadeHex(style.wall, 0.92)
  for (const z of [front - 0.11, back + 0.11]) {
    solid.boxOn(W, 0.7, 0.22, bx, top, z, parapet)
    solid.box(W + 0.1, 0.08, 0.32, bx, top + 0.74, z, style.trim)
  }
  for (const s of [-1, 1]) {
    const x = bx + s * (W / 2 - 0.11)
    solid.boxOn(0.22, 0.7, D - 0.44, x, top, cz, parapet)
    solid.box(0.32, 0.08, D - 0.44, x, top + 0.74, cz, style.trim)
  }
  if (withStair) {
    const sx = bx + W / 2 - 1.8
    const sz = cz - D / 4
    solid.boxOn(2.2, 2.1, 2.4, sx, top, sz, shadeHex(style.wall, 0.9))
    solid.box(2.5, 0.12, 2.7, sx, top + 2.16, sz, style.trim)
    solid.boxOn(0.8, 1.6, 0.05, sx, top, sz + 1.21, '#3b3f46')
  }
  // 空调外机
  const ax = bx - W / 2 + 1.5
  const az = back + 1.4
  solid.boxOn(1.3, 0.8, 1.0, ax, top, az, '#b9bcc0')
  solid.cylinder(0.32, 0.32, 0.03, ax, top + 0.8, az, '#6b6f75', 10)
}

function buildRoof(c: Ctx): Deck {
  const { solid, windows, rng, style, plan, bx, W, D, cz, front, back, top } = c
  if (plan.roof !== 'eaves') solid.box(W + 0.3, 0.28, D + 0.3, bx, top - 0.12, cz, style.trim)

  switch (plan.roof) {
    case 'flat':
      flatRoof(c, true)
      return { x: bx - 0.5, z: cz + 0.5, y: top + 0.06, peak: top + 2.3 }

    case 'gable': {
      const hd = D / 2
      const t = 0.07
      const angle = Math.atan2(GABLE_H, hd)
      const hyp = Math.hypot(GABLE_H, hd)
      solid.prism(
        [
          [-hd, 0],
          [hd, 0],
          [0, GABLE_H],
        ],
        W,
        bx,
        top,
        cz,
        style.wall,
      )
      for (const s of [-1, 1]) {
        const y = top + GABLE_H / 2 + t * Math.cos(angle)
        const z = cz + s * (hd / 2 + t * Math.sin(angle))
        solid.box(W + 0.5, t * 2, hyp + 0.5, bx, y, z, style.roofColor, { rotX: s * angle })
        // 山墙阁楼窗
        const x = bx + s * (W / 2 + 0.02)
        solid.boxOn(0.08, 0.9, 0.9, x, top + 0.4, cz, style.trim)
        windows.boxOn(0.06, 0.7, 0.7, bx + s * (W / 2 + 0.05), top + 0.5, cz, litWindow(rng))
      }
      solid.box(W + 0.6, 0.18, 0.32, bx, top + GABLE_H + 0.1, cz, shadeHex(style.roofColor, 0.8))
      return { x: bx, z: cz, y: top + GABLE_H, peak: top + GABLE_H + 0.2 }
    }

    case 'sawtooth': {
      const n = 3
      const toothD = D / n
      for (let i = 0; i < n; i += 1) {
        const z = back + toothD * (i + 0.5)
        solid.prism(
          [
            [-toothD / 2, 0],
            [toothD / 2, 0],
            [toothD / 2, SAWTOOTH_H],
          ],
          W,
          bx,
          top,
          z,
          style.roofColor,
        )
        windows.boxOn(W - 0.4, SAWTOOTH_H - 0.3, 0.06, bx, top + 0.1, z + toothD / 2 + 0.04, '#cfe3ff')
      }
      return { x: bx, z: cz, y: top + SAWTOOTH_H, peak: top + SAWTOOTH_H }
    }

    case 'eaves': {
      const roofColor = style.roofColor
      const dark = shadeHex(roofColor, 0.75)
      const span = W + 1.6
      solid.box(W + 1.7, 0.18, D + 1.7, bx, top + 0.09, cz, style.trim)
      solid.custom('hip', hipRoof, span, 2.2, D + 1.6, bx, top + 0.18, cz, roofColor)
      // 四角起翘
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          solid.segment(
            v(bx + sx * (W / 2 + 0.8), top + 0.2, cz + sz * (D / 2 + 0.8)),
            v(bx + sx * (W / 2 + 1.25), top + 0.75, cz + sz * (D / 2 + 1.25)),
            0.18,
            dark,
          )
        }
      }
      // 屋脊与两端鸱吻
      const ridgeY = top + 0.18 + 2.2
      const half = 0.22 * span
      solid.box(half * 2, 0.2, 0.3, bx, ridgeY + 0.08, cz, dark)
      for (const s of [-1, 1]) solid.segment(v(bx + s * half, ridgeY, cz), v(bx + s * (half + 0.3), ridgeY + 0.55, cz), 0.22, dark)
      // 檐下的红柱，给紫色外墙添一点对比
      for (const s of [-1, 1]) solid.boxOn(0.3, plan.height - plan.groundH - 0.1, 0.3, bx + s * (W / 2 + 0.05), Y + plan.groundH, front + 0.05, '#b8322a')
      return { x: bx, z: cz, y: top + 2.4, peak: ridgeY + 0.6 }
    }

    case 'dome': {
      flatRoof(c, false)
      const dx = bx - 0.8
      const dz = cz - 0.6
      const baseY = top + 1.2
      solid.cylinder(2.6, 2.6, 1.2, dx, top, dz, style.trim, 16)
      solid.custom('hemi', hemisphere, 2.7, 2.4, 2.7, dx, baseY, dz, style.roofColor)
      // 观测缝：沿正面经线的一条深色带
      const slitAt = (phi: number) => v(dx, baseY + 2.4 * Math.cos(phi) * 0.99, dz + 2.7 * Math.sin(phi) * 0.99)
      for (let i = 0; i < 6; i += 1) solid.segment(slitAt(0.02 + i * 0.22), slitAt(0.02 + (i + 1) * 0.22), 0.36, '#1a1d26')
      // 伸出观测缝的望远镜
      solid.cylinder(0.2, 0.26, 1.8, dx, baseY + 1.3, dz + 1.3, '#d8dce4', 10, { rotX: 0.75 })
      return { x: bx + 2.6, z: cz + 1.6, y: top + 0.06, peak: baseY + 2.4 }
    }

    case 'barrel': {
      solid.custom('barrel', barrelVault, W, BARREL_RISE, D / 2, bx, top, cz, style.roofColor)
      for (const x of [bx - W / 2 - 0.02, bx - W / 6, bx + W / 6, bx + W / 2 + 0.02]) {
        solid.custom('barrel', barrelVault, 0.18, BARREL_RISE + 0.06, D / 2 + 0.06, x, top, cz, style.trim)
      }
      windows.box(W - 1, 0.08, 1.0, bx, top + BARREL_RISE + 0.02, cz, '#cfe3ff')
      return { x: bx, z: cz, y: top + BARREL_RISE, peak: top + BARREL_RISE }
    }
  }
}

// ---------------------------------------------------------------- 屋顶装饰

function buildOrnament(c: Ctx, deck: Deck): number {
  const { solid, glow, rng, style, plan, bx, W, D, cz, front, top } = c
  const x = deck.x
  const z = deck.z
  let y = deck.y
  if (plan.roof !== 'flat' && plan.roof !== 'dome' && PEDESTAL.has(style.ornament)) {
    solid.boxOn(2.6, y - top + 0.2, 2.6, x, top, z, style.trim)
    y += 0.2
  }
  const accent = style.accent

  switch (style.ornament) {
    case 'garden': {
      // 两个木花槽、两棵小树、一座花架和一张小圆桌
      solid.boxOn(0.8, 0.45, 2.4, x - 1.9, y, z + 0.1, WOOD)
      solid.boxOn(3.0, 0.45, 0.7, x + 0.4, y, z - 1.5, WOOD)
      for (let i = 0; i < 4; i += 1) solid.blob(0.32, x - 1.9, y + 0.6, z - 0.8 + i * 0.6, pick(rng, LEAVES), undefined, 0.85)
      for (let i = 0; i < 5; i += 1) solid.blob(0.3, x - 0.8 + i * 0.6, y + 0.6, z - 1.5, rng() < 0.5 ? pick(rng, FLOWERS) : pick(rng, LEAVES), undefined, 0.85)
      addTree(solid, rng, x + 2.6, y, z + 1.0, 0.55)
      addTree(solid, rng, x - 2.2, y, z - 1.6, 0.55)
      for (const px of [x - 0.7, x + 1.5]) for (const pz of [z - 0.8, z + 1.0]) solid.boxOn(0.12, 2.0, 0.12, px, y, pz, WOOD)
      for (const pz of [z - 0.8, z + 1.0]) solid.box(2.5, 0.1, 0.12, x + 0.4, y + 2.0, pz, WOOD)
      for (let i = 0; i < 6; i += 1) solid.box(0.08, 0.08, 2.1, x - 0.6 + i * 0.4, y + 2.09, z + 0.1, WOOD_DARK)
      for (let i = 0; i < 5; i += 1) glow.blob(0.06, x - 0.5 + i * 0.45, y + 1.9, z + 1.0, '#ffe6a8')
      solid.cylinder(0.35, 0.35, 0.05, x + 0.4, y + 0.7, z + 0.1, CREAM, 10)
      solid.cylinder(0.05, 0.05, 0.7, x + 0.4, y, z + 0.1, METAL, 6)
      break
    }
    case 'chimney': {
      const cx = bx - W / 4
      const cz2 = cz - 0.2 * D
      const h = y - top + 1.2
      solid.boxOn(0.9, h, 0.9, cx, top, cz2, '#8a4b36')
      solid.boxOn(1.1, 0.18, 1.1, cx, top + h, cz2, '#5a3a2c')
      const puffs: [number, number, number, number][] = [
        [0.35, 0.1, 0.6, 0],
        [0.45, 0.4, 1.2, 0.1],
        [0.55, 0.8, 1.9, 0.2],
      ]
      for (const [r, dx, dy, dz] of puffs) solid.custom('ico1', ico1, r, r * 0.8, r, cx + dx, top + h + dy, cz2 + dz, '#e6e2dc')
      break
    }
    case 'blocks': {
      solid.boxOn(1.2, 1.2, 1.2, x - 0.7, y, z, '#4285f4')
      solid.boxOn(1.2, 1.2, 1.2, x + 0.7, y, z - 0.1, '#ea4335', { rotY: 0.2 })
      solid.boxOn(1.1, 1.1, 1.1, x, y + 1.2, z, '#fbbc05', { rotY: 0.35 })
      solid.boxOn(1.0, 1.0, 1.0, x + 1.4, y, z + 1.2, '#34a853', { rotY: -0.4 })
      break
    }
    case 'whale': {
      const by = y + 0.75
      const body = accent
      solid.custom('ico1', ico1, 2.0, 0.95, 1.1, x, by, z, body)
      solid.custom('ico1', ico1, 1.7, 0.55, 0.9, x - 0.1, by - 0.32, z + 0.12, '#e8eeff')
      solid.custom('ico1', ico1, 0.9, 0.4, 0.45, x + 2.2, by + 0.15, z, body, { rotZ: 0.35 })
      for (const s of [-1, 1]) solid.box(0.9, 0.08, 0.5, x + 2.9, by + 0.55, z + s * 0.35, body, { rotY: -s * 0.5, rotZ: 0.5 })
      solid.blob(0.1, x - 1.3, by + 0.15, z + 0.85, '#141414')
      solid.blob(0.1, x - 1.3, by + 0.15, z - 0.85, '#141414')
      solid.cylinder(0.08, 0.14, 1.0, x - 0.6, by + 0.8, z, '#bfe3ff', 6)
      solid.custom('ico1', ico1, 0.3, 0.2, 0.3, x - 0.6, by + 1.9, z, '#bfe3ff')
      for (const s of [-1, 1]) solid.blob(0.12, x - 0.6 + s * 0.35, by + 1.7, z + s * 0.1, '#d5ecff')
      break
    }
    case 'lanterns': {
      const count = Math.floor((W + 1.4) / 1.6)
      const lz = front + 0.6
      for (const lx of spread(bx - (W + 1.4) / 2, bx + (W + 1.4) / 2, count)) {
        solid.segment(v(lx, top, lz), v(lx, top - 0.22, lz), 0.03, METAL)
        glow.custom('ico1', ico1, 0.32, 0.4, 0.32, lx, top - 0.6, lz, '#e8402f')
        solid.cylinder(0.12, 0.16, 0.08, lx, top - 0.26, lz, BRASS, 8)
        solid.cylinder(0.16, 0.12, 0.08, lx, top - 1.02, lz, BRASS, 8)
        solid.box(0.04, 0.3, 0.04, lx, top - 1.2, lz, '#f2c14e')
      }
      break
    }
    case 'moon': {
      solid.cylinder(0.06, 0.08, 2.6, x, y, z, METAL, 6)
      glow.custom('crescent', crescent, 1.1, 1.1, 1.1, x, y + 3.4, z, '#ffe9a8', { rotZ: Math.PI * 0.35 })
      const stars: [number, number, number, number][] = [
        [1.2, 4.6, 0, 0.2],
        [-1.3, 4.2, 0.2, 0.16],
        [0.6, 5.3, -0.1, 0.13],
      ]
      for (const [dx, dy, dz, s] of stars) glow.custom('diamond', diamond, s, s * 1.3, 0.06, x + dx, y + dy, z + dz, '#fff3c4')
      break
    }
    case 'dish': {
      solid.cylinder(0.12, 0.16, 1.2, x, y, z, METAL, 8)
      const tilt = 0.9
      const cy = y + 1.2 + 0.225
      solid.cylinder(1.3, 0.25, 0.45, x, y + 1.2, z + 0.1, '#e8ecef', 16, { rotX: tilt })
      const tip = v(x, cy + Math.cos(tilt) * 1.1, z + 0.1 + Math.sin(tilt) * 1.1)
      solid.segment(v(x, cy, z + 0.1), tip, 0.05, METAL)
      solid.blob(0.1, tip.x, tip.y, tip.z, METAL)
      solid.cylinder(0.03, 0.03, 1.8, x + 1.6, y, z - 0.6, METAL, 5)
      glow.blob(0.09, x + 1.6, y + 1.85, z - 0.6, '#ff4d4d')
      break
    }
    case 'wave': {
      solid.boxOn(4.2, 0.25, 0.7, x, y, z, METAL)
      for (let i = 0; i < 9; i += 1) {
        const h = 0.5 + 1.8 * Math.abs(Math.sin(i * 0.7 + 0.5))
        glow.boxOn(0.3, h, 0.3, x + (i - 4) * 0.42, y + 0.25, z, accent)
      }
      break
    }
    case 'bean': {
      solid.custom('capsule', capsule, 1, 1, 1, x, y + 1.3, z, '#9b87ff', { rotZ: 0.35 })
      for (const s of [-1, 1]) {
        solid.blob(0.1, x - 0.1 + s * 0.22, y + 1.6, z + 0.78, '#1a1330')
        solid.blob(0.12, x - 0.1 + s * 0.45, y + 1.35, z + 0.72, '#ffb3c7', undefined, 0.5)
      }
      solid.segment(v(x - 0.45, y + 2.5, z), v(x - 0.5, y + 2.9, z), 0.06, '#4f9d4a')
      solid.blob(0.2, x - 0.7, y + 3.0, z, '#6cc05a', { rotZ: 0.6 }, 0.45)
      solid.blob(0.2, x - 0.3, y + 3.0, z, '#6cc05a', { rotZ: -0.6 }, 0.45)
      break
    }
    case 'rocket': {
      // 发射台和塔架是静态的；箭体会定时发射升空，交给 RocketRig 单独建
      solid.cylinder(1.4, 1.6, 0.3, x, y, z, '#3b3d42', 12)
      c.rocketPad = v(x, y + 0.3, z)
      // 发射塔架
      const tx = x + 1.5
      const tz = z - 0.9
      solid.boxOn(0.3, 5.2, 0.3, tx, y + 0.3, tz, '#6b6f75')
      for (let i = 0; i < 4; i += 1) solid.segment(v(tx - 0.15, y + 0.6 + i * 1.2, tz), v(tx + 0.15, y + 1.2 + i * 1.2, tz), 0.05, '#6b6f75')
      solid.segment(v(tx, y + 3.8, tz), v(x + 0.45, y + 3.8, z - 0.3), 0.08, '#6b6f75')
      glow.blob(0.1, tx, y + 5.6, tz, '#ff3b3b')
      break
    }
    case 'cloud': {
      solid.cylinder(0.04, 0.04, 1.3, x, y, z, METAL, 5)
      const puffs: [number, number, number, number][] = [
        [0, 0, 0, 0.9],
        [0.9, -0.1, 0.1, 0.7],
        [-0.9, -0.15, 0, 0.7],
        [0.4, 0.45, 0, 0.65],
        [-0.35, 0.4, 0.1, 0.6],
        [1.6, -0.25, 0, 0.45],
        [-1.6, -0.25, 0.05, 0.45],
      ]
      for (const [dx, dy, dz, r] of puffs) solid.custom('ico1', ico1, r, r * 0.75, r, x + dx, y + 1.8 + dy, z + dz, '#fbfdff', { rotY: rng() * Math.PI })
      for (const [dx, dy, dz, r] of puffs.slice(0, 5)) {
        solid.custom('ico1', ico1, r * 0.55, r * 0.4, r * 0.55, x + 2.8 + dx * 0.55, y + 2.9 + dy * 0.55, z - 1 + dz, '#f2f7ff', { rotY: rng() * Math.PI })
      }
      break
    }
    case 'car': {
      solid.cylinder(1.9, 1.9, 0.18, x, y, z, '#d6d2cc', 20)
      const parent = frameMatrix(x, y + 0.18, z, 0.5)
      const body = '#ff6900'
      solid.boxOn(3.0, 0.55, 1.4, 0, 0.3, 0, body, { parent })
      solid.boxOn(1.7, 0.5, 1.25, -0.15, 0.85, 0, '#23262b', { parent })
      solid.boxOn(1.5, 0.06, 1.2, -0.15, 1.35, 0, body, { parent })
      for (const wx of [-1.0, 1.0]) {
        for (const wz of [-0.72, 0.72]) solid.cylinder(0.3, 0.3, 0.22, wx, 0.19, wz, '#1b1c1f', 12, { rotX: Math.PI / 2, parent })
      }
      for (const s of [-1, 1]) {
        glow.box(0.05, 0.12, 0.3, 1.52, 0.65, s * 0.45, '#fff4d6', { parent })
        glow.box(0.05, 0.1, 0.3, -1.52, 0.65, s * 0.45, '#ff3b30', { parent })
      }
      break
    }
    case 'pixels': {
      const colors = ['#ffd800', '#ffaf00', '#ff8205', '#fa500f', '#e10500']
      const heights = [2.4, 2.0, 1.6, 1.2, 0.8]
      colors.forEach((color, i) => solid.boxOn(0.7, heights[i], 0.7, x - 1.6 + i * 0.8, y, z, color))
      break
    }
    case 'loop': {
      solid.boxOn(3.2, 0.3, 1.0, x, y, z, '#d7dde6')
      for (const s of [-1, 1]) solid.custom('torus', ring, 0.85, 1.1, 0.85, x + s * 0.8, y + 1.55, z, '#2d8cf0', { rotY: s * 0.25 })
      break
    }
    case 'scroll': {
      solid.boxOn(1.6, 0.5, 1.0, x, y, z, '#6d5a48')
      // 摊开的书：整体朝街面倾斜，左右书页呈 V 形
      const parent = frameMatrix(x, y + 0.6, z, 0, 0.35)
      for (const s of [-1, 1]) {
        const page = parent.clone().multiply(new Matrix4().makeRotationZ(s * 0.25).setPosition(s * 0.53, 0.14, 0))
        solid.box(1.16, 0.05, 1.55, 0, -0.05, 0, accent, { parent: page })
        solid.box(1.08, 0.06, 1.45, 0, 0, 0, '#fbf7ec', { parent: page })
        for (let i = 0; i < 4; i += 1) solid.box(0.75, 0.01, 0.04, 0, 0.035, -0.45 + i * 0.3, '#8a8176', { parent: page })
      }
      solid.box(0.08, 0.02, 0.6, 0.05, 0.05, 0.9, '#d6333a', { parent })
      break
    }
    case 'tower': {
      // 木水塔；坡屋顶上支腿从屋面起算
      const tankY = y + 1.6
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) solid.segment(v(x + sx * 1.0, top, z + sz * 1.0), v(x + sx * 0.75, tankY, z + sz * 0.75), 0.1, WOOD_DARK)
      }
      const midY = (top + tankY) / 2
      for (const s of [-1, 1]) {
        solid.segment(v(x - 0.9, midY - 0.3, z + s * 0.9), v(x + 0.9, midY + 0.3, z + s * 0.9), 0.06, WOOD_DARK)
        solid.segment(v(x + s * 0.9, midY - 0.3, z - 0.9), v(x + s * 0.9, midY + 0.3, z + 0.9), 0.06, WOOD_DARK)
      }
      solid.cylinder(1.05, 1.05, 1.8, x, tankY, z, '#8a5a3c', 12)
      for (const dy of [0.4, 1.3]) solid.cylinder(1.08, 1.08, 0.06, x, tankY + dy, z, METAL, 12)
      solid.cylinder(0, 1.2, 0.7, x, tankY + 1.8, z, '#5a3f2c', 12)
      break
    }
  }
  return Math.max(deck.peak, y + ORNAMENT_H[style.ornament])
}

// ---------------------------------------------------------------- 排队隔离带

function buildStanchions(c: Ctx, queue: QueueLayout, color: string): void {
  const { solid, ox, oz } = c
  const near = ox + queue.laneStartX + 0.6
  const far = ox + queue.laneEndX - 0.6
  const xs = Array.from({ length: 5 }, (_, i) => near + ((far - near) * i) / 4)
  const lanes = queue.lanes
  const laneZ = queue.laneZ.map((z) => oz + z)
  const zb = [laneZ[0] - 0.7]
  for (let k = 1; k < lanes; k += 1) zb.push((laneZ[k - 1] + laneZ[k]) / 2)
  zb.push(laneZ[lanes - 1] + 0.7)

  const posts = new Set<string>()
  const post = (i: number, k: number, x: number, z: number) => {
    const key = `${i}:${k}`
    if (posts.has(key)) return
    posts.add(key)
    solid.cylinder(0.17, 0.17, 0.04, x, Y, z, METAL, 10)
    solid.cylinder(0.055, 0.055, 0.86, x, Y + 0.04, z, METAL, 6)
    solid.cylinder(0.07, 0.07, 0.06, x, Y + 0.9, z, BRASS, 8)
  }
  const rope = (xa: number, za: number, xb: number, zbb: number) => {
    const mid = v((xa + xb) / 2, Y + 0.74, (za + zbb) / 2)
    solid.segment(v(xa, Y + 0.84, za), mid, 0.05, color)
    solid.segment(mid, v(xb, Y + 0.84, zbb), 0.05, color)
  }
  /** 沿第 k 条横绳拉若干段，skip 为省去的段号（0 靠门，3 最远）。 */
  const row = (k: number, skip: number) => {
    for (let s = 0; s < 4; s += 1) {
      if (s === skip) continue
      post(s, k, xs[s], zb[k])
      post(s + 1, k, xs[s + 1], zb[k])
      rope(xs[s], zb[k], xs[s + 1], zb[k])
    }
  }
  const column = (i: number, fromK: number, toK: number) => {
    for (let k = fromK; k < toK; k += 1) {
      post(i, k, xs[i], zb[k])
      post(i, k + 1, xs[i], zb[k + 1])
      rope(xs[i], zb[k], xs[i], zb[k + 1])
    }
  }

  row(0, 0)
  for (let k = 0; k < lanes - 1; k += 1) row(k + 1, k % 2 === 0 ? 3 : 0)
  row(lanes, lanes % 2 === 1 ? 3 : 0)
  column(4, 0, lanes)
  if (lanes >= 2) column(0, 1, lanes)
}

// ---------------------------------------------------------------- 组装

function textured(texture: Texture, width: number, height: number) {
  const material = new MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: 0.2,
    roughness: 0.62,
    metalness: 0,
  })
  const geometry = new PlaneGeometry(width, height)
  return { mesh: new Mesh(geometry, material), material, geometry }
}

export function buildShop(shop: LabShop, index: number, slot: LotSlot, buckets: TownBuckets, options: BuildShopOptions): BuiltShop {
  const plan = planShop(shop)
  const queue = queueLayout(plan, shop.queue)
  const style = plan.style
  const ox = slot.x
  const oz = slot.z
  const c: Ctx = {
    ...buckets,
    rng: createRng(`decor:${shop.id}`),
    style,
    plan,
    ox,
    oz,
    bx: ox + plan.bx,
    W: plan.width,
    D: plan.depth,
    front: oz + plan.front,
    back: oz + plan.back,
    cz: oz + (plan.front + plan.back) / 2,
    top: Y + plan.height,
    doorX: ox + plan.doorX,
  }

  buildLot(c, queue)
  buildBody(c)
  const store = buildStorefront(c)
  buildAwning(c, store.winR)
  buildUpperFloors(c)
  const peak = buildOrnament(c, buildRoof(c))
  buildStanchions(c, queue, shop.color)

  const root = new Group()
  root.name = `shop:${shop.id}`
  const rocket = c.rocketPad ? new RocketRig(c.rocketPad, `rocket:${shop.id}`) : null
  if (rocket) root.add(rocket.group)
  const logo = getLoadedLogo(shop.id)
  const textures: Texture[] = []
  const geometries: BufferGeometry[] = []
  const glowMaterials: BuiltShop['glowMaterials'] = []
  const addPlane = (texture: Texture, w: number, h: number, position: Vector3, rotY: number, weight: number) => {
    const { mesh, material, geometry } = textured(texture, w, h)
    mesh.position.copy(position)
    mesh.rotation.y = rotY
    root.add(mesh)
    textures.push(texture)
    geometries.push(geometry)
    glowMaterials.push({ material, weight })
    return material
  }

  const signW = signWidth(c.W)
  addPlane(
    createSignTexture(shop, style, logo, { width: signW, height: SIGN_H }, options.anisotropy),
    signW,
    SIGN_H,
    v(c.bx, Y + SIGN_Y, c.front + 0.375),
    0,
    1,
  )
  const plaqueX = ox + plan.plaqueX
  let plaqueText = formatTokens(shop.weekTokens)
  let plaqueTexture: Texture = createPlaqueTexture(shop, style, logo, options.anisotropy)
  const plaque = addPlane(plaqueTexture, 1.0, 1.35, v(plaqueX, Y + 1.75, c.front + 0.065), 0, 0.6)
  const graffitiW = c.W - 0.8
  const graffitiH = Math.min(plan.height - 0.6, 4.2)
  addPlane(
    createGraffitiTexture(shop, style, { width: graffitiW, height: graffitiH }, options.anisotropy),
    graffitiW,
    graffitiH,
    v(c.bx, Y + 0.3 + graffitiH / 2, c.back - 0.02),
    Math.PI,
    0.25,
  )

  const hitHeight = plan.height + 3
  const hitBox = new Mesh(new BoxGeometry(LOT_W - 0.4, hitHeight, LOT_D), HIT_MATERIAL)
  hitBox.position.set(ox, hitHeight / 2, oz - LOT_D / 2)
  hitBox.userData.shopId = shop.id
  root.add(hitBox)

  const toWorld = (points: { x: number; z: number }[]) => points.map((p) => ({ x: p.x + ox, z: p.z + oz }))

  return {
    id: shop.id,
    index,
    row: slot.row,
    col: slot.col,
    root,
    hitBox,
    plan,
    queue,
    queueSize: shop.queue,
    queuePath: new Polyline(toWorld(queue.path)),
    exitPath: new Polyline(toWorld(queue.exit)),
    joinX: ox + queue.joinX,
    exitX: ox + queue.exitX,
    // 有火箭的店把镜头焦点抬高一些，发射时能看到它离开屋顶
    focus: new Vector3(c.bx + 0.8, Y + 2.4 + (rocket ? ROCKET_VIEW_LIFT : 0), oz - 5.6),
    labelAnchor: new Vector3(c.bx, peak + 1.5, c.cz),
    lightSpot: new Vector3(c.doorX - 1, Y + 3.2, c.front + 3.4),
    pools: [
      { x: c.doorX - 1.5, z: c.front + 3.2, y: Y + 0.02, radius: 6.2, color: '#ffc47a' },
      { x: store.winCx, z: c.front + 1.2, y: Y + 0.02, radius: 2.6, color: '#ffd9a0' },
      { x: plaqueX, z: c.front + 0.8, y: Y + 0.02, radius: 1.3, color: '#ffe6b0' },
    ],
    glowMaterials,
    rocket,
    refreshPlaque(next) {
      const text = formatTokens(next.weekTokens)
      if (text === plaqueText) return
      const texture = createPlaqueTexture(next, style, logo, options.anisotropy)
      plaque.map = texture
      plaque.emissiveMap = texture
      plaque.needsUpdate = true
      textures.splice(textures.indexOf(plaqueTexture), 1, texture)
      plaqueTexture.dispose()
      plaqueTexture = texture
      plaqueText = text
    },
    dispose() {
      rocket?.dispose()
      for (const texture of textures) texture.dispose()
      for (const { material } of glowMaterials) material.dispose()
      for (const geometry of geometries) geometry.dispose()
      hitBox.geometry.dispose()
    },
  }
}

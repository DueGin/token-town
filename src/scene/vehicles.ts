import type { BufferGeometry } from 'three'
import type { Rng } from '@/lib/rng'
import { GeometryBucket } from '@/scene/geometry-bucket'

/**
 * 路上的车型。每种车一套低多边形几何：车头朝 +x、底面贴地、左右对称；
 * 车身用白色顶点色，由实例颜色染成各自的车漆，车窗、轮胎这些深色部分染色后仍然偏暗。
 */
export type VehicleKind = 'sedan' | 'hatchback' | 'suv' | 'taxi' | 'pickup' | 'van' | 'bus' | 'truck'

export interface VehicleSpec {
  kind: VehicleKind
  label: string
  /** 车身长度（米），跟车和停车线都按它算。 */
  length: number
  /** 出现的相对权重。 */
  weight: number
  /** 巡航速度范围（米/秒）。 */
  cruise: readonly [number, number]
  /** 实例颜色：多数车型是车漆；货车是货箱颜色，驾驶室颜色写在几何里。 */
  paints: readonly string[]
  /** 车灯高度与横向位置（离中线的距离）。 */
  lampY: number
  lampZ: number
  build: (bucket: GeometryBucket) => void
}

const WHITE = '#ffffff'
const GLASS = '#2a3038'
const TIRE = '#141518'
const TRIM = '#2c2f36'
const BED = '#3a3d42'
const CHECKER = '#22252a'
const DISPLAY = '#1d1f23'
const CAB = '#d9573b'

/** 四个（或多轴）轮子，轴线沿 z，贴地。 */
function wheels(bucket: GeometryBucket, xs: readonly number[], z: number, radius: number, width = 0.24): void {
  for (const x of xs) {
    for (const side of [-1, 1]) {
      bucket.cylinder(radius, radius, width, x, radius - width / 2, side * z, TIRE, 10, { rotX: Math.PI / 2 })
    }
  }
}

function sedanBody(bucket: GeometryBucket): void {
  bucket.boxOn(3.4, 0.7, 1.6, 0, 0.28, 0, WHITE, { shade: 0.8 })
  bucket.boxOn(1.9, 0.62, 1.44, -0.2, 0.98, 0, GLASS)
  bucket.box(1.95, 0.08, 1.5, -0.2, 1.62, 0, WHITE)
  wheels(bucket, [-1.1, 1.1], 0.7, 0.3)
}

export const VEHICLES: readonly VehicleSpec[] = [
  {
    kind: 'sedan',
    label: '轿车',
    length: 3.4,
    weight: 0.26,
    cruise: [5.2, 7.6],
    paints: ['#c8423a', '#e6e1d6', '#3f5f8f', '#4b8a6a', '#2c2f36', '#8f97a3', '#d9793a'],
    lampY: 0.72,
    lampZ: 0.52,
    build: sedanBody,
  },
  {
    kind: 'hatchback',
    label: '两厢小车',
    length: 2.9,
    weight: 0.16,
    cruise: [5, 7.2],
    paints: ['#d9793a', '#4b8a6a', '#7aa6c8', '#c8423a', '#e6e1d6', '#b8506f'],
    lampY: 0.68,
    lampZ: 0.5,
    build: (bucket) => {
      bucket.boxOn(2.9, 0.66, 1.56, 0, 0.26, 0, WHITE, { shade: 0.8 })
      // 车厢一直延伸到车尾，短而圆润
      bucket.boxOn(1.7, 0.58, 1.42, -0.38, 0.92, 0, GLASS)
      bucket.box(1.75, 0.08, 1.48, -0.38, 1.54, 0, WHITE)
      wheels(bucket, [-0.95, 0.95], 0.68, 0.28)
    },
  },
  {
    kind: 'suv',
    label: 'SUV',
    length: 3.8,
    weight: 0.15,
    cruise: [5.2, 7.4],
    paints: ['#2c2f36', '#8f97a3', '#e6e1d6', '#3f5f8f', '#6b4f3a', '#4b5a3a'],
    lampY: 0.9,
    lampZ: 0.58,
    build: (bucket) => {
      bucket.boxOn(3.84, 0.16, 1.72, 0, 0.3, 0, TRIM)
      bucket.boxOn(3.8, 0.86, 1.76, 0, 0.34, 0, WHITE, { shade: 0.8 })
      bucket.boxOn(2.5, 0.68, 1.6, -0.3, 1.2, 0, GLASS)
      bucket.box(2.55, 0.1, 1.66, -0.3, 1.93, 0, WHITE)
      for (const z of [-0.68, 0.68]) bucket.box(2.1, 0.06, 0.06, -0.3, 2.01, z, TRIM)
      wheels(bucket, [-1.25, 1.25], 0.76, 0.37, 0.28)
    },
  },
  {
    kind: 'taxi',
    label: '出租车',
    length: 3.4,
    weight: 0.1,
    cruise: [5.8, 7.8],
    paints: ['#f2c230'],
    lampY: 0.72,
    lampZ: 0.52,
    build: (bucket) => {
      sedanBody(bucket)
      // 车身腰线的深色格纹带和车顶灯牌
      bucket.box(3.42, 0.08, 1.62, 0, 0.74, 0, CHECKER)
      bucket.boxOn(0.5, 0.2, 0.86, -0.2, 1.66, 0, WHITE)
    },
  },
  {
    kind: 'pickup',
    label: '皮卡',
    length: 4.3,
    weight: 0.07,
    cruise: [5, 7],
    paints: ['#c8423a', '#2f4f6f', '#e6e1d6', '#4b5a3a', '#8f97a3', '#2c2f36'],
    lampY: 0.78,
    lampZ: 0.6,
    build: (bucket) => {
      bucket.boxOn(4.3, 0.64, 1.78, 0, 0.34, 0, WHITE, { shade: 0.8 })
      bucket.boxOn(1.45, 0.66, 1.62, 0.45, 0.98, 0, GLASS)
      bucket.box(1.5, 0.08, 1.68, 0.45, 1.68, 0, WHITE)
      // 后面敞开的货斗：两侧挡板、尾门和深色斗底
      for (const z of [-0.84, 0.84]) bucket.boxOn(1.9, 0.42, 0.1, -1.18, 0.98, z, WHITE)
      bucket.boxOn(0.1, 0.42, 1.78, -2.1, 0.98, 0, WHITE)
      bucket.box(1.8, 0.04, 1.58, -1.18, 1.0, 0, BED)
      wheels(bucket, [-1.35, 1.4], 0.78, 0.38, 0.28)
    },
  },
  {
    kind: 'van',
    label: '面包车',
    length: 4.1,
    weight: 0.1,
    cruise: [4.8, 6.6],
    paints: ['#e6e1d6', '#f2efe8', '#8f97a3', '#3f6fb5', '#2c2f36'],
    lampY: 0.72,
    lampZ: 0.62,
    build: (bucket) => {
      bucket.boxOn(3.5, 1.5, 1.82, -0.3, 0.34, 0, WHITE, { shade: 0.8 })
      bucket.boxOn(0.6, 0.62, 1.78, 1.75, 0.34, 0, WHITE, { shade: 0.8 })
      bucket.box(0.08, 0.62, 1.62, 1.47, 1.42, 0, GLASS)
      bucket.box(1.3, 0.48, 1.84, 0.55, 1.5, 0, GLASS)
      bucket.box(0.06, 0.45, 1.4, -2.06, 1.45, 0, GLASS)
      wheels(bucket, [-1.35, 1.35], 0.8, 0.34, 0.26)
    },
  },
  {
    kind: 'bus',
    label: '公交车',
    length: 8.6,
    weight: 0.07,
    cruise: [4.2, 5.4],
    paints: ['#d5483b', '#2f7d5b', '#3a6ea5', '#e0a63a'],
    lampY: 0.75,
    lampZ: 0.78,
    build: (bucket) => {
      bucket.boxOn(8.62, 0.2, 2.12, 0, 0.33, 0, TRIM)
      bucket.boxOn(8.6, 2.5, 2.1, 0, 0.35, 0, WHITE, { shade: 0.85 })
      // 两侧通长车窗、前挡风、后窗和车头的线路牌
      bucket.box(7.6, 0.9, 2.14, -0.35, 1.95, 0, GLASS)
      bucket.box(0.08, 1.1, 1.9, 4.28, 1.85, 0, GLASS)
      bucket.box(0.08, 0.7, 1.7, -4.28, 2.1, 0, GLASS)
      bucket.box(0.06, 0.26, 1.5, 4.29, 2.58, 0, DISPLAY)
      bucket.boxOn(2.4, 0.22, 1.4, -1.5, 2.85, 0, '#e6e6e6')
      wheels(bucket, [-2.6, 2.85], 0.92, 0.5, 0.3)
    },
  },
  {
    kind: 'truck',
    label: '厢式货车',
    length: 5.8,
    weight: 0.09,
    cruise: [4.4, 5.8],
    paints: ['#f4f2ec', '#ece6d6', '#dfe3e8', '#f1e7c9'],
    lampY: 0.8,
    lampZ: 0.75,
    build: (bucket) => {
      bucket.boxOn(5.7, 0.2, 1.7, 0, 0.36, 0, TRIM)
      // 驾驶室颜色固定在几何里，实例颜色只决定货箱
      bucket.boxOn(1.6, 1.75, 1.96, 2.1, 0.42, 0, CAB, { shade: 0.8 })
      bucket.box(0.08, 0.6, 1.7, 2.91, 1.75, 0, GLASS)
      bucket.box(0.8, 0.5, 1.98, 2.3, 1.75, 0, GLASS)
      bucket.boxOn(4.0, 2.25, 2.0, -0.85, 0.5, 0, WHITE, { shade: 0.85 })
      wheels(bucket, [-2.35, -1.5, 2.2], 0.86, 0.45, 0.3)
    },
  },
]

const TOTAL_WEIGHT = VEHICLES.reduce((sum, spec) => sum + spec.weight, 0)

/** 按权重随机挑一种车型。 */
export function pickVehicle(rng: Rng): VehicleSpec {
  let r = rng() * TOTAL_WEIGHT
  for (const spec of VEHICLES) {
    r -= spec.weight
    if (r < 0) return spec
  }
  return VEHICLES[VEHICLES.length - 1]
}

export function vehicleBodyGeometry(spec: VehicleSpec): BufferGeometry {
  const bucket = new GeometryBucket()
  spec.build(bucket)
  const geometry = bucket.build()
  if (!geometry) throw new Error(`${spec.label}几何生成失败`)
  return geometry
}

/** 车头白灯、车尾红灯，只在夜里显示。 */
export function vehicleLightGeometry(spec: VehicleSpec): BufferGeometry {
  const bucket = new GeometryBucket()
  const end = spec.length / 2 + 0.02
  for (const z of [-spec.lampZ, spec.lampZ]) {
    bucket.box(0.06, 0.16, 0.34, end, spec.lampY, z, '#fff4d6')
    bucket.box(0.06, 0.14, 0.3, -end, spec.lampY + 0.02, z, '#ff3b30')
  }
  const geometry = bucket.build()
  if (!geometry) throw new Error('车灯几何生成失败')
  return geometry
}

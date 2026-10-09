import { Color } from 'three'
import { pick, type Rng } from '@/lib/rng'
import type { GeometryBucket } from '@/scene/geometry-bucket'
import { SIDEWALK_H } from '@/scene/layout'

/**
 * 街道与店铺共用的道具和缓冲类型，单独成模块，避免 street 与 shop-builder 互相引用。
 */
export interface TownBuckets {
  /** 普通实体：墙、屋顶、道具，受光照。 */
  solid: GeometryBucket
  /** 窗户与店内：夜晚自发光，白天换成玻璃材质。 */
  windows: GeometryBucket
  /** 灯泡、灯头：夜晚自发光，白天按普通颜色显示。 */
  glow: GeometryBucket
}

/** 夜间地面光斑。 */
export interface LightPool {
  x: number
  z: number
  y: number
  radius: number
  color: string
}

export const LEAVES = ['#4f7d3f', '#5d8f47', '#3f6e3a', '#6a9a4c']
export const POLE = '#2d3037'
export const BENCH = '#7a5236'
export const GRASS = '#5f8a4f'
export const HEDGE = '#476f3b'

export function shadeHex(hex: string, factor: number): string {
  return `#${new Color(hex).multiplyScalar(factor).getHexString()}`
}

export function addTree(solid: GeometryBucket, rng: Rng, x: number, y: number, z: number, scale = 1): void {
  solid.cylinder(0.12 * scale, 0.16 * scale, 1.5 * scale, x, y, z, '#5a3f2c', 6)
  const green = pick(rng, LEAVES)
  solid.blob(1.15 * scale, x, y + 2.4 * scale, z, green, { rotY: rng() * Math.PI })
  solid.blob(0.8 * scale, x + 0.2 * scale, y + 3.25 * scale, z - 0.1 * scale, pick(rng, LEAVES), { rotY: rng() * Math.PI })
}

/** 长椅：rotY = 0 时面朝 +z。 */
export function addBench(solid: GeometryBucket, x: number, z: number, rotY: number, y = SIDEWALK_H): void {
  const opts = { rotY }
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const at = (dx: number, dz: number): [number, number] => [x + dx * cos + dz * sin, z - dx * sin + dz * cos]
  const [sx, sz] = at(0, 0)
  solid.boxOn(1.8, 0.08, 0.5, sx, y + 0.42, sz, BENCH, opts)
  const [bx, bz] = at(0, -0.24)
  // Euler 顺序先绕世界 X 再绕 Y，所以靠背后仰方向要跟着朝向翻转
  solid.box(1.8, 0.4, 0.07, bx, y + 0.72, bz, BENCH, { rotY, rotX: -0.15 * cos })
  for (const dx of [-0.75, 0.75]) {
    const [lx, lz] = at(dx, 0)
    solid.boxOn(0.08, 0.42, 0.46, lx, y, lz, POLE, opts)
  }
}

/** 花坛：矮砖沿 + 一簇彩色花团。 */
export function addFlowerBed(solid: GeometryBucket, rng: Rng, x: number, z: number, w: number, d: number, y = SIDEWALK_H): void {
  solid.boxOn(w, 0.32, d, x, y, z, '#8d7f72')
  solid.boxOn(w - 0.3, 0.06, d - 0.3, x, y + 0.32, z, '#4a3a2c')
  const colors = ['#e0607a', '#f2c14e', '#f6f1e6', '#9c6ade', '#ef8a4c']
  const count = Math.max(3, Math.round((w * d) / 0.9))
  for (let i = 0; i < count; i += 1) {
    const fx = x + (rng() - 0.5) * (w - 0.6)
    const fz = z + (rng() - 0.5) * (d - 0.6)
    solid.blob(0.26, fx, y + 0.5, fz, rng() < 0.45 ? pick(rng, LEAVES) : pick(rng, colors), undefined, 0.8)
  }
}

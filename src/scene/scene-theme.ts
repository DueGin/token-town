import type { TownTheme } from '@/lib/preferences'
import { daylightAt, isEvening, sunElevation, warmthAt, wrapHours } from '@/lib/time-of-day'

export interface SceneTheme {
  night: boolean
  /** 夜色程度 0–1：路灯光斑和灯泡亮度随它连续变化。 */
  nightLevel: number
  background: string
  fog: string
  fogNear: number
  fogFar: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  sunColor: string
  sunIntensity: number
  /** 光源相对焦点的方向（会被归一化后乘以距离）。 */
  sunDirection: [number, number, number]
  exposure: number
  /** 招牌、挂牌的自发光强度。 */
  signGlow: number
  groundColor: string
}

/** 白天是午后暖阳，夜晚靠窗户、招牌和路灯照亮街道。 */
export const SCENE_THEMES: Record<TownTheme, SceneTheme> = {
  day: {
    night: false,
    nightLevel: 0,
    background: '#d9dfe0',
    fog: '#d9dfe0',
    fogNear: 140,
    fogFar: 360,
    hemiSky: '#e4eef8',
    hemiGround: '#8c7b66',
    hemiIntensity: 1.5,
    sunColor: '#fff0d6',
    sunIntensity: 2.4,
    sunDirection: [-0.55, 1.1, 0.8],
    exposure: 1,
    signGlow: 0.18,
    groundColor: '#4a4a4f',
  },
  night: {
    night: true,
    nightLevel: 1,
    background: '#0b1020',
    fog: '#0b1020',
    fogNear: 110,
    fogFar: 300,
    hemiSky: '#4a5a8c',
    hemiGround: '#1d1a24',
    hemiIntensity: 0.75,
    sunColor: '#a9bcff',
    sunIntensity: 0.45,
    sunDirection: [0.6, 1.2, 0.45],
    exposure: 1.15,
    signGlow: 1,
    groundColor: '#26272e',
  },
}

/** 晨昏的暖色：黄昏偏橙，清晨偏粉。 */
const DUSK = { background: '#e9b28f', fog: '#e3a987', hemiSky: '#f3c6a0', sunColor: '#ff9d5c' }
const DAWN = { background: '#e6b8b4', fog: '#dfb0ac', hemiSky: '#f0c9c4', sunColor: '#ffb48a' }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 两个 #rrggbb 颜色按 t 线性混合。不依赖 three，界面层也能直接用。 */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const k = Math.min(1, Math.max(0, t))
  const channel = (shift: number) => {
    const value = Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * k)
    return value.toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}
const mix = mixHex

/** 按一天中的小时数连续插值出场景主题：太阳东升西落，晨昏染上暖色。 */
export function sceneThemeAt(hours: number): SceneTheme {
  const h = wrapHours(hours)
  const day = daylightAt(h)
  const warm = warmthAt(h) * 0.85
  const tint = isEvening(h) ? DUSK : DAWN
  const { day: d, night: n } = SCENE_THEMES
  const color = (key: 'background' | 'fog' | 'hemiSky' | 'sunColor') => mix(mix(n[key], d[key], day), tint[key], warm)

  // 太阳从东（+x）升起，正午在南侧偏上，傍晚落到西边；夜里换成固定的月光方向
  const azimuth = ((h - 12) / 6) * (Math.PI / 2) * 0.7
  const sun: [number, number, number] = [-Math.sin(azimuth), 0.45 + 1.1 * Math.max(0, sunElevation(h)), Math.cos(azimuth)]
  const direction = sun.map((value, i) => lerp(n.sunDirection[i], value, day)) as [number, number, number]

  const nightLevel = 1 - day
  return {
    night: nightLevel >= 0.5,
    nightLevel,
    background: color('background'),
    fog: color('fog'),
    fogNear: lerp(n.fogNear, d.fogNear, day),
    fogFar: lerp(n.fogFar, d.fogFar, day),
    hemiSky: color('hemiSky'),
    hemiGround: mix(n.hemiGround, d.hemiGround, day),
    hemiIntensity: lerp(n.hemiIntensity, d.hemiIntensity, day),
    sunColor: color('sunColor'),
    sunIntensity: lerp(n.sunIntensity, d.sunIntensity, day) * (1 - warm * 0.25),
    sunDirection: direction,
    exposure: lerp(n.exposure, d.exposure, day),
    signGlow: lerp(n.signGlow, d.signGlow, day),
    groundColor: mix(n.groundColor, d.groundColor, day),
  }
}

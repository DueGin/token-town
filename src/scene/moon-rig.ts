import {
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { createRng, range, type Rng } from '@/lib/rng'

/** 灯杆高度；新月挂在杆顶之上 MOON_LIFT 米处，绕杆顶轻轻摇摆。 */
const POLE_H = 2.6
const MOON_LIFT = 0.8
const MOON_TILT = Math.PI * 0.35
const SWAY = 0.3
const MOON_SCALE = 1.45
/** 新月上下浮动的幅度。 */
const BOB = 0.25
/** 星星：相对灯杆底的位置和大小。 */
const STARS: [number, number, number, number][] = [
  [1.5, 4.7, 0, 0.3],
  [-1.6, 4.3, 0.2, 0.24],
  [0.7, 5.8, -0.1, 0.2],
  [-0.9, 5.6, 0.3, 0.17],
  [2.2, 3.7, -0.2, 0.15],
]
/** 流星每隔几秒从左上划向右下，划过一次用 METEOR_LEN 秒。 */
const METEOR_EVERY: [number, number] = [3, 6]
const METEOR_LEN = 1.1
const METEOR_FROM = new Vector3(-3.6, 7.2, -0.4)
const METEOR_TO = new Vector3(3.4, 4.0, 0.4)
const TAIL = 2.0
/** 夜里/白天的自发光基准。 */
const NIGHT_GLOW = 1.6
const DAY_GLOW = 0.35
/** 建好时先空跑一会儿，减少动态效果时停在新月、星星都在的一刻。 */
const PREWARM = 1.5

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * 天文台屋顶的新月（Kimi 店）。灯杆是静态几何，这里负责摇摆的新月、闪烁的星星和偶尔划过的流星。
 */
export class MoonRig {
  readonly group = new Group()
  readonly pivot = new Group()
  readonly stars: Mesh[]
  readonly meteor = new Group()
  readonly halo: Mesh
  private readonly crescentGeometry = new TorusGeometry(1, 0.28, 8, 24, Math.PI * 1.25)
  private readonly starGeometry = new OctahedronGeometry(1, 0)
  private readonly headGeometry = new IcosahedronGeometry(1, 0)
  private readonly haloGeometry = new SphereGeometry(1, 16, 12)
  /** 尾巴从原点沿 -x 方向伸出，单位长度。 */
  private readonly tailGeometry = new CylinderGeometry(0.02, 0.12, 1, 6).rotateZ(Math.PI / 2).translate(-0.5, 0, 0)
  private readonly moonMaterial = glowMaterial('#ffe9a8')
  private readonly starMaterial = glowMaterial('#fff3c4')
  private readonly meteorMaterial = glowMaterial('#fffbe8')
  private readonly haloMaterial = new MeshStandardMaterial({
    color: '#ffe9a8',
    emissive: '#ffe9a8',
    emissiveIntensity: DAY_GLOW,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    roughness: 1,
  })
  private glow = DAY_GLOW
  private readonly rng: Rng
  private readonly phases: number[]
  private clock = 0
  /** 当前流星已划了多少秒；不在划时为 Infinity。 */
  private meteorAge = Infinity
  private untilMeteor: number

  /** base 是灯杆底部中心。 */
  constructor(base: Vector3, seed: string) {
    this.rng = createRng(seed)
    this.untilMeteor = range(this.rng, ...METEOR_EVERY)
    this.phases = STARS.map(() => this.rng() * Math.PI * 2)
    this.group.position.copy(base)

    this.pivot.position.set(0, POLE_H, 0)
    const crescent = new Mesh(this.crescentGeometry, this.moonMaterial)
    crescent.position.y = MOON_LIFT
    crescent.scale.setScalar(MOON_SCALE)
    crescent.rotation.z = MOON_TILT
    // 新月背后一圈淡淡的光晕，跟着呼吸
    this.halo = new Mesh(this.haloGeometry, this.haloMaterial)
    this.halo.position.y = MOON_LIFT
    this.halo.scale.setScalar(MOON_SCALE * 1.5)
    this.pivot.add(crescent, this.halo)

    this.stars = STARS.map(([x, y, z]) => {
      const star = new Mesh(this.starGeometry, this.starMaterial)
      star.position.set(x, y, z)
      return star
    })

    const tail = new Mesh(this.tailGeometry, this.meteorMaterial)
    tail.scale.x = TAIL
    const head = new Mesh(this.headGeometry, this.meteorMaterial)
    head.scale.setScalar(0.16)
    this.meteor.add(tail, head)
    // 尾巴朝来的方向
    const dir = METEOR_TO.clone().sub(METEOR_FROM)
    this.meteor.rotation.z = Math.atan2(dir.y, dir.x)
    this.meteor.visible = false

    this.group.add(this.pivot, ...this.stars, this.meteor)
    this.step(PREWARM)
    this.write()
  }

  get meteorVisible(): boolean {
    return this.meteor.visible
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.step(dt)
    this.write()
  }

  /** 夜里新月、星星和流星亮起来，白天只留一点自发光，和屋顶其他灯泡一致。 */
  setNight(night: boolean): void {
    this.glow = night ? NIGHT_GLOW : DAY_GLOW
    this.meteorMaterial.emissiveIntensity = this.glow
    this.halo.visible = night
    this.write()
  }

  dispose(): void {
    for (const g of [this.crescentGeometry, this.starGeometry, this.headGeometry, this.tailGeometry, this.haloGeometry]) g.dispose()
    for (const m of [this.moonMaterial, this.starMaterial, this.meteorMaterial, this.haloMaterial]) m.dispose()
  }

  private step(dt: number): void {
    this.clock += dt
    this.meteorAge += dt
    this.untilMeteor -= dt
    if (this.untilMeteor <= 0) {
      this.untilMeteor += range(this.rng, ...METEOR_EVERY)
      this.meteorAge = 0
    }
  }

  private write(): void {
    const t = this.clock
    // 新月像挂在风里，慢慢左右摆，再缓缓转一点
    this.pivot.rotation.z = SWAY * Math.sin(t * 0.9)
    this.pivot.rotation.y = 0.6 * Math.sin(t * 0.37)
    this.pivot.position.y = POLE_H + BOB * Math.sin(t * 0.7)
    // 月光缓缓呼吸，光晕跟着胀缩
    const breath = 0.5 + 0.5 * Math.sin(t * 1.3)
    this.moonMaterial.emissiveIntensity = this.glow * (0.75 + 0.5 * breath)
    this.haloMaterial.opacity = 0.1 + 0.16 * breath
    this.halo.scale.setScalar(MOON_SCALE * (1.35 + 0.3 * breath))
    let starLight = 0
    STARS.forEach(([, y, , s], i) => {
      const star = this.stars[i]
      const p = this.phases[i]
      const twinkle = 0.55 + 0.45 * Math.sin(t * 2.3 + p) + 0.2 * Math.sin(t * 6.1 + p * 2)
      star.scale.set(s * twinkle, s * 1.4 * twinkle, 0.08)
      star.position.y = y + 0.18 * Math.sin(t * 0.8 + p)
      star.rotation.y = t * 1.2 + p
      starLight += twinkle
    })
    this.starMaterial.emissiveIntensity = this.glow * (0.6 + (0.5 * starLight) / STARS.length)
    const k = this.meteorAge / METEOR_LEN
    this.meteor.visible = k < 1
    if (this.meteor.visible) {
      this.meteor.position.lerpVectors(METEOR_FROM, METEOR_TO, k)
      // 先亮起再淡出：整体缩放模拟
      const fade = smoothstep(k / 0.12) * (1 - smoothstep((k - 0.65) / 0.35))
      this.meteor.scale.setScalar(Math.max(0.001, fade))
    }
  }
}

function glowMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: DAY_GLOW, roughness: 0.5, flatShading: true })
}

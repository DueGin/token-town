import {
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { createRng, range, type Rng } from '@/lib/rng'

/** 同时存在的烟团上限；按最短间隔和最长寿命算，环形复用时最老的一团早已散尽。 */
const PUFF_MAX = 12
/** 相邻两团烟冒出的间隔（秒）。 */
const EMIT_EVERY: [number, number] = [0.8, 1.2]
const LIFE: [number, number] = [5.5, 7]
/** 出烟口处每秒升 RISE_SPEED 米，之后越升越慢，但在寿命内不会停下来堆成一团。 */
const RISE_SPEED = 0.75
const RISE_DRAG = 0.03
/** 微风把烟往 +x、略向 +z 吹，越高被吹得越远。 */
const WIND_X = 0.18
const WIND_Z = 0.06
const WIND_GAIN = 0.02
/** 建好时先空跑几秒，第一帧就能看到一整缕烟，减少动态效果时也停在这一刻。 */
const PREWARM = 8
const PREWARM_STEP = 1 / 30

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** 出烟口之上的高度。 */
function riseAt(age: number): number {
  return RISE_SPEED * age - RISE_DRAG * age * age
}

/**
 * 屋顶烟囱里缓缓冒出的烟（Anthropic 店）。烟囱本体是静态几何，这里只负责烟团。
 * 每团烟从出烟口冒出，边升边被微风吹偏、轻轻摆动，先鼓起来再缩小散去。
 */
export class ChimneySmoke {
  readonly mesh: InstancedMesh
  private readonly material = new MeshStandardMaterial({ color: '#e6e2dc', roughness: 1, flatShading: true })
  private readonly rng: Rng
  private untilNext = 0
  private nextPuff = 0
  private readonly puffs = Array.from({ length: PUFF_MAX }, () => ({
    alive: false,
    age: 0,
    life: 1,
    size: 1,
    spin: 0,
    phase: 0,
    sway: 0,
    offsetX: 0,
    offsetZ: 0,
  }))
  private readonly matrix = new Matrix4()
  private readonly quat = new Quaternion()
  private readonly euler = new Euler()
  private readonly position = new Vector3()
  private readonly scale = new Vector3()

  /** mouth 是烟囱帽顶面中心。 */
  constructor(mouth: Vector3, seed: string) {
    this.rng = createRng(seed)
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), this.material, PUFF_MAX)
    this.mesh.position.copy(mouth)
    // 烟团每帧都在动，包围球会过期，不做视锥剔除；动态的影子会闪，只接收不投射
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = true
    for (let t = 0; t < PREWARM; t += PREWARM_STEP) this.step(PREWARM_STEP)
    this.writeMatrices()
  }

  get puffCount(): number {
    return this.puffs.reduce((sum, puff) => sum + (puff.alive ? 1 : 0), 0)
  }

  /** 最高一团烟离出烟口的高度（米）。 */
  get plumeHeight(): number {
    return this.puffs.reduce((top, puff) => (puff.alive ? Math.max(top, riseAt(puff.age)) : top), 0)
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.step(dt)
    this.writeMatrices()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.material.dispose()
  }

  private step(dt: number): void {
    for (const puff of this.puffs) {
      if (!puff.alive) continue
      puff.age += dt
      if (puff.age >= puff.life) puff.alive = false
    }
    this.untilNext -= dt
    while (this.untilNext <= 0) {
      this.untilNext += range(this.rng, ...EMIT_EVERY)
      this.emit()
    }
  }

  private emit(): void {
    const puff = this.puffs[this.nextPuff]
    this.nextPuff = (this.nextPuff + 1) % PUFF_MAX
    puff.alive = true
    puff.age = 0
    puff.life = range(this.rng, ...LIFE)
    puff.size = range(this.rng, 0.42, 0.6)
    puff.spin = this.rng() * Math.PI * 2
    puff.phase = this.rng() * Math.PI * 2
    puff.sway = range(this.rng, 0.06, 0.14)
    puff.offsetX = range(this.rng, -0.12, 0.12)
    puff.offsetZ = range(this.rng, -0.12, 0.12)
  }

  private writeMatrices(): void {
    this.puffs.forEach((puff, i) => {
      if (!puff.alive) {
        this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0))
        return
      }
      const age = puff.age
      const wobble = Math.sin(age * 1.3 + puff.phase) * puff.sway * Math.min(1, age)
      this.position.set(
        puff.offsetX + WIND_X * age + WIND_GAIN * age * age + wobble,
        riseAt(age),
        puff.offsetZ + WIND_Z * age + Math.cos(age * 1.1 + puff.phase) * puff.sway * 0.6,
      )
      // 刚冒出时小小一团，边升边鼓起来，后半段缩小散去
      const grow = 0.4 + 0.6 * smoothstep(age / 2.5)
      const fade = 1 - smoothstep((age - puff.life * 0.5) / (puff.life * 0.5))
      const size = puff.size * grow * fade
      this.quat.setFromEuler(this.euler.set(puff.spin + age * 0.25, puff.spin * 0.7 + age * 0.18, 0))
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quat, this.scale.set(size, size * 0.8, size)))
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

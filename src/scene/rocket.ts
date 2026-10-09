import {
  ConeGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three'
import { createRng, range, type Rng } from '@/lib/rng'
import { GeometryBucket } from '@/scene/geometry-bucket'

/** 发射节奏：待命 → 点火 → 升空 → 飞出画面 → 点火减速回落到发射台 → 待命。 */
export type RocketPhase = 'idle' | 'ignition' | 'ascent' | 'away' | 'landing'

/** 第一次发射在建好后几秒内，之后每隔一段随机时间发射一次（秒）。 */
const FIRST_LAUNCH: [number, number] = [6, 12]
const BETWEEN_LAUNCHES: [number, number] = [20, 40]
const IGNITION = 1.6
const ASCENT = 6
/** 升空阶段结束时离发射台的高度（米），已经飞出画面。 */
export const ASCENT_HEIGHT = 90
/** 升空途中向一侧偏出的最大角度和水平距离。 */
const ASCENT_TILT = 0.14
const ASCENT_DRIFT = 9
const AWAY = 4
const LANDING = 4.5
const LANDING_HEIGHT = 45
const SMOKE_MAX = 96
/** 火焰喷口在箭体局部坐标里的高度。 */
const NOZZLE_Y = 0.25

const WHITE = '#e8e8e8'
const DARK = '#1c1d20'
const ENGINE = '#44474d'
const METAL = '#2b2c31'

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** 箭体：发动机喷口、白色箭身、黑色腰带、鼻锥、四片尾翼和着陆腿；原点在发射台台面中心。 */
function rocketGeometry(): BufferGeometry {
  const bucket = new GeometryBucket()
  bucket.cylinder(0.3, 0.22, 0.35, 0, NOZZLE_Y, 0, ENGINE, 10)
  bucket.cylinder(0.45, 0.45, 3.6, 0, 0.6, 0, WHITE, 12)
  bucket.cylinder(0, 0.45, 1.1, 0, 4.2, 0, WHITE, 12)
  bucket.cylinder(0.46, 0.46, 0.3, 0, 3.2, 0, DARK, 12)
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2 + Math.PI / 4
    bucket.box(0.06, 0.9, 0.5, Math.cos(a) * 0.55, 1.05, Math.sin(a) * 0.55, DARK, { rotY: Math.PI / 2 - a })
    bucket.segment(new Vector3(Math.cos(a) * 0.4, 1.2, Math.sin(a) * 0.4), new Vector3(Math.cos(a), 0, Math.sin(a)), 0.08, METAL)
  }
  const geometry = bucket.build()
  if (!geometry) throw new Error('火箭几何生成失败')
  return geometry
}

/**
 * 屋顶上会发射的火箭（xAI 店）。发射台和塔架是静态几何，这里只负责箭体、尾焰和烟。
 * group 固定在发射台台面中心，箭体在 group 里上下移动；烟团留在原地慢慢散开。
 */
export class RocketRig {
  readonly group = new Group()
  private readonly body: Mesh
  private readonly flame = new Group()
  private readonly smoke: InstancedMesh
  private readonly bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, flatShading: true })
  private readonly flameOuter = new MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false })
  private readonly flameInner = new MeshBasicMaterial({ color: '#fff1b8', toneMapped: false })
  private readonly smokeMaterial = new MeshStandardMaterial({ color: '#ebe8e2', roughness: 1, flatShading: true })
  private readonly flameGeometry = new ConeGeometry(1, 1, 10).rotateX(Math.PI).translate(0, -0.5, 0)
  private readonly rng: Rng
  private phaseName: RocketPhase = 'idle'
  /** 当前阶段已经过去的秒数与这一阶段的时长（待命阶段的时长随机）。 */
  private elapsed = 0
  private duration: number
  private clock = 0
  private emitCarry = 0
  private nextPuff = 0
  private readonly puffs = Array.from({ length: SMOKE_MAX }, () => ({
    alive: false,
    age: 0,
    life: 1,
    size: 1,
    spin: 0,
    position: new Vector3(),
    velocity: new Vector3(),
  }))
  private readonly matrix = new Matrix4()
  private readonly quat = new Quaternion()
  private readonly euler = new Euler()
  private readonly scale = new Vector3()
  private readonly nozzle = new Vector3()

  constructor(anchor: Vector3, seed: string) {
    this.rng = createRng(seed)
    this.duration = range(this.rng, ...FIRST_LAUNCH)
    this.group.position.copy(anchor)
    this.body = new Mesh(rocketGeometry(), this.bodyMaterial)
    this.body.castShadow = true
    this.body.receiveShadow = true
    const outer = new Mesh(this.flameGeometry, this.flameOuter)
    outer.scale.set(0.34, 1, 0.34)
    const inner = new Mesh(this.flameGeometry, this.flameInner)
    inner.scale.set(0.18, 0.6, 0.18)
    this.flame.add(outer, inner)
    this.flame.position.y = NOZZLE_Y
    this.flame.visible = false
    this.body.add(this.flame)
    this.smoke = new InstancedMesh(new IcosahedronGeometry(1, 0), this.smokeMaterial, SMOKE_MAX)
    this.smoke.frustumCulled = false
    this.smoke.castShadow = false
    this.smoke.receiveShadow = true
    for (let i = 0; i < SMOKE_MAX; i += 1) this.smoke.setMatrixAt(i, this.matrix.makeScale(0, 0, 0))
    this.group.add(this.body, this.smoke)
  }

  get phase(): RocketPhase {
    return this.phaseName
  }

  /** 箭体离发射台的高度（米）。 */
  get altitude(): number {
    return this.body.position.y
  }

  get flying(): boolean {
    return this.body.visible
  }

  get firing(): boolean {
    return this.flame.visible
  }

  get smokeCount(): number {
    return this.puffs.reduce((sum, puff) => sum + (puff.alive ? 1 : 0), 0)
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.clock += dt
    this.elapsed += dt
    if (this.elapsed >= this.duration) this.advance()
    const t = this.elapsed
    let thrust = 0
    let emitRate = 0
    let fromPad = false
    this.body.position.set(0, 0, 0)
    this.body.rotation.set(0, 0, 0)
    switch (this.phaseName) {
      case 'ignition': {
        // 火焰先窜出来，台下冒烟，箭体轻微抖动
        thrust = 0.35 + 0.65 * smoothstep(t / IGNITION)
        emitRate = 34
        fromPad = true
        this.body.position.x = Math.sin(this.clock * 70) * 0.025
        this.body.position.z = Math.cos(this.clock * 63) * 0.025
        break
      }
      case 'ascent': {
        const progress = t / ASCENT
        const height = ASCENT_HEIGHT * progress * progress
        const lean = smoothstep(height / ASCENT_HEIGHT)
        this.body.position.set(ASCENT_DRIFT * lean * lean, height, 0)
        this.body.rotation.z = -ASCENT_TILT * lean
        thrust = 1.15
        emitRate = height < 4 ? 40 : 26
        fromPad = height < 2.5
        break
      }
      case 'landing': {
        // 从高处落下，越接近台面越慢，最后轻轻落稳
        const left = 1 - t / LANDING
        const height = LANDING_HEIGHT * left * left
        this.body.position.y = height
        thrust = 0.55 + 0.35 * left
        // 空中只见火焰；快落地时反推的气流把台面上的烟扬起来
        emitRate = height < 3 ? 30 : 0
        fromPad = true
        break
      }
    }
    this.flame.visible = thrust > 0
    if (thrust > 0) {
      const flicker = 1 + 0.12 * Math.sin(this.clock * 47) + 0.08 * Math.sin(this.clock * 83)
      this.flame.scale.set(1 + 0.15 * (thrust - 1), 1.6 * thrust * flicker, 1 + 0.15 * (thrust - 1))
    }
    this.emit(emitRate * dt, fromPad)
    this.updateSmoke(dt)
  }

  /** 回到发射台待命，清掉火焰和烟（例如用户开启了减少动态效果）。 */
  reset(): void {
    this.phaseName = 'idle'
    this.elapsed = 0
    this.duration = range(this.rng, ...BETWEEN_LAUNCHES)
    this.body.position.set(0, 0, 0)
    this.body.rotation.set(0, 0, 0)
    this.body.visible = true
    this.flame.visible = false
    for (const puff of this.puffs) puff.alive = false
    this.updateSmoke(0)
  }

  dispose(): void {
    this.body.geometry.dispose()
    this.flameGeometry.dispose()
    this.smoke.geometry.dispose()
    this.smoke.dispose()
    for (const material of [this.bodyMaterial, this.flameOuter, this.flameInner, this.smokeMaterial]) material.dispose()
  }

  private advance(): void {
    this.elapsed = 0
    switch (this.phaseName) {
      case 'idle':
        this.phaseName = 'ignition'
        this.duration = IGNITION
        break
      case 'ignition':
        this.phaseName = 'ascent'
        this.duration = ASCENT
        break
      case 'ascent':
        this.phaseName = 'away'
        this.duration = AWAY
        this.body.visible = false
        break
      case 'away':
        this.phaseName = 'landing'
        this.duration = LANDING
        this.body.visible = true
        break
      case 'landing':
        this.phaseName = 'idle'
        this.duration = range(this.rng, ...BETWEEN_LAUNCHES)
        break
    }
  }

  /** 按速率放出烟团：贴着台面时向四周翻滚，升空后沿尾迹留在原地。 */
  private emit(count: number, fromPad: boolean): void {
    this.emitCarry += count
    if (!this.body.visible) this.emitCarry = 0
    while (this.emitCarry >= 1) {
      this.emitCarry -= 1
      const puff = this.puffs[this.nextPuff]
      this.nextPuff = (this.nextPuff + 1) % SMOKE_MAX
      puff.alive = true
      puff.age = 0
      puff.spin = this.rng() * Math.PI * 2
      if (fromPad) {
        const angle = this.rng() * Math.PI * 2
        const speed = range(this.rng, 1.6, 3.4)
        puff.position.set(Math.cos(angle) * 0.6, range(this.rng, 0.1, 0.4), Math.sin(angle) * 0.6)
        puff.velocity.set(Math.cos(angle) * speed, range(this.rng, 0.2, 0.7), Math.sin(angle) * speed)
        puff.size = range(this.rng, 0.45, 0.8)
        puff.life = range(this.rng, 2.2, 3.2)
      } else {
        this.nozzle.set(0, NOZZLE_Y - 0.3, 0).applyEuler(this.body.rotation).add(this.body.position)
        puff.position.set(this.nozzle.x + range(this.rng, -0.2, 0.2), this.nozzle.y, this.nozzle.z + range(this.rng, -0.2, 0.2))
        puff.velocity.set(range(this.rng, -0.4, 0.4), range(this.rng, -1.2, -0.2), range(this.rng, -0.4, 0.4))
        puff.size = range(this.rng, 0.6, 1.1)
        puff.life = range(this.rng, 3, 4.2)
      }
    }
  }

  private updateSmoke(dt: number): void {
    const damping = Math.exp(-1.8 * dt)
    this.puffs.forEach((puff, i) => {
      if (puff.alive) {
        puff.age += dt
        if (puff.age >= puff.life) puff.alive = false
      }
      if (!puff.alive) {
        this.smoke.setMatrixAt(i, this.matrix.makeScale(0, 0, 0))
        return
      }
      puff.position.addScaledVector(puff.velocity, dt)
      puff.velocity.multiplyScalar(damping)
      puff.velocity.y += 0.35 * dt
      // 先鼓起来，后半段慢慢缩小散去
      const grow = 0.5 + 1.3 * smoothstep(puff.age / 0.8)
      const fade = 1 - smoothstep((puff.age - puff.life * 0.55) / (puff.life * 0.45))
      const size = puff.size * grow * fade
      this.quat.setFromEuler(this.euler.set(puff.spin, puff.spin * 0.7, 0))
      this.smoke.setMatrixAt(i, this.matrix.compose(puff.position, this.quat, this.scale.set(size, size * 0.85, size)))
    })
    this.smoke.instanceMatrix.needsUpdate = true
  }
}

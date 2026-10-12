import {
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { createRng, range, type Rng } from '@/lib/rng'

/** 水柱高出出水孔的基准高度（米），实际高度是它乘上喷水力度。 */
const JET_H = 1.5
/** 平时的喷水力度；每隔几秒猛喷一次，力度迅速鼓起再慢慢回落。 */
const CALM = 0.8
const BURST_GAIN = 0.5
const BURST_EVERY: [number, number] = [3.5, 6]
const BURST_RISE = 0.25
const BURST_LEN = 1.6
/** 按最大力度和最长滞空时间算，同时在空中的水珠不到 60 颗，环形复用时最老的一颗早已落下。 */
const DROP_MAX = 96
const DROP_RATE = 30
const GRAVITY = 7
/** 水珠落到出水孔以下这个深度就算落回鲸背；背上更高处的会先被鲸身挡住。 */
const FLOOR = -0.35
/** 建好时先空跑几秒，第一帧就是喷着水的样子，减少动态效果时也停在这一刻。 */
const PREWARM = 6
const PREWARM_STEP = 1 / 30

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * 屋顶鲸鱼背上的喷泉（DeepSeek 店）。鲸身是静态几何，这里只负责水柱、柱顶水花和溅出的水珠。
 * 水柱平时轻轻起伏，每隔几秒猛喷一次；水珠从柱顶向四周溅开，划出弧线落回鲸背。
 */
export class WhaleFountain {
  readonly group = new Group()
  private readonly jet: Mesh
  private readonly crest: Mesh
  readonly drops: InstancedMesh
  private readonly jetGeometry = new CylinderGeometry(0.1, 0.17, 1, 8).translate(0, 0.5, 0)
  private readonly blobGeometry = new IcosahedronGeometry(1, 0)
  private readonly waterMaterial = new MeshStandardMaterial({ color: '#bfe3ff', roughness: 0.35, flatShading: true })
  private readonly dropMaterial = new MeshStandardMaterial({ color: '#d5ecff', roughness: 0.35, flatShading: true })
  private readonly rng: Rng
  private clock = 0
  private power = CALM
  /** 距上一次猛喷开始、距下一次猛喷的秒数。 */
  private burstAge = Infinity
  private untilBurst: number
  private emitCarry = 0
  private nextDrop = 0
  private readonly pool = Array.from({ length: DROP_MAX }, () => ({
    alive: false,
    size: 0,
    position: new Vector3(),
    velocity: new Vector3(),
  }))
  private readonly matrix = new Matrix4()
  private readonly quat = new Quaternion()
  private readonly scale = new Vector3()

  /** mouth 是鲸背上出水孔的位置。 */
  constructor(mouth: Vector3, seed: string) {
    this.rng = createRng(seed)
    this.untilBurst = range(this.rng, ...BURST_EVERY)
    this.group.position.copy(mouth)
    this.jet = new Mesh(this.jetGeometry, this.waterMaterial)
    this.crest = new Mesh(this.blobGeometry, this.waterMaterial)
    this.drops = new InstancedMesh(this.blobGeometry, this.dropMaterial, DROP_MAX)
    // 水珠每帧都在动，包围球会过期，不做视锥剔除；细碎的动态影子会闪，都只接收不投射
    this.drops.frustumCulled = false
    for (const mesh of [this.jet, this.crest, this.drops]) mesh.receiveShadow = true
    this.group.add(this.jet, this.crest, this.drops)
    for (let t = 0; t < PREWARM; t += PREWARM_STEP) this.step(PREWARM_STEP)
    this.writeMeshes()
  }

  /** 水柱当前高出出水孔的米数。 */
  get jetHeight(): number {
    return JET_H * this.power
  }

  get dropCount(): number {
    return this.pool.reduce((sum, drop) => sum + (drop.alive ? 1 : 0), 0)
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.step(dt)
    this.writeMeshes()
  }

  dispose(): void {
    this.drops.dispose()
    this.jetGeometry.dispose()
    this.blobGeometry.dispose()
    this.waterMaterial.dispose()
    this.dropMaterial.dispose()
  }

  /** 喷水力度：平时在 CALM 附近轻轻起伏，猛喷时迅速鼓起、再慢慢回落。 */
  private strength(): number {
    const t = this.clock
    const flutter = 0.06 * Math.sin(t * 5.3) + 0.04 * Math.sin(t * 8.9 + 1.3)
    const a = this.burstAge
    const burst = a < BURST_RISE ? smoothstep(a / BURST_RISE) : 1 - smoothstep((a - BURST_RISE) / (BURST_LEN - BURST_RISE))
    return CALM + flutter + BURST_GAIN * burst
  }

  private step(dt: number): void {
    this.clock += dt
    this.burstAge += dt
    this.untilBurst -= dt
    if (this.untilBurst <= 0) {
      this.untilBurst += range(this.rng, ...BURST_EVERY)
      this.burstAge = 0
    }
    this.power = this.strength()
    for (const drop of this.pool) {
      if (!drop.alive) continue
      drop.velocity.y -= GRAVITY * dt
      drop.position.addScaledVector(drop.velocity, dt)
      if (drop.position.y < FLOOR) drop.alive = false
    }
    this.emitCarry += DROP_RATE * this.power * dt
    while (this.emitCarry >= 1) {
      this.emitCarry -= 1
      this.emit()
    }
  }

  /** 从柱顶放出一颗水珠：力度越大，溅得越高越远。 */
  private emit(): void {
    const drop = this.pool[this.nextDrop]
    this.nextDrop = (this.nextDrop + 1) % DROP_MAX
    const angle = this.rng() * Math.PI * 2
    const out = range(this.rng, 0.4, 0.9) * (this.power / CALM)
    drop.alive = true
    drop.size = range(this.rng, 0.07, 0.13)
    drop.position.set(Math.cos(angle) * 0.06, this.jetHeight, Math.sin(angle) * 0.06)
    drop.velocity.set(Math.cos(angle) * out, range(this.rng, 1, 2) * this.power, Math.sin(angle) * out)
  }

  private writeMeshes(): void {
    const h = this.jetHeight
    const girth = 1 + 0.4 * (this.power - CALM)
    this.jet.scale.set(girth, h, girth)
    // 柱顶的水花一鼓一鼓的
    const r = 0.21 + 0.1 * (this.power - CALM) + 0.03 * Math.sin(this.clock * 9.7)
    this.crest.position.y = h
    this.crest.scale.set(r * 1.25, r * 0.7, r * 1.25)
    this.crest.rotation.y = this.clock * 0.8
    this.pool.forEach((drop, i) => {
      if (!drop.alive) {
        this.drops.setMatrixAt(i, this.matrix.makeScale(0, 0, 0))
        return
      }
      // 快落回鲸背时缩小，像是溅散开
      const s = drop.size * (0.35 + 0.65 * smoothstep((drop.position.y - FLOOR) / 0.5))
      this.drops.setMatrixAt(i, this.matrix.compose(drop.position, this.quat, this.scale.set(s, s * 1.3, s)))
    })
    this.drops.instanceMatrix.needsUpdate = true
  }
}

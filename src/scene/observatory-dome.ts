import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { createRng } from '@/lib/rng'

/** 穹顶尺寸：比原先静态版（2.7 × 2.4）收小一圈，给旁边的新月让出视线。 */
export const DOME_R = 2.1
export const DOME_H = 1.9
/** 穹顶左右来回转动的幅度（弧度）和周期（秒）。 */
const TURN = 1.1
const TURN_PERIOD = 18
/** 望远镜俯仰范围。 */
const TILT_MIN = 0.45
const TILT_MAX = 1.05
const SLIT_STEPS = 6

/**
 * 天文台穹顶（Kimi 店）。底座鼓身是静态几何，这里负责会转动的穹顶、
 * 观测缝和慢慢俯仰的望远镜；夜里观测缝透出暖光。
 */
export class ObservatoryDome {
  readonly group = new Group()
  /** 绕竖轴转动的穹顶整体。 */
  readonly turret = new Group()
  /** 望远镜俯仰的转轴。 */
  readonly telescope = new Group()
  private readonly shellGeometry = new SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2)
  private readonly boxGeometry = new BoxGeometry(1, 1, 1)
  private readonly tubeGeometry = new CylinderGeometry(0.22, 0.3, 1, 10).translate(0, 0.5, 0)
  private readonly shellMaterial: MeshStandardMaterial
  private readonly ribMaterial: MeshStandardMaterial
  private readonly slitMaterial = new MeshStandardMaterial({
    color: '#1a1d26',
    emissive: '#ffcf7a',
    emissiveIntensity: 0,
    roughness: 0.9,
    flatShading: true,
  })
  private readonly tubeMaterial = new MeshStandardMaterial({ color: '#d8dce4', roughness: 0.4, metalness: 0.4, flatShading: true })
  private readonly phase: number
  private clock = 0

  /** base 是穹顶底面中心（鼓身顶面）。 */
  constructor(base: Vector3, color: string, rib: string, seed: string) {
    this.phase = createRng(seed)() * Math.PI * 2
    this.shellMaterial = new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, flatShading: true })
    this.ribMaterial = new MeshStandardMaterial({ color: rib, roughness: 0.6, flatShading: true })
    this.group.position.copy(base)

    const shell = new Mesh(this.shellGeometry, this.shellMaterial)
    shell.scale.set(DOME_R, DOME_H, DOME_R)
    this.turret.add(shell)

    // 观测缝：沿 +z 经线的一串小块，夜里发光
    const at = (phi: number) => new Vector3(0, DOME_H * Math.cos(phi), DOME_R * Math.sin(phi)).multiplyScalar(1.005)
    for (let i = 0; i < SLIT_STEPS; i += 1) {
      const a = at((i / SLIT_STEPS) * (Math.PI / 2))
      const b = at(((i + 1) / SLIT_STEPS) * (Math.PI / 2))
      this.turret.add(this.strip(a, b, 0.55, this.slitMaterial))
    }
    // 缝两侧的肋条，让转动一眼能看出来
    for (const s of [-1, 1]) {
      const side = (phi: number) => {
        const p = at(phi)
        const r = Math.hypot(p.x, p.z) || 1
        return p.add(new Vector3(s * 0.34, 0, 0).multiplyScalar(Math.min(1, r / DOME_R)))
      }
      for (let i = 0; i < SLIT_STEPS; i += 1) {
        const a = side((i / SLIT_STEPS) * (Math.PI / 2))
        const b = side(((i + 1) / SLIT_STEPS) * (Math.PI / 2))
        this.turret.add(this.strip(a, b, 0.12, this.ribMaterial))
      }
    }

    // 望远镜：从穹顶中部伸出观测缝
    this.telescope.position.set(0, DOME_H * 0.45, DOME_R * 0.35)
    const tube = new Mesh(this.tubeGeometry, this.tubeMaterial)
    tube.scale.set(1, 2.0, 1)
    this.telescope.add(tube)
    this.turret.add(this.telescope)

    this.group.add(this.turret)
    for (const mesh of this.meshes()) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    this.write()
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.clock += dt
    this.write()
  }

  setNight(night: boolean): void {
    this.slitMaterial.emissiveIntensity = night ? 0.9 : 0
  }

  dispose(): void {
    for (const g of [this.shellGeometry, this.boxGeometry, this.tubeGeometry]) g.dispose()
    for (const m of [this.shellMaterial, this.ribMaterial, this.slitMaterial, this.tubeMaterial]) m.dispose()
  }

  private write(): void {
    const t = this.clock + this.phase * TURN_PERIOD
    const w = (Math.PI * 2) / TURN_PERIOD
    // 来回转动时在两端稍作停顿，像在对准目标
    this.turret.rotation.y = TURN * Math.sin(Math.sin(t * w) * (Math.PI / 2))
    const k = 0.5 + 0.5 * Math.sin(t * w * 1.7 + 1)
    this.telescope.rotation.x = TILT_MIN + (TILT_MAX - TILT_MIN) * k
  }

  private strip(a: Vector3, b: Vector3, width: number, material: MeshStandardMaterial): Mesh {
    const mesh = new Mesh(this.boxGeometry, material)
    mesh.position.addVectors(a, b).multiplyScalar(0.5)
    mesh.scale.set(width, 0.08, a.distanceTo(b) + 0.02)
    mesh.lookAt(mesh.position.clone().add(b.clone().sub(a)))
    return mesh
  }

  private meshes(): Mesh[] {
    const out: Mesh[] = []
    this.group.traverse((o) => {
      if (o instanceof Mesh) out.push(o)
    })
    return out
  }
}

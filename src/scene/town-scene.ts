import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Frustum,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { preloadLabLogos } from '@/lib/lab-logos'
import type { LabShop, TownSnapshot } from '@/lib/town-data'
import { GeometryBucket } from '@/scene/geometry-bucket'
import { SIDEWALK_H, townLayout, type Bounds } from '@/scene/layout'
import { Crowd, crowdStops, type CrowdHead } from '@/scene/people'
import type { LightPool, TownBuckets } from '@/scene/props'
import { sceneThemeAt, type SceneTheme } from '@/scene/scene-theme'
import { buildShop, type BuiltShop } from '@/scene/shop-builder'
import { lanesForQueue } from '@/scene/shop-layout'
import { buildStreets, Traffic, type Visibility } from '@/scene/street'
import { waitForFonts } from '@/scene/textures'
import { buildWalkNetwork, TrafficSignal } from '@/scene/walk-network'

export interface TownSceneOptions {
  /** 小镇时间（一天中的小时数，0–24），决定天色、光照和路灯。 */
  hours: number
  dof: boolean
  reducedMotion: boolean
  /** 进出店节奏的倍数，默认 1。 */
  doorSpeed?: number
  /** 窄屏：镜头拉远，焦点上移给底部数据卡留位置。 */
  compact?: boolean
  onSelect: (id: string) => void
  onHover?: (id: string | null) => void
  onError?: (message: string) => void
}

export interface FocusOptions {
  instant?: boolean
}

interface Tween {
  fromTarget: Vector3
  fromPosition: Vector3
  toTarget: Vector3
  toPosition: Vector3
  lift: number
  elapsed: number
}

interface LampSpot {
  position: Vector3
  color: string
  intensity: number
  distance: number
}

type BubbleState = 'idle' | 'entering' | 'showing' | 'leaving'

interface Bubble {
  object: CSS2DObject
  inner: HTMLDivElement
  state: BubbleState
  age: number
  read: (() => CrowdHead | null) | null
}

const FOV = 32
/** 默认视角：从右前方俯看，仰角约 38°。 */
const DEFAULT_VIEW = { theta: 0.62, phi: 0.91, distance: 58, compactDistance: 72 }
/** 焦点在画面里的偏移（占宽高的比例），给左侧信息卡和底部数据卡让位。 */
const VIEW_SHIFT = { desktop: { x: 0.07, y: 0.03 }, compact: { x: 0, y: 0.09 } }
const TWEEN_SECONDS = 1.1
const POINT_LIGHTS = 6
const BOKEH = { aperture: 0.0008, maxblur: 0.018 }
/** 地面光斑在全黑夜里的不透明度。 */
const POOL_OPACITY = 0.5
const CLICK_SLOP = 5
const CLICK_MS = 500
const BUBBLE_EVERY = 3.5
const BUBBLE_SHOW = 3
const BUBBLE_FADE = 0.3
const PHRASES = [
  '听说这家上新了',
  '上下文够我塞一整本书',
  '排队也值得',
  '今天的 token 格外香',
  '先来一百万个',
  '输出价格有点小贵…',
  '有图片模态吗？',
  '我只是来看看',
  '朋友推荐来的',
  '周末再来一趟',
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** 地面光斑用的径向渐变遮罩。 */
function createPoolTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
  }
  return new CanvasTexture(canvas)
}

/**
 * 小镇场景总控：渲染器、后期、灯光、相机控制、拾取、昼夜切换和逐帧动画。
 * React 只通过公开方法驱动它，场景内部不持有任何 React 状态。
 */
export class TownScene {
  private readonly container: HTMLElement
  private readonly options: TownSceneOptions
  private readonly renderer: WebGLRenderer
  private readonly labels = new CSS2DRenderer()
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 600)
  private readonly controls: OrbitControls
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private readonly bokeh: BokehPass
  private readonly outputPass = new OutputPass()
  private readonly hemi = new HemisphereLight()
  private readonly sun = new DirectionalLight()
  private readonly sunDir = new Vector3()
  private readonly lamps: PointLight[] = []
  private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>
  private readonly town = new Group()
  private readonly materials = {
    solid: new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, flatShading: true }),
    windowsNight: new MeshBasicMaterial({ vertexColors: true }),
    windowsDay: new MeshStandardMaterial({ color: '#4a5a70', roughness: 0.28, metalness: 0.1 }),
    glowNight: new MeshBasicMaterial({ vertexColors: true }),
    glowDay: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }),
    pool: new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.5, fog: false }),
  }
  private readonly poolTexture = createPoolTexture()
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly hoverLabel: CSS2DObject
  private readonly hoverName: HTMLSpanElement
  private readonly bubble: Bubble
  private readonly resizeObserver: ResizeObserver
  private readonly frustum = new Frustum()
  private readonly viewMatrix = new Matrix4()
  private readonly probe = new Sphere()

  private theme: SceneTheme
  private reducedMotion: boolean
  private compact: boolean
  private doorSpeed: number
  private shops: BuiltShop[] = []
  private shopData = new Map<string, LabShop>()
  private builtById = new Map<string, BuiltShop>()
  private hitBoxes: Mesh[] = []
  private windowsMesh: Mesh | null = null
  private glowMesh: Mesh | null = null
  private staticMeshes: Mesh[] = []
  private pools: InstancedMesh | null = null
  private crowd: Crowd | null = null
  private traffic: Traffic | null = null
  private lampSpots: LampSpot[] = []
  private readonly lampAnchor = new Vector3(Infinity, 0, 0)
  private shadowExtent = 0
  private bounds: Bounds = townLayout(0).bounds
  private hasView = false
  private focusId: string | null = null
  private hoverId: string | null = null
  private tween: Tween | null = null
  private raf = 0
  private lastTime = 0
  private disposed = false
  private contextLost = false
  private buildToken = 0
  private width = 1
  private height = 1
  private readonly maxPixelRatio: number
  private pixelRatio: number
  private frameTotal = 0
  private frameSamples = 0
  private pointerDown: { x: number; y: number; time: number } | null = null
  private pointer: { x: number; y: number } | null = null
  private hoverDirty = false
  private bubbleTimer = BUBBLE_EVERY

  constructor(container: HTMLElement, options: TownSceneOptions) {
    this.container = container
    this.options = options
    this.theme = sceneThemeAt(options.hours)
    this.reducedMotion = options.reducedMotion
    this.compact = options.compact ?? false
    this.doorSpeed = options.doorSpeed ?? 1

    // WebGL 不可用时这里会抛错，由调用方展示回退界面
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.maxPixelRatio = Math.min(2, window.devicePixelRatio || 1)
    this.pixelRatio = this.maxPixelRatio
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    // 阴影每帧只画一次，景深的深度通道不再重画
    this.renderer.shadowMap.autoUpdate = false
    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'
    container.appendChild(canvas)

    const labelRoot = this.labels.domElement
    labelRoot.style.position = 'absolute'
    labelRoot.style.inset = '0'
    labelRoot.style.pointerEvents = 'none'
    labelRoot.style.overflow = 'hidden'
    container.appendChild(labelRoot)

    this.composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }))
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: DEFAULT_VIEW.distance, ...BOKEH })
    this.bokeh.enabled = options.dof
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bokeh)
    this.composer.addPass(this.outputPass)

    this.scene.background = new Color()
    this.scene.fog = new Fog(0x000000, 100, 300)
    this.scene.add(this.hemi, this.sun, this.sun.target, this.town)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 240
    for (let i = 0; i < POINT_LIGHTS; i += 1) {
      // 数量固定、白天强度归零，昼夜切换不触发着色器重编译
      const light = new PointLight('#ffc98a', 0, 14, 2)
      this.lamps.push(light)
      this.scene.add(light)
    }
    this.ground = new Mesh(new PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new MeshStandardMaterial({ roughness: 0.95 }))
    this.ground.receiveShadow = true
    this.scene.add(this.ground)
    this.materials.pool.map = this.poolTexture

    const label = document.createElement('div')
    label.className = 'town-label flex items-center gap-1.5'
    this.hoverName = document.createElement('span')
    this.hoverName.className = 'font-medium'
    label.append(this.hoverName)
    this.hoverLabel = new CSS2DObject(label)
    this.hoverLabel.center.set(0.5, 1)
    this.hoverLabel.visible = false
    this.scene.add(this.hoverLabel)

    // CSS2DRenderer 会改写外层元素的 transform，淡入动画放在内层
    const bubbleWrap = document.createElement('div')
    const bubbleInner = document.createElement('div')
    bubbleInner.className = 'town-bubble'
    bubbleInner.dataset.visible = 'false'
    bubbleWrap.appendChild(bubbleInner)
    const bubbleObject = new CSS2DObject(bubbleWrap)
    bubbleObject.center.set(0.5, 1)
    bubbleObject.visible = false
    this.scene.add(bubbleObject)
    this.bubble = { object: bubbleObject, inner: bubbleInner, state: 'idle', age: 0, read: null }

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = !this.reducedMotion
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 24
    this.controls.maxDistance = 120
    this.controls.minPolarAngle = 0.35
    this.controls.maxPolarAngle = 1.2
    this.controls.screenSpacePanning = false
    this.controls.addEventListener('change', this.onControlsChange)

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    document.addEventListener('visibilitychange', this.onVisibility)

    this.moveTo(new Vector3(0, 0, -10), this.defaultOffset(), true)
    this.applyTheme()
    this.resizeObserver = new ResizeObserver(() => this.applySize())
    this.resizeObserver.observe(container)
    this.applySize()
  }

  /** 按快照整城重建。等字体和厂商 Logo 就绪后再画招牌，避免贴图里用回退字体或缺 Logo。 */
  async setSnapshot(snapshot: TownSnapshot): Promise<void> {
    const token = ++this.buildToken
    await Promise.all([waitForFonts(), preloadLabLogos(snapshot.shops.map((shop) => shop.id))])
    if (this.disposed || token !== this.buildToken) return
    this.build(snapshot)
  }

  /**
   * 实时数据更新：店铺组成（id 与顺序）和每家的队道数都没变时，只调整排队人数、重画挂牌，
   * 行人、车流和镜头都不受影响；否则整场重建。
   */
  async updateSnapshot(snapshot: TownSnapshot): Promise<void> {
    if (!this.canPatch(snapshot)) {
      await this.setSnapshot(snapshot)
      return
    }
    // 作废还在等待中的旧快照，以最新的数据为准
    this.buildToken += 1
    snapshot.shops.forEach((shop, i) => {
      const built = this.shops[i]
      built.refreshPlaque(shop)
      built.queueSize = shop.queue
      this.crowd?.setQueueTarget(shop.id, shop.queue)
    })
    this.shopData = new Map(snapshot.shops.map((shop) => [shop.id, shop]))
    this.requestRender()
  }

  /** 是否能就地更新，不必重建。 */
  canPatch(snapshot: TownSnapshot): boolean {
    if (!this.crowd || this.shops.length !== snapshot.shops.length) return false
    return snapshot.shops.every((shop, i) => this.shops[i].id === shop.id && lanesForQueue(shop.queue) === this.shops[i].queue.lanes)
  }

  focus(id: string, options: FocusOptions = {}): void {
    this.focusId = id
    const built = this.builtById.get(id)
    // 场景还没建好时只记下焦点，建好后直接定位
    if (!built) return
    const offset = this.camera.position.clone().sub(this.controls.target)
    offset.setLength(clamp(offset.length(), 30, 90))
    this.hideBubble()
    this.moveTo(built.focus, offset, options.instant)
  }

  resetView(): void {
    const built = this.focusId ? this.builtById.get(this.focusId) : undefined
    this.moveTo(built?.focus ?? this.controls.target.clone(), this.defaultOffset(), false)
  }

  /** 切换小镇时间：天色、太阳方位、路灯和招牌亮度随之连续变化。 */
  setTimeOfDay(hours: number): void {
    this.theme = sceneThemeAt(hours)
    this.applyTheme()
  }

  setDof(enabled: boolean): void {
    this.bokeh.enabled = enabled
    this.requestRender()
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced === this.reducedMotion) return
    this.reducedMotion = reduced
    this.controls.enableDamping = !reduced
    if (reduced) {
      if (this.tween) this.finishTween()
      this.hideBubble(true)
      // 减少动态效果时火箭不发射，飞到一半的也回到发射台
      for (const shop of this.shops) shop.rocket?.reset()
    }
    this.requestRender()
  }

  /** 调整顾客进出店的节奏；换周重建人群时沿用。 */
  setDoorSpeed(speed: number): void {
    this.doorSpeed = speed
    this.crowd?.setDoorSpeed(speed)
  }

  setCompact(compact: boolean): void {
    if (compact === this.compact) return
    this.compact = compact
    this.applyViewOffset()
    this.requestRender()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerCancel)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('webglcontextlost', this.onContextLost)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.resizeObserver.disconnect()
    this.controls.removeEventListener('change', this.onControlsChange)
    this.controls.dispose()
    this.clearTown()
    for (const material of Object.values(this.materials) as Material[]) material.dispose()
    this.poolTexture.dispose()
    this.ground.geometry.dispose()
    this.ground.material.dispose()
    this.renderPass.dispose()
    this.bokeh.dispose()
    this.outputPass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    // 主动释放上下文，开发模式下反复挂载也不会耗尽浏览器的 WebGL 上下文配额
    this.renderer.forceContextLoss()
    canvas.remove()
    this.labels.domElement.remove()
  }

  private build(snapshot: TownSnapshot) {
    this.clearTown()
    const layout = townLayout(snapshot.shops.length)
    const buckets: TownBuckets = { solid: new GeometryBucket(), windows: new GeometryBucket(), glow: new GeometryBucket() }
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.shops = snapshot.shops.map((shop, i) => buildShop(shop, i, layout.shopSlots[i], buckets, { anisotropy }))
    const { network, stopNodes } = buildWalkNetwork(layout, crowdStops(this.shops))
    const streets = buildStreets(layout, network, buckets)

    const solid = this.addStatic(buckets.solid.build(), this.materials.solid)
    if (solid) {
      solid.castShadow = true
      solid.receiveShadow = true
    }
    this.windowsMesh = this.addStatic(buckets.windows.build(), this.materials.windowsNight)
    if (this.windowsMesh) this.windowsMesh.receiveShadow = true
    this.glowMesh = this.addStatic(buckets.glow.build(), this.materials.glowNight)
    for (const shop of this.shops) this.town.add(shop.root)

    this.pools = this.buildPools([...this.shops.flatMap((shop) => shop.pools), ...streets.pools])
    if (this.pools) this.town.add(this.pools)
    // 行人和车辆共用同一组信号灯：车流推进时间，行人只读取
    const signal = new TrafficSignal()
    this.crowd = new Crowd({ shops: this.shops, network, stopNodes, signal, seed: snapshot.week, doorSpeed: this.doorSpeed })
    this.town.add(...this.crowd.meshes)
    this.traffic = new Traffic(layout, streets.signalHeads, signal)
    this.town.add(...this.traffic.meshes)

    this.shopData = new Map(snapshot.shops.map((shop) => [shop.id, shop]))
    this.builtById = new Map(this.shops.map((shop) => [shop.id, shop]))
    this.hitBoxes = this.shops.map((shop) => shop.hitBox)
    this.bounds = layout.bounds
    this.lampSpots = [
      ...this.shops.map((shop) => ({ position: shop.lightSpot, color: '#ffc47a', intensity: 26, distance: 16 })),
      ...streets.lampSpots.map((position) => ({ position, color: '#ffd9a0', intensity: 16, distance: 13 })),
    ]
    this.lampAnchor.set(Infinity, 0, 0)
    this.town.updateMatrixWorld(true)
    this.applyTheme()

    const focus = this.focusId && this.builtById.has(this.focusId) ? this.focusId : (this.shops[0]?.id ?? null)
    this.focusId = focus
    const target = focus ? this.builtById.get(focus)!.focus : new Vector3(0, 0, (layout.bounds.minZ + layout.bounds.maxZ) / 2)
    const offset = this.hasView ? this.camera.position.clone().sub(this.controls.target) : this.defaultOffset()
    this.moveTo(target, offset, true)
    this.hasView = true
    this.setHover(null)
    this.frameTotal = 0
    this.frameSamples = 0
    this.requestRender()
  }

  private addStatic(geometry: BufferGeometry | null, material: Material): Mesh | null {
    if (!geometry) return null
    const mesh = new Mesh(geometry, material)
    this.staticMeshes.push(mesh)
    this.town.add(mesh)
    return mesh
  }

  private buildPools(pools: LightPool[]): InstancedMesh | null {
    if (!pools.length) return null
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.materials.pool, pools.length)
    const matrix = new Matrix4()
    const color = new Color()
    pools.forEach((pool, i) => {
      // 统一抬到人行道之上，路面上的部分略微悬空，从俯视角看不出来
      matrix.makeScale(pool.radius * 2, 1, pool.radius * 2).setPosition(pool.x, Math.max(pool.y, SIDEWALK_H) + 0.06, pool.z)
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, color.set(pool.color))
    })
    mesh.renderOrder = 2
    mesh.computeBoundingSphere()
    return mesh
  }

  private clearTown() {
    for (const shop of this.shops) shop.dispose()
    this.shops = []
    for (const mesh of this.staticMeshes) mesh.geometry.dispose()
    this.staticMeshes = []
    this.windowsMesh = null
    this.glowMesh = null
    if (this.pools) {
      this.pools.geometry.dispose()
      this.pools.dispose()
      this.pools = null
    }
    this.crowd?.dispose()
    this.crowd = null
    this.traffic?.dispose()
    this.traffic = null
    this.town.clear()
    this.hitBoxes = []
    this.hideBubble(true)
  }

  private applyTheme() {
    const t = this.theme
    ;(this.scene.background as Color).set(t.background)
    const fog = this.scene.fog as Fog
    fog.color.set(t.fog)
    fog.near = t.fogNear
    fog.far = t.fogFar
    this.hemi.color.set(t.hemiSky)
    this.hemi.groundColor.set(t.hemiGround)
    this.hemi.intensity = t.hemiIntensity
    this.sun.color.set(t.sunColor)
    this.sun.intensity = t.sunIntensity
    this.sunDir.set(...t.sunDirection).normalize()
    this.renderer.toneMappingExposure = t.exposure
    this.ground.material.color.set(t.groundColor)
    if (this.windowsMesh) this.windowsMesh.material = t.night ? this.materials.windowsNight : this.materials.windowsDay
    if (this.glowMesh) this.glowMesh.material = t.night ? this.materials.glowNight : this.materials.glowDay
    this.materials.pool.opacity = POOL_OPACITY * t.nightLevel
    if (this.pools) this.pools.visible = t.nightLevel > 0.02
    this.traffic?.setNight(t.night)
    for (const shop of this.shops) {
      for (const { material, weight } of shop.glowMaterials) material.emissiveIntensity = t.signGlow * weight
    }
    this.applyLampIntensity()
    this.requestRender()
  }

  private applyLampIntensity() {
    const sorted = this.sortedLamps()
    this.lamps.forEach((light, i) => {
      const spot = sorted[i]
      light.intensity = spot ? spot.intensity * this.theme.nightLevel : 0
    })
  }

  private sortedLamps(): LampSpot[] {
    const target = this.controls?.target ?? new Vector3()
    return [...this.lampSpots]
      .sort((a, b) => a.position.distanceToSquared(target) - b.position.distanceToSquared(target))
      .slice(0, POINT_LIGHTS)
  }

  /** 点光源只有 6 盏，挪到离焦点最近的店门和路灯下。 */
  private assignLamps() {
    this.lampAnchor.copy(this.controls.target)
    const sorted = this.sortedLamps()
    this.lamps.forEach((light, i) => {
      const spot = sorted[i]
      if (!spot) return
      light.position.copy(spot.position)
      light.color.set(spot.color)
      light.distance = spot.distance
    })
    this.applyLampIntensity()
  }

  private defaultOffset(): Vector3 {
    const distance = this.compact ? DEFAULT_VIEW.compactDistance : DEFAULT_VIEW.distance
    return new Vector3().setFromSpherical(new Spherical(distance, DEFAULT_VIEW.phi, DEFAULT_VIEW.theta))
  }

  private moveTo(target: Vector3, offset: Vector3, instant = false) {
    const toPosition = target.clone().add(offset)
    if (instant || this.reducedMotion) {
      this.tween = null
      this.controls.target.copy(target)
      this.camera.position.copy(toPosition)
      this.controls.enabled = true
      this.controls.update()
      this.requestRender()
      return
    }
    const travel = this.controls.target.distanceTo(target)
    this.tween = {
      fromTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      toTarget: target.clone(),
      toPosition,
      // 跨街区移动时镜头稍微抬高，像摇臂一样越过屋顶
      lift: Math.min(10, travel * 0.12),
      elapsed: 0,
    }
    this.controls.enabled = false
    this.requestRender()
  }

  private updateTween(dt: number) {
    const tween = this.tween
    if (!tween) return
    tween.elapsed += dt
    const t = Math.min(1, tween.elapsed / TWEEN_SECONDS)
    const k = easeInOutCubic(t)
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k)
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, k)
    this.camera.position.y += Math.sin(Math.PI * k) * tween.lift
    this.camera.lookAt(this.controls.target)
    if (t >= 1) this.finishTween()
  }

  private finishTween() {
    const tween = this.tween
    if (!tween) return
    this.tween = null
    this.controls.target.copy(tween.toTarget)
    this.camera.position.copy(tween.toPosition)
    this.controls.enabled = true
    this.controls.update()
  }

  private onControlsChange = () => {
    // 平移限制在小镇范围内：目标和相机一起挪，保持当前视角
    const t = this.controls.target
    const x = clamp(t.x, this.bounds.minX, this.bounds.maxX)
    const y = clamp(t.y, 0, 12)
    const z = clamp(t.z, this.bounds.minZ, this.bounds.maxZ)
    if (x !== t.x || y !== t.y || z !== t.z) {
      this.camera.position.x += x - t.x
      this.camera.position.y += y - t.y
      this.camera.position.z += z - t.z
      t.set(x, y, z)
    }
    if (this.reducedMotion) this.requestRender()
  }

  private applySize() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.width = width
    this.height = height
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(width, height, false)
    this.composer.setPixelRatio(this.pixelRatio)
    this.composer.setSize(width, height)
    this.labels.setSize(width, height)
    this.camera.aspect = width / height
    this.applyViewOffset()
    this.requestRender()
  }

  private applyViewOffset() {
    const shift = this.compact ? VIEW_SHIFT.compact : VIEW_SHIFT.desktop
    const { width, height } = this
    this.camera.setViewOffset(width, height, -shift.x * width, shift.y * height, width, height)
  }

  private requestRender() {
    if (this.raf || this.disposed || this.contextLost || document.hidden) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed || this.contextLost) return
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0
    this.lastTime = now
    const animate = !this.reducedMotion

    if (animate) {
      const visible = this.visibility()
      this.crowd?.update(dt, visible)
      this.traffic?.update(dt, visible)
      for (const shop of this.shops) {
        shop.rocket?.update(dt)
        shop.smoke?.update(dt)
        shop.fountain?.update(dt)
      }
      this.updateBubble(dt)
    }
    this.updateTween(dt)
    if (animate && !this.tween) this.controls.update()
    if (this.hoverDirty && !this.pointerDown) {
      this.hoverDirty = false
      this.setHover(this.pointer ? this.pick(this.pointer.x, this.pointer.y) : null)
    }
    this.syncFollowers()

    this.renderer.shadowMap.needsUpdate = true
    this.composer.render(dt)
    this.labels.render(this.scene, this.camera)

    if (animate || this.tween) {
      this.sampleFrame(dt)
      this.requestRender()
    } else {
      this.lastTime = 0
    }
  }

  /** 当前镜头的视锥判定：行人和车辆只在画面外出生、消失，不会在眼前凭空刷新。 */
  private visibility(): Visibility {
    this.camera.updateMatrixWorld()
    this.viewMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewMatrix)
    return (x, y, z, radius) => {
      this.probe.center.set(x, y, z)
      this.probe.radius = radius
      return this.frustum.intersectsSphere(this.probe)
    }
  }

  /** 主光、阴影范围、点光源和景深焦距都跟着镜头目标走。 */
  private syncFollowers() {
    const target = this.controls.target
    this.sun.position.copy(target).addScaledVector(this.sunDir, 110)
    this.sun.target.position.copy(target)
    this.sun.target.updateMatrixWorld()
    const distance = this.camera.position.distanceTo(target)
    const extent = clamp(distance * 0.72, 28, 70)
    if (Math.abs(extent - this.shadowExtent) > 2) {
      this.shadowExtent = extent
      const cam = this.sun.shadow.camera
      cam.left = -extent
      cam.right = extent
      cam.top = extent
      cam.bottom = -extent
      cam.updateProjectionMatrix()
    }
    if (this.bokeh.enabled) (this.bokeh.uniforms as Record<string, { value: unknown }>).focus.value = distance
    if (this.lampAnchor.distanceToSquared(target) > 9) this.assignLamps()
  }

  /** 按平均帧耗时微调像素比：卡顿时降清晰度，富余时再升回来。 */
  private sampleFrame(dt: number) {
    if (dt <= 0) return
    this.frameTotal += dt
    this.frameSamples += 1
    if (this.frameTotal < 2) return
    const average = (this.frameTotal / this.frameSamples) * 1000
    this.frameTotal = 0
    this.frameSamples = 0
    const min = Math.min(1, this.maxPixelRatio)
    let next = this.pixelRatio
    if (average > 24 && this.pixelRatio > min) next = Math.max(min, this.pixelRatio - 0.25)
    else if (average < 12 && this.pixelRatio < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25)
    if (next !== this.pixelRatio) {
      this.pixelRatio = next
      this.applySize()
    }
  }

  private updateBubble(dt: number) {
    const bubble = this.bubble
    this.bubbleTimer -= dt
    if (bubble.state !== 'idle') {
      bubble.age += dt
      const head = bubble.read?.()
      if (head) bubble.object.position.set(head.x, head.y + 0.3, head.z)
      if (bubble.state === 'entering') {
        // 先以透明状态显示一帧，再切换可见，淡入过渡才会生效
        bubble.inner.dataset.visible = 'true'
        bubble.state = 'showing'
      } else if (bubble.state === 'showing' && (!head || bubble.age > BUBBLE_SHOW)) {
        this.hideBubble()
      } else if (bubble.state === 'leaving' && bubble.age > BUBBLE_FADE) {
        this.hideBubble(true)
      }
      return
    }
    if (this.bubbleTimer > 0) return
    this.bubbleTimer = BUBBLE_EVERY * (0.8 + Math.random() * 0.5)
    if (!this.focusId || this.tween || !this.crowd) return
    const person = this.crowd.randomHead(this.focusId)
    const head = person?.read()
    if (!person || !head) return
    bubble.inner.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)]
    bubble.inner.dataset.visible = 'false'
    bubble.read = person.read
    bubble.object.position.set(head.x, head.y + 0.3, head.z)
    bubble.object.visible = true
    bubble.state = 'entering'
    bubble.age = 0
  }

  private hideBubble(immediate = false) {
    const bubble = this.bubble
    if (!bubble) return
    bubble.inner.dataset.visible = 'false'
    if (immediate || bubble.state === 'idle' || bubble.state === 'entering') {
      bubble.object.visible = false
      bubble.state = 'idle'
      bubble.read = null
      return
    }
    if (bubble.state === 'showing') {
      bubble.state = 'leaving'
      bubble.age = 0
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    if (!this.hitBoxes.length) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hit = this.raycaster.intersectObjects(this.hitBoxes, false)[0]
    const id = hit?.object.userData.shopId
    return typeof id === 'string' ? id : null
  }

  private setHover(id: string | null) {
    if (id === this.hoverId) return
    this.hoverId = id
    const built = id ? this.builtById.get(id) : undefined
    const shop = id ? this.shopData.get(id) : undefined
    if (built && shop) {
      // 名称来自导入数据，只用 textContent 写入
      this.hoverName.textContent = shop.name
      this.hoverLabel.position.copy(built.labelAnchor)
      this.hoverLabel.visible = true
    } else {
      this.hoverLabel.visible = false
    }
    this.updateCursor()
    this.options.onHover?.(id)
    this.requestRender()
  }

  private updateCursor() {
    this.renderer.domElement.style.cursor = this.pointerDown ? 'grabbing' : this.hoverId ? 'pointer' : 'grab'
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return
    this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() }
    this.updateCursor()
  }

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown
    this.pointerDown = null
    this.updateCursor()
    if (!down || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > CLICK_SLOP || performance.now() - down.time > CLICK_MS) return
    const id = this.pick(event.clientX, event.clientY)
    if (id) this.options.onSelect(id)
  }

  private onPointerCancel = () => {
    this.pointerDown = null
    this.updateCursor()
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    this.pointer = { x: event.clientX, y: event.clientY }
    this.hoverDirty = true
    if (this.reducedMotion) this.requestRender()
  }

  private onPointerLeave = () => {
    this.pointer = null
    this.hoverDirty = false
    this.setHover(null)
  }

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.options.onError?.('图形上下文已丢失，请刷新页面重试。')
  }

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      return
    }
    this.lastTime = 0
    this.requestRender()
  }
}

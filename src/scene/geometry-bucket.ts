import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
  type ColorRepresentation,
} from 'three'

export interface PlaceOptions {
  rotX?: number
  rotY?: number
  rotZ?: number
  /** 底部颜色乘数（0–1），用顶点色模拟墙根的环境光遮蔽。 */
  shade?: number
  /** 先乘上的父级变换（例如整块价目牌的位置和朝向）。 */
  parent?: Matrix4
}

const tmpColor = new Color()
const tmpMatrix = new Matrix4()
const tmpNormalMatrix = new Matrix3()
const tmpQuat = new Quaternion()
const tmpEuler = new Euler()
const tmpScale = new Vector3()
const tmpPos = new Vector3()
const tmpVec = new Vector3()
const X_AXIS = new Vector3(1, 0, 0)

// 单位几何体缓存：所有长方体、圆柱都由同一份顶点缩放而来，建城时不产生大量临时对象。
const unitCache = new Map<string, BufferGeometry>()

function unit(key: string, factory: () => BufferGeometry): BufferGeometry {
  let geometry = unitCache.get(key)
  if (!geometry) {
    const source = factory()
    geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) source.dispose()
    geometry.computeBoundingBox()
    unitCache.set(key, geometry)
  }
  return geometry
}

/**
 * 按材质收集带顶点色的几何，最后一次性生成 BufferGeometry。
 * 整个小镇的静态几何因此只占少量 draw call；颜色写在顶点上，不需要贴图。
 */
export class GeometryBucket {
  private positions: number[] = []
  private normals: number[] = []
  private colors: number[] = []

  get vertexCount(): number {
    return this.positions.length / 3
  }

  /** 写入一份非索引几何；shade 按几何自身的 y 范围计算，旋转前的“底部”更暗。 */
  addGeometry(geometry: BufferGeometry, matrix: Matrix4, color: ColorRepresentation, shade?: number): void {
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const box = geometry.boundingBox
    const minY = box?.min.y ?? 0
    const spanY = box ? box.max.y - box.min.y : 0
    tmpColor.set(color)
    tmpNormalMatrix.getNormalMatrix(matrix)
    for (let i = 0; i < position.count; i += 1) {
      tmpVec.fromBufferAttribute(position, i)
      let factor = 1
      if (shade !== undefined && spanY > 0) {
        const t = (tmpVec.y - minY) / spanY
        factor = shade + (1 - shade) * Math.min(1, t * 2.2)
      }
      tmpVec.applyMatrix4(matrix)
      this.positions.push(tmpVec.x, tmpVec.y, tmpVec.z)
      tmpVec.fromBufferAttribute(normal, i).applyMatrix3(tmpNormalMatrix).normalize()
      this.normals.push(tmpVec.x, tmpVec.y, tmpVec.z)
      this.colors.push(tmpColor.r * factor, tmpColor.g * factor, tmpColor.b * factor)
    }
  }

  private place(
    geometry: BufferGeometry,
    scale: Vector3,
    x: number,
    y: number,
    z: number,
    color: ColorRepresentation,
    options: PlaceOptions = {},
  ): void {
    tmpEuler.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0)
    tmpQuat.setFromEuler(tmpEuler)
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, scale)
    if (options.parent) tmpMatrix.premultiply(options.parent)
    this.addGeometry(geometry, tmpMatrix, color, options.shade)
  }

  /** 以 (x, y, z) 为中心放一个长方体。 */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: ColorRepresentation, options?: PlaceOptions): void {
    const geometry = unit('box', () => new BoxGeometry(1, 1, 1))
    this.place(geometry, tmpScale.set(w, h, d), x, y, z, color, options)
  }

  /** 以底面中心 (x, y, z) 放一个长方体，建筑类构件用它更直观。 */
  boxOn(w: number, h: number, d: number, x: number, y: number, z: number, color: ColorRepresentation, options?: PlaceOptions): void {
    this.box(w, h, d, x, y + h / 2, z, color, options)
  }

  /** 圆柱或圆台，(x, y, z) 为底面中心。 */
  cylinder(
    radiusTop: number,
    radiusBottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: ColorRepresentation,
    segments = 8,
    options?: PlaceOptions,
  ): void {
    const base = Math.max(radiusTop, radiusBottom)
    const ratioTop = Math.round((radiusTop / base) * 100) / 100
    const ratioBottom = Math.round((radiusBottom / base) * 100) / 100
    const geometry = unit(`cyl:${ratioTop}:${ratioBottom}:${segments}`, () => new CylinderGeometry(ratioTop, ratioBottom, 1, segments))
    this.place(geometry, tmpScale.set(base, h, base), x, y + h / 2, z, color, options)
  }

  /** 低多边形球团（树冠、灌木），(x, y, z) 为中心。 */
  blob(radius: number, x: number, y: number, z: number, color: ColorRepresentation, options?: PlaceOptions, squash = 1): void {
    const geometry = unit('ico', () => new IcosahedronGeometry(1, 0))
    this.place(geometry, tmpScale.set(radius, radius * squash, radius), x, y, z, color, options)
  }

  /** 沿 x 方向拉伸的凸多边形截面（坡屋顶、锯齿屋顶）。profile 为 [z, y] 点列，按 z 向右、y 向上逆时针排列。 */
  prism(profile: [number, number][], length: number, x: number, y: number, z: number, color: ColorRepresentation, options?: PlaceOptions): void {
    const key = `prism:${profile.map(([pz, py]) => `${pz.toFixed(2)},${py.toFixed(2)}`).join(';')}`
    const geometry = unit(key, () => extrudeProfile(profile))
    this.place(geometry, tmpScale.set(length, 1, 1), x, y, z, color, options)
  }

  /**
   * 任意单位几何（圆环、半球等），按 key 缓存；(x, y, z) 为几何自身原点所在位置。
   * factory 生成的几何只在第一次用到时创建一次。
   */
  custom(
    key: string,
    factory: () => BufferGeometry,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    color: ColorRepresentation,
    options?: PlaceOptions,
  ): void {
    const geometry = unit(`custom:${key}`, factory)
    this.place(geometry, tmpScale.set(sx, sy, sz), x, y, z, color, options)
  }

  /** 两点之间的细长方体，用于绳索、斜撑和天线。 */
  segment(a: Vector3, b: Vector3, thickness: number, color: ColorRepresentation): void {
    const dir = tmpVec.subVectors(b, a)
    const length = dir.length()
    if (length < 1e-4) return
    tmpQuat.setFromUnitVectors(X_AXIS, dir.normalize())
    tmpMatrix.compose(tmpPos.addVectors(a, b).multiplyScalar(0.5), tmpQuat, tmpScale.set(length, thickness, thickness))
    this.addGeometry(unit('box', () => new BoxGeometry(1, 1, 1)), tmpMatrix, color)
  }

  /** 生成合并后的几何并清空缓冲；没有内容时返回 null。 */
  build(): BufferGeometry | null {
    if (!this.positions.length) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3))
    geometry.computeBoundingSphere()
    this.positions = []
    this.normals = []
    this.colors = []
    return geometry
  }
}

/** 把 [z, y] 截面沿 x 从 -0.5 拉伸到 0.5，生成平面着色的非索引几何。 */
function extrudeProfile(profile: [number, number][]): BufferGeometry {
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c)
  const at = (x: number, [z, y]: [number, number]) => [x, y, z]
  // 两个端面（扇形三角剖分，凸多边形）。从 +x 看过去 z 轴朝左，所以 +x 端面要反序才是正面。
  for (let i = 1; i < profile.length - 1; i += 1) {
    tri(at(0.5, profile[0]), at(0.5, profile[i + 1]), at(0.5, profile[i]))
    tri(at(-0.5, profile[0]), at(-0.5, profile[i]), at(-0.5, profile[i + 1]))
  }
  // 侧面
  for (let i = 0; i < profile.length; i += 1) {
    const p = profile[i]
    const q = profile[(i + 1) % profile.length]
    tri(at(-0.5, p), at(0.5, p), at(0.5, q))
    tri(at(-0.5, p), at(0.5, q), at(-0.5, q))
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

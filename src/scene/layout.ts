/**
 * 小镇平面布局（单位约为米）。整座小镇是规整的街区网格：
 * 每个街区只有一块地（一家店、一座小公园或一栋背景楼），四周一圈人行道，街区之间是双向车道。
 * 店铺按固定厂商顺序逐行从左到右排列，与用量高低无关。
 *
 * 地块局部坐标：原点在地块正面边线的中点，+z 指向正面街道，建筑正立面朝 +z。
 */
export const LOT_W = 18
export const LOT_D = 22
/** 地块四周人行道宽度。 */
export const SIDEWALK_W = 3.2
export const ROAD_W = 8
export const COLS = 4
export const PLAZA_D = 9
export const SIDEWALK_H = 0.25
export const BLOCK_W = LOT_W + SIDEWALK_W * 2
export const BLOCK_D = LOT_D + SIDEWALK_W * 2
export const PITCH_X = BLOCK_W + ROAD_W
export const PITCH_Z = BLOCK_D + ROAD_W
/** 人行道上的步行线距地块边线的距离。 */
export const WALK_INSET = 1.5
/** 店铺区外侧（左右和后方）再铺几圈背景街区。 */
export const FILLER_RING = 2

/** shop：店铺；park：店铺区里的空位；green：店铺区前方的绿地；filler：外圈背景楼。 */
export type BlockKind = 'shop' | 'park' | 'green' | 'filler'

export interface LotSlot {
  row: number
  col: number
  /** 地块中心 x。 */
  x: number
  /** 地块正面边线 z。 */
  z: number
}

export interface Block extends LotSlot {
  kind: BlockKind
  /** 是否在行人路网里；最外圈只做远景，不走人。 */
  walkable: boolean
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface TownLayout {
  rows: number
  shopSlots: LotSlot[]
  parkSlots: LotSlot[]
  blocks: Block[]
  /** 横向道路（车沿 x 行驶）中心 z，从前往后。 */
  roadZ: number[]
  /** 纵向道路（车沿 z 行驶）中心 x，从左往右。 */
  roadX: number[]
  /** 镜头目标允许移动的范围。 */
  bounds: Bounds
  /** 街区外边界，车道再往外延伸进雾里。 */
  extent: Bounds
}

export function colX(col: number): number {
  return (col - (COLS - 1) / 2) * PITCH_X
}

export function rowZ(row: number): number {
  return -row * PITCH_Z
}

export function slotAt(row: number, col: number): LotSlot {
  return { row, col, x: colX(col), z: rowZ(row) }
}

/** 第 index 家店所在地块：逐行从左到右。 */
export function shopSlot(index: number): LotSlot {
  return slotAt(Math.floor(index / COLS), index % COLS)
}

/** 第 row 行街区正前方那条横向道路的中心 z。 */
export function roadZBefore(row: number): number {
  return rowZ(row) + SIDEWALK_W + ROAD_W / 2
}

/** 第 col 列街区左侧那条纵向道路的中心 x。 */
export function roadXLeftOf(col: number): number {
  return colX(col) - PITCH_X / 2
}

export function isWalkable(row: number, col: number, rows: number): boolean {
  return row >= -1 && row <= rows && col >= -1 && col <= COLS
}

export function townLayout(shopCount: number): TownLayout {
  const rows = Math.max(1, Math.ceil(shopCount / COLS))
  const shopSlots = Array.from({ length: shopCount }, (_, i) => shopSlot(i))
  const parkSlots = Array.from({ length: rows * COLS - shopCount }, (_, i) => shopSlot(shopCount + i))
  const lastRow = rows - 1 + FILLER_RING
  const blocks: Block[] = []
  for (let row = -1; row <= lastRow; row += 1) {
    for (let col = -FILLER_RING; col < COLS + FILLER_RING; col += 1) {
      const inGrid = row >= 0 && row < rows && col >= 0 && col < COLS
      const index = row * COLS + col
      const kind: BlockKind = row === -1 ? 'green' : inGrid ? (index < shopCount ? 'shop' : 'park') : 'filler'
      blocks.push({ ...slotAt(row, col), kind, walkable: isWalkable(row, col, rows) })
    }
  }
  // 最前面那排绿地前面、最后一排背景楼后面也各有一条路
  const roadZ = Array.from({ length: lastRow + 3 }, (_, k) => roadZBefore(k - 1))
  const roadX = Array.from({ length: COLS + FILLER_RING * 2 + 1 }, (_, j) => roadXLeftOf(j - FILLER_RING))
  return {
    rows,
    shopSlots,
    parkSlots,
    blocks,
    roadZ,
    roadX,
    bounds: {
      minX: colX(0) - PITCH_X * 0.6,
      maxX: colX(COLS - 1) + PITCH_X * 0.6,
      minZ: rowZ(rows - 1) - LOT_D - SIDEWALK_W,
      maxZ: rowZ(0) + PITCH_Z * 0.35,
    },
    extent: {
      minX: roadXLeftOf(-FILLER_RING) - ROAD_W / 2,
      maxX: roadXLeftOf(COLS + FILLER_RING) + ROAD_W / 2,
      minZ: roadZBefore(lastRow + 1) - ROAD_W / 2,
      maxZ: roadZBefore(-1) + ROAD_W / 2,
    },
  }
}

/** 人行横道中线到路口中心的距离（横道正好接在街区转角的步行线上）。 */
export const CROSS_OFFSET = SIDEWALK_W + ROAD_W / 2 - WALK_INSET
export const CROSSWALK_W = 2.6
/** 停车线到路口中心的距离。 */
export const STOP_OFFSET = CROSS_OFFSET + CROSSWALK_W / 2 + 0.4

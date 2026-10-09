import { LOT_D, LOT_W, ROAD_W, SIDEWALK_W, WALK_INSET, type TownLayout } from '@/scene/layout'

/**
 * 行人路网（纯数据，便于测试）：每个可步行街区的人行道是一圈步行线，四个转角各一个节点，
 * 转角之间用人行横道连到相邻街区。店铺门前的入队点、出店点也插在临街那条步行线上。
 * 路网边缘的转角是“出入口”：行人从镜头外的出入口走进来，走到镜头外的出入口才离开。
 */
export type Axis = 'x' | 'z'

export interface WalkNode {
  x: number
  z: number
  edges: number[]
  portal: boolean
}

export interface WalkEdge {
  a: number
  b: number
  length: number
  /** 人行横道沿哪个轴行走；普通人行道为 null。 */
  crossing: Axis | null
}

export interface WalkNetwork {
  nodes: WalkNode[]
  edges: WalkEdge[]
}

/** 插在某个街区临街步行线上的节点（入队点、出店点）。 */
export interface FrontStop {
  row: number
  col: number
  x: number
}

/** 人行横道两端从步行线到路缘的距离。 */
export const CURB_GAP = SIDEWALK_W - WALK_INSET
export const CROSSING_LENGTH = ROAD_W + CURB_GAP * 2

function key(row: number, col: number): string {
  return `${row}:${col}`
}

export function buildWalkNetwork(layout: TownLayout, stops: readonly FrontStop[] = []): { network: WalkNetwork; stopNodes: number[] } {
  const nodes: WalkNode[] = []
  const edges: WalkEdge[] = []
  const stopNodes = stops.map(() => -1)
  const addNode = (x: number, z: number) => {
    nodes.push({ x, z, edges: [], portal: false })
    return nodes.length - 1
  }
  const link = (a: number, b: number, crossing: Axis | null) => {
    const length = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
    edges.push({ a, b, length, crossing })
    nodes[a].edges.push(edges.length - 1)
    nodes[b].edges.push(edges.length - 1)
  }

  const halfW = LOT_W / 2 + WALK_INSET
  const corners = new Map<string, { fl: number; fr: number; bl: number; br: number }>()
  const walkable = layout.blocks.filter((block) => block.walkable)
  for (const block of walkable) {
    const frontZ = block.z + WALK_INSET
    const backZ = block.z - LOT_D - WALK_INSET
    const c = {
      fl: addNode(block.x - halfW, frontZ),
      fr: addNode(block.x + halfW, frontZ),
      bl: addNode(block.x - halfW, backZ),
      br: addNode(block.x + halfW, backZ),
    }
    corners.set(key(block.row, block.col), c)
    const own = stops
      .map((stop, index) => ({ ...stop, index }))
      .filter((stop) => stop.row === block.row && stop.col === block.col)
      .sort((a, b) => a.x - b.x)
    let previous = c.fl
    for (const stop of own) {
      const node = addNode(Math.max(block.x - halfW + 0.1, Math.min(block.x + halfW - 0.1, stop.x)), frontZ)
      stopNodes[stop.index] = node
      link(previous, node, null)
      previous = node
    }
    link(previous, c.fr, null)
    link(c.fl, c.bl, null)
    link(c.fr, c.br, null)
    link(c.bl, c.br, null)
  }

  for (const block of walkable) {
    const c = corners.get(key(block.row, block.col))!
    const right = corners.get(key(block.row, block.col + 1))
    if (right) {
      link(c.fr, right.fl, 'x')
      link(c.br, right.bl, 'x')
    }
    // row - 1 是更靠前（+z）的一排
    const ahead = corners.get(key(block.row - 1, block.col))
    if (ahead) {
      link(c.fl, ahead.bl, 'z')
      link(c.fr, ahead.br, 'z')
    }
  }

  for (const c of corners.values()) {
    for (const id of [c.fl, c.fr, c.bl, c.br]) {
      const crossings = nodes[id].edges.filter((e) => edges[e].crossing).length
      nodes[id].portal = crossings < 2
    }
  }
  return { network: { nodes, edges }, stopNodes }
}

export function otherEnd(edge: WalkEdge, node: number): number {
  return edge.a === node ? edge.b : edge.a
}

/** Dijkstra 最短路径，返回途经的边（按行走顺序）；不可达时返回 null。 */
export function shortestPath(network: WalkNetwork, from: number, to: number): number[] | null {
  if (from === to) return []
  const count = network.nodes.length
  const dist = new Float64Array(count).fill(Infinity)
  const via = new Int32Array(count).fill(-1)
  const done = new Uint8Array(count)
  dist[from] = 0
  for (;;) {
    let current = -1
    let best = Infinity
    for (let i = 0; i < count; i += 1) {
      if (!done[i] && dist[i] < best) {
        best = dist[i]
        current = i
      }
    }
    if (current < 0) return null
    if (current === to) break
    done[current] = 1
    for (const edgeId of network.nodes[current].edges) {
      const edge = network.edges[edgeId]
      const next = otherEnd(edge, current)
      const candidate = best + edge.length
      if (candidate < dist[next]) {
        dist[next] = candidate
        via[next] = edgeId
      }
    }
  }
  const path: number[] = []
  let node = to
  while (node !== from) {
    const edgeId = via[node]
    path.push(edgeId)
    node = otherEnd(network.edges[edgeId], node)
  }
  return path.reverse()
}

/**
 * 两相位信号灯：x 相位时沿 x 行驶的车通行、沿 x 行走的行人过马路；z 相位同理。
 * 两个相位之间有一段全红，给还没走完横道的行人和车辆清场。
 */
export const SIGNAL_GREEN = 13
export const SIGNAL_CLEAR = 2.5
export const SIGNAL_CYCLE = (SIGNAL_GREEN + SIGNAL_CLEAR) * 2

export class TrafficSignal {
  constructor(public time = 0) {}

  update(dt: number): void {
    this.time = (this.time + dt) % SIGNAL_CYCLE
  }

  /** 当前放行的轴；全红时为 null。 */
  green(): Axis | null {
    const t = this.time
    if (t < SIGNAL_GREEN) return 'x'
    if (t < SIGNAL_GREEN + SIGNAL_CLEAR) return null
    if (t < SIGNAL_GREEN * 2 + SIGNAL_CLEAR) return 'z'
    return null
  }

  /** 当前绿灯还剩多少秒；全红时为 0。 */
  remaining(): number {
    const t = this.time
    if (t < SIGNAL_GREEN) return SIGNAL_GREEN - t
    const start = SIGNAL_GREEN + SIGNAL_CLEAR
    if (t >= start && t < start + SIGNAL_GREEN) return start + SIGNAL_GREEN - t
    return 0
  }

  /**
   * 行人沿 axis 过马路、需要 seconds 秒走完时，现在能否起步：绿灯加上随后的全红（留 0.5 秒余量）够走完就行。
   * 沿 axis 行驶的车不经过这些横道，全红时横向车流也还没放行。
   */
  canCross(axis: Axis, seconds: number): boolean {
    return this.green() === axis && this.remaining() + SIGNAL_CLEAR - 0.5 >= seconds
  }
}

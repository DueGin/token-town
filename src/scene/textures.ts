import { CanvasTexture, SRGBColorSpace } from 'three'
import { formatTokens, readableTextOn } from '@/lib/format'
import { createRng, pick, range, type Rng } from '@/lib/rng'
import type { LabShop } from '@/lib/town-data'
import type { LabStyle } from '@/scene/lab-styles'

/**
 * 店面上的文字和图案全部画在 Canvas 上再作为贴图：门头招牌、门边挂牌和背墙涂鸦。
 * 招牌与挂牌上的 Logo 来自 lab-logos（商标归各自所有者），没有 Logo 的厂商回退为文字缩写；
 * 涂鸦是按厂商 id 随机生成的原创图案。
 */
export const FONT_STACK = '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

let fontsReady: Promise<void> | null = null

/** 等待 Geist 可用后再绘制，最多等 1.5 秒，超时就用系统字体。 */
export function waitForFonts(): Promise<void> {
  if (fontsReady) return fontsReady
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve()
  const load = Promise.all([
    document.fonts.load(`800 64px ${FONT_STACK}`),
    document.fonts.load(`500 32px ${FONT_STACK}`),
  ]).then(() => undefined)
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
  fontsReady = Promise.race([load, timeout]).catch(() => undefined)
  return fontsReady
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return texture
}

function font(weight: number, size: number): string {
  return `${weight} ${Math.round(size)}px ${FONT_STACK}`
}

/** 缩小字号直到放得下；到最小字号仍放不下时截断并加省略号。 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight: number,
  minSize = size * 0.55,
): { text: string; size: number } {
  let current = size
  ctx.font = font(weight, current)
  while (ctx.measureText(text).width > maxWidth && current > minSize) {
    current -= 2
    ctx.font = font(weight, current)
  }
  if (ctx.measureText(text).width <= maxWidth) return { text, size: current }
  const chars = Array.from(text)
  while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop()
  return { text: `${chars.join('')}…`, size: current }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.replace('#', ''), 16)
  const channel = (shift: number) => {
    const c = (value >> shift) & 255
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount
    return Math.round(Math.max(0, Math.min(255, next)))
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/** 白色圆角底板上的 Logo；没有 Logo 时画品牌色缩写。 */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  shop: Pick<LabShop, 'color' | 'monogram'>,
  logo: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = size * 0.08
  ctx.shadowOffsetY = size * 0.03
  ctx.fillStyle = '#fbfaf6'
  roundRect(ctx, x, y, size, size, size * 0.24)
  ctx.fill()
  ctx.restore()
  if (logo) {
    const inset = size * 0.16
    ctx.drawImage(logo, x + inset, y + inset, size - inset * 2, size - inset * 2)
    return
  }
  ctx.fillStyle = shop.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const mono = fitText(ctx, shop.monogram, size * 0.7, size * 0.56, 800)
  ctx.font = font(800, mono.size)
  ctx.fillText(mono.text, x + size / 2, y + size / 2 + size * 0.03)
}

export interface SignSize {
  width: number
  height: number
}

/** 门头招牌底色：多数用品牌色，个别品牌用黑白底更像本来的样子。 */
export function signColor(style: LabStyle): string {
  return style.sign ?? style.accent
}

/** 门头招牌：左侧 Logo，右侧厂商名称。不写排名，也不写模型名。 */
export function createSignTexture(
  shop: Pick<LabShop, 'name' | 'color' | 'monogram'>,
  style: LabStyle,
  logo: HTMLImageElement | null,
  size: SignSize,
  anisotropy: number,
): CanvasTexture {
  const width = 1600
  const height = Math.round((width * size.height) / size.width)
  const { canvas, ctx } = createCanvas(width, height)
  const base = signColor(style)
  const ink = readableTextOn(base)

  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, shade(base, 0.1))
  gradient.addColorStop(1, shade(base, -0.14))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = ink === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(20,20,20,0.22)'
  ctx.lineWidth = 6
  roundRect(ctx, 14, 14, width - 28, height - 28, 18)
  ctx.stroke()

  const badge = height * 0.68
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const name = fitText(ctx, shop.name, width - badge - 180, height * 0.5, 800)
  ctx.font = font(800, name.size)
  const textW = ctx.measureText(name.text).width
  // Logo 与店名作为一个整体居中
  const gap = height * 0.18
  const startX = (width - badge - gap - textW) / 2
  drawBadge(ctx, shop, logo, startX, (height - badge) / 2, badge)
  ctx.fillStyle = ink
  ctx.fillText(name.text, startX + badge + gap, height / 2 + height * 0.03)
  return toTexture(canvas, anisotropy)
}

/** 门右侧墙上的挂牌：铜框珐琅牌，Logo、厂商名与本周用量。 */
export function createPlaqueTexture(
  shop: Pick<LabShop, 'name' | 'color' | 'monogram' | 'weekTokens'>,
  style: LabStyle,
  logo: HTMLImageElement | null,
  anisotropy: number,
): CanvasTexture {
  const width = 320
  const height = 432
  const { canvas, ctx } = createCanvas(width, height)
  const brass = ctx.createLinearGradient(0, 0, width, height)
  brass.addColorStop(0, '#e2c27a')
  brass.addColorStop(0.5, '#b88d3e')
  brass.addColorStop(1, '#8a6528')
  ctx.fillStyle = brass
  ctx.fillRect(0, 0, width, height)

  const pad = 18
  ctx.fillStyle = '#f7f3ea'
  roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 16)
  ctx.fill()
  ctx.fillStyle = style.accent
  ctx.fillRect(pad, pad + 12, width - pad * 2, 10)
  ctx.fillRect(pad, height - pad - 22, width - pad * 2, 10)

  const badge = 150
  drawBadge(ctx, shop, logo, (width - badge) / 2, 58, badge)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#1d1b18'
  const name = fitText(ctx, shop.name, width - 76, 46, 800, 24)
  ctx.font = font(800, name.size)
  ctx.fillText(name.text, width / 2, 272)
  ctx.fillStyle = 'rgba(29,27,24,0.55)'
  ctx.font = font(600, 22)
  ctx.fillText('TOKEN 商店', width / 2, 306)
  ctx.strokeStyle = 'rgba(29,27,24,0.25)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(70, 326)
  ctx.lineTo(width - 70, 326)
  ctx.stroke()
  ctx.fillStyle = '#1d1b18'
  const tokens = fitText(ctx, `本周 ${formatTokens(shop.weekTokens)}`, width - 76, 30, 700, 18)
  ctx.font = font(700, tokens.size)
  ctx.fillText(tokens.text, width / 2, 368)

  // 四角铆钉
  ctx.fillStyle = '#6d5020'
  for (const [cx, cy] of [
    [9, 9],
    [width - 9, 9],
    [9, height - 9],
    [width - 9, height - 9],
  ]) {
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  return toTexture(canvas, anisotropy)
}

const SPRAY = ['#ff4d8d', '#ffd23f', '#3bceac', '#5b8cff', '#ff7a3d', '#a06bff', '#7cf05a', '#00c2ff']
const TAGS = ['TOKEN', 'TKN', '24/7', 'PROMPT', 'CTX', 'LLM', 'GPU', '∞', 'HELLO', 'BEEP', 'AI!', '1M CTX']

function sprayDots(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, radius: number, color: string, count: number) {
  ctx.fillStyle = color
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2
    const r = radius * Math.sqrt(rng())
    ctx.globalAlpha = range(rng, 0.15, 0.6)
    ctx.beginPath()
    ctx.arc(x + Math.cos(angle) * r, y + Math.sin(angle) * r, range(rng, 0.8, 2.6), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rotation: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = rotation + (i * Math.PI) / 5
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  ctx.closePath()
}

function crown(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(x - s, y + s * 0.5)
  ctx.lineTo(x - s, y - s * 0.4)
  ctx.lineTo(x - s * 0.5, y + s * 0.05)
  ctx.lineTo(x, y - s * 0.6)
  ctx.lineTo(x + s * 0.5, y + s * 0.05)
  ctx.lineTo(x + s, y - s * 0.4)
  ctx.lineTo(x + s, y + s * 0.5)
  ctx.closePath()
}

/**
 * 背墙涂鸦：砖墙底上喷一组气泡字（厂商名），配描边、立体阴影、流挂、签名和小图案。
 * 每家店按 id 生成固定的一幅，宽高按墙面尺寸（米）等比例。
 */
export function createGraffitiTexture(
  shop: Pick<LabShop, 'id' | 'name'>,
  style: LabStyle,
  wall: SignSize,
  anisotropy: number,
): CanvasTexture {
  const rng = createRng(`graffiti:${shop.id}`)
  const width = 1024
  const height = Math.round((width * wall.height) / wall.width)
  const { canvas, ctx } = createCanvas(width, height)

  // 砖墙底
  ctx.fillStyle = shade(style.wall, -0.06)
  ctx.fillRect(0, 0, width, height)
  const brickH = 22
  const brickW = 64
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 2
  for (let row = 0; row * brickH < height; row += 1) {
    const y = row * brickH
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    for (let x = (row % 2) * (brickW / 2); x < width; x += brickW) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + brickH)
      ctx.stroke()
    }
  }
  // 墙根的脏污
  const grime = ctx.createLinearGradient(0, height * 0.7, 0, height)
  grime.addColorStop(0, 'rgba(40,30,20,0)')
  grime.addColorStop(1, 'rgba(40,30,20,0.28)')
  ctx.fillStyle = grime
  ctx.fillRect(0, 0, width, height)

  const pop = pick(rng, SPRAY.filter((c) => c !== style.accent))
  const pop2 = pick(rng, SPRAY)

  // 背景色块
  for (let i = 0; i < 4; i += 1) {
    const x = range(rng, 0.1, 0.9) * width
    const y = range(rng, 0.2, 0.8) * height
    const r = range(rng, 0.18, 0.32) * height
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    const color = i % 2 === 0 ? style.accent : pick(rng, SPRAY)
    blob.addColorStop(0, `${color}aa`)
    blob.addColorStop(1, `${color}00`)
    ctx.fillStyle = blob
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // 主体气泡字
  const chars = Array.from(shop.name.toUpperCase())
  const maxW = width * 0.84
  let size = height * 0.5
  ctx.font = font(900, size)
  const measure = () => chars.reduce((sum, c) => sum + ctx.measureText(c).width * 0.92, 0)
  while (measure() > maxW && size > 40) {
    size -= 4
    ctx.font = font(900, size)
  }
  const total = measure()
  let x = (width - total) / 2
  const baseY = height * 0.58
  const letters = chars.map((char) => {
    const w = ctx.measureText(char).width * 0.92
    const letter = { char, x: x + w / 2, y: baseY + range(rng, -0.05, 0.05) * size, rot: range(rng, -0.14, 0.14), w }
    x += w
    return letter
  })
  const fill = ctx.createLinearGradient(0, baseY - size * 0.7, 0, baseY + size * 0.2)
  fill.addColorStop(0, pop)
  fill.addColorStop(0.55, style.accent)
  fill.addColorStop(1, shade(style.accent, -0.35))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const each = (draw: (letter: (typeof letters)[number]) => void) => {
    for (const letter of letters) {
      ctx.save()
      ctx.translate(letter.x, letter.y)
      ctx.rotate(letter.rot)
      ctx.transform(1, 0, -0.18, 1, 0, 0)
      draw(letter)
      ctx.restore()
    }
  }
  // 立体阴影
  each((letter) => {
    ctx.fillStyle = '#1a1420'
    for (let k = 10; k > 0; k -= 2) ctx.fillText(letter.char, k, k)
  })
  // 外圈描边
  each((letter) => {
    ctx.strokeStyle = '#fbfaf5'
    ctx.lineWidth = size * 0.2
    ctx.strokeText(letter.char, 0, 0)
  })
  each((letter) => {
    ctx.strokeStyle = '#141018'
    ctx.lineWidth = size * 0.1
    ctx.strokeText(letter.char, 0, 0)
    ctx.fillStyle = fill
    ctx.fillText(letter.char, 0, 0)
  })
  // 高光
  each(() => {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(-size * 0.12, -size * 0.52, size * 0.05, size * 0.02, -0.5, 0, Math.PI * 2)
    ctx.fill()
  })
  // 流挂
  ctx.fillStyle = shade(style.accent, -0.2)
  for (const letter of letters) {
    if (rng() < 0.45) continue
    const dx = letter.x + range(rng, -0.25, 0.25) * letter.w
    const length = range(rng, 0.08, 0.3) * height
    const top = baseY - size * 0.05
    ctx.fillRect(dx - 3, top, 6, length)
    ctx.beginPath()
    ctx.arc(dx, top + length, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // 小图案：星星、皇冠、箭头
  const doodles = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < doodles; i += 1) {
    const dx = range(rng, 0.05, 0.95) * width
    const dy = rng() < 0.5 ? range(rng, 0.08, 0.22) * height : range(rng, 0.82, 0.94) * height
    const s = range(rng, 18, 34)
    const color = pick(rng, SPRAY)
    ctx.lineWidth = 5
    ctx.strokeStyle = '#141018'
    ctx.fillStyle = color
    const kind = Math.floor(rng() * 3)
    if (kind === 0) star(ctx, dx, dy, s, rng() * Math.PI)
    else if (kind === 1) crown(ctx, dx, dy, s)
    else {
      ctx.beginPath()
      ctx.moveTo(dx - s * 1.4, dy)
      ctx.lineTo(dx + s * 0.6, dy)
      ctx.lineTo(dx + s * 0.6, dy - s * 0.6)
      ctx.lineTo(dx + s * 1.5, dy + s * 0.2)
      ctx.lineTo(dx + s * 0.6, dy + s)
      ctx.lineTo(dx + s * 0.6, dy + s * 0.4)
      ctx.lineTo(dx - s * 1.4, dy + s * 0.4)
      ctx.closePath()
    }
    ctx.fill()
    ctx.stroke()
    sprayDots(ctx, rng, dx, dy, s * 1.6, color, 40)
  }

  // 马克笔签名
  const tags = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < tags; i += 1) {
    ctx.save()
    ctx.translate(range(rng, 0.08, 0.92) * width, rng() < 0.5 ? range(rng, 0.12, 0.2) * height : range(rng, 0.86, 0.95) * height)
    ctx.rotate(range(rng, -0.25, 0.1))
    ctx.transform(1, 0, -0.35, 1, 0, 0)
    ctx.font = `italic ${font(800, range(rng, 26, 40))}`
    ctx.fillStyle = i === 0 ? pop2 : '#141018'
    ctx.fillText(pick(rng, TAGS), 0, 0)
    ctx.restore()
  }
  sprayDots(ctx, rng, width / 2, baseY - size * 0.3, width * 0.45, pop, 160)
  return toTexture(canvas, anisotropy)
}

/**
 * 厂商 Logo：来自 @lobehub/icons-static-svg（MIT 许可）的矢量图标；它只有小米 MiMo 的文字标，
 * 小米改用 Simple Icons（CC0）的公司图标，单独放在 src/assets/logos/。
 * 商标归各自所有者，这里只用于在小镇里标识对应厂商的店铺。
 *
 * 统一处理成 256×256 的 SVG data URL：去掉注释、<title> 与内联样式，单色图标的 currentColor 和白色填充换成墨色，
 * 这样在 <img> 与 Canvas 贴图里都能直接使用，也不会和页面里的渐变 id 冲突。
 */
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?raw'
import baidu from '@lobehub/icons-static-svg/icons/wenxin-color.svg?raw'
import bytedance from '@lobehub/icons-static-svg/icons/doubao-color.svg?raw'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw'
import google from '@lobehub/icons-static-svg/icons/google-color.svg?raw'
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?raw'
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?raw'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw'
import moonshot from '@lobehub/icons-static-svg/icons/kimi-color.svg?raw'
import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw'
import tencent from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?raw'
import xai from '@lobehub/icons-static-svg/icons/xai.svg?raw'
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw'
import xiaomi from '@/assets/logos/xiaomi.svg?raw'

export const LOGO_INK = '#141413'
export const LOGO_SOURCE = '@lobehub/icons（MIT）与 Simple Icons（CC0）'

const RAW_LOGOS: Record<string, string> = {
  openai,
  anthropic,
  google,
  deepseek,
  qwen,
  moonshot,
  zhipu,
  minimax,
  bytedance,
  xai,
  tencent,
  xiaomi,
  mistral,
  meta,
  baidu,
}

export function normalizeLogoSvg(raw: string, ink = LOGO_INK): string {
  return raw
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/\sstyle="[^"]*"/g, '')
    .replace(/\swidth="[^"]*"/, ' width="256"')
    .replace(/\sheight="[^"]*"/, ' height="256"')
    .replace(/currentColor/g, ink)
    // Logo 都画在浅色底板上，原本为深色背景准备的白色部分（如 Kimi 的 K）会看不见
    .replace(/fill="(?:#fff|#ffffff|white)"/gi, `fill="${ink}"`)
}

const urls = new Map<string, string>()

/** 返回厂商 Logo 的 data URL；表外厂商或“其他厂商”没有 Logo，返回 null。 */
export function labLogoUrl(id: string): string | null {
  const raw = RAW_LOGOS[id]
  if (!raw) return null
  let url = urls.get(id)
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizeLogoSvg(raw))}`
    urls.set(id, url)
  }
  return url
}

export function hasLabLogo(id: string): boolean {
  return id in RAW_LOGOS
}

const images = new Map<string, Promise<HTMLImageElement | null>>()

/** 解码 Logo 图片供 Canvas 贴图使用；失败时返回 null，由调用方回退到文字徽标。 */
export function loadLabLogo(id: string): Promise<HTMLImageElement | null> {
  const url = labLogoUrl(id)
  if (!url || typeof Image === 'undefined') return Promise.resolve(null)
  let pending = images.get(id)
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = url
    })
    images.set(id, pending)
  }
  return pending
}

const loaded = new Map<string, HTMLImageElement>()

/** 预先解码一批 Logo；之后可用 getLoadedLogo 同步取用。 */
export async function preloadLabLogos(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      const image = await loadLabLogo(id)
      if (image) loaded.set(id, image)
    }),
  )
}

export function getLoadedLogo(id: string): HTMLImageElement | null {
  return loaded.get(id) ?? null
}

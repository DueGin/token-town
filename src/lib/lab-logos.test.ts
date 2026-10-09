import { hasLabLogo, labLogoUrl, normalizeLogoSvg } from '@/lib/lab-logos'
import { KNOWN_LABS } from '@/lib/labs'

describe('lab-logos', () => {
  it('厂商表里的每家都有 Logo，表外厂商和其他厂商没有', () => {
    for (const lab of KNOWN_LABS) expect(hasLabLogo(lab.id)).toBe(true)
    expect(labLogoUrl('other')).toBeNull()
    expect(labLogoUrl('acme-labs')).toBeNull()
  })

  it('生成可直接用于 img 的 SVG data URL', () => {
    const url = labLogoUrl('openai')
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    const svg = decodeURIComponent(url!.split(',')[1])
    expect(svg).toContain('width="256"')
    expect(svg).not.toContain('currentColor')
    expect(svg).not.toContain('<title>')
    expect(labLogoUrl('openai')).toBe(url)
  })

  it('规范化单色图标：去掉注释、标题与样式，替换 currentColor', () => {
    const svg = normalizeLogoSvg('<!-- 来源 -->\n<svg fill="currentColor" height="1em" style="flex:none" width="1em"><title>X</title><path/></svg>', '#000')
    expect(svg).toBe('<svg fill="#000" height="256" width="256"><path/></svg>')
  })

  it('白色填充换成墨色，避免在浅色底板上消失', () => {
    expect(normalizeLogoSvg('<svg><path fill="#FFF"/><path fill="white"/><path fill="#1783FF"/></svg>', '#000')).toBe(
      '<svg><path fill="#000"/><path fill="#000"/><path fill="#1783FF"/></svg>',
    )
  })

  it('Kimi 的 K 是墨色、保留蓝点；小米是橙色的公司图标而不是 MiMo 文字标', () => {
    const svgOf = (id: string) => decodeURIComponent(labLogoUrl(id)!.split(',')[1])
    const kimi = svgOf('moonshot')
    expect(kimi).not.toMatch(/fill="#fff"/i)
    expect(kimi).toContain('fill="#141413"')
    expect(kimi).toContain('#1783FF')
    const xiaomi = svgOf('xiaomi')
    expect(xiaomi).toMatch(/^<svg fill="#FF6900" height="256" viewBox="0 0 24 24" width="256"/)
    expect(xiaomi).not.toContain('<!--')
    expect(xiaomi).not.toContain('MiMo')
  })
})

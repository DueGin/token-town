import { readableTextOn } from '@/lib/format'
import { labLogoUrl } from '@/lib/lab-logos'
import type { LabIdentity } from '@/lib/labs'
import { cn } from '@/lib/utils'

interface LabMarkProps {
  lab: Pick<LabIdentity, 'id' | 'name' | 'color' | 'monogram'>
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'size-5 rounded text-[10px]',
  md: 'size-8 rounded-md text-sm',
  lg: 'size-11 rounded-lg text-lg',
} as const

const LOGO_INSET = { sm: 'p-0.5', md: 'p-1.5', lg: 'p-2' } as const

/**
 * 厂商徽标：有 Logo 的厂商显示浅色底板上的 Logo（与店招一致，商标归各自所有者），
 * 其他厂商显示厂商色底的字母缩写。
 */
export function LabMark({ lab, size = 'md', className }: LabMarkProps) {
  const logo = labLogoUrl(lab.id)
  const base = cn('inline-flex shrink-0 items-center justify-center shadow-sm ring-1 ring-inset ring-foreground/10', SIZES[size], className)
  if (logo) {
    return (
      <span aria-hidden="true" className={cn(base, LOGO_INSET[size], 'bg-[#fbfaf6]')}>
        <img src={logo} alt="" className="size-full object-contain" draggable={false} />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(base, 'font-semibold leading-none')}
      style={{ backgroundColor: lab.color, color: readableTextOn(lab.color) }}
    >
      {lab.monogram}
    </span>
  )
}

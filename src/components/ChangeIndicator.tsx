import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { formatChange } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChangeIndicatorProps {
  change: number | null
  /** 是否在数字后显示“较上周”。 */
  withLabel?: boolean
  className?: string
}

/** 较上周变化：图标 + 有符号百分比 + 文字，涨跌不单靠颜色区分。 */
export function ChangeIndicator({ change, withLabel = false, className }: ChangeIndicatorProps) {
  if (change === null) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}>
        <Minus aria-hidden="true" className="size-3.5" />
        {withLabel ? '暂无上周数据' : '—'}
        {!withLabel && <span className="sr-only">暂无上周数据</span>}
      </span>
    )
  }
  const text = formatChange(change)
  const flat = text === '0%'
  const Icon = flat ? Minus : change > 0 ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1',
        flat ? 'text-muted-foreground' : change > 0 ? 'text-rise' : 'text-fall',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span>{text}</span>
      {withLabel ? <span className="text-muted-foreground">较上周</span> : <span className="sr-only">较上周</span>}
    </span>
  )
}

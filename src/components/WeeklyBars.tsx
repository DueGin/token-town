import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatShortDay, formatTokens, formatWeekRange } from '@/lib/format'
import type { WeekPoint } from '@/lib/town-data'
import { cn } from '@/lib/utils'

interface WeeklyBarsProps {
  history: WeekPoint[]
  /** 本周柱使用厂商色，往期柱弱化为中性色。 */
  color: string
  className?: string
}

/** 近几周用量柱状图：单一序列，标题即图例；每根柱子有悬停提示，并附带读屏用的等价表格。 */
export function WeeklyBars({ history, color, className }: WeeklyBarsProps) {
  const max = Math.max(1, ...history.map((point) => point.tokens))
  const last = history.length - 1
  return (
    <figure className={cn('space-y-1.5', className)}>
      <figcaption className="text-xs text-muted-foreground">近 {history.length} 周 token 用量</figcaption>
      <div aria-hidden="true" className="flex h-16 items-end gap-0.5 border-b border-border">
        {history.map((point, index) => {
          const current = index === last
          const ratio = point.tokens / max
          return (
            <Tooltip key={point.week}>
              <TooltipTrigger asChild>
                {/* 命中区域占满整列，比柱子本身更容易悬停 */}
                <div className="flex h-full flex-1 cursor-default items-end justify-center" data-testid="weekly-bar">
                  <div
                    className={cn('w-3/5 rounded-t-[4px]', current ? '' : 'bg-muted-foreground/35')}
                    style={{
                      height: point.tokens > 0 ? `max(2px, ${(ratio * 100).toFixed(2)}%)` : 0,
                      backgroundColor: current ? color : undefined,
                    }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-center">
                <p className="text-background/70">{current ? '本周' : formatWeekRange(point.week)}</p>
                <p className="tabular font-medium">{formatTokens(point.tokens)} token</p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <div aria-hidden="true" className="flex gap-0.5">
        {history.map((point, index) => (
          <span
            key={point.week}
            className={cn(
              'tabular flex-1 text-center text-[10px] leading-none',
              index === last ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {index === last ? '本周' : formatShortDay(point.week)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>近 {history.length} 周 token 用量</caption>
        <thead>
          <tr>
            <th scope="col">周</th>
            <th scope="col">token</th>
          </tr>
        </thead>
        <tbody>
          {history.map((point) => (
            <tr key={point.week}>
              <th scope="row">{formatWeekRange(point.week)}</th>
              <td>{formatTokens(point.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

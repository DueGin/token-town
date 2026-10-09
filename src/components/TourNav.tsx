import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatWeekRange } from '@/lib/format'
import type { DataSourceInfo } from '@/lib/use-town-data'
import { cn } from '@/lib/utils'

interface TourNavProps {
  week: string
  weeks: string[]
  onWeekChange: (week: string) => void
  source: DataSourceInfo
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  className?: string
}

/** 右上角：周选择、数据来源标记和上一家 / 下一家巡店。 */
function formatUpdated(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString('zh-CN', sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 数据来源标记的文字：窄屏短标签、完整标签和说明。 */
function describeSource(source: DataSourceInfo): { short: string; full: string; tip: string } {
  const updated = formatUpdated(source.updatedAt)
  switch (source.kind) {
    case 'sub2api':
      return {
        short: '实时',
        full: source.label,
        tip: source.stale
          ? `最近一次读取 Sub2API 失败，正在展示 ${updated || '之前'}的数据，恢复后会自动更新。`
          : `来自 Sub2API 的实时用量${updated ? `，更新于 ${updated}` : ''}，页面会定时自动刷新。`,
      }
    case 'file':
      return { short: '上传数据', full: source.label, tip: `管理员在控制后台上传的数据${updated ? `，上传于 ${updated}` : ''}。` }
    case 'fallback':
      return { short: '虚构示例', full: source.label, tip: '暂时连不上小镇服务，先展示虚构的示例数据；恢复连接后会自动换成后台配置的数据。' }
    default:
      return { short: '虚构示例', full: source.label, tip: '厂商名称真实，模型、价格、用量与访客全部为虚构，仅用于演示。管理员可以在控制后台换成真实数据源。' }
  }
}

export function TourNav({ week, weeks, onWeekChange, source, index, count, onPrev, onNext, className }: TourNavProps) {
  const text = describeSource(source)
  const fictional = source.kind === 'sample' || source.kind === 'fallback'
  const latest = weeks[weeks.length - 1]
  const ordered = [...weeks].reverse()
  const canTour = count > 1
  return (
    <div className={cn('town-panel flex items-center gap-1.5 p-1.5', className)}>
      {weeks.length > 0 && (
        <Select value={week} onValueChange={onWeekChange}>
          <SelectTrigger
            className="tabular h-8 w-auto min-w-0 flex-1 gap-1 border-transparent bg-transparent px-2 shadow-none max-md:[&_[data-latest]]:hidden md:flex-none md:gap-2 md:px-3"
            aria-label="选择数据周"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ordered.map((item) => (
              <SelectItem key={item} value={item} className="tabular">
                {formatWeekRange(item)}
                {item === latest && (
                  <span data-latest="" className="ml-1.5 text-muted-foreground">
                    最新
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {source.label && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              tabIndex={0}
              variant={fictional ? 'secondary' : 'outline'}
              aria-label={`${text.full}${source.stale ? '，数据可能已过期' : ''}`}
              className="max-w-24 shrink-0 cursor-default gap-1.5 md:max-w-44"
            >
              {source.kind === 'sub2api' &&
                (source.stale ? (
                  <TriangleAlert aria-hidden="true" className="size-3 shrink-0 text-primary" />
                ) : (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
                ))}
              {/* 窄屏把周范围留给周选择，标记缩短 */}
              <span className="truncate md:hidden">{text.short}</span>
              <span className="hidden truncate md:inline">{text.full}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{text.tip}</TooltipContent>
        </Tooltip>
      )}

      <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border md:mx-0.5 md:block" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onPrev} disabled={!canTour} aria-label="上一家">
            <ChevronLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>上一家（←）</TooltipContent>
      </Tooltip>
      <span className="tabular min-w-12 shrink-0 text-center text-sm font-medium">
        <span aria-hidden="true">
          {count ? index + 1 : 0}
          <span className="text-muted-foreground"> / {count}</span>
        </span>
        <span className="sr-only">{`第 ${count ? index + 1 : 0} 家，共 ${count} 家`}</span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onNext} disabled={!canTour} aria-label="下一家">
            <ChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>下一家（→）</TooltipContent>
      </Tooltip>
    </div>
  )
}

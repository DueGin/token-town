import { Store } from 'lucide-react'
import { LabMark } from '@/components/LabMark'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatTokens, formatWeekRange } from '@/lib/format'
import type { TownSnapshot } from '@/lib/town-data'
import { cn } from '@/lib/utils'

interface TownHeaderProps {
  snapshot: TownSnapshot
  activeId: string | null
  onSelect: (id: string) => void
  compact: boolean
  className?: string
}

/** 左上角：小镇标题、本周概况和厂商切换（桌面用标签组，窄屏用下拉）。 */
export function TownHeader({ snapshot, activeId, onSelect, compact, className }: TownHeaderProps) {
  const { shops } = snapshot
  const summary = snapshot.week
    ? `${formatWeekRange(snapshot.week)} · ${shops.length} 家店 · 合计 ${formatTokens(snapshot.totalTokens)} token`
    : '暂无数据'
  return (
    <div className={cn('town-panel p-3 md:p-4', className)}>
      <div className="flex items-center gap-2">
        <Store aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <h1 className="text-base font-semibold tracking-tight md:text-lg">Token 商店小镇</h1>
      </div>
      <p className="tabular mt-1 text-xs text-muted-foreground">{summary}</p>

      {shops.length > 0 &&
        (compact ? (
          <Select value={activeId ?? undefined} onValueChange={onSelect}>
            <SelectTrigger className="mt-3 h-9" aria-label="选择厂商">
              <SelectValue placeholder="选择厂商" />
            </SelectTrigger>
            <SelectContent>
              {shops.map((shop) => (
                <SelectItem key={shop.id} value={shop.id}>
                  <span className="flex items-center gap-2">
                    <LabMark lab={shop} size="sm" />
                    {shop.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <ToggleGroup
            type="single"
            value={activeId ?? ''}
            onValueChange={(value) => value && onSelect(value)}
            aria-label="选择厂商"
            className="mt-3 flex-wrap justify-start gap-1.5"
          >
            {shops.map((shop) => (
              <ToggleGroupItem
                key={shop.id}
                value={shop.id}
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs shadow-none data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
              >
                <span aria-hidden="true" className="size-2 rounded-full ring-1 ring-foreground/25" style={{ backgroundColor: shop.color }} />
                {shop.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ))}
    </div>
  )
}

import { DoorOpen } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DOOR_SPEEDS, type DoorSpeed } from '@/lib/door-speed'
import { cn } from '@/lib/utils'

interface DoorSpeedControlProps {
  speed: DoorSpeed
  onChange: (speed: DoorSpeed) => void
  /** 系统开启“减少动态效果”时行人不走动，设置在关闭后才看得到。 */
  paused: boolean
  disabled?: boolean
  vertical: boolean
  side: 'left' | 'top'
}

/** 工具栏里的进出速度：调快或调慢顾客排队、进门、店内停留和出门的节奏。 */
export function DoorSpeedControl({ speed, onChange, paused, disabled, vertical, side }: DoorSpeedControlProps) {
  const titleId = useId()
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              disabled={disabled}
              aria-label={`进出速度 ${speed} 倍`}
              className={cn('gap-1 font-normal', vertical ? 'h-auto w-9 flex-col px-0 py-1.5' : 'h-9 px-2')}
            >
              <DoorOpen />
              <span className={cn('tabular leading-none text-muted-foreground', vertical ? 'text-[10px]' : 'text-xs')}>{speed}×</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>进出速度</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="center" sideOffset={8} className="w-[17rem] space-y-3">
        <div className="space-y-1">
          <p id={titleId} className="text-sm font-medium">
            进出速度
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">排队前移、进门、店内停留和出门一起加快；路上的行人和车流保持原速。</p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={speed}
          onValueChange={(value) => {
            // 单选组再次点击已选项会传空串，保持原选择
            if (value) onChange(value as DoorSpeed)
          }}
          aria-labelledby={titleId}
          className="grid grid-cols-4"
        >
          {DOOR_SPEEDS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={value === '1' ? '1 倍（原速）' : `${value} 倍`}
              className="tabular w-full data-[state=on]:border-primary/50 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              {value}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {paused ? '系统开启了“减少动态效果”，行人暂停走动，关闭后按这里的速度进出。' : '1× 为原始节奏，默认 3×。'}
        </p>
      </PopoverContent>
    </Popover>
  )
}

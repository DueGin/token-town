import { Moon, Sun, Sunrise, Sunset, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  COMMON_TIME_ZONES,
  dayPeriod,
  formatClock,
  periodLabel,
  SYSTEM_TIME_ZONE,
  systemTimeZone,
  timeZoneOffsetLabel,
  type ClockMode,
  type ClockSettings,
  type DayPeriod,
} from '@/lib/time-of-day'
import { cn } from '@/lib/utils'

interface TimeControlProps {
  settings: ClockSettings
  hours: number
  /** 实时模式下实际使用的 IANA 时区。 */
  zone: string
  onChange: (patch: Partial<ClockSettings>) => void
  vertical: boolean
  side: 'left' | 'top'
}

const PERIOD_ICONS: Record<DayPeriod, LucideIcon> = {
  'late-night': Moon,
  dawn: Sunrise,
  morning: Sun,
  noon: Sun,
  afternoon: Sun,
  dusk: Sunset,
  evening: Moon,
}

const PRESETS: { label: string; hours: number }[] = [
  { label: '清晨', hours: 6.25 },
  { label: '正午', hours: 12 },
  { label: '黄昏', hours: 18 },
  { label: '深夜', hours: 22.5 },
]

const TICKS = ['00:00', '06:00', '12:00', '18:00', '24:00']
const SLIDER_MAX = 23.75

/** 下拉里的短标签：“上海 · GMT+8”；表外时区直接用 IANA 名称。 */
function zoneLabel(zone: string): string {
  const offset = timeZoneOffsetLabel(zone)
  const name = COMMON_TIME_ZONES.find((item) => item.zone === zone)?.label ?? zone
  return offset ? `${name} · ${offset}` : name
}

/** 说明文字里的完整标签：“上海（Asia/Shanghai，GMT+8）”。 */
function zoneDescription(zone: string): string {
  const offset = timeZoneOffsetLabel(zone)
  const known = COMMON_TIME_ZONES.find((item) => item.zone === zone)
  const detail = [known ? zone : '', offset].filter(Boolean).join('，')
  const name = known?.label ?? zone
  return detail ? `${name}（${detail}）` : name
}

/** 工具栏里的小镇时钟：默认跟随系统时区的当前时间，也可以手动拖到任意时刻。 */
export function TimeControl({ settings, hours, zone, onChange, vertical, side }: TimeControlProps) {
  const zoneLabelId = useId()
  const clock = formatClock(hours)
  const period = periodLabel(hours)
  const Icon = PERIOD_ICONS[dayPeriod(hours)]
  const live = settings.mode === 'live'
  const system = systemTimeZone()
  // 选中的时区不在常用列表里时也要能显示出来
  const zones = COMMON_TIME_ZONES.some((item) => item.zone === settings.timeZone) || settings.timeZone === SYSTEM_TIME_ZONE
    ? COMMON_TIME_ZONES
    : [{ zone: settings.timeZone, label: settings.timeZone }, ...COMMON_TIME_ZONES]

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              aria-label={`小镇时间 ${clock}，${period}${live ? '，跟随实时' : '，手动调节'}`}
              className={cn('gap-1 font-normal', vertical ? 'h-auto w-9 flex-col px-0 py-1.5' : 'h-9 px-2')}
            >
              <Icon />
              <span className={cn('tabular leading-none text-muted-foreground', vertical ? 'text-[10px]' : 'text-xs')}>{clock}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>小镇时间</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="center" sideOffset={8} className="w-[19rem] space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">小镇时间</p>
            <p className="tabular text-3xl font-semibold leading-tight tracking-tight">{clock}</p>
          </div>
          <Badge variant="secondary" className="mb-1 gap-1">
            <Icon aria-hidden="true" className="size-3.5" />
            {period}
          </Badge>
        </div>

        <ToggleGroup
          type="single"
          variant="outline"
          value={settings.mode}
          onValueChange={(value) => {
            // 单选组再次点击已选项会传空串，保持原选择
            if (value) onChange({ mode: value as ClockMode, ...(value === 'manual' && live ? { manualHours: hours } : {}) })
          }}
          aria-label="时间来源"
          className="grid grid-cols-2"
        >
          <ToggleGroupItem value="live" className="w-full data-[state=on]:border-primary/50 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
            跟随实时
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="w-full data-[state=on]:border-primary/50 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
            手动调节
          </ToggleGroupItem>
        </ToggleGroup>

        {live ? (
          <div className="space-y-2">
            <p id={zoneLabelId} className="text-xs text-muted-foreground">
              时区
            </p>
            <Select value={settings.timeZone} onValueChange={(value) => onChange({ timeZone: value })}>
              <SelectTrigger aria-labelledby={zoneLabelId} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={SYSTEM_TIME_ZONE}>跟随系统 · {zoneLabel(system)}</SelectItem>
                {zones.map((item) => (
                  <SelectItem key={item.zone} value={item.zone}>
                    {zoneLabel(item.zone)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              按{zoneDescription(zone)}的当前时间显示天色，每 15 秒更新一次。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Slider
                min={0}
                max={SLIDER_MAX}
                step={0.25}
                value={[Math.min(SLIDER_MAX, hours)]}
                onValueChange={([value]) => onChange({ manualHours: value })}
                thumbLabel="小镇时间"
                thumbValueText={`${clock}，${period}`}
              />
              <div aria-hidden="true" className="tabular flex justify-between text-[10px] text-muted-foreground">
                {TICKS.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant={Math.abs(hours - preset.hours) < 0.01 ? 'secondary' : 'outline'}
                  className="h-8 px-0 text-xs"
                  onClick={() => onChange({ manualHours: preset.hours })}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

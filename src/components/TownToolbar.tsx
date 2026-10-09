import { Aperture, Info, LocateFixed, Table2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { DoorSpeedControl } from '@/components/DoorSpeedControl'
import { TimeControl } from '@/components/TimeControl'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DoorSpeed } from '@/lib/door-speed'
import type { TownClock } from '@/lib/use-town-clock'
import { cn } from '@/lib/utils'

interface TownToolbarProps {
  clock: TownClock
  doorSpeed: DoorSpeed
  onDoorSpeedChange: (speed: DoorSpeed) => void
  /** 系统要求减少动态效果，行人暂停走动。 */
  reducedMotion: boolean
  dof: boolean
  onDofChange: (enabled: boolean) => void
  /** 3D 场景不可用时，景深与视角按钮禁用。 */
  sceneAvailable: boolean
  onResetView: () => void
  onOpenTable: () => void
  onOpenAbout: () => void
  /** 桌面竖排贴右侧；窄屏横排放在数据卡上方，避免互相遮挡。 */
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

type TipSide = 'left' | 'top'

function Tip({ label, side, children }: { label: string; side: TipSide; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolButton({
  icon: Icon,
  label,
  side,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  side: TipSide
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tip label={label} side={side}>
      <Button variant="ghost" size="icon" className="size-9" onClick={onClick} disabled={disabled} aria-label={label}>
        <Icon />
      </Button>
    </Tip>
  )
}

/** 工具栏：小镇时间、进出速度、景深、视角复位，以及数据表和说明入口。 */
export function TownToolbar(props: TownToolbarProps) {
  const { clock, dof, onDofChange, sceneAvailable, orientation = 'vertical', className } = props
  const vertical = orientation === 'vertical'
  const side: TipSide = vertical ? 'left' : 'top'
  return (
    <div
      role="group"
      aria-label="小镇工具"
      className={cn('town-panel flex gap-0.5 p-1', vertical ? 'flex-col' : 'flex-row', className)}
    >
      <TimeControl settings={clock.settings} hours={clock.hours} zone={clock.zone} onChange={clock.update} vertical={vertical} side={side} />
      <DoorSpeedControl
        speed={props.doorSpeed}
        onChange={props.onDoorSpeedChange}
        paused={props.reducedMotion}
        disabled={!sceneAvailable}
        vertical={vertical}
        side={side}
      />
      <Tip label={dof ? '景深：已开启' : '景深：已关闭'} side={side}>
        <Toggle
          pressed={dof}
          onPressedChange={onDofChange}
          disabled={!sceneAvailable}
          aria-label="景深"
          className="size-9 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
        >
          <Aperture />
        </Toggle>
      </Tip>
      <ToolButton side={side} icon={LocateFixed} label="重置视角" onClick={props.onResetView} disabled={!sceneAvailable} />
      <span aria-hidden="true" className={cn('shrink-0 bg-border', vertical ? 'mx-auto my-1 h-px w-5' : 'mx-1 my-auto h-5 w-px')} />
      <ToolButton side={side} icon={Table2} label="本周数据" onClick={props.onOpenTable} />
      <ToolButton side={side} icon={Info} label="关于小镇" onClick={props.onOpenAbout} />
    </div>
  )
}

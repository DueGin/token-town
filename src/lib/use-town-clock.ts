import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePreference, useStoredValue } from '@/lib/preferences'
import {
  hoursInTimeZone,
  isValidTimeZone,
  resolveTimeZone,
  SYSTEM_TIME_ZONE,
  wrapHours,
  type ClockMode,
  type ClockSettings,
} from '@/lib/time-of-day'

const CLOCK_MODES: readonly ClockMode[] = ['live', 'manual']
/** 实时模式的刷新间隔；天色变化很慢，15 秒足够平滑。 */
const TICK_MS = 15_000

const parseHours = (raw: string) => {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value < 24 ? value : undefined
}
const parseZone = (raw: string) => (raw === SYSTEM_TIME_ZONE || isValidTimeZone(raw) ? raw : undefined)

export interface TownClock {
  settings: ClockSettings
  /** 当前生效的小镇时间（小时，带小数）。 */
  hours: number
  /** 实时模式下实际使用的 IANA 时区。 */
  zone: string
  update: (patch: Partial<ClockSettings>) => void
}

/** 小镇时钟：默认跟随系统时区的当前时间，也可以切到手动调节，设置保存在本机。 */
export function useTownClock(): TownClock {
  const [mode, setMode] = usePreference<ClockMode>('clock-mode', CLOCK_MODES, 'live')
  const [manualHours, setManualHours] = useStoredValue('clock-hours', parseHours, String, 20)
  const [timeZone, setTimeZone] = useStoredValue('clock-zone', parseZone, String, SYSTEM_TIME_ZONE)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (mode !== 'live') return
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [mode])

  const zone = resolveTimeZone(timeZone)
  const hours = mode === 'live' ? hoursInTimeZone(now, zone) : manualHours

  const update = useCallback(
    (patch: Partial<ClockSettings>) => {
      if (patch.mode) setMode(patch.mode)
      if (patch.manualHours !== undefined) setManualHours(wrapHours(patch.manualHours))
      if (patch.timeZone !== undefined) setTimeZone(parseZone(patch.timeZone) ?? SYSTEM_TIME_ZONE)
    },
    [setMode, setManualHours, setTimeZone],
  )

  const settings = useMemo<ClockSettings>(() => ({ mode, manualHours, timeZone }), [mode, manualHours, timeZone])
  return { settings, hours, zone, update }
}

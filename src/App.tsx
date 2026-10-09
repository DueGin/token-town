import { LoaderCircle, Table2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AboutDialog } from '@/components/AboutDialog'
import { DataSheet } from '@/components/DataSheet'
import { ShopCard } from '@/components/ShopCard'
import { TownCanvas, type SceneStatus, type TownCanvasHandle } from '@/components/TownCanvas'
import { TownHeader } from '@/components/TownHeader'
import { TownToolbar } from '@/components/TownToolbar'
import { TourNav } from '@/components/TourNav'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_DOOR_SPEED, DOOR_SPEEDS } from '@/lib/door-speed'
import { applyFeaturedPins, EMPTY_PINS, parseFeaturedPins, serializeFeaturedPins, setFeaturedPin } from '@/lib/featured-pins'
import { formatTokens } from '@/lib/format'
import { usePreference, useMediaQuery, useReducedMotion, useStoredValue } from '@/lib/preferences'
import { daylightAt, formatClock, periodLabel } from '@/lib/time-of-day'
import { buildSnapshot, type TownDataset } from '@/lib/town-data'
import { useTownClock } from '@/lib/use-town-clock'
import { useTownData } from '@/lib/use-town-data'
import { sceneThemeAt } from '@/scene/scene-theme'

const SWITCHES = ['on', 'off'] as const
/** 首次加载完成前用的空数据集。 */
const EMPTY_DATASET: TownDataset = { source: 'import', label: '', rows: [], models: [] }

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true
  // 下拉列表、滑块和弹层里的方向键属于它们自己
  return Boolean(target.closest('[role="listbox"],[role="menu"],[role="slider"],[role="dialog"],[data-radix-popper-content-wrapper]'))
}

export default function App() {
  // 数据由小镇服务提供（后台配置的数据源），定时轮询；连不上服务时回退示例数据
  const town = useTownData()
  const dataset = town.dataset ?? EMPTY_DATASET
  const [week, setWeek] = useState<string | undefined>(undefined)
  const [focusId, setFocusId] = useState<string | null>(null)
  const clock = useTownClock()
  const [dofPref, setDofPref] = usePreference('dof', SWITCHES, 'on')
  const [doorSpeed, setDoorSpeed] = usePreference('door-speed', DOOR_SPEEDS, DEFAULT_DOOR_SPEED)
  const [pins, setPins] = useStoredValue('featured', parseFeaturedPins, serializeFeaturedPins, EMPTY_PINS)
  const reducedMotion = useReducedMotion()
  const compact = useMediaQuery('(max-width: 767px)')
  // 矮屏手机上数据卡默认收起，否则场景只剩一条缝
  const shortViewport = useMediaQuery('(max-height: 759px)')
  const [scene, setScene] = useState<{ status: SceneStatus; message?: string }>({ status: 'loading' })
  const [tableOpen, setTableOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const canvasRef = useRef<TownCanvasHandle>(null)
  // 覆盖层没有 Radix Trigger，关闭时需要自己把焦点还给打开它的按钮
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const snapshot = useMemo(() => buildSnapshot(dataset, week), [dataset, week])
  // 主推模型只影响数据卡和数据表；场景仍用原快照，改设置不会重建小镇
  const shops = useMemo(() => applyFeaturedPins(snapshot.shops, pins), [snapshot.shops, pins])
  const tableSnapshot = useMemo(() => ({ ...snapshot, shops }), [snapshot, shops])
  // 焦点厂商在新的一周不存在时回到第一家
  const activeIndex = Math.max(0, shops.findIndex((shop) => shop.id === focusId))
  const activeShop = shops[activeIndex] ?? null
  const activeId = activeShop?.id ?? null
  const dof = dofPref === 'on'
  // 界面配色跟着天色走：日照过半用浅色，否则用深色
  const night = daylightAt(clock.hours) < 0.5
  const sceneBackground = sceneThemeAt(clock.hours).background

  useEffect(() => {
    document.documentElement.classList.toggle('dark', night)
  }, [night])

  const step = useCallback(
    (delta: number) => {
      if (!shops.length) return
      setFocusId(shops[(activeIndex + delta + shops.length) % shops.length].id)
    },
    [shops, activeIndex],
  )

  const overlayOpen = tableOpen || aboutOpen
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || overlayOpen || !shops.length) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isEditable(event.target)) return
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'Home') setFocusId(shops[0].id)
      else if (event.key === 'End') setFocusId(shops[shops.length - 1].id)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen, shops, step])

  const onSceneStatus = useCallback((status: SceneStatus, message?: string) => {
    // 出错后不再被后续的“就绪”覆盖
    setScene((current) => (current.status === 'error' ? current : { status, message }))
  }, [])

  const openOverlay = (open: (value: boolean) => void) => {
    const current = document.activeElement
    returnFocusRef.current = current instanceof HTMLElement && current !== document.body ? current : null
    open(true)
  }

  const returnFocus = useCallback((event: Event) => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target?.isConnected) {
      event.preventDefault()
      target.focus()
    }
  }, [])

  const viewShop = (id: string) => {
    setFocusId(id)
    setTableOpen(false)
  }

  // 只在切换店铺时播报；实时数据更新用量不打扰读屏
  const [announcement, setAnnouncement] = useState('')
  const announceRef = useRef(activeShop)
  announceRef.current = activeShop
  useEffect(() => {
    const shop = announceRef.current
    setAnnouncement(shop ? `${shop.name}，本周 ${formatTokens(shop.weekTokens)} token` : '')
  }, [activeId])

  const sceneLabel = activeShop
    ? `Token 商店小镇三维场景，共 ${shops.length} 家店，当前在 ${activeShop.name} 门口，小镇时间 ${formatClock(clock.hours)}（${periodLabel(clock.hours)}）。`
    : 'Token 商店小镇三维场景'
  const sceneFailed = scene.status === 'error'

  const toolbar = (
    <TownToolbar
      clock={clock}
      doorSpeed={doorSpeed}
      onDoorSpeedChange={setDoorSpeed}
      reducedMotion={reducedMotion}
      dof={dof}
      onDofChange={(enabled) => setDofPref(enabled ? 'on' : 'off')}
      sceneAvailable={!sceneFailed}
      onResetView={() => canvasRef.current?.resetView()}
      onOpenTable={() => openOverlay(setTableOpen)}
      onOpenAbout={() => openOverlay(setAboutOpen)}
      orientation={compact ? 'horizontal' : 'vertical'}
      className={compact ? 'pointer-events-auto' : 'absolute right-5 top-1/2 -translate-y-1/2'}
    />
  )

  return (
    <TooltipProvider delayDuration={250}>
      <main className="relative h-full w-full overflow-hidden" style={{ background: sceneBackground }}>
        {!sceneFailed && town.dataset && (
          <TownCanvas
            ref={canvasRef}
            snapshot={snapshot}
            focusId={activeId}
            hours={clock.hours}
            dof={dof}
            doorSpeed={Number(doorSpeed)}
            reducedMotion={reducedMotion}
            compact={compact}
            label={sceneLabel}
            onSelect={setFocusId}
            onStatus={onSceneStatus}
          />
        )}

        {(scene.status === 'loading' || !town.dataset) && !sceneFailed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p role="status" className="town-panel flex items-center gap-2 px-4 py-2.5 text-sm">
              <LoaderCircle aria-hidden="true" className="size-4 text-primary motion-safe:animate-spin" />
              小镇开张中…
            </p>
          </div>
        )}

        {sceneFailed && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Alert className="town-panel max-w-md">
              <TriangleAlert aria-hidden="true" className="size-4" />
              <AlertTitle>3D 小镇暂时无法显示</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{scene.message}</p>
                <p>数据不受影响，可以继续切换厂商，或在数据表中查看完整数据。</p>
                <Button size="sm" variant="outline" onClick={() => openOverlay(setTableOpen)}>
                  <Table2 />
                  查看本周数据
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:p-5">
          <TownHeader
            snapshot={snapshot}
            activeId={activeId}
            onSelect={setFocusId}
            compact={compact}
            className="pointer-events-auto md:max-w-[34rem]"
          />
          <TourNav
            week={snapshot.week}
            weeks={snapshot.weeks}
            onWeekChange={setWeek}
            source={town.info}
            index={activeIndex}
            count={shops.length}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            className="pointer-events-auto md:shrink-0"
          />
        </header>

        {!compact && toolbar}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-end gap-2 p-3 md:right-auto md:p-5">
          {compact && toolbar}
          {activeShop ? (
            <ShopCard
              shop={activeShop}
              collapsible={compact}
              defaultExpanded={!shortViewport}
              onFeaturedChange={(model) => setPins(setFeaturedPin(pins, activeShop.id, model))}
              className="pointer-events-auto w-full md:w-[22.5rem]"
            />
          ) : town.dataset ? (
            <Alert className="town-panel pointer-events-auto w-full md:w-[22.5rem]">
              <TriangleAlert aria-hidden="true" className="size-4" />
              <AlertTitle>这一周没有可展示的用量</AlertTitle>
              <AlertDescription>
                {town.info.kind === 'sub2api'
                  ? 'Sub2API 这一周还没有可统计的用量，或者店铺都设为了隐藏。'
                  : '当前数据里没有大于 0 的 token 用量，或者店铺都设为了隐藏。'}
                管理员可以在控制后台检查数据源和店铺展示设置。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <DataSheet
          open={tableOpen}
          onOpenChange={setTableOpen}
          snapshot={tableSnapshot}
          datasetLabel={dataset.label}
          activeId={activeId}
          onView={viewShop}
          onCloseAutoFocus={returnFocus}
        />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onCloseAutoFocus={returnFocus} />
        <Toaster
          position="top-right"
          theme={night ? 'dark' : 'light'}
          offset={{ top: 76, right: 20 }}
          mobileOffset={{ top: 12, left: 12, right: 12 }}
          closeButton
        />
      </main>
    </TooltipProvider>
  )
}

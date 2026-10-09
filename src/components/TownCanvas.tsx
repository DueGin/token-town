import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { TownSnapshot } from '@/lib/town-data'
import type { TownScene } from '@/scene/town-scene'

export interface TownCanvasHandle {
  resetView(): void
}

export type SceneStatus = 'loading' | 'ready' | 'error'

interface TownCanvasProps {
  snapshot: TownSnapshot
  focusId: string | null
  /** 小镇时间（小时，0–24）。 */
  hours: number
  dof: boolean
  /** 顾客进出店节奏的倍数。 */
  doorSpeed: number
  reducedMotion: boolean
  compact: boolean
  /** 场景的无障碍描述，3D 画面本身对读屏不可见。 */
  label: string
  onSelect: (id: string) => void
  onStatus: (status: SceneStatus, message?: string) => void
}

/**
 * three.js 场景的 React 外壳：按需加载场景模块，把 props 变化转成场景方法调用。
 * 场景模块单独分包，首屏界面不必等待 three.js 下载完成。
 */
export const TownCanvas = forwardRef<TownCanvasHandle, TownCanvasProps>(function TownCanvas(
  { snapshot, focusId, hours, dof, doorSpeed, reducedMotion, compact, label, onSelect, onStatus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<TownScene | null>(null)
  // 场景回调与首次构造只读这里的最新值，避免因为 props 变化重建场景
  const latest = useRef({ focusId, hours, dof, doorSpeed, reducedMotion, compact, onSelect, onStatus })
  latest.current = { focusId, hours, dof, doorSpeed, reducedMotion, compact, onSelect, onStatus }

  useImperativeHandle(ref, () => ({ resetView: () => scene?.resetView() }), [scene])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let instance: TownScene | null = null
    import('@/scene/town-scene')
      .then(({ TownScene }) => {
        if (cancelled) return
        const initial = latest.current
        try {
          instance = new TownScene(container, {
            hours: initial.hours,
            dof: initial.dof,
            doorSpeed: initial.doorSpeed,
            reducedMotion: initial.reducedMotion,
            compact: initial.compact,
            onSelect: (id) => latest.current.onSelect(id),
            onError: (message) => latest.current.onStatus('error', message),
          })
        } catch {
          latest.current.onStatus('error', '当前浏览器无法启用 WebGL，3D 小镇暂时无法显示。')
          return
        }
        setScene(instance)
      })
      .catch(() => {
        if (!cancelled) latest.current.onStatus('error', '场景资源加载失败，请检查网络后刷新页面。')
      })
    return () => {
      cancelled = true
      instance?.dispose()
      setScene(null)
    }
  }, [])

  useEffect(() => {
    if (!scene) return
    let current = true
    // 实时数据通常只改用量：能就地更新就不重建场景
    scene
      .updateSnapshot(snapshot)
      .then(() => {
        if (current) latest.current.onStatus('ready')
      })
      .catch(() => {
        if (current) latest.current.onStatus('error', '小镇搭建失败，请刷新页面重试。')
      })
    return () => {
      current = false
    }
  }, [scene, snapshot])

  useEffect(() => {
    if (scene && focusId) scene.focus(focusId)
  }, [scene, focusId])

  useEffect(() => {
    scene?.setTimeOfDay(hours)
  }, [scene, hours])

  useEffect(() => {
    scene?.setDof(dof)
  }, [scene, dof])

  useEffect(() => {
    scene?.setDoorSpeed(doorSpeed)
  }, [scene, doorSpeed])

  useEffect(() => {
    scene?.setReducedMotion(reducedMotion)
  }, [scene, reducedMotion])

  useEffect(() => {
    scene?.setCompact(compact)
  }, [scene, compact])

  return <div ref={containerRef} role="img" aria-label={label} className="absolute inset-0 overflow-hidden" />
})

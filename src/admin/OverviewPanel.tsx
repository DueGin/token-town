import { ArrowRight, CircleCheck, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { adminApi, type SourceStatus } from '@/admin/api'
import { errorMessage, formatDateTime, isUnauthorized, reportError, SOURCE_NAMES } from '@/admin/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatWeekRange } from '@/lib/format'

interface OverviewPanelProps {
  onUnauthorized: () => void
  onNavigate: (tab: 'shops' | 'source') => void
}

/** 概览：当前数据源、最近一次读取的结果，以及手动刷新。 */
export function OverviewPanel({ onUnauthorized, onNavigate }: OverviewPanelProps) {
  const [status, setStatus] = useState<SourceStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setStatus(await adminApi.status())
    } catch (error) {
      if (isUnauthorized(error)) onUnauthorized()
      else setLoadError(errorMessage(error))
    }
  }, [onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const next = await adminApi.refresh()
      setStatus(next)
      if (next.error) toast.warning('刷新完成，但读取数据失败', { description: next.error.message })
      else toast.success('数据已刷新', { description: `共 ${next.rows.toLocaleString('zh-CN')} 行` })
    } catch (error) {
      reportError(error, '刷新失败', onUnauthorized)
    } finally {
      setRefreshing(false)
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>读取状态失败</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw />
            重试
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!status) {
    return (
      <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        正在读取状态…
      </p>
    )
  }

  const live = status.active === 'sub2api'
  const items: [string, string][] = [
    ['数据更新于', status.updatedAt ? formatDateTime(status.updatedAt) : live ? '还没有成功读取过' : '—'],
    ...(live ? ([['最近一次读取', formatDateTime(status.lastAttemptAt)]] as [string, string][]) : []),
    ['最新一周', status.latestWeek ? formatWeekRange(status.latestWeek) : '—'],
    ['数据行数', status.rows.toLocaleString('zh-CN')],
  ]

  return (
    <div className="space-y-4">
      {status.error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" className="size-4" />
          <AlertTitle>{status.stale ? '最近一次读取失败，小镇正在展示上一次的数据' : '读取数据失败，小镇暂时没有数据'}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{status.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => onNavigate('source')}>
              检查数据源设置
              <ArrowRight />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {SOURCE_NAMES[status.active]}
              <Badge variant="secondary" className="font-normal">
                {status.label}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              {status.error ? (
                <>
                  <TriangleAlert aria-hidden="true" className="size-3.5 text-destructive" />
                  读取失败
                </>
              ) : (
                <>
                  <CircleCheck aria-hidden="true" className="size-3.5 text-primary" />
                  {live ? '正常，按设定间隔自动刷新' : '正常'}
                </>
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <LoaderCircle className="motion-safe:animate-spin" /> : <RefreshCw />}
            立即刷新
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {items.map(([term, value]) => (
              <div key={term} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{term}</dt>
                <dd className="tabular mt-1 truncate text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <QuickLink title="店铺展示" description="选择小镇里展示哪些厂商的店铺。" onClick={() => onNavigate('shops')} />
        <QuickLink title="数据源" description="切换示例数据、上传文件或 Sub2API 实时数据。" onClick={() => onNavigate('source')} />
      </div>
    </div>
  )
}

function QuickLink({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClick} aria-label={`前往${title}`}>
          <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  )
}

import { Eye, LoaderCircle, RefreshCw, Save, TriangleAlert, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { adminApi, type AdminShop } from '@/admin/api'
import { errorMessage, isUnauthorized, reportError } from '@/admin/shared'
import { LabMark } from '@/components/LabMark'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTokens } from '@/lib/format'

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/** 店铺展示：逐家开关，批量操作，改完统一保存；隐藏的厂商不出现在小镇，也不计入总量。 */
export function ShopsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [shops, setShops] = useState<AdminShop[] | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  const apply = (list: AdminShop[]) => {
    setShops(list)
    setHidden(new Set(list.filter((shop) => !shop.visible).map((shop) => shop.id)))
  }

  const load = useCallback(async () => {
    setLoadError('')
    try {
      apply((await adminApi.shops()).shops)
    } catch (error) {
      if (isUnauthorized(error)) onUnauthorized()
      else setLoadError(errorMessage(error))
    }
  }, [onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const saved = useMemo(() => new Set((shops ?? []).filter((shop) => !shop.visible).map((shop) => shop.id)), [shops])
  const dirty = !sameSet(saved, hidden)

  const toggle = (id: string, visible: boolean) => {
    setHidden((current) => {
      const next = new Set(current)
      if (visible) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      apply((await adminApi.saveShops([...hidden])).shops)
      toast.success('店铺展示已保存', { description: '访客页面会在 30 秒内更新；隐藏的厂商不计入小镇总量。' })
    } catch (error) {
      reportError(error, '保存店铺展示失败', onUnauthorized)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>读取店铺列表失败</AlertTitle>
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

  if (!shops) {
    return (
      <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        正在读取店铺列表…
      </p>
    )
  }

  const shown = shops.filter((shop) => !hidden.has(shop.id))
  const withData = shops.filter((shop) => shop.hasData)

  return (
    <Card>
      <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>店铺展示</CardTitle>
          <CardDescription>
            展示 {shown.length} 家，隐藏 {shops.length - shown.length} 家。只有最新一周有用量的厂商才会在小镇里开店。
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setHidden(new Set())} disabled={hidden.size === 0}>
            <Eye />
            全部展示
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHidden(new Set(shops.filter((shop) => !shop.hasData).map((shop) => shop.id)))}
            disabled={withData.length === 0}
          >
            只展示有数据的
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">展示</TableHead>
                <TableHead>厂商</TableHead>
                <TableHead className="text-right">最新一周 token</TableHead>
                <TableHead className="hidden w-32 sm:table-cell">数据</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((shop) => {
                const visible = !hidden.has(shop.id)
                return (
                  <TableRow key={shop.id} data-hidden={visible ? undefined : ''} className="data-[hidden]:text-muted-foreground">
                    <TableCell>
                      <Switch checked={visible} onCheckedChange={(checked) => toggle(shop.id, checked)} aria-label={`在小镇展示 ${shop.name}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <LabMark lab={shop} size="sm" className={visible ? undefined : 'opacity-50'} />
                        <span className="font-medium">{shop.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{shop.hasData ? formatTokens(shop.tokens) : '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={shop.hasData ? 'secondary' : 'outline'} className="font-normal">
                        {shop.hasData ? '有数据' : '本周无数据'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-sm text-muted-foreground">有未保存的修改</span>}
          <Button variant="ghost" onClick={() => setHidden(new Set(saved))} disabled={!dirty || saving}>
            <Undo2 />
            撤销修改
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="motion-safe:animate-spin" /> : <Save />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

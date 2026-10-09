import { ChangeIndicator } from '@/components/ChangeIndicator'
import { LabMark } from '@/components/LabMark'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatInteger, formatTokens, formatWeekRange } from '@/lib/format'
import type { TownSnapshot } from '@/lib/town-data'

interface DataSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: TownSnapshot
  datasetLabel: string
  activeId: string | null
  onView: (id: string) => void
  /** 关闭后把焦点还给打开它的控件。 */
  onCloseAutoFocus?: (event: Event) => void
}

/** 本周数据：与 3D 场景等价的表格视图，也是 WebGL 不可用时的主要阅读方式。店铺顺序与小镇街道一致。 */
export function DataSheet({ open, onOpenChange, snapshot, datasetLabel, activeId, onView, onCloseAutoFocus }: DataSheetProps) {
  const { shops } = snapshot
  const hasVisitors = shops.some((shop) => shop.visitors !== null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" onCloseAutoFocus={onCloseAutoFocus} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>本周数据</SheetTitle>
          <SheetDescription className="tabular">
            {snapshot.week ? formatWeekRange(snapshot.week) : '暂无数据'} · {datasetLabel}
          </SheetDescription>
        </SheetHeader>

        {shops.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">这一周还没有用量数据。</p>
        ) : (
          // 表格外层自带 overflow，在 flex 列里会被压扁成内层滚动；包一层固定为内容高度
          <div className="shrink-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>厂商</TableHead>
                  <TableHead className="text-right">本周 token</TableHead>
                  <TableHead className="text-right">较上周</TableHead>
                  {hasVisitors && <TableHead className="hidden text-right sm:table-cell">访客</TableHead>}
                  <TableHead className="w-14">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((shop) => (
                  <TableRow key={shop.id} data-state={shop.id === activeId ? 'selected' : undefined}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <LabMark lab={shop} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{shop.name}</p>
                          <p className="max-w-40 truncate text-xs text-muted-foreground">{shop.featured?.model}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{formatTokens(shop.weekTokens)}</TableCell>
                    <TableCell className="text-right">
                      <ChangeIndicator change={shop.change} className="justify-end text-xs" />
                    </TableCell>
                    {hasVisitors && (
                      <TableCell className="tabular hidden text-right sm:table-cell">
                        {shop.visitors === null ? '—' : formatInteger(shop.visitors)}
                      </TableCell>
                    )}
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => onView(shop.id)} aria-label={`在小镇中查看 ${shop.name}`}>
                        查看
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>合计</TableCell>
                  <TableCell className="tabular text-right">{formatTokens(snapshot.totalTokens)}</TableCell>
                  <TableCell colSpan={hasVisitors ? 3 : 2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          店铺按小镇街道的固定顺序排列；超过 20 家时，用量较少的厂商合并为“其他厂商”。
          {hasVisitors && '访客为各模型访客相加，同一用户使用多个模型会被重复计入。'}
        </p>
      </SheetContent>
    </Sheet>
  )
}

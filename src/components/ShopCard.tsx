import { ChevronDown, ChevronUp, Info, Pin } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { ChangeIndicator } from '@/components/ChangeIndicator'
import { LabMark } from '@/components/LabMark'
import { WeeklyBars } from '@/components/WeeklyBars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { compactTokens, formatContext, formatInteger, formatModalities, formatPrice, formatTokens } from '@/lib/format'
import { defaultFeatured, type FeaturedSource, type LabShop } from '@/lib/town-data'
import { cn } from '@/lib/utils'
import { labStyle } from '@/scene/lab-styles'

interface ShopCardProps {
  shop: LabShop
  /** 窄屏可把柱状图和模型资料收起，给场景让出空间。 */
  collapsible?: boolean
  /** 可折叠时的初始状态，只在挂载时读取；切换店铺保留用户的选择。 */
  defaultExpanded?: boolean
  /** 传入后可以在卡片上指定主推模型；null 表示恢复默认。 */
  onFeaturedChange?: (model: string | null) => void
  className?: string
}

const SOURCE_LABELS: Record<FeaturedSource, string> = {
  pinned: '本机指定',
  data: '数据文件指定',
  usage: '本周用量最高',
}

const DEFAULT_VALUE = 'default'
const MODEL_PREFIX = 'model:'

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint}
      </dt>
      <dd className="mt-0.5 truncate font-medium">{children}</dd>
    </div>
  )
}

function priceText(shop: LabShop): string {
  const info = shop.featured?.info
  const parts: string[] = []
  if (info?.priceIn !== undefined) parts.push(`入 ${formatPrice(info.priceIn)}`)
  if (info?.priceOut !== undefined) parts.push(`出 ${formatPrice(info.priceOut)}`)
  return parts.length ? parts.join(' · ') : '未提供'
}

/** 主推模型下拉：默认项跟随数据文件或本周用量，其余为本周在售的模型。 */
function FeaturedSelect({ shop, onChange }: { shop: LabShop; onChange: (model: string | null) => void }) {
  const fallback = defaultFeatured(shop.models)
  const pinned = shop.featuredBy === 'pinned'
  return (
    <Select
      value={pinned ? MODEL_PREFIX + shop.featured.model : DEFAULT_VALUE}
      onValueChange={(value) => onChange(value === DEFAULT_VALUE ? null : value.slice(MODEL_PREFIX.length))}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            aria-label={`主推模型：${shop.featured.model}，${SOURCE_LABELS[shop.featuredBy]}`}
            className="h-6 w-auto min-w-0 gap-1 border-transparent px-1.5 py-0 text-xs font-medium text-foreground shadow-none hover:bg-accent data-[state=open]:bg-accent [&>svg]:size-3.5 [&>svg]:shrink-0"
          >
            {pinned && <Pin aria-hidden="true" className="text-primary" />}
            <SelectValue>{shop.featured.model}</SelectValue>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">设置主推模型</TooltipContent>
      </Tooltip>
      <SelectContent align="start" className="max-h-72 min-w-[15rem]">
        <SelectItem value={DEFAULT_VALUE} textValue={`默认 ${fallback.model.model}`}>
          <span className="flex flex-col">
            <span>默认 · {fallback.model.model}</span>
            <span className="text-xs text-muted-foreground">{SOURCE_LABELS[fallback.by]}</span>
          </span>
        </SelectItem>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel className="py-1 text-xs font-normal text-muted-foreground">本周在售</SelectLabel>
          {shop.models.map((stat) => (
            <SelectItem
              key={stat.model}
              value={MODEL_PREFIX + stat.model}
              textValue={stat.model}
              // ItemText 是最后一个子元素，撑满后用量才能靠右对齐
              className="[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
            >
              <span className="flex min-w-0 items-center justify-between gap-4">
                <span className="truncate">{stat.model}</span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">{formatTokens(stat.weekTokens)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** 左下角的店铺数据卡：本周用量、较上周变化、近几周柱状图、主推模型资料和门店特色。 */
export function ShopCard({ shop, collapsible = false, defaultExpanded = true, onFeaturedChange, className }: ShopCardProps) {
  const featured = shop.featured
  const tokens = compactTokens(shop.weekTokens)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const detailsId = useId()
  const showDetails = !collapsible || expanded
  const toggleLabel = expanded ? '收起详情' : '展开详情'
  return (
    <section aria-labelledby="shop-card-title" className={cn('town-panel p-3 md:p-4', className)}>
      <header className="flex items-start gap-3">
        <LabMark lab={shop} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="shop-card-title" className="truncate text-base font-semibold leading-tight">
            {shop.name}
          </h2>
          <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">主推</span>
            {onFeaturedChange && shop.models.length > 1 ? (
              <FeaturedSelect shop={shop} onChange={onFeaturedChange} />
            ) : (
              <span className="truncate text-foreground">{featured?.model ?? '—'}</span>
            )}
            {shop.models.length > 1 && <span className="shrink-0">· 共 {shop.models.length} 款在售</span>}
            {featured?.isNew && <Badge className="ml-0.5 shrink-0 px-1.5 py-0 text-[10px]">新上架</Badge>}
          </div>
          {onFeaturedChange && shop.missingPin && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              指定的 {shop.missingPin} 这一周没有用量，暂按默认显示。
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onFeaturedChange(null)}>
                改回默认
              </Button>
            </p>
          )}
        </div>
        {collapsible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 -mt-1 size-8 shrink-0 text-muted-foreground"
                aria-expanded={expanded}
                aria-controls={detailsId}
                aria-label={toggleLabel}
                onClick={() => setExpanded((value) => !value)}
              >
                {/* 卡片贴底，展开时向上长 */}
                {expanded ? <ChevronDown /> : <ChevronUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{toggleLabel}</TooltipContent>
          </Tooltip>
        )}
      </header>

      <div className="mt-3 flex items-end justify-between gap-4 md:mt-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">本周 token</p>
          <p className="tabular mt-0.5 text-3xl font-semibold leading-none tracking-tight">
            {tokens.value}
            {tokens.unit && <span className="ml-1 text-base font-medium text-muted-foreground">{tokens.unit}</span>}
          </p>
          <ChangeIndicator change={shop.change} withLabel className="mt-2 text-xs" />
        </div>
        <WeeklyBars history={shop.history} color={shop.color} className={cn('w-36 shrink-0 sm:w-40', !showDetails && 'hidden')} />
      </div>

      <dl
        id={detailsId}
        className={cn(
          'mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2.5 text-sm md:mt-4 md:gap-y-3 md:pt-3',
          !showDetails && 'hidden',
        )}
      >
        <Stat label="上下文">{featured?.info?.context ? formatContext(featured.info.context) : '未提供'}</Stat>
        <Stat label="模态">{formatModalities(featured?.info?.modalities)}</Stat>
        <Stat label="每百万 token 价格">
          <span className="tabular">{priceText(shop)}</span>
        </Stat>
        <Stat
          label="访客"
          hint={
            shop.visitors !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4 text-muted-foreground [&_svg]:size-3" aria-label="访客口径说明">
                    <Info />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-56">各模型访客相加，同一用户使用多个模型会被重复计入。</TooltipContent>
              </Tooltip>
            )
          }
        >
          <span className="tabular">{shop.visitors === null ? '未提供' : formatInteger(shop.visitors)}</span>
        </Stat>
        <div className="col-span-2">
          <Stat label="门店特色">{labStyle(shop.id, shop.color).motif}</Stat>
        </div>
      </dl>
    </section>
  )
}

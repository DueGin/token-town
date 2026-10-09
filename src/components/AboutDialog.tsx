import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LOGO_SOURCE } from '@/lib/lab-logos'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 关闭后把焦点还给打开它的控件。 */
  onCloseAutoFocus?: (event: Event) => void
}

const ENCODINGS: [string, string][] = [
  ['一块地皮', '一家 AI 厂商一间店，四周是人行道和公路；按固定顺序排列，不按用量排名'],
  ['门店外观', '外墙、屋顶、雨棚和屋顶装饰按厂商特色设计，背墙是原创街头涂鸦'],
  ['招牌与挂牌', '门头招牌和门右侧挂牌展示厂商 Logo 与名称'],
  ['排队人数', '本周 token 用量，按平方根缩放，最多 24 人'],
  ['进店节奏', '一次进一位顾客，提着购物袋出来后下一位才进'],
  ['天色', '小镇时间，默认跟随系统时区的当前时间，可在工具栏调节'],
]

const CONTROLS: [string, string][] = [
  ['← / →', '上一家 / 下一家'],
  ['Home / End', '第一家 / 最后一家'],
  ['点击店铺', '走到这家店'],
  ['时钟按钮', '切换时区，或手动调到任意时刻'],
  ['门形按钮', '调整顾客进出店的速度，默认 3 倍'],
  ['主推模型名', '在数据卡上为这家店指定主推模型，只保存在本机'],
  ['拖动 / 滚轮', '旋转 / 缩放视角，右键拖动平移'],
]

/** 说明弹窗：编码规则、操作方式、灵感来源与原创声明。 */
export function AboutDialog({ open, onOpenChange, onCloseAutoFocus }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>关于 Token 商店小镇</DialogTitle>
          <DialogDescription>把每家 AI 厂商一周的 token 用量，画成一座门口排着队的小镇。</DialogDescription>
        </DialogHeader>

        <section className="space-y-2 text-sm">
          <h3 className="font-medium">怎么读这座小镇</h3>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
            {ENCODINGS.map(([term, detail]) => (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-2 text-sm">
          <h3 className="font-medium">操作</h3>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
            {CONTROLS.map(([term, detail]) => (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            灵感来自 Ryan Sael 的作品 Token Town。本项目的建模、配色、文案与代码均为原创实现，不包含原作品的素材、Logo 或宣传语。
          </p>
          <p>
            厂商 Logo 取自 {LOGO_SOURCE}，仅用于标识对应厂商，商标归各自所有者；表外厂商使用文字缩写徽标。
          </p>
          <p>小镇的数据由管理员在控制后台配置，可以是 Sub2API 的实时用量、上传的数据文件或虚构的示例数据；示例数据中的模型、价格、用量与访客全部为虚构。</p>
        </section>
      </DialogContent>
    </Dialog>
  )
}

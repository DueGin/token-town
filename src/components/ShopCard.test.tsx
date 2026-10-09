import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChangeIndicator } from '@/components/ChangeIndicator'
import { ShopCard } from '@/components/ShopCard'
import { WeeklyBars } from '@/components/WeeklyBars'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { LabShop } from '@/lib/town-data'

const history = [
  { week: '2026-09-07', tokens: 0 },
  { week: '2026-09-14', tokens: 80_000_000 },
  { week: '2026-09-21', tokens: 120_000_000 },
]

function makeShop(overrides: Partial<LabShop> = {}): LabShop {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    color: '#d97757',
    monogram: 'A',
    featured: {
      model: 'claude-示例',
      weekTokens: 120_000_000,
      isNew: true,
      info: { model: 'claude-示例', context: 1_000_000, modalities: ['text', 'image'], priceIn: 3, priceOut: 15 },
    },
    featuredBy: 'usage',
    models: [
      { model: 'claude-示例', weekTokens: 100_000_000, isNew: true },
      { model: 'claude-小', weekTokens: 20_000_000, isNew: false },
    ],
    weekTokens: 120_000_000,
    prevWeekTokens: 80_000_000,
    change: 0.5,
    history,
    visitors: 1234,
    queue: 12,
    ...overrides,
  }
}

function renderWithTooltip(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>)
}

describe('ChangeIndicator', () => {
  it('上涨带正号和“较上周”', () => {
    const { container } = render(<ChangeIndicator change={0.125} withLabel />)
    expect(container).toHaveTextContent('+12.5%较上周')
    expect(container.firstElementChild).toHaveClass('text-rise')
  })

  it('下跌使用真正的减号', () => {
    const { container } = render(<ChangeIndicator change={-0.3} />)
    expect(container).toHaveTextContent('−30.0%')
    expect(container.firstElementChild).toHaveClass('text-fall')
  })

  it('没有上周数据时不显示百分比', () => {
    render(<ChangeIndicator change={null} withLabel />)
    expect(screen.getByText('暂无上周数据')).toBeInTheDocument()
  })
})

describe('WeeklyBars', () => {
  it('每周一根柱，并提供等价的数据表', () => {
    renderWithTooltip(<WeeklyBars history={history} color="#d97757" />)
    expect(screen.getAllByTestId('weekly-bar')).toHaveLength(3)
    const table = screen.getByRole('table', { name: '近 3 周 token 用量' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('1.2 亿')).toBeInTheDocument()
  })
})

describe('ShopCard', () => {
  it('展示用量、价格、访客和门店特色，不显示排名', () => {
    renderWithTooltip(<ShopCard shop={makeShop()} />)
    const card = screen.getByRole('region', { name: 'Anthropic' })
    expect(card).not.toHaveTextContent(/第 \d+ 名/)
    expect(card).toHaveTextContent('陶土色木构书店')
    expect(within(card).getByText('新上架')).toBeInTheDocument()
    expect(card).toHaveTextContent('共 2 款在售')
    expect(card).toHaveTextContent('1.2亿')
    expect(card).toHaveTextContent('+50.0%较上周')
    expect(card).toHaveTextContent('1M')
    expect(card).toHaveTextContent('文本 · 图像')
    expect(card).toHaveTextContent('入 $3.00 · 出 $15.00')
    expect(card).toHaveTextContent('1,234')
    expect(within(card).getByRole('button', { name: '访客口径说明' })).toBeInTheDocument()
  })

  it('缺失的资料显示“未提供”，没有访客时不显示口径说明', () => {
    renderWithTooltip(
      <ShopCard
        shop={makeShop({
          featured: { model: 'claude-示例', weekTokens: 9_000, isNew: false },
          models: [{ model: 'claude-示例', weekTokens: 9_000, isNew: false }],
          weekTokens: 9_000,
          change: null,
          prevWeekTokens: null,
          visitors: null,
        })}
      />,
    )
    const card = screen.getByRole('region', { name: 'Anthropic' })
    expect(within(card).getAllByText('未提供')).toHaveLength(4)
    expect(card).toHaveTextContent('9,000')
    expect(card).not.toHaveTextContent('款在售')
    expect(within(card).queryByText('新上架')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '访客口径说明' })).not.toBeInTheDocument()
  })

  it('可以在卡片上指定主推模型，默认项说明来源', async () => {
    const user = userEvent.setup()
    const onFeaturedChange = vi.fn()
    renderWithTooltip(<ShopCard shop={makeShop()} onFeaturedChange={onFeaturedChange} />)
    const trigger = screen.getByRole('combobox', { name: '主推模型：claude-示例，本周用量最高' })
    expect(trigger).toHaveTextContent('claude-示例')

    await user.click(trigger)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: /^默认 · claude-示例/ })).toHaveTextContent('本周用量最高')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    await user.click(within(listbox).getByRole('option', { name: /^claude-小/ }))
    expect(onFeaturedChange).toHaveBeenCalledWith('claude-小')
  })

  it('本机指定的主推可以改回默认；只有一款在售时不显示下拉', async () => {
    const user = userEvent.setup()
    const onFeaturedChange = vi.fn()
    const small = { model: 'claude-小', weekTokens: 20_000_000, isNew: false }
    const { rerender } = renderWithTooltip(
      <ShopCard shop={makeShop({ featured: small, featuredBy: 'pinned' })} onFeaturedChange={onFeaturedChange} />,
    )
    const card = screen.getByRole('region', { name: 'Anthropic' })
    // 价格、上下文跟着主推走，这款没有资料
    expect(within(card).getAllByText('未提供')).toHaveLength(3)
    expect(within(card).queryByText('新上架')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: '主推模型：claude-小，本机指定' }))
    await user.click(await screen.findByRole('option', { name: /^默认/ }))
    expect(onFeaturedChange).toHaveBeenLastCalledWith(null)

    rerender(
      <TooltipProvider>
        <ShopCard
          shop={makeShop({ models: [makeShop().models[0]], missingPin: 'claude-旧' })}
          onFeaturedChange={onFeaturedChange}
        />
      </TooltipProvider>,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/指定的 claude-旧 这一周没有用量/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '改回默认' }))
    expect(onFeaturedChange).toHaveBeenCalledTimes(2)
    expect(onFeaturedChange).toHaveBeenLastCalledWith(null)
  })

  it('不传回调时主推只读', () => {
    renderWithTooltip(<ShopCard shop={makeShop()} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Anthropic' })).toHaveTextContent('主推claude-示例· 共 2 款在售')
  })

  it('桌面不出现折叠按钮', () => {
    renderWithTooltip(<ShopCard shop={makeShop()} />)
    expect(screen.queryByRole('button', { name: /详情/ })).not.toBeInTheDocument()
  })

  it('窄屏可收起柱状图和资料，切换店铺时保留选择', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithTooltip(<ShopCard shop={makeShop()} collapsible defaultExpanded={false} />)
    const toggle = screen.getByRole('button', { name: '展开详情' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const details = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(details).toHaveClass('hidden')
    expect(screen.getByRole('figure')).toHaveClass('hidden')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: '收起详情' })).toHaveAttribute('aria-expanded', 'true')
    expect(details).not.toHaveClass('hidden')
    expect(screen.getByRole('figure')).not.toHaveClass('hidden')

    rerender(
      <TooltipProvider>
        <ShopCard shop={makeShop({ id: 'openai', name: 'OpenAI' })} collapsible defaultExpanded={false} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: '收起详情' })).toBeInTheDocument()
  })
})

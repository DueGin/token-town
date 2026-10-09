import { Database, ExternalLink, LayoutDashboard, LoaderCircle, LogOut, Store } from 'lucide-react'
import { useEffect, useState } from 'react'
import { adminApi } from '@/admin/api'
import { OverviewPanel } from '@/admin/OverviewPanel'
import { reportError } from '@/admin/shared'
import { ShopsPanel } from '@/admin/ShopsPanel'
import { SourcePanel } from '@/admin/SourcePanel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['overview', 'shops', 'source'] as const
type Tab = (typeof TABS)[number]

function tabFromHash(): Tab {
  const hash = window.location.hash.slice(1)
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'overview'
}

interface AdminConsoleProps {
  onLoggedOut: () => void
  onUnauthorized: () => void
}

/** 控制台：概览、店铺展示、数据源三个页签，页签同步到网址的 hash，刷新后停在原处。 */
export function AdminConsole({ onLoggedOut, onUnauthorized }: AdminConsoleProps) {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const changeTab = (value: string) => {
    setTab(value as Tab)
    window.history.replaceState(null, '', `#${value}`)
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      await adminApi.logout()
      onLoggedOut()
    } catch (error) {
      reportError(error, '退出登录失败', onUnauthorized)
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Store aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">Token 商店小镇 · 控制后台</h1>
          </div>
          <Button asChild variant="ghost" size="sm">
            <a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer">
              <ExternalLink />
              <span className="max-sm:sr-only">查看小镇</span>
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? <LoaderCircle className="motion-safe:animate-spin" /> : <LogOut />}
            <span className="max-sm:sr-only">退出登录</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="overview" className="flex-1 sm:flex-none">
              <LayoutDashboard aria-hidden="true" />
              概览
            </TabsTrigger>
            <TabsTrigger value="shops" className="flex-1 sm:flex-none">
              <Store aria-hidden="true" />
              店铺展示
            </TabsTrigger>
            <TabsTrigger value="source" className="flex-1 sm:flex-none">
              <Database aria-hidden="true" />
              数据源
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewPanel onUnauthorized={onUnauthorized} onNavigate={changeTab} />
          </TabsContent>
          <TabsContent value="shops">
            <ShopsPanel onUnauthorized={onUnauthorized} />
          </TabsContent>
          <TabsContent value="source">
            <SourcePanel onUnauthorized={onUnauthorized} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

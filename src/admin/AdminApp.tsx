import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AdminApiError, adminApi } from '@/admin/api'
import { AdminConsole } from '@/admin/AdminConsole'
import { LoginPage } from '@/admin/LoginPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useMediaQuery } from '@/lib/preferences'

type Phase = 'checking' | 'login' | 'ready' | 'disabled' | 'offline'

/** 控制后台：先查登录状态，未登录显示登录页；后台未启用或连不上服务时给出说明。 */
export function AdminApp() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [offlineMessage, setOfflineMessage] = useState('')
  const dark = useMediaQuery('(prefers-color-scheme: dark)')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const check = useCallback(async () => {
    setPhase('checking')
    try {
      const { authenticated } = await adminApi.session()
      setPhase(authenticated ? 'ready' : 'login')
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'admin_disabled') {
        setPhase('disabled')
        return
      }
      setOfflineMessage(error instanceof AdminApiError ? error.message : '连不上小镇服务')
      setPhase('offline')
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  /** 任一接口返回 401（会话过期）时回到登录页。 */
  const onUnauthorized = useCallback(() => {
    toast.warning('登录已过期，请重新登录')
    setPhase('login')
  }, [])

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-dvh bg-muted/40">
        {phase === 'checking' && (
          <div className="flex min-h-dvh items-center justify-center">
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              正在连接小镇服务…
            </p>
          </div>
        )}
        {phase === 'disabled' && (
          <CenteredAlert title="控制后台未启用">
            服务端没有设置 <code className="font-mono text-foreground">ADMIN_PASSWORD</code> 环境变量。设置管理员密码并重启服务后即可登录；小镇本身不受影响。
          </CenteredAlert>
        )}
        {phase === 'offline' && (
          <CenteredAlert title="连不上小镇服务">
            <p>{offlineMessage}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void check()}>
              <RefreshCw />
              重试
            </Button>
          </CenteredAlert>
        )}
        {phase === 'login' && <LoginPage onSuccess={() => setPhase('ready')} />}
        {phase === 'ready' && <AdminConsole onLoggedOut={() => setPhase('login')} onUnauthorized={onUnauthorized} />}
      </div>
      <Toaster position="top-right" theme={dark ? 'dark' : 'light'} closeButton />
    </TooltipProvider>
  )
}

function CenteredAlert({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Alert className="max-w-md bg-card">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{children}</AlertDescription>
      </Alert>
    </div>
  )
}

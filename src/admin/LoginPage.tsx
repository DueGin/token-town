import { LoaderCircle, LogIn, Store } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { AdminApiError, adminApi } from '@/admin/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 登录页：只有一个管理员密码。错误留在表单里，紧挨着密码框。 */
export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const fieldId = useId()
  const errorId = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password) {
      setError('请输入管理员密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminApi.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : '登录失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Store aria-hidden="true" className="size-5" />
          </div>
          <CardTitle className="text-xl">小镇控制后台</CardTitle>
          <CardDescription>管理店铺展示和数据源。请输入服务端设置的管理员密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor={fieldId}>管理员密码</Label>
              <Input
                id={fieldId}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
              />
              {error && (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : <LogIn />}
              {busy ? '正在登录…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

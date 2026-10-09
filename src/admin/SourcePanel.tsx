import { Check, Copy, Download, FileUp, LoaderCircle, PlugZap, RefreshCw, Save, TriangleAlert, Upload } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { READONLY_SQL } from '@/admin/readonly-sql'
import { adminApi, type SourceKind, type SourceStatus, type SourceView, type Sub2apiSettings, type TestResult } from '@/admin/api'
import { errorMessage, formatDateTime, isUnauthorized, reportError, SOURCE_NAMES } from '@/admin/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatTokens, formatWeekRange } from '@/lib/format'
import { CSV_TEMPLATE, MAX_IMPORT_BYTES } from '@/lib/import-data'
import { COMMON_TIME_ZONES } from '@/lib/time-of-day'
import { cn } from '@/lib/utils'

const SOURCE_HINTS: Record<SourceKind, string> = {
  sample: '虚构的演示数据，厂商名称真实，其余全部虚构。',
  file: '使用在这里上传的 CSV / JSON 用量文件，对所有访客生效。',
  sub2api: '只读连接 Sub2API 的数据库，按设定间隔自动刷新。',
}

const SSL_OPTIONS: { value: Sub2apiSettings['sslmode']; label: string }[] = [
  { value: 'disable', label: '不加密（同机或内网）' },
  { value: 'require', label: '加密，不校验证书' },
  { value: 'verify-full', label: '加密并校验证书' },
]
const WEEK_OPTIONS = [4, 6, 8, 12, 16, 26]
const REFRESH_OPTIONS: [number, string][] = [
  [30, '30 秒'],
  [60, '1 分钟'],
  [120, '2 分钟'],
  [300, '5 分钟'],
  [600, '10 分钟'],
  [1800, '30 分钟'],
]


/** 表单里的连接参数：文本框保持字符串，提交时再校验转换。 */
interface Draft extends Omit<Sub2apiSettings, 'port'> {
  port: string
}

type PasswordMode = 'keep' | 'clear'
type FieldErrors = Partial<Record<'host' | 'port' | 'database' | 'user', string>>

/** 接口返回的配置带 hasPassword，表单和提交都不需要它。 */
function toDraft(settings: SourceView['sub2api']): Draft {
  const { hasPassword: _hasPassword, ...rest } = settings
  return { ...rest, port: String(rest.port) }
}

function validate(draft: Draft): { settings: Sub2apiSettings | null; errors: FieldErrors } {
  const errors: FieldErrors = {}
  if (!draft.host.trim()) errors.host = '请填写数据库主机'
  if (!draft.user.trim()) errors.user = '请填写用户名'
  if (!draft.database.trim()) errors.database = '请填写数据库名'
  const port = Number(draft.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '端口需要是 1–65535 的整数'
  if (Object.keys(errors).length) return { settings: null, errors }
  return { settings: { ...draft, host: draft.host.trim(), user: draft.user.trim(), database: draft.database.trim(), port }, errors }
}

function downloadTemplate() {
  // 加 BOM，Excel 打开时中文不乱码
  const blob = new Blob(['﻿', CSV_TEMPLATE, '\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'token-town-template.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  toast.success('模板已开始下载')
}

/** 数据源：选择示例、上传文件或 Sub2API；Sub2API 可以先测试连接再保存。 */
export function SourcePanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [view, setView] = useState<SourceView | null>(null)
  const [status, setStatus] = useState<SourceStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [active, setActive] = useState<SourceKind>('sample')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [password, setPassword] = useState('')
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('keep')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  const apply = (next: SourceView) => {
    setView(next)
    setActive(next.active)
    setDraft(toDraft(next.sub2api))
    setPassword('')
    setPasswordMode('keep')
    setErrors({})
  }

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [source, current] = await Promise.all([adminApi.source(), adminApi.status()])
      apply(source)
      setStatus(current)
    } catch (error) {
      if (isUnauthorized(error)) onUnauthorized()
      else setLoadError(errorMessage(error))
    }
  }, [onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  /** 要发给服务端的密码：填了就是新密码，选了清除就是空串，否则不传（保留原值）。 */
  const passwordToSend = password ? password : passwordMode === 'clear' ? '' : undefined

  const runTest = async () => {
    if (!draft) return
    const { settings, errors: found } = validate(draft)
    setErrors(found)
    if (!settings) return
    setTesting(true)
    setTest(null)
    try {
      const result = await adminApi.testSource(settings, passwordToSend)
      setTest(result)
      if (result.ok) toast.success('连接成功', { description: `用时 ${result.summary.latencyMs} 毫秒` })
    } catch (error) {
      reportError(error, '测试连接失败', onUnauthorized)
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!draft || !view) return
    const { hasPassword: _hasPassword, ...saved } = view.sub2api
    let settings: Sub2apiSettings = saved
    if (active === 'sub2api') {
      const checked = validate(draft)
      setErrors(checked.errors)
      if (!checked.settings) return
      settings = checked.settings
    } else {
      // 没选 Sub2API 时也保存已经填好的连接参数，方便以后切换；不完整就保留原值
      const checked = validate(draft)
      if (checked.settings) settings = checked.settings
      setErrors({})
    }
    setSaving(true)
    try {
      const result = await adminApi.saveSource({ active, sub2api: settings, password: passwordToSend })
      apply(result.source)
      setStatus(result.status)
      if (result.status.error) {
        toast.warning('已保存，但读取数据失败', { description: result.status.error.message })
      } else {
        toast.success('数据源已保存', {
          description: `正在使用${SOURCE_NAMES[result.source.active]}，共 ${result.status.rows.toLocaleString('zh-CN')} 行；访客页面会在 30 秒内更新。`,
        })
      }
    } catch (error) {
      reportError(error, '保存数据源失败', onUnauthorized)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>读取数据源配置失败</AlertTitle>
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

  if (!view || !draft) {
    return (
      <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        正在读取数据源配置…
      </p>
    )
  }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }))
    setTest(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>使用哪个数据源</CardTitle>
          <CardDescription>
            当前：{SOURCE_NAMES[view.active]}
            {status?.updatedAt ? `，数据更新于 ${formatDateTime(status.updatedAt)}` : ''}。切换后点“保存”生效，访客页面会在 30 秒内更新。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={active} onValueChange={(value) => setActive(value as SourceKind)} className="grid gap-3 sm:grid-cols-3" aria-label="数据源">
            {(['sub2api', 'file', 'sample'] as const).map((kind) => (
              <Label
                key={kind}
                htmlFor={`source-${kind}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal leading-normal transition-colors hover:bg-accent/60',
                  active === kind && 'border-primary bg-primary/5',
                )}
              >
                <RadioGroupItem id={`source-${kind}`} value={kind} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{SOURCE_NAMES[kind]}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{SOURCE_HINTS[kind]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {active === 'sub2api' && (
        <Sub2apiCard
          draft={draft}
          hasPassword={view.sub2api.hasPassword}
          password={password}
          passwordMode={passwordMode}
          errors={errors}
          testing={testing}
          test={test}
          onChange={update}
          onPassword={(value) => {
            setPassword(value)
            setTest(null)
          }}
          onPasswordMode={(mode) => {
            setPasswordMode(mode)
            setPassword('')
            setTest(null)
          }}
          onTest={() => void runTest()}
        />
      )}

      {active === 'file' && (
        <UploadCard
          file={view.file}
          activate={view.active === 'file'}
          onUploaded={(next, current) => {
            apply(next)
            setStatus(current)
          }}
          onUnauthorized={onUnauthorized}
        />
      )}

      {active === 'sample' && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            示例数据里的模型、价格、用量与访客全部为虚构，小镇会标注“示例数据 · 虚构”。接入真实数据前可以先用它预览效果。
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <LoaderCircle className="motion-safe:animate-spin" /> : <Save />}
          {active === view.active ? '保存' : `保存并切换到${SOURCE_NAMES[active]}`}
        </Button>
      </div>
    </div>
  )
}

interface Sub2apiCardProps {
  draft: Draft
  hasPassword: boolean
  password: string
  passwordMode: PasswordMode
  errors: FieldErrors
  testing: boolean
  test: TestResult | null
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  onPassword: (value: string) => void
  onPasswordMode: (mode: PasswordMode) => void
  onTest: () => void
}

function Sub2apiCard(props: Sub2apiCardProps) {
  const { draft, hasPassword, password, passwordMode, errors, testing, test, onChange } = props
  const zones = COMMON_TIME_ZONES.some((item) => item.zone === draft.timezone)
    ? COMMON_TIME_ZONES
    : [{ zone: draft.timezone, label: draft.timezone }, ...COMMON_TIME_ZONES]
  const weeks = WEEK_OPTIONS.includes(draft.weeks) ? WEEK_OPTIONS : [...WEEK_OPTIONS, draft.weeks].sort((a, b) => a - b)
  const refresh = REFRESH_OPTIONS.some(([seconds]) => seconds === draft.refreshSeconds)
    ? REFRESH_OPTIONS
    : [...REFRESH_OPTIONS, [draft.refreshSeconds, `${draft.refreshSeconds} 秒`] as [number, string]].sort((a, b) => a[0] - b[0])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sub2API 数据库</CardTitle>
        <CardDescription>
          只读连接 Sub2API 的 PostgreSQL，按“模型 × 周”聚合 usage_logs；密码加密保存在服务端，不会再显示出来。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="主机" error={errors.host} hint="同一 Docker 网络里一般填 postgres">
            {(id, describedBy) => (
              <Input id={id} value={draft.host} onChange={(e) => onChange('host', e.target.value)} placeholder="postgres" autoComplete="off" aria-invalid={Boolean(errors.host)} aria-describedby={describedBy} />
            )}
          </Field>
          <Field label="端口" error={errors.port}>
            {(id, describedBy) => (
              <Input id={id} value={draft.port} inputMode="numeric" onChange={(e) => onChange('port', e.target.value)} aria-invalid={Boolean(errors.port)} aria-describedby={describedBy} />
            )}
          </Field>
          <Field label="数据库名" error={errors.database}>
            {(id, describedBy) => (
              <Input id={id} value={draft.database} onChange={(e) => onChange('database', e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.database)} aria-describedby={describedBy} />
            )}
          </Field>
          <Field label="用户名" error={errors.user} hint="建议用只读账号，见下方说明">
            {(id, describedBy) => (
              <Input id={id} value={draft.user} onChange={(e) => onChange('user', e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.user)} aria-describedby={describedBy} />
            )}
          </Field>
          <Field
            label="密码"
            hint={
              passwordMode === 'clear'
                ? '保存后会清除已保存的密码'
                : hasPassword
                  ? '已保存密码；留空则不修改'
                  : '没有密码可以留空'
            }
          >
            {(id, describedBy) => (
              <div className="space-y-1.5">
                <Input
                  id={id}
                  type="password"
                  value={password}
                  onChange={(e) => props.onPassword(e.target.value)}
                  placeholder={passwordMode === 'clear' ? '将清除已保存的密码' : hasPassword ? '已保存，留空则不修改' : ''}
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                />
                {hasPassword && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => props.onPasswordMode(passwordMode === 'clear' ? 'keep' : 'clear')}
                  >
                    {passwordMode === 'clear' ? '不清除，保留已保存的密码' : '清除已保存的密码'}
                  </Button>
                )}
              </div>
            )}
          </Field>
          <Field label="SSL">
            {(id) => (
              <Select value={draft.sslmode} onValueChange={(value) => onChange('sslmode', value as Draft['sslmode'])}>
                <SelectTrigger id={id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SSL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>

        <div className="space-y-4 border-t pt-6">
          <h3 className="text-sm font-medium">统计口径</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="分周时区" hint="按这个时区的周一零点切分每周">
              {(id, describedBy) => (
                <Select value={draft.timezone} onValueChange={(value) => onChange('timezone', value)}>
                  <SelectTrigger id={id} aria-describedby={describedBy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {zones.map((item) => (
                      <SelectItem key={item.zone} value={item.zone}>
                        {item.label === item.zone ? item.zone : `${item.label}（${item.zone}）`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="模型名口径">
              {(id) => (
                <Select value={draft.modelField} onValueChange={(value) => onChange('modelField', value as Draft['modelField'])}>
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requested">客户端请求的模型（推荐）</SelectItem>
                    <SelectItem value="upstream">实际调用的上游模型</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="统计周数" hint="包括本周；周数越多查询越慢">
              {(id, describedBy) => (
                <Select value={String(draft.weeks)} onValueChange={(value) => onChange('weeks', Number(value))}>
                  <SelectTrigger id={id} aria-describedby={describedBy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weeks.map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        最近 {count} 周
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="刷新间隔" hint="每次只重查本周，已经过去的周每小时重查一次">
              {(id, describedBy) => (
                <Select value={String(draft.refreshSeconds)} onValueChange={(value) => onChange('refreshSeconds', Number(value))}>
                  <SelectTrigger id={id} aria-describedby={describedBy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {refresh.map(([seconds, label]) => (
                      <SelectItem key={seconds} value={String(seconds)}>
                        每 {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
          <SwitchRow
            checked={draft.successOnly}
            onChange={(checked) => onChange('successOnly', checked)}
            title="只统计成功的请求"
            description="按 Sub2API 官方统计口径，排除失败请求留下的占位记录。"
          />
          <SwitchRow
            checked={draft.platformAssist}
            onChange={(checked) => onChange('platformAssist', checked)}
            title="按上游平台辅助识别厂商"
            description="模型名认不出厂商时，按账号或分组的上游平台归类，例如 kimi 平台归到 Kimi 的店。"
          />
        </div>

        <div className="space-y-3 border-t pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={props.onTest} disabled={testing}>
              {testing ? <LoaderCircle className="motion-safe:animate-spin" /> : <PlugZap />}
              {testing ? '正在测试…' : '测试连接'}
            </Button>
            <span className="text-xs text-muted-foreground">用上面填写的参数（含未保存的修改）试读一次，不会保存。</span>
          </div>
          {test && <TestOutcome result={test} />}
        </div>

        <ReadonlyTip />
      </CardContent>
    </Card>
  )
}

function TestOutcome({ result }: { result: TestResult }) {
  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>连接失败</AlertTitle>
        <AlertDescription>{result.error.message}</AlertDescription>
      </Alert>
    )
  }
  const { summary } = result
  return (
    <div role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Check aria-hidden="true" className="size-4 text-primary" />
        连接成功，用时 {summary.latencyMs} 毫秒
      </p>
      <p className="mt-1 text-muted-foreground">
        {summary.latestWeek
          ? `读到 ${summary.weeks} 周数据，最新一周 ${formatWeekRange(summary.latestWeek)} 有 ${summary.models} 个模型。`
          : '连接正常，但所选周数内没有用量记录。'}
      </p>
      {summary.top.length > 0 && (
        <ol className="mt-3 space-y-1">
          {summary.top.map((item, index) => (
            <li key={item.model} className="flex items-center justify-between gap-3">
              <span className="truncate">
                <span className="tabular mr-2 text-muted-foreground">{index + 1}.</span>
                {item.model}
              </span>
              <span className="tabular shrink-0 text-muted-foreground">{formatTokens(item.tokens)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ReadonlyTip() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(READONLY_SQL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
      toast.success('SQL 已复制')
    } catch {
      toast.error('复制失败', { description: '浏览器未授予剪贴板权限，请手动选中复制。' })
    }
  }
  return (
    <div className="space-y-2 border-t pt-6">
      <h3 className="text-sm font-medium">建议使用只读账号</h3>
      <p className="text-sm text-muted-foreground">
        小镇只需要读取 usage_logs、accounts 和 groups 三张表。用 Sub2API 数据库的管理员账号执行下面的 SQL，创建一个只读账号再填到上面：
      </p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-md bg-muted py-2.5 pl-3 pr-11 text-xs leading-relaxed">
          <code>{READONLY_SQL}</code>
        </pre>
        <Button variant="ghost" size="icon" className="absolute right-1 top-1 size-7" onClick={() => void copy()} aria-label="复制建只读账号的 SQL">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

interface UploadCardProps {
  file: SourceView['file']
  /** 当前已经在用上传的文件：上传后直接生效。 */
  activate: boolean
  onUploaded: (view: SourceView, status: SourceStatus) => void
  onUnauthorized: () => void
}

function UploadCard({ file, activate, onUploaded, onUnauthorized }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const upload = async (picked: File) => {
    if (busy) return
    if (picked.size > MAX_IMPORT_BYTES) {
      toast.error('文件超过 5 MB', { description: '请先按周和模型聚合后再上传。' })
      return
    }
    setBusy(true)
    try {
      const text = await picked.text()
      const result = await adminApi.upload(picked.name, text, activate)
      onUploaded(result.source, result.status)
      const accepted = result.accepted.toLocaleString('zh-CN')
      const after = activate ? '已生效。' : '点“保存并切换”后生效。'
      if (result.skipped > 0) {
        toast.warning(`已上传 ${accepted} 行，跳过 ${result.skipped.toLocaleString('zh-CN')} 行`, { description: `${result.firstIssue ?? ''} ${after}`.trim() })
      } else {
        toast.success(`已上传 ${accepted} 行用量数据`, { description: after })
      }
    } catch (error) {
      reportError(error, '上传失败', onUnauthorized)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const picked = event.dataTransfer.files[0]
    if (picked) void upload(picked)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>上传数据文件</CardTitle>
        <CardDescription>
          {file
            ? `已上传 ${file.fileName}（${file.rows.toLocaleString('zh-CN')} 行，${formatDateTime(file.uploadedAt)}），重新上传会替换它。`
            : '还没有上传过数据文件。'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-busy={busy}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
            dragging && 'border-primary bg-primary/5',
          )}
        >
          <FileUp aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">把 CSV 或 JSON 文件拖到这里</p>
          <p className="text-xs text-muted-foreground">最大 5 MB、5 万行；超出请先按周和模型聚合</p>
          <Button className="mt-1" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : <Upload />}
            {busy ? '正在上传…' : '选择文件'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json"
            className="hidden"
            data-testid="upload-file-input"
            onChange={(event) => {
              const picked = event.target.files?.[0]
              event.target.value = ''
              if (picked) void upload(picked)
            }}
          />
        </div>
        <section className="space-y-1.5 text-sm">
          <h3 className="font-medium">数据格式</h3>
          <p className="text-muted-foreground">
            每行一条“模型 × 周”的用量。必填 <code className="text-foreground">model</code>、<code className="text-foreground">tokens</code>
            （或 input_tokens / output_tokens 等分项）和 <code className="text-foreground">week</code> / <code className="text-foreground">date</code>
            （YYYY-MM-DD，自动归到所在周的周一）。可选 lab、visitors、price_in / price_out（美元 / 百万 token）、context、modalities、released、featured。
          </p>
        </section>
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download />
          下载 CSV 模板
        </Button>
      </CardContent>
    </Card>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId()
  const hintId = useId()
  const describedBy = error || hint ? hintId : undefined
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children(id, describedBy)}
      {(error || hint) && (
        <p id={hintId} className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

function SwitchRow({ checked, onChange, title, description }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description: string }) {
  const id = useId()
  const descriptionId = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{title}</Label>
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={descriptionId} />
    </div>
  )
}

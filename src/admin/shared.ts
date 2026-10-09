import { toast } from 'sonner'
import { AdminApiError, type SourceKind } from '@/admin/api'

export const SOURCE_NAMES: Record<SourceKind, string> = {
  sample: '示例数据',
  file: '上传文件',
  sub2api: 'Sub2API 数据库',
}

/** 一次性操作失败：会话过期回到登录页，其余用右上角错误通知。 */
export function reportError(error: unknown, title: string, onUnauthorized: () => void): void {
  if (error instanceof AdminApiError && error.status === 401) {
    onUnauthorized()
    return
  }
  toast.error(title, { description: error instanceof AdminApiError ? error.message : '请稍后再试' })
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401
}

export function errorMessage(error: unknown): string {
  return error instanceof AdminApiError ? error.message : '请稍后再试'
}

/** “9月30日 14:05”；今天只显示时间。 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const today = date.toDateString() === new Date().toDateString()
  return date.toLocaleString(
    'zh-CN',
    today ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  )
}

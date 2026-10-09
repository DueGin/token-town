import type { AdminShop } from '../../server/app'
import type { Sub2apiSettings, SourceKind, UploadedFile } from '../../server/config-store'
import type { SourceStatus } from '../../server/dataset-service'
import type { TestSummary } from '../../server/sources/sub2api'

export type { AdminShop, SourceKind, SourceStatus, Sub2apiSettings, TestSummary }

export interface SourceView {
  active: SourceKind
  sub2api: Sub2apiSettings & { hasPassword: boolean }
  file: UploadedFile | null
}

export interface SaveSourceBody {
  active: SourceKind
  sub2api: Sub2apiSettings
  /** 不传表示保留已保存的密码，空串表示清除。 */
  password?: string
}

export type TestResult = { ok: true; summary: TestSummary } | { ok: false; error: { code: string; message: string } }

export interface UploadResult {
  accepted: number
  skipped: number
  firstIssue: string | null
  source: SourceView
  status: SourceStatus
}

/** 后台接口的错误：status 为 0 表示连不上服务。 */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

const BASE = `${import.meta.env.BASE_URL}api/admin`

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AdminApiError(0, 'network', '连不上小镇服务，请确认服务正在运行')
  }
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; detail?: string | null } } | null
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      data?.error?.code ?? `http_${response.status}`,
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      data?.error?.detail ?? null,
    )
  }
  return data as T
}

export const adminApi = {
  session: () => request<{ authenticated: boolean }>('GET', '/session'),
  login: (password: string) => request<{ ok: true }>('POST', '/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/logout', {}),
  status: () => request<SourceStatus>('GET', '/status'),
  shops: () => request<{ shops: AdminShop[] }>('GET', '/shops'),
  saveShops: (hidden: string[]) => request<{ shops: AdminShop[] }>('PUT', '/shops', { hidden }),
  source: () => request<SourceView>('GET', '/source'),
  saveSource: (body: SaveSourceBody) => request<{ source: SourceView; status: SourceStatus }>('PUT', '/source', body),
  testSource: (sub2api: Sub2apiSettings, password?: string) =>
    request<TestResult>('POST', '/source/test', password === undefined ? { sub2api } : { sub2api, password }),
  refresh: () => request<SourceStatus>('POST', '/source/refresh', {}),
  upload: (fileName: string, text: string, activate: boolean) => request<UploadResult>('POST', '/source/file', { fileName, text, activate }),
}

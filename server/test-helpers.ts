import type { PoolFactory, QueryClient } from './sources/sub2api'

/** Sub2API v0.2.14 usage_logs 的主要列（带 data_type）。 */
export const SUB2API_COLUMNS: [string, string, string][] = [
  ['usage_logs', 'id', 'bigint'],
  ['usage_logs', 'user_id', 'bigint'],
  ['usage_logs', 'account_id', 'bigint'],
  ['usage_logs', 'group_id', 'bigint'],
  ['usage_logs', 'model', 'character varying'],
  ['usage_logs', 'requested_model', 'character varying'],
  ['usage_logs', 'upstream_model', 'character varying'],
  ['usage_logs', 'input_tokens', 'integer'],
  ['usage_logs', 'output_tokens', 'integer'],
  ['usage_logs', 'cache_creation_tokens', 'integer'],
  ['usage_logs', 'cache_read_tokens', 'integer'],
  ['usage_logs', 'actual_cost', 'numeric'],
  ['usage_logs', 'created_at', 'timestamp with time zone'],
  ['accounts', 'id', 'bigint'],
  ['accounts', 'platform', 'character varying'],
  ['groups', 'id', 'bigint'],
  ['groups', 'platform', 'character varying'],
]

export interface FakeCall {
  text: string
  params?: unknown[]
}

/**
 * 假的连接池：记录每条 SQL；探测列时返回 columns，聚合查询时按 $2（回溯周数）调用 usage。
 * fail 可以让某一步抛出指定错误。
 */
export function fakePool(options: {
  columns?: [string, string, string][]
  usage?: (backWeeks: number, params: unknown[]) => Record<string, unknown>[]
  fail?: { on: 'connect' | 'probe' | 'usage'; error: unknown }
}) {
  const calls: FakeCall[] = []
  let ended = 0
  let released = 0
  const factory: PoolFactory = () => ({
    async connect() {
      if (options.fail?.on === 'connect') throw options.fail.error
      const client: QueryClient & { release(): void } = {
        async query(text: string, params?: unknown[]) {
          calls.push({ text, params })
          if (/information_schema/.test(text)) {
            if (options.fail?.on === 'probe') throw options.fail.error
            const columns = options.columns ?? SUB2API_COLUMNS
            return { rows: columns.map(([table_name, column_name, data_type]) => ({ table_name, column_name, data_type })) as never[] }
          }
          if (/FROM usage_logs/.test(text)) {
            if (options.fail?.on === 'usage') throw options.fail.error
            return { rows: (options.usage?.(Number(params?.[1]), params ?? []) ?? []) as never[] }
          }
          return { rows: [] }
        },
        release() {
          released += 1
        },
      }
      return client
    },
    async end() {
      ended += 1
    },
  })
  return {
    factory,
    calls,
    get ended() {
      return ended
    },
    get released() {
      return released
    },
  }
}

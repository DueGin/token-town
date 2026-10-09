import { useCallback, useEffect, useState } from 'react'

export type TownTheme = 'night' | 'day'

const PREFIX = 'token-town:pref:'

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(PREFIX + key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

/** 持久化到 localStorage 的枚举偏好（景深、时钟模式），读取失败时回落默认值。 */
export function usePreference<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => readPreference(key, allowed, fallback))
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(PREFIX + key, next)
      } catch {
        // 无法持久化时只在当前会话生效
      }
    },
    [key],
  )
  return [value, update] as const
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** 持久化到 localStorage 的任意值：parse 返回 undefined 表示存储的值无效，回落默认值。 */
export function useStoredValue<T>(key: string, parse: (raw: string) => T | undefined, serialize: (value: T) => string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key)
      return raw === null ? fallback : (parse(raw) ?? fallback)
    } catch {
      return fallback
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(PREFIX + key, serialize(next))
      } catch {
        // 无法持久化时只在当前会话生效
      }
    },
    [key, serialize],
  )
  return [value, update] as const
}

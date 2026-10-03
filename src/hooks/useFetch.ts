import { useEffect, useState } from 'react'

interface FetchState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
}

/** Runs `fn` whenever `key` changes; aborts stale requests and keeps previous data while loading. */
export function useFetch<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: undefined, error: undefined, loading: key != null })

  useEffect(() => {
    if (key == null) return
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: undefined }))
    fn(ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setState({ data, error: undefined, loading: false }),
      (error) => !ctrl.signal.aborted && setState((s) => ({ ...s, error, loading: false })),
    )
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Re-renders every `ms` while the page is visible. */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

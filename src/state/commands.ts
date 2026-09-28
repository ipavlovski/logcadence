import { useEffect, useRef } from 'react'

// Pane-local commands (e.g. "archive selection" in the active tag view): the mounted view
// registers a handler, the global shortcut handler runs it.

type Handler = () => void
const handlers = new Map<string, Handler[]>()

/** Runs the most recently registered handler; returns whether one existed. */
export function runCommand(name: string): boolean {
  const list = handlers.get(name)
  const fn = list?.[list.length - 1]
  fn?.()
  return !!fn
}

export function useCommand(name: string, fn: Handler, enabled = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const h: Handler = () => ref.current()
    handlers.set(name, [...(handlers.get(name) ?? []), h])
    return () => {
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter((x) => x !== h),
      )
    }
  }, [name, enabled])
}

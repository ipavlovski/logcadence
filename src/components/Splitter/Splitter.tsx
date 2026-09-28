import type { PointerEvent } from 'react'
import { panesStore, setWeights, type PaneId } from '../../state/panes.ts'
import styles from './Splitter.module.css'

const MIN_WIDTH = 240

/** Drag handle between two panes; converts the pixel delta into flex weights. */
export function Splitter({ left, right }: { left: PaneId; right: PaneId }) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget
    const l = handle.previousElementSibling as HTMLElement | null
    const r = handle.nextElementSibling as HTMLElement | null
    if (!l || !r) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const lw = l.getBoundingClientRect().width
    const rw = r.getBoundingClientRect().width
    const { weights } = panesStore.get()
    const total = weights[left] + weights[right]

    const move = (ev: globalThis.PointerEvent) => {
      const nl = Math.min(Math.max(lw + ev.clientX - startX, MIN_WIDTH), lw + rw - MIN_WIDTH)
      setWeights({ [left]: (total * nl) / (lw + rw), [right]: (total * (lw + rw - nl)) / (lw + rw) })
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
  }

  return <div className={styles.splitter} onPointerDown={onPointerDown} role="separator" aria-orientation="vertical" />
}

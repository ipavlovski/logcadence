import type { PointerEvent } from 'react'
import { panesStore, setPaneOpen, type PaneId } from '../../state/panes.ts'
import styles from './Splitter.module.css'

/** Dragging the tags pane narrower than this minimizes it to its tab bar; dragging past it restores it. */
const COLLAPSE_BELOW = 120
/** Narrowest the open tags pane gets: between this and COLLAPSE_BELOW the pane holds, then snaps shut. */
const SIDE_MIN = 200
const CANVAS_MIN = 240

/**
 * Drag handle between the canvas and the tags pane; converts the pixel width into flex weights
 * (px / canvas px per weight).
 */
export function Splitter({ left, right }: { left: PaneId; right: PaneId }) {
  const side = left === 'canvas' ? right : left
  const sideIsLeft = side === left

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
    const pair = lw + rw
    const { weights } = panesStore.get()
    const perWeight = (sideIsLeft ? rw : lw) / weights.canvas
    const bar = parseFloat(getComputedStyle(handle).getPropertyValue('--tabbar-h')) || 36
    // Width to come back to when the minimized pane is reopened by clicking its tab bar.
    const restoreWeight = weights[side]

    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - startX
      const want = sideIsLeft ? lw + dx : rw - dx
      if (want < COLLAPSE_BELOW) {
        setPaneOpen(side, false, { [side]: restoreWeight, canvas: (pair - bar) / perWeight })
        return
      }
      const w = Math.min(Math.max(want, SIDE_MIN), pair - CANVAS_MIN)
      setPaneOpen(side, true, { [side]: w / perWeight, canvas: (pair - w) / perWeight })
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

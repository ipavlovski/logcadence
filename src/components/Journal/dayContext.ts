import { createContext, useContext } from 'react'
import type { NodeDTO } from '../../../shared/types.ts'
import type { DayActions } from './useDay.ts'

export type FocusRequest = { kind: 'title'; entryId: string; caret: 'start' | 'end' } | { kind: 'node'; nodeId: string; caret: 'start' | 'end' | number }

/** Where the caret should go; `n` makes repeated requests for the same spot distinct. */
export type FocusTarget = FocusRequest & { n: number }

export interface DayApi extends DayActions {
  date: string
  focusTo(t: FocusRequest | null): void
  /** Editor lost focus: stop editing that node. */
  blurNode(nodeId: string): void
  /** Moves the caret to the previous/next title or node, in display order. */
  navigate(from: { entryId: string; nodeId?: string }, dir: -1 | 1): void
  /** Enter inside a node. */
  split(node: NodeDTO, before: string, after: string): void
  /** Backspace at the very start of a node; returns true if the node was consumed (merged/deleted). */
  backspaceAtStart(node: NodeDTO, draft: string): boolean
  /** Remember this entry as the journal cursor (for tag inheritance). */
  touch(entryId: string): void
  /** Folds or unfolds one entry (Shift+click on its title). */
  toggleFold(entryId: string): void
}

export const DayContext = createContext<DayApi | null>(null)

export function useDayApi(): DayApi {
  const ctx = useContext(DayContext)
  if (!ctx) throw new Error('useDayApi outside a journal day')
  return ctx
}

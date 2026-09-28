import { createStore } from '../../state/store.ts'

// Pending tag operation; the dialog for it is rendered once at the app root.

export type TagOp = { op: 'rename' | 'merge' | 'delete'; tag: string } | { op: 'branch'; tag: string; entryIds: string[] }

export const tagOpStore = createStore<TagOp | null>(null)

export const startTagOp = (op: TagOp | null) => tagOpStore.set(() => op)

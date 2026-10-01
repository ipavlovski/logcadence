import { CHAT_SOURCES, type ChatSource } from '../../shared/types.ts'
import { requestReveal } from './journal.ts'
import { openDate, openLoc, pluginKey } from './panes.ts'
import { persistedStore } from './store.ts'

// AI canvas tab: which chat is open (null = the chat list), the list's source filter, and a
// prompt of the open chat to scroll to.

interface AiState {
  chatId: string | null
  source: ChatSource | null
  /** Index of the prompt to reveal; cleared once the transcript has scrolled to it. */
  turn: number | null
}

export const AI_PLUGIN = 'ai-prompts'

export const aiStore = persistedStore<AiState>('ai.v1', { chatId: null, source: null, turn: null }, (s) => {
  const o = (s ?? {}) as Partial<AiState>
  return {
    chatId: typeof o.chatId === 'string' ? o.chatId : null,
    source: CHAT_SOURCES.includes(o.source as ChatSource) ? (o.source as ChatSource) : null,
    turn: null,
  }
})

export const SOURCE_LABEL: Record<ChatSource, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
}

/** Shows a chat's transcript in the canvas AI tab, scrolled to prompt `turn` when given. */
export function openChat(chatId: string | null, opts: { newTab?: boolean; turn?: number } = {}) {
  aiStore.set((s) => ({ ...s, chatId, turn: opts.turn ?? null }))
  openLoc('canvas', pluginKey(AI_PLUGIN), { newTab: opts.newTab })
}

export function clearChatTurn() {
  aiStore.set((s) => (s.turn === null ? s : { ...s, turn: null }))
}

export function setChatSource(source: ChatSource | null) {
  aiStore.set((s) => ({ ...s, source }))
}

/** Opens the chat's journal day and highlights its entry. */
export function revealChatEntry(chat: { date: string; entryId: string | null }, opts: { newTab?: boolean } = {}) {
  if (!chat.entryId) return
  openDate(chat.date, opts)
  requestReveal({ date: chat.date, entryId: chat.entryId, mode: 'flash' })
}

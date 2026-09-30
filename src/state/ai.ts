import { CHAT_SOURCES, type ChatSource } from '../../shared/types.ts'
import { requestReveal } from './journal.ts'
import { openDate, openLoc, pluginKey } from './panes.ts'
import { persistedStore } from './store.ts'

// AI canvas tab: which chat is open (null = the chat list) and the list's source filter.

interface AiState {
  chatId: string | null
  source: ChatSource | null
}

export const AI_PLUGIN = 'ai-prompts'

export const aiStore = persistedStore<AiState>('ai.v1', { chatId: null, source: null }, (s) => {
  const o = (s ?? {}) as Partial<AiState>
  return {
    chatId: typeof o.chatId === 'string' ? o.chatId : null,
    source: CHAT_SOURCES.includes(o.source as ChatSource) ? (o.source as ChatSource) : null,
  }
})

export const SOURCE_LABEL: Record<ChatSource, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
}

/** Shows a chat's transcript in the canvas AI tab. */
export function openChat(chatId: string | null, opts: { newTab?: boolean } = {}) {
  aiStore.set((s) => ({ ...s, chatId }))
  openLoc('canvas', pluginKey(AI_PLUGIN), opts)
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

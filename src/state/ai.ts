import { CHAT_SOURCES, type ChatSource } from '../../shared/types.ts'
import { showTypeView } from './panes.ts'
import { persistedStore } from './store.ts'

// The AI view (chats in the tags pane): which chat is open (null = the chat list), the list's source filter, and a
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

/** Shows a chat's transcript in the AI view, scrolled to prompt `turn` when given. */
export function openChat(chatId: string | null, opts: { turn?: number } = {}) {
  aiStore.set((s) => ({ ...s, chatId, turn: opts.turn ?? null }))
  showTypeView('ai')
}

export function clearChatTurn() {
  aiStore.set((s) => (s.turn === null ? s : { ...s, turn: null }))
}

export function setChatSource(source: ChatSource | null) {
  aiStore.set((s) => ({ ...s, source }))
}

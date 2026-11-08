import type { ComponentType, LazyExoticComponent } from 'react'
import type { EntryType } from '../../shared/entryTypes.ts'
import { AiChats } from '../components/AiChats/AiChats.tsx'
import { Board } from '../components/Board/Board.tsx'
import { Bookmarks } from '../components/Captures/Captures.tsx'
import { Youtube } from '../components/Youtube/Youtube.tsx'

// The views of the types that have one: mini-apps over a type's own data (the YouTube grid, the bookmarks grid, the
// image board, the chat list), shown in the tags pane for a query of that type (shared/query.ts typeView).

export interface TypeViewProps {
  /** Key of the tags pane tab showing it. */
  tabKey: string
}

export interface TypeViewDef {
  type: EntryType
  /** Its icon (canvas/icons.tsx) and its key for state kept per view. */
  icon: string
  title: string
  description: string
  Component: ComponentType<TypeViewProps> | LazyExoticComponent<ComponentType<TypeViewProps>>
}

export const TYPE_VIEWS: TypeViewDef[] = [
  { type: 'video', icon: 'youtube', title: 'YouTube', description: 'Videos imported from your playlists, by the day they were discovered, with notes and images.', Component: Youtube },
  {
    type: 'bookmark',
    icon: 'bookmarks',
    title: 'Bookmarks',
    description: 'Pages captured with the Chrome extension, with a screenshot, by day. Handlers add what’s special about some sites: whole Reddit posts with their comments, Marketplace listings with their price and seller.',
    Component: Bookmarks,
  },
  { type: 'media', icon: 'images', title: 'Media', description: 'A scratchpad board, like PureRef: paste images, gifs and videos under today, and drag them into rows.', Component: Board },
  { type: 'ai', icon: 'ai-prompts', title: 'AI', description: 'Chats imported from Claude, Claude Code, Gemini and Antigravity, with full transcripts.', Component: AiChats },
]

export const typeViewOf = (type: EntryType) => TYPE_VIEWS.find((v) => v.type === type)

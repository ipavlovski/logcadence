import type { ComponentType, LazyExoticComponent } from 'react'
import { AiChats } from '../components/AiChats/AiChats.tsx'
import { Board } from '../components/Board/Board.tsx'
import { Bookmarks } from '../components/Captures/Captures.tsx'
import { Youtube } from '../components/Youtube/Youtube.tsx'
import { syncCanvasPlugins } from '../state/canvasTabs.ts'

// Canvas tabs are rendered by plugins: mini-apps that read journal data and render their own view.
// This registry is the extension point; plugins without a Component show a placeholder.

export interface CanvasPluginProps {
  /** Tab key, for plugins that keep per-tab state. */
  tabKey: string
}

export interface CanvasPlugin {
  type: string
  title: string
  description: string
  /** Undefined until the plugin is built; the tab shows a placeholder. Heavy plugins load lazily. */
  Component?: ComponentType<CanvasPluginProps> | LazyExoticComponent<ComponentType<CanvasPluginProps>>
}

export const PLUGINS: CanvasPlugin[] = [
  { type: 'youtube', title: 'YouTube', description: 'Videos imported from your playlists, by the day they were discovered, with notes, images and tags of their own.', Component: Youtube },
  { type: 'bookmarks', title: 'Bookmarks', description: 'Pages captured with the Chrome extension, with a screenshot, by day, with notes and tags. Handlers add what’s special about some sites: whole Reddit posts with their comments, Marketplace listings with their price and seller.', Component: Bookmarks },
  { type: 'images', title: 'Images', description: 'A scratchpad board, like PureRef: paste images, gifs and videos under today, and drag them into rows.', Component: Board },
  { type: 'ai-prompts', title: 'AI', description: 'Chats imported from Claude, Claude Code, Gemini and Antigravity, with full transcripts.', Component: AiChats },
]

export const pluginByType = (type: string) => PLUGINS.find((p) => p.type === type)

syncCanvasPlugins(PLUGINS.map((p) => p.type))

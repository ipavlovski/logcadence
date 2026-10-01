import type { ComponentType } from 'react'
import { AiChats } from '../components/AiChats/AiChats.tsx'
import { Shortcuts } from '../components/Shortcuts/Shortcuts.tsx'
import { Threads } from '../components/Threads/Threads.tsx'

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
  /** Undefined until the plugin is built; the tab shows a placeholder. */
  Component?: ComponentType<CanvasPluginProps>
}

export const PLUGINS: CanvasPlugin[] = [
  { type: 'map', title: 'Map', description: 'Classify a day of GPX data into homebase/place movements with timestamps.' },
  { type: 'shortcuts', title: 'Shortcuts', description: 'An app’s hotkeys from its shortcuts:<app> entries on a keyboard; hold a modifier to see its layer, clashes flagged.', Component: Shortcuts },
  { type: 'spotify', title: 'Spotify', description: 'Playlists listened to today, track and like stats.' },
  { type: 'images', title: 'Images', description: 'Browse every image pasted into the journal.' },
  { type: 'threads', title: 'Threads', description: 'Project progress over time: one line per done:<project> tag, one circle per day.', Component: Threads },
  { type: 'ai-prompts', title: 'AI', description: 'Chats imported from Claude, Claude Code, Gemini and Antigravity, with full transcripts.', Component: AiChats },
]

export const pluginByType = (type: string) => PLUGINS.find((p) => p.type === type)

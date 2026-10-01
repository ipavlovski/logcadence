import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { AiChats } from '../components/AiChats/AiChats.tsx'
import { Shortcuts } from '../components/Shortcuts/Shortcuts.tsx'
import { Spotify } from '../components/Spotify/Spotify.tsx'
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
  /** Undefined until the plugin is built; the tab shows a placeholder. Heavy plugins load lazily. */
  Component?: ComponentType<CanvasPluginProps> | LazyExoticComponent<ComponentType<CanvasPluginProps>>
}

export const PLUGINS: CanvasPlugin[] = [
  {
    type: 'map',
    title: 'Map',
    description: 'A day of GPS as a timetable of stays and trips (home, places, A→B, B→B, B→A, round trips) on a map.',
    // MapLibre + deck.gl are large: load them only when the tab opens.
    Component: lazy(() => import('../components/Map/MapTab.tsx').then((m) => ({ default: m.MapTab }))),
  },
  { type: 'shortcuts', title: 'Shortcuts', description: 'An app’s hotkeys from its shortcuts:<app> entries on a keyboard; hold a modifier to see its layer, clashes flagged.', Component: Shortcuts },
  { type: 'spotify', title: 'Spotify', description: 'What is playing, every song played per day and its playlist, continue yesterday’s playlist, play and like heatmaps.', Component: Spotify },
  { type: 'images', title: 'Images', description: 'Browse every image pasted into the journal.' },
  { type: 'threads', title: 'Threads', description: 'Project progress over time: one line per done:<project> tag, one circle per day.', Component: Threads },
  { type: 'ai-prompts', title: 'AI', description: 'Chats imported from Claude, Claude Code, Gemini and Antigravity, with full transcripts.', Component: AiChats },
]

export const pluginByType = (type: string) => PLUGINS.find((p) => p.type === type)

import type { ComponentType } from 'react'

// Canvas tabs are rendered by plugins: mini-apps that read journal data and render their own view.
// None are implemented yet; this registry is the extension point.

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
  { type: 'shortcuts', title: 'Shortcuts', description: 'Visualize hotkeys from shortcuts: entries on a keyboard, flag clashes.' },
  { type: 'spotify', title: 'Spotify', description: 'Playlists listened to today, track and like stats.' },
  { type: 'images', title: 'Images', description: 'Browse every image pasted into the journal.' },
  { type: 'threads', title: 'Threads', description: 'Vertical project timelines with heatmaps.' },
  { type: 'ai-prompts', title: 'AI prompts', description: "Today's searches and AI prompts." },
]

export const pluginByType = (type: string) => PLUGINS.find((p) => p.type === type)

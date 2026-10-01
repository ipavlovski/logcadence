import { Suspense } from 'react'
import { pluginByType, PLUGINS } from '../../canvas/plugins.ts'
import { openLoc, pluginKey } from '../../state/panes.ts'
import styles from './Canvas.module.css'

/** Canvas primary tab. The real dashboard (heatmap, calendar, tasks, sticky notes) comes later. */
export function CanvasDashboard() {
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Dashboard</h2>
        <p>The canvas hosts mini-apps rendered by plugins. None are built yet — this is the frame they will live in.</p>
      </header>
      <div className={styles.grid}>
        {PLUGINS.map((p) => (
          <button key={p.type} className={styles.tile} onClick={(e) => openLoc('canvas', pluginKey(p.type), { newTab: e.ctrlKey || e.metaKey })}>
            <strong>{p.title}</strong>
            <span>{p.description}</span>
          </button>
        ))}
      </div>
      <footer className={styles.data}>
        <h3>Data</h3>
        <p>An export holds the whole library (entries, chats, Spotify and GPS history, media) and can be imported into an empty library, e.g. the desktop app.</p>
        <a href="/api/export" download>
          Export everything
        </a>
        <a href="/api/export?assets=0&gps=0" download>
          Export without media and GPS files
        </a>
      </footer>
    </div>
  )
}

export function CanvasPluginTab({ type, tabKey }: { type: string; tabKey: string }) {
  const plugin = pluginByType(type)
  if (plugin?.Component)
    return (
      <Suspense fallback={<div className={styles.frame} />}>
        <plugin.Component tabKey={tabKey} />
      </Suspense>
    )
  return (
    <div className={styles.frame}>
      <div className={styles.placeholder}>
        <h2>{plugin?.title ?? type}</h2>
        <p>{plugin ? plugin.description : 'Unknown plugin.'}</p>
        <p className={styles.soon}>Not implemented yet.</p>
      </div>
    </div>
  )
}

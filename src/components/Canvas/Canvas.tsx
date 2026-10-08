import { Suspense } from 'react'
import { pluginByType } from '../../canvas/plugins.ts'
import { Dashboard } from '../Dashboard/Dashboard.tsx'
import styles from './Canvas.module.css'

/** Canvas primary tab: today's report. */
export function CanvasDashboard() {
  return <Dashboard />
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

import { useEffect, type ReactNode } from 'react'
import styles from './Modal.module.css'

interface Props {
  title?: string
  onClose: () => void
  children: ReactNode
  /** Spotlight-style: pinned near the top, wider. */
  spotlight?: boolean
}

export function Modal({ title, onClose, children, spotlight }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className={`${styles.scrim} ${spotlight ? styles.top : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${spotlight ? styles.wide : ''}`} role="dialog" aria-label={title}>
        {title && <h2 className={styles.title}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>
}

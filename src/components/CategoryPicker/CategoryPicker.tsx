import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { categoryLabel, categoryStyle, useCategories } from '../../state/categories.ts'
import styles from './CategoryPicker.module.css'

interface Props {
  value: string | null
  onChange: (category: string | null) => void
  className?: string
}

/**
 * The entry's category, as a short label (six characters wide, so titles line up). A click opens the list to pick
 * another, or none; arrow keys move through it, Enter picks, Escape closes.
 */
export function CategoryPicker({ value, onChange, className }: Props) {
  const list = useCategories()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLButtonElement>(null)
  // A category that isn't listed (yet) still shows as chosen.
  const names = value && !list.some((c) => c.name === value) ? [...list.map((c) => c.name), value] : list.map((c) => c.name)
  const options: (string | null)[] = [...names, null]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    // Focus the current choice, so the arrow keys start from it.
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    chip.current?.focus()
  }
  const pick = (name: string | null) => {
    if (name !== value) onChange(name)
    close()
  }
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') close()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div ref={root} className={`${styles.root} ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        ref={chip}
        type="button"
        className={`${styles.chip} ${value ? '' : styles.none}`}
        style={categoryStyle(value)}
        title={value ? `Category: ${categoryLabel(value)} (click to change)` : 'No category (click to pick one)'}
        aria-label={value ? `Category: ${categoryLabel(value)}` : 'No category'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'ArrowDown' && (e.preventDefault(), setOpen(true))}
      >
        {value ? categoryLabel(value) : '—'}
      </button>
      {open && (
        <div className={styles.menu} role="listbox" aria-label="Category" onKeyDown={onMenuKey}>
          {options.map((name) => (
            <button
              key={name ?? ''}
              type="button"
              role="option"
              aria-selected={name === value}
              className={`${styles.option} ${name === value ? styles.current : ''} ${name ? '' : styles.noneOption}`}
              style={categoryStyle(name)}
              onClick={() => pick(name)}
            >
              {name ? categoryLabel(name) : 'No category'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

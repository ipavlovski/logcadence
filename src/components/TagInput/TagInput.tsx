import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { allTagPaths, normalizeTag } from '../../../shared/tags.ts'
import { openTag } from '../../state/panes.ts'
import { useAllTags } from '../../state/tags.ts'
import { rankTags } from '../../tagSearch.ts'
import styles from './TagInput.module.css'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  autoFocus?: boolean
  /** Only one tag (tag pickers in dialogs). */
  single?: boolean
  onSubmit?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  className?: string
  /** Primary tag that cannot be removed or demoted (the source tag of an imported AI chat). */
  locked?: string
  /** Tag paths to suggest, for a tag set other than the journal's (the YouTube tab's). */
  paths?: string[]
  /** What a chip click does; by default it opens the tag in the tags pane. */
  onOpen?: (tag: string, opts: { newTab: boolean }) => void
}

/** Tag chips + an input with autocomplete. The first chip is the primary tag. */
export function TagInput({ value, onChange: setTags, placeholder = 'add tag…', autoFocus, single, onSubmit, onKeyDown, onFocus, className, locked, paths: ownPaths, onOpen = openTag }: Props) {
  const onChange = (tags: string[]) => setTags(locked ? [locked, ...tags.filter((t) => t !== locked)] : tags)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  // Highlighted suggestion; -1 = none (Enter takes the typed text).
  const [sel, setSel] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const all = useAllTags()
  const journalPaths = useMemo(() => allTagPaths(all), [all])
  const paths = ownPaths ?? journalPaths
  const suggestions = useMemo(
    () =>
      open
        ? rankTags(
            paths.filter((p) => !value.includes(p)),
            text,
            8,
          )
        : [],
    [open, paths, value, text],
  )

  const add = (raw: string) => {
    const t = normalizeTag(raw)
    setText('')
    setSel(-1)
    if (!t) return
    if (single) onChange([t])
    else if (!value.includes(t)) onChange([...value, t])
  }
  const remove = (t: string) => onChange(value.filter((x) => x !== t))
  const makePrimary = (t: string) => onChange([t, ...value.filter((x) => x !== t)])

  const chipTitle = (t: string, i: number) => {
    if (single) return t
    if (t === locked) return 'Source of the imported chat · locked · click to open'
    if (i === 0) return 'Primary tag · click to open'
    return locked ? 'Click to open' : 'Click to open · ★ makes it primary'
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const pick = suggestions[sel]
    const top = suggestions[Math.max(sel, 0)]
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setSel((s) => (s + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setSel((s) => (s <= 0 ? suggestions.length : s) - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (pick) add(pick)
      else if (text.trim()) add(text)
      else onSubmit?.()
    } else if ((e.key === 'Tab' && text.trim()) || e.key === ',') {
      e.preventDefault()
      add(e.key === 'Tab' && top ? top : text)
    } else if (e.key === 'Backspace' && !text && value.length && value.at(-1) !== locked) {
      remove(value[value.length - 1]!)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} onClick={() => inputRef.current?.focus()}>
      {value.map((t, i) => (
        <span key={t} className={`${styles.chip} ${i === 0 && !single ? styles.primary : ''} ${t === locked ? styles.locked : ''}`}>
          <button
            className={styles.chipLabel}
            title={chipTitle(t, i)}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(t, { newTab: e.ctrlKey || e.metaKey })
            }}
          >
            #{t}
          </button>
          {i > 0 && !locked && (
            <button className={styles.chipBtn} title="Make primary" onClick={(e) => (e.stopPropagation(), makePrimary(t))}>
              ★
            </button>
          )}
          {t !== locked && (
            <button className={styles.chipBtn} title="Remove" onClick={(e) => (e.stopPropagation(), remove(t))}>
              ×
            </button>
          )}
        </span>
      ))}
      {(!single || !value.length) && (
        <span className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            value={text}
            placeholder={value.length && !single ? '' : placeholder}
            autoFocus={autoFocus}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value)
              setSel(-1)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              onFocus?.()
            }}
            onBlur={() => {
              setOpen(false)
              if (text.trim()) add(text)
            }}
            onKeyDown={keyDown}
          />
          {suggestions.length > 0 && (text || single) && (
            <ul className={styles.suggest} role="listbox">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button
                    className={`${styles.option} ${i === sel ? styles.selected : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      add(s)
                    }}
                    onMouseEnter={() => setSel(i)}
                  >
                    #{s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </div>
  )
}

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { allTagPaths, normalizeTag, TAG_SEP } from '../../../shared/tags.ts'
import { openTag } from '../../state/panes.ts'
import { useAllTags } from '../../state/tags.ts'
import { suggestTags, tagQuery, type TagSuggestion } from '../../tagSearch.ts'
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
  /** Tag paths to suggest, for a tag set other than the journal's (the YouTube tab's). */
  paths?: string[]
  /** What a chip click does; by default it opens the tag in the tags pane. */
  onOpen?: (tag: string, opts: { newTab: boolean }) => void
}

/** Tag chips + an input with autocomplete, a level at a time: Tab (or → at the end) completes the next segment of the
 *  path, Enter adds the tag. The first chip is the primary tag. */
export function TagInput({ value, onChange, placeholder = 'add tag…', autoFocus, single, onSubmit, onKeyDown, onFocus, className, paths: ownPaths, onOpen = openTag }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  // Highlighted suggestion; -1 = none (Enter takes the typed text).
  const [sel, setSel] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const all = useAllTags()
  const journalPaths = useMemo(() => allTagPaths(all), [all])
  const paths = ownPaths ?? journalPaths
  const suggestions = useMemo(() => (open ? suggestTags(paths, text, value, 8) : []), [open, paths, value, text])
  const top = suggestions[Math.max(sel, 0)]
  // The text Tab completes to: the suggestion's path, and the separator when there's a level below it.
  const completion = (s: TagSuggestion) => s.path + (s.branch ? TAG_SEP : '')
  const query = tagQuery(text)
  // The rest of the top suggestion, shown faint after the caret (when the typed text lines up with it as is).
  const ghost = top && query && query === text && completion(top).startsWith(query) ? completion(top).slice(query.length) : ''

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
    if (i === 0) return 'Primary tag · click to open'
    return 'Click to open · ★ makes it primary'
  }

  const complete = (s: TagSuggestion) => {
    setText(completion(s))
    setSel(-1)
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const pick = suggestions[sel]
    const atEnd = e.currentTarget.selectionStart === text.length
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setSel((s) => (s + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setSel((s) => (s <= 0 ? suggestions.length : s) - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (pick) add(pick.path)
      else if (text.trim()) add(text)
      else onSubmit?.()
    } else if (e.key === 'Tab' && text.trim()) {
      // Completes a level; with nothing left to complete, adds what's typed.
      e.preventDefault()
      if (top && completion(top) !== query) complete(top)
      else add(text)
    } else if (e.key === 'ArrowRight' && ghost && atEnd) {
      e.preventDefault()
      complete(top!)
    } else if (e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]!)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} onClick={() => inputRef.current?.focus()}>
      {value.map((t, i) => (
        <span key={t} className={`${styles.chip} ${i === 0 && !single ? styles.primary : ''}`}>
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
          {i > 0 && (
            <button className={styles.chipBtn} title="Make primary" onClick={(e) => (e.stopPropagation(), makePrimary(t))}>
              ★
            </button>
          )}
          <button className={styles.chipBtn} title="Remove" onClick={(e) => (e.stopPropagation(), remove(t))}>
            ×
          </button>
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
          {ghost && (
            <span className={styles.ghost} aria-hidden>
              <span className={styles.typed}>{text}</span>
              {ghost}
            </span>
          )}
          {suggestions.length > 0 && (text || single) && (
            <ul className={styles.suggest} role="listbox">
              {suggestions.map((s, i) => (
                <li key={s.path}>
                  <button
                    className={`${styles.option} ${i === sel ? styles.selected : ''}`}
                    title={s.branch ? 'Click to add · Tab goes a level in' : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      add(s.path)
                    }}
                    onMouseEnter={() => setSel(i)}
                  >
                    <OptionLabel s={s} />
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

/** A suggestion: its parent path faint, then its own name, and a faint separator when it has a level below. */
function OptionLabel({ s }: { s: TagSuggestion }) {
  const cut = s.path.lastIndexOf(TAG_SEP) + 1
  return (
    <>
      <span className={styles.faint}>#{s.path.slice(0, cut)}</span>
      {s.path.slice(cut)}
      {s.branch && <span className={styles.faint}>{TAG_SEP}</span>}
    </>
  )
}

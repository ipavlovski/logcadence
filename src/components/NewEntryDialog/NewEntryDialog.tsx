import { useState } from 'react'
import { isIsoDate } from '../../../shared/dates.ts'
import { createEntry } from '../../actions.ts'
import { useStore } from '../../state/store.ts'
import { openNewEntry, uiStore, type NewEntryDefaults } from '../../state/ui.ts'
import { AutoTextarea } from '../AutoTextarea/AutoTextarea.tsx'
import { Modal, ModalActions } from '../Modal/Modal.tsx'
import { TagInput } from '../TagInput/TagInput.tsx'
import styles from './NewEntryDialog.module.css'

export function NewEntryDialog() {
  const defaults = useStore(uiStore, (s) => s.newEntry)
  return defaults ? <Dialog defaults={defaults} /> : null
}

/** Ctrl+Shift+N: new entry with date, title, tags (pre-filled from the cursor) and first note. */
function Dialog({ defaults }: { defaults: NewEntryDefaults }) {
  const [date, setDate] = useState(defaults.date)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState(defaults.tags)
  const [content, setContent] = useState('')
  const close = () => openNewEntry(null)

  const submit = () => {
    if (!isIsoDate(date)) return
    close()
    void createEntry({
      date,
      tags,
      title: title.trim(),
      content,
      afterEntryId: date === defaults.date ? defaults.afterEntryId : undefined,
      focus: 'node',
    })
  }

  return (
    <Modal title="New entry" onClose={close}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <label>
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          <span>Title</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="What is this about?" />
        </label>
        <div className={styles.field}>
          <span>Tags</span>
          <div className={styles.box}>
            <TagInput value={tags} onChange={setTags} placeholder="first tag is primary…" />
          </div>
        </div>
        <label>
          <span>Note</span>
          <AutoTextarea className={styles.note} value={content} onChange={(e) => setContent(e.target.value)} placeholder="optional" />
        </label>
        <ModalActions>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" data-primary>
            Create <kbd>Ctrl+Enter</kbd>
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

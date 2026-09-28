import { useState } from 'react'
import { isUnder, normalizeTag } from '../../../shared/tags.ts'
import { api, unwrap } from '../../api.ts'
import { emitChange } from '../../state/bus.ts'
import { closeTagTabs, renameTagTabs } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { useAllTags } from '../../state/tags.ts'
import { Modal, ModalActions } from '../Modal/Modal.tsx'
import { TagInput } from '../TagInput/TagInput.tsx'
import { startTagOp, tagOpStore, type TagOp } from './tagOps.ts'
import styles from './Tags.module.css'

export function TagOpDialog() {
  const op = useStore(tagOpStore, (s) => s)
  if (!op) return null
  return <Dialog key={`${op.op}:${op.tag}`} op={op} />
}

const TITLES = { rename: 'Rename tag', merge: 'Merge tag', branch: 'Branch into sub-tag', delete: 'Delete tag' }

function Dialog({ op }: { op: TagOp }) {
  const all = useAllTags()
  const [text, setText] = useState(op.op === 'branch' ? `${op.tag}:` : op.op === 'rename' ? op.tag : '')
  const [target, setTarget] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const close = () => startTagOp(null)
  const branchCount = op.op === 'branch' ? op.entryIds.length : 0

  const to = op.op === 'merge' ? (target[0] ?? '') : normalizeTag(text)
  const exists = all.some((t) => t.path === to)
  const invalid = op.op !== 'delete' && (!to || to === op.tag || (op.op !== 'branch' && isUnder(to, op.tag) && to !== op.tag) || (op.op === 'merge' && !exists))

  const submit = async () => {
    if (invalid || busy) return
    setBusy(true)
    try {
      if (op.op === 'delete') {
        await unwrap(api.tags.delete.$post({ json: { tag: op.tag } }))
        closeTagTabs(op.tag)
      } else if (op.op === 'branch') {
        await unwrap(api.tags.branch.$post({ json: { from: op.tag, to, entryIds: op.entryIds } }))
      } else {
        await unwrap((op.op === 'merge' ? api.tags.merge : api.tags.rename).$post({ json: { from: op.tag, to } }))
        renameTagTabs(op.tag, to)
      }
      emitChange()
      close()
    } catch (err) {
      notify((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={TITLES[op.op]} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {op.op === 'delete' && (
          <p className={styles.dialogText}>
            Remove <b>#{op.tag}</b> and all its sub-tags from every entry? The entries themselves are kept.
          </p>
        )}
        {(op.op === 'rename' || op.op === 'branch') && (
          <>
            <p className={styles.dialogText}>
              {op.op === 'rename' ? (
                <>
                  New path for <b>#{op.tag}</b> (sub-tags move along).
                </>
              ) : (
                <>
                  Move {branchCount} selected {branchCount === 1 ? 'entry' : 'entries'} from <b>#{op.tag}</b> to:
                </>
              )}
            </p>
            <input className={styles.dialogInput} value={text} autoFocus spellCheck={false} onChange={(e) => setText(e.target.value)} />
            {to && exists && to !== op.tag && op.op === 'rename' && <p className={styles.hint}>#{to} already exists — the tags will be merged.</p>}
          </>
        )}
        {op.op === 'merge' && (
          <>
            <p className={styles.dialogText}>
              Merge <b>#{op.tag}</b> (and its sub-tags) into:
            </p>
            <div className={styles.dialogInput}>
              <TagInput value={target} onChange={setTarget} single autoFocus placeholder="target tag…" onSubmit={() => void submit()} />
            </div>
          </>
        )}
        <ModalActions>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={invalid || busy} data-primary={op.op !== 'delete' || undefined} data-danger={op.op === 'delete' || undefined}>
            {op.op === 'delete' ? 'Delete' : TITLES[op.op].split(' ')[0]}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

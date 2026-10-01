import type React from 'react'
import { Modal, ModalActions } from 'logcadence'

// Modal's scrim is position: fixed; the transform makes this frame its containing block so the
// open dialog renders inside the card on the app surface.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', transform: 'translateZ(0)', width: 600, height: 300, background: 'var(--bg)', color: 'var(--text)', borderRadius: 8, overflow: 'hidden' }}>
    {children}
  </div>
)

const input = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '6px 8px',
  outline: 'none',
}

export const Confirm = () => (
  <Frame>
    <Modal title="Delete tag" onClose={() => {}}>
      <p style={{ margin: 0 }}>
        Remove <b>#travel/2019</b> and all its sub-tags from every entry? The entries themselves are kept.
      </p>
      <ModalActions>
        <button type="button">Cancel</button>
        <button type="button" data-danger>
          Delete
        </button>
      </ModalActions>
    </Modal>
  </Frame>
)

export const Form = () => (
  <Frame>
    <Modal title="Rename tag" onClose={() => {}}>
      <p style={{ margin: '0 0 8px' }}>
        New path for <b>#reading</b> (sub-tags move along).
      </p>
      <input style={input} defaultValue="media/books" spellCheck={false} />
      <ModalActions>
        <button type="button">Cancel</button>
        <button type="button" data-primary>
          Rename
        </button>
      </ModalActions>
    </Modal>
  </Frame>
)

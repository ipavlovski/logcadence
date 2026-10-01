import type React from 'react'
import { ModalActions } from 'logcadence'

// ModalActions sits at the bottom of a Modal dialog; shown here on the dialog surface.
const Dialog = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', width: 420 }}>
    {children}
  </div>
)

export const CreateCancel = () => (
  <Dialog>
    <ModalActions>
      <button type="button">Cancel</button>
      <button type="submit" data-primary>
        Create
      </button>
    </ModalActions>
  </Dialog>
)

export const Destructive = () => (
  <Dialog>
    <ModalActions>
      <button type="button">Cancel</button>
      <button type="button" data-danger>
        Delete
      </button>
    </ModalActions>
  </Dialog>
)

export const Disabled = () => (
  <Dialog>
    <ModalActions>
      <button type="button">Cancel</button>
      <button type="submit" data-primary disabled>
        Merge
      </button>
    </ModalActions>
  </Dialog>
)

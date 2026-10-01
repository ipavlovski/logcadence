---
category: Modal
---
# Modal

A dialog over a dimmed full-screen scrim (`position: fixed`, centered). Escape or a click on the scrim calls `onClose`. `title` renders as the heading. `spotlight` pins it near the top and makes it wider (640px) with no padding, for command-palette-style content.

Put the action buttons in `ModalActions` as the last child: it right-aligns them and styles plain `<button>`s; mark the main action with `data-primary`, a destructive one with `data-danger`.

```tsx
{open && (
  <Modal title="Delete tag" onClose={() => setOpen(false)}>
    <p style={{ margin: 0 }}>Remove <b>#travel/2019</b> from every entry?</p>
    <ModalActions>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      <button type="button" data-danger onClick={remove}>Delete</button>
    </ModalActions>
  </Modal>
)}
```

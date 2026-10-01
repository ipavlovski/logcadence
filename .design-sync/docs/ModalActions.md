---
category: Modal
---
# ModalActions

Right-aligned button row for the bottom of a `Modal`. It styles the plain `<button>` elements placed inside it (surface background, border, token radius): add `data-primary` for the accent-filled main action, `data-danger` for a destructive one; `disabled` dims a button.

```tsx
<ModalActions>
  <button type="button" onClick={close}>Cancel</button>
  <button type="submit" data-primary>Create</button>
</ModalActions>
```

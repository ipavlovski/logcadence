---
category: Media
---
# ImageGallery

Large preview of the active image plus a thumbnail strip (shown when there are 2+ images). The first image is the node's thumbnail and gets a "thumb" badge. Clicking the large image opens a full-screen lightbox (Escape closes it).

- `images`: `{ id, url, mime }[]`.
- `activeId`: id of the image shown large (falls back to the first).
- `onActivate(id)`: thumbnail clicked / arrow keys.
- `onDelete(id)`: shows a × button on the large image and enables Delete/Backspace.
- `onReorder(ids)`: enables drag-a-thumbnail-onto-another to swap them.
- `compact`: smaller variant for dense lists.

Renders nothing when `images` is empty.

```tsx
<ImageGallery images={images} activeId={active} onActivate={setActive} onDelete={remove} />
```

// design-sync entry: the presentational components synced to Claude Design.
// The app has no library build, so this file is the "dist entry" the converter bundles.
import './fonts.css'
import '../src/styles/global.css'
export { AutoTextarea } from '../src/components/AutoTextarea/AutoTextarea.tsx'
export { Heatmap } from '../src/components/Heatmap/Heatmap.tsx'
export { ImageGallery } from '../src/components/ImageGallery/ImageGallery.tsx'
export { CodeBlock, InlineText, Markdown } from '../src/components/Markdown/Markdown.tsx'
export { Modal, ModalActions } from '../src/components/Modal/Modal.tsx'
export { TagChip } from '../src/components/TagChip/TagChip.tsx'
export { TagInput } from '../src/components/TagInput/TagInput.tsx'

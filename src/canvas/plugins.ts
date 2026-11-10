import type { ComponentType, LazyExoticComponent } from 'react'
import type { EntryType } from '../../shared/entryTypes.ts'
import { Board } from '../components/Board/Board.tsx'
import { Bookmarks } from '../components/Captures/Captures.tsx'

// The views of the types that have one: mini-apps over a type's own data (the bookmarks grid, the image board), shown
// in the tags pane for a query of that type (shared/query.ts typeView).

export interface TypeViewProps {
  /** Key of the tags pane tab showing it. */
  tabKey: string
}

export interface TypeViewDef {
  type: EntryType
  /** Its icon (canvas/icons.tsx) and its key for state kept per view. */
  icon: string
  title: string
  description: string
  Component: ComponentType<TypeViewProps> | LazyExoticComponent<ComponentType<TypeViewProps>>
}

export const TYPE_VIEWS: TypeViewDef[] = [
  {
    type: 'bookmark',
    icon: 'bookmarks',
    title: 'Bookmarks',
    description: 'Pages captured with the Chrome extension, with a screenshot, by day. Handlers add what’s special about some sites: whole Reddit posts with their comments, Marketplace listings with their price and seller.',
    Component: Bookmarks,
  },
  { type: 'media', icon: 'images', title: 'Media', description: 'A scratchpad board, like PureRef: paste images, gifs and videos under today, and drag them into rows.', Component: Board },
]

export const typeViewOf = (type: EntryType) => TYPE_VIEWS.find((v) => v.type === type)

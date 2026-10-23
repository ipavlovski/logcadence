import type { ReactNode } from 'react'

// Line icons for the canvas tab bar, one per plugin: 24-unit grid, drawn in currentColor.

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const ICONS: Record<string, ReactNode> = {
  youtube: (
    <Icon>
      <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
      <path d="m10 9 5 3-5 3z" />
    </Icon>
  ),
  reddit: (
    <Icon>
      <path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5a10 10 0 0 1-3.9-.8L4 19.5l1.2-3.5a5.6 5.6 0 0 1-1.7-3.5c0-3.6 3.8-6.5 8.5-6.5s8.5 2.9 8.5 6.5z" />
      <path d="M9 11.5h.01M15 11.5h.01M9.5 14.5c1.5 1 3.5 1 5 0" />
    </Icon>
  ),
  bookmarks: (
    <Icon>
      <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />
    </Icon>
  ),
  images: (
    <Icon>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-4.5-4.5L8 19.5" />
    </Icon>
  ),
  'ai-prompts': (
    <Icon>
      <path d="M12 3.5c.6 4.3 2.5 6.2 6.8 6.8-4.3.6-6.2 2.5-6.8 6.8-.6-4.3-2.5-6.2-6.8-6.8 4.3-.6 6.2-2.5 6.8-6.8z" />
      <path d="M18.5 16.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" />
    </Icon>
  ),
}

/** The canvas following the journal's day (ctrl+l): a chain, linked or broken. */
export const LINK_ICON = (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
)

export const UNLINK_ICON = (
  <Icon>
    <path d="M15.7 14l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M8.3 10l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    <path d="M4 4l3 3M20 20l-3-3" />
  </Icon>
)

/** A plugin without its own icon. */
export const FALLBACK_ICON = (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </Icon>
)

export const pluginIcon = (type: string): ReactNode => ICONS[type] ?? FALLBACK_ICON

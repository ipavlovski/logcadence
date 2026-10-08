import type { ReactNode } from 'react'

// Line icons for the canvas tab bar, one per plugin: 24-unit grid, drawn in currentColor.

const Icon = ({ children, bold }: { children: ReactNode; bold?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={bold ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const ICONS: Record<string, ReactNode> = {
  map: (
    <Icon>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Icon>
  ),
  spotify: (
    <Icon>
      <path d="M9 18V5.5l10-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Icon>
  ),
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
  progress: (
    <Icon>
      <path d="M3.5 20.5h17" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="11" cy="11" r="1.6" />
      <circle cx="15" cy="13" r="1.6" />
      <circle cx="19.5" cy="6.5" r="1.6" />
      <path d="m7.3 14 2.4-2M12.5 11.8l1 .5M16 11.7l2.6-3.9" />
    </Icon>
  ),
  'ai-prompts': (
    <Icon>
      <path d="M12 3.5c.6 4.3 2.5 6.2 6.8 6.8-4.3.6-6.2 2.5-6.8 6.8-.6-4.3-2.5-6.2-6.8-6.8 4.3-.6 6.2-2.5 6.8-6.8z" />
      <path d="M18.5 16.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" />
    </Icon>
  ),
  activity: (
    <Icon>
      <path d="M2.5 12h4l2.5-6 4.5 12 2.5-6h5.5" />
    </Icon>
  ),
}

/** The dashboard, the canvas pane's home tab: drawn heavier than the plugin icons. */
export const HOME_ICON = (
  <Icon bold>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5" />
  </Icon>
)

/** A plugin without its own icon. */
export const FALLBACK_ICON = (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </Icon>
)

export const pluginIcon = (type: string): ReactNode => ICONS[type] ?? FALLBACK_ICON

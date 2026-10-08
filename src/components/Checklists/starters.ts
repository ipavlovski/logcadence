import { EVERY_DAY, type ChecklistBody } from '../../../shared/checklists.ts'

// The starter set offered while there are no checklists yet: everyday, ongoing, editable once added.

type Starter = Pick<ChecklistBody, 'title' | 'items'>

export const STARTERS: Starter[] = [
  {
    title: 'Reddit',
    items: [
      { label: 'Review subreddits', target: 25, source: null },
      { label: 'Save posts', target: 50, source: 'reddit-posts' },
      { label: 'Write comments', target: 20, source: null },
    ],
  },
  {
    title: 'YouTube',
    items: [{ label: 'Process saved videos: comments and mp4 segments', target: 30, source: 'youtube-videos' }],
  },
  {
    title: 'Website library',
    items: [{ label: 'Add and annotate websites', target: 10, source: 'bookmarks' }],
  },
  {
    title: 'SEO',
    items: [{ label: 'Complete the daily SEO dashboard tasks', target: 1, source: null }],
  },
  {
    title: 'Logcadence',
    items: [
      { label: 'Annotate the map', target: 1, source: null },
      { label: 'Annotate activity', target: 1, source: null },
      { label: 'Annotate progress', target: 1, source: null },
      { label: 'Annotate checklists', target: 1, source: null },
      { label: 'Clean up notes', target: 1, source: null },
      { label: 'Mark out sleep from the previous day', target: 1, source: null },
    ],
  },
]

export const starterBody = (s: Starter, startDate: string): ChecklistBody => ({ ...s, startDate, endDate: null, weekdays: EVERY_DAY })

// Fills an empty database with a few sample days so the UI has something to show.
// Usage: pnpm seed   (no-op when entries already exist)

import { shiftDate, today } from '../shared/dates.ts'
import { app } from '../server/app.ts'
import { db } from '../server/db/client.ts'
import { entries } from '../server/db/content-schema.ts'
import { flushJournalFiles } from '../server/lib/journalFiles.ts'

if (db.select().from(entries).limit(1).all().length) {
  console.log('Database already has entries; not seeding.')
  process.exit(0)
}

const d = (offset: number) => shiftDate(today(), offset)

const samples: { date: string; title: string; tags: string[]; nodes: string[]; archived?: boolean }[] = [
  {
    date: d(-8),
    title: 'DISK: checking which SSD nvme i have installed',
    tags: ['dev', 'system:windows:disk'],
    nodes: [
      '```powershell\nGet-PhysicalDisk | Format-Table DeviceId, FriendlyName, MediaType, BusType, Size, HealthStatus\n```',
      'Both drives are Samsung SSD 980 PRO 500GB, NVMe, healthy.',
    ],
  },
  {
    date: d(-8),
    title: 'Samsung Notes - installing on a non-samsung PC',
    tags: ['dev', 'samsung-note'],
    nodes: ['Needs the store package + a registry tweak.', 'See also #system:windows:powertoys for window pinning.'],
  },
  {
    date: d(-5),
    title: 'PowerToys: FancyZones layout',
    tags: ['system:windows:powertoys', 'shortcuts'],
    nodes: ['`Win+Shift+~` opens the layout editor', 'Three columns, middle one 50% for the journal.'],
  },
  {
    date: d(-5),
    title: 'PowerToys: old FancyZones layout',
    tags: ['system:windows:powertoys'],
    nodes: ['Two columns — replaced, see [[' + d(-5) + ']].'],
    archived: true,
  },
  {
    date: d(-2),
    title: 'DaVinci Resolve: proxy workflow',
    tags: ['design:davinci-resolve:til'],
    nodes: ['Generate proxies at **half res** before cutting.', 'Render cache: *smart*.'],
  },
  {
    date: d(-2),
    title: 'Blog: draft on journaling setup',
    tags: ['tidewater:blog:a'],
    nodes: ['Outline: why logseq, what is missing, the 3-pane idea.'],
  },
  {
    date: d(0),
    title: 'Logcadence: first run',
    tags: ['dev', 'project:logcadence'],
    nodes: [
      'Journal in the middle, tags on the right, canvas on the left.',
      'Try: Alt+N for a new entry at the cursor, Ctrl+K for tags, Ctrl+Shift+F to search.',
    ],
  },
]

for (const s of samples) {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: s.date, title: s.title, tags: s.tags, nodes: s.nodes.map((content) => ({ content })) }),
  })
  const entry = (await res.json()) as { id: string }
  if (s.archived) {
    await app.request('/api/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryIds: [entry.id], archived: true }),
    })
  }
}
flushJournalFiles()
console.log(`Seeded ${samples.length} entries.`)

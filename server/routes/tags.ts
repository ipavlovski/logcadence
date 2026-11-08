import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { normalizeTag } from '../../shared/tags.ts'
import type { MetaDTO, TagInfo } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { entries, entryTags, tags } from '../db/content-schema.ts'
import { branchTag, createCategory, deleteCategory, deleteTag, listCategories, loadEntries, moveTag, orderCategories, renameCategory, tagSubtree } from '../lib/content.ts'
import { logEvent } from '../lib/events.ts'
import { touchDates } from '../lib/journalFiles.ts'
import { bad, obj, optStrArr, str, type Obj } from '../lib/validate.ts'

function tagField(o: Obj, k: string): string {
  const t = normalizeTag(str(o, k))
  if (!t) bad(`${k} is not a valid tag`)
  return t
}

const parseMove = (v: unknown) => {
  const o = obj(v)
  return { from: tagField(o, 'from'), to: tagField(o, 'to') }
}

function tagInfos(): TagInfo[] {
  return db
      .select({
        path: tags.path,
        active: sql<number>`coalesce(sum(${entries.archived} = 0), 0)`,
        archived: sql<number>`coalesce(sum(${entries.archived} = 1), 0)`,
      })
      .from(tags)
      .innerJoin(entryTags, eq(entryTags.tagId, tags.id))
      .innerJoin(entries, eq(entries.id, entryTags.entryId))
      .groupBy(tags.id)
      .orderBy(asc(tags.path))
      .all()
}

const counts = { active: sql<number>`coalesce(sum(${entries.archived} = 0), 0)`, archived: sql<number>`coalesce(sum(${entries.archived} = 1), 0)` }

export const tagRoutes = new Hono()
  .get('/tags', (c) => c.json({ tags: tagInfos() }))
  // Everything entries can be told apart by, with counts: types and subtypes, categories, tags.
  .get('/meta', (c) => {
    const meta: MetaDTO = {
      types: db.select({ type: entries.type, subtype: entries.subtype, ...counts }).from(entries).groupBy(entries.type, entries.subtype).orderBy(asc(entries.type), asc(entries.subtype)).all(),
      categories: listCategories(),
      uncategorized: db.select(counts).from(entries).where(isNull(entries.category)).get() ?? { active: 0, archived: 0 },
      tags: tagInfos(),
    }
    return c.json(meta)
  })
  // ── categories ──
  .get('/categories', (c) => c.json({ categories: listCategories() }))
  .post(
    '/categories',
    validator('json', (v) => ({ name: str(obj(v), 'name') })),
    (c) => c.json({ name: createCategory(c.req.valid('json').name) }, 201),
  )
  .post(
    '/categories/rename',
    validator('json', (v) => {
      const o = obj(v)
      return { from: str(o, 'from'), to: str(o, 'to') }
    }),
    (c) => {
      const { from, to } = c.req.valid('json')
      touchDates(...db.transaction(() => renameCategory(from, to)))
      return c.json({ ok: true })
    },
  )
  .post(
    '/categories/delete',
    validator('json', (v) => ({ name: str(obj(v), 'name') })),
    (c) => {
      touchDates(...db.transaction(() => deleteCategory(c.req.valid('json').name)))
      return c.json({ ok: true })
    },
  )
  .post(
    '/categories/order',
    validator('json', (v) => ({ names: optStrArr(obj(v), 'names') ?? bad('names is required') })),
    (c) => {
      orderCategories(c.req.valid('json').names)
      return c.json({ ok: true })
    },
  )
  // Entries under a tag, newest day first. `sub=0` excludes descendant tags; `archived=1` includes archived items.
  .get(
    '/tags/entries',
    validator('query', (v) => ({ tag: String(v.tag ?? ''), archived: String(v.archived ?? '0'), sub: String(v.sub ?? '1') })),
    (c) => {
      const q = c.req.valid('query')
      const tag = normalizeTag(q.tag)
      if (!tag) bad('tag is required')
      const withArchived = q.archived === '1'
      const withSub = q.sub !== '0'
      const rows = db
        .selectDistinct({ id: entries.id, date: entries.date, position: entries.position })
        .from(entries)
        .innerJoin(entryTags, eq(entryTags.entryId, entries.id))
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(and(withSub ? tagSubtree(tag) : eq(tags.path, tag), withArchived ? undefined : eq(entries.archived, false)))
        .orderBy(desc(entries.date), asc(entries.position))
        .all()
      const list = loadEntries(rows.map((r) => r.id))
      return c.json({ tag, entries: withArchived ? list : list.map((e) => ({ ...e, nodes: e.nodes.filter((n) => !n.archived) })) })
    },
  )
  // Rename also moves the subtree; renaming onto an existing tag merges into it.
  .post('/tags/rename', validator('json', parseMove), (c) => {
    const { from, to } = c.req.valid('json')
    const dates = db.transaction(() => moveTag(from, to))
    logEvent('tag', from, 'edit', { renameTo: to })
    touchDates(...dates)
    return c.json({ tag: to })
  })
  .post('/tags/merge', validator('json', parseMove), (c) => {
    const { from, to } = c.req.valid('json')
    const dates = db.transaction(() => moveTag(from, to))
    logEvent('tag', from, 'edit', { mergeInto: to })
    touchDates(...dates)
    return c.json({ tag: to })
  })
  .post(
    '/tags/delete',
    validator('json', (v) => ({ tag: tagField(obj(v), 'tag') })),
    (c) => {
      const { tag } = c.req.valid('json')
      const dates = db.transaction(() => deleteTag(tag))
      logEvent('tag', tag, 'delete')
      touchDates(...dates)
      return c.json({ ok: true })
    },
  )
  // Moves selected entries from a tag into another (typically a new sub-tag).
  .post(
    '/tags/branch',
    validator('json', (v) => ({ ...parseMove(v), entryIds: optStrArr(obj(v), 'entryIds') ?? [] })),
    (c) => {
      const { from, to, entryIds } = c.req.valid('json')
      const dates = db.transaction(() => branchTag(from, to, entryIds))
      logEvent('tag', from, 'edit', { branchTo: to, entryIds })
      touchDates(...dates)
      return c.json({ tag: to })
    },
  )

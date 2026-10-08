import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { CHECKLIST_SOURCES, type ChecklistBody, type ChecklistItemBody, type ChecklistSource } from '../../shared/checklists.ts'
import { isIsoDate } from '../../shared/dates.ts'
import { checklistDays, createChecklist, deleteChecklist, getChecklist, listChecklists, reorderChecklists, setMark, updateChecklist } from '../lib/checklists.ts'
import { bad, date, defined, num, obj, optBool, optStr, optStrArr, str, type Obj } from '../lib/validate.ts'

const MAX_TARGET = 10_000

function title(o: Obj): string {
  const t = str(o, 'title').trim()
  if (!t) bad('A checklist needs a title')
  return t
}

function endDate(o: Obj): string | null {
  const v = o.endDate
  if (v !== null && !(typeof v === 'string' && isIsoDate(v))) bad('endDate must be a YYYY-MM-DD date or null')
  return v as string | null
}

function weekdays(o: Obj): number {
  const w = num(o, 'weekdays')
  if (!Number.isInteger(w) || w < 1 || w > 127) bad('Pick at least one day of the week')
  return w
}

function items(o: Obj): ChecklistItemBody[] {
  const v = o.items
  if (!Array.isArray(v)) bad('items must be an array')
  if (!v.length) bad('A checklist needs at least one item')
  return v.map((x) => {
    const i = obj(x)
    const label = str(i, 'label').trim()
    if (!label) bad('Every item needs a label')
    const target = num(i, 'target')
    if (!Number.isInteger(target) || target < 1 || target > MAX_TARGET) bad(`Targets are whole numbers from 1 to ${MAX_TARGET}`)
    const source = i.source ?? null
    if (source !== null && !CHECKLIST_SOURCES.includes(source as ChecklistSource)) bad('unknown item source')
    return defined({ id: optStr(i, 'id'), label, target, source: source as ChecklistSource | null })
  })
}

const checkRange = (start: string, end: string | null) => end != null && end < start && bad('The end date is before the start date')

export const checklistRoutes = new Hono()
  .get('/checklists', (c) => c.json({ checklists: listChecklists() }))
  // The active checklists due on each day in [from, to], with their items and what was done of them.
  .get('/checklists/days', (c) => {
    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) bad('from and to must be YYYY-MM-DD, from <= to')
    if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) bad('range too long')
    return c.json({ days: checklistDays(from, to) })
  })
  .post(
    '/checklists',
    validator('json', (v): ChecklistBody => {
      const o = obj(v)
      const body = { title: title(o), startDate: date(o, 'startDate'), endDate: endDate(o), weekdays: weekdays(o), items: items(o) }
      checkRange(body.startDate, body.endDate)
      return body
    }),
    (c) => c.json(createChecklist(c.req.valid('json'))),
  )
  // Any of the checklist's fields; items, when given, are the whole list (see saveItems).
  .patch(
    '/checklists/:id',
    validator('json', (v): Partial<ChecklistBody> & { archived?: boolean } => {
      const o = obj(v)
      return defined({
        title: o.title === undefined ? undefined : title(o),
        startDate: o.startDate === undefined ? undefined : date(o, 'startDate'),
        endDate: o.endDate === undefined ? undefined : endDate(o),
        weekdays: o.weekdays === undefined ? undefined : weekdays(o),
        items: o.items === undefined ? undefined : items(o),
        archived: optBool(o, 'archived'),
      })
    }),
    (c) => {
      const id = c.req.param('id')
      const b = c.req.valid('json')
      const before = getChecklist(id)
      checkRange(b.startDate ?? before.startDate, b.endDate === undefined ? before.endDate : b.endDate)
      return c.json(updateChecklist(id, b))
    },
  )
  .put(
    '/checklists/order',
    validator('json', (v) => ({ ids: optStrArr(obj(v), 'ids') ?? bad('ids is required') })),
    (c) => {
      reorderChecklists(c.req.valid('json').ids)
      return c.json({ checklists: listChecklists() })
    },
  )
  .delete('/checklists/:id', (c) => {
    deleteChecklist(c.req.param('id'))
    return c.json({ ok: true })
  })
  // What was done of an item on a day, by hand (0 clears it).
  .put(
    '/checklists/marks',
    validator('json', (v) => {
      const o = obj(v)
      const count = num(o, 'count')
      if (!Number.isInteger(count) || count < 0 || count > MAX_TARGET * 10) bad('count must be a whole number, 0 or more')
      return { itemId: str(o, 'itemId'), date: date(o, 'date'), count }
    }),
    (c) => {
      const { itemId, date, count } = c.req.valid('json')
      setMark(itemId, date, count)
      return c.json({ ok: true })
    },
  )

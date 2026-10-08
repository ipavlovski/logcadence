import { Hono } from 'hono'
import { isIsoDate } from '../../shared/dates.ts'
import { validator } from 'hono/validator'
import { getChat, importUpload, listChats, promptDays, scanLocal } from '../lib/ai/importer.ts'
import { describeSources } from '../lib/ai/sources.ts'
import { bad, notFound } from '../lib/validate.ts'

const MAX_UPLOAD = 2 * 1024 * 1024 * 1024

export const aiRoutes = new Hono()
  .get('/ai/sources', (c) => c.json({ sources: describeSources() }))
  .get('/ai/chats', (c) => c.json({ chats: listChats() }))
  // Prompts per day from `from` on (dashboard heatmap).
  .get('/ai/prompt-days', (c) => {
    const from = c.req.query('from') ?? ''
    if (!isIsoDate(from)) bad('from must be YYYY-MM-DD')
    return c.json({ days: promptDays(from) })
  })
  .get('/ai/chats/:id', (c) => c.json(getChat(c.req.param('id')) ?? notFound('chat')))
  // Imports every chat found on this machine (Claude Code, Antigravity, exports in Downloads).
  .post('/ai/scan', async (c) => c.json({ report: await scanLocal() }))
  // An export file picked or dropped in the AI tab.
  .post(
    '/ai/import',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const { file } = c.req.valid('form')
      try {
        return c.json({ report: await importUpload(file.name, Buffer.from(await file.arrayBuffer())) })
      } catch (err) {
        bad((err as Error).message)
      }
    },
  )

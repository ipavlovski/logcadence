import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { normalizeTag } from '../shared/tags.ts'
import type { CategoryInfo, TagInfo } from '../shared/types.ts'
import type { LogcadenceApi } from './api.ts'

// The Logcadence MCP server: tools for Claude Desktop (or any MCP client) to read and sort the tag set and the
// categories of the running app. Launched over stdio by mcp/main.ts; packaged as a Claude Desktop extension by
// scripts/build-mcp.ts. (Videos and AI chats moved out to youtube-lib and ai-lib, which have MCP servers of their own.)

const INSTRUCTIONS = `Logcadence is the user's journaling app: journal entries, bookmarks and an image board.
Every entry has at most one category and any number of tags. Categories are a short fixed list (list_categories), e.g.
design, build, dev. Tags are hierarchical, lowercase paths joined by "/" (e.g. "build/well/drilling"); ancestors are
implicit, so an entry tagged "build/well/drilling" also shows under "build". Tags under "bookmark/" are the ones
bookmarks had before every type shared one tag set, still to be sorted into the main hierarchy.`

// Compact JSON: tag lists go into the model's context.
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export function createServer(api: LogcadenceApi): McpServer {
  const server = new McpServer({ name: 'logcadence', version: '0.2.0' }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'Every tag path, with how many entries carry exactly that path (and how many of those are archived).',
      annotations: { readOnlyHint: true },
    },
    async () => text((await api.get<{ tags: TagInfo[] }>('/tags')).tags.map((t) => ({ path: t.path, entries: t.active, ...(t.archived && { archived: t.archived }) }))),
  )

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description: 'The categories an entry can be filed under (at most one each), in order, with how many entries each has.',
      annotations: { readOnlyHint: true },
    },
    async () => text((await api.get<{ categories: CategoryInfo[] }>('/categories')).categories.map((c) => ({ name: c.name, entries: c.active }))),
  )

  server.registerTool(
    'move_tag',
    {
      title: 'Rename a tag',
      description: 'Renames a tag path (and everything under it) on every entry that carries it, merging into the target if it already exists.',
      inputSchema: { from: z.string(), to: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ from, to }) => {
      await api.send('POST', '/tags/rename', { from, to })
      return text({ ok: true, from: normalizeTag(from), to: normalizeTag(to) })
    },
  )

  return server
}

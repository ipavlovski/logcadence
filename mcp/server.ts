import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { cleanTags, isUnder, normalizeTag } from '../shared/tags.ts'
import type { UpdateYtVideoBody, YtLibraryDTO, YtVideoDTO, YtVideoSummary } from '../shared/types.ts'
import type { LogcadenceApi } from './api.ts'

// The Logcadence MCP server: tools for Claude Desktop (or any MCP client) to read and tag the YouTube tab's
// videos in the running app. Launched over stdio by mcp/main.ts; packaged as a Claude Desktop extension by
// scripts/build-mcp.ts.

const INSTRUCTIONS = `Logcadence is the user's journaling app; its YouTube tab holds videos imported from their playlists.
Tags are hierarchical, lowercase paths joined by ":" (e.g. "build:well:drilling"); ancestors are implicit, so a video tagged
"build:well:drilling" also shows under "build". The first tag of a video is its primary tag. The YouTube tab has its own tag
set, apart from the journal's. Before tagging, read the existing tags with yt_list_tags and reuse them where they fit;
create new paths only when nothing fits. Show the user what you plan to tag before applying large batches.`

const MAX_LIMIT = 500

/** A video as the tools list it: enough to tag it by, without thumbnails and the like. */
function row(v: YtVideoSummary) {
  return {
    id: v.id,
    title: v.title,
    channel: v.channel,
    duration: v.duration,
    published: v.publishedAt ? new Date(v.publishedAt).toISOString().slice(0, 10) : v.published,
    added: v.addedDate,
    tags: v.tags,
    hasNotes: v.hasNotes,
  }
}

const FIELDS = ['id', 'title', 'channel', 'duration', 'published', 'added', 'tags', 'hasNotes'] as const

// Compact JSON: listings of thousands of videos go into the model's context.
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export function createServer(api: LogcadenceApi): McpServer {
  const server = new McpServer({ name: 'logcadence', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const library = () => api.get<YtLibraryDTO>('/youtube/library')

  server.registerTool(
    'yt_list_tags',
    {
      title: 'List YouTube tags',
      description: 'Every tag path used in the YouTube tab, with how many videos carry exactly that path.',
      annotations: { readOnlyHint: true },
    },
    async () => text((await library()).tags.map((t) => ({ path: t.path, videos: t.active }))),
  )

  server.registerTool(
    'yt_list_videos',
    {
      title: 'List YouTube videos',
      description: 'Videos in the YouTube tab, newest added first, paged. Filters combine: untagged only, under a tag (that path or its descendants), and a text query on title and channel.',
      inputSchema: {
        untagged: z.boolean().optional().describe('Only videos with no tags'),
        tag: z.string().optional().describe('Only videos tagged with this path or one under it'),
        query: z.string().optional().describe('Case-insensitive text to find in the title or channel'),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size (default 100, max ${MAX_LIMIT})`),
        offset: z.number().int().min(0).optional().describe('Videos to skip (default 0)'),
        fields: z.array(z.enum(FIELDS)).min(1).optional().describe('Only these fields per video (default all); e.g. ["id","title","channel"] for a slim listing'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ untagged, tag, query, limit = 100, offset = 0, fields }) => {
      const root = tag && normalizeTag(tag)
      const q = query?.trim().toLowerCase()
      const videos = (await library()).videos.filter(
        (v) => (!untagged || !v.tags.length) && (!root || v.tags.some((t) => isUnder(t, root))) && (!q || v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q)),
      )
      const pick = (r: ReturnType<typeof row>) => (fields ? Object.fromEntries(fields.map((f) => [f, r[f]])) : r)
      return text({ total: videos.length, offset, videos: videos.slice(offset, offset + limit).map((v) => pick(row(v))) })
    },
  )

  server.registerTool(
    'yt_get_video',
    {
      title: 'Get a YouTube video',
      description: "One video with the user's own notes and kept comments (markdown).",
      inputSchema: { id: z.string().describe('The YouTube video id') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const v = await api.get<YtVideoDTO>(`/youtube/videos/${encodeURIComponent(id)}`)
      return text({ ...row(v), url: `https://www.youtube.com/watch?v=${v.id}`, notes: v.notes, comments: v.comments })
    },
  )

  server.registerTool(
    'yt_set_tags',
    {
      title: 'Tag YouTube videos',
      description: 'Sets the tags of one or more videos. mode "add" (default) keeps their current tags and appends these; "replace" overwrites them (an empty list clears them). Order matters: the first tag is the primary one. Answers with how many were updated and the ones that failed.',
      inputSchema: {
        items: z.array(z.object({ id: z.string(), tags: z.array(z.string()) })).min(1).describe('Videos and their tags'),
        mode: z.enum(['add', 'replace']).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ items, mode = 'add' }) => {
      const current = mode === 'add' ? new Map((await library()).videos.map((v) => [v.id, v.tags])) : undefined
      let updated = 0
      const errors: { id: string; error: string }[] = []
      // One at a time: the app writes each in its own transaction, and a bad id shouldn't stop the rest.
      for (const { id, tags } of items) {
        try {
          const old = current?.get(id)
          if (current && !old) throw new Error('video not found')
          const body: UpdateYtVideoBody = { tags: cleanTags([...(old ?? []), ...tags]) }
          await api.send<YtVideoDTO>('PATCH', `/youtube/videos/${encodeURIComponent(id)}`, body)
          updated++
        } catch (err) {
          errors.push({ id, error: (err as Error).message })
        }
      }
      // Just a count: echoing every video back would fill the context on large batches.
      return text({ updated, ...(errors.length && { errors }) })
    },
  )

  server.registerTool(
    'yt_move_tag',
    {
      title: 'Rename a YouTube tag',
      description: 'Renames a tag path (and everything under it) on every video, merging into the target if it already exists.',
      inputSchema: { from: z.string(), to: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ from, to }) => {
      await api.send('POST', '/youtube/tags/move', { from, to })
      return text({ ok: true, from: normalizeTag(from), to: normalizeTag(to) })
    },
  )

  return server
}

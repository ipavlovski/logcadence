import { describe, expect, it } from 'vitest'
import { codeBlock, parseClaudeConversation, type ClaudeConversation } from './claudeConversation.ts'

const T0 = Date.parse('2026-09-20T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()

type Msg = NonNullable<ClaudeConversation['chat_messages']>[number]
const human = (uuid: string, parent: string | undefined, text: string, extra: Partial<Msg> = {}): Msg => ({
  uuid,
  parent_message_uuid: parent,
  sender: 'human',
  content: [{ type: 'text', text }],
  created_at: iso(0),
  ...extra,
})
const assistant = (uuid: string, parent: string, content: Msg['content'], extra: Partial<Msg> = {}): Msg => ({
  uuid,
  parent_message_uuid: parent,
  sender: 'assistant',
  content,
  created_at: iso(1),
  ...extra,
})
const text = (t: string) => ({ type: 'text', text: t })
const tool = (name: string, input: object) => ({ type: 'tool_use', name, input })
const conv = (messages: Msg[], extra: Partial<ClaudeConversation> = {}): ClaudeConversation => ({
  uuid: 'c1',
  name: 'Test chat',
  created_at: iso(0),
  updated_at: iso(5),
  chat_messages: messages,
  ...extra,
})
const parse = (c: ClaudeConversation) => parseClaudeConversation(c)!

describe('claude.ai conversation', () => {
  it('follows the current leaf, not the newest reply', () => {
    const c = conv(
      [
        human('h1', undefined, 'Question', { index: 0 }),
        assistant('a1', 'h1', [text('Shown reply')], { index: 1 }),
        assistant('a2', 'h1', [text('Regenerated, then switched away from')], { index: 2 }),
      ],
      { current_leaf_message_uuid: 'a1', model: 'claude-opus-5-5' },
    )
    const p = parse(c)
    expect(p.messages.map((m) => m.text)).toEqual(['Question', 'Shown reply'])
    expect(p.meta).toEqual({ model: 'claude-opus-5-5' })
  })

  it('without a leaf (the export), walks back from the newest message', () => {
    const p = parse(conv([human('h1', undefined, 'Question'), assistant('a1', 'h1', [text('Old')]), assistant('a2', 'h1', [text('New')])]))
    expect(p.messages.map((m) => m.text)).toEqual(['Question', 'New'])
  })

  it('shows an artifact once, at its final version, with edits applied literally', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Write it'),
        assistant('a1', 'h1', [
          text('Here:'),
          tool('artifacts', { command: 'create', id: 'x', title: 'Price', type: 'application/vnd.ant.code', language: 'javascript', content: 'const p = 1', version_uuid: 'v1' }),
        ]),
        human('h2', 'a1', 'Use a template'),
        assistant('a2', 'h2', [tool('artifacts', { command: 'update', id: 'x', old_str: '1', new_str: '`$&{n}`', version_uuid: 'v2' }), text('Done.')]),
      ]),
    )
    expect(p.messages.map((m) => m.text)).toEqual(['Write it', 'Here:', 'Use a template', codeBlock('Artifact: Price · javascript', 'const p = `$&{n}`', 'javascript') + '\n\nDone.'])
    expect(p.messages.every((m) => !m.tools)).toBe(true)
  })

  it('takes a rewrite whole, and warns about an edit it cannot apply', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Go'),
        assistant('a1', 'h1', [
          tool('artifacts', { command: 'create', id: 'd', title: 'Flow', type: 'application/vnd.ant.mermaid', content: 'graph A', version_uuid: 'v1' }),
          tool('artifacts', { command: 'rewrite', id: 'd', content: 'graph B', version_uuid: 'v2' }),
          tool('artifacts', { command: 'update', id: 'd', old_str: 'missing', new_str: 'x', version_uuid: 'v3' }),
        ]),
      ]),
    )
    expect(p.messages[1]!.text).toBe(codeBlock('Artifact: Flow · Mermaid', 'graph B', 'mermaid'))
    expect(p.meta.warnings).toMatch(/Flow.*could not be applied/)
  })

  it('shows created files and widgets as fenced code, longer fences around backticks', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Files'),
        assistant('a1', 'h1', [
          tool('create_file', { path: '/mnt/out/README.md', file_text: 'Run:\n```sh\nx\n```' }),
          tool('visualize:show_widget', { title: 'Chart', widget_code: '<Chart />' }),
        ]),
      ]),
    )
    expect(p.messages[1]!.text).toBe('**File: README.md**\n\n````markdown\nRun:\n```sh\nx\n```\n````\n\n**Widget: Chart**\n\n```jsx\n<Chart />\n```')
  })

  it('shows a written file once, with its edits, where it was last changed', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Write a cover letter'),
        assistant('a1', 'h1', [tool('Write', { file_path: '/home/claude/letter.md', content: 'Dear X,\n\n[PARA]\n\nX' }), text('Drafted.')]),
        human('h2', 'a1', 'Fill it in'),
        assistant('a2', 'h2', [
          tool('str_replace', { path: '/home/claude/letter.md', old_str: '[PARA]', new_str: 'I build $& things.', description: 'Fill the paragraph' }),
          tool('Edit', { file_path: '/home/claude/letter.md', old_string: 'X', new_string: 'Y', replace_all: true }),
          tool('Edit', { file_path: '/etc/hosts', old_string: 'a', new_string: 'b' }),
          tool('Write', { file_path: 'calc.py', content: 'x = 1' }),
          tool('Edit', { file_path: '/home/claude/calc.py', old_string: '1', new_string: '2' }),
          tool('create_file', { path: '/mnt/out/a.py', file_text: 'print(1)' }),
          tool('create_file', { path: '/mnt/out/a.py', file_text: 'print(2)' }),
        ]),
      ]),
    )
    expect(p.messages.map((m) => [m.text, m.tools])).toEqual([
      ['Write a cover letter', undefined],
      ['Drafted.', undefined],
      ['Fill it in', undefined],
      [codeBlock('File: letter.md', 'Dear Y,\n\nI build $& things.\n\nY', 'markdown'), [{ name: 'Edit', summary: '/etc/hosts' }]],
      [codeBlock('File: calc.py', 'x = 2', 'python') + '\n\n' + codeBlock('File: a.py', 'print(2)', 'python'), undefined],
    ])
    expect(p.meta.warnings).toBeUndefined()
  })

  it('links a published artifact', () => {
    const url = 'https://claude.ai/code/artifact/4f4aa5c2'
    const p = parse(conv([human('h1', undefined, 'Publish'), assistant('a1', 'h1', [tool('Artifact', { url, title: 'BMS options' }), tool('Artifact', { file_path: 'x.html' })])]))
    expect(p.messages[1]).toMatchObject({ text: `**Artifact:** [BMS options](${url})`, tools: [{ name: 'Artifact', summary: 'x.html' }] })
  })

  it('skips thinking and tool results, keeping other tools as calls', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Search'),
        assistant('a1', 'h1', [
          { type: 'thinking', text: 'hmm' },
          tool('web_search', { query: 'hinges' }),
          { type: 'tool_result', name: 'web_search' },
          text('Found it.'),
        ]),
      ]),
    )
    expect(p.messages.slice(1)).toEqual([
      { role: 'assistant', text: '', ts: T0 + 60_000, tools: [{ name: 'web_search', summary: 'hinges' }] },
      { role: 'assistant', text: 'Found it.', ts: T0 + 60_000 },
    ])
  })

  it('keeps attachments with the prompt: extracted text, and files by name', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Compare these', {
          attachments: [{ file_name: 'req.md', file_type: 'text/markdown', file_size: 1229, extracted_content: '# Req\nSort it\n' }],
          files: [
            { file_kind: 'image', file_name: 'shot.png' },
            { file_kind: 'document', file_name: 'spec.pdf', document_asset: { page_count: 1 } },
            { file_kind: 'blob', file_name: 'memo.m4a', size_bytes: 500 },
          ],
        }),
        assistant('a1', 'h1', [text('Sure.')]),
      ]),
    )
    expect(p.messages[0]).toEqual({
      role: 'user',
      text: 'Compare these',
      ts: T0,
      attachments: [
        { name: 'shot.png', meta: 'image' },
        { name: 'spec.pdf', meta: 'document · 1 page' },
        { name: 'memo.m4a', meta: 'blob · 500 B' },
        { name: 'req.md', meta: 'text/markdown · 1.2 KB', text: '# Req\nSort it' },
      ],
    })
  })

  it('notes a stopped reply, and drops empty messages', () => {
    const p = parse(
      conv([
        human('h1', undefined, 'Long answer please'),
        assistant('a1', 'h1', [text('Part one')], { stop_reason: 'user_canceled' }),
        human('h2', 'a1', ''),
        assistant('a2', 'h2', [], { stop_reason: 'user_canceled' }),
      ]),
    )
    expect(p.messages.map((m) => m.text)).toEqual(['Long answer please', 'Part one\n\n> **Interrupted:** this reply was stopped before Claude finished.'])
  })

  it('has no chat without a prompt', () => {
    expect(parseClaudeConversation(conv([]))).toBeNull()
  })
})

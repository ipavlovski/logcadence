// Shared by the background worker and the popup.

/** Logcadence listens on 3002; LogcadenceDev (pnpm preview) on 3003. */
export const PORTS = { 3002: 'Logcadence', 3003: 'LogcadenceDev' }
const DEFAULT_PORT = 3002

export async function getPort() {
  const { port } = await chrome.storage.local.get('port')
  return PORTS[port] ? Number(port) : DEFAULT_PORT
}

export const setPort = (port) => chrome.storage.local.set({ port })

/** A Reddit post, or a comment's link under one (new, old, www…). */
export const isRedditPost = (url) => /^https:\/\/([a-z0-9-]+\.)?reddit\.com\/(r\/[^/]+\/)?comments\/[a-z0-9]+/i.test(url ?? '')

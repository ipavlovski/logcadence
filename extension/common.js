// Shared by the background worker and the popup.

/**
 * Where captures go. Logcadence listens on 3002, LogcadenceDev (pnpm preview) on 3003; videos (YouTube, TikTok,
 * Instagram) go to SEO Dashboard (../seo-dashboard) instead: 3010, or 3011 for SeoDashboardDev. `id` is what the
 * app's /api/capture/ping answers.
 */
export const APPS = {
  logcadence: { id: 'logcadence', name: 'Logcadence', key: 'port', ports: { 3002: 'Logcadence', 3003: 'LogcadenceDev' }, defaultPort: 3002 },
  seo: { id: 'seo-dashboard', name: 'SEO Dashboard', key: 'seoPort', ports: { 3010: 'SEO Dashboard', 3011: 'SeoDashboardDev' }, defaultPort: 3010 },
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)$/i

/** A page on YouTube, TikTok or Instagram: its bookmark goes to SEO Dashboard. */
export function isVideoSite(url) {
  try {
    const u = new URL(url ?? '')
    return /^https?:$/.test(u.protocol) && VIDEO_HOST.test(u.hostname)
  } catch {
    return false
  }
}

/** The app a page's captures go to. */
export const appFor = (url) => (isVideoSite(url) ? APPS.seo : APPS.logcadence)

export async function getPort(app) {
  const { [app.key]: port } = await chrome.storage.local.get(app.key)
  return app.ports[port] ? Number(port) : app.defaultPort
}

export const setPort = (app, port) => chrome.storage.local.set({ [app.key]: port })

/** A Reddit post, or a comment's link under one (new, old, www…). */
export const isRedditPost = (url) => /^https:\/\/([a-z0-9-]+\.)?reddit\.com\/(r\/[^/]+\/)?comments\/[a-z0-9]+/i.test(url ?? '')

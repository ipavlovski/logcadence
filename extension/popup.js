import { getPort, isRedditPost, PORTS, setPort } from './common.js'

// The toolbar popup: what the page is, where it can go, and which app (port) captures are sent to. The capture
// itself runs in the background worker, so it finishes even if the popup closes.

const $ = (id) => document.getElementById(id)
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

$('title').textContent = tab?.title ?? ''
$('host').textContent = tab?.url ? new URL(tab.url).host : ''
if (tab?.favIconUrl) $('favicon').src = tab.favIconUrl
else $('favicon').hidden = true

const web = /^https?:/.test(tab?.url ?? '')
const post = isRedditPost(tab?.url)
$('reddit').hidden = !post
$('comment').hidden = !post
if (post) $('bookmark').textContent = 'Save as bookmark instead'
if (!web) {
  for (const b of document.querySelectorAll('.actions button')) b.disabled = true
  show(false, 'Only web pages can be captured.')
}

async function checkApp() {
  const status = $('status')
  const { port, ok } = await chrome.runtime.sendMessage({ type: 'ping' })
  status.textContent = ok ? 'connected' : 'not running'
  status.className = `status ${ok ? 'ok' : 'off'}`
  status.title = ok ? `${PORTS[port]} is listening on port ${port}` : `Nothing answers on port ${port}: start ${PORTS[port]}, or pick the other app below`
}

const select = $('port')
for (const [port, name] of Object.entries(PORTS)) select.add(new Option(`${name} (${port})`, port))
select.value = String(await getPort())
select.onchange = async () => {
  await setPort(Number(select.value))
  checkApp()
}
checkApp()

function show(ok, message) {
  const r = $('result')
  r.hidden = false
  r.textContent = message
  r.className = `result ${ok ? 'ok' : 'error'}`
}

async function run(target, button) {
  const buttons = [...document.querySelectorAll('.actions button')]
  for (const b of buttons) b.disabled = true
  const label = button.textContent
  button.textContent = target === 'reddit' ? 'Capturing the post…' : 'Capturing…'
  const r = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id, target })
  button.textContent = label
  for (const b of buttons) b.disabled = false
  show(r.ok, r.ok ? `${r.message} ✓` : r.message)
  if (r.ok) setTimeout(() => window.close(), 1200)
}

for (const target of ['reddit', 'comment', 'bookmark']) $(target).onclick = (e) => run(target, e.currentTarget)

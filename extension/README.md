# Logcadence capture (Chrome extension)

Sends a screenshot of the page, with its url, title and favicon, to the running Logcadence app:

- **Reddit post** → the canvas **Reddit** tab: one screenshot of the whole post (title, text, images), scrolled through and stitched, with the subreddit, its icon, the author, points, comment count and post date.
- **Add as comment** (on a Reddit post you have captured) → what's on screen goes to that post's **Comments**.
- **Any other page** → the canvas **Bookmarks** tab: what's on screen, with the favicon.

Capturing a page again replaces its screenshot and keeps its notes, comments and tags.

## Install

1. `pnpm preview` copies this folder to `%LOCALAPPDATA%\LogcadenceChromeExtension`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick that folder.
3. After `pnpm preview` brings a change, click the extension's reload button on `chrome://extensions`.

## Use

- Toolbar button or **Alt+Shift+S** opens the popup: pick what to capture.
- **Alt+Shift+D** captures right away (a Reddit post to Reddit, anything else to Bookmarks); the toolbar icon shows ✓ or ! (hover it for the message).
- Shortcuts can be changed at `chrome://extensions/shortcuts`.
- The popup's **Send to** picks the app: Logcadence (port 3002) or LogcadenceDev (3003).

## How it talks to the app

`POST http://127.0.0.1:<port>/api/capture` with a JSON body (`CaptureRequest` in `shared/types.ts`): the images are jpeg `data:` urls. The request must carry the `x-logcadence-capture` header; a web page can't add it to a request to another origin, so pages open in the browser can't send captures.

# LOGCADENCE

- purpose: knowledge base, similar to logseq
- 2-pane workflow journaling app: canvas (days) / tags (queries)
- structure: every item is an entry (journal entry, bookmark, media), with a type/subtype,
  one category and any number of tags; the canvas shows days, the tags pane shows entries by their metadata
- activity tracking (maps, activity, progress, dashboard, checklists, ...) lives in a separate app: logtracker (../logtracker)
- YouTube videos live in youtube-lib (../youtube-lib, yt.localhost); AI chats in ai-lib (../ai-lib, ai.localhost)


## UI DESCRIPTION
- each pane can have multiple tabs; each has a primary tab that can't be closed
  - canvas: Today (always today), pinned days, and a preview day tab
    - opening a day shows it in the preview tab (replaced by the next day opened); double-click (or ctrl+click a date) pins it
    - tabs read "2026-11-08 Sun"; a day lists every type of entry under its categories; chips filter the types shown
  - tags: the preview tab, then queries pinned in tabs of their own
    - any click on an entry's metadata (tag, category, type, site) retargets the preview; double-click (or ctrl+click) pins it
    - an empty preview is the browser: types, categories and the tag tree, with counts
    - a query of one type shows in that type's view (bookmarks, media board); others as a list of entries
    - icons at the end of the tab bar open the type views


## SHORTCUTS
- search/spotlight
  - ctrl+f -> search within pane
  - ctrl+shift+f -> search within all DB
  - ctl+k -> tag search (spotlight view)
  - ctrl+shift+k -> 
- editing
  - selection/editing/etc.
- navigation
  - ctrl+w -> clsoe tab
  - ctrl+shift+w -> close all tabs
  - ctrl+[] -> next/prev tab
  - alt+left/right -> back forward
  - ctrl+click -> open in new tab
- journal tab
  - ctrl+n -> new entry at the cursor
  - ctrl+shift+n -> new entry with UI popup
  - ctrl+[ / ctrl+] -> previous / next day
  - alt+left/right -> back / forward through the days shown
- panes
  - ctrl+1 / ctrl+2 -> focus canvas / tags
  - ctrl+t -> minimize / restore the tags pane (the canvas is always shown)
- tags pane
  - delete -> archive (toggle)
  - shift+delete -> delete

## IMPLEMENTATION
- db structure -> 2 sqlite databases
  - content.db -> all the notes
  - events.db -> all the events
- app data structure
  - journals: collection of .md files
  - db: content.db, events.db
  - assets: images/gifs, videos, pdfs
- events: {node_id: '', op: create|edit|delete, payload: {}}
- stack: typescript, react, css-modules
  - canvas tabs are plugin-based
- editing journal node: takes place in memory
  entries and nodes -> nodes are children of entries
  when node editing is finished -> gets pushed to DB
  create/update/delete/archive operations -> pushed as events
- basic db structue
  journals table -> contain entries
  entry table -> id, entry_id, type 
- plugins -> new types and canvas renderings 
  fundamental 

## FOR LATER DEVELOPMENT
- will develop for 3 platforms simultaneously - web, desktop, mobile
  web/browser (cloudflare-hosted/self-hosted) - honojs
  desktop (windows/mac/linux) - electron
  mobile (android/iphone) - react native
- optional constraint -> make web read-only
  just upload static code and data
- syncable
  sync devices over wifi on home nework
- optional 'remote' (paid plan)

## PANES

### JOURNAL
- the main editing view: the canvas's first tab
- every entry has at most one category (design, build, fabrication, dev, notes…) and any number of tags
- tags are hierarchical and separated by '/' - e.g. system/windows/powertoys, design/davinci-resolve/til
- journal entries are 2-level: entry (title, category, tags) and children nodes
- a day groups its entries by category
- depending on the location of active cursor/button -> inherit properties (e.g. tags)
- image handling -> nodes can have images
  pasting an image creates a large preview of an image
  pasting more images keeps large preview 
  there is always an 'active' image
  first image in the gallery acts as the 'thumbnail' image

### TAGS
- tags pane has an option to show archived entries
  by default -> can't see 
- filter by archived/archived
- easily archive/unarchive nodes
  archived nodes are greyed out when archived=true is on
- should be able to 
  rename/delete/merge/branch tags
- hierarchical tags (e.g. tidewater/blog/a, tidewater/blog/b)
- not editable, but the UI contains dated stamps (linkified, easily open date in journal)
- ctrl+click opens up the node in the journal
- shift+click allows multiple selection of nodes
- easily archive -> show only 'unarchived' listings
  duplication is staleness -> need to have a 'fresh' view by actively archiving
  when re-writing sometinh, archive previous entries
  the current listing always shows 'up to date' view
  historical view is when 'show achived' option is toggled


### TYPES
- journal; bookmark (page, reddit, marketplace: the handlers); media (image, video)
- bookmarks and media each have a view of their own in the tags pane
- videos and AI chats moved out to youtube-lib and ai-lib (migration 0017_split_ai_youtube)
- the rest of the old canvas (map, activity, progress, dashboard, checklists) moved to logtracker

#### SHORTCUTS
- entry type: tagged shortcuts/<app>
- visualizes hotkeys from a node
- shows keyboard, also using modifiers activates keys visually
- actively archive old shortcuts, show warning sign by clashes

#### AI-PROMPTS
- moved to ai-lib (../ai-lib): every chat of claude-chat, claude-code, gemini-chat and gemini-code, with an MCP server



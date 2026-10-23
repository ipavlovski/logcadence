# LOGCADENCE

- purpose: knowledge base, similar to logseq
- 2-pane workflow journaling app: canvas/tags
- structure: journal with entries are first class citizens (the canvas's journal tab)
  allow tag view on the right (tag pane) and custom render views in the canvas's other tabs
- activity tracking (maps, activity, progress, dashboard, checklists, ...) lives in a separate app: logtracker (../logtracker)


## UI DESCRIPTION
- each pane can have multiple tabs
  - canvas has the journal tab (one day at a time, with back/forward through the days shown) and custom-based types depending on a rendering plugin (e.g. youtube, reddit, etc.)
  - tag pane has tabs corresponding to a tag (e.g. "system:windows")
- each pane has a primary tab, which opens on load and cannot be closed
  - canvas -> 'journal' tab (today on load)
  - tags -> 'tag tree' virtual view, showing all the existing tags 


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
- journal entries can have multiple tags, which can be viewed 
- tags are hierarchical and separated by colon- e.g. system:windows:powertoys, design:davinci-resolve:til
- all entries are 2-level: entry (contains title and categories) and children nodes
- first tag is considered to be a primary tag and is used to sort the entry in the journal view
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
- hierarchical tags (e.g. tidewater:blog:a, tidewater:blog:b)
- not editable, but the UI contains dated stamps (linkified, easily open date in journal)
- ctrl+click opens up the node in the journal
- shift+click allows multiple selection of nodes
- easily archive -> show only 'unarchived' listings
  duplication is staleness -> need to have a 'fresh' view by actively archiving
  when re-writing sometinh, archive previous entries
  the current listing always shows 'up to date' view
  historical view is when 'show achived' option is toggled


### CANVAS
- tabs: journal (primary), youtube, reddit, bookmarks, images, ai
- the rest of the old canvas (map, activity, progress, dashboard, checklists) moved to logtracker

#### SHORTCUTS
- entry type: must contain a single 'shortcuts:' category
- visualizes hotkeys from a node
- shows keyboard, also using modifiers activates keys visually
- actively archive old shortcuts, show warning sign by clashes

#### AI-PROMPTS
- track all the AI prompts from today
- eg. goole searches, gemini, claude
- logtracker keeps its own AI history (timestamp, model, title) and links each chat back here as logcadence://ai/<id>
  -> to do: register the logcadence:// link in the desktop app and open the chat in the AI tab



# LOGCADENCE

- purpose: knowledge base, similar to logseq
- 3-pane workflow journaling app: canvas/journal/tags
- structure: journal with entries are first class citizens (journal pane) 
  allow tag view on the right (tag pane) and custom render view on the left (canvas pane)


## UI DESCRIPTION
- each pane can have multiple tabs
  - canvas has custom-based types depending on a rendering plugin (e.g. dashboard, youtube, etc.)
  - journal pane has tabs corresponding to journal date (e.g. "sep 20, 2026", "oct 19, 2025")
  - tag pane has tabs corresponding to a tag (e.g. "system:windows")
- each pane has a primary tab, which opens on load and cannot be closed
  - canvas -> 'dashboard' tab
  - journal -> 'today' tab
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
- journal pane
  - ctrl+n -> new entry at the cursor
  - ctrl+shift+n -> new entry with UI popup
- tags pane
  - delete -> archive (toggle)
  - shift+delete -> delete

## IMPLEMENTATION
- db structure -> 2 sqlite databases
  - content.db -> all the notes
  - events.db -> all the events
- app data structure
  - journals: collection of .md files
  - db: content.db, events.db, maps.db, etc.
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
- the main editing pane
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

#### MAP
- processes a full day of GPX data into 
- classify movement into primary categories: A, B, A->B, B->A, B->B
  A=homebase (home, or hotel/hostel/camp when travelling)
  B=place
  A->B=homebase to place (going somwehre)
  B->B=place to place
  B->A=coming back
- movement gets automatically alloted a timestamp (start/end)
- can tag with "timelog:" to automatically pull timestamps into timetable

#### SHORTCUTS
- entry type: must contain a single 'shortcuts:' category
- visualizes hotkeys from a node
- shows keyboard, also using modifiers activates keys visually
- actively archive old shortcuts, show warning sign by clashes

#### SPOTIFY
- controls a spotify server/api
- requires an API key
- shows which playlist was listened to today
- shows stats on total tracks listened and liked

#### IMAGES
- reuse functionality of 
- would need a separate data structure to track 

#### PROGRESS
- vertical calendar with dates
- can show true scale (w/ day gaps) vs. false scale (remove gaps)
- each node should show a flat-list of finished tasks for a project
  header, image, description
- provide a visual helper in canvas to create a journal entry
  if project line is already visible, will apply the appropriate tags
- projects dont need to be 'projects'
  hp-d1, chicken coup -> all qualify
- view: fade the line out from top to bottom as scrolling through
- view: show a heatmap for a project
  squares can be cut into pieces to show multiple projects on a day

#### DASHBOARD
- heatmap
  columns: days of the week
  rows: build/dev/design/map/spotify/youtube/ai-prompts
- 3 last direction writeups
- calendar 
- task list
- sticky notes

#### AI-PROMPTS
- track all the AI prompts from today
- eg. goole searches, gemini, claude



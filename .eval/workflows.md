# Workflows inventory

This document is an exhaustive map of every user-facing workflow that exists in **davidup v1.0** today (engine version `0.1.0`, editor on branch `editor-implementation`). Workflows are grouped A–M; each entry lists entry points (HTTP endpoint / MCP tool / Vue component / CLI verb / keyboard shortcut), the happy-path steps, and notable parameters or gotchas.

The repository ships:
- A **dual-driver engine** (browser preview + Node render-to-MP4) at `src/`.
- An **AdonisJS 6 + Inertia + Vue 3 editor app** at `apps/editor/`.
- A **stdio MCP server** at `src/mcp/` with 41 tools.
- A **single `davidup` CLI** (`src/cli/bin.ts`) with subcommands `edit`, `new`, `list`, `recent`.
- A **standalone MCP binary** `davidup-mcp` (`src/mcp/bin.ts`).

The package exposes subpath exports — `davidup/schema`, `davidup/easings`, `davidup/engine`, `davidup/assets`, `davidup/node`, `davidup/browser`, `davidup/mcp`, `davidup/compose`, `davidup/cli/scaffold`.

---

## A. Getting started

### A.1 Install the engine
- **Entry point:** `bun install` at the repo root.
- **Steps:**
  1. Clone or download the repo.
  2. `bun install` — fetches deps, including bundled `ffmpeg-static` / `ffprobe-static` (so the integration test renders without a system ffmpeg).
  3. `bun run typecheck` — `tsc -p tsconfig.json --noEmit`, strict.
  4. `bun run test` — runs `vitest`; the suite includes `tests/drivers/node.integration.test.ts` which renders the §3.1 hello-world to MP4 and verifies it with ffprobe.
- **Requirements:** Bun ≥ 1.1 (Node ≥ 20 also works for most paths). ffmpeg on `$PATH` only required for `render_to_video` / `renderToFile`. macOS/Linux toolchain for the `skia-canvas` native build.

### A.2 Hello-world flavor 1 — browser preview
- **Entry points:** `bun run dev:browser` (script in `package.json`) → Vite serves `examples/browser-demo/` on its default port.
- **Steps:**
  1. `bun run dev:browser`.
  2. Open the browser. The page imports `attach` from `davidup/browser`, loads `examples/hello-world.json`, and calls `attach(comp, canvas)`.
  3. UI buttons exercise `handle.seek(seconds)` and `handle.stop()`.
- **Variants:** `dev:comprehensive`, `dev:comprehensive-split`, `dev:two-templates`, `dev:four-scenes` (and their corresponding `build:*` counterparts) — each Vite config maps to one of the example dirs (`examples/comprehensive-browser`, `examples/comprehensive-split-browser`, `examples/two-templates-browser`, `examples/four-scenes-browser`, plus `examples/ball-showcase-browser` referenced from the showcase script).
- **API surface used:** `import { attach } from "davidup/browser"` returns `{ stop, seek }`. `attach()` is async — it preloads images and fonts before the first paint.

### A.3 Hello-world flavor 2 — render to MP4 via JS API
- **Entry point:** `bun run examples/render.ts`.
- **Happy path:** load `examples/hello-world.json` → `validate(comp)` from `davidup/schema` → sample state with `computeStateAt` → render `examples/output/hello-world.frame-500ms.png` (single frame) → `renderToFile(comp, outPath, opts)` to write `examples/output/hello-world.mp4` (libx264, CRF 18, +faststart).
- **Minimal three-liner:**
  ```ts
  import { renderToFile } from "davidup/node";
  import { validate } from "davidup/schema";
  if (!validate(comp).valid) throw new Error("invalid");
  await renderToFile(comp, "out.mp4", { codec: "libx264", crf: 18 });
  ```
- **Notable:** one `Canvas` reused across every frame; RGBA bytes piped into ffmpeg's stdin with backpressure (`drain`). ffmpeg stderr tail surfaces inside any thrown `Error.message`.
- **Related canonical scripts:** `examples/comprehensive.ts`, `examples/comprehensive-split.ts`, `examples/two-templates-30s.ts`, `examples/four-scenes-60s/render.ts`, `examples/time-mapping-mcp/render.ts`.

### A.4 Hello-world flavor 3 — drive it with an MCP-aware agent
- **Entry points:**
  - Smoke test: `bun run src/mcp/bin.ts` (should hang waiting on stdin).
  - Bin: `davidup-mcp` (declared in `package.json` `bin`).
  - Helper script: `bun run mcp`.
- **Client wiring** (Claude Code `~/.claude.json`):
  ```jsonc
  { "mcpServers": { "davidup": { "command": "bun", "args": ["run", "/abs/path/to/davidup/src/mcp/bin.ts"] } } }
  ```
- **Other clients:** Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), MCP Inspector (`npx @modelcontextprotocol/inspector bun run src/mcp/bin.ts`), or any client using `@modelcontextprotocol/sdk`.
- **Manifest:** `server.json` at the repo root is the MCP-registry manifest.
- **Typical first prompt:** "build a 3-second clip with a logo that fades in and pops in scale" → agent calls `create_composition` → `add_layer` → `add_shape`/`add_sprite` → `add_tween` × N → `validate` → `render_preview_frame` → `render_to_video`. Full transcript: `examples/mcp-demo.md`.

---

## B. The editor UI

### B.1 Boot the editor (CLI)
- **Entry points:** `davidup edit <project-dir>` (via `davidup` CLI), or `npx davidup edit <dir>`, or direct: `bun run src/cli/bin.ts edit <dir>`.
- **Flags:**
  - `--port=<n>` (default `3333`)
  - `--host=<h>` (default `localhost`)
  - `--no-open` (skip auto-launching the browser)
- **Sequence (from `src/cli/edit.ts`):**
  1. Resolve `<project-dir>` and verify `composition.json` exists.
  2. Spawn the AdonisJS server in `apps/editor/` with `DAVIDUP_PROJECT=<absolute dir>`.
  3. Poll the server until reachable (default timeout 30 s).
  4. Open the browser unless `--no-open`.
  5. Watch the project directory; external `composition.json` changes trigger an in-memory reload via `POST /api/project`.
- **Output:** the CLI prints `davidup edit · serving at http://localhost:3333 (Ctrl+C to stop)`.

### B.2 Open the project picker
- **Entry point:** GET `/` → `HomeController#show` → renders `inertia/pages/home.vue`.
- **Props passed in:** `projects` (recent projects, pruned of missing dirs), `templates` (scaffold templates discovered under `src/cli/templates/`; default `basic`).
- **UI:** Two CTAs (`Open existing`, `Create new`), a `Recent projects` list, all on a dark hero background.
- **Open existing flow:** type a filesystem path → "Open project" → POST `/api/project` with `{ directory }`. On success navigates to `/editor` via `router.visit('/editor')`.
- **Create new flow:** project name + parent directory + template (dropdown of `templates` prop) → "Create & open" → POST `/api/projects` with `{ directory, name, template }`. Auto-loads on success.
- **Recents row:** click the row to re-open (POST `/api/project`); click the `×` button to forget the entry (DELETE `/api/projects/recent/:idx`). Forgetting does NOT delete the directory from disk.

### B.3 Editor layout (`/editor`)
- **Entry point:** GET `/editor` → `EditorController#show` → renders `inertia/pages/editor.vue` inside `inertia/layouts/editor.vue`.
- **Props on the Inertia page:** `composition`, `defaults` (precompiled snapshot, used by Inspector's "override" dot), `sourceMap` (precompile authorship trail), `compositionSource` (authored composition.json text + mtime), `project` (root, compositionPath, libraryIndexPath, assetsDir, loadedAt), `error`.
- **Five-region CSS grid layout** (32 px top bar + Library/Stage/Inspector + Timeline + 24 px status bar):
  - **App bar (top):** brand mark, project switcher dropdown, save-status pill (`Saved` / `Saving…` / `Error`), `RenderStrip`, help button (`?`).
  - **Library panel (left, ~280 px):** templates / behaviors / scenes / assets / fonts.
  - **Stage panel (center):** canvas + selection-ring overlay + drop overlays.
  - **Inspector panel (right, ~320 px):** typed property editor for the selected item or tween.
  - **Timeline panel (bottom, ~220 px):** ruler + per-item tracks with tween bars + playhead.
  - **Status bar (bottom 24 px):** error/warning pills, selection, playhead, stage status, render status.
- **Resize handles:** drag the 6-px gutters between Library/Stage, Stage/Inspector, and Stage/Timeline. Sizes persist via PUT `/api/editor-state` to `~/.davidup/state.json`.

### B.4 Keyboard shortcuts (`useShortcuts`)
The shortcut registry in `apps/editor/inertia/composables/useShortcuts.ts`:

| Keys | Action |
|---|---|
| `Space` | Toggle stage play/pause (restarts from 0 when ended) |
| `Backspace` | Delete the currently selected item (dispatches `remove_item`) |
| `⌘0` / `Ctrl+0` | "Fit timeline" — collapses to seeking playhead to t=0 |
| `⌘J` / `Ctrl+J` | Toggle the reveal-in-source drawer |
| `⌘R` / `Ctrl+R` | Start a render (intercepts the browser's page-reload default) |
| `⌘S` / `Ctrl+S` | Force flush / "save now" — emits a `Saved` toast since commands already round-trip |
| `?` | Toggle the Help overlay (accepts both `?` and Shift+/) |
| `Esc` | Dismiss overlays, menus, the project switcher dropdown |

The composable bails when the focus target is an `INPUT`, `TEXTAREA`, `SELECT`, or `contenteditable` element.

### B.5 Project switcher (in-editor)
- **UI:** Click the `davidup / <project-name> ▾` button in the app bar (`apps/editor/inertia/layouts/editor.vue`).
- **Mechanics:** fetches `GET /api/projects/recent`; click an entry to POST `/api/project { directory }`; click `Open another…` to navigate back to `/`.
- **Cross-tab updates:** the editor subscribes to `GET /api/projects/events` (SSE); when another tab swaps the project, the page emits a toast and `router.reload()`s.

### B.6 Help overlay
- **Entry:** `?` shortcut or the `?` button in the top-right of the app bar (`HelpOverlay.vue`).
- **Content sections:**
  - Keyboard shortcuts (mirror of B.4).
  - Drag & drop affordances (Library card → track / new-track gutter / stage; OS file → Library / anywhere; timeline bar resize / slide).
  - MCP tools cheat-sheet grouped into Composition / Assets / Layers / Items / Tweens / Templates & scenes / Render.
  - Links to README, design-doc.md, examples/mcp-demo.md.

---

## C. Composition authoring (items, layers, tweens, behaviors, templates, scenes)

### C.1 Add an item via drag (UI)
- **Entry points:**
  - Library panel card → drag onto Stage (any layer).
  - Library panel card → drag onto a Timeline track row (behaviors only attach to that row's target item; templates / scenes treated as "new track" drops).
  - Library panel card → drag onto the "new-track" drop gutter at the bottom of the tracks list.
- **Pipeline:** `useLibraryDrag` snapshots the card payload onto module state and into `dataTransfer` (MIME `application/x-davidup-library`). `buildCommandsForStageDrop`, `buildCommandsForTrackDrop`, and `buildCommandsForNewTrackDrop` (in `useLibraryDrag.ts`) translate the drop into one or more `Command`s. Commands flow through `useCommandBus.apply()` → `POST /api/command`.

### C.2 Add an item via the Inspector dropdown
- **Entry:** Inspector top-of-panel `<select>` `— select item —` (`Inspector.vue`).
- **Use:** mostly for **switching** between existing items rather than authoring. Items become selectable in this dropdown once `composition.items` and `composition.layers[*].items` exist.

### C.3 Add an item via MCP
- **Tools:** `add_sprite`, `add_text`, `add_shape`, `add_group` (`src/mcp/tools.ts` §4.4).
- **Common required inputs:** `layerId`, `x`, `y`; sprite adds `asset`, `width`, `height`; text adds `text`, `font`, `fontSize`, `color`; shape adds `kind` (`rect | circle | polygon`) plus the geometry that kind needs.
- **Optional:** `id` (deterministic), every transform field (`anchorX`, `anchorY`, `rotation`, `opacity`, `scaleX`, `scaleY`), `tint` (sprite), `align` (text), shape attributes (`fillColor`, `strokeColor`, `strokeWidth`, `cornerRadius`), `points` (polygon), `childItemIds` (group).
- **Server response:** `{ itemId }`.

### C.4 Update item properties
- **Inspector path:** each Inspector input dispatches one `update_item` command with `props: { [key]: value }`. Schemas:
  - Transform fields (every item type): `x`, `y`, `scaleX`, `scaleY`, `rotation` (radians), `anchorX`, `anchorY`, `opacity` (rendered as a 0–100 percent input).
  - Sprite: `asset`, `width`, `height`, `tint`.
  - Text: `text` (multi-line), `font`, `fontSize`, `color`, `align` (left/center/right).
  - Shape: `width`, `height`, `fillColor`, `strokeColor`, `strokeWidth`, `cornerRadius`.
  - Anything else (or an unknown Zod meta type) falls through to the `RawJson` editor — parses on blur, restores last good value if invalid.
- **MCP path:** `update_item` with flat `props`. Unknown keys for the item type error out (`E_INVALID_PROPERTY`).
- **Override dot:** the Inspector renders a small orange dot next to a field when the live value diverges from `defaults` (the precompile-time snapshot the server hands the page).

### C.5 Move an item between layers
- **MCP only:** `move_item_to_layer { itemId, targetLayerId }`. No bespoke UI affordance for layer reassignment in v1.0.

### C.6 Remove an item
- **UI:** select item → `Backspace` (`useShortcuts.deleteSelection` clears the selection then dispatches `remove_item`).
- **MCP:** `remove_item { id }` — cascades by deleting tweens that target the item.

### C.7 Create / update / remove layers
- **MCP tools:** `add_layer { z, id?, opacity?, blendMode? }`, `update_layer { id, props: { z?, opacity?, blendMode? } }`, `remove_layer { id, cascade? }`.
- **UI:** no dedicated layer panel in v1.0; layers from the project's `composition.json` are visible only through their items in Timeline rows and through the Inspector dropdown. Stage drops always target the highest-z layer (foreground).

### C.8 Add a tween (UI)
- **Implicit path:** drop a behavior card on a Timeline track row. `buildCommandsForTrackDrop` issues `apply_behavior` (which expands to one or more `add_tween`s).
- **MCP path:** `add_tween { target, property, from, to, start, duration, easing?, id? }`. Rejects with `E_TWEEN_OVERLAP` if it conflicts with another tween on the same `(target, property)`.

### C.9 Update a tween (drag / Inspector)
- **Drag bars in Timeline (`Timeline.vue` + `useTimelineDrag`):**
  - Grab a bar's body → slide horizontally to move `start`.
  - Grab a left/right edge → resize (`start` / `duration`).
  - Snap step defaults to 0.25 s; one `update_tween` command per gesture (on pointerup).
- **Tween editor in Inspector:** click a bar in Timeline → `useSelection.setTweenSelection` swaps the Inspector into tween-edit mode with `property` (enum from `listTweenable(item.type)`), `from`, `to`, `start`, `duration`, `easing` (enum from `EASING_NAMES` — 19 named easings). Each edit issues one `update_tween` command. Clicking the bar's "Edit item" button returns to item-edit mode without losing item selection.
- **MCP:** `update_tween { id, props: partial }` — re-validates overlap on the new window.

### C.10 Remove a tween
- **MCP:** `remove_tween { id }`. There is no Timeline UI shortcut for removing a tween in v1.0 — `Backspace` is wired to delete the selected **item**, not the selected tween.

### C.11 Behaviors (`apply_behavior`)
- **What:** named parameterized tween bundles. The 11 built-ins (`src/compose/behaviors.ts`):
  `fadeIn`, `fadeOut`, `popIn`, `popOut`, `slideIn`, `slideOut`, `rotateSpin`, `kenburns`, `shake`, `colorCycle`, `pulse`.
- **UI:** drag a Behavior card from the Library onto a Timeline track row.
- **MCP:** `apply_behavior { target, behavior, start, duration, params?, easing?, id? }`. Atomic — if any emitted tween conflicts, every tween added by the call is rolled back.
- **Discovery:** `list_behaviors` returns descriptors with params + produced tween suffixes.

### C.12 Templates (`apply_template`)
- **What:** registered prefabricated `{ items, tweens, params }` snippets. The five built-ins (`src/compose/builtInTemplates.ts`):
  `titleCard`, `lowerThird`, `captionBurst`, `bulletList`, `kenburnsImage`.
- **MCP tools:** `apply_template { templateId, layerId, start?, params?, id?, compositionId? }`, `list_templates`, `define_user_template { id, description?, params?, items, tweens? }`.
- **Behavior-aware:** any `$behavior` block inside a template's `tweens` is expanded before being committed. Whole expansion is atomic.
- **UI:** drag a Template card from the Library onto Stage or onto the new-track gutter; brand defaults pre-fill required params (the card's display name doubles as the default title for string-typed required params).

### C.13 Scenes (`add_scene_instance`)
- **What:** sealed mini-composition with its own `duration`, `items`, `tweens`, `params`, `assets`. The instance is expanded to a synthetic group + namespaced inner items + time-shifted tweens.
- **MCP tools:** `define_scene { id, duration, size?, background?, params?, assets?, items, tweens? }`, `import_scene { path, id? }` (load a scene JSON from disk and register), `list_scenes`, `remove_scene { sceneId }`, `add_scene_instance { sceneId, layerId, start?, params?, transform?, time?, id?, compositionId? }`, `update_scene_instance { instanceId, params?, transform?, start?, time? }`, `remove_scene_instance { instanceId }`.
- **Time mapping** (`time` field on `add_scene_instance` / `update_scene_instance`):
  - `{ mode: "identity" }` — baseline, default.
  - `{ mode: "clip", fromTime, toTime }` — trim a sub-range.
  - `{ mode: "loop", count }` — repeat back-to-back, `count` ≥ 1.
  - `{ mode: "timeScale", scale }` — divide every tween's start / duration by `scale`.
- **End-to-end demo:** `examples/time-mapping-mcp/` exercises all four modes via in-process MCP dispatch.

### C.14 Composition meta properties
- **MCP:** `set_composition_property { property, value }` where `property ∈ {width, height, fps, duration, background}`.
- **Inspect:** `get_composition` returns the full canonical JSON; useful for agent self-inspection.
- **Reset:** `reset { compositionId? }` drops the active (or specified) composition.

---

## D. Asset management

### D.1 Upload an asset (UI drag-and-drop)
- **Entry points:**
  - Drop one or more files onto the Library panel (`Library.vue`).
  - Drop files anywhere else on the editor (`editor.vue` window listeners); the page shows a full-screen drop veil while the drag is active.
- **Server:** `POST /api/assets` multipart; field `file`, optional `target` (`project` | `global`).
- **Server pipeline** (`asset_pipeline.ts` via `AssetsController#store`):
  1. Reject non-supported extensions (png/jpg/jpeg/webp/gif/svg/mp4/mov/webm/mkv/mp3/wav/ogg/m4a/aac/flac); size ≤ 50 MB.
  2. Hash the bytes → name file `<hash><ext>`.
  3. Run `ffprobe` / `loadImage` for metadata; generate a thumbnail when applicable.
  4. Register in the destination library's `index.json` (project or global).
- **Browser tracking:** `useAssetUpload` runs an XHR per file with progress events, surfacing toasts via `useToasts`.
- **Target selection:** the Library's scope pill (`📁 Project` / `🌐 Global` / `All`) selects upload target — `Global` writes to `~/.davidup/library`; otherwise files land in `<project>/assets/` and the project library.

### D.2 Browse the library
- **UI:** `Library.vue` — search box, scope tabs (`Project` / `Global` / `All`), kind tabs (`Templates` / `Behaviors` / `Scenes` / `Assets` / `Fonts`), grid of `LibraryCard` thumbnails.
- **Data source:** GET `/api/library` (`LibraryController#index`) with query params `q`, `kind`, `scope`. The controller returns `{ root, roots, loadedAt, attached, globalAttached, projectRoot, count, total, query, items, errors }`.
- **Watcher:** `library_index.ts` watches `library/index.json` + `library/**/*.{behavior,template,scene}.json`. Catalog refreshes within ~1 s; the panel also polls every 2 s for cross-tab changes.
- **Scope precedence:** project entries shadow global ones on `(kind, id)` collisions; the loser carries `overridden: true`.

### D.3 Thumbnails
- **Endpoint:** GET `/api/library/thumbnail?kind=<kind>&id=<id>` — synthesizes a 0.5 s preview frame via the same `render_preview_frame` code path; falls back to a deterministic placeholder PNG (`X-Thumbnail-Placeholder: 1` header).
- **Card behavior:** lazy-loads via `IntersectionObserver` (rootMargin 80 px); cache-busted by `lib.generation`.

### D.4 Register / list / remove assets (MCP)
- `register_asset { id, type ("image" | "font"), src, family? }` — fonts require `family`.
- `list_assets { compositionId? }` — declaration order.
- `remove_asset { id }` — errors `E_ASSET_IN_USE` if any item still references it. Idiomatic swap: re-`register_asset` with the same id over a new src — overwrite-by-id avoids the `in-use` failure.

### D.5 Library catalog through MCP
- `list_library { q?, kind?, scope? }` (only available when the MCP server is hosted inside the editor; standalone engine returns `E_UNKNOWN`).
- Returns the merged project + global catalog with `thumbnailUrl` per item pointing at the same `/api/library/thumbnail?...` URL the UI uses.

### D.6 Direct file access
- GET `/project-files/*` — streams a file from the loaded project root (path-traversal-guarded).
- GET `/library-files/*` — streams a file from the global library root (`$DAVIDUP_LIBRARY` or default `~/.davidup/library`).

---

## E. Live preview (stage)

### E.1 Mount the stage
- The browser driver is wired by `useStage` (`apps/editor/inertia/composables/useStage.ts`) — it dynamic-imports `davidup/browser` inside `onMounted`, awaits `attach(comp, canvas)`, and exposes `status`, `error`, `handle`, `playhead`, `restart`, `seek`, `stop`, `pause`, `resume`, `togglePlay`, `pickItemAt`, `getItemBoundsAt`, `onTick`.
- Status values: `'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'stopped' | 'error'`.

### E.2 Play / pause / seek
- `Space` → `togglePlay()`. When status is `ended`, restarts from t=0.
- Ruler click in Timeline → `emit('seek', t)` → `useStage.seek(t)`.
- `⌘0` → `seek(0)` (the "fit timeline / reset view" verb).
- The stage canvas re-attaches at the preserved playhead after every command (`useStage` tracks `lastAttachStartMs` so an Inspector edit mid-play doesn't jump back to 0).

### E.3 Click-to-select
- `Stage.vue` converts the click clientX/Y to composition pixels using the canvas's `getBoundingClientRect`, then calls `pickItemAt(x, y)` (the driver's hit-test). On hit it calls `useSelection.setSelectionFromPick(itemId, source)`; on miss it clears the selection (Figma-style).
- The picker carries `PickSourceInfo` (file + RFC 6901 JSON pointer + originKind) so the Inspector can render a `Source: …` provenance line and the SourceDrawer can scroll to the right line.

### E.4 Selection ring overlay
- A second `<canvas>` is layered above the render canvas. `Stage.vue` subscribes to `useStage.onTick` and asks `getItemBoundsAt(id)` each frame for the 4 corner points; strokes a brand-blue polygon. The ring rotates with the item's transform because corners come pre-transformed.

### E.5 Live drop preview on stage
- During a Library-card drag the Stage shows a dashed overlay (`drop-overlay`) with the label `Drop <kind> on stage · <name>`. Position becomes the drop coordinates.
- Stage drop currently only accepts `template`, `scene`, and `asset` payloads (behaviors fall back to track drops). Asset drop creates a sprite/text/etc., as resolved by `buildCommandsForStageDrop`.

---

## F. Inspector & properties

### F.1 Item editor (default)
- Pane sections:
  - **Transform** — 8 fields (x, y, scaleX, scaleY, rotation rad, anchorX, anchorY, opacity).
  - **Type-specific** — sprite (`asset`, `width`, `height`, `tint`), text (`text`, `font`, `fontSize`, `color`, `align`), shape (`width`, `height`, `fillColor`, `strokeColor`, `strokeWidth`, `cornerRadius`), group (none).
- Header chips: `selected item type`, an `AI edit` pill (`itemLastSource` shows the most recent command source — `'mcp'` lights it up).
- Provenance line: shows the item's authored source (file → friendly JSON pointer); click it (or hit `⌘J`) to open the SourceDrawer.

### F.2 Tween editor
- Triggered by clicking a Timeline bar; identified by `useSelection.selectedTweenId`. Shows `property`, `from`, `to`, `start`, `duration`, `easing`. "Edit item" button returns to the item editor.

### F.3 Property input components
Available under `inertia/components/inputs/`:
- `Number.vue` — slider + spinner (slider auto-appears when `min` and `max` are both defined).
- `String.vue` — single-line / multi-line text (`multiline` flag).
- `Color.vue` — hex / rgba.
- `Enum.vue` — `<select>` over a fixed option list.
- `Time.vue` — seconds editor (used for tween `start` / `duration`; bounded by composition duration).
- `Boolean.vue` — checkbox.
- `Percent.vue` — 0–100 percent input (used for opacity).
- `RawJson.vue` — fallback for any unknown Zod meta type; parses on blur, restores last good value if invalid (PRD R2 mitigation).

### F.4 Override "dot"
- Every field with a value that diverges from the precompile-time `defaults` shows a small orange dot. Defaults travel through `editor.vue`'s `defaults` prop (server-injected from `project.defaults` in `EditorController`).

### F.5 Reveal in source drawer (`SourceDrawer.vue`)
- Toggle with `⌘J` or by clicking the Inspector's provenance line, the Timeline bar's scene-source affordance (double-click sealed bars emits `openSceneSource`), or a validation issue row in the StatusBar.
- Drawer renders the authored `composition.json` text read-only, scrolls the active item / tween's line into view, and highlights it. Source text comes from `GET /api/composition-source` (re-fetched after each command).
- v1.0 only renders the loaded composition.json — if a picked source resides in another file (a `$ref`'d library), the drawer surfaces a note.

---

## G. Library panel

### G.1 Browse, search, refresh
- Search box (`useLibrary.query`) — debounced 150 ms.
- Tabs: kind (Templates / Behaviors / Scenes / Assets / Fonts), scope (Project / Global / All).
- `⟳` refresh button forces a re-fetch.
- The panel polls `/api/library` every 2 s when not in tests.

### G.2 Library cards
- Each `LibraryCard.vue` is a `draggable="true"` element. `onDragStart` sets the catalog payload onto `useLibraryDrag` state + `dataTransfer` (MIME `application/x-davidup-library`).
- The card shows name, description / id subtitle, scope chip (📁 / 🌐), kind label, and overridden marker when applicable.

### G.3 Drop targets and resulting commands
- **Stage drop:** templates, scenes, assets → `apply_template` / `add_scene_instance` / `add_sprite|add_text|add_shape` (depending on asset kind).
- **Track row drop:** behaviors → `apply_behavior` against that row's target. Templates / scenes treated as new-track drops.
- **"New track" gutter drop:** templates / scenes → `apply_template` / `add_scene_instance` against the first available layer at the snapped playhead time.

### G.4 Library indexing on disk
- Watched files (`apps/editor/app/services/library_index.ts`):
  - `<project>/library/index.json` (or `~/.davidup/library/index.json` for global).
  - Any `*.template.json` / `*.behavior.json` / `*.scene.json` under `library/`.
- Editor changes reach the UI within ~1 s.

### G.5 Upload toasts and queueing
- `useAssetUpload` maintains a `state.jobs` queue with `uploading | success | error` statuses, surfaced via `useToasts`. Successful uploads linger 4 s; errors linger 8 s.

---

## H. Rendering to MP4 (from the editor)

### H.1 Kick off a render
- **Entry points:**
  - "Render ▸" button in the `RenderStrip` (app bar).
  - `⌘R` shortcut (`useShortcuts.render` → `useRender.startRender`).
- **Request:** POST `/api/renders` with optional `{ filename }` (defaults to `<UTC stamp>.mp4`; filename must be a simple basename — no `..`, no `/`, no absolute paths).
- **Response (201):** `{ jobId, totalFrames, outputPath, relativeOutputPath, eventsUrl }`. Output lands in `<project>/renders/`.

### H.2 Watch progress
- Browser subscribes to `GET /api/renders/:id/events` (SSE). Events:
  - `progress { jobId, frame, total, elapsedMs }`
  - `done { jobId, outputPath, relativeOutputPath, frameCount, durationMs }`
  - `error { jobId, message }`
- UI: progress bar + frame counter + ETA + fps estimate; on `done` shows a green pill linking to `/project-renders/<basename>` for in-browser playback; on `error` shows the message + dismiss.
- A single render is allowed at a time — kicking a second one while one runs returns `{ error: { code: 'E_BUSY' } }`.

### H.3 Render history
- Component: `RenderHistory.vue` (collapsible inside the `RenderStrip`).
- Source: GET `/api/renders/files` lists `.mp4`s under `<project>/renders/`, newest first.
- Row actions (macOS only):
  - `Reveal` → POST `/api/renders/shell { filename, action: "reveal" }` — spawns `open -R <file>` (Finder).
  - `Play` → POST `/api/renders/shell { filename, action: "play" }` — spawns `open -a "QuickTime Player" <file>`.
  - Direct video link → opens `/project-renders/<filename>` in a new tab (`RendersController#file` is a guarded download stream).
- Non-macOS platforms get a 501 on the shell endpoint.

### H.4 Render queue inspection (MCP)
- `render_to_video { outputPath, codec?, crf?, preset?, pixFmt?, wait? }` — when hosted in the editor, enqueues a job and returns `{ jobId, status, outputPath, relativeOutputPath, totalFrames, eventsUrl? }` immediately. `wait: true` blocks until completion and returns the legacy blocking shape `{ ok, outputPath, durationMs, frameCount, jobId }`. The standalone engine ignores `wait` and is always blocking.
- `get_render { jobId }` — snapshot.
- `list_renders {}` — newest first; bounded retention.

### H.5 Render previews (MCP / Node)
- `render_preview_frame { time, format? }` → `{ image (base64), mimeType, width, height }`. Validates first; rejects `time < 0` with `E_INVALID_VALUE`.
- `render_thumbnail_strip { count, format? }` → `{ images[], times[], mimeType, width, height }`. `count: 1` returns the midpoint; `count ≥ 2` is a `linspace(0, duration, count)` over the timeline.

### H.6 ffmpeg options
- Codec: `libx264` (default) or `libx265`.
- `crf` — integer 0–63; default tuned to 18 in `examples/render.ts`.
- `preset` — passed through to ffmpeg.
- `pixFmt` — pixel format string.

---

## I. Programmatic API (Node / Browser SDK)

### I.1 Browser SDK (`davidup/browser`)
- `attach(comp: Composition, canvas: HTMLCanvasElement) → Promise<AttachHandle>`.
- `AttachHandle` exposes `stop()`, `seek(seconds)`, plus the hit-testing surface (`pickItemAt`, `getItemBoundsAt`) that the editor uses.
- The driver owns the RAF loop, asset preload (images + fonts), tween indexing.

### I.2 Node SDK (`davidup/node`)
- `renderToFile(comp, outPath, { codec, crf, preset, pixFmt }) → Promise<{ outputPath, durationMs, frameCount }>`.
- Allocates one `Canvas` reused across every frame (design-doc §5.7); pipes RGBA bytes to ffmpeg stdin with backpressure; surfaces ffmpeg stderr tail in any `Error.message`.

### I.3 Engine internals (`davidup/engine`, `davidup/easings`, `davidup/schema`, `davidup/assets`)
- `computeStateAt(comp, t)` returns a fully resolved scene at time `t` — no I/O, no globals.
- `renderFrame(comp, t, ctx, { assets, index? })` paints into any `Canvas2DContext`.
- `validate(comp)` runs schema + 8 semantic rules (tween overlap, group cycle, etc.).
- `EASING_NAMES` and `getEasing(name)` expose the 19 named easings.
- `NodeAssetLoader` / `BrowserAssetLoader` / `BaseAssetLoader` — pluggable for custom asset resolvers (CDN, S3, …).

### I.4 Compose helpers (`davidup/compose`)
- `expandBehavior(block)`, `expandBehaviors({ tweens })` — behavior pass.
- `expandTemplate(instanceId, instance)` — template pass.
- `expandSceneInstance(instanceId, scene)` — scene pass with optional time mapping.
- `registerTemplate`, `registerScene`, `getSceneDefinition`, etc.

### I.5 In-process MCP (`davidup/mcp`)
- `createServer()` builds a stdio server.
- `dispatchTool(name, args, deps)` runs a tool handler without spawning a subprocess — used by tests in `tests/mcp/` and by `examples/time-mapping-mcp/render.ts`.
- `TOOLS` exposes the registry; each entry has `name`, `title`, `description`, `inputSchema`, `handler`.

---

## J. CLI

The `davidup` binary (`src/cli/bin.ts` thin wrapper around `src/cli/cli.ts`):

### J.1 `davidup edit <dir>`
- Validates `<dir>/composition.json` exists.
- Spawns the AdonisJS editor with `DAVIDUP_PROJECT` set; polls until reachable; opens the browser.
- Flags: `--port=<n>`, `--host=<h>`, `--no-open`.
- Ctrl+C cleanly closes server + watcher.

### J.2 `davidup new <dir>`
- Calls `scaffoldProject` (`src/cli/scaffold.ts`) — writes:
  - `composition.json` (validated post-write).
  - `library/index.json` (empty).
  - `assets/.gitkeep`.
  - `renders/` (gitignored).
  - `.gitignore`.
  - `README.md`.
- Flags: `--template=<name>` (default `basic`; available templates listed via `listScaffoldTemplates`), `--force` (allow non-empty directory).
- Refuses non-empty directories without `--force` (`E_TARGET_NOT_EMPTY`).
- After success prints `Next: davidup edit <dir>`.

### J.3 `davidup list` / `davidup recent`
- Reads `~/.davidup/recents.json` (override via `DAVIDUP_STATE_DIR`).
- Prunes entries whose directories no longer resolve.
- Prints an ASCII table with columns NAME / PATH / LAST OPENED / MODIFIED.

### J.4 `davidup --help` / `davidup --version`
- Standard help / version output.

### J.5 `davidup-mcp` (separate bin)
- Bin shim at `src/mcp/bin.ts` — instantiates `createServer()`, attaches stdio.
- Used directly by MCP clients (Claude Code, Claude Desktop, MCP Inspector).

### J.6 Package scripts (`package.json`)
- `bun run build` / `typecheck` / `test` / `test:watch`.
- `bun run dev:browser` and variants (B.1.A.2).
- `bun run mcp` — alias of `bun run src/mcp/bin.ts`.
- `bun run cli` — alias of `bun run src/cli/bin.ts`.

---

## K. AI agents via MCP

### K.1 Installing the MCP server
- Standalone: configure your client to launch `bun run /abs/path/to/davidup/src/mcp/bin.ts`. Use **absolute paths** (clients spawn from their own cwd).
- For environments without bun, replace with `node --experimental-strip-types`.
- Editor-hosted (recommended for project work): launch `davidup edit <dir>` with `DAVIDUP_MCP_STDIO=1` so `apps/editor/start/preload_mcp_stdio.ts` mounts the same MCP surface on stdio of the editor process. With the bridge active, MCP mutations flow through the editor's CommandBus (`source: 'mcp'`) so UI and agent see byte-identical state.

### K.2 Client configurations
- **Claude Code:** edit `~/.claude.json`, add an entry under `mcpServers`; alternatively `claude mcp add davidup --command bun --args run /abs/path/to/davidup/src/mcp/bin.ts`. Use `/mcp` in Claude Code to verify the 41 tools.
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Restart the app after editing.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector bun run src/mcp/bin.ts`.
- **Custom SDK client:** import `@modelcontextprotocol/sdk` and use `StdioClientTransport({ command: "bun", args: [...] })`.

### K.3 Tool catalog (41 tools)
Grouped per `apps/editor/inertia/components/HelpOverlay.vue` and `src/mcp/tools.ts`:

| Group | Tools |
|---|---|
| Composition lifecycle (§4.1) | `create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset` |
| Assets (§4.2) | `register_asset`, `list_assets`, `remove_asset` |
| Layers (§4.3) | `add_layer`, `update_layer`, `remove_layer` |
| Items (§4.4) | `add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item` |
| Tweens (§4.5) | `add_tween`, `update_tween`, `remove_tween`, `list_tweens` |
| Behaviors (§4.5b) | `apply_behavior`, `list_behaviors` |
| Templates (§4.5c) | `apply_template`, `list_templates`, `define_user_template` |
| Scenes (§4.5d) | `define_scene`, `import_scene`, `list_scenes`, `remove_scene`, `add_scene_instance`, `update_scene_instance`, `remove_scene_instance` |
| Render (§4.6) | `render_preview_frame`, `render_thumbnail_strip`, `render_to_video`, `get_render`, `list_renders` |
| Project lifecycle (§4.7) — editor-only | `current_project`, `list_projects`, `open_project`, `create_project` |
| Library (§4.8) — editor-only | `list_library` |

### K.4 Recommended agent flow (design-doc §4.7)
`add_*` → `validate` → `render_preview_frame` at key beats → `render_to_video`. Walkthrough: `examples/mcp-demo.md`.

### K.5 Inspecting frames as base64
- `render_preview_frame { time, format? }` returns a base64-encoded PNG/JPEG. MCP clients (Claude Code, Claude Desktop) render the image inline.
- `render_thumbnail_strip { count, format? }` returns a strip across the timeline.

### K.6 Error codes agents should branch on
Stable strings (`src/mcp/errors.ts`): `E_NO_COMPOSITION`, `E_DUPLICATE_ID`, `E_NOT_FOUND`, `E_VALIDATION_FAILED`, `E_TWEEN_OVERLAP`, `E_ASSET_IN_USE`, `E_ASSET_TYPE_MISMATCH`, `E_ASSET_CONFLICT`, `E_LAYER_NOT_EMPTY`, `E_INVALID_PROPERTY`, `E_INVALID_VALUE`, `E_RENDER_FAILED`, `E_SCENE_UNKNOWN`, `E_UNKNOWN`. Editor-side commands additionally surface `E_TIME_MAPPING_TWEEN_SPLIT`, `E_TARGET_NOT_EMPTY`, `E_TEMPLATE_NOT_FOUND`, `E_TEMPLATE_INVALID`. Project lifecycle tools surface `E_PROJECT_NOT_FOUND`, `E_COMPOSITION_MISSING`, `E_FORBIDDEN_PATH`.

### K.7 Idempotency
Every `add_*` / `register_asset` accepts an optional `id`. Always supply one — retried calls return `E_DUPLICATE_ID` instead of silently duplicating, and transcripts replay deterministically. Auto-generated ids use `<prefix>-<n>` (`layer-1`, `item-3`, `tween-7`, `comp-2`).

### K.8 Project lifecycle tools (editor-hosted only)
- `current_project` → `{ project }` snapshot (root, paths, loadedAt).
- `list_projects` → `{ projects: RecentProjectInfo[] }`.
- `open_project { path }` → loads the project (same controller path as POST `/api/project`). Returns `E_NOT_FOUND` if no composition.json exists at `path`; `E_INVALID_VALUE` if path is malformed; `E_FORBIDDEN_PATH` if it targets a protected system location.
- `create_project { name, location, template? }` → scaffolds under `<location>/<name>` and loads it (same controller path as POST `/api/projects`). Errors map: `E_TARGET_NOT_EMPTY` → `E_INVALID_VALUE`, `E_TEMPLATE_NOT_FOUND` → `E_NOT_FOUND`.

### K.9 Worked example: "make a 10s ad for Acme Coffee from a description"
A canonical sequence — agent issues (matches the structure used throughout `examples/mcp-demo.md` and `examples/time-mapping-mcp/`):
```
create_composition { width: 1280, height: 720, fps: 60, duration: 10, background: "#0a0e27" }
add_layer { id: "bg", z: 0 }
add_layer { id: "fg", z: 10 }
register_asset { id: "logo", type: "image", src: "./assets/logo.png" }
apply_template { templateId: "titleCard", layerId: "fg", params: { title: "Acme Coffee", subtitle: "Wake up." } }
add_sprite { layerId: "bg", asset: "logo", x: 640, y: 360, width: 400, height: 400, opacity: 0 }
apply_behavior { target: "<sprite-id>", behavior: "fadeIn", start: 0, duration: 1.5 }
apply_behavior { target: "<sprite-id>", behavior: "kenburns", start: 1.5, duration: 7 }
validate {}
render_preview_frame { time: 5 }
render_thumbnail_strip { count: 6 }
render_to_video { outputPath: "/abs/path/acme.mp4", codec: "libx264", crf: 18 }
```

---

## L. Determinism & verification

### L.1 Same composition, same pixels
- `renderFrame(comp, t, ctx)` is a pure function of `(comp, t)` — no PRNG, no I/O, no globals (v0.1 has no PRNG at all; design-doc Q10).
- The engine output before encoding is bit-deterministic; final MP4 bytes depend on the skia-canvas + ffmpeg versions installed.

### L.2 Verifying determinism
- Render the same composition twice with `renderToFile` and diff the MP4 bytes. The integration test `tests/drivers/node.integration.test.ts` is the canonical smoke check.
- For frame-level verification: `render_preview_frame` at the same `t` should return the same base64.
- For agent loops: cache `render_preview_frame` results keyed on `{ compositionId, time, schema-version }`.

### L.3 Validation
- `validate { compositionId? }` returns `{ valid, errors, warnings }`. Render tools short-circuit with `E_VALIDATION_FAILED` if invalid.
- The editor's `useValidation` composable re-validates on every command apply; the StatusBar shows live error/warning counts and lists clickable issues that route the SourceDrawer to the exact line.

---

## M. Project & state lifecycle

### M.1 Create a project
- UI: project picker → "Create new".
- CLI: `davidup new ./my-clip` (optionally `--template=<name>` / `--force`).
- MCP (editor-hosted): `create_project { name, location, template? }`.

### M.2 Open a project
- UI: project picker → "Open existing" or click a recents row.
- CLI: `davidup edit ./my-clip`.
- HTTP: POST `/api/project { directory }`.
- MCP (editor-hosted): `open_project { path }`.

### M.3 Save / autosave
- Every `Command` round-trips through `POST /api/command`. The `ProjectStore` (`apps/editor/app/services/project_store.ts`) writes `composition.json` via a **debounced writer** — so the file on disk converges to the in-memory state without manual saves.
- `⌘S` is a UX affordance: it surfaces a `Saved` toast (showing the composition file path) since persistence is already happening.
- The Inertia page exposes a `Saved` / `Saving…` / `Error` pill in the app bar; the SourceDrawer awaits `projectStore.flush()` before reading the file so the displayed text is never stale.

### M.4 Recent projects
- Stored in `~/.davidup/recents.json` (override via `DAVIDUP_STATE_DIR`).
- GET `/api/projects/recent` returns the pruned list (missing dirs are filtered).
- DELETE `/api/projects/recent/:idx` forgets one entry (does NOT delete the directory).

### M.5 External edits to composition.json
- The editor server reloads the in-memory `ProjectStore` whenever `composition.json` is edited externally (the `davidup edit` CLI installs a watcher that POSTs `/api/project` again).
- The `GET /api/projects/events` SSE endpoint broadcasts `changed { type, root, at }` on every reload. Pages subscribe via `EventSource` and `router.reload()` to refresh Inertia props.

### M.6 Undo / redo
- `CommandBus.apply` snapshots the previous state before each command; the response carries `undoStackSize`.
- No keyboard shortcut binds `⌘Z` / `⌘⇧Z` in v1.0. The undo machinery exists server-side; the UI surface for invoking it is **not** wired (see polish_plan §R-P1).

### M.7 Project files on disk
The scaffolded layout is:
```
<project-root>/
  composition.json     authored canonical JSON
  library/
    index.json         local library catalog
    *.template.json    user templates
    *.behavior.json    user behavior aliases
    *.scene.json       user scenes
  assets/.gitkeep
  renders/             rendered MP4s (created on first render)
  .gitignore
  README.md
```
The global library lives at `~/.davidup/library/` (override via `DAVIDUP_LIBRARY`); the editor state (panel layout) at `~/.davidup/state.json`; recents at `~/.davidup/recents.json`.

### M.8 Importing a scene from JSON
- MCP: `import_scene { path, id? }` reads a JSON file from disk and registers it (path defined relative to the editor server's cwd or absolute). Useful for sharing scenes across projects without manually copying their `define_scene` payload.

### M.9 Export composition as JSON
- MCP: `get_composition { compositionId? }` returns the canonical JSON. Combined with `define_scene` / `import_scene` this is how a user shares compositions.
- File-on-disk: `<project>/composition.json` is the authored form (with `$template`, `$ref`, `$behavior`, scene instances). The precompile pipeline lowers it to the canonical resolved form; the editor's source drawer always displays the authored text.

### M.10 Editor state persistence
- GET `/api/editor-state` / PUT `/api/editor-state` back the `usePanelLayout` composable. The state file (`~/.davidup/state.json`) holds panel sizes (`leftWidth`, `rightWidth`, `bottomHeight`); future panel-layout fields are merged in additively.

---

## Open questions / things I couldn't verify

- **Render queue retention bounds.** `list_renders` says "The queue retains a bounded number of completed jobs; older ones are evicted lazily." The exact retention count isn't surfaced in the code paths I read (would live in `apps/editor/app/workers/render_worker.ts`).
- **HelpOverlay's tool count.** The README and `examples/mcp-demo.md` both quote "25 tools" — accurate when written but the engine has since grown to **41 tools** (`src/mcp/tools.ts` `TOOLS` array). The HelpOverlay (`HelpOverlay.vue`) lists ~36 tools across its groups (missing `get_render`, `list_renders`, plus the four `*_project` tools and `list_library`). The 41-figure I derived from the array literal in `src/mcp/tools.ts`.
- **Editor server port collisions.** `--port` validation is in `cli.ts`, but I didn't trace the behaviour when the chosen port is already bound (likely surfaces as `E_SERVER_TIMEOUT` after the ready-poll loop times out, but unverified).
- **Tween deletion via UI.** `Backspace` deletes the selected **item**; no keyboard or menu affordance for deleting an individual tween was found. Users go through MCP (`remove_tween`) or by removing the bar's source (e.g., delete the item the tween targets).
- **Undo/redo surface.** The CommandBus exposes `undoStackSize` in every response, but I found no UI binding for it.
- **Inertia / Vite dev mode vs production.** I didn't verify whether `davidup edit` serves the Vite-built bundle or the dev server in production CLI usage; `apps/editor/vite.config.ts` exists but the boot path inside `runEdit` was only partially read.
- **`DAVIDUP_STATE_DIR` semantics.** Honoured by the CLI's recents lookup; whether the editor process also honours it for `state.json` / `library/` paths isn't verified (the global library uses `DAVIDUP_LIBRARY` explicitly).
- **Audio in renders.** README roadmap mentions audio muxing as v0.2 — there's no audio path through `renderToFile` in v0.1 / v1.0 today.

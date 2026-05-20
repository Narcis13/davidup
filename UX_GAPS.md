# UX Gaps — Human-Editor Affordances Missing from `apps/editor`

davidup is AI-agent-first by design: the canonical surface is MCP, and every mutation
flows through the same `Command` discriminated union (`apps/editor/app/types/commands.ts`).
The web editor (Adonis + Inertia + Vue) is a *thin shell* around that contract — which
means many editor operations the engine supports have no human-clickable equivalent. A
sufficiently determined user has to lean on an AI agent or hand-edit the JSON.

This document is the punch list for closing that gap, written so future Claude Code
sessions can pick a single item and implement it without rediscovering context.

The golden rule: **never invent a new mutation path**. Every UI affordance dispatches an
existing command in `commands.ts`. The MCP/HTTP/UI surfaces must remain equivalent.

---

## What works today (baseline)

For each affordance below, the **command** column is the literal `kind` field the UI
already dispatches.

| Affordance | Where | Command |
|---|---|---|
| Open / create project | `pages/home.vue` | `POST /api/project`, `POST /api/projects` |
| Drop file → register asset | `Library.vue` (drop zone) | `POST /api/assets` (multipart) |
| Drag library card → Stage / Timeline | `useLibraryDrag.ts` | `apply_template`, `apply_behavior`, `add_sprite`, `add_scene_instance` |
| Click item on Stage → select | `Stage.vue` `onCanvasClick` | (selection only, no command) |
| Edit transform / shape / text / sprite fields | `Inspector.vue` | `update_item` |
| Edit tween from / to / start / duration / easing | `Inspector.vue` (tween mode) | `update_tween` |
| Drag timeline bar edges/body | `Timeline.vue` | `update_tween` |
| Delete selection (Backspace) | `editor.vue:deleteSelection` | `remove_item` |
| Render preview | ⌘R / button | `POST /api/renders` |
| Save (force flush toast) | ⌘S | — |
| Fit timeline (reset playhead) | ⌘0 | — |
| Toggle source drawer | ⌘J | — |
| Help overlay | `?` button / `?` key | `HelpOverlay.vue` |
| Promote library item project → global | `LibraryCard.vue` `↑ 🌐` button | `POST /api/library/promote` |
| Save new template/behavior/scene | `Library.vue` `+ New` button | `POST /api/library/definitions` |

Keyboard shortcuts inventory lives in `HelpOverlay.vue:30-39`. Add new shortcuts there too
when expanding the surface.

---

## Gap inventory

### A. Item creation from scratch (HIGH PRIORITY)

The single biggest cliff: **a freshly scaffolded project (`basic` template, single badge)
has no UI path to add a second item**. The user is forced to either drag a template/scene
from the library (which is empty in fresh projects) or drop an asset file (which produces
a sprite, but only for binary files). Shapes and text — the two most common primitives —
have *no* UI path.

| Item type | Server command | UI today | UX gap |
|---|---|---|---|
| Shape (rect / circle / polygon) | `add_shape` | none | "+ Shape" tool / button missing |
| Text | `add_text` | none | "+ Text" tool / button missing |
| Sprite | `add_sprite` | only via library card drag | "+ Sprite" needs to allow picking an existing registered asset; today only "drop file" works |
| Group | `add_group` | none | "+ Group from selection" missing |
| Scene instance | `add_scene_instance` | drag scene from library | no explicit button |
| Layer | `add_layer` | none | (see section B) |

**Recommended UI shape**: a vertical *toolbar* docked left of the Stage with one button
per primitive. Click → switches to "place" mode → next click on Stage drops the item at
those coords with safe defaults (e.g. `width=240, height=120, fillColor=#5b7cfa` for rect;
`fontSize=48` for text). Use the active layer (top-most in `composition.layers`) unless
the user is hovering a specific Layer in the future Layers panel (section B).

For text: prompt for the text string before placing (small inline input that appears in
the toolbar). For sprite: open a picker showing currently-registered assets.

Defaults to bake in:
- Center on stage if no click coord given: `x = comp.width / 2, y = comp.height / 2`
- `anchorX = anchorY = 0.5` (consistent with template usage in repo)
- ID: derive from kind + monotonic count, e.g. `rect_1`, `text_2` (validate uniqueness
  before dispatch; `add_*` commands accept optional `id`)

### B. Layers panel (HIGH PRIORITY)

There's no UI to:
- See the layer list and their items
- Add a new layer
- Reorder layers (z-index via `update_layer`)
- Rename a layer
- Toggle layer visibility (no such field today — would need engine support: opacity=0
  trick works, but a dedicated `visible: boolean` would be cleaner)
- Lock a layer (no engine support; either skip or add a flag)
- Edit `layer.opacity` and `layer.blendMode` (engine supports both; **`BlendModeSchema`
  is already imported in `commands.ts:22`** — the recent BlendModeSchema-missing crash
  was a bun snapshot-staleness issue, the schema is real and load-bearing)

**Recommended UI shape**: collapsible left-side panel above the toolbar from section A.
Photoshop-style list: drag to reorder, click to set active, double-click to rename,
inline opacity slider + blendMode dropdown.

Server commands: `add_layer`, `update_layer`, `remove_layer`, `move_item_to_layer`.

### C. Tween authoring (HIGH PRIORITY)

Inspector already edits *existing* tweens. Two missing pieces:

1. **Add tween** — for a selected item + property, no UI exists to dispatch `add_tween`.
   The user has to drag a library template that brings tweens with it. There's no
   "animate this property" affordance.
2. **Remove tween** — there's no delete-tween UI. Selecting a tween bar in Timeline and
   pressing Backspace currently deletes the *item* the bar targets (verify in
   `editor.vue:deleteSelection`); we need a tween-aware delete.

**Recommended UI shape**:
- Inspector: tiny `+ animate` icon next to every animatable field (use `listTweenable`
  from `davidup/compose` to know which fields qualify). Click → opens a small popover
  with start / duration / from / to / easing.
- Timeline: when a tween bar is selected (`selection.selectedTweenId.value` non-null),
  Backspace dispatches `remove_tween` instead of `remove_item`.
- Inspector tween mode: show a "Delete tween" button.

### D. Composition settings (MEDIUM)

`composition.composition` (width / height / fps / duration / background) has no UI.
`set_composition_property` exists server-side.

**Recommended UI shape**: a "⚙ Composition" button in the editor header that opens a
small modal (reuse the dialog styling from `SaveDefinitionDialog.vue`). Inputs:
width, height, fps, duration, background color picker. Submit dispatches one
`set_composition_property` per changed field (the command takes a single
`property/value` pair per call — batch in the UI but send N commands).

### E. Move items between layers (MEDIUM)

`move_item_to_layer` exists. UI: in the Inspector or Outliner, a "Layer:" dropdown
listing every layer in the composition; changing it dispatches the command.

### F. Outliner / Item navigator (MEDIUM)

A tree view that mirrors `composition.layers[].items[]` with group expansion. Use
cases: jump-to-select for items occluded on Stage, multi-select foundation, drag
within the tree to reorder / change parents. Without it, deeply-nested groups or
clipped/off-stage items are unreachable from the UI.

Read-only is already half-built: the Library panel knows how to filter; reuse the
panel-card aesthetic for tree rows.

### G. Stage interaction beyond click-to-select (HIGH PRIORITY)

The Stage canvas only **selects** on click (`Stage.vue:onCanvasClick`). It does **not**:

- Drag the selected item to move it (`update_item.props.x/y`)
- Show resize handles on the selection ring (`update_item.props.width/height` for shape;
  `transform.scaleX/Y` for sprite)
- Show a rotation handle (`update_item.props.rotation`)
- Pan / zoom the canvas
- Snap to other items / centre / grid

The selection ring overlay is `pointer-events: none` by design (`Stage.vue:392`). To add
manipulation, we need a separate transparent layer above the overlay that listens for
pointer events on handles.

**Recommended shape**:
- Phase 1: drag the item body to translate. Pointer-down on a selected item's bounding
  box → start drag → emit `update_item` on pointer-up (debounced) or on `pointermove` for
  live feedback (latter requires command coalescing; the `commandBus` already round-trips
  every change — for drag, send updates throttled to 30Hz and let the server's undo
  stack absorb).
- Phase 2: corner/edge handles for resize, top-edge handle for rotation. Holding
  Shift → constrain proportions / rotate in 15° increments.
- Phase 3: marquee select (drag on empty stage to lasso), multi-select.

### H. Undo / redo (HIGH PRIORITY)

The server already maintains an undo stack (`apply_command.ts`; every command response
includes `undoStackSize`). There's no UI button or shortcut.

**Recommended shape**:
- Buttons in the editor header: `↶` undo / `↷` redo, disabled when stack empty.
- Shortcuts: ⌘Z / ⌘⇧Z (register in `editor.vue` shortcut handlers; document in
  `HelpOverlay.vue:30-39`).
- New endpoints: `POST /api/command/undo`, `POST /api/command/redo` — both already
  exist in the bus (check `app/services/command_bus.ts`); confirm and wire.

### I. Apply-with-params dialogs (MEDIUM)

Dragging a template/behavior from Library applies it with **default param values only**
(`useLibraryDrag.ts:263`). For non-trivial templates with required params this is wrong:
the agent path lets you specify params, the human path doesn't.

**Recommended shape**: when the dragged template has `params.length > 0` and any
`required: true && default === undefined` param, intercept the drop and open a param
editor modal (number / string / color / boolean inputs derived from
`TemplateParamDescriptor`). Same for `apply_behavior` and `add_scene_instance`.

### J. Asset management UI (MEDIUM)

- **Re-register** without re-uploading (point a sprite at a different asset): Inspector's
  `asset` field is a raw text input. Replace with an asset picker dropdown enumerating
  `composition.assets`.
- **Remove asset**: `remove_asset` MCP exists; no UI. Library Assets tab should let
  user delete unused assets (with usage check).
- **Asset usage panel**: when an asset is selected in the Library, show which items
  reference it (and prevent removal if `usages > 0` without confirm).

### K. Font / color / easing pickers (LOW)

- Font: Library has a Fonts tab; Inspector text item's `font` field is plain text.
  Wire it to a dropdown sourced from `composition.assets.filter(a => a.type === 'font')`.
- Color: native `<input type="color">` is fine v1; bigger lift is a swatches strip
  (e.g. last 8 used colors) plus a "pick from canvas" eyedropper.
- Easing: list every name from `EASING_NAMES` in `Inspector.vue` tween editor as a
  searchable dropdown (already a select; verify).

### L. Group / ungroup (MEDIUM)

`add_group` exists. UX: select 2+ items → "Group" button or ⌘G; group → "Ungroup" or
⌘⇧G (which would need a new command — the engine supports groups but not in-place
ungroup; alternative: a UI-side flatten that issues N `update_item` + 1 `remove_item`).

### M. Hide / lock (LOW-MEDIUM)

No engine support. Two options:
1. Add `visible: boolean` and `locked: boolean` to the schema (engine + validator + UI).
2. UI-only: track in client state; `visible=false` overlays a mask layer; `locked`
   blocks Inspector edits client-side. Doesn't persist; not great.

Pick option 1 if doing this — it's also useful for AI agents (e.g., "hide this layer
while I work").

### N. Render configuration UI (LOW)

`POST /api/renders` exists; `RenderStrip.vue` renders previews. No UI to pick:
- Output dimensions / scale
- FPS override
- Codec / quality preset
- Frame range (start / end)

A minimal "Render dialog" before kickoff: width/height/fps/preset radio (Draft / Final /
Web). Default to the composition values; remember last choice in `editor-state`.

### O. Outputs / renders panel improvements (LOW)

`RenderHistory.vue` shows past renders. Gaps:
- No "open output folder" button (would need OS-level shell open; out of scope)
- No bulk delete
- No tagging / naming a render

### P. Naming and friendly identifiers (LOW)

Items, layers, and tweens all use raw IDs (`badge`, `fg`, `fade-in`). The schema doesn't
support a `name` field. Adding one (engine schema change) would let the Inspector show
human-friendly names without breaking ID-based references. Useful but not critical.

### Q. Multi-select (MEDIUM, foundation)

Single-item selection only. Required for: group-from-selection (section L), bulk
property changes ("set opacity to 0.5 on all selected"), marquee drag on Stage.

Selection store change: `selectedItemId: string | null` → `selectedItemIds: string[]`.
Inspector either shows the common properties only when all selected are same type, or
shows "Mixed" badges per field (Figma-style).

### R. Validation issue navigation (LOW)

StatusBar already surfaces validation issues (`composition` errors). Clicking should
deep-link to the offending item via `selection.setSelectionFromPick` and open
`SourceDrawer` to the relevant JSON pointer. Verify whether this works today.

### S. Empty-state onboarding (LOW)

Fresh `basic` project lands on a single orange badge. Replace the placeholder with:
- A short "Get started" overlay on first load with three CTAs:
  - "+ Add shape" → opens the future toolbar (section A)
  - "Browse templates" → focuses the Library Templates tab
  - "Drop files to import assets" → flashes the drop zone
- Dismiss persists in `editor-state` so it doesn't reappear.

### T. Help / discoverability hooks

`HelpOverlay.vue:30-39` lists shortcuts; keep it the canonical source. Every section
above that introduces a shortcut must also append to that list — there's no test that
catches drift, so this is a manual discipline.

---

## Suggested implementation order

Sequenced for maximum user-perceptible improvement per merge:

1. **A. Item creation toolbar** — primitives (shape, text). Unlocks "from-scratch" use.
2. **G. Stage drag-to-move** (phase 1 only). Pairs with #1 to make placement feel real.
3. **H. Undo / redo** wiring (server already does the work).
4. **B. Layers panel** — enables visual stacking. Pre-requisite for nested compositions.
5. **C. Tween authoring** (add / delete from Inspector + Timeline).
6. **D. Composition settings dialog**.
7. **F. Outliner** — required for non-trivial compositions.
8. **I. Apply-with-params dialogs**.
9. **G. Stage drag-to-move** (phases 2-3: handles, marquee).
10. **L. Group / ungroup**, **Q. multi-select** (these unlock together).
11. Long tail: asset management, font picker, render config, hide/lock, naming, etc.

---

## Implementation guardrails

When picking up any section above:

- **Command-bus equivalence**: the UI dispatches commands through `useCommandBus`; never
  call the file/composition state directly. If a command shape is missing, extend
  `commands.ts` *and* the matching MCP tool in `src/mcp/tools.ts` so both surfaces stay
  equivalent. Keep `payload` shapes identical.
- **Validation**: rely on the Zod schema in `commands.ts`. Don't add a parallel
  client-side validator — let the server's 4xx be the truth.
- **State refresh**: every mutating command's response carries `composition` — the bus
  hydrates it, the UI just reads `bus.composition.value`. No need to refetch.
- **Source maps**: when adding items the precompiler emits a source map; the Inspector's
  "reveal in source" hinges on it. New items created by the UI must end up with sensible
  `originKind: 'plain'` so the Timeline colours bars correctly (`TimelineTrack.vue:25`).
- **Selection invariants**: the `useSelection` store is the only owner of
  `selectedItemId` + `selectedTweenId`. Always clear selection *before* a destructive
  dispatch (see `editor.vue:deleteSelection`) so the Inspector doesn't render a stale
  item between command + response.
- **Library catalog**: any UI that writes a library file (templates, behaviors, scenes,
  assets) must call `libraryIndex.reloadNow()` server-side so the response reflects the
  catalog change — `flush()` is not sufficient (no debounce timer == no-op). See
  `apps/editor/app/services/library_index.ts:reloadNow`.
- **Tests**: per `apps/editor/tests/functional/` and `tests/unit/`. Every new endpoint
  needs a functional spec; new composables need unit specs. Run with `node ace test`.
- **Typechecking**: `bunx tsc --noEmit` from `apps/editor/`. Many pre-existing DOM-type
  errors in `inertia/` are noise; filter to changed files.
- **HMR boundaries**: only files under `app/controllers/**` and `app/middleware/**` hot-
  reload (see `package.json:hotHook.boundaries`). Service / type / route changes require
  a full server restart.

---

## Anti-patterns to avoid

- **Don't** add a "save composition" button. Mutations already persist via the command
  bus; the ⌘S "save" is intentionally just an acknowledgement toast.
- **Don't** mirror MCP tools 1:1 in the UI. Some make no sense (e.g. `reset`); some
  span multiple UI affordances. Design for what humans do, not for tool parity.
- **Don't** introduce client-side caching of library or composition state that bypasses
  the bus. The current model — server is source of truth, client renders from response
  payloads — is what makes UI ↔ MCP ↔ HTTP interchangeable.
- **Don't** expose raw JSON editing as a primary UX. The `SourceDrawer` is read-only
  on purpose; making it writable defeats the point of the structured editor and breaks
  the source-map invariants.

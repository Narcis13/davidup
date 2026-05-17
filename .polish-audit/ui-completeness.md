# davidup editor — UI completeness audit (step 20 polish review)

Scope: `apps/editor/inertia/**` and supporting backend services. Cited with `path:line`. Everything below is taken from the code as it stands on branch `editor-implementation` at audit time.

---

## 1. Page chrome — `apps/editor/inertia/pages/editor.vue`

**Verdict: nothing chrome-shaped exists.** The page is a single `EditorLayout` host with four slots and nothing above/around it.

- No top app-bar. `editor.vue:191-260` renders `<EditorLayout>` directly inside `<Head>`; no `<header>`, no menu, no logo.
- Project name: not displayed. The `project.root` string is passed through as a prop to `EditorLayout` (`editor.vue:198`) and printed as a thin caption inside the stage status overlay (`layouts/editor.vue:71` — `<span class="stage-status-project">· {{ projectRoot }}</span>`). That is the *only* place the project identity surfaces in the chrome.
- No "Open project / new project" affordance anywhere. `ProjectsController#load` exists (`apps/editor/app/controllers/projects_controller.ts:41-71`) but no UI calls it. The empty state (`editor.vue:212-217`) tells the user to relaunch the CLI: *"Boot the editor with `davidup edit <project-dir>`."*
- Scene tab navigation (FR-11): **absent**. `LIBRARY_TABS` in `useLibrary.ts:46` are catalog-kind tabs (template / behavior / scene / asset / font), not per-scene tabs. There is no `Tabs.vue`, no per-scene state, no FR-11 implementation. The PRD marks FR-11 as P1 and the loaded example compositions (`examples/comprehensive-browser/composition.json`) don't even use scenes at the top level, so this has never been exercised in the UI.
- No File menu equivalent. No menu/menubar component exists.
- No keyboard-shortcut indicators (no `kbd` elements, no help affordance, no hint chip).

## 2. Layout shell — `apps/editor/inertia/layouts/editor.vue`

Four-panel CSS grid is present and correct vs PRD FR-02.

- Grid template at `layouts/editor.vue:119-125`:
  - Columns: `library | handle | stage | handle | inspector` (5 tracks).
  - Rows: `stage row | handle | timeline` (3 tracks).
  - Sizes from `panel.gridTemplateColumns/Rows` (`layouts/editor.vue:39-41`), which come from `usePanelLayout` (`composables/usePanelLayout.ts`).
- Panels are resizable. Pointer drag handlers wired at `layouts/editor.vue:55-95`; the composable's `beginDrag` installs `pointermove`/`pointerup` on `window` (`usePanelLayout.ts:161-181`) and updates the layout ref live; visual feedback via `data-dragging` attribute (`layouts/editor.vue:128-130`).
- Layout persistence is implemented. Debounced `PUT /api/editor-state` on every size change (`usePanelLayout.ts:118-126`); hydrated from `GET /api/editor-state` on mount (`usePanelLayout.ts:194-211`). Server side at `apps/editor/app/services/editor_state.ts` and `controllers/editor_state_controller.ts` reads/writes `~/.davidup/state.json` (the PRD path; verified via the file-name comment in `composables/usePanelLayout.ts:8-10`).
- **No status bar.** No persistent slot for validator errors. There is a single absolutely-positioned `stage-status` chip at the *bottom-left of the stage panel* (`layouts/editor.vue:68-72`) that prints the engine's `status` and `statusError` strings. That is the closest thing to a status bar, and it is positioned inside the Stage panel (so it gets hidden when the stage canvas is sized down).
- **No validator surface in chrome.** No FR-14 status bar, no sidebar warnings.

## 3. Library panel — `apps/editor/inertia/components/Library.vue` + `LibraryCard.vue`

Functionally complete; the tabs / search / empty-state contract from the PRD is satisfied.

- Tabs: Templates / Behaviors / Scenes / Assets / Fonts. Defined in `useLibrary.ts:45-52`; rendered at `Library.vue:145-159`. There is NO "All" tab — the type `LibraryTab = LibraryItemKind | 'all'` permits it but `LIBRARY_TABS` does not export it. The empty-state text at `Library.vue:52` still references `'all'`, which is dead code.
- Search box: `Library.vue:124-132` (`data-testid="library-search"`).
- Loading state: panel uses `data-loading="true"` to dim the grid (`Library.vue:175`); the refresh button shows progress cursor (`Library.vue:308-311`).
- Empty state: 3-phase logic in `Library.vue:44-55` differentiates "no project / no library", "library empty", "no matches". Good copy.
- Thumbnails: real per-card thumbs lazy-loaded via IntersectionObserver from `/api/library/thumbnail` (`LibraryCard.vue:42-79`). Placeholder fallback shows "no preview" if the server can't render. Kind badge color-coded (`LibraryCard.vue:236-250`).
- Drag handles: cards are `draggable="true"` (`LibraryCard.vue:104`); `dragstart` calls `useLibraryDrag.onDragStart` (`LibraryCard.vue:31-34`); the composable's MIME `LIBRARY_MIME` is used by drop targets (Stage.vue, Timeline.vue, editor.vue's window-level drop guard).
- File-drop upload onto the panel wired (step 18b): `Library.vue:57-110`, reveals an overlay and routes to `useAssetUpload`.
- Refresh: 2s poll + manual ⟳ button (`Library.vue:133-142`).

## 4. Inspector — `apps/editor/inertia/components/Inspector.vue` + `inputs/*.vue`

Functional for **transform + sprite/text/shape** items; spotty otherwise.

- Implemented input types:
  - `inputs/Number.vue`: paired range + spinner, with override dot. Lines 51-72.
  - `inputs/Color.vue`: native color picker + hex text (`inputs/Color.vue:54-78`).
  - `inputs/Time.vue`: number + `s` suffix, clamps to non-negative (`inputs/Time.vue:38-58`).
  - `inputs/Enum.vue`: `<select>` (`inputs/Enum.vue:39-54`).
  - `inputs/String.vue`: text input or `<textarea>` for `multiline` (`inputs/String.vue:32-58`); fires on `change` (blur/Enter), not per-keystroke.
  - **Missing**: boolean, percent, vector2, point/anchor pair editor.
- **Fallback raw-JSON editor: ABSENT.** Risk R2 explicitly calls for a JSON-fallback so unknown property types aren't black-boxed. Inspector renders nothing for properties not in its hand-written `SPRITE_FIELDS / TEXT_FIELDS / SHAPE_FIELDS` registries (`Inspector.vue:155-197`). `group` items get zero item-specific fields (`Inspector.vue:209`). Unknown item types return `[]` (line 211) and silently render only the Transform section.
- Field registry vs schema: hand-rolled, not Zod-driven. The PRD calls for schema-introspection; this is a static table. Every new item kind needs a code change.
- Overridden vs default: implemented but the "baseline" is just the *composition-at-load-time*, not the resolved template/scene default. `Inspector.vue:69-101` reads from `bus.baseline.value` which is `JSON.parse(JSON.stringify(initial))` (`useCommandBus.ts:67-70`). Comment at `Inspector.vue:15-18` admits this is a placeholder until source-map defaults land. Practical consequence: every change made before reload looks "overridden"; every change made after reload looks like the baseline. Misleading.
- Source provenance (`__source`): **not surfaced in the Inspector at all.** The hit-test pipeline does capture `lastPickSource` (`useSelection.ts:48-72`), but Inspector.vue never reads it. The data flows to the SourceDrawer (`editor.vue:241-248`) and nowhere else.
- Selection mechanism: the Inspector still has a fallback `<select>` dropdown at `Inspector.vue:259-271` listing every item. Even with stage hit-testing live (step 16), the dropdown is the primary affordance shown in the panel.
- Tween editor: **none.** The Inspector cannot edit tween `start`, `duration`, `easing`, `property`, `from`, `to`, or `target`. The only path is timeline drag (positioning) or direct JSON edits. This is a major gap for a video editor.

Tested against `examples/comprehensive-browser/composition.json`: items include `sprite`, `text`, `shape`, `group`. Group items get only Transform — no list of children, no "add child" button, no `items` editor. Sprite/text/shape items get their fields but no width/height for items that don't carry them inline.

## 5. Timeline — `apps/editor/inertia/components/Timeline.vue` + `TimelineTrack.vue`

Strongest panel in the editor; most of the FR-05/FR-06 contract is shipped.

- Drag-to-move + resize: yes. `useTimelineDrag` (`composables/useTimelineDrag.ts`), modes `move | resize-left | resize-right`, single commit on pointerup. Wired at `Timeline.vue:73-94`; emits one `update_tween` per drag (`Timeline.vue:77-83`).
- Color-coded bars: yes. CSS classes `.bar-template/.bar-behavior/.bar-scene/.bar-plain` at `TimelineTrack.vue:378-400`. Colors match PRD FR-05 (orange / green / gold). Legend rendered in the meta header (`Timeline.vue:379-384`).
- Source classification: **heuristic, not source-map driven.** `Timeline.vue:111-137` classifies a tween by parsing its id (`_<behaviorName>_` substring) and target prefix shape (`instanceId__…`). The comment block at `Timeline.vue:14-25` explicitly admits the limitation. Step 15's source-map is *not* used here — even though `emitSourceMap: true` is on in `useStage` (line 153). A behavior whose id was renamed, or a template item whose authored id contains `__`, is misclassified.
- Snap-to-grid: yes, 0.25s default (`Timeline.vue:65-68`, `useTimelineDrag.ts` honors `snapStep`). Alt-drag bypass mentioned in the comment header.
- Ruler with timestamps: yes (`Timeline.vue:225-239`, `Timeline.vue:387-409`). Major ticks every second with `Xs` label; minor ticks every 0.25s.
- Playhead synced to stage: yes. `playhead` prop comes from `useStage().playhead` (set in `editor.vue:208, 233`); rendered both at the ruler (`Timeline.vue:404-408`) and as a vertical line through the tracks (`Timeline.vue:432-436`).
- Click-on-ruler to seek: yes (`Timeline.vue:256-264`). Emits `seek` to the stage.
- Sealed-scene non-editable: **NOT implemented.** No `sealed` flag is checked anywhere (`grep -rn "sealed" apps/editor` returns nothing). A user can drag a tween bar that belongs to a sealed scene and the server will (correctly) apply the update; nothing in the UI marks the bar as locked.
- Thumbnail strip (FR-15): **ABSENT.** No `ThumbnailStrip.vue`. No call to `render_thumbnail_strip` from the editor. Server has `render_thumbnail_strip` exposed as an MCP tool but the editor never invokes it.
- Tweens-by-target only: rows are 1 per item. Items with no tweens still get an empty row (`Timeline.vue:181-184`). This is correct but provides no per-property breakdown (one tween per row is implicit through bar stacking only).

## 6. Stage — `apps/editor/inertia/components/Stage.vue`

- Hit-testing: yes. `Stage.vue:127-160`: convert click → composition coords (floor, not round); `pickItemAt` invoked from `useStage`; result drives `selection.setSelectionFromPick`. Empty click clears the selection.
- Playhead scrub: **only via the timeline ruler.** No scrubber on the stage itself. There is no transport bar.
- **Play / Pause: NOT implemented.** No play button, no pause button, no Space keybinding. The engine auto-plays on attach (`useStage.ts:163`) and ends naturally at the duration boundary (`useStage.ts:165-171`). Setting `status` to `'ended'` is the only "off" state. Re-attaching restarts. There is no manual pause path through `useStage` (no `pause()` method, only `stop()` which fully tears down `handle`).
- "Fit to viewport": **NOT a control.** The canvas does have `max-width: 100%; max-height: 100%` (`Stage.vue:213-219`), so it always fits the wrap. There is no zoom-in, no pan, no 1:1 toggle, no fit-to-selection.
- **Selection ring on stage: ABSENT.** When the user clicks an item, the Inspector dropdown updates and the Timeline row highlights — but the *stage canvas itself shows no marker around the selected item.* No bounding box, no handles. The engine's `pickItemAt` returns the id, but `Stage.vue` never overlays an SVG/canvas selection ring. This is the biggest single perceptual gap.
- Drop zone overlay for library drags: implemented (`Stage.vue:185-198`).
- Crosshair cursor over canvas (`Stage.vue:222-223`).

## 7. Source drawer — `apps/editor/inertia/components/SourceDrawer.vue`

- ⌘J shortcut wired: `editor.vue:88-115`. Cross-platform (Mac ⌘ vs others Ctrl). Suppressed when an input/textarea/contentEditable is focused (`isEditableTarget`).
- Highlights correct line on selection: `SourceDrawer.vue:39-53` resolves an RFC-6901 pointer via `pointerForSelection`, then `lineLookup.value.lines.get(ptr)` returns the line; CSS class `.is-highlighted` applied at `SourceDrawer.vue:142-148`. Re-fetches text after every command apply (`editor.vue:79-86`).
- Read-only — comment at `SourceDrawer.vue:7-8` explicitly defers editing to v1.1.
- Falls back gracefully when source-map points at a different file (e.g. a `$ref`'d library): `SourceDrawer.vue:65-72` + warning note `SourceDrawer.vue:135-138`.
- Drawer is fixed at the bottom, 40vh tall, overlays the timeline. Cannot be docked, cannot be resized.

## 8. Render strip — `apps/editor/inertia/components/RenderStrip.vue`

- Progress bar: yes (`RenderStrip.vue:90-107`). Width-driven `.progress-fill`, frame counter, ETA, live fps.
- ETA: computed from frame rate via `etaSeconds` (`RenderStrip.vue:31-39`).
- **Open-output-folder button: NOT present.** When the render finishes, the strip becomes a clickable hyperlink to `/project-renders/<basename>` (`RenderStrip.vue:115-123`) — which streams the file inline in the browser, not reveal-in-Finder. No `shell.openPath` equivalent, no "Show in folder", no copy-path.
- **List of past renders: NOT in UI.** `useRender.ts:42-44, 144-148` keeps `state.history` (capped at 8) and exposes `history` on the API, but `RenderStrip.vue` does not render it anywhere. `RendersController#index` (`renders_controller.ts:120-133`) returns the server-side job list but the editor never calls `GET /api/renders`.
- Strip lives inside the stage toolbar (`layouts/editor.vue:60-64`), competing with the (nonexistent) transport bar for that bar's only row.
- Dismiss button — yes (`RenderStrip.vue:127-135`).

## 9. Validation surfacing (the step-20 core)

This is the biggest single gap and the explicit subject of step 20.

- Backend validates everything correctly:
  - `CommandBus.apply` (`apps/editor/app/services/command_bus.ts:114-167`) does pre-apply Zod validate (`CommandValidationError`), runs `applyCommandWithResult`, then `validateComposition(next)` (`command_bus.ts:144-147`) and throws `PostValidationError` on any rule failure.
  - Tool-level failures (e.g. `E_TWEEN_OVERLAP`, `E_NOT_FOUND`) bubble as `CommandRejectedError` from `ApplyCommandError` (`apply_command.ts:34-43, 137-141`).
  - `commands_controller.ts:44-67` maps these to 400 / 409 / 422 with structured JSON.
- **UI surface: a single line in the Inspector.** `editor.vue:223-228` passes `bus.error.value` into Inspector, which renders it as `<div class="error">{{ error }}</div>` (`Inspector.vue:274`). That's it. Errors:
  - vanish on the next successful command (because `useCommandBus.apply` clears `error.value = null` on each call — `useCommandBus.ts:76`),
  - appear ONLY in the Inspector — even a tween-overlap error from a timeline drag bubbles up there, not on the timeline,
  - lose their structured `issues`, `hint`, `details` payload: `useCommandBus.ts:84-89` only reads `body.error.message`, dropping codes and details.
- Trace of an intentional invalid composition (tween overlap):
  - User drags a tween bar to overlap another → `Timeline.vue:74-83` emits `update_tween` → `useCommandBus.apply` → `POST /api/command` → tool returns `E_TWEEN_OVERLAP` → server 409 → client reads `body.error.message` → shows it in Inspector.
  - The composition is NOT mutated (the apply throws before persistence), so the timeline bar snaps back at the next re-render (next command).
  - There is **no toast, no inline timeline marker, no aria-live announcement.** If the Inspector panel is collapsed the user may never see the error.
- The bus subscriber list (`command_bus.ts:201-205`) has zero registrations to UI surfaces. The MCP bridge subscribes (`mcp_bridge.ts`) but no UI-facing notifier exists.
- No FR-14 status bar. No bottom-error-tray. No "Clicking an error reveals the source location" — even though SourceDrawer already supports targeting by pointer.

## 10. Keyboard shortcuts (FR-16)

Of the 7 PRD-required shortcuts, **1 is wired:**

| Shortcut | PRD | Implemented? | Where |
|----------|-----|--------------|-------|
| Space (Play/Pause) | yes | **no** | nothing handles it; engine has no pause path anyway |
| S (Split clip) | yes | **no** | no split-tween primitive exists |
| Backspace (Delete) | yes | **no** | no global handler; `remove_item`/`remove_tween` commands exist server-side but no UI binding |
| ⌘0 (Fit timeline) | yes | **no** | no fit logic |
| ⌘J (Reveal in source) | yes | **YES** | `pages/editor.vue:100-115` |
| ⌘R (Render) | yes | **no** | RenderStrip button only |
| ⌘S (Save) | yes | **no** | implicit via debounced persist; no explicit save action |

No central shortcuts registry. `find inertia/composables` has no `useKeyboardShortcuts` / `useHotkeys` / `shortcuts` file. The only other keydown handler is `useTimelineDrag.ts:142,186` (Escape to cancel a drag).

## 11. Help overlay

**Absent.** No `Help.vue`, no `Shortcuts.vue`, no modal component anywhere in `inertia/components/`. Nothing in the page chrome offers help. A user has no in-app surface to learn the only working shortcut (⌘J).

## 12. Toasts / notifications

- `UploadToasts.vue` is the only toast surface and it ONLY renders upload jobs (`UploadToasts.vue:32-67`). It reads `useAssetUpload().jobs`.
- **There is no unified toast system.** Command failures don't surface as toasts. Render failures don't surface as toasts (RenderStrip shows its own inline error pill `RenderStrip.vue:138-156`). Project load errors show in `editor.vue:213-217` as inline copy.
- No `useToast()` composable. No `Toast.vue`. Every error category has invented its own surface.

## 13. Error states — `apps/editor/inertia/pages/errors/*`

- `not_found.vue`: 7 lines, plain text "This page does not exist." No styling matches the editor theme. No back button.
- `server_error.vue`: 8 lines, dumps `error.message`. Generic AdonisJS scaffolding (`{{ error.message }}`).
- **No-project state**: handled inline at `editor.vue:212-217` — "No project loaded. Boot the editor with `davidup edit <project-dir>`." Renders inside the stage slot only. The Library / Inspector / Timeline / SourceDrawer / RenderStrip still mount around it, all empty, looking broken.
- **Broken-JSON state**: handled at `ProjectStore#load` (`project_store.ts:107-128`) — throws `ProjectLoadError('E_COMPOSITION_INVALID', …)` with the validator's structured `details`. CLI prints this on boot (preload). If the user re-loads via POST, controller returns 422 — but **no UI calls POST /api/project**, so the user never sees this path. They see the no-project empty state.
- **Library-missing state**: surfaces inside the panel via `Library.vue:46-48` ("No library attached. Add a `library/` directory…"). Reasonable copy. Errors from individual library files render at `Library.vue:186-194` as a tiny list at the bottom of the panel.
- `pages/home.vue` is the **default AdonisJS scaffold** (`home.vue:6-340`) — Adonis logo, Lucid/Vine/Inertia/Japa marketing cards. Routed to `/` by `start/routes.ts:20`. If a user hits the root URL they get a marketing page, not the editor.

## 14. Project switcher UI

**Confirmed gap.** There is no UI path to switch projects. The user must:
1. Quit the editor process (the CLI is the only project loader at boot: `start/preload_project.ts`).
2. Re-run `davidup edit <other-dir>`.

Evidence:
- `ProjectsController.show/load` exist (controllers/projects_controller.ts) but no `.vue` file calls them. `grep -rn "POST.*api/project\|api/project'" apps/editor/inertia` returns zero.
- No "recent projects" UI. `grep -rn "recent" apps/editor/inertia` returns nothing.
- No drag-and-drop project loader.
- No menu to invoke `ProjectStore.load`.
- The `editor.vue` page payload's `error: { code: 'E_NO_PROJECT', message }` is the only visible signal of project state; the user cannot act on it from the UI.

## 15. Top-3 jarring polish gaps a user hits first

These are the three things that scream "not done" within the first 60 seconds of use:

1. **No selection ring on the canvas.** A user clicks a sprite on the stage and… nothing visibly changes on the stage. The Inspector dropdown flips and the timeline row highlights, but the user has no idea their click registered until they look at the side panel. Every video editor has a bounding box. This is the most fundamental missing affordance in the entire UI.
   - Lines: `Stage.vue:143-160` does the picking; `Stage.vue:163-199` template has zero selection-overlay markup.

2. **No play/pause and no Space shortcut.** The engine auto-plays on attach, ends, and… stops. To replay, the user must seek the ruler. To pause, they cannot. This violates the most universal video-editor expectation. The transport is also missing all standard controls (loop, mute, frame-step).
   - Lines: `useStage.ts:118-178` (attach starts playback immediately), no `pause()` method anywhere in the composable.

3. **Validation errors hide in the Inspector.** Drag a tween into overlap → an angry red line appears inside the right-hand panel. Drag a tween while the Inspector is scrolled past it, or while the panel is narrow and the error is clipped, and the user gets no feedback at all. The PRD step-20 deliverable is literally "polish, validation surfacing, ship" — and the validation surface is one `<div>` inside one panel.
   - Lines: `Inspector.vue:274` + `useCommandBus.ts:76,84-89` (only `error.message` flows through, no toast/status-bar plumbing).

Honorable mention (would be #4): **the root `/` route serves the default AdonisJS marketing scaffold (`home.vue`)** instead of an editor splash or project picker. If a developer ever navigates to `localhost:3333/` they see Lucid / Vine / Inertia / Japa cards. Smells immediately unshipped.

---

## Inventory snapshot

Components: `Stage.vue`, `Inspector.vue`, `Library.vue`, `LibraryCard.vue`, `Timeline.vue`, `TimelineTrack.vue`, `SourceDrawer.vue`, `RenderStrip.vue`, `UploadToasts.vue`, `inputs/{Number,String,Color,Time,Enum}.vue`. Notably absent: `StatusBar`, `Toolbar`, `Transport`, `Help`, `SceneTabs`, `ProjectPicker`, `Toast`, `ConfirmDialog`, `ThumbnailStrip`, `SelectionOverlay`.

Composables: `useStage`, `useCommandBus`, `useSelection`, `useLibrary`, `useLibraryDrag`, `usePanelLayout`, `useTimelineDrag`, `useAssetUpload`, `useRender`, `jsonPointerLines`, `panelLayoutShape`, `timelineDragMath`. Notably absent: `useToast`, `useKeyboardShortcuts`, `useProject`, `useUndoRedo`, `useValidationLog`.

Pages: `home.vue` (default Adonis scaffold), `editor.vue`, `errors/{not_found, server_error}.vue`. Notably absent: project picker, splash.

Backend mutation pipeline is solid; the UI surface for it is the missing piece.

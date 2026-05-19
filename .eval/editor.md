# davidup editor — deep evaluation

Scope: `apps/editor/` (AdonisJS 6 + Inertia 2 + Vue 3 + Vite, plus the davidup engine as a workspace dep). The editor wraps the engine's MCP tool surface in a visual canvas + timeline + inspector, persisting state through a debounced JSON writer.

## Overview

The davidup editor is a **single-tenant, single-project, local-first desktop-style web app**. You boot it by pointing the `davidup edit <dir>` CLI at a project directory; the AdonisJS server preloads that directory into an in-memory `ProjectStore` (`apps/editor/start/preload_project.ts`), the Inertia page hydrates the composition into a browser canvas via the engine's browser driver, and every mutation (Inspector edit, timeline drag, library drop, MCP-attached agent) funnels through a single `CommandBus.apply()` (`apps/editor/app/services/command_bus.ts:144`). The PRD calls this the D4 invariant — UI and MCP edit sequences produce byte-equal `composition.json`.

It can:

- open / scaffold / switch projects from a recents picker (`apps/editor/inertia/pages/home.vue`, `apps/editor/app/controllers/projects_controller.ts`),
- render a live canvas of the composition with playhead, hit-testing and selection ring (`apps/editor/inertia/components/Stage.vue`, `apps/editor/inertia/composables/useStage.ts`),
- show a colour-coded tween timeline with drag-to-move/resize + library drop zones (`apps/editor/inertia/components/Timeline.vue`, `apps/editor/inertia/composables/useTimelineDrag.ts`),
- inspect and edit every tweenable item / tween property through typed inputs (`apps/editor/inertia/components/Inspector.vue`, `apps/editor/inertia/components/inputs/*.vue`),
- browse a two-root library (project + global pool) of templates/behaviors/scenes/assets/fonts with live disk watching and thumbnails (`apps/editor/app/services/library_index.ts`, `apps/editor/app/services/library_thumbnail.ts`),
- ingest dropped media via a hash-deduped pipeline (`apps/editor/app/services/asset_pipeline.ts`),
- render videos through ffmpeg with live SSE progress and a "reveal in Finder" shortcut on macOS (`apps/editor/app/workers/render_worker.ts`, `apps/editor/app/controllers/renders_controller.ts`),
- expose every editor mutation + project/library/render lifecycle through an MCP stdio bridge that an AI agent can drive in lock-step with the UI (`apps/editor/app/services/mcp_bridge.ts`, gated by `DAVIDUP_MCP_STDIO=1` in `apps/editor/start/preload_mcp_stdio.ts`).

It **cannot**:

- support more than one project in memory at a time (the `ProjectStore` is a process-singleton),
- support more than one user — there is **no authenticated session anywhere on the live routes** despite the auth scaffolding,
- queue multiple concurrent renders (`useRender.startRender` refuses with `E_BUSY` if one is in-flight; the registry can hold many but the UI is wired single-slot),
- run safely on shared infrastructure (every server-side path manipulates absolute filesystem paths on the host),
- redo (only undo is implemented in `CommandBus`, and it's exposed but not wired to any UI shortcut),
- save anywhere other than back onto the same `composition.json` on disk.

## Architecture map

### Single source of truth
The in-memory composition object on `ProjectStore.#project.composition` (`apps/editor/app/services/project_store.ts:69`) is the canonical state. **Disk follows memory** via a 500 ms debounced atomic `write tmp + rename` (`project_store.ts:271-297`). **Browser follows disk** via the initial Inertia render (`apps/editor/app/controllers/editor_controller.ts:91-133`).

### Boot flow
```
adonisrc.ts preloads ──►  preload_global_library.ts   (attach $DAVIDUP_LIBRARY)
                     ──►  preload_project.ts          (load $DAVIDUP_PROJECT)
                     ──►  preload_mcp_stdio.ts        (if DAVIDUP_MCP_STDIO=1)
```
A second project can replace the first via POST `/api/project`; `ProjectStore#load` flushes pending writes, then explicitly resets command-bus undo, aborts in-flight renders, and rebinds the library before swapping (`project_store.ts:186-204`). On success it broadcasts a `changed` SSE event on `/api/projects/events`, which `editor.vue` listens for and reacts to with `router.reload()` (`apps/editor/inertia/pages/editor.vue:351-388`).

### Disk → Inertia → Vue → engine pipeline
1. `EditorController#show` reads `projectStore.composition` (already precompiled with `emitSourceMap: true`), rewrites every `assets[].src` from a project-relative or `global:` form to a `/project-files/*` or `/library-files/*` URL (`editor_controller.ts:59-80`), and sends `composition`, `defaults` (frozen post-precompile snapshot used for override-detection — `project_store.ts:206-211`), `sourceMap`, and `compositionSource` (raw on-disk text) to Inertia.
2. The `editor.vue` page hydrates `useCommandBus({ initial: props.composition })`. `useStage` then dynamically imports `davidup/browser` and calls `attach(comp, canvasEl, { startAt, emitSourceMap: true })`, which mounts the RAF loop, asset loader and hit-tester (`useStage.ts:194-235`).
3. Every mutation builds a `Command` (e.g. `{ kind: 'update_item', payload: { id, props: { x: 42 } }, source: 'ui' }`) and POSTs `/api/command`. The server runs `CommandSchema` (Zod, shared with MCP), then `applyCommand` → engine's MCP tool handler against a fresh `CompositionStore` hydrated from the current JSON (`apps/editor/app/services/apply_command.ts:72-98`), then `validateComposition`, then pushes the prior state onto a 50-deep undo stack, then `projectStore.update(next)` which schedules the debounced write. The HTTP response carries the new composition + `toolResult` (e.g. `{ itemId }`).
4. `useCommandBus.apply` rewrites asset srcs on the response (the engine returns canonical project-relative paths but the browser needs `/project-files/...`), replaces `composition.value`, and `useStage`'s watcher (`useStage.ts:268-277`) re-attaches at the preserved playhead.

### Command-bus serialization
The bus uses a microtask `#queue` chain so two concurrent `apply()` calls cannot read the same baseline composition (`command_bus.ts:117, 144-152`). This is what makes UI ⇄ MCP byte-equal — without it a UI edit and an MCP edit could interleave and the later writer would clobber the earlier. There's an explicit test in `tests/functional/command_bus_concurrency.spec.ts`.

### Renderer
In-process: `RenderJob.run()` calls `davidup/node`'s `renderToFile` which spawns ffmpeg (`render_worker.ts:212-292`). Progress flows back through `EventEmitter` → SSE channel (`renders_controller.ts:175-258`). The registry retains up to 32 jobs after completion so late SSE subscribers can replay the terminal state. ffmpeg is resolved from `DAVIDUP_FFMPEG_PATH` → `ffmpeg-static` → `PATH` (`render_worker.ts:41-60`). Reveal-in-Finder / play-in-QuickTime is macOS-only (`renders_controller.ts:316-371`).

### MCP bridge
`createEditorMcpServer()` (`mcp_bridge.ts:128-141`) builds a `DavidupServer` whose `router` intercepts every mutating tool name listed in `COMMAND_TO_TOOL`, translates parsed args to a `Command` with `source: 'mcp'`, and runs it through the same `commandBus.apply()`. Non-mutating tools (`list_*`, `get_composition`, `validate`, `render_*`) fall through to a `depsFactory` that builds a fresh `CompositionStore` hydrated from `projectStore.composition` on every call so reads see the latest committed state. Project / library / render controls also implement `MCP*Controls` interfaces and route to the same services the HTTP controllers use (`mcp_bridge.ts:200-502`).

### Auxiliary state
- `~/.davidup/state.json` — panel sizes (`editor_state.ts`, `editor_state_controller.ts`).
- `~/.davidup/recents.json` — recents list, atomic-write + auto-prune of stale paths (`recents.ts`).
- `~/.davidup/library` — global library pool, attached once at boot.
- `<project>/library/` — per-project library, attached on project load, project wins id collisions over global (`library_index.ts:469-477`).
- `<project>/renders/` — render outputs, served back via `/project-renders/:filename`.
- `<project>/library/assets/<sha256><ext>` — uploaded media, hash-deduped (`asset_pipeline.ts:443-555`).
- `tmp/db.sqlite3` — SQLite via Lucid (`config/database.ts`). **Only contains a `users` table from the AdonisJS starter — unused.**

## Workflows currently supported

For each, the request → backend → engine → response trace.

### 1. Open a project (from picker or layout dropdown)
`POST /api/project { directory }` → `ProjectsController#load` → `guardProjectDirectory` (blocks `..`, control chars, `/etc`, `/proc`, `C:\Windows`, etc.) → `ProjectStore#load(dir)` → read+parse `composition.json` → `precompile` (engine expands `$ref`/`$template`/`scene`/`$behavior` and emits source map) → `validateComposition` → attach library → `recents.touch` → emit `changed` event. Browser tabs subscribed to `/api/projects/events` `router.reload()` and the new composition props flow in. Single-tab Inertia visits are direct `router.visit('/editor')` (`home.vue:101`).

### 2. Scaffold a new project
`POST /api/projects { directory, name?, template? }` → `scaffoldProject` (from engine CLI) → `ProjectStore#load`. Returns `201 Created` with the new composition.

### 3. Live edit an item / tween via Inspector
Each input field's `@update:model-value` runs `dispatchEdit(field, raw)` (`Inspector.vue:376-388`), which emits an `update_item` command with `props: { [field.key]: raw }`. The page-level handler hands that to `useCommandBus.apply` → `POST /api/command` → `CommandBus.apply` → `applyCommand` → engine `applyItemUpdate` → schema-revalidate → debounced disk write. The response composition replaces `bus.composition.value`; `useStage` re-attaches at the preserved playhead so the user sees the change without losing position.

### 4. Drag a timeline bar
Pointer-armed at 3 px threshold via `useTimelineDrag` (`useTimelineDrag.ts:163-174`); pure math in `timelineDragMath.ts` snaps to 0.25 s grid (Alt bypasses snap). `onCommit` fires **once** on pointerup with the final `{start?, duration?}` patch → one `update_tween` command. No mid-drag commands — a transient "active" ref drives a ghost bar.

### 5. Drop a library card
`useLibraryDrag.onDragStart` synthesizes a `LibraryDragPayload` with brand defaults pre-resolved from each param descriptor (`useLibraryDrag.ts:172-201`). Drop targets:
- **Timeline track row** → `apply_behavior` (existing target) or, for template/scene, a new-track `apply_template` / `add_scene_instance`.
- **Timeline new-track gutter** → `apply_template` / `add_scene_instance`.
- **Stage** → `add_sprite` (asset), `apply_template`, or `add_scene_instance` with `{ transform: { x, y } }`.

The dataTransfer JSON fallback is also written so a HMR mid-drag doesn't break the drop.

### 6. Upload a file
Drop anywhere in the editor (or specifically on the Library panel) → `useAssetUpload` enqueues per-file XHR with progress events (`useAssetUpload.ts:172-251`) → `POST /api/assets` (multipart) → `assetPipeline.ingest` → SHA-256 hash → move tmp → `<library-root>/assets/<hash><ext>` → ffprobe / skia loadImage for metadata → optional video thumbnail via ffmpeg → atomic write of `library/index.json` → `libraryIndex.flush()` → catalog watcher emits → the panel's 2 s poll picks up the new card.

Target = `'project'` or `'global'` — selected by the active library scope filter in the panel (`Library.vue:66-68`). Hash dedup means re-uploading the same bytes is a no-op.

### 7. Render to video
`POST /api/renders { filename? }` → `RenderJob` constructed with the *current snapshot* of `projectStore.composition` (intentional — pending debounced writes can lag) → fire-and-forget `job.run()` → response with `jobId + eventsUrl`. Client opens `EventSource /api/renders/:id/events` and receives `progress` / `done` / `error` frames. On `done`, a "Reveal" / "Play in QuickTime" link is shown on macOS (`RenderHistory.vue`, `RenderStrip.vue`).

### 8. Reveal item in source
`Cmd+J` (or click the Inspector provenance line / the StatusBar issue list / a sealed scene bar) → `GET /api/composition-source` returns the *raw on-disk JSON text* + mtime (`editor_controller.ts:141-155`); `SourceDrawer` highlights the line backed by the `sourceMap.items[id].jsonPointer` via `jsonPointerLines.ts`.

### 9. AI-driven edit
With `DAVIDUP_MCP_STDIO=1`, an MCP agent connects over stdio. Every `add_*` / `update_*` / `remove_*` call routes through `commandBus.apply({ source: 'mcp' })`. The Inspector shows an "AI edit" pill on the most-recently-MCP-edited item (`Inspector.vue:584`, attribution tracked in `useCommandBus.itemLastSource`). The agent also has `current_project`, `open_project`, `create_project`, `list_projects`, `list_library`, `render_to_video`, `get_render`, `list_renders` — same vocab as the HTTP surface.

## What's good

- **Command bus is the right abstraction.** A single Zod-validated discriminated union (`apps/editor/app/types/commands.ts:385-407`) covers every mutation, both surfaces (HTTP + MCP) funnel through it, and the per-call queue (`command_bus.ts:117, 144-152`) makes the byte-equality D4 invariant a structural property rather than a hopeful one. The serialization test in `tests/functional/command_bus_concurrency.spec.ts` is exactly the right invariant to enforce.
- **Engine reuse without coupling.** `applyCommand` rehydrates a *fresh* `CompositionStore` per call (`apply_command.ts:72-98`), so the editor never reads through to the engine's module-level singleton. This is what lets MCP and HTTP share semantics safely.
- **Project-switch hygiene.** `ProjectStore#load` actively tears down state from the prior project before swapping: undo-stack reset, in-flight renders aborted (`project_store.ts:194`), library detached. Without this you'd get cross-project undo restoration corrupting the new composition (R-P-grade bug class).
- **Defaults snapshot for override-detection.** Capturing the precompiled composition *once* on load (`project_store.ts:206-211`) and feeding it to the Inspector as the comparison baseline (`Inspector.vue:265-282`) is correct — it answers "what diverges from the template/scene-expanded form" instead of "what changed in this tab".
- **Source map plumbed end-to-end.** PRD step 15 produced a precompile-time `sourceMap`; the Timeline reads `originKind` for true bar colour (`Timeline.vue:134-181`), the Stage's pickItemAt returns the same payload, and the Inspector's provenance line + Cmd+J use it. Almost every "where did this come from" question in the UI is answerable.
- **Validation merge.** `useValidation` (`useValidation.ts:136-164`) merges schema errors with the most recent `PostValidationError.details` so the StatusBar shows the *would-be* post-apply issues for a rejected write, not just the current saved-state issues — this is the missing piece in most editors.
- **Path-traversal guards are centralized.** `project_paths.ts:guardProjectDirectory` is reused by both HTTP and MCP project surfaces (`projects_controller.ts:47-51`, `mcp_bridge.ts:222-281`), so the two can't drift. The blocklist (`SENSITIVE_PREFIXES`) covers the obvious unix + Windows sensitive roots.
- **Atomic disk writes everywhere.** `composition.json`, `recents.json`, `state.json`, and `library/index.json` all use tmp + rename, so a torn file can't survive a crash (`project_store.ts:294-296`, `recents.ts:119-126`, `editor_state.ts:135-142`, `asset_pipeline.ts:411-416`).
- **Two-root library merge.** Project wins over global with a per-row "overridden" badge, and engine REGISTRY is kept in sync via incremental register/unregister (`library_index.ts:469-553`). Detaching a project re-registers the surviving global definition correctly. The watcher coalesces events with a 100 ms debounce.
- **SSE catch-up replay.** `/api/renders/:id/events` writes the last known event immediately on connect (`renders_controller.ts:215-222`), so a late subscriber doesn't have to race the network for the first progress frame.
- **Asset hash dedup.** `assetPipeline.ingest` short-circuits when the same bytes are already in `library/index.json` *and* on disk (`asset_pipeline.ts:478-489`). Re-uploading the same image 100×s costs one stat.
- **`useStage` preserves playhead across edits.** Editing values mid-playback doesn't jump the playhead back to 0 (`useStage.ts:167-179`, `:268-277`). For a v1.0 editor this UX detail matters a lot.
- **Render asset path resolution.** `resolveAssetSources` in `render_worker.ts:74-88` rewrites relative `asset.src` against the *composition file's directory*, not `process.cwd()`. Without this every render would 404 because the editor's cwd is `apps/editor/`, not the project root.
- **Useful test coverage for invariants.** `tests/functional/command.spec.ts` (the byte-equal UI/MCP property test), `command_bus_concurrency.spec.ts`, `command_bus_undo_source.spec.ts`, `project_switch.spec.ts`, `library.spec.ts`, `assets_upload.spec.ts`, `renders.spec.ts`, `mcp_bridge.spec.ts`, `mcp_projects.spec.ts`, `mcp_library.spec.ts` — these aren't drive-by smoke tests, they pin down the actual contracts.

## Bugs found

### High

1. **`useStage` watcher snaps playhead to a stale wall-clock baseline when paused and then composition mutates.**
   `apps/editor/inertia/composables/useStage.ts:268-277` — the composition watcher always calls `start({ resume: true })`. `resume: true` resolves the resume time via `readCurrentPlayhead()` (`useStage.ts:161-165`), which while `status === 'paused'` returns `lastAttachStartAt + (Date.now() - lastAttachStartMs) / 1000`. `pause()` does pin the baseline (`useStage.ts:328-330`), but **`seek()` while paused also re-pins via `lastAttachStartMs = Date.now()` and then `if (status.value === 'playing') startTicking()`** — so the next time the user makes an inspector edit while paused, the wall clock keeps ticking from the seek time. Repro: pause, wait 5 s, edit the inspector → playhead jumps forward 5 s. Fix: when `status` is `paused` / `stopped` / `ended`, the composition-mutation watcher should call `start({ resumeAt: playhead.value })`, not `start({ resume: true })`.

2. **`/api/projects/events` SSE listener leak when the SSE response itself errors before `request.request.on('close')` fires.**
   `projects_controller.ts:199-247` registers `projectEvents.on('changed', onChanged)` and a 15 s heartbeat interval, and cleans up only when `close` fires on the request or raw response. If the underlying socket errors (vs. closes), neither event guarantees a fire — the listener stays attached to the singleton emitter and the interval keeps writing. Over hours of dev reloads this is what trips `setMaxListeners(64)`. Fix: also bind `'error'` and `'finish'` and call `cleanup()` defensively.

3. **`commandBus.undo()` does not flush the disk write before returning.**
   `CommandBus.undo()` calls `projectStore.update(entry.snapshot)` synchronously (`command_bus.ts:223-224`) but doesn't await any disk operation; the 500 ms debounce window still applies. There is **no UI shortcut for undo** at all today (see `useShortcuts.ts:42-49` — no `cmd+z` handler), so this only matters for tests and the MCP surface — but if/when undo lands in `Cmd+Z`, the user could `Cmd+Z` then `Cmd+R` (start render) within 500 ms and the renderer would snapshot the *current* (pre-undo) `projectStore.composition`. Mitigation already exists in `renders_controller.ts:60-71` which reads memory not disk, **so this bug is latent today**, but the contract is fragile.

4. **`useCommandBus` swallows `error.value` after a *succeeding* command if a prior command failed.**
   `useCommandBus.ts:155-203`: `apply()` sets `error.value = null` at the top of every call, but the `errorReport.value = null` only runs after `res.ok && parseJson`. If two commands run back-to-back and the first one's network error sets `error.value` and `errorReport.value`, then the second succeeds, `error.value` resets to null but `errorReport.value` is overwritten by the success path which calls `clearCommandError()` only via `sink?.clearCommandError()`. Reading code: actually `errorReport.value = null` IS reset on success (line 184). OK. Strike — this is fine.

### Medium

5. **`useTimelineDrag.suppressNextClick` can swallow an unrelated click.**
   `useTimelineDrag.ts:195-209`: on pointerup with `armed = true`, we register a capture-phase, once-only `click` suppressor on `document`. If the user releases the bar drag *and* clicks somewhere else within a single frame (e.g. clicks another row before the synthetic click fires), the listener intercepts the wrong click and silently eats it. The browser's synthetic-click-after-dragend timing isn't deterministic across browsers. Fix: scope the suppressor to the bar element via `element.addEventListener('click', …, { once: true, capture: true })`.

6. **Asset pipeline silently fails for images when `skia-canvas` import throws but the file still gets persisted.**
   `asset_pipeline.ts:310-323` swallows `loadImage` failure and returns `null` for image dims, but the file is **already moved** by `moveOrCopy` at `:488`. The index entry is then written without `width`/`height`. Downstream the engine's asset loader may reject the asset for size validation — but the user sees a green "uploaded" toast. The pipeline should either (a) reject the upload (delete the moved file) when dim probing fails on an image whose ext we can't trust, or (b) accept it but mark the index entry with a warning the panel can surface.

7. **`useRender.startRender`'s `E_BUSY` guard reads from a closure-captured `state.current` but the SSE-driven mutations target the reactive proxy.**
   `useRender.ts:177-183` checks `state.current.status === 'pending' || 'running'`. The proxy mutation in `attachStream` (`useRender.ts:103-109`) does work because of the comment at `:240-243`. But the *registry retention* on the server is 32 jobs (`render_worker.ts:303`), and the client only ever sees `state.current`. **You cannot have two parallel renders in the UI even though the server can host them**. This is a feature constraint, but it should be clearer to the user — the "Render ▸" button silently becomes a "Starting…" stub.

8. **`commandBus.resetUndo()` is called only on project switch, not on `unload()`.**
   `project_store.ts:188-204` calls `commandBus.resetUndo()` only when `wasAlreadyLoaded && priorRoot !== root`. `ProjectStore.unload()` flushes disk and clears `#project` but **does not clear the undo stack**. If a later `load()` switches back to a different project, the test (`priorRoot !== root`) works, but if a test calls `unload()` then `load(SAME_ROOT)` no reset fires. Mostly a test-suite hazard, but the contract should be: "undo is project-scoped, period".

9. **`renders_controller.shell` action security boundary depends on string-prefix match without normalization.**
   `renders_controller.ts:344-356`: `target.startsWith(inside + '/')`. On case-insensitive filesystems (macOS HFS+ by default) a request for `Renders/x.mp4` (capital R) resolves outside the prefix but still hits a real file. Less of a CVE, more of an inconsistency — the file is constrained to `renders/` filename anyway by the basename check at `:334`. Should normalize case before comparing.

10. **`renders_controller.file` allows a basename that resolves to the renders directory itself.**
    `renders_controller.ts:396-397` allows `target === inside`. If a future caller passes filename = `''` after some other normalization, `resolvePath(root, 'renders', '')` returns the renders dir itself, `existsSync` is true, and `response.download` would try to download a directory. The basename guard at `:389` rejects `''`, so today it's defensive only — but the `target === inside` allowance has no good reason to exist.

### Low

11. **`Timeline.vue`'s playhead line uses `calc(160px + (100% - 160px) * ratio)` — the 160 px is the hard-coded ruler-gutter width.**
    `Timeline.vue:504`. If the gutter's CSS ever changes, the timeline playhead-line desyncs from the ruler playhead-head. Should be a CSS variable.

12. **`renders_controller.events` keeps writing heartbeats forever if `setImmediate(() => raw.end())` rejects the underlying socket.**
    `renders_controller.ts:226-232` clears the interval only on synchronous write failure; if `raw.end()` ends the response but the heartbeat timer fires once more during the macrotask window, it logs and clears. Probably benign — but the heartbeat should be a `keepAlive: false` interval bound to a strict close gate.

13. **`useLibraryDrag.payload.duration` is never re-validated when the dropped payload is reconstructed from `dataTransfer` JSON.**
    `useLibraryDrag.ts:140-149`: `duration: typeof parsed.duration === 'number' ? parsed.duration : undefined`. Doesn't enforce `> 0` or `Number.isFinite`, so a malformed message could surface `Infinity` into a downstream command's `duration` and only fail at the server's Zod gate. Cheap to add `Number.isFinite && > 0`.

14. **`recents.list()` prunes paths whose directories no longer exist, but does not re-write the file** — only `touch` or `forget` do (`recents.ts:52-56`). Stale entries linger on disk forever after the last `forget` call. Low impact; the list is pruned on every read.

15. **Asset ext detection trusts the *client name* over the actual bytes** — `asset_pipeline.ts:124-137`. A renamed `.exe` → `.png` would be moved into `library/assets/<hash>.png` and the index entry written. The thumbnail step would fail and the engine asset loader would reject the file at render — but the file lands in the project regardless. For a local-only single-user app this is acceptable; for SaaS it would be a content-type spoofing vector.

16. **The `silent_auth_middleware.ts` exists but is unreferenced in `kernel.ts`.** Dead code from the AdonisJS starter scaffold.

## Gaps for v1.0 polish

- **No undo shortcut.** `CommandBus.undo()` exists and is correctly project-scoped, but `useShortcuts` doesn't bind Cmd+Z. PRD FR-09 explicitly names this. Easy fix.
- **No keyboard-driven creation.** Cmd+N / Cmd+T / etc. for "add layer / add sprite / add text" — every add path is mouse-only via library drag.
- **No Stage-driven move/scale/rotate.** Clicking selects (and shows a ring), but you cannot drag the selection on the canvas. Inspector-only x/y/scale editing for v1.0 is honest, but doesn't feel like a real editor.
- **No multi-select.** `useSelection` holds a single id; deletion is single-target; group operations are MCP-only.
- **No timeline zoom.** `Timeline.vue` auto-fits the panel width; there's no scroll/zoom for compositions longer than ~30 s.
- **No tween split.** PRD has it as P2 and the polish plan defers to v1.1, but for any non-trivial editor users will hit this fast.
- **No render queue.** `useRender` is single-slot; the server can hold many but the UI cannot.
- **No "save as / duplicate project".** Project creation only scaffolds blank.
- **No `composition.json` schema migration.** Old versions parse, but there's no version stamp tracking in the editor surface.
- **No keyboard help overlay completeness.** `HelpOverlay.vue` exists but only covers ~6 chords; the editor has ~10 affordances that ought to be listed.
- **Asset pipeline doesn't accept fonts** — the ext list omits `.ttf/.otf/.woff/.woff2` even though `MIME_BY_EXT` has them and the library catalog has a `font` kind. Adding a font today requires hand-editing `library/index.json`.
- **No retry / resumable uploads** — XHR with no progress persistence; a tab refresh during a 50 MB upload abandons it.
- **No "discard changes" / "reset to disk".** Bad edits can only be undone one command at a time.
- **No render presets in the UI.** Codec / CRF / preset / pixFmt are MCP-only (`mcp_bridge.ts:454-458`); the UI's `POST /api/renders` accepts only an optional filename.
- **No "show in OS file manager" on Linux/Windows.** Reveal-in-Finder is hard-coded to `darwin` (`renders_controller.ts:323-330`).
- **HelpOverlay and Toasts share no z-index strategy** — both use ad-hoc values; tested manually but no contract.
- **Single-file `composition.json`** — once a composition exceeds maybe 50 K nodes the in-memory `JSON.stringify` + write becomes user-visible. Polish plan calls this out, no mitigation yet.

## SaaS-multi-tenancy gap analysis

Today the editor is a structurally single-user, single-process desktop app pretending to be a web app. A multi-tenant SaaS conversion would need to change:

1. **Replace process-global singletons with per-tenant scoped state.** Everything in `apps/editor/app/services/` is a module-singleton — `projectStore`, `commandBus`, `libraryIndex`, `editorState`, `recents`, `renderJobs`, `assetPipeline`, `globalLibraryRoot`. None of them key on user / org. You'd need a `ProjectStoreRegistry` keyed by `(tenantId, projectId)` and a `CommandBus` per project; the same goes for `libraryIndex` (the registry-management calls into engine `registerTemplate` / `registerScene` are themselves global module state in `davidup/compose`, which is a separate engine-level blocker).
2. **Wire authentication.** The AdonisJS starter auth scaffolding (`auth_middleware.ts`, `User` model, `users` migration) is present but **not applied to any route** (`start/routes.ts` doesn't use the named `auth` middleware). There is no `/login` page, no signup, no session enforcement. Inertia pages assume a single ambient project. CORS allows credentials but origin is `[]` (`config/cors.ts:11`).
3. **Per-user filesystem isolation.** `project_paths.guardProjectDirectory` blocks `/etc` etc. but every accepted path is on the **host filesystem** of the server. Today the server has read/write everywhere the OS user has access to. For SaaS: every project must live under a tenant-scoped root (e.g. `/data/tenants/<id>/projects/<id>`), and the guard must enforce containment to that root, not just absence of dotted segments. `recents.ts`, `editor_state.ts`, `global_library_root.ts` all default to `~/.davidup/` which is the *server process's* home dir.
4. **Replace local FS with a pluggable storage abstraction.** `asset_pipeline` writes to `<library>/assets/<hash><ext>`; `project_store` writes `composition.json`; `renders_controller` serves files via `response.stream(createReadStream(target))`. To go S3-ready, each of these needs an injected `BlobStore` interface (`put(key, stream)`, `getStream(key)`, `exists(key)`). The hash-dedup logic stays the same; the on-disk-path indirection goes away.
5. **Single MCP server per process is wrong shape.** `preload_mcp_stdio.ts` attaches **one** MCP server to **the** stdio of **the** node process. In a multi-tenant deployment that has no meaning. MCP would have to move to a per-session websocket endpoint that authenticates and binds to that user's `(CommandBus, ProjectStore)` instance. The `createEditorMcpServer({ commandBus, projectStore, libraryIndex })` signature is already DI-clean so this is mostly a transport swap.
6. **Render worker would have to be a real queue.** Today: in-process EventEmitter + ffmpeg child spawn. At 100 users each kicking off a render, the editor server would consume hundreds of CPU cores and run out of RAM. Need: BullMQ / SQS / similar with a dedicated render-worker fleet; the editor server only publishes jobs and subscribes to progress.
7. **SSE channels keyed to user/project.** `/api/projects/events` is global — it fires whenever *any* project switches. Every connected tab would `router.reload()` on every other user's switch. Same applies to render events (job ids are random but the *registry* is shared).
8. **Library pool sharing model.** Today `~/.davidup/library` is shared at server scope. For SaaS that's actually a sane *organization* pool, but the path is per-process-user, not per-org. Would need a `(orgId → libraryRoot)` map, with the project pool inside the tenant's storage.
9. **DB has one `users` table from scaffold and nothing else.** No `projects`, no `org_memberships`, no `access_grants`. Every project today is implicitly accessible to the single OS user running the editor.
10. **Concurrent edit conflict resolution.** The bus serializes edits *within a process* via the `#queue` chain. There's no OT, no CRDT, no last-writer-wins UI feedback. Two users editing the same project would just race — the later commit wins and the earlier user's `useStage` watcher would silently rebase. Need at minimum a `revision` field on the composition with a 409 on stale-base writes (FR-15 territory).
11. **Project-events EventEmitter is unbounded.** `setMaxListeners(64)` (`project_events.ts:37`) — fine for one user, terrible for 100. Pin to `(tenantId, projectId)` channels.
12. **Asset URL signing.** `/project-files/*` is unsigned and unauthenticated. Anyone who can guess the path can read any project asset. Same for `/library-files/*` and `/project-renders/:filename`.
13. **`renders_controller.shell`** literally spawns `open(1)`. Cannot exist on a server; needs to be UI-only client-side download.
14. **No request rate limiting / abuse controls.** A user could POST `/api/command` in a tight loop and starve the bus.
15. **`useStage` SSR safety is partial.** Server-rendered HTML works, but the page payload contains the entire composition + sourceMap — for a large project that's a fat first byte. Would need lazy-load via Inertia partial reloads.
16. **No audit log.** `commandBus` knows `source: 'ui' | 'mcp'` but throws the audit trail away. A multi-tenant system needs at least an append-only log of who-did-what-when, ideally derivable from the command stream.

## High-leverage improvements

Ranked by impact-to-effort:

1. **Wire `Cmd+Z` to `commandBus.undo()`.** One-line shortcut, full backend already exists. (Low effort, high UX impact.)
2. **Add Stage drag-to-move / drag-resize for the selected item.** The picker + bounds-at-time machinery is already in place (`useStage.pickItemAt`, `getItemBoundsAt`); the command (`update_item` with `transform.x/y/scaleX/scaleY`) is already supported. This unlocks the "feels like an editor" experience. (Medium effort, very high UX impact.)
3. **Promote `useRender` to a real queue UI.** Server-side `renderJobs.list()` is already paged in `RenderHistory.vue`. Adding a "next" slot + concurrent rendering is mostly cosmetic. (Low-medium effort.)
4. **Migrate `/api/projects/events` and `/api/renders/:id/events` to `@adonisjs/transmit`** when Adonis 7 is on the table. The wire shape is already Transmit-compatible (per `renders_controller.ts` comment). (Low effort, future-proof.)
5. **Add a `revision` field to the in-memory composition + reject commands whose base revision doesn't match.** This is the keystone for multi-user. Single-user is unaffected; the bus is already the sole writer. (Medium effort, unlocks SaaS.)
6. **Fix the `useStage` watcher resume bug (#1).** One conditional. (Trivial effort.)
7. **Replace the SSE listener cleanup with a `try/finally` + `'error'` binding (#2).** (Trivial effort.)
8. **Introduce a `BlobStore` interface seam.** Local FS today, S3 / R2 tomorrow. Asset pipeline + composition writer + render writer all become one-line swaps. (Medium effort.)
9. **Plumb codec / CRF / preset to the `POST /api/renders` HTTP body.** MCP can already pass them (`buildRenderControls` in mcp_bridge); the UI just needs the form. (Low effort.)
10. **Add multi-select (`Shift+click` accumulator) + a per-selection batch command.** The bus already serializes; the protocol could carry `{ kind: 'batch', commands: [...] }`. (Medium-high effort.)
11. **Persist undo across reloads.** Snapshot to `<project>/.davidup/undo.json` on flush. (Medium effort, frees up the "lost work on refresh" complaint.)
12. **Surface a real `validation/issues` panel that walks every error to a fix recipe**, not just a list. The data is already in `useValidation`. (Medium effort, high quality-of-life.)
13. **Drop the unused `users` table + auth scaffolding OR finish it.** It is currently dead code; reviewers will ask. (Trivial — either delete the middleware/model/migration or write a real `/login` page.)
14. **Asset upload: detect actual MIME from bytes (not the filename) before move.** Use `file-type` or libmagic. (Low effort, closes #15.)

## Verdict for v1.0

The editor is **shippable as a v1.0 local-first single-user app** and meaningfully impressive at that scale. The architectural skeleton — command bus + Zod-validated discriminated union shared by UI and MCP, debounced atomic persistence, in-memory canonical state, precompile source-map plumbed through to the inspector — is the right shape. The tests pin the right invariants. The visible bugs are minor; none of them are corruption-class with the project workflow as advertised (single OS user, single project, single tab).

It is **not** a SaaS, and trying to turn it into one without breaking it apart at the seams above (per-tenant state, real storage abstraction, signed asset URLs, render-as-queue, auth on every route, project access model in DB) would be a rewrite, not a port. The good news is the seams are already clean — `CommandBus` and `ProjectStore` take constructor options, `mcp_bridge.createEditorMcpServer` accepts injected deps, and the asset pipeline is one class. A SaaS conversion is **bounded engineering**, not architectural surgery.

For v1.0, the gating polish items are: undo shortcut, stage drag, render presets, and Linux/Windows "reveal" parity. Everything else is true polish.

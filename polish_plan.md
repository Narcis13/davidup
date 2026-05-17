---
doc_type: polish-plan
doc_title: davidup v1.0 — Step 20 Polish Plan (with PRD amendments)
date: 2026-05-17
author_email: narcis75@gmail.com
companion_to: vision/davidup-v1.0-editor-prd.md
supersedes: PRD step 20 ("Polish, validation surfacing, ship.")
audit_inputs:
  - .polish-audit/project-lifecycle.md
  - .polish-audit/library-architecture.md
  - .polish-audit/ui-completeness.md
  - .polish-audit/mcp-agent-ergonomics.md
---

# davidup v1.0 — Step 20 Polish Plan

## 0. Why this document exists

Step 20 in the PRD reads "Polish, validation surfacing, ship." Four parallel deep-dive audits surfaced that we cannot honestly ship v1.0 without two **PRD-level corrections** that go beyond polish — and a long list of polish work that the original step 20 grossly under-scoped.

The two PRD-level corrections are:

1. **FR-07 — Library is a SHARED POOL, not project-scoped.** The user's intent from day one was a common pool of templates / behaviors / scenes / assets every project can draw from. The current spec says "project-scoped" and the current code follows that spec. The good news: templates/scenes/behaviors are *already* process-global Maps in the engine — the transition is small.
2. **FR-17 (new) — Project CRUD UI + a recent-projects registry.** `davidup new <dir>` exists at the CLI; `home.vue` is still the stock Adonis welcome page. A human cannot list, switch, or delete projects without a terminal. An MCP agent cannot ask "what am I editing."

The remainder is honest polish — a status bar, a selection ring, keyboard shortcuts, async-render-over-MCP, and the bug fixes that came out from under rocks. Sequenced as **steps 20.1 → 20.32** below.

---

## 1. The 7 most load-bearing findings

| # | Finding | Source | Severity |
|---|---|---|---|
| F1 | Library *appears* project-scoped but templates/scenes/behaviors are already in a process-global Map (`src/compose/{templates,scenes,behaviors}.ts`). Sharing is closer than it looks. | `.polish-audit/library-architecture.md` §2 | high (architecture clarification) |
| F2 | `CommandBus.apply` is `async` but **unserialised** — two concurrent calls read pre-state, both write next-state, last writer wins. Will silently corrupt the composition under any MCP+UI co-editing. Violates DoD-D4. | `.polish-audit/mcp-agent-ergonomics.md` §10, `apps/editor/app/services/command_bus.ts:114-167` | **blocker** |
| F3 | `library_index` indexes `*.behavior.json` files but never registers them in the engine REGISTRY (only templates + scenes get registered, `library_index.ts:381-400`). Library cards exist for behaviors that cannot be resolved. | `.polish-audit/library-architecture.md` §3 | high (latent bug) |
| F4 | `library_index` never *unregisters* a deleted id from the engine REGISTRY — deleting a `.template.json` leaves the registration in memory until next restart. | `.polish-audit/library-architecture.md` §3, §9 | medium (latent bug) |
| F5 | `source: 'mcp'\|'ui'` is captured on every command but has **zero subscribers**; undo even hard-codes `source: 'ui'` (`command_bus.ts:185, 187`). Foundation for FR-13 (diff overlay) silently broken. | `.polish-audit/mcp-agent-ergonomics.md` §3 | high (foundation gap) |
| F6 | Validation surface is one `<div>` inside the Inspector (`Inspector.vue:274`). `useCommandBus.ts:84-89` drops error code / hint / issues / details. FR-14 is essentially absent. | `.polish-audit/ui-completeness.md` Q9 | high (FR-14 ship blocker) |
| F7 | `home.vue` is the unmodified Adonis welcome page (340 lines of Lucid / Vine / Inertia marketing tiles). `/` is the first impression and it screams "default scaffold." | `.polish-audit/ui-completeness.md` Q13, `pages/home.vue` | high (FR-17 ship blocker) |

---

## 2. PRD amendments (binding)

### 2.1 FR-07 — restated

**Old:** "Local library index. Project-scoped: `library/index.json` lists every behavior / template / scene / asset / font available in this project."

**New:**

> **FR-07 (P0) Shared library pool with project-local overlay.** The library is a two-root catalog: a **global pool** at `~/.davidup/library/` (overridable via `DAVIDUP_LIBRARY` env var) and a **project-local pool** at `<project>/library/`. Every project sees the union of both. Lookup precedence on resolution: project-local → global → engine built-ins. Project-local entries shadow global entries of the same id. Uploads default to project-local; the Library panel exposes a "save to global" toggle. Existing example projects keep working with zero composition.json changes.
>
> *Acceptance:*
> - Drop a new `.behavior.json` into `~/.davidup/library/behaviors/` → it appears in **every** open project's Library panel within 1s.
> - A composition referencing `brand::titleCard` resolves identically whether the template lives in project-local `library/` or in the global pool.
> - `cp -r examples/comprehensive-browser /tmp/elsewhere && davidup edit /tmp/elsewhere` works even with an empty global pool — project-local resolves first.

### 2.2 FR-17 — new requirement

> **FR-17 (P0) Project CRUD + recent-projects registry.** Editor exposes a project picker as the landing page and an in-editor project switcher. A recent-projects registry persists at `~/.davidup/recents.json`. Operations: list recent, open existing, scaffold new (wraps the existing `davidup new` codepath), forget a recent entry. Switching projects in-server resets undo stack, render queue, library watcher, and pushes the new composition to all connected Inertia clients. CLI gains `davidup list` and `davidup recent` for parity.
>
> *Acceptance:*
> - `http://localhost:3333/` shows the picker, not the Adonis welcome page, when no project is loaded.
> - Selecting a recent project, scaffolding a new one, and switching between two open projects all work without restarting the server.
> - `davidup list` prints the recent projects with their last-modified time.

### 2.3 FR-13 promoted from P1 to P0 (foundation only)

The plumbing for `source: 'mcp'|'ui'` already exists — wiring one subscriber (the Inspector "AI edit" pill + a status-bar chip) costs nothing on top of fixing F5 and is what makes Claude visibly a first-class peer. Full diff overlay still deferred to v1.2 as per PRD.

### 2.4 Definition of Done — additions

- **D9 · Project picker is the landing page.** No path leads a human to the Adonis welcome scaffold.
- **D10 · Shared pool works.** `~/.davidup/library/templates/foo.template.json` appears in every project's Library panel within 1s of file write.
- **D11 · UI/MCP concurrent edits are serialised.** Property-based test with random interleavings of UI and MCP commands produces byte-identical final composition.json regardless of source order, and the concurrent invocation race no longer occurs.

---

## 3. Architecture decisions

### 3.1 Shared library pool

**Disk layout (global, mirrors project-local):**
```
~/.davidup/
├── recents.json
├── state.json              # existing (panel layout)
└── library/
    ├── index.json
    ├── templates/<id>.template.json
    ├── behaviors/<id>.behavior.json
    ├── scenes/<id>.scene.json
    ├── assets/<sha256>.<ext>
    └── fonts/<name>.{ttf,woff2}
```

**Asset URL scheme:** introduce `global:assets/<sha256>.<ext>` (and `global:fonts/<file>`). The Zod schema for `composition.assets[].src` stays `z.string().min(1)` — `global:` is parsed at load time alongside the existing relative-path / http(s) / data: cases.

**Three touch-points (audit-cited):**
- `src/assets/browser.ts:56-65` — extend `resolveAssetSrc` to handle `global:`.
- `src/assets/node.ts` — same change for the Node driver.
- `apps/editor/app/controllers/editor_controller.ts:68-73` (`toProjectFileUrl`) — emit `/library-files/<rest>` for `global:` srcs.

**New route:** `GET /library-files/*` mirrors `/project-files/*`, served from `$DAVIDUP_LIBRARY` (default `~/.davidup/library`). Same path-traversal guard.

**Two-root LibraryIndex:** `library_index.ts` becomes a service that holds an array of `{ root, kind: 'project'|'global' }` indices. `attach(projectRoot)` rebinds the project root; the global root is permanent and watched from server boot. `GET /api/library` returns a merged catalog with `{ scope: 'project'|'global', overridden: boolean }` flags per entry. No merged file is written — merge happens on read.

**Resolution precedence (engine REGISTRY):** built-in default → global pool → project-local. Implemented by attach order: global indices register on boot; project index registers on `project.load()` after global, so its `register*` calls override. F4 fix: track per-(root, kind, id) registration so detach can call the matching `unregister*`.

**Portability guarantee:** the `Pack for export` action (step 20.31, optional v1.1) inlines `global:` references back into project-local assets. v1.0 ships without it — but the composition.json itself is portable as long as users keep their global pool, and a missing global asset fails loudly (no silent drop).

### 3.2 Project registry

**Disk:** `~/.davidup/recents.json` — `{ projects: [{ path, name, lastOpenedAt, lastModifiedAt }] }`. Write through `editor_state` service (which already owns `~/.davidup/state.json`).

**Server:**
- `GET /api/projects/recent` — list (validates path still exists; prunes missing).
- `POST /api/projects` — body `{ name, location, template? }`; runs the existing `src/cli/scaffold.ts` flow + auto-`projectStore.load()`.
- `POST /api/project` — already exists; reused for "open existing."
- `DELETE /api/projects/recent/:idx` — forget a recent.
- No "delete from disk" endpoint in v1.0 (too easy to misuse; CLI-only).

**Project-switch side effects** (currently *missing* per `.polish-audit/project-lifecycle.md` §5) — must be addressed in `project_store.load()`:
1. `commandBus.resetUndo()` — clear the undo stack.
2. `renderQueue.abortInFlight({ scope: previousProject })` — cancel in-flight renders writing to the old root.
3. `libraryIndex.attach(newProject.libraryRoot)` — already handled, but add explicit `detach` of old project index.
4. Broadcast via Transmit to `/projects/changed` — Inertia clients re-fetch.
5. Watcher rebind (the CLI's external-edit watcher follows `projectStore.project` already; verify in `apps/editor/scripts/watch.ts`).

---

## 4. Polish gap inventory (from UI audit)

Grouped by where they bite the user first.

**Stage feels broken:**
- No play/pause control; engine auto-plays once and stops (`Stage.vue`).
- No selection ring on clicked items (hit-test works but is invisible).
- No fit-to-viewport, no zoom, no 1:1.

**Inspector misses cases:**
- No boolean, no percent, no raw-JSON fallback (R2 unmitigated).
- "Overridden" baseline compares to load snapshot, not template/scene default — every edit looks overridden after first save (`Inspector.vue:15-18`).
- No tween editor at all (start/duration/easing/property).
- `__source` provenance captured but never displayed.

**Timeline cosmetics:**
- Source classification is id-string heuristic, not source-map-driven (`Timeline.vue:111-137`).
- No sealed-scene lock affordance.
- FR-15 (thumbnail strip) absent.

**Chrome / globals:**
- No app-bar, no project name in header (just a chip inside the stage).
- No scene tabs (FR-11).
- No status bar (only chip-sized overlay in stage panel).
- Only 1 of 7 PRD keyboard shortcuts wired (⌘J).
- No help overlay (FR-16 acceptance).
- `UploadToasts.vue` is upload-only — no general toast system.
- Validation errors hide in one Inspector `<div>`.

**Errors / no-project state:**
- `pages/errors/not_found.vue` + `server_error.vue` are 7-line Adonis stubs.
- `pages/home.vue` is the Adonis marketing scaffold.
- Broken composition.json throws on CLI boot; no UI recovery path.

**Render strip:**
- Past renders list not surfaced (data exists at `GET /api/renders`).
- No "reveal in Finder" button.

---

## 5. Sequenced execution plan — Steps 20.1 → 20.32

Each step has explicit inputs, outputs, files touched. Demoable in clusters. Steps marked **[blocker]** must complete before any user-visible polish work — they are correctness, not UX.

### Cluster A — Concurrency + bug fixes (blockers, ~2 days)

**20.1 — Serialise `CommandBus.apply` [blocker — closes F2, D11].**
- In `command_bus.ts:114`, wrap apply in a chain mutex (`this.queue = this.queue.then(...)`). Add property-based test (`tests/engine/command_bus_concurrency.test.ts`): 1000 random interleavings of UI+MCP commands must produce byte-identical composition.
- Out: concurrent UI + MCP edits no longer race.

**20.2 — Honour `source` in undo [closes F5].**
- `command_bus.ts:185-187` currently hard-codes `source: 'ui'` on undo. Carry the original source through. Wire one subscriber: `Inspector.vue` shows a small "AI edit" pill when the most recent change for the selected item has `source: 'mcp'`. This is the foundation for FR-13.

**20.3 — Register behaviors in REGISTRY [closes F3].**
- In `library_index.ts:381-400`, after the templates / scenes pass, register `*.behavior.json` entries via the engine's behaviors registry. If the engine lacks a public registration API, add one (`src/compose/behaviors.ts`).

**20.4 — Unregister deleted ids on watcher diff [closes F4].**
- Track `Map<(kind,id), unregisterFn>` in `library_index`. On watcher delete event, call the stored unregister.

### Cluster B — Shared library pool (~3 days)

**20.5 — `global:` URL scheme + `/library-files/*` route.**
- `src/assets/browser.ts`, `src/assets/node.ts`, `editor_controller.ts#toProjectFileUrl`, `start/routes.ts`.
- New `app/services/global_library_root.ts` — resolves `$DAVIDUP_LIBRARY` with default `os.homedir() + '/.davidup/library'`. Creates the dir tree on first read.

**20.6 — Two-root `LibraryIndex`.**
- Refactor `library_index.ts` to hold a list of roots. `attach(projectRoot)` rebinds project; global is permanent. `GET /api/library` returns merged catalog with `{ scope, overridden }` per entry.
- File-watch both roots.

**20.7 — Library panel: scope tabs + "save to global" upload toggle.**
- `Library.vue`: add a top-row pill toggle [Project | Global | All].
- `useAssetUpload.ts`: add `target: 'project'|'global'` body field; `asset_pipeline.ts` writes to the matching root.
- Visual: project entries get a 📁 chip, global entries get a 🌐 chip; overridden entries show a strike-through provenance hint.

**20.8 — Migrate existing example libraries [optional sanity check].**
- A one-off script `apps/editor/scripts/seed-global-library.ts` that copies `examples/editor-demo/library/{templates,behaviors,scenes}` to `~/.davidup/library/` for dogfooding. Not run automatically.

### Cluster C — Project CRUD (~3 days)

**20.9 — Recents registry service.**
- `app/services/recents.ts` — read/write `~/.davidup/recents.json`. Bumps `lastOpenedAt` on `projectStore.load()`. Prunes entries whose `path` no longer exists.

**20.10 — Project CRUD endpoints.**
- `GET /api/projects/recent`, `POST /api/projects` (scaffold + load), `DELETE /api/projects/recent/:idx`. `app/controllers/projects_controller.ts`.

**20.11 — Project switch — full reset.**
- In `projectStore.load()` (when called on an already-loaded server), call `commandBus.resetUndo()`, `renderQueue.abortInFlight(...)`, `libraryIndex.detachProject()`. Add path-traversal guard on POST `/api/project` (audit §8 risk). Broadcast `/projects/changed` via Transmit; Inertia router refetches `editor` page.

**20.12 — Replace `home.vue` with project picker.**
- New `inertia/pages/home.vue`: hero with two CTAs — "Open existing" (filesystem path field, validates server-side), "Create new" (name + parent dir + template dropdown). Below: "Recent projects" list. Delete = forget (not from disk).
- `routes.ts:20` — switch from `renderInertia('home')` to a controller that hydrates the page with recents.

**20.13 — Top app-bar with project switcher.**
- `layouts/editor.vue`: add a 32px top bar — left: project name + dropdown (recents + "Open another…"); center: save status; right: render button + help (?) button.

**20.14 — CLI: `davidup list`, `davidup recent`.**
- `src/cli/cli.ts` — two commands, both print the recents.json contents formatted as a table.

### Cluster D — Validation surface + toasts (~2 days)

**20.15 — Status bar component [FR-14].**
- New `inertia/components/StatusBar.vue` at the bottom of `EditorLayout` (between timeline and edge). Shows: error count (red), warning count (yellow), current selection id, playhead time, render status.
- Clicking the error count expands a panel with the full ValidationResult, each issue clickable → opens SourceDrawer at the right line.

**20.16 — Surface full `CommandValidationError` / `PostValidationError`.**
- `useCommandBus.ts:84-89` — preserve `code`, `hint`, `issues`, `details` from the response. New `useValidation` composable holds last full report. StatusBar subscribes.
- Inline timeline markers: red dot on a track that has an overlap, yellow dot for a warning. `Timeline.vue` reads from `useValidation`.

**20.17 — Unified toast system.**
- New `inertia/composables/useToasts.ts` + `Toasts.vue` (replaces `UploadToasts.vue`). Levels: success / info / warning / error. Used for: command failures the inspector doesn't own, render lifecycle, project switch, library refresh.

### Cluster E — Stage + Inspector polish (~3 days)

**20.18 — Selection ring on stage canvas.**
- `Stage.vue`: overlay a `<canvas>` (or absolute-positioned div with computed bbox) rendering a 2px ring around the selected item, updated each frame via `useStage.onTick`. The biggest perceptual hole — turns hit-testing from "trust me" into "I can see it."

**20.19 — Play/pause + Space shortcut.**
- Add `pause()` / `resume()` / `togglePlay()` to `useStage`. Space bound globally in a new `inertia/composables/useShortcuts.ts`.

**20.20 — Wire remaining PRD shortcuts [FR-16].**
- `useShortcuts.ts` central registry: Space (play/pause), S (split — defer to v1.1 if too big, otherwise wired), Backspace (delete selection), ⌘0 (fit timeline), ⌘J (already wired), ⌘R (render), ⌘S (force flush).

**20.21 — Help overlay (?).**
- `inertia/components/HelpOverlay.vue` — modal that lists shortcuts, drag-and-drop affordances, MCP cheat-sheet, links to README. Toggle: `?` key.

**20.22 — Inspector: boolean + percent + raw-JSON fallback.**
- `components/inputs/Boolean.vue`, `Percent.vue`, `RawJson.vue`. Field registry in `Inspector.vue:130-197` extended; unknown types fall through to `RawJson` (closes R2).

**20.23 — Inspector: surface source provenance.**
- A small "Source: brand::titleCard ⇢ scene[2]" line under the item header, sourced from `lastPickSource`. Click = ⌘J (open SourceDrawer at the line).

**20.24 — Inspector: minimal tween editor.**
- When a Timeline bar is selected (not an item), Inspector shows: property, from, to, start, duration, easing dropdown. Edits route through `updateTween`. Full curve editor deferred to v1.1.

**20.25 — Inspector: correct override detection.**
- Compare current value to the *template/scene default* (via precompile sourcemap), not to the load-time snapshot. `Inspector.vue:15-18` admits the current heuristic is wrong.

### Cluster F — Timeline + Render polish (~1 day)

**20.26 — Timeline source classification from source-map [FR-08 alignment].**
- `Timeline.vue:111-137` — replace id-string heuristic with the `__source.originKind` field already emitted by step-15 precompile. Bars become truly accurate.

**20.27 — Sealed-scene lock affordance.**
- Visual: gold bars get a small lock icon when the scene is sealed; pointer events disabled for move/resize; double-click opens the scene file in SourceDrawer.

**20.28 — Past-renders list panel.**
- New `inertia/components/RenderHistory.vue` — collapsible list inside RenderStrip. "Reveal in Finder" button (open via `open` shell — already a dep) and "Play in QuickTime" link.

### Cluster G — MCP completeness for agents (~2 days)

**20.29 — Project CRUD MCP tools.**
- `src/mcp/tools.ts`: `current_project`, `list_projects`, `open_project { path }`, `create_project { name, location, template? }`. All route through the same controllers as the UI.

**20.30 — `list_library` MCP tool with thumbnails.**
- Returns the same merged catalog as `GET /api/library`, including `thumbnailUrl` (`/library/thumbnail?...`), `scope`, `overridden`. Agents finally see what humans see.

**20.31 — Async render via MCP.**
- `render_to_video` returns `{ jobId }` immediately; add `get_render { jobId }` (status + progress) and `list_renders`. Reuses the existing Transmit job queue.
- Keep blocking mode behind `{ wait: true }` for backwards compat (until v2.0).

**20.32 — Structured error details in MCP responses.**
- `mcp_bridge.ts:208-215` — preserve `issues[]` and `warnings[]` in `MCPErrorBody`. Add `details` field. Agents finally get actionable validation feedback instead of `errors[0].message`.

### Cluster H — Ship gates (~1 day)

**20.33 — Styled error pages.**
- `pages/errors/not_found.vue` + `server_error.vue` — match editor visual style; surface a "back to projects" button.

**20.34 — README + 90s demo video.**
- README rewritten around `npx davidup edit` flow. 90s clip authored in the editor we just built (closes D8).

**20.35 — `npm publish` dry-run + npx smoke test.**
- Verify single-binary distribution. Smoke test: `npx davidup edit ./examples/comprehensive-browser` on a clean Docker container loads < 3s (closes D1).

---

## 6. Updated Definition of Done

v1.0 ships when **D1 → D11** are all green (D1-D8 from PRD, D9-D11 added here):

- D1 · `npx davidup edit` works from a clean machine.
- D2 · Three panels live against every example comp.
- D3 · Stage uses production engine, pixel-equal to server render.
- D4 · UI ↔ MCP byte-identical parity (now load-bearing on 20.1 mutex).
- D5 · Reveal-in-source works on sealed scenes.
- D6 · Render from editor with progress.
- D7 · SaaS-ready architecture — no controller signature changes for v2.0.
- D8 · Experiment 1 from vision doc shipped.
- **D9 · Project picker is the landing page.** No human path leads to the Adonis welcome scaffold.
- **D10 · Shared pool works.** `~/.davidup/library/templates/foo.template.json` appears in every project's Library panel within 1s.
- **D11 · Concurrent UI+MCP edits serialise.** Property-based test of 1000 random interleavings produces byte-identical composition.json.

---

## 7. Risks and mitigations

**R-P1 — Scope creep on inspector tween editor (20.24).**
*Mitigation:* keep it to a single panel with 5 fields. No curve editor, no keyframe graph. If it grows past 2 days, fall back to raw-JSON for tweens.

**R-P2 — Shared-pool migration breaks an example.**
*Mitigation:* the global pool starts empty; project-local resolves first; existing examples are untouched. CI test: re-run all examples' precompile and assert byte-equal output before/after.

**R-P3 — Project switch races (render in flight + library watcher rebind).**
*Mitigation:* `projectStore.load()` becomes an atomic sequence behind the new chain mutex (20.1). New tests: switch while a render is mid-progress; switch while watcher is mid-rescan.

**R-P4 — Recents registry corruption on crash.**
*Mitigation:* write `~/.davidup/recents.json` atomically (`writeFile` to `.tmp` + `rename`). Same pattern as `state.json`.

**R-P5 — `home.vue` rewrite breaks first-paint perf.**
*Mitigation:* SSR via Inertia is already wired; the picker is lighter than the Adonis marketing scaffold it replaces — net win.

**R-P6 — MCP async render breaks existing scripts.**
*Mitigation:* `render_to_video { wait: true }` retains blocking behaviour. New default is async (returns jobId). Documented in CHANGELOG.

---

## 8. Sequencing summary

| Cluster | Days | Output |
|---|---|---|
| A. Concurrency + bug fixes | 2 | F2/F3/F4/F5 closed |
| B. Shared library pool | 3 | FR-07 (new) acceptance passes |
| C. Project CRUD | 3 | FR-17 acceptance passes |
| D. Validation surface + toasts | 2 | FR-14 ship-ready |
| E. Stage + Inspector polish | 3 | Selection ring, shortcuts, help overlay |
| F. Timeline + Render polish | 1 | Source-map accuracy, render history |
| G. MCP completeness | 2 | Agent-first parity restored |
| H. Ship gates | 1 | Docs, demo, publish dry-run |
| **Total** | **~17 days** | v1.0 |

This is roughly twice what the original step 20 budgeted — but it's the honest number given what the audits surfaced. The fastest path to a shippable v1.0 is to do clusters A, C, D, the chrome parts of E (selection ring + shortcuts + help), G, H — and treat B (shared pool) as the architectural correction that earns the right to ship.

---

## 9. Open decisions before kickoff

All four judgment calls have been **decided** per the recommendations baked in above. Implementation can begin.

1. **Shared pool location** — ✅ **DECIDED**: `~/.davidup/library/` (overridable via `DAVIDUP_LIBRARY`). Keep `~/.davidup/` for consistency with `state.json` and `recents.json`; ignore XDG until v2.0.
2. **Project-switch UX** — ✅ **DECIDED**: in-place state swap via Inertia partial reload (faster, preserves panel layout), with a hard-reload fallback if the Vue mount errors.
3. **MCP async render default** — ✅ **DECIDED**: flip default to async — long-running blocking tool calls are an anti-pattern for agents in 2026.
4. **Step 20.24 tween editor scope** — ✅ **DECIDED**: ship the minimal 5-field panel for v1.0 — without it the Inspector cannot edit the bulk of what timeline drag produces.

All four are confirmed. Implementation starts on cluster A and proceeds in order. Cluster A and B can be parallelised by two people / two sessions if needed; everything else is sequential per cluster but parallel across clusters once A is done.

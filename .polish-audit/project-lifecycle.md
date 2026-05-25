# davidup — Project Lifecycle Audit

Scope: how a davidup project is created, opened, switched, and surfaced inside the running editor server. All file paths are absolute.

---

## 1. CLI surface

The `davidup` CLI lives entirely under `src/cli/`. Repo-root `package.json` declares both binaries:

```
/Users/narcisbrindusescu/newme/davidup/package.json:28-31
  "bin": {
    "davidup-mcp": "./src/mcp/bin.ts",
    "davidup": "./src/cli/bin.ts"
  }
```

`src/cli/bin.ts` is a thin wrapper that forwards `process.argv.slice(2)` to `runCli` (`/Users/narcisbrindusescu/newme/davidup/src/cli/bin.ts:6-16`).

`src/cli/cli.ts` defines the entire surface — there are **exactly four** commands and they are reflected in the USAGE block (`/Users/narcisbrindusescu/newme/davidup/src/cli/cli.ts:58-84`):

```
davidup edit <dir> [--port=<n>] [--host=<h>] [--no-open]
davidup new  <dir> [--template=<name>] [--force]
davidup --help
davidup --version
```

- **`davidup new` DOES exist.** It is wired at `src/cli/cli.ts:97-131` and dispatched at `src/cli/cli.ts:156-157` to `runNewCommand` (`src/cli/cli.ts:164-196`), which calls `scaffoldProject` from `src/cli/scaffold.ts`.
- **Scaffolding logic is real.** `scaffoldProject` (`/Users/narcisbrindusescu/newme/davidup/src/cli/scaffold.ts:60-112`) copies `src/cli/templates/basic/` (composition.json, assets/, library/, README.md) into the target, creates `renders/`, then re-validates `composition.json` against the live schema before returning. Refuses non-empty directories (`E_TARGET_NOT_EMPTY`) unless `--force` is passed (`scaffold.ts:78-90`). Only one template ships: `basic` (`/Users/narcisbrindusescu/newme/davidup/src/cli/templates/` lists `basic`).
- **`davidup edit` also pre-validates** the composition before booting the server (`src/cli/cli.ts:222-230`) — clean message, exit 1 if `composition.json` is missing, and it suggests `davidup new <path>`.
- **There is NO `davidup list`, NO `davidup recent`, NO `davidup open`, NO `davidup remove`.** `parseArgs` (`cli.ts:86-134`) only accepts `edit | new | help | version`; everything else returns `kind: "error"` (`cli.ts:133`).

The `edit` command also wires a `fs.watch` on `composition.json` + `library/` (`src/cli/edit.ts:326-358`) and POSTs `/api/project` to reload on external edits (`src/cli/edit.ts:360-388`) — but that's reload-same-dir, not switch-to-another-project.

`apps/editor/scripts/` only contains `verify-engine-import.ts` and `verify-engine-subpaths.ts` — workspace sanity checks, nothing user-facing.

---

## 2. Server-side project services

### `apps/editor/app/services/project_store.ts`

Single in-memory `ProjectStore` instance, exported as default singleton (`project_store.ts:238`). Surface:

- `load(directory)` (`project_store.ts:77-170`) — flushes any pending writes, stat the dir, stat `composition.json`, parse JSON, **`precompile()`** (lowers `$ref` / `$template` / `$behavior` / `scene` constructs — line 112), then `validateComposition()`. Errors are typed via `ProjectLoadError` with codes `E_PROJECT_NOT_FOUND | E_COMPOSITION_MISSING | E_COMPOSITION_PARSE | E_COMPOSITION_INVALID | E_NO_PROJECT` (`project_store.ts:17-23`). On success: populates `#project`, attaches `libraryIndex` to `<root>/library/` (line 161-166) or detaches if absent.
- `update(composition)` (`project_store.ts:176-182`) — mutates in-memory state, schedules debounced write (default 500ms, `project_store.ts:35`).
- `#scheduleWrite()` (`project_store.ts:184-200`) → `#flushOnce()` (`project_store.ts:202-210`) does `writeFile(tmp)` + `rename` — atomic.
- `flush()` (`project_store.ts:213-228`) — forces pending writes to disk.
- `unload()` (`project_store.ts:231-235`) — flushes, drops `#project`, detaches `libraryIndex`. **Currently never called from any controller** — only used by tests.

There is **NO** create/delete/list at the service layer. `load()` is the only entrypoint; the store is intentionally single-project (`project_store.ts:43`: "Single in-memory composition with a debounced disk writer.").

### `apps/editor/app/controllers/projects_controller.ts`

Two endpoints — `show` (GET /api/project) and `load` (POST /api/project):

- `show` (`projects_controller.ts:13-33`) returns the in-memory composition or 404 with `E_NO_PROJECT`.
- `load` (`projects_controller.ts:41-71`) takes `{ directory }` and re-calls `projectStore.load(directory)`. **This is also the project-switch path** — POSTing a different directory replaces the in-memory project (see Q5 for caveats).

**No `create_project`, `delete_project`, `list_projects` endpoints exist.** Confirmed by full route inspection (`apps/editor/start/routes.ts:26-42`).

### Recent-projects registry

**Does not exist.** The only path that touches `~/.davidup/` is the editor-state store (panel sizes — see Q3). A search for `recent` across `apps/editor/` returned no project-related hits (`apps/editor/app/services/command_bus.ts:170` is about undo, not recent projects).

---

## 3. Editor state / persistence

### `apps/editor/app/services/editor_state.ts`

Persists exactly **one** thing: panel layout (left, right, bottom panel sizes). Type at `editor_state.ts:13-24`:

```ts
export type PanelLayout = { leftWidth: number; rightWidth: number; bottomHeight: number }
export type EditorState = { panelLayout: PanelLayout }
```

Storage: `~/.davidup/state.json`, atomic write (tmp + rename) at `editor_state.ts:135-142`. Path resolution at `editor_state.ts:151-156`:

```ts
const dir = override ? override : join(homedir(), '.davidup')
return join(dir, 'state.json')
```

`DAVIDUP_STATE_DIR` env override is supported (tests). Defaults at `editor_state.ts:26-30`: 280/320/220 px. Clamped to `PANEL_LIMITS` (`editor_state.ts:32-36`).

**This is the ONLY persistent global state.** No recent-projects, no last-opened, no per-project layout, no workspace cache. The store is project-agnostic.

### `apps/editor/app/controllers/editor_state_controller.ts`

GET → returns state; PUT → merges `panelLayout` and rewrites the file (`editor_state_controller.ts:11-29`). No project field is read or written.

### Migrations

```
/Users/narcisbrindusescu/newme/davidup/apps/editor/database/migrations/
└── 1778780645125_create_users_table.ts
```

Only a `users` table from the AdonisJS skeleton (`migrations/1778780645125_create_users_table.ts:6-14`: `id, full_name, email, password, created_at, updated_at`). **It is unused** — there are no `User` Lucid models referenced anywhere, no auth-protected routes, and the editor never authenticates. Treat this as boilerplate that should either be deleted or repurposed.

There is **no SQLite-backed projects table, no recent_projects table, no workspaces table**.

---

## 4. Home / landing page

The route is one line:

```
/Users/narcisbrindusescu/newme/davidup/apps/editor/start/routes.ts:20
router.on('/').renderInertia('home')
```

This renders `/Users/narcisbrindusescu/newme/davidup/apps/editor/inertia/pages/home.vue`, which is the **stock AdonisJS starter welcome page** — links to AdonisJS docs, Adocasts, Lucid, Vine, Inertia, Japa, plus a footer banner "Route for this page is registered in `start/routes.ts` file, rendering `inertia/pages/home.vue` template" (`home.vue:336-338`). Zero davidup branding, zero project picker, no calls to `/api/project`.

### `EditorController#show`

`/Users/narcisbrindusescu/newme/davidup/apps/editor/app/controllers/editor_controller.ts:84-113`. When no project is loaded the controller still renders the editor page, just with `composition: null` and an error payload:

```
editor_controller.ts:87-97
return inertia.render('editor', {
  composition: null, compositionSource: null, project: null,
  error: {
    code: 'E_NO_PROJECT',
    message: 'No project loaded. Boot the editor with `davidup edit <dir>`.'
  }
})
```

**There is no redirect** to `/` or a picker. Hitting `/editor` with no project shows an editor frame with a friendly error — not a project chooser, not a "create new" CTA. There is no UI wiring anywhere to invoke `POST /api/project` interactively.

What *should* live on `/` for a polished product: a project picker with (a) "Open recent" list, (b) "Open folder…" (pointing at a path), (c) "New project" form (path + template dropdown), (d) link straight to `/editor` when one is already loaded.

---

## 5. Multi-project model

**Can the running server switch projects without a restart?** Technically yes, via `POST /api/project` with a new `directory`. `ProjectStore#load` (`project_store.ts:77-170`) first calls `await this.flush()` (line 78) so pending writes on the old project hit disk, then replaces `#project`. The `libraryIndex` is also re-attached / detached at lines 161-167.

But the side effects are **not** fully clean:

1. **CommandBus undo stack is NOT reset on project switch.** `CommandBus` snapshots are appended at `command_bus.ts:91-102` and only `reset()` (`command_bus.ts:208-211`, comment "Used in tests") clears them. After a switch the user could press undo and restore a composition from a previous project into the new one. Critical bug-in-waiting.
2. **MCP bridge per-call store is re-hydrated from `projectStore.composition` every dispatch** (`mcp_bridge.ts:146-153`), so MCP reads are fine. Mutations route through `commandBus.apply()` which targets the current project — fine too. But (1) above still applies.
3. **Render queue is global, not project-scoped.** `renderJobs` is a module-level singleton (`render_worker.ts:292`). In-flight render jobs from the old project keep running and writing to the *old* `project.root/renders/` because `outputPath` was captured at job creation (`renders_controller.ts:87-99`). A late SSE subscriber on `/api/renders/:id/events` will still get events for the previous project. Not catastrophic but confusing.
4. **`fs.watch` on `composition.json` in `library_index`** — `library_index.attach()` calls `detach()` first (`library_index.ts:222`), so the watcher does swap correctly.
5. **External-edit watcher in the CLI** (`src/cli/edit.ts:148-164`) is still bound to the *original* `projectDir` passed at boot. After a POST-switch it would still trigger reloads for the *original* directory — out of sync with what the editor is showing.
6. **`preload_mcp_stdio.ts`** mounts the MCP server once at boot (`preload_mcp_stdio.ts:20-30`); the bridge it uses references `projectStore` lazily, so MCP itself follows the switch correctly (sees `E_NO_COMPOSITION` if nothing loaded — `mcp_bridge.ts:121-131`).

Net: project switching *kind of works* via the existing POST, but the undo stack contamination, lingering renders, and stale CLI watcher mean nothing in the code base treats "switch project" as a supported operation. The store doc-comment at line 43 even hard-asserts "Single in-memory composition" as the design.

---

## 6. MCP-agent perspective

The MCP tool registry is at `/Users/narcisbrindusescu/newme/davidup/src/mcp/tools.ts:1443-1490`. The 35 tools cover composition lifecycle (create/get/set/validate/reset), assets, layers, items, tweens, behaviors, templates, scenes, and rendering. There are **zero project-management tools** — no `list_projects`, no `create_project`, no `switch_project`, no `open_project`. The MCP-namespaced tools you see (`mcp__davidup__*`) match this list one-for-one.

Note also: `create_composition` (`tools.ts:102-126`) and `reset` (`tools.ts:174-186`) operate on the `CompositionStore` inside the editor's `mcp_bridge`, not on the project lifecycle. The bridge wires them to the per-call hydrated store (`mcp_bridge.ts:146-153`), and they are intentionally registered as fall-through reads (see the `mcp_bridge.ts` header comment at lines 35-39: "Compositional lifecycle (create_composition / reset) — fall through against the per-call store. They have no effect on the editor's composition…"). So an agent calling `create_composition` while connected to an editor MCP bridge does **not** create a new davidup project — it creates a phantom composition in a throwaway in-memory store the editor will not surface.

An agent today **cannot**: enumerate the user's projects, create one, switch the editor to a different one, or even know what directory the editor is currently editing. The only project-shaped info it can derive is implicit: a successful mutation means *some* project is loaded; an `E_NO_COMPOSITION` error means none is.

---

## 7. Minimum project CRUD a human needs

For davidup to feel like a product (versus a CLI-driven tool), the following are mandatory:

| Operation       | CLI                                                | UI surface                                                                                    | API |
|-----------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------|-----|
| Create          | `davidup new <dir>` (exists)                       | "New project" card on `/`, plus an item in a top-bar "File" menu inside `/editor`             | `POST /api/projects` (new) → wraps `scaffoldProject` + `projectStore.load` |
| Open existing   | `davidup edit <dir>` (exists)                      | "Open folder…" on `/` (native folder picker via the browser is limited — keep a path input)   | `POST /api/project` (exists; reuse for switch) |
| Switch          | Restart with `davidup edit <other>` (today)        | Top-bar project dropdown listing recents; pick → POST /api/project; toast on success          | `POST /api/project` (exists) — but needs undo-stack reset + render-queue isolation (see Q8) |
| Recent list     | `davidup list` / `davidup recent` (MISSING)        | Bento of recents on `/`; same list under top-bar dropdown                                     | `GET /api/projects/recent` → reads `~/.davidup/recents.json`; updates on every successful load |
| Rename          | `davidup rename <dir> --to=<new>` (MISSING; low priority) | Inline rename in recents list                                                          | Optional — directory move on disk |
| Delete          | `davidup remove <dir>` (MISSING; low priority — destructive) | Confirm-modal in recents list                                                          | Optional — recents-only by default; full-delete behind a `--purge` flag |
| Reveal in OS    | n/a                                                | "Reveal in Finder/Explorer" context-menu                                                       | n/a (browser limitation; can be done via a CLI side-channel) |

**Placement.**
- The **landing page** (`/`) is the right home for: full recents grid, "New project" + "Open folder…" buttons, "What's davidup?" intro.
- An **editor-top-bar dropdown** (current project name + chevron) is the right place for the short recents list, "Switch project…", "New project…", "Open folder…", "Reveal in Finder".
- Both surfaces should call the same `GET /api/projects/recent` + `POST /api/project` endpoints.

**CLI roundoff.** Add `davidup list` (read `~/.davidup/recents.json`, print as table) and `davidup recent` (same, default to most-recent-first). Keep `new` and `edit`. Defer `rename`/`remove`.

---

## 8. Risks of changing

1. **CommandBus undo state must be reset on project switch.** `command_bus.ts` exposes a `reset()` but the doc comment says "Used in tests" (`command_bus.ts:208-211`); promoting it into the normal switch path is the fix. Wire it into either `ProjectStore#load` (preferred — guarantees coupling) or the `projects_controller.load` handler.
2. **Render queue is process-global.** `render_worker.ts:292` `renderJobs = new RenderJobRegistry()` retains 32 most recent jobs. A switch should drop in-flight jobs for the previous project (cancel them) or refuse the switch while a render is running. Either way the controller path at `renders_controller.ts:62-100` captures `project.root` *at job-create time*, so completed jobs already point at the right disk path — only in-flight jobs and SSE subscribers leak.
3. **CLI external-edit watcher is bound to the boot project.** `src/cli/edit.ts:148-164` watches `projectDir` from the spawn-time args. After a POST-driven switch, this watcher still fires reloads for the *original* directory, which would clobber the new project's in-memory state via the reload POST (`edit.ts:360-388`). Either move the watcher into the server (subscribe to `projectStore` load events) or document that switch-via-UI is not compatible with the CLI watcher.
4. **`library_index` global singleton is fine to swap** — it already calls `detach()` before `attach()` (`library_index.ts:222`). No risk.
5. **MCP bridge** sees the new project automatically because `buildDeps` calls `projectStore.composition` lazily (`mcp_bridge.ts:146-153`). However, an agent currently has *no signal* that a switch happened — adding an MCP resource or notification (`projects/changed`) would help future agents.
6. **Inertia page bootstrap (`editor_controller.show`)** embeds the composition into the page payload (`editor_controller.ts:101-112`). After a POST switch the client must re-fetch (`/api/project` GET) or do an Inertia reload. Currently the client never re-fetches — it would show the old composition until a manual reload.
7. **No SQLite schema for projects.** Adding a recents registry is best done as a flat JSON file (`~/.davidup/recents.json`) next to `state.json` — mirrors the existing `editor_state.ts` pattern (atomic write, env override). Avoid adding Lucid migrations just for this; the existing `users` migration is dead weight and should either be removed or repurposed.
8. **`projectStore` is a module singleton with no events.** Anything that wants to react to a project change (clear undo, drop renders, push to clients via SSE) must subscribe — but there is no subscription API yet. A small `EventEmitter` on `ProjectStore` (`'loaded'`, `'unloaded'`) keeps the switch coordination clean.
9. **`composition.json` path-traversal protection** in `editor_controller.file` (`editor_controller.ts:160-167`) is per-project. Trusting a user-supplied `directory` in `POST /api/project` for *switching* is a much bigger trust boundary — the running editor's HTTP server is already only bound to `localhost` by default (`src/cli/cli.ts:72-73`, `DEFAULT_HOST = "localhost"`), but if anyone exposes it remotely the switch endpoint becomes "open any directory on the host". Add an allowlist (recents + scaffold target only) or require an explicit `Origin: localhost` check.

---

## Summary cheat-sheet

| Concern                                | Status      | Where |
|----------------------------------------|-------------|-------|
| `davidup new <dir>` scaffolding        | DONE        | `src/cli/cli.ts:164`, `src/cli/scaffold.ts` |
| `davidup edit <dir>` boot + watch      | DONE        | `src/cli/edit.ts` |
| `davidup list` / `recent`              | MISSING     | — |
| GET/POST `/api/project`                | DONE        | `apps/editor/app/controllers/projects_controller.ts` |
| Create-project HTTP endpoint           | MISSING     | — |
| List-projects HTTP endpoint            | MISSING     | — |
| Recent-projects registry on disk       | MISSING     | (only `~/.davidup/state.json` for panel sizes) |
| Landing page (`/`) for davidup         | NOT DONE    | `apps/editor/inertia/pages/home.vue` = stock Adonis welcome |
| Project picker UI                      | NOT DONE    | — |
| MCP project-management tools           | MISSING     | `src/mcp/tools.ts:1443` (35 tools, none for projects) |
| Undo-stack reset on project switch     | MISSING     | `command_bus.ts:208` only used in tests |
| Render-queue isolation per project     | MISSING     | `render_worker.ts:292` global singleton |
| CLI watcher follows project switch     | NOT DONE    | `src/cli/edit.ts:148` binds boot dir |
| Inertia client re-fetch on switch      | NOT DONE    | `inertia/pages/editor.vue` initial-prop-only |
| Unused `users` migration               | DEAD WEIGHT | `apps/editor/database/migrations/1778780645125_create_users_table.ts` |

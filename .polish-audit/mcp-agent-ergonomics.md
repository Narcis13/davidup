# Davidup MCP Server / AI-Agent Ergonomics Audit

Scope: davidup ships an MCP stdio server (`src/mcp/`) that is mounted **inside**
the editor's AdonisJS process (`apps/editor/start/preload_mcp_stdio.ts`) and
routed through the editor's `CommandBus` (`apps/editor/app/services/mcp_bridge.ts`).
This audit answers ten questions about how well the surface serves a
first-class Claude persona today, and what minimum tools we need to add for
v1.0.

---

## 1. MCP tool registry — confirmed list

Single source of truth: `src/mcp/tools.ts:1443-1490` exports a frozen
`TOOLS` array. Every name registers with the SDK at `src/mcp/server.ts:68-70`
via `registerTool(...)`. There are **36 tools**:

| # | Name | File:line | Mutating? |
|---|------|-----------|-----------|
| 1 | `create_composition` | tools.ts:102 | yes (lifecycle) |
| 2 | `get_composition` | tools.ts:128 | no |
| 3 | `set_composition_property` | tools.ts:141 | yes |
| 4 | `validate` | tools.ts:161 | no |
| 5 | `reset` | tools.ts:174 | yes (lifecycle) |
| 6 | `register_asset` | tools.ts:190 | yes |
| 7 | `list_assets` | tools.ts:216 | no |
| 8 | `remove_asset` | tools.ts:228 | yes |
| 9 | `add_layer` | tools.ts:245 | yes |
| 10 | `update_layer` | tools.ts:271 | yes |
| 11 | `remove_layer` | tools.ts:294 | yes |
| 12 | `add_sprite` | tools.ts:321 | yes |
| 13 | `add_text` | tools.ts:361 | yes |
| 14 | `add_shape` | tools.ts:404 | yes |
| 15 | `add_group` | tools.ts:449 | yes |
| 16 | `update_item` | tools.ts:504 | yes |
| 17 | `move_item_to_layer` | tools.ts:520 | yes |
| 18 | `remove_item` | tools.ts:535 | yes |
| 19 | `add_tween` | tools.ts:553 | yes |
| 20 | `update_tween` | tools.ts:587 | yes |
| 21 | `remove_tween` | tools.ts:612 | yes |
| 22 | `list_tweens` | tools.ts:626 | no |
| 23 | `apply_behavior` | tools.ts:645 | yes |
| 24 | `list_behaviors` | tools.ts:704 | no |
| 25 | `apply_template` | tools.ts:727 | yes |
| 26 | `list_templates` | tools.ts:810 | no |
| 27 | `define_user_template` | tools.ts:821 | yes (global registry) |
| 28 | `define_scene` | tools.ts:914 | yes (global registry) |
| 29 | `import_scene` | tools.ts:956 | yes (global registry) |
| 30 | `list_scenes` | tools.ts:1009 | no |
| 31 | `remove_scene` | tools.ts:1020 | yes (global registry) |
| 32 | `add_scene_instance` | tools.ts:1171 | yes |
| 33 | `update_scene_instance` | tools.ts:1226 | yes |
| 34 | `remove_scene_instance` | tools.ts:1321 | yes |
| 35 | `render_preview_frame` | tools.ts:1349 | no |
| 36 | `render_thumbnail_strip` | tools.ts:1370 | no |
| 37 | `render_to_video` | tools.ts:1392 | no (but blocking) |

The 21 composition-mutating tools (rows marked "yes" excluding registry/lifecycle)
are also enumerated in `COMMAND_TO_TOOL` at `apps/editor/app/types/commands.ts:416-438`
so the bridge can intercept them; non-mutating tools fall through to the
default handler against a freshly-hydrated CompositionStore
(`mcp_bridge.ts:146-153`).

### Tools the **UI** uses that have no MCP equivalent

The editor's HTTP/Inertia surface exposes these capabilities — none of which
an agent can reach:

| UI capability | UI entrypoint | MCP gap |
|---|---|---|
| Load a project from disk | `POST /api/project` → `projects_controller.ts:41` | No `open_project` / `load_project` |
| Read the current project metadata | `GET /api/project` → `projects_controller.ts:13` | No `current_project` |
| Read library catalog (templates+scenes+assets+fonts) | `GET /api/library` → `library_controller.ts:21` | `list_templates`/`list_scenes`/`list_assets` are split, none returns thumbnails |
| Get library thumbnail PNG | `GET /api/library/thumbnail` → `library_controller.ts:62` | No MCP equivalent — agent can't see previews |
| Upload an asset file | `POST /api/assets` → `assets_controller.ts` | No MCP `upload_asset { bytes, name }` |
| Enqueue a non-blocking render with a job id | `POST /api/renders` → `renders_controller.ts:61` | MCP `render_to_video` is **blocking** |
| Subscribe to render progress | `GET /api/renders/:id/events` (SSE) → `renders_controller.ts:174` | No MCP poll/subscribe |
| Editor UI state (selection, playhead) | `GET/PUT /api/editor-state` → `editor_state_controller.ts` | No MCP `get_selection` / `set_playhead` (would let agents track what the user is looking at) |
| Undo (linear stack lives in CommandBus) | not yet wired to UI, but `CommandBus.undo()` exists at `command_bus.ts:175` | No MCP `undo` |
| Get composition.json on disk | `GET /api/composition-source` → editor controller | `get_composition` covers it |

---

## 2. Project-awareness — how does an MCP tool know **which** project is loaded?

There is **no project selector** on any tool. The bridge knows because there
is exactly one global `projectStore` singleton
(`apps/editor/app/services/project_store.ts:238`) holding **one** in-memory
composition.

End-to-end trace of `get_composition` from an agent:

1. SDK calls our registered handler at `src/mcp/server.ts:92-104`.
2. `dispatchTool` parses args, asks the router (`src/mcp/dispatch.ts:58`).
3. Bridge router looks up `get_composition` in `TOOL_TO_COMMAND`
   (`apps/editor/app/services/mcp_bridge.ts:77`). It's a **read** tool, so
   the router returns `null` (`mcp_bridge.ts:118-119`).
4. Falls through to default handler. `depsFactory` (`mcp_bridge.ts:107`)
   calls `buildDeps(store)` (`mcp_bridge.ts:146-153`) which builds a fresh
   `CompositionStore` and `hydrateStore(...)` from `store.composition`.
   The hydration id is hard-coded to `__editor_bridge__` (`mcp_bridge.ts:85`).
5. Tool's `handler` runs `store.toJSON(args.compositionId)`. If
   `args.compositionId` is omitted (the design's escape hatch), the store
   returns the default — i.e. the hydrated bridge composition. If the agent
   passes a non-matching `compositionId`, the call **fails with
   `E_NO_COMPOSITION`** (`store.ts:1056-1073`).

So the agent has no way to ask **which** project this is, **where** it lives
on disk, or to **switch** to another one. There is no `list_projects` and no
`switch_project`. The CLI/`preload_project.ts:22` sets it once from
`DAVIDUP_PROJECT`; after that the editor is single-project-pinned for life.

This conflicts with the PRD's first-class persona claim: an agent can't even
answer "what am I editing?".

---

## 3. Source tagging — `source: 'mcp'` vs `source: 'ui'`

The `source` field is part of every command:

- Schema: `apps/editor/app/types/commands.ts:100` — `const SOURCE =
  z.enum(['ui', 'mcp']).default('ui')`.
- Bridge sets it on every routed command: `mcp_bridge.ts:134`:
  ```ts
  const command = { kind, payload, source: 'mcp' } as unknown as Command
  ```
- UI's `useCommandBus.ts` never sets `source`, so the Zod default `'ui'`
  applies (`commands.ts:100`).
- It survives into `ChangeEvent.source` (`command_bus.ts:67-73`, set at
  `command_bus.ts:152-159`).

But the consumer story is empty:

- `CommandBus.on()` has no subscribers anywhere in the editor. `grep -rn
  "commandBus.on\|bus.on"` over `apps/editor/app/` returns zero matches.
- The change-event seam exists at `command_bus.ts:152-159` purely as a
  forward-compatibility hook (the PRD's "Inertia push / SSE relay" — none
  shipped).
- `CommandsController#apply` returns `{ composition, command, undoStackSize }`
  (`commands_controller.ts:39-43`) — `command.source` is present, but the UI
  ignores it. No diff overlay reads it. No undo branching reads it. The MCP
  bridge does not re-emit it back to the agent.
- Worse, on `undo()` the synthesised event always carries `source: 'ui'`
  (`command_bus.ts:185, 187`), so even the placeholder shipping today is
  wrong-by-default for the agent case.

**Gap:** the agent gets no way to know "this change was mine" vs "the user
did this in the UI". And the UI can't visually show "Claude just changed
this tween". The wire is in place; both ends are unplumbed.

---

## 4. Validation in MCP responses — what does the agent see on a bad mutation?

Three kinds of failure get folded into structured codes:

1. **Tool-level rejection** (the underlying `MCPToolError` from `src/mcp/`):
   - `E_TWEEN_OVERLAP`, `E_NOT_FOUND`, `E_INVALID_PROPERTY`, `E_DUPLICATE_ID`,
     `E_ASSET_IN_USE`, `E_LAYER_NOT_EMPTY`, `E_BEHAVIOR_UNKNOWN`, etc.
   - Caught in the bridge: `mcp_bridge.ts:205-207` (`CommandRejectedError`
     re-narrowed via the `KNOWN_CODES` whitelist at `mcp_bridge.ts:225-252`).
   - Surfaces as `{ ok:false, error:{ code, message, hint } }`
     (`mcp_bridge.ts:178-184`) — wrapped in MCP SDK `isError:true` envelope
     by `src/mcp/server.ts:107-121`.

2. **Command shape rejection** (Zod parse of `Command`):
   - Caught at `mcp_bridge.ts:197-204`.
   - Code is forced to `E_INVALID_VALUE`; hint includes the issue path.
   - The agent only sees the **first** issue.

3. **Post-validation rejection** (a structurally-valid mutation that
   produces an invalid composition — e.g. group cycle):
   - `PostValidationError` at `command_bus.ts:55-65` carries the **full**
     `ValidationResult` (errors + warnings).
   - The bridge collapses it: only `errors[0].message` reaches the agent
     (`mcp_bridge.ts:208-215`). All other errors and **every warning** are
     dropped.

**Gap:** the validator's structured output (`{ valid, errors[], warnings[] }`)
is rich — agents would benefit from getting the whole array, plus warnings
like `W_TWEEN_TRUNCATED`. Today, only the first error message + a derived
hint survive.

The `validate` MCP tool itself (`tools.ts:161-172`) **does** return the full
`ValidationResult` — same payload the UI status bar would render (in
principle; today **no UI status bar consumes it** — see Q7). So if the
agent learns to call `validate` after every mutation, it gets the rich
payload. But that's reactive; mutation responses themselves lose detail.

---

## 5. Library discoverability — what can an agent learn about the library?

Three list tools exist:

- **`list_templates`** (`tools.ts:810-819`) — returns
  `{ templates: TemplateDescriptor[] }`. Descriptor at
  `src/compose/templates.ts:50-56`:
  ```ts
  interface TemplateDescriptor {
    id: string
    description?: string
    params: TemplateParamDescriptor[]   // { name, type, required?, default?, description? }
    emits: string[]                     // local item ids this template produces
  }
  ```
  This is **good for parameterisation** (the agent knows param names + types)
  but has **no thumbnail / preview**, **no example values**, **no example
  composition snippet**.

- **`list_scenes`** (`tools.ts:1009-1018`) — same idea, descriptor at
  `src/compose/scenes.ts:101-112`:
  ```ts
  interface SceneDescriptor {
    id: string
    description?: string
    duration: number
    size?: SceneSize
    background?: string
    params: SceneParamDescriptor[]
    emits: string[]
    assets: string[]
  }
  ```
  Same gaps as templates (no preview).

- **`list_behaviors`** (`tools.ts:704-713`) — returns
  `{ behaviors: BehaviorDescriptor[] }` (`src/compose/behaviors.ts:40-46`).
  Includes `produces: string[] | "dynamic"` so the agent can predict tween
  suffixes.

- **`list_assets`** (`tools.ts:216-226`) — returns
  `{ assets: Asset[] }`, i.e. just `{ id, type, src, family? }`. No
  thumbnail URL, no size hints.

Crucially, the UI's library panel reads from a **richer** endpoint
(`GET /api/library` in `library_controller.ts:21`) backed by
`LibraryIndex.getCatalog()`. That catalog merges templates / scenes /
behaviors / assets / fonts into one list and exposes `thumbnail` URLs +
file-system source paths (`library_index.ts:27-42`). The MCP surface
**does not see this catalog at all**. There is no single `list_library`
tool, no thumbnail endpoint, no asset/font listing for agents.

**Quote of a return shape (`list_templates`):**
```jsonc
// MCP response body for list_templates
{
  "templates": [
    {
      "id": "ken-burns",
      "description": "Slow pan-and-zoom on a sprite",
      "params": [
        { "name": "image",   "type": "string", "required": true },
        { "name": "duration","type": "number", "default": 5 },
        { "name": "startScale", "type": "number", "default": 1 }
      ],
      "emits": ["bg", "sprite"]
    }
  ]
}
```
Good for synthesis — bad for browsing. An agent can't say "show me the
zoom-in template" without retrieving every descriptor and guessing from
the name.

---

## 6. Render flow — agent path vs UI path

**UI path** (`renders_controller.ts:61` → `render_worker.ts`):
- POST `/api/renders` returns immediately with `{ jobId, totalFrames,
  outputPath, eventsUrl }`.
- Render runs in `RenderJob` (an `EventEmitter`), emitting `progress` /
  `done` / `error` events.
- Client subscribes via SSE at `/api/renders/:id/events`
  (`renders_controller.ts:174-256`); on connect, last known event is
  replayed for catch-up.

**MCP path** (`tools.ts:1392-1429`):
- `render_to_video` calls `renderToFile(...)` synchronously inside the
  handler. The agent's MCP `CallToolResult` does not return until ffmpeg
  exits.
- No `jobId`. No way to poll. No way to subscribe. No way to cancel.
- A long render blocks the agent's tool channel for minutes, and any
  network hiccup loses the result.

**These are not aligned.** A v1.0 MCP server should match the UI's
queue-based flow: `render_to_video` returns `{ jobId }`; new tools
`get_render { jobId }` and `list_renders` mirror the controller's
`show` and `index`; optionally a `wait_for_render { jobId, timeoutMs }`
that polls server-side. The `RenderJobs` registry already exists in
`render_worker.ts` (`renderJobs.add/get/list`); the bridge would just
need to expose it.

---

## 7. Validation feedback loop

`validate` MCP tool body (`tools.ts:169-171`):
```ts
handler: (args, { store }) => {
  return store.validate(args.compositionId)
}
```
It returns the engine's full `ValidationResult` shape
(`src/schema/validator.ts:49-53`):
```ts
{
  valid: boolean
  errors: { code, message, path? }[]
  warnings: { code, message, path? }[]
}
```

The UI **has no status bar** that consumes this today.
`grep -rn "ValidationResult\|validateComposition" apps/editor/inertia`
returns zero matches. The validator runs inside `CommandBus.apply()` (post-
mutation) and inside `ProjectStore.load()` (boot-time), and that's it. The
PRD's "one validator surface for both consumers" is half-built: the MCP tool
shows the full payload, but the UI doesn't display it. Conversely, when a
**command** fails post-validation the agent only sees the first error
message (Q4). So the two consumers see different fidelities of the same
result depending on which path is taken.

**Recommendation:** when `PostValidationError` propagates to the bridge,
inline the full `ValidationResult` into `error.details` (the engine's
`MCPErrorBody` only has `code`/`message`/`hint`, so a new optional
`details?: unknown` field is needed in `src/mcp/errors.ts`).

---

## 8. Shared library pool — minimum MCP surface for agents

User intent: there will be a **global** library pool (across projects) and
each project pins / shadows entries from it. Today the registry is
process-global (one Map per registry, see
`src/compose/templates.ts:78`, `src/compose/scenes.ts` registry), populated
at boot from built-ins + per-project library files via
`library_index.ts:381-400`. There is no notion of "global pool" vs "project
pool" — everything is just "the registry as of now".

Minimum agent surface to make a shared pool usable:

| Tool | Purpose |
|---|---|
| `list_global_templates` / `list_global_scenes` / `list_global_assets` | Read the global pool. Returns descriptors + a `pinned: bool` field indicating whether the current project already references the entry. |
| `pin_global { kind, id }` | Copy/reference the pool entry into the current project's library on disk and register it. Returns the project-relative source path. |
| `unpin_global { kind, id }` | Remove from project library but keep in global pool. |
| `register_global { kind, def, makePinned? }` | Promote a project-local def (template/scene/behavior) to the global pool. |
| `remove_global { kind, id }` | Drop from the global pool (rejected if any project pins it — same shape as `remove_asset`'s `E_ASSET_IN_USE`). |

These can all sit on the existing `LibraryIndex` once it is generalised to
two roots (`~/.davidup/library/` for global, `<project>/library/` for
local). The MCP layer is the thin wrapper.

---

## 9. Project CRUD from MCP — minimum surface

Today: zero. `DAVIDUP_PROJECT` env var, one process, one project.

Proposed minimum:

```jsonc
// list_projects → recent (read from ~/.davidup/recent.json) + scaffolded
{ "projects": [
  { "name": "demo-reel",
    "root": "/Users/.../demo-reel",
    "lastOpened": 1721000000,
    "loaded": true   /* the one currently in projectStore */
  }
]}

// current_project → null when nothing is loaded
{
  "root": "/Users/.../demo-reel",
  "compositionPath": "/Users/.../demo-reel/composition.json",
  "libraryRoot": "/Users/.../demo-reel/library",
  "loadedAt": 1721000123,
  "meta": { "width": 1920, "height": 1080, "fps": 60, "duration": 30 }
}

// create_project { name, location, template? } → new project root
{
  "root": "/Users/.../new-clip",
  "loaded": true
}

// open_project { path } → swaps projectStore, returns current_project shape
```

Shape notes:
- `open_project` must call `projectStore.unload()` then `.load()` and
  re-attach `libraryIndex`. The bridge today uses the singleton; a fresh
  hydration on the next read tool is free.
- `current_project` lets the agent answer "what am I editing?" without
  having to read the (potentially huge) composition.
- Both `list_projects` and `current_project` should be **read** tools (no
  CommandBus involvement); `open_project` and `create_project` mutate
  process state, not the composition document, so they bypass the
  CommandBus too. Treat them like the existing `define_user_template` /
  `import_scene` lifecycle tools.

---

## 10. Determinism risk — concurrent UI + MCP mutations

`CommandBus.apply()` (`apps/editor/app/services/command_bus.ts:114-167`) is
**not** serialised. It is `async`, but:

1. `const current = this.#projectStore.composition` (line 126) reads the
   current pointer.
2. `await applyCommandWithResult(current, command)` (line 134) runs against
   a fresh, hydrated ephemeral `CompositionStore`.
3. `this.#projectStore.update(next)` (line 150) clobbers the singleton with
   the result.

If two callers (UI POST + MCP tool) interleave on step 1 before either
reaches step 3, the second writer's `next` is derived from the **same
pre-state** the first saw and will overwrite the first's mutation — a
classic lost-update. Both clients then see only the second mutation;
the first agent/UI gets a "success" tool result for a change that
effectively never happened.

`grep -n "queue\|mutex\|lock" apps/editor/app/services/command_bus.ts`
returns nothing. There is no in-flight queue.

ProjectStore's debounced disk writer is fine — `_flushOnce()` reads the
latest in-memory snapshot — but the in-memory race exists.

**Fix:** drop a tiny chain mutex on `CommandBus#apply`:
```ts
#chain: Promise<unknown> = Promise.resolve()
async apply(raw) {
  const run = () => this.#applyInner(raw)
  const pending = this.#chain.then(run, run)
  this.#chain = pending.catch(() => {})   // never reject the chain
  return pending
}
```
Adds zero throughput cost in the single-actor case, eliminates the lost-
update in the contention case. Pair with a structured `source` echo in
the response so each actor sees who actually applied the contended write.

---

## Recommended minimum MCP additions for v1.0 (don't over-design)

Priority-ordered. Each adds <1 day of work.

### Tier 1 — project awareness (Q2, Q9)
1. `current_project` — read-only. Returns `{ root, compositionPath,
   libraryRoot, loadedAt, meta }` or `null`. ~10 lines.
2. `open_project { path }` — invokes `projectStore.load()`. Same body as
   `POST /api/project`. ~15 lines.
3. `list_projects` — reads `~/.davidup/recent.json` (a 1-file index that
   the CLI maintains). ~30 lines.
4. `create_project { name, location, template? }` — scaffolds
   `composition.json` + empty `library/`. ~50 lines (reuse existing
   `create_composition` + a small fs scaffold).

### Tier 2 — agent-friendly rendering (Q6)
5. Make `render_to_video` non-blocking: return `{ jobId, totalFrames }`
   immediately, route through the existing `RenderJobs` registry.
6. `get_render { jobId }` — mirrors `RendersController#show`.
7. `list_renders` — mirrors `RendersController#index`.
   (Skip `cancel_render` for v1.0; not in UI either.)

### Tier 3 — richer validation + library (Q4, Q5, Q7)
8. Add `details?: unknown` to `MCPErrorBody` and propagate the full
   `ValidationResult` in `PostValidationError` from the bridge.
9. `list_library` — one tool, returns the same catalog the UI panel sees,
   including thumbnail URLs (`/api/library/thumbnail?kind=…&id=…`).
   The agent can either follow the URL via the editor's HTTP server or
   ask for `get_library_thumbnail { kind, id }` that returns base64.

### Tier 4 — concurrency safety (Q10)
10. Add the chain mutex to `CommandBus#apply`. One-line fix; closes the
    determinism gap the PRD's D4 invariant cares about.

### Tier 5 — source tagging actually used (Q3)
11. Echo `command.source` back from `POST /api/command` (already there but
    UI ignores) and from the MCP bridge's success envelope. Fix
    `command_bus.ts:185/187` to carry the original event's source on undo.
12. Wire one subscriber: SSE-relay `ChangeEvent` to the UI so the Inspector
    can briefly highlight "Claude just changed this" when `event.source ===
    'mcp'`. Out of scope for v1.0 if budget is tight; the data is already
    plumbed.

### Explicitly **not** for v1.0
- Global library pool tools (Tier 8) — depends on a global library design
  that hasn't shipped.
- Asset upload over MCP — large binaries over stdio are painful; agent can
  POST to `/api/assets` if needed.
- `define_global_template` / `unpin_global` — wait for the pool design.

---

## File:line index of cited code

- `src/mcp/tools.ts:1443` — `TOOLS` registry export
- `src/mcp/server.ts:68-104` — SDK registration loop
- `src/mcp/dispatch.ts:36-76` — dispatcher with router seam
- `src/mcp/errors.ts:8-35` — `MCP_ERROR_CODES` list
- `src/mcp/store.ts:240-275` — `CompositionStore.createComposition`
- `src/schema/validator.ts:49-81` — `ValidationResult` shape
- `src/compose/templates.ts:50-56, 96-98, 687-695` — TemplateDescriptor
- `src/compose/scenes.ts:101-112, 1133-1145` — SceneDescriptor
- `src/compose/behaviors.ts:40-46, 101-106` — BehaviorDescriptor
- `apps/editor/start/preload_mcp_stdio.ts:20-33` — stdio mount on
  `DAVIDUP_MCP_STDIO=1`
- `apps/editor/start/preload_project.ts:22` — single-project boot via
  `DAVIDUP_PROJECT`
- `apps/editor/app/services/mcp_bridge.ts:77-153` — bridge router +
  per-call deps
- `apps/editor/app/services/mcp_bridge.ts:196-256` — error mapping
- `apps/editor/app/services/command_bus.ts:114-167` — CommandBus.apply
  (no locking)
- `apps/editor/app/services/command_bus.ts:175-198` — undo with
  hard-coded `source:'ui'`
- `apps/editor/app/services/apply_command.ts:72-98` —
  `applyCommandWithResult` (deep-clones via hydrate)
- `apps/editor/app/services/project_store.ts:44-238` — single-project
  store with debounced writer
- `apps/editor/app/controllers/commands_controller.ts:26-69` — POST
  /api/command (no `source` echo to client)
- `apps/editor/app/controllers/renders_controller.ts:61-256` — UI
  job-based render flow with SSE
- `apps/editor/app/services/library_index.ts:212-409` — richer catalog
  the MCP surface doesn't see
- `apps/editor/app/types/commands.ts:100, 416-438` — `SOURCE` schema and
  `COMMAND_TO_TOOL` map

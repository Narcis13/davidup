# Library / Asset / Template / Behavior Storage — Audit

Branch: `editor-implementation`. PRD FR-07 currently says **project-scoped**. This
audit confirms the code matches that, identifies every place a shared pool would
plug in, and proposes the lowest-impact migration.

---

## 1. Today's library structure (concrete: `examples/editor-demo/`)

This is the only example project on disk that has a populated `library/` folder
(verified — `find examples -name library -type d` returned a single hit).

```
examples/editor-demo/
├── composition.json
├── assets/                 # legacy: referenced from composition.json
│   └── ball.png
├── fonts/                  # legacy: referenced from composition.json
│   ├── BebasNeue-Regular.ttf
│   └── JetBrainsMono-Bold.ttf
├── library/
│   ├── index.json          # inline catalog: fonts + assets, empty arrays
│   │                       # for templates/behaviors/scenes
│   ├── assets/<sha256>.png # uploads land here (content-addressed)
│   ├── templates/
│   │   ├── badge.template.json
│   │   └── title-card.template.json
│   ├── behaviors/
│   │   ├── bounce.behavior.json
│   │   └── fade-in.behavior.json
│   └── scenes/
│       ├── intro.scene.json
│       └── outro.scene.json
└── renders/
```

**`library/index.json`** (a flat declarative manifest, version "0.1"):

```jsonc
{
  "version": "0.1",
  "templates": [], "behaviors": [], "scenes": [],
  "fonts":  [ { "id": "davidup-display", "family": "DavidupDisplay",
                "url": "../fonts/BebasNeue-Regular.ttf", "name": "Davidup Display" } ],
  "assets": [
    { "id": "ball", "name": "Bouncing ball", "url": "../assets/ball.png" },
    { "id": "61591a9eb91293f7e1bfb325e756ad4ab98908883157a3a7dbf46e5ec4af57cc",
      "name": "ME.png", "url": "assets/61591a9...png", "kind": "image",
      "hash": "sha256:61591a9...", "size": 689837, "width": 889, "height": 1193 } ]
}
```

Two coexisting flavours of asset entries already live here: hand-authored
(`ball`, points at `../assets/ball.png`) and pipeline-ingested
(content-addressed `<sha256>` in `library/assets/`).

**Per-file definitions** are single JSON objects with an `id`, e.g.
`library/templates/title-card.template.json` (excerpt):

```jsonc
{ "id": "titleCard", "name": "Title card",
  "params": [ { "name": "title", "type": "string", "required": true }, ... ],
  "items": { "title": { "type": "text", "text": "${params.title}", ... } },
  "tweens": [ { "id": "title-pop", "target": "title",
                "property": "transform.opacity", ... } ] }
```

`library/behaviors/bounce.behavior.json` — note **it only declares a name and
params; it does NOT define the actual tween expansion**:

```jsonc
{ "id": "bounce", "name": "Bounce", "params": [ ... ] }
```

This is the critical finding for behaviors — see §2.

`library/scenes/intro.scene.json` is a full `SceneDefinition` (id, duration,
size, params, items, tweens).

### How precompile/engine resolves the markers

The 4-pass pipeline lives in `src/compose/precompile.ts:140-164`:

```ts
let current = comp
if (containsRef(current)) current = await resolveImports(...)
current = expandTemplates(current)        // $template
current = expandSceneInstances(current)   // type:"scene"
current = expandBehaviors(current)        // $behavior
```

`$ref` is **path-based** (`src/compose/imports.ts:112-160`): the string is a
file path (optionally with a `#` JSON pointer) resolved relative to the file
that contains the `$ref`. It is NOT a logical id.

`$template`, `$behavior`, scene names are **id-based** and looked up in
in-memory `Map<string, …>` registries:

- Templates: `src/compose/templates.ts:78` — `const REGISTRY = new Map<string, TemplateDefinition>()`
- Scenes:    `src/compose/scenes.ts:155`  — `const REGISTRY = new Map<string, SceneDefinition>()`
- Behaviors: `src/compose/behaviors.ts:93` — `const REGISTRY = new Map<string, BehaviorEntry>()`

All three are **module-level singletons** — i.e. they are already *process-global*
today. Pure code is built into `compose/builtInTemplates.ts` + `behaviors.ts`
(11 built-ins). User-authored templates/scenes get registered into the same
singleton by `library_index.ts` (see §3) and by `define_user_template` /
`define_scene` / `import_scene` MCP tools.

---

## 2. End-to-end resolution of e.g. `brand::titleCard`

The `::` syntax is **not implemented anywhere** in the codebase
(`grep -rn '::' src/compose` → no hits; the PRD's "FR-06 acceptance" example
`brand::titleCard` is purely aspirational). Today templates resolve by **bare
id**.

For a literal `{ "$template": "titleCard" }` placed inside `items`:

1. `project_store.ts:112` loads `composition.json`, calls
   `precompile(parsed, { sourcePath })`.
2. `precompile.ts:160` invokes `expandTemplates`.
3. `templates.ts:199-273` iterates the items map; for each `$template`
   instance, calls `expandTemplate(instanceId, instance, { templates: userTemplates })`.
4. `templates.ts:124-127` lookup order: **(a)** `options.templates`
   (per-composition inline `templates: { ... }` block — a v0.2 authoring
   shortcut), **(b)** the process-global `REGISTRY`. No third source.
5. The global REGISTRY is populated by:
   - `compose/builtInTemplates.ts:574` (built-ins, side-effect import).
   - `library_index.ts:382-388` — every `*.template.json` file the index
     walks becomes `registerTemplate(libraryTemplateToDefinition(...))`.
   - `mcp/tools.ts:850` — `define_user_template` tool.

For scenes the path is the mirror image (`scenes.ts:198-292`, looked up via
the singleton REGISTRY at `scenes.ts:155`; library hydration at
`library_index.ts:391-399`; MCP `define_scene` / `import_scene` at
`mcp/tools.ts:914-1007`).

For behaviors there is **no library hydration today**. `behaviors.ts:93` is
populated only by the side-effecting `behaviors.ts` file itself with the 11
built-ins. `*.behavior.json` files in `library/` have no `items` / `tweens` to
load (they are param descriptors only — see `bounce.behavior.json` above), so
the library panel surfaces them but neither `apply_behavior` nor
`expandBehaviors` can lookup user-defined behaviors. **There is no
`define_user_behavior` MCP tool**. This is a documented gap that the shared-pool
work should also close (see §7).

Key under which entries are registered: **the bare `id` string** in every
case. Same-id `library/<kind>/X.json` shadows a built-in
(`registerTemplate` is "last write wins", `templates.ts:81-86`).

Asset resolution is different — `composition.assets[i].src` is treated as a
**path or URL string**, not a registry id:

- Engine browser loader: `src/assets/browser.ts:39, 49` — `img.src =
  this.resolveUrl(asset.src)` (optional prepend of a baseUrl).
- Editor adapter: `apps/editor/app/controllers/editor_controller.ts:57-73`
  (`rewriteAssetsForBrowser`) — for each asset whose `src` is not already an
  absolute URL or data: URI, prepend `/project-files/`. That's the bridge to
  the per-project file server route at `editor_controller.ts:143-180`.

---

## 3. `library_index` service

File: `apps/editor/app/services/library_index.ts` (455 lines).

- Singleton: `const libraryIndex = new LibraryIndex(); export default libraryIndex`
  (line 454-455). One instance per process.
- Attach lifecycle: `attach(libraryDir)` (line 221) — invoked from
  `project_store.ts:162` with `dirname(libraryIndexPath)` (i.e. the project's
  `library/`). `detach()` (line 247) is called before switching projects.
- Read sources (the `#reload()` method, 311-408):
  1. `library/index.json` — pull arrays `assets`, `fonts`, `templates`,
     `behaviors`, `scenes` and produce `LibraryItem`s.
  2. Walk `library/**/*.{behavior,template,scene}.json` and emit one
     `LibraryItem` per file.
- After indexing, push templates + scenes into the engine's global REGISTRY
  via `registerTemplate` / `registerScene` (lines 381-400). Behaviors are
  **not** registered (because the schema doesn't define their expansion;
  see §2).
- Exposed via `app/controllers/library_controller.ts:21-48`: `GET /api/library`
  returns the merged catalog with `root`, `loadedAt`, `attached`,
  `projectRoot`, `items`, and `errors`.
- Watcher: `fs.watch(libraryDir, { recursive: true }, ...)` with a 100ms
  debounce (line 233). Refreshes catalog and re-pushes into engine
  registries.

**There is exactly ONE root.** `#root: string | null`, replaced on each
`attach()`. No notion of multiple library roots, no overlay/merge logic, no
namespace prefix. If a project has no `library/index.json`, `attach()` warns
and the catalog stays empty.

---

## 4. Asset upload pipeline

Files: `apps/editor/app/services/asset_pipeline.ts`,
`apps/editor/app/controllers/assets_controller.ts`.

Flow (per `AssetPipeline#ingest`, asset_pipeline.ts:434-538):

1. Reject unless a project is loaded (line 436-438; throws `E_NO_PROJECT`).
2. Hash the tmp upload (sha256), detect kind via extension/mime.
3. Compute target path: `<project.root>/library/assets/<hash><ext>` (line 450-455).
4. Idempotency: if the index already has a record under id=`<hash>` and the
   file exists, return the existing record. Otherwise rename/copy the tmp file in.
5. Probe metadata (`skia-canvas` for images, `ffprobe` for AV).
6. Build an `AssetRecord` with `id=hash`, `url='assets/<hash><ext>'` (relative
   to the library root!), `hash='sha256:<hex>'`, plus dims/duration.
7. Read-modify-write `library/index.json` atomically (tmp + rename),
   preserving any unknown top-level keys.
8. Nudge `libraryIndex.flush()` so the catalog reflects the new record without
   waiting for the watcher.

Two subtle path conventions are in play here:

- **`library/index.json` asset URLs are relative to the library directory**
  (`"url": "assets/<hash>.png"`, asset_pipeline.ts:456). That's the form the
  library catalog API returns.
- **`composition.json` asset srcs are relative to the project root**
  (e.g. `"src": "./assets/ball.png"`, see `examples/editor-demo/composition.json`
  L14). That's the form the engine consumes, and what `rewriteAssetsForBrowser`
  expects.

When a user drags a library asset onto the stage today, *something* has to
mediate between those two conventions — the drag flow needs to write a
`composition.assets[]` entry whose `src` resolves to the same bytes. (Drag
implementation lives in the Vue code; not exhaustively audited, but the
contract is: the composition asset src must be a string the
`/project-files/*` route can serve.)

The `/project-files/*` handler (editor_controller.ts:143-180) is a generic,
path-traversal-safe file server rooted at `project.root`. Any path the engine
sees relative to the project root resolves through that single route.

---

## 5. Canonical `composition.assets[]` shape

From `src/schema/zod.ts:12-28`:

```ts
ImageAssetSchema = z.object({ id, type: "image", src: z.string().min(1) })
FontAssetSchema  = z.object({ id, type: "font",  src: z.string().min(1), family })
AssetSchema      = z.discriminatedUnion("type", [ImageAssetSchema, FontAssetSchema])
```

`src` is a bare non-empty string. The schema places **no constraint** on what
that string is — relative path, absolute path, `http(s)://...`, `data:`, all
pass. Distinction is made at *load time*:

- `assets/browser.ts:58` regex `/^(?:[a-z]+:)?\/\//i || startsWith("data:") || startsWith("/")`
  → treated as absolute and used verbatim. Otherwise prefixed with `baseUrl`.
- `editor_controller.ts:69` mirror logic for the rewrite to `/project-files/`.

There is no current notion of a "logical asset reference" — `src` is the
ground truth.

---

## 6. MCP tools related to the library

All in `src/mcp/tools.ts`. Every one operates on the *current MCP composition*
in the `CompositionStore` singleton (per-process). None of them know about a
project on disk; they mutate JSON in memory.

| Tool | What it touches | Scope today |
|---|---|---|
| `register_asset` (190) | `composition.assets[]` — pushes `{ id, type, src, family? }` | per-composition (single store) |
| `list_assets` (216) | reads `composition.assets[]` | per-composition |
| `remove_asset` (228) | removes if no item references it | per-composition |
| `list_templates` (810) | `compose/templates.ts` global REGISTRY | process-global |
| `define_user_template` (821) | `registerTemplate` on the global REGISTRY | process-global |
| `apply_template` (727) | expands a template, mutates current store | template lookup process-global, mutation per-composition |
| `list_behaviors` (704) | global REGISTRY (built-ins only) | process-global, **read-only** |
| `apply_behavior` (645) | expands a behavior block, adds tweens | process-global lookup, per-composition mutation |
| `define_scene` (914) / `import_scene` (956) / `list_scenes` / `remove_scene` (1020) | `compose/scenes.ts` REGISTRY | process-global |
| `add_scene_instance` (1171) / `update_scene_instance` / `remove_scene_instance` | reads scene REGISTRY, mutates store | mixed |

**Important asymmetry**: templates / scenes / behaviors are already
**process-global**. `register_asset` is **per-composition**. The shared-pool
ergonomic mismatch users will feel is mostly about *assets*, not about the
declarative types — those are already shared once a `library_index.attach()`
populates them. The problem is purely that the *source on disk* lives under
one project, so opening project B doesn't bring project A's library content
along.

---

## 7. Proposed shared-pool architecture

### 7.1 Where on disk

**Recommendation:** `~/.davidup/library/` with subtree:

```
~/.davidup/
  library/
    index.json                  # global manifest (same shape as project lib)
    templates/<id>.template.json
    behaviors/<id>.behavior.json
    scenes/<id>.scene.json
    assets/<sha256>.<ext>
    fonts/<family-or-hash>.ttf
  cache/                        # rendered thumbnails, probe results
```

**Why XDG-style home dir, not `/usr/local/share/davidup`?**

- The editor runs as the user; no sudo for ingesting an asset.
- Easy to back up / sync with iCloud / Dropbox if the user wants
  cross-machine sharing later.
- Plays nicely with the eventual SaaS sync layer — `~/.davidup/library/` is
  the local mirror of the user's account library.

Alternatives considered:

- `<repo>/.davidup/library/` (workspace-scoped): nice for monorepos but
  defeats the "library follows me across projects" mental model.
- `XDG_DATA_HOME` (`~/.local/share/davidup/library/`): more correct on Linux
  but adds Windows/macOS divergence. `~/.davidup/` is a single rule the
  editor can derive once. Implement as
  `process.env.DAVIDUP_LIBRARY ?? join(os.homedir(), '.davidup', 'library')`
  so power users can relocate via env var.

### 7.2 How a project references a global asset

**Recommendation:** introduce a *string scheme*, not a new Zod variant. The
existing `Asset.src` field stays a string; load-time logic learns one more
prefix.

```
src: "global:assets/<sha256>.png"     # canonical
src: "global:fonts/DavidupDisplay.ttf"
src: "./assets/ball.png"              # unchanged — project-local
src: "https://cdn.example/x.png"      # unchanged — absolute
src: "data:image/png;base64,..."      # unchanged — inline
```

For templates / scenes / behaviors there is no `src` field at all — the
shared pool is implicit. Resolution stays by bare id, with the new lookup
order:

```
inline composition.templates[id]      # v0.2 escape hatch
  → project library/templates/<id>.template.json    (already attached)
  → global  library/templates/<id>.template.json    (NEW)
  → built-in registry                  (compose/builtInTemplates.ts)
```

I.e. **project local shadows global which shadows built-in**. Last-write-wins
on the singleton REGISTRY already gives us this for free — we just need the
attach order: built-ins first (already true via side-effect import), global
second (NEW), project third (already true).

**Stable id form for assets**: keep using the sha256 hex as the asset id
(matches what `asset_pipeline.ts:498` already produces). The `id` in
`composition.assets[]` does NOT need to be the hash — it can be a friendly
short id like `logo-orange` — but the **disk filename** is hash-named and the
asset record carries `hash: "sha256:..."` so dedupe across the global pool is
content-addressed.

Why not a `kind: 'global-ref'` discriminator on `AssetSchema`?

- Forces every composition.json on disk to migrate when we add the variant.
- Makes the Zod union grow; `validateItemRefs` in `schema/validator.ts:103`
  would need to learn the new shape.
- The "magic string with a scheme" form is what we already do for URLs and
  data URIs — `global:` slots in alongside them.

The tradeoff is that the resolution logic is centralized in two places
(`assets/browser.ts:resolveUrl` and `editor_controller.ts:toProjectFileUrl`).
We add one more branch to each:

```ts
// in editor_controller.ts toProjectFileUrl, before existing checks
if (src.startsWith('global:')) {
  return '/library-files/' + src.slice('global:'.length).replace(/^\/+/, '')
}
```

### 7.3 Lookup precedence (final)

Templates / scenes:

1. composition-inline `templates: { ... }` / `scenes: { ... }` block
2. project `library/<kind>/<id>.<kind>.json` (registers via library_index)
3. global  `library/<kind>/<id>.<kind>.json` (registers via a new
   `global_library_index` singleton)
4. built-in registry

Mechanically the REGISTRY is one Map. Order is enforced by **attach
sequence**, not by per-lookup priority logic: built-ins at module-import time,
globals at server boot, project on `attach()`. "Last write wins" then
automatically yields "project shadows global shadows built-in".

When a project unloads we should **not** clear the entire registry — only
unregister the keys the project added. Today `library_index.ts:381-400`
re-pushes on every reload but never *removes* an id when its file is deleted.
That's already a latent bug; the shared-pool work should fix it by tracking
the set of (kind,id) pairs each library_index attached and unregistering on
detach.

### 7.4 Migration: existing example projects keep working

Existing `composition.json` files use `src: "./assets/ball.png"` — those
remain valid because the resolver's fallback is "treat as a project-relative
path." We never have to rewrite them.

Existing `library/index.json` files keep their meaning — they are still the
project-local manifest. The global library is additive.

No new compile-pipeline pass is required. `precompile` is unchanged.

### 7.5 Where do uploads go by default?

**Recommendation: project-local stays the default; add a "Save to global
library" toggle in the upload UI.**

Reasoning:

- Today's `asset_pipeline.ts` writes to `<project>/library/assets/` and
  references it via a relative URL in `composition.json`. That keeps the
  project portable — copy the folder, it still renders.
- A global upload is the explicit opt-in for "this is brand asset I want in
  every project." When the user picks that, the pipeline:
  1. Writes to `~/.davidup/library/assets/<sha256>.ext`.
  2. Adds a record to `~/.davidup/library/index.json`.
  3. Inserts a `composition.assets[]` entry with `src: "global:assets/<hash>.ext"`.
- The toggle should default to "project" with a per-user persisted preference
  to flip it. Drag-from-Library-tab should also auto-pick the right scope
  (global asset stays global, project asset stays project).

### 7.6 New HTTP route

```
GET /library-files/* → stream files under DAVIDUP_LIBRARY (or ~/.davidup/library/)
```

Mirror of `editor_controller.ts#file` (lines 143-180): same path-traversal
guard, same content-type detection, just a different root. Doesn't require a
loaded project — global library is process-global.

`rewriteAssetsForBrowser` already centralises the URL transformation; add one
branch and the existing call sites all benefit.

### 7.7 Index format: virtual catalog at runtime

**Recommendation: keep BOTH `library/index.json` files on disk; merge them in
the `/api/library` controller.**

The library_index service stays a per-root reader. We instantiate two of them:

```ts
// library_index.ts
export class LibraryIndex { ... }
const projectLibraryIndex = new LibraryIndex()  // existing default export
const globalLibraryIndex  = new LibraryIndex()  // new
```

`library_controller.ts#index` then merges:

```ts
const projectItems = projectLibraryIndex.search(opts).map(i => ({ ...i, scope: 'project' }))
const globalItems  = globalLibraryIndex.search(opts).map(i => ({ ...i, scope: 'global' }))
// Deduplicate by (kind, id) — project wins.
const seen = new Set(projectItems.map(i => `${i.kind}::${i.id}`))
const items = [...projectItems, ...globalItems.filter(i => !seen.has(`${i.kind}::${i.id}`))]
```

The frontend gets a single `items[]` with a `scope` discriminator + an
`overridden: true` flag on global items shadowed by a project entry (helpful
for the UI badge). That's a non-breaking change to `LibraryItem`.

`globalLibraryIndex.attach(~/.davidup/library)` happens at server boot, not
on project load. `detach` never runs.

The "merge at runtime, not on disk" choice keeps the project's
`library/index.json` byte-stable. Otherwise we'd have to either (a) write
shadow entries into the project file (NFR-02 hazard) or (b) maintain a
third "merged" file on disk that drifts.

---

## 8. Schema impact

**Recommendation: zero-change to Zod.** Treat `global:` as a path scheme,
parsed at load. The 3 places that need to know:

1. `src/assets/browser.ts:56-65` (`BrowserAssetLoader.resolveUrl`) — already
   forwards absolute URLs verbatim; add a branch for `global:` → URL.
2. `apps/editor/app/controllers/editor_controller.ts:68-73`
   (`toProjectFileUrl`) — add a branch for `global:` → `/library-files/...`.
3. `src/assets/node.ts:35,40` — node asset loader for headless renders.
   Today it hands `asset.src` straight to skia (`skia.loadImage(asset.src)`).
   For `global:` srcs we need to resolve to an absolute disk path
   (`os.homedir() + '/.davidup/library/' + suffix`) before calling skia,
   else skia tries to open the literal "global:assets/..." string.

The semantic validator (`src/schema/validator.ts`) does NOT inspect `src` —
its only `src` checks are existence + type, so it stays unchanged.

If we ever need to declare in the JSON which scope produced an asset (for UI
purposes), that can ride as an additive optional field
(`scope?: "project" | "global"`) — Zod will pass it through with
`.passthrough()` or it can be added explicitly. Not required for the MVP.

---

## 9. Risks & mitigations

### 9.1 NFR-02 determinism — UI and MCP must produce byte-identical JSON

The risk: if the editor auto-rewrites e.g. `"./assets/ball.png"` to
`"global:assets/sha256:..."` (or vice versa) when dragging, then a
`composition.json` produced by `apply_template` via MCP could differ from one
produced by the equivalent UI gesture. **Mitigation: never rewrite an existing
`src` automatically.** Two rules:

- UI insertion of a global asset writes `global:<path>` literally.
- UI insertion of a project asset writes the project-relative path.
- The same MCP call (`register_asset` with a `global:` src) produces the
  same byte sequence. The MCP tool needs no change — it already accepts an
  arbitrary string.

The `apply_command` service (`apply_command.ts:57-98`) funnels both UI and
MCP through the same MCP tool handler. As long as we don't insert any
normalization between the command bus and `dispatchTool`, the D4 invariant
holds.

### 9.2 Portability — copying a project to another machine

**Risk:** project's `composition.json` says `"src": "global:assets/abc.png"`
but the new machine's `~/.davidup/library/` doesn't have `abc.png`. The
engine fails at asset-load time, not at validation time.

**Mitigation A (recommended)**: add a "Pack for export" command that
materialises every `global:` reference back into the project's local
`library/assets/` and rewrites `src` accordingly. Output is a fully
self-contained project. Implementation is a small walker over
`composition.assets[]` + a couple of file copies + an index merge.

**Mitigation B**: on load, if a `global:` src fails to resolve, surface a
clear "missing global asset" warning in the status bar (FR-14 territory)
with a link to the asset id so the user can re-upload. Do NOT crash.

**Mitigation C** (longer term): when the SaaS sync layer ships, missing
global assets get pulled from the user's account on demand.

### 9.3 Concurrent writes to `~/.davidup/library/index.json`

If two editor processes are open against different projects and both ingest
a global asset, they'll race on the manifest. The pipeline already does
tmp+rename (asset_pipeline.ts:402-407) and `findAssetById` is idempotent on
content hash, so the worst case is one of the two write loses a NEW (non-hash-
matching) entry. **Mitigation**: gate global writes with a file lock (e.g.
`proper-lockfile`) keyed on the index path. Cheap, correct.

### 9.4 Built-in template / scene name collisions with global library

`registerTemplate` is last-write-wins. If a user creates
`~/.davidup/library/templates/titleCard.template.json`, it silently shadows
the built-in `titleCard`. That's arguably the *intended* behaviour, but
without UI feedback users will find it confusing.

**Mitigation**: the `/api/library` response should mark
`origin: "built-in" | "global" | "project"` per item, and the Library panel
should show a badge when a built-in is shadowed.

### 9.5 Behavior gap

Behaviors today have no library hydration (see §2). A shared pool that
lists behavior files but can't actually use them is misleading. **Either**
remove `*.behavior.json` from the library indexer (and only list built-ins
under a `kind: 'behavior'` synthetic source), **or** add a
`define_user_behavior` MCP tool + a schema for behavior expansions and wire
library_index to register them. The latter is a bigger lift but is the only
way to honour the "behaviors live in the shared pool" promise the UI is
about to make.

---

## 10. Concrete file-level change set (preview, not executed)

When the time comes to implement:

1. `src/assets/browser.ts` — branch on `src.startsWith("global:")`.
2. `src/assets/node.ts` — same branch, resolving to home-dir absolute path.
3. `apps/editor/app/controllers/editor_controller.ts` — extend
   `toProjectFileUrl` + add a `globalFile` controller action.
4. `apps/editor/start/routes.ts` — `router.get('/library-files/*', ...)`.
5. `apps/editor/app/services/library_index.ts` — export a second instance,
   track per-attach (kind,id) pairs for clean detach; add `origin` field to
   LibraryItem.
6. `apps/editor/app/controllers/library_controller.ts` — merge two catalogs,
   stamp scope + overridden flags.
7. `apps/editor/app/services/asset_pipeline.ts` — accept a `scope:
   'project' | 'global'` option, route the write + index update to the
   matching root. Use a file lock around `~/.davidup/library/index.json`.
8. `apps/editor/bin/server.ts` (or equivalent) — attach the global library
   index at boot, before any project load.
9. `vision/davidup-v1.0-editor-prd.md` lines 195-196 — rewrite FR-07 to
   describe a shared pool with optional project overrides:

   > **FR-07 (P0) Library index — shared pool with per-project overrides.**
   > The editor exposes a global library at `~/.davidup/library/` containing
   > templates / behaviors / scenes / assets / fonts available to every
   > project. A project's `library/` directory (if present) shadows global
   > entries with the same `(kind, id)`. `davidup pack add <path>` imports
   > a third-party pack into the global library; the index regenerates on
   > watch.
   >
   > *Acceptance:* adding a new `.behavior.json` to `~/.davidup/library/`
   > appears in the Library panel of every open project within 1s; placing
   > the same id in a project's `library/` overrides it for that project
   > only.

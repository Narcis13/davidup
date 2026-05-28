# Davidup

> A deterministic 2D programmatic video engine.
> One canonical JSON composition runs in the **browser** (live preview via
> Canvas2D + `requestAnimationFrame`), on the **server** (frame-by-frame render
> with [`skia-canvas`](https://github.com/samizdatco/skia-canvas) piped to
> `ffmpeg` → MP4), inside an **AI agent** loop (58 atomic MCP tools), or in a
> **human editor** (`davidup edit`). Same input → same pixels, every host.

```
                       ┌────────────────────────────┐
                       │   composition (canonical   │
                       │      v0.1 JSON)            │
                       └─────────────┬──────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
    ┌───────▼───────┐       ┌────────▼────────┐      ┌────────▼────────┐
    │ browser/      │       │ drivers/node    │      │ mcp server      │
    │ attach()      │       │ renderToFile()  │      │ 56 tools, stdio │
    │ live preview  │       │ → mp4/mov/webm  │      │ for AI agents   │
    └───────────────┘       └─────────────────┘      └─────────────────┘
                                                              │
                                                  ┌───────────▼──────────┐
                                                  │ apps/editor          │
                                                  │ AdonisJS + Inertia   │
                                                  │ + Vue — the editor   │
                                                  │ humans drive         │
                                                  └──────────────────────┘
```

This README is the **manual**. Read the section that matches what you want to
do — quickstarts on top, full reference below.

---

## Table of contents

- [What this is](#what-this-is)
- [Install & verify](#install--verify)
- [Five-minute quickstarts](#five-minute-quickstarts)
  - [A — Human in the editor](#a--human-in-the-editor-recommended-for-authoring)
  - [B — Human writing JS (live preview)](#b--human-writing-js-live-preview-in-the-browser)
  - [C — Human writing JS (render MP4)](#c--human-writing-js-render-an-mp4)
  - [D — AI agent driving via MCP](#d--ai-agent-driving-the-engine-via-mcp)
- [Mental model in 60 seconds](#mental-model-in-60-seconds)
- [Composition primitives](#composition-primitives-what-the-engine-can-render-today)
- [Authoring layers](#authoring-layers-from-low-to-high-level)
- [The editor](#the-editor-appseditor)
- [The MCP server — full reference for agents](#the-mcp-server--full-reference-for-agents)
- [JS API surface](#js-api-surface)
- [Drivers](#drivers)
- [CLI](#cli-davidup)
- [Global library](#global-library-daviduplibrary)
- [Examples directory](#examples-directory)
- [Determinism](#determinism)
- [Troubleshooting](#troubleshooting)
- [Repo layout](#repo-layout)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## What this is

Davidup is built for the case where you want **structured, deterministic
authoring of short motion-graphics clips** — particularly when the author is an
LLM or an editor tool, not a person writing imperative code.

The four product surfaces, all built on the same engine:

| Surface | Who uses it | Entry point |
|---|---|---|
| `davidup/engine` + `davidup/schema` | Library consumers | `import { renderFrame, computeStateAt } from "davidup/engine"` |
| `davidup/node` | Server-side MP4 rendering | `import { renderToFile } from "davidup/node"` |
| `davidup/browser` | Live preview, in-browser editors | `import { attach } from "davidup/browser"` |
| MCP server (`davidup-mcp`) | AI agents (Claude, Cursor, …) | Spawned by the MCP client, stdio transport |
| Editor (`davidup edit`) | Humans authoring clips | `davidup edit ./my-project` |

The package is one repo, one engine. Picking a surface is just picking how you
hand a composition to it.

### Why bother

If you want an LLM to compose a short motion-graphics clip end-to-end, you
need three properties at once:

1. **Deterministic output.** `(composition, t) → pixels` is a pure function so
   the agent can reason about edits, diff frames, and verify work without
   rendering the whole clip.
2. **Inspectable state.** The agent has to peek at any frame on demand —
   preview-frame-as-base64 is non-negotiable.
3. **Atomic, orthogonal authoring.** Adding a sprite, adding a tween, moving an
   item to a different layer — each is one tool call returning a structured
   response. No prose, no codegen.

The same machinery serves humans well: a deterministic JSON model is also a
good substrate for undo/redo, multiplayer editing, and version-controlled
visual changes.

---

## Install & verify

Requirements:

- [Bun](https://bun.com/) ≥ 1.1. Node ≥ 20 also works for runtime usage; the
  `bin/` shebangs are `#!/usr/bin/env bun`.
- `ffmpeg` on `$PATH` for video render. The repo dev-deps include
  `ffmpeg-static` and `ffprobe-static`, so `bun install` brings working
  binaries for tests and the render example.
- macOS / Linux build tools for the `skia-canvas` native build.

```bash
bun install
bun run typecheck   # tsc --noEmit, strict
bun run test        # vitest, including a real-MP4 integration test
```

A green test run is the verification that your machine is wired correctly:
`tests/drivers/node.integration.test.ts` renders the canonical hello-world
through the full skia-canvas + ffmpeg pipeline and verifies the MP4 with
`ffprobe`.

---

## Five-minute quickstarts

### A — Human in the editor (recommended for authoring)

```bash
bun run seed:library      # one-off, populates ~/.davidup/library
bun run cli -- new ./my-clip
bun run cli -- edit ./my-clip
```

The browser opens to the editor. You get:

- **ItemToolbar** (left edge) — drop a rectangle, circle, polygon, text,
  sprite, group, or scene-instance onto the stage.
- **LayersPanel** — reorder layers, toggle `visible`/`locked`, rename.
- **Outliner** — tree view of every item with group expansion and reveal.
- **Inspector** — edit transform, content, and tweens. Multi-select shows
  "Mixed" for diverging fields and writes back to the selection.
- **Library** — drag templates, behaviors, scenes, assets, and fonts in from
  the global pool (and a project-local override pool).
- **RenderDialog** — opens the queue with progress + cancel.
- **Stage** — drag bodies to move, corner handles for scale, top handle for
  rotation, marquee-drag empty space to multi-select.

Shortcuts: ⌘Z / ⌘⇧Z undo/redo, ⌘G / ⌘⇧G group/ungroup, ⌘R render, `Space`
toggles play.

### B — Human writing JS (live preview in the browser)

```bash
bun run dev:browser
```

Opens [`examples/browser-demo`](./examples/browser-demo) on Vite. Buttons
exercise the driver's `seek` / `stop` controls.

```ts
import { attach } from "davidup/browser";

const handle = await attach(comp, canvas);
// handle.stop()                  cancel the RAF loop
// handle.seek(seconds)           move playhead, keeps playing
// handle.pickItemAt(x, y)        what item is under that screen pixel?
// handle.getItemBoundsAt(id)     selection-ring corners
// handle.getSourceMap()          where each resolved item came from
```

`attach()` is async — it preloads images and fonts before the first paint, so
once it resolves the canvas already shows frame 0.

### C — Human writing JS (render an MP4)

```bash
bun run examples/render.ts
```

Annotated end-to-end tour: load JSON → validate → sample the resolver → render
a single PNG frame → render the full MP4. Outputs land in `examples/output/`.

The minimal viable version is three lines:

```ts
import { renderToFile } from "davidup/node";
import { validate } from "davidup/schema";

if (!validate(comp).valid) throw new Error("invalid composition");
await renderToFile(comp, "out.mp4", { codec: "libx264", crf: 18 });
```

`renderToFile` allocates one `Canvas` and reuses it across every frame, pipes
RGBA bytes straight into `ffmpeg`'s stdin with `drain` backpressure, and
surfaces ffmpeg's stderr tail in any thrown `Error.message`. Signal-killed
ffmpeg subprocesses now fail loudly (was previously silent).

### D — AI agent driving the engine via MCP

Wire the server into your MCP client:

```jsonc
// Claude Code: ~/.claude.json   (or .mcp.json in this repo)
{
  "mcpServers": {
    "davidup": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/davidup/src/mcp/bin.ts"]
    }
  }
}
```

Then ask the model anything like *"build a 3-second clip with a logo that
fades in and pops in scale"*. The canonical sequence the agent will follow:

```
list_engine_capabilities         (one-shot discovery: easings, item types,
                                  shape kinds, blend modes, tweenable props)
create_composition
register_asset × N
add_layer
add_sprite / add_text / add_shape / add_group        (one call per item)
  └── or use higher-level shortcuts:
        apply_template                                (parameterised template)
        apply_behavior                                (named tween bundle)
        add_scene_instance                            (drop a full sub-clip)
validate                                              (after each non-trivial mutation)
render_preview_frame                                  (base64 PNG, verify visually)
render_to_video                                       (async; poll get_render
                                                       or pass wait: true)
```

Full transcript with every tool call's input and output:
**[`examples/mcp-demo.md`](./examples/mcp-demo.md)**.

---

## Mental model in 60 seconds

1. **Composition** is top-level JSON. `{ composition: { width, height, fps,
   duration, background }, assets[], layers[], items{}, tweens[] }`. The
   schema is in [`design-doc.md`](./design-doc.md) §3 and enforced by
   [`src/schema/zod.ts`](./src/schema/zod.ts).
2. **Items** are `sprite | text | shape | group`. Each has a `transform`
   (`x, y, scaleX, scaleY, rotation, anchorX, anchorY, opacity`) and three
   optional flags `visible`, `locked`, `name`.
3. **Layers** are flat z-stacks of item ids. Layers carry their own
   `opacity`, `blendMode`, `visible`, `locked`, `name`.
4. **Tweens** interpolate one property of one item over a time window with a
   named easing. Two tweens cannot overlap on the same `(item, property)` —
   the validator rejects it (`E_TWEEN_OVERLAP`).
5. **Render** is `(composition, t) → pixels`. Pure function. Powers both
   browser and server; only the *driver* changes.
6. **Authoring** has three tiers (low-level items+tweens → behaviors →
   templates → scene instances). Higher tiers are compiled down to the same
   canonical JSON before render.
7. **Agents author through MCP.** They call `add_*` / `apply_*` tools,
   `validate` along the way, `render_preview_frame` at key beats, and finally
   `render_to_video`.

---

## Composition primitives (what the engine can render today)

### Item types

`sprite`, `text`, `shape`, `group`. Schemas in
[`src/schema/zod.ts`](./src/schema/zod.ts).

### Transform fields

`x`, `y`, `scaleX`, `scaleY`, `rotation` (radians, clockwise), `anchorX`,
`anchorY` (fractional 0..1 of the item's box), `opacity` (0..1).

### Item flags

`visible: bool?` (skipped by renderer when false), `locked: bool?`
(editor-only), `name: string?` (≤ 80 chars). All optional; absent ≡ visible &
unlocked.

### Shape kinds

`rect`, `circle`, `polygon`. Optional `width`, `height`, `points`,
`fillColor`, `strokeColor`, `strokeWidth`, `cornerRadius` (rounded rects).

### Blend modes (25 + alias)

Every Canvas2D `globalCompositeOperation` value plus `"normal"` as an alias
for `source-over`. See [`src/schema/zod.ts`](./src/schema/zod.ts) `BLEND_MODES`.

### Easings (19)

`linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`,
`easeOutCubic`, `easeInOutCubic`, `easeInQuart`, `easeOutQuart`,
`easeInOutQuart`, `easeInBack`, `easeOutBack`, `easeInOutBack`, `easeInSine`,
`easeOutSine`, `easeInOutSine`, `easeInExpo`, `easeOutExpo`, `easeInOutExpo`.

### Tweenable properties by item type

| Item | Common | Type-specific |
|---|---|---|
| all | `transform.x/y/scaleX/scaleY/rotation/opacity/anchorX/anchorY` (number) | — |
| sprite | + | `width`, `height` (number); `tint` (color) |
| text | + | `fontSize` (number); `color` (color) |
| shape | + | `width`, `height`, `strokeWidth`, `cornerRadius` (number); `fillColor`, `strokeColor` (color) |
| group | + | — (children carry their own tweens) |

Authoritative table: [`src/schema/tweenable.ts`](./src/schema/tweenable.ts).

### Color formats

`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`. Color
interpolation is straight RGB linear lerp.

### Assets

`image` and `font`. `font` requires a `family` field. The browser asset
loader understands `global:assets/...` and `global:fonts/...` URLs that
resolve out of `~/.davidup/library` (or the project-local override pool).

---

## Authoring layers — from low to high level

The same composition can be expressed at any of four levels of abstraction.
Higher levels are *compiled down* to the level below by
[`src/compose/precompile.ts`](./src/compose/precompile.ts) before render. The
drivers always run precompile, so all four levels are valid inputs to
`renderToFile` and `attach()`.

### Level 1 — Raw items + tweens

The canonical v0.1 shape. Every other level expands to this.

### Level 2 — Behaviors (11 built-in)

Named, deterministic bundles of tweens. Either applied imperatively
(`apply_behavior` MCP tool) or written inline as
`{ "$behavior": "popIn", "params": {…} }` blocks inside `tweens[]`.

| Behavior | What it does | Key params |
|---|---|---|
| `fadeIn` | opacity 0→1 | `fromOpacity`, `toOpacity` |
| `fadeOut` | opacity 1→0 | `fromOpacity`, `toOpacity` |
| `popIn` | opacity 0→1 + uniform scale 0.2→1 | `fromScale`, `toScale` |
| `popOut` | opacity 1→0 + scale 1→0.2 | — |
| `slideIn` | translate from offset to rest along an axis | `from`, `axis` (`x`/`y`) |
| `slideOut` | translate from rest out to offset | `to`, `axis` |
| `rotateSpin` | rotate `2π × turns` radians | `turns` |
| `kenburns` | position drift + uniform scale drift | `fromScale`, `toScale`, `pan` |
| `shake` | ±amplitude oscillation over N cycles, returns to center | `amplitude`, `cycles`, `axis` |
| `colorCycle` | tween a color property through ≥ 2 stops evenly | `colors[]`, `property` |
| `pulse` | scaleX out → back-in | `peakScale` |

Behaviors emit deterministically-named tweens (`${itemId}__${suffix}`).
`list_behaviors` returns the full descriptor including param types and value
domain.

### Level 3 — Templates (5 built-in + 11 shipped in the global library)

Parameterised authoring patterns. Engine built-ins (auto-registered):

- `titleCard` — centered headline pop-in + subtitle fade-in.
- `lowerThird` — broadcast lower-third with sweeping accent bar.
- `captionBurst` — single emphatic caption pops in scaled.
- `bulletList` — three staggered fade-in bullets.
- `kenburnsImage` — sprite with fade-in + Ken Burns slow zoom/pan.

Library extras (installed by `bun run seed:library`): `endCard`, `quoteCard`,
`statBig`, `ctaButton`, `sectionDivider`, `progressBar`, `tagPill`,
`countdown321`, `logoBadge`, `subtitleBar`, `compareSplit`.

Use via `apply_template` (MCP) / `expandTemplate` (JS) / drag-from-Library
(editor). Param substitution is whole-string in v0.3 (no arithmetic).

### Level 4 — Scenes + scene instances

A *scene* is a self-contained mini-composition with its own `duration`,
`size`, `params`, `assets`, `items`, `tweens`. A *scene instance* drops the
scene into a parent composition with time-mapping and overrides:

- `identity` — local `t=0` plays at `instance.start` (default).
- `clip { fromTime, toTime }` — trim playback to a sub-window. Tweens that
  cross the boundary throw `E_TIME_MAPPING_TWEEN_SPLIT`.
- `loop { count }` — play N times back-to-back with `__loop${i}` id suffixes.
- `timeScale { scale }` — play at `scale ×` speed.

Define scenes with `define_scene` (literal) or `import_scene` (file). Place
them with `add_scene_instance`. Scene instances expand into a synthetic
wrapper `group` placed in the requested layer, with prefixed inner ids
(`instance__title`) and merged assets.

---

## The editor (`apps/editor`)

AdonisJS server + Inertia + Vue 3 frontend, hosted alongside an embedded MCP
server. The editor IS an MCP client of its own backend — every user action
goes through the same command bus the AI agent uses.

```bash
davidup edit ./my-project              # opens the editor
davidup edit ./my-project --port 5173 --no-open
```

Component roster (see `apps/editor/inertia/components/`):

| Component | What it does |
|---|---|
| `Stage` | Canvas + drag-to-move + corner/rotation handles + marquee select |
| `LayersPanel` | Reorder, visible/locked toggles, rename, multi-select |
| `Outliner` | Hierarchical tree with group expansion |
| `ItemToolbar` | Place new shape/text/sprite/scene-instance/group |
| `Inspector` | Transform/content/tween editor; multi-select-aware ("Mixed" badges) |
| `Library` | Templates / behaviors / scenes / assets / fonts (global + project) |
| `RenderHistory` | Live queue, per-job progress, cancel |
| `RenderDialog` | Codec / crf / preset preflight |
| `CompositionSettingsDialog` | Size / fps / duration / background |
| `SourceDrawer` | Reveal the resolved JSON path for any selected item |
| `OnboardingOverlay` / `HelpOverlay` | First-run tour + shortcut cheatsheet |
| `ApplyTemplateDialog` | Edit template params before drop |
| `Toasts` / `StatusBar` | Async feedback, structured-error display |

Keyboard shortcuts: ⌘Z / ⌘⇧Z (undo/redo), ⌘G / ⌘⇧G (group/ungroup),
⌘R (render), `Space` (play/pause), `Delete` / `Backspace` (remove).

The editor manages `<project>/composition.json` plus `<project>/library/`
(local overrides), `<project>/assets/`, `<project>/renders/`. Project lifecycle
runs through the four MCP tools `current_project`, `list_projects`,
`open_project`, `create_project`. The shared recents registry lives at
`~/.davidup/recents.json` (override with `$DAVIDUP_STATE_DIR`).

---

## The MCP server — full reference for agents

**Transport**: stdio. **Entry**: `bun run src/mcp/bin.ts` (declared as the
`davidup-mcp` bin). **Tools**: 56 atomic tools, all returning structured
results with `{error: {code, message, hint?, issues?, warnings?, details?}}`
on failure (`isError: true`).

### Tool catalog by category

| § | Category | Tools |
|---|---|---|
| 4.1 | Composition lifecycle | `create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset` |
| 4.2 | Assets | `register_asset`, `list_assets`, `remove_asset` |
| 4.3 | Layers | `add_layer`, `update_layer`, `remove_layer` |
| 4.4 | Items | `add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item` |
| 4.5 | Tweens | `add_tween`, `update_tween`, `remove_tween`, `list_tweens` |
| 4.5a | Audio tracks | `add_audio_track`, `update_audio_track`, `remove_audio_track`, `list_audio_tracks` |
| 4.5b | Behaviors | `apply_behavior`, `list_behaviors`, `define_user_behavior` |
| 4.5c | Templates | `apply_template`, `list_templates`, `define_user_template`, `remove_user_template` |
| 4.5d | Scenes | `define_scene`, `import_scene`, `list_scenes`, `remove_scene`, `add_scene_instance`, `update_scene_instance`, `remove_scene_instance` |
| 4.6 | Render | `render_preview_frame`, `render_thumbnail_strip`, `render_to_video`, `get_render`, `list_renders`, `cancel_render` |
| 4.7 | Project lifecycle *(editor-hosted)* | `current_project`, `list_projects`, `open_project`, `create_project` |
| 4.8 | Library *(editor-hosted)* | `list_library`, `get_library_thumbnail` |
| 4.9 | Engine discovery | `list_easings`, `list_fonts`, `list_engine_capabilities`, `get_source_map` |

Editor-hosted tools require the editor (or another host injecting
`ProjectControls` / `LibraryControls` / `RenderControls`); standalone they
return `E_FEATURE_UNAVAILABLE` cleanly. `import_scene` is sandboxed to
`<project>/scenes/` in editor mode and gated on `DAVIDUP_ALLOW_FS=1` in
standalone.

### Structured error model

Every error carries one of the codes in
[`src/engine/errors.ts`](./src/engine/errors.ts). Highlights an agent should
handle:

| Code | Means |
|---|---|
| `E_INVALID_VALUE` | Zod rejected a field — see `issues[]` for field-level detail |
| `E_DUPLICATE_ID` | Tried to create an item / layer / asset with an id that already exists |
| `E_UNKNOWN_ID` | Referenced an id that doesn't exist |
| `E_TWEEN_OVERLAP` | Two tweens collide on the same `(item, property)` |
| `E_INVALID_PROPERTY` | Tried to tween a property the item type doesn't expose |
| `E_BEHAVIOR_UNKNOWN` / `E_BEHAVIOR_PARAM_MISSING` | Bad behavior name / missing required param |
| `E_TEMPLATE_UNKNOWN` / `E_TEMPLATE_PARAM_MISSING` | Same for templates |
| `E_SCENE_UNKNOWN` / `E_SCENE_RECURSION` | Scene placement failures |
| `E_TIME_MAPPING_TWEEN_SPLIT` | A `clip` boundary cut through a tween |
| `E_ASSET_CONFLICT` | Two assets with the same id but different content |
| `E_FEATURE_UNAVAILABLE` | Standalone-mode tool that needs editor host |
| `E_RENDER_FAILED` | ffmpeg or the render pipeline failed — see `details.stderrTail` |

Plus warnings (`MCPIssue` with `W_*` codes) that don't fail the call.

### Async render lifecycle

`render_to_video` defaults to async — returns `{jobId, status: "queued"}`
immediately. Poll with `get_render(jobId)`, list everything with
`list_renders`, abort with `cancel_render(jobId)`. Pass `{wait: true}` to
block until completion and receive the final `{outputPath, durationMs,
frameCount}` directly.

### Discovery first

The very first tool an agent should call in a new session is
`list_engine_capabilities` — one round-trip returns `easings[]`,
`blendModes[]`, `itemTypes[]`, `shapeKinds[]`, `tweenable{}`, and the
`schemaVersion`. Follow up with `list_behaviors`, `list_templates`,
`list_scenes`, `list_fonts` only when you actually need their detailed
descriptors.

### Per-session vs process-global registries

User-defined templates and scenes (`define_user_template`, `define_scene`,
`import_scene`) are scoped to the MCP session via the `CompositionStore` —
multi-tenant backends don't leak between sessions.

---

## JS API surface

Subpath exports declared in [`package.json`](./package.json):

| Subpath | Headline exports | Use when |
|---|---|---|
| `davidup/schema` | `validate`, `CompositionSchema`, `ItemSchema`, `TransformSchema`, `LayerSchema`, `TweenSchema`, `AssetSchema`, `BLEND_MODES`, `getTweenable`, `listTweenable` | Parsing JSON, validating before render, discovering tweenable paths |
| `davidup/easings` | `EASING_NAMES`, `EASINGS`, `isEasingName`, `getEasing` | Sampling the same easing math from custom code |
| `davidup/engine` | `computeStateAt`, `renderFrame`, `drawScene`, `drawItem`, `indexTweens`, `MCP_ERROR_CODES`, `MCPToolError`, source-map types | Building your own driver, sampling state without painting |
| `davidup/assets` | `BaseAssetLoader`, `BrowserAssetLoader`, `NodeAssetLoader` | Custom asset loading (CDN, S3, mocks) |
| `davidup/browser` | `attach(comp, canvas, options) → { stop, seek, pickItemAt, getItemBoundsAt, getSourceMap }` | Live preview, editor hit-testing |
| `davidup/node` | `renderToFile(comp, outPath, opts)`, `buildFfmpegArgs`, `frameCount` | Render MP4 / MOV / WebM via ffmpeg |
| `davidup/compose` | `precompile`, plus `expand*` / `list*` / `register*` / `define*` for behaviors, templates, scenes; `resolveImports`, `evaluatePointer` | High-level authoring; running the four-pass pipeline |
| `davidup/mcp` | `createServer`, `dispatchTool`, `TOOLS`, `TOOL_NAMES`, `CompositionStore`, `renderPreviewFrame`, `renderThumbnailStrip` | Embedding the MCP server, in-process tool calls from tests |
| `davidup/cli/scaffold` | `scaffoldProject`, `listScaffoldTemplates`, `ScaffoldError` | Programmatic project bootstrap |

---

## Drivers

### Node — `renderToFile`

```ts
import { renderToFile } from "davidup/node";

await renderToFile(comp, "out.mp4", {
  codec: "libx264",         // "libx264" | "libx265"
  crf: 18,                  // 0–63
  preset: "medium",         // any ffmpeg preset
  pixFmt: "yuv420p",
  movflagsFaststart: true,  // streamable MP4 (currently node-API only)
  ffmpegPath: "/usr/local/bin/ffmpeg",
  onProgress: ({ frame, total }) => { /* SSE / IPC */ },
});
```

Pipeline: precompile → preload all assets → one reused `skia.Canvas` → per
frame: `clearRect`, `renderFrame`, `canvas.toBuffer("raw")` RGBA, `stdin.write`
with `drain` backpressure → close with stderr-tail captured. Signal-killed
ffmpeg fails loudly.

### Browser — `attach`

```ts
const handle = await attach(comp, canvas, {
  startAt: 0,            // start the RAF loop at this time
  emitSourceMap: true,   // enable .getSourceMap() and per-hit source info
  sourcePath: "...",     // for $ref resolution
});
```

Handle methods:

- `stop()` — terminal, frees loader-owned font registrations.
- `seek(t)` — moves the playhead, re-primes the RAF loop if it had self-stopped.
- `pickItemAt(x, y, t?) → PickHit | null` — id-buffer hit test; children of a
  `group` resolve to the child id.
- `getItemBoundsAt(itemId, t?) → ItemBounds | null` — four world-space corners
  for selection rings; group bounds are AABB of descendants.
- `getSourceMap() → SourceMap | null` — file + JSON-pointer for each resolved
  item, when `emitSourceMap: true`.

---

## CLI — `davidup`

```
davidup new <dir> [--template=<name>] [--force]
davidup edit <dir> [--port=<n>] [--host=<h>] [--no-open]
davidup list                          # or: davidup recent
davidup --version | --help
```

- `new` scaffolds a project. Default template `basic` (composition.json,
  library/, assets/, renders/, README). Refuses non-empty dirs without
  `--force`. Validates the scaffolded composition against the live schema.
- `edit` boots the editor in `<dir>`. Watches the project, opens the
  browser.
- `list` / `recent` prints the recents registry as a table (NAME / PATH /
  LAST OPENED / MODIFIED), auto-pruning dead entries.

State directory: `$DAVIDUP_STATE_DIR` (default `~/.davidup`). Contains
`recents.json` and (by default) the global `library/`.

---

## Global library (`~/.davidup/library`)

The Library panel in the editor reads from a **shared pool** layered with a
project-local override: project-local wins when ids collide.

```bash
bun run seed:library                  # full seed (network needed for fonts)
bun run seed:library -- --skip-fonts  # offline mode
bun run seed:library -- --skip-existing
bun run seed:library -- --dry-run
```

Idempotent. Provisions:

- **11 templates**: `endCard`, `quoteCard`, `statBig`, `ctaButton`,
  `sectionDivider`, `progressBar`, `tagPill`, `countdown321`, `logoBadge`,
  `subtitleBar`, `compareSplit`.
- **11 behavior cards** — descriptor metadata for the engine built-ins so
  they appear as drag targets in the Library panel (they still resolve to
  the built-in expansion at compile time).
- **10 fonts** from the `@fontsource` jsdelivr mirror: Inter (bold/reg),
  Bebas Neue, Anton, Playfair Display Bold, Montserrat Bold, Space Grotesk,
  JetBrains Mono, Caveat Bold, DM Sans. Registered with `global:fonts/...`
  URLs that the browser loader rewrites at runtime.

Override the library root with `$DAVIDUP_LIBRARY`. See
[`scripts/seed-global-library.ts`](./scripts/seed-global-library.ts) for the
exact catalog or to add your own.

---

## Examples directory

| Path | Purpose | Launch |
|---|---|---|
| `examples/hello-world.json` | Canonical §3.1 logo fade-in | consumed by `render.ts` |
| `examples/render.ts` | JS-API tour: JSON → validate → state → PNG → MP4 | `bun run examples/render.ts` |
| `examples/mcp-demo.md` | Annotated MCP authoring transcript | read-only |
| `examples/browser-demo/` | Live preview demo via Vite | `bun run dev:browser` |
| `examples/comprehensive-browser/` | Single-file comprehensive showcase | `bun run dev:comprehensive` |
| `examples/comprehensive-split-browser/` | Same composition split via `$ref` | `bun run dev:comprehensive-split` |
| `examples/two-templates-browser/` | 30s clip from two built-in templates | `bun run dev:two-templates` |
| `examples/four-scenes-browser/` | Four scenes time-mapped into 60s reel | `bun run dev:four-scenes` |
| `examples/time-mapping-mcp/` | MCP-driven time-mapping demo | `bun run examples/time-mapping-mcp/render.ts` |
| `examples/editor-demo/` | Scaffolded project for editor onboarding | `davidup edit examples/editor-demo` |

---

## Determinism

- `(composition, t) → pixels` is a pure function. Same composition + same `t`
  → exact same pixels, every host. (MP4 byte-identicality depends on
  matching skia-canvas + ffmpeg versions; pre-encode output is bit-deterministic.)
- The resolver (`computeStateAt`) is pure: no global state, no I/O.
- **No PRNG** inside the engine. `shake` and similar "random-looking"
  behaviors are fully deterministic emissions.
- Precompile (`resolveImports` → `expandTemplates` → `expandSceneInstances`
  → `expandBehaviors`) returns new objects, never mutates input. The
  source-map overlay is strict — emitting it does not change resolved JSON.
- Tween ids are deterministic: behaviors emit `${itemId}__${suffix}`,
  template/scene expansions use stable prefixes, scene loops add `__loop${i}`.
- Overlap detection uses a fixed 1 µs epsilon — chained `start + duration`
  arithmetic that drifts by ≤ 1 ULP still validates.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `dyld: Library not loaded: libx265…` when ffmpeg starts | Broken Homebrew ffmpeg | `brew reinstall ffmpeg x265`, or rely on the bundled `ffmpeg-static` |
| `EPIPE: broken pipe, send` from `renderToFile` | ffmpeg crashed | Inspect the thrown error's `message` for the stderr tail; verify `ffmpeg -version` |
| MP4 doesn't play in the browser inline | Missing faststart atom | Pass `movflagsFaststart: true` to `renderToFile` |
| `tools list is empty` in your MCP client | The Davidup subprocess didn't start | Run `bun run src/mcp/bin.ts` manually — anything on stderr is the real error. Use absolute paths in the config |
| `skia-canvas` install fails | Native build prerequisites missing | macOS: `xcode-select --install`. Linux: install `build-essential` + `libcairo2-dev` |
| Editor's Library panel is empty | Global library not seeded | `bun run seed:library` |
| `E_FEATURE_UNAVAILABLE` from `list_library` / `current_project` / etc. | Tool requires the editor host | Use the tool from inside `davidup edit`, or inject `LibraryControls` / `ProjectControls` when calling `createServer()` |

More agent-side troubleshooting: [`examples/mcp-demo.md` §7](./examples/mcp-demo.md).

---

## Repo layout

```
src/
  schema/         Zod schemas + validator + tweenable lookup     (design-doc §3, §3.5)
  easings/        19 named easings + lookup helpers              (§3.4)
  color/          hex / rgba parser + RGB lerp                    (§3.3)
  engine/         computeStateAt, renderFrame, drawItem,          (§5.1–5.4)
                  MCP_ERROR_CODES, MCPToolError, source-map types
  assets/         AssetLoader interface + browser/node impls      (§5.5)
  compose/        precompile pipeline:                            (§8.x)
                    behaviors / templates / scenes / params /
                    imports / jsonPointer / builtInTemplates
  drivers/
    node/         renderToFile via skia-canvas + ffmpeg           (§5.6, §6)
    browser/      attach() — RAF preview + pick + bounds + source (§5.6)
  mcp/            server + 56 tools + in-memory store + bin       (§4)
  cli/            scaffold + commands (new / edit / list)

apps/
  editor/         AdonisJS + Inertia + Vue editor (v1.0)

scripts/
  seed-global-library.ts   curated starter pack for ~/.davidup/library

tests/            Vitest unit + integration tests, incl. real MP4
examples/         hello-world + browser demos + MCP transcript + editor demo

design-doc.md            Spec (live document)
ARCHITECTURE.md          High-level architecture
COMPOSITION_PRIMITIVES.md Primitive-level design notes
server.json              MCP server manifest
.mcp.json                Repo-local MCP client config
```

---

## Roadmap

Shipped since v0.1:

- **v1.0 editor** (AdonisJS + Inertia + Vue, end-to-end command bus).
- Scene primitives (definition, instances, four time-mapping modes).
- Template primitive (5 built-in, 11 library) + behavior primitive (11 built-in).
- `$ref` imports + JSON-pointer evaluation.
- Source-map emission for "reveal in source".
- Async render queue (`get_render` / `list_renders` / `cancel_render`).
- Project lifecycle (`current_project` / `open_project` / `create_project`).
- Shared `~/.davidup/library` global pool + `bun run seed:library`.
- Engine discovery tools (`list_engine_capabilities` / `list_easings` / `list_fonts`).
- Visible / locked / name flags on items and layers.

Still open:

- **v0.2** — audio muxing post-render, cubic-bezier easings, frame-range
  parallelization on the server.
- **v0.3** — video clips as sprite sources.
- **v0.4** — visual effects (blur, glow, drop shadow).

Full discussion: [`design-doc.md` §8](./design-doc.md).

---

## Contributing

- Schema or tool changes must land in `design-doc.md` first.
- Every new tool gets exhaustive coverage in `tests/mcp/` (success path,
  every error code, idempotency check).
- The integration test (`tests/drivers/node.integration.test.ts`) is the
  end-to-end smoke check — keep it green.
- `server.json`'s tool list and the tool count cited in this README and
  `examples/mcp-demo.md` must stay in lockstep with `TOOL_NAMES` — the
  `tests/mcp/manifest.test.ts` enforces both.

```bash
bun run typecheck && bun run test
```

is the gate.

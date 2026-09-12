# Davidup

> A deterministic 2D programmatic video engine.
> One canonical JSON composition runs in the **browser** (live preview via
> Canvas2D + `requestAnimationFrame`), on the **server** (frame-by-frame render
> with [`skia-canvas`](https://github.com/samizdatco/skia-canvas) piped to
> `ffmpeg` → MP4), inside an **AI agent** loop (58 atomic MCP tools), from the
> **CLI** (`davidup render`), or in a **human editor** (`davidup edit`).
> Same input → same pixels, every host.

```
                       ┌────────────────────────────┐
                       │   composition (canonical   │
                       │      JSON, schema "0.1")   │
                       └─────────────┬──────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
    ┌───────▼───────┐       ┌────────▼────────┐      ┌────────▼────────┐
    │ browser/      │       │ drivers/node    │      │ mcp server      │
    │ attach()      │       │ renderToFile()  │      │ 58 tools, stdio │
    │ live preview  │       │ → mp4 (+audio)  │      │ for AI agents   │
    └───────────────┘       └────────┬────────┘      └────────┬────────┘
                                     │                        │
                            ┌────────▼────────┐   ┌───────────▼──────────┐
                            │ cli             │   │ apps/editor          │
                            │ davidup render  │   │ AdonisJS + Inertia   │
                            │ davidup new/edit│   │ + Vue — the editor   │
                            └─────────────────┘   │ humans drive         │
                                                  └──────────────────────┘
```

This README is the **manual**. Read the section that matches what you want to
do — quickstarts on top, full reference below. The
[Known limitations](#known-limitations) section is the honest list of what
v1.0 does *not* do yet; read it before planning a production workflow.

---

## Table of contents

- [What this is](#what-this-is)
- [Install & verify](#install--verify)
- [Five-minute quickstarts](#five-minute-quickstarts)
  - [A — Human in the editor](#a--human-in-the-editor-recommended-for-authoring)
  - [B — Human writing JS (live preview)](#b--human-writing-js-live-preview-in-the-browser)
  - [C — Render an MP4 from the CLI or JS](#c--render-an-mp4-from-the-cli-or-js)
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
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Repo layout](#repo-layout)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## What this is

Davidup is built for the case where you want **structured, deterministic
authoring of short motion-graphics clips** — intros, lower thirds, end cards,
captioned b-roll, 5–60 second pieces — particularly when the author is an LLM
or an editor tool, not a person writing imperative code.

The product surfaces, all built on the same engine:

| Surface | Who uses it | Entry point |
|---|---|---|
| `davidup/engine` + `davidup/schema` | Library consumers | `import { renderFrame, computeStateAt } from "davidup/engine"` |
| `davidup/node` | Server-side MP4 rendering | `import { renderToFile } from "davidup/node"` |
| `davidup/browser` | Live preview, in-browser editors | `import { attach } from "davidup/browser"` |
| CLI (`davidup`) | Scaffold, headless render, launch the editor | `davidup render ./my-clip -o out.mp4` |
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
   preview-frame-as-image is non-negotiable.
3. **Atomic, orthogonal authoring.** Adding a sprite, adding a tween, moving an
   item to a different layer — each is one tool call returning a structured
   response. No prose, no codegen.

The same machinery serves humans well: a deterministic JSON model is also a
good substrate for undo/redo, multiplayer editing, and version-controlled
visual changes. The editor is literally an MCP client of its own backend —
every button dispatches the same command an agent would.

---

## Install & verify

Requirements:

- [Bun](https://bun.com/) ≥ 1.1 for development (tests, scripts, the `bun`
  export condition that runs `src/` directly).
- Node ≥ 20.6 for the built CLI and MCP bins (`dist/`), which carry
  `#!/usr/bin/env node` shebangs.
- `ffmpeg` / `ffprobe`. The package depends on `ffmpeg-static` and
  `ffprobe-static`, so `bun install` brings working binaries; a system
  `ffmpeg` on `$PATH` is only the fallback if those packages are missing.
- macOS / Linux build tools for the `skia-canvas` native build.

```bash
bun install
bun run typecheck   # tsc --noEmit, strict
bun run test        # vitest: 768 tests, incl. real-ffmpeg integration + editor smoke
bun run build       # tsc → dist/ (needed before `davidup` / `davidup-mcp` bins work)
```

A green test run is the verification that your machine is wired correctly.
The suite includes `tests/drivers/node.integration.test.ts` (renders
hello-world through skia-canvas + ffmpeg and checks it with `ffprobe`), the
determinism harness (`tests/determinism/`), and a Playwright smoke test that
boots the real editor, adds a shape, animates it, and renders a draft MP4
(`tests/e2e/editorSmoke.integration.test.ts`; self-skips without Chromium).

The editor has its own suite:

```bash
cd apps/editor && npm run typecheck && node ace test   # 316 tests
```

**Installing the CLI globally.** The package is `"private": true` and is not
published to npm, so there is no `npx davidup` yet. From a checkout:

```bash
bun run build && bun run build:editor   # dist/ + editor-dist/
bun link                                 # exposes `davidup` and `davidup-mcp`
```

`npm pack` produces a tarball that installs and runs on a plain Node machine
(no Bun) — `davidup new`, `davidup render`, and `davidup edit` all work from
it; this is how the packaged path is verified.

---

## Five-minute quickstarts

### A — Human in the editor (recommended for authoring)

```bash
bun run seed:library      # one-off, populates ~/.davidup/library
bun run cli -- new ./my-clip
bun run cli -- edit ./my-clip
```

The browser opens to the editor. You get:

- **ItemToolbar** (left rail) — Rectangle, Circle, Text, Sprite, Video, Audio,
  plus Group / Ungroup. Polygons, scene instances, and templates come from
  the Library panel, not the toolbar.
- **Stage** — drag bodies to move, corner handles for scale, top handle for
  rotation, marquee-drag empty space to multi-select. Drop files or library
  cards straight onto it.
- **Timeline** — ruler + playhead, one row per item with a bar per tween
  (colour-coded by origin: plain / template / behavior / scene), drag to move
  and resize bars, video spans with trim handles, an audio lane.
- **LayersPanel** — reorder, `visible` / `locked` toggles, rename.
- **Outliner** — tree view of every item with group expansion.
- **Inspector** — typed inputs per item type, "+ animate" to add a tween,
  tween editor on bar select, audio-track and video-trim editors. Multi-select
  shows "Mixed" for diverging fields and writes back to the whole selection.
- **Library** — templates / behaviors / scenes / assets / fonts from the
  global pool and a project-local override pool. Save your own via
  **SaveDefinitionDialog**.
- **RenderStrip / RenderHistory** — render with a quality preset (Draft /
  Web / Final), live progress + ETA, past renders with rename / delete /
  reveal.
- **SourceDrawer** (⌘J) — the authored `composition.json` with the
  selection's JSON pointer highlighted (read-only).

Shortcuts: `Space` play/pause · `Backspace` delete (tween if a bar is
selected, else item) · ⌘Z / ⌘⇧Z undo/redo · ⌘G / ⌘⇧G group/ungroup ·
⌘R render · ⌘J source drawer · ⌘0 seek to start · `V` add video · `A` add
audio · `?` help · `Esc` cancel. ⌘S only shows a "Saved" toast — every
command is already persisted to disk.

### B — Human writing JS (live preview in the browser)

```bash
bun run dev:browser
```

Opens [`examples/browser-demo`](./examples/browser-demo) on Vite. Buttons
exercise the driver's `seek` / `stop` controls.

```ts
import { attach } from "davidup/browser";

const handle = await attach(comp, canvas);
// handle.stop()                  cancel the RAF loop (terminal)
// handle.pause() / resume()      freeze / continue the clock
// handle.seek(seconds)           move playhead
// handle.pickItemAt(x, y)        what item is under that screen pixel?
// handle.getItemBoundsAt(id)     selection-ring corners
// handle.getResolvedItemAt(id)   the item with tweens applied at the playhead
// handle.getSourceMap()          where each resolved item came from
```

`attach()` is async — it preloads images and fonts before the first paint, so
once it resolves the canvas already shows frame 0. **Video items are not
drawn in the browser preview** (only their hit box); see
[Known limitations](#known-limitations).

### C — Render an MP4 from the CLI or JS

```bash
davidup render ./my-clip -o out.mp4                   # project dir
davidup render composition.json -o out.mp4 --crf=23   # raw composition file
```

Progress streams to stderr (`davidup render · frame N/T (x.x fps)`); the
final line on stdout names the file. Or in JS:

```ts
import { renderToFile } from "davidup/node";
import { validate } from "davidup/schema";

if (!validate(comp).valid) throw new Error("invalid composition");
await renderToFile(comp, "out.mp4", { codec: "libx264", crf: 18 });
```

[`examples/render.ts`](./examples/render.ts) is the annotated tour: load JSON
→ validate → sample the resolver → render a single PNG frame → render the
full MP4. Outputs land in `examples/output/`.

**Video + audio, minimal**: a `video` item is a silent, sprite-shaped clip
(`trimIn`/`trimOut` window into the source file, `fit`/`loop` like any other
box); audio comes from the separate top-level `audio` array, muxed on after
the silent video encode:

```ts
{
  assets: [
    { id: "clip", type: "video", src: "./clip.mp4", duration: 8 },
    { id: "vo", type: "audio", src: "./voiceover.mp3", duration: 6 },
  ],
  items: {
    v: {
      type: "video", asset: "clip", width: 1920, height: 1080,
      start: 0, trimIn: 1, trimOut: 7, fit: "cover", loop: false,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
    },
  },
  audio: [{ id: "vo-1", asset: "vo", start: 0.5, trimIn: 0, volume: 1, fadeOut: 0.5 }],
  // ...layers referencing "v", composition/tweens as usual
}
```

Frame pre-extraction (cached PNG sequence per clip under
`~/.davidup/cache/frames`) and the two-stage video+audio mux pipeline are
automatic — `renderToFile` detects video items and audio tracks and switches
pipelines with zero extra options. Three runnable video samples, each with a
real-ffmpeg integration test:

- [`examples/video-pip/`](./examples/video-pip/) — two simultaneous video
  items (looping full-frame background + inset clip), picture-in-picture.
- [`examples/video-bg-text/`](./examples/video-bg-text/) — full-frame video
  background under a fading/sliding text caption.
- [`examples/video-freeze-trim/`](./examples/video-freeze-trim/) — a trimmed
  clip that freezes on its last frame once the trim window runs out.

### D — AI agent driving the engine via MCP

Wire the server into your MCP client. From a checkout, run the source with
Bun; from a built package, run the Node bin:

```jsonc
// Claude Code: ~/.claude.json   (or .mcp.json in this repo)
{
  "mcpServers": {
    "davidup": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/davidup/src/mcp/bin.ts"]
      // or after `bun run build`:  "command": "node", "args": ["/abs/path/dist/mcp/bin.js"]
      // or after `bun link`:       "command": "davidup-mcp"
    }
  }
}
```

Then ask the model anything like *"build a 3-second clip with a logo that
fades in and pops in scale"*. The canonical sequence the agent will follow:

```
list_engine_capabilities         (one-shot discovery: easings, item types,
                                  shape kinds, blend modes, tweenable props,
                                  server flavor)
create_composition
register_asset × N               (image / font / audio / video)
add_layer
add_sprite / add_text / add_shape / add_group / add_video   (one call per item)
  └── or use higher-level shortcuts:
        apply_template                                (parameterised template)
        apply_behavior                                (named tween bundle)
        add_scene_instance                            (drop a full sub-clip)
add_audio_track                                       (music / voiceover)
validate                                              (after each non-trivial mutation)
render_preview_frame                                  (PNG/JPEG image block, verify visually)
render_to_video                                       (standalone: blocking;
                                                       editor-hosted: async, poll get_render
                                                       or pass wait: true)
```

Full transcript with every tool call's input and output:
**[`examples/mcp-demo.md`](./examples/mcp-demo.md)**. The v1.0 launch video
in [`examples/launch-video/`](./examples/launch-video/) was authored entirely
this way.

---

## Mental model in 60 seconds

1. **Composition** is top-level JSON. `{ version: "0.1", composition: { width,
   height, fps, duration, background }, assets[], layers[], items{}, tweens[],
   audio?[] }`. The schema is in [`design-doc.md`](./design-doc.md) §3 and
   enforced by [`src/schema/zod.ts`](./src/schema/zod.ts).
2. **Items** are `sprite | text | shape | group | video`. Each has a `transform`
   (`x, y, scaleX, scaleY, rotation, anchorX, anchorY, opacity`) and optional
   flags `visible`, `locked`, `name`, `enter`, `exit`.
3. **Layers** are flat z-stacks of item ids. Layers carry their own
   `opacity`, `blendMode`, and the same flags.
4. **Tweens** interpolate one property of one item over a time window with a
   named easing. Two tweens cannot overlap on the same `(item, property)` —
   the validator rejects it (`E_TWEEN_OVERLAP`).
5. **Audio tracks** live outside the item tree in `audio[]` and are muxed onto
   the finished video; the engine never touches sound.
6. **Render** is `(composition, t) → pixels`. Pure function. Powers both
   browser and server; only the *driver* changes.
7. **Authoring** has four tiers (raw items+tweens → behaviors → templates →
   scene instances). Higher tiers are compiled down to the same canonical
   JSON before render.
8. **Agents author through MCP.** They call `add_*` / `apply_*` tools,
   `validate` along the way, `render_preview_frame` at key beats, and finally
   `render_to_video`.

---

## Composition primitives (what the engine can render today)

### Item types

`sprite`, `text`, `shape`, `group`, `video`. Schemas in
[`src/schema/zod.ts`](./src/schema/zod.ts).

| Type | Own fields |
|---|---|
| `sprite` | `asset` (image id), `width`, `height`, `tint?` |
| `text` | `text`, `font` (font **asset id**, not a CSS family), `fontSize`, `color`, `align?` (`left`/`center`/`right`) |
| `shape` | `kind` (`rect`/`circle`/`polygon`), `width?`, `height?`, `points?`, `fillColor?`, `strokeColor?`, `strokeWidth?`, `cornerRadius?` |
| `group` | `items: string[]` — child ids; group opacity multiplies into children (not isolated compositing) |
| `video` | `asset` (video id), `width`, `height`, `start`, `end?`, `trimIn?`, `trimOut?`, `fit` (`cover`/`contain`/`fill`/`none`, default `contain`), `loop` (default `false`) |

Text is a single line drawn with one `fillText`: no wrapping, no `\n`, no
letter-spacing / line-height / stroke / shadow (see `TEXT_V2_DESIGN.md` for
the v1.1 plan). Circles use `width` as diameter. A video item is a silent
texture — it freezes on its last frame when the trim window runs out, or
loops with `loop: true`; its own audio track is always discarded.

### Transform fields

`x`, `y`, `scaleX`, `scaleY`, `rotation` (radians, clockwise), `anchorX`,
`anchorY` (fractional 0..1 of the item's box), `opacity` (0..1). All required.
Anchors are inert on `text` and `group` (their anchor extent is 0).

### Item and layer flags

`visible: bool?` (skipped by renderer when false), `locked: bool?`
(editor-only), `name: string?` (≤ 80 chars), `enter: number?` / `exit:
number?` — a half-open `[enter, exit)` lifespan in composition seconds
outside which the item (or whole layer) is hidden. All optional.

### Shape kinds

`rect` (with `cornerRadius`), `circle` (`width` = diameter), `polygon`
(`points`, ≥ 3). Fill only when `fillColor` is set; stroke only when
`strokeColor` is set and `strokeWidth > 0`.

### Blend modes (26 + alias)

Every Canvas2D `globalCompositeOperation` value (26) plus `"normal"` as an
alias for `source-over`. See `BLEND_MODES` in
[`src/schema/zod.ts`](./src/schema/zod.ts).

### Easings (19)

`linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`,
`easeOutCubic`, `easeInOutCubic`, `easeInQuart`, `easeOutQuart`,
`easeInOutQuart`, `easeInBack`, `easeOutBack`, `easeInOutBack`, `easeInSine`,
`easeOutSine`, `easeInOutSine`, `easeInExpo`, `easeOutExpo`, `easeInOutExpo`.
No cubic-bezier or custom curves.

### Tweenable properties by item type

| Item | Common | Type-specific |
|---|---|---|
| all | `transform.x/y/scaleX/scaleY/rotation/opacity/anchorX/anchorY` (number) | — |
| sprite | + | `width`, `height` (number); `tint` (color) |
| text | + | `fontSize` (number); `color` (color) |
| shape | + | `width`, `height`, `strokeWidth`, `cornerRadius` (number); `fillColor`, `strokeColor` (color) |
| group | + | — (children carry their own tweens) |
| video | + | `width`, `height` (number) |

The resolver clamps `opacity` to [0,1] and sizes to ≥ 0 so overshooting
easings (`easeOutBack`) never crash a draw call. Authoritative table:
[`src/schema/tweenable.ts`](./src/schema/tweenable.ts).

### Color formats

`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`. Color
interpolation is straight RGB linear lerp. CSS named colors (`"white"`) pass
through to Canvas2D for static fills but are rejected as tween endpoints.

### Assets

| Type | Fields | Accepted sources |
|---|---|---|
| `image` | `id`, `src` | png / jpg / … anything Canvas2D decodes |
| `font` | `id`, `src`, `family` | ttf / otf / woff |
| `audio` | `id`, `src`, `duration?`, `sampleRate?`, `channels?`, `codec?` | `.mp3 .wav .aac .m4a .ogg` |
| `video` | `id`, `src`, `duration?`, `width?`, `height?`, `fps?`, `hasAlpha?`, `codec?`, `pixelFormat?` | `.mp4 .mov .webm .mkv` |

Audio/video metadata is filled in by `ffprobe` on `register_asset` when
available; without it the asset still registers (with a warning). The
browser asset loader understands `global:assets/...` and `global:fonts/...`
URLs that resolve out of `~/.davidup/library` (or the project-local pool).

### Audio tracks (`audio[]`)

`{ id?, asset, start, end?, trimIn?, volume? (0–2), fadeIn?, fadeOut? }`.
`start`/`end` place the track on the composition timeline; `trimIn` seeks
into the source file. Output is always stereo AAC-LC, 48 kHz, 192 kb/s;
multiple tracks are mixed without normalisation.

---

## Authoring layers — from low to high level

The same composition can be expressed at any of four levels of abstraction.
Higher levels are *compiled down* to the level below by
[`src/compose/precompile.ts`](./src/compose/precompile.ts) before render
(`resolveImports` → `expandTemplates` → `expandSceneInstances` →
`expandBehaviors`). The drivers always run precompile, so all four levels are
valid inputs to `renderToFile`, `davidup render`, and `attach()`.

### Level 1 — Raw items + tweens

The canonical shape (`version: "0.1"`). Every other level expands to this.

### Level 2 — Behaviors (11 built-in)

Named, deterministic bundles of tweens. Either applied imperatively
(`apply_behavior` MCP tool) or written inline as
`{ "$behavior": "popIn", "target": "logo", "start": 0, "duration": 1, "params": {…} }`
blocks inside `tweens[]`.

| Behavior | What it does | Params (bold = required) |
|---|---|---|
| `fadeIn` | opacity 0→1 | `fromOpacity`, `toOpacity` |
| `fadeOut` | opacity 1→0 | `fromOpacity`, `toOpacity` |
| `popIn` | opacity 0→1 + uniform scale 0.2→1 | `fromScale`, `toScale`, `fromOpacity`, `toOpacity` |
| `popOut` | opacity 1→0 + scale 1→0.2 | `fromScale`, `toScale`, `fromOpacity`, `toOpacity` |
| `slideIn` | translate from offset to rest along an axis | **`from`**, **`axis`** (`x`/`y`), `to` |
| `slideOut` | translate from rest out to offset | **`to`**, **`axis`**, `from` |
| `rotateSpin` | rotate `2π × turns` radians | `turns`, `fromRotation` |
| `kenburns` | position drift + uniform (X and Y) scale drift | **`fromScale`**, **`toScale`**, **`pan`**, `axis`, `fromPosition` |
| `shake` | ±amplitude oscillation over N cycles, returns to center | **`amplitude`**, **`cycles`**, `axis`, `center` |
| `colorCycle` | tween a color property through ≥ 2 stops evenly | **`colors[]`**, `property` |
| `pulse` | `scaleX` out → back in (X axis only) | **`peakScale`**, `fromScale` |

Behaviors emit deterministically-named tweens (`${parentId}__${suffix}`,
parent id defaulting to `${target}_${behavior}_${start}`). `list_behaviors`
returns the full descriptor including param types and value domain.
`define_user_behavior` registers **catalog metadata only** — user behaviors
show up in `list_behaviors` and the Library panel but cannot be expanded in
v1.0.

### Level 3 — Templates (5 built-in + 11 shipped in the global library)

Parameterised authoring patterns. Engine built-ins (auto-registered):

- `titleCard` — centered headline pop-in + subtitle fade-in.
- `lowerThird` — broadcast lower-third with sweeping accent bar.
- `captionBurst` — single emphatic caption pops in scaled.
- `bulletList` — three staggered fade-in bullets (fixed at three).
- `kenburnsImage` — sprite with fade-in + Ken Burns slow zoom/pan.

Library extras (installed by `bun run seed:library`): `endCard`, `quoteCard`,
`statBig`, `ctaButton`, `sectionDivider`, `progressBar`, `tagPill`,
`countdown321`, `logoBadge`, `subtitleBar`, `compareSplit`.

Use via `apply_template` (MCP) / `expandTemplate` (JS) / drag-from-Library
(editor). Param substitution is **whole-string only**: a field may be exactly
`"${params.name}"` or `"${$.start}"`; there is no arithmetic and no inline
interpolation (see `REPEAT_EXPRESSIONS_DESIGN.md` for the v1.1 plan).

### Level 4 — Scenes + scene instances

A *scene* is a self-contained mini-composition with its own `duration`,
`size`, `background`, `params`, `assets`, `items`, `tweens`. A *scene
instance* drops the scene into a parent composition with time-mapping and
overrides (`transform`, `enter`, `exit`, `params`):

- `identity` — local `t=0` plays at `instance.start` (default).
- `clip { fromTime, toTime }` — trim playback to a sub-window. Tweens that
  cross the boundary throw `E_TIME_MAPPING_TWEEN_SPLIT` (no auto-trim yet).
- `loop { count }` — play N times back-to-back with `__loop${i}` id suffixes.
- `timeScale { scale }` — play at `scale ×` speed.

(`reverse` is reserved but not implemented.) Since expansion v3, an instance
defaults its `enter`/`exit` to its own span, so it disappears when its scene
ends; pass explicit `enter`/`exit` to hold the last frame.

Define scenes with `define_scene` (literal) or `import_scene` (file). Place
them with `add_scene_instance`. Scene instances expand into a synthetic
wrapper `group` placed in the requested layer, with prefixed inner ids
(`instance__title`), children painted in declaration order, and merged assets.
Parent tweens may target the wrapper group only.

### `$ref` imports

Any object may be `{ "$ref": "./part.json" }` (inline), `{ "$ref":
"./part.json#/items/logo" }` (RFC 6901 pointer), or an array element whose
ref resolves to an array (spread in place). Same-document refs (`#/...`
without a file) are rejected. See
[`examples/comprehensive-split-browser/`](./examples/comprehensive-split-browser/).

---

## The editor (`apps/editor`)

AdonisJS server + Inertia + Vue 3 frontend, hosting an embedded MCP server.
The editor IS an MCP client of its own backend — every user action is one of
26 command kinds that map 1:1 onto MCP tools and go through the same
`dispatchTool` the AI agent uses (`apps/editor/app/types/commands.ts`).

```bash
davidup edit ./my-project              # opens the editor on :3333
davidup edit ./my-project --port 5173 --no-open
```

Component roster (see `apps/editor/inertia/components/`):

| Component | What it does |
|---|---|
| `Stage` | Canvas + drag-to-move + corner/rotation handles + marquee select + drop target |
| `ItemToolbar` | Rectangle / Circle / Text / Sprite / Video / Audio + Group / Ungroup |
| `Timeline`, `TimelineTrack`, `TimelineAudioTrack` | Ruler, playhead, tween bars (drag / resize), video trim handles, audio lane, transport button |
| `LayersPanel` | Reorder, visible/locked toggles, rename, multi-select |
| `Outliner` / `OutlinerNode` | Hierarchical tree with group expansion |
| `Inspector` | Typed per-field inputs; "+ animate"; tween / audio / video editors; multi-select "Mixed" badges; resolved-at-playhead values |
| `Library` / `LibraryCard` | Templates / behaviors / scenes / assets / fonts (global + project), search, thumbnails, drag, file-drop upload |
| `ApplyTemplateDialog` | Edit template params before drop |
| `SaveDefinitionDialog` | Save a template / behavior / scene to the project or global library |
| `CompositionSettingsDialog` | Size / fps / duration / background |
| `RenderDialog` / `RenderStrip` / `RenderHistory` | Filename + quality preset (Draft crf 30 / Web crf 23 / Final crf 18); live progress, ETA; past renders with rename / delete / reveal |
| `SourceDrawer` | Read-only authored JSON with the selection's JSON pointer highlighted |
| `StatusBar` | Validation error / warning counts; click an issue to select the item |
| `OnboardingOverlay` / `HelpOverlay` | First-run tour + shortcut cheatsheet + MCP tool catalog (`?`) |
| `Toasts` | Async feedback, structured-error display |

Keyboard shortcuts are listed in [Quickstart A](#a--human-in-the-editor-recommended-for-authoring).
`Delete` is deliberately unbound (use `Backspace`); there is no arrow-key
nudge.

Behind the scenes: server-side undo/redo history (depth 50), debounced
atomic writes of `composition.json` (500 ms), `fs.watch` on both library
roots, SSE for render progress and project switches. The editor does **not**
watch `composition.json` itself — edits made by an external tool are picked
up on the next reload.

The editor manages `<project>/composition.json` plus `<project>/library/`
(local overrides), `<project>/assets/`, `<project>/renders/`,
`<project>/scenes/`. Project lifecycle runs through the four MCP tools
`current_project`, `list_projects`, `open_project`, `create_project`. The
shared recents registry lives at `~/.davidup/recents.json` (override with
`$DAVIDUP_STATE_DIR`); the editor's own state (panel widths, onboarding,
render preset) at `~/.davidup/state.json`.

---

## The MCP server — full reference for agents

**Transport**: stdio. **Entry**: `dist/mcp/bin.js` (the `davidup-mcp` bin,
Node shebang) or `bun run src/mcp/bin.ts` from a checkout. **Tools**: 58
atomic tools, all returning structured results with `{error: {code, message,
hint?, issues?, warnings?, details?}}` on failure (`isError: true`).

### Tool catalog by category

| § | Category | Tools |
|---|---|---|
| 4.1 | Composition lifecycle | `create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset` |
| 4.2 | Assets | `register_asset` (image / font / audio / video; audio+video are ffprobed), `list_assets`, `remove_asset` |
| 4.3 | Layers | `add_layer`, `update_layer`, `remove_layer` |
| 4.4 | Items | `add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item` |
| 4.4a | Video items | `add_video`, `update_video` — silent, sprite-shaped clips with `trimIn`/`trimOut`, `fit`, `loop` (freezes on the last frame once trimmed content runs out) |
| 4.5 | Tweens | `add_tween`, `update_tween`, `remove_tween`, `list_tweens` |
| 4.5a | Audio tracks | `add_audio_track`, `update_audio_track`, `remove_audio_track`, `list_audio_tracks` |
| 4.5b | Behaviors | `apply_behavior`, `list_behaviors`, `define_user_behavior` (descriptor only) |
| 4.5c | Templates | `apply_template`, `list_templates`, `define_user_template`, `remove_user_template` |
| 4.5d | Scenes | `define_scene`, `import_scene`, `list_scenes`, `remove_scene`, `add_scene_instance`, `update_scene_instance`, `remove_scene_instance` |
| 4.6 | Render | `render_preview_frame` (`time`, `format: png\|jpeg`), `render_thumbnail_strip` (`count` ≤ 30), `render_to_video` (`outputPath`, `codec`, `crf` 0–51, `preset`, `pixFmt`, `movflagsFaststart`, `wait`), `get_render`, `list_renders`, `cancel_render` |
| 4.7 | Project lifecycle *(editor-hosted)* | `current_project`, `list_projects`, `open_project`, `create_project` |
| 4.8 | Library *(editor-hosted)* | `list_library`, `get_library_thumbnail` |
| 4.9 | Engine discovery | `list_easings`, `list_fonts`, `list_engine_capabilities`, `get_source_map` |

`render_preview_frame` and `render_thumbnail_strip` return real MCP image
content blocks, so a multimodal agent sees the frame directly. **They do not
draw video items** (no frame provider in the preview path) — only a full
`render_to_video` composites b-roll.

Editor-hosted tools (and `get_render` / `list_renders` / `cancel_render`)
require the editor or another host injecting `ProjectControls` /
`LibraryControls` / `RenderControls`; standalone they return
`E_FEATURE_UNAVAILABLE` cleanly. `import_scene` is sandboxed to
`<project>/scenes/` in editor mode and gated on `DAVIDUP_ALLOW_FS=1` in
standalone.

### Structured error model

Every MCP error carries one of the codes in
[`src/engine/errors.ts`](./src/engine/errors.ts). Highlights an agent should
handle:

| Code | Means |
|---|---|
| `E_INVALID_VALUE` | A field failed schema / range validation — see `issues[]` for field-level detail |
| `E_VALIDATION_FAILED` | The whole composition fails `validate` (e.g. before `render_*`) — see `issues[]` |
| `E_DUPLICATE_ID` | Tried to create an item / layer / asset with an id that already exists |
| `E_NOT_FOUND` | Referenced an id that doesn't exist |
| `E_TWEEN_OVERLAP` | Two tweens collide on the same `(item, property)` |
| `E_INVALID_PROPERTY` | Tried to tween a property the item type doesn't expose |
| `E_ASSET_IN_USE` / `E_ASSET_TYPE_MISMATCH` | Removing a referenced asset / wrong asset kind for the item |
| `E_BEHAVIOR_UNKNOWN` / `E_BEHAVIOR_PARAM_MISSING` / `E_BEHAVIOR_PARAM_TYPE` | Bad behavior name / missing or mistyped param |
| `E_TEMPLATE_UNKNOWN` / `E_TEMPLATE_PARAM_MISSING` / `E_TEMPLATE_PARAM_TYPE` | Same for templates |
| `E_SCENE_UNKNOWN` / `E_SCENE_RECURSION` / `E_SCENE_INSTANCE_DEEP_TARGET` | Scene placement failures |
| `E_TIME_MAPPING_INVALID` / `E_TIME_MAPPING_TWEEN_SPLIT` | Bad `time` block / a `clip` boundary cut through a tween |
| `E_ASSET_CONFLICT` | Two assets with the same id but different content |
| `E_REF_CYCLE` / `E_REF_MISSING` / `E_REF_PARSE` / `E_REF_POINTER` / `E_REF_INVALID` | `$ref` resolution failures |
| `E_FEATURE_UNAVAILABLE` | Standalone-mode tool that needs the editor host |
| `E_RENDER_FAILED` | ffmpeg or the render pipeline failed — see `details.stderrTail` |

`validate` reports its own codes inside `issues[]` / `warnings[]`: errors
`E_SCHEMA`, `E_ASSET_MISSING`, `E_ITEM_MISSING`, `E_PROPERTY_INVALID`,
`E_VALUE_KIND`, `E_COLOR_INVALID`, `E_TWEEN_OVERLAP`, `E_GROUP_CYCLE`,
`E_VIDEO_RANGE`, `E_DUPLICATE_LAYER_ID`, `E_DUPLICATE_TWEEN_ID`,
`E_POLYGON_INVALID`; warnings `W_TWEEN_TRUNCATED`, `W_ITEM_INVISIBLE_OPACITY`,
`W_ITEM_OFF_CANVAS`, `W_FONT_UNREGISTERED`, `W_SCENE_INSTANCE_OUTLIVES`.
Warnings never fail a call.

### Render lifecycle

- **Standalone server**: `render_to_video` is blocking. It returns `{jobId:
  "local-…", status: "done", result: {outputPath, durationMs, frameCount}}`.
- **Editor-hosted**: `render_to_video` enqueues and returns `{jobId, status:
  "pending"}` immediately. Poll with `get_render(jobId)` (statuses `pending`
  → `running` → `done` | `error`), list everything with `list_renders`, abort
  with `cancel_render(jobId)`. Pass `{wait: true}` to block until completion.

### Discovery first

The very first tool an agent should call in a new session is
`list_engine_capabilities` — one round-trip returns `schemaVersion`,
`easings[]`, `blendModes[]`, `itemTypes[]`, `shapeKinds[]`, `fitModes[]`,
accepted audio/video extensions, `tweenable{}`, and `server: { flavor:
"standalone" | "editor", hasProjectLifecycle, hasLibrary, hasRenderQueue }`.
Follow up with `list_behaviors`, `list_templates`, `list_scenes`,
`list_fonts` only when you need their detailed descriptors.

### Session state

User-defined templates, scenes, and behaviors (`define_user_template`,
`define_scene`, `import_scene`, `define_user_behavior`) are scoped to the
`CompositionStore` instance. **A standalone server process keeps its state
for its whole lifetime** — a second conversation talking to the same
long-lived process inherits the previous composition until `reset` is
called. `reset` clears compositions but not the user registries. Fonts are
not bundled: `add_text` needs a `register_asset(font)` first (the editor's
seeded library covers this; standalone agents must register one).

---

## JS API surface

Subpath exports declared in [`package.json`](./package.json). Each has a
`bun` condition (runs `src/*.ts` directly) and a `default` condition
(`dist/*.js`, needs `bun run build`).

| Subpath | Headline exports | Use when |
|---|---|---|
| `davidup` | `VERSION` | Version check |
| `davidup/schema` | `validate`, `CompositionSchema`, `ItemSchema`, `TransformSchema`, `LayerSchema`, `TweenSchema`, `AssetSchema`, `AudioTrackSchema`, `BLEND_MODES`, `getTweenable`, `listTweenable` | Parsing JSON, validating before render, discovering tweenable paths |
| `davidup/easings` | `EASING_NAMES`, `EASINGS`, `isEasingName`, `getEasing` | Sampling the same easing math from custom code |
| `davidup/engine` | `computeStateAt`, `renderFrame`, `drawScene`, `drawItem`, `indexTweens`, `computeFitRects`, `MCP_ERROR_CODES`, `MCPToolError`, source-map types | Building your own driver, sampling state without painting |
| `davidup/assets` | `BaseAssetLoader`, `BrowserAssetLoader`, `NodeAssetLoader` | Custom asset loading (CDN, S3, mocks) |
| `davidup/browser` | `attach(comp, canvas, options) → { stop, pause, resume, seek, pickItemAt, getItemBoundsAt, getResolvedItemAt, getSourceMap }` | Live preview, editor hit-testing |
| `davidup/node` | `renderToFile(comp, outPath, opts)`, `buildFfmpegArgs`, `frameCount`, `preExtractVideoFrames`, `probeVideo`, `probeAudio` | Render MP4 via ffmpeg, inspect media |
| `davidup/compose` | `precompile`, plus `expand*` / `list*` / `register*` / `define*` for behaviors, templates, scenes; `resolveImports`, `evaluatePointer`, `BEHAVIOR_EXPANSION_VERSION`, `SCENE_EXPANSION_VERSION` | High-level authoring; running the four-pass pipeline |
| `davidup/mcp` | `createServer`, `dispatchTool`, `TOOLS`, `TOOL_NAMES`, `CompositionStore`, `renderPreviewFrame`, `renderThumbnailStrip` | Embedding the MCP server, in-process tool calls from tests |
| `davidup/cli/scaffold` | `scaffoldProject`, `listScaffoldTemplates`, `ScaffoldError` | Programmatic project bootstrap |

---

## Drivers

### Node — `renderToFile`

```ts
import { renderToFile } from "davidup/node";

await renderToFile(comp, "out.mp4", {
  codec: "libx264",         // "libx264" | "libx265"
  crf: 18,                  // 0–51
  preset: "medium",         // any ffmpeg preset
  pixFmt: "yuv420p",
  movflagsFaststart: true,  // streamable MP4; off by default here, on by default in CLI + MCP
  ffmpegPath: "/usr/local/bin/ffmpeg",   // default: ffmpeg-static, then $PATH
  onProgress: ({ frame, total }) => { /* SSE / IPC */ },
  preExtract: { cacheRoot, maxBytes, onExtractProgress },  // video frame cache; false to disable
  sourcePath: "./comp.json",             // base dir for $ref resolution
});
```

Pipeline: precompile → preload all assets → (if video items) pre-extract each
clip's frames to a PNG cache with ffmpeg and decode them → one reused
`skia.Canvas` → per frame: `clearRect`, `renderFrame`, `canvas.toBuffer("raw")`
RGBA, `stdin.write` with `drain` backpressure → close with stderr-tail
captured → (if `audio[]`) second ffmpeg pass copies the video stream and
mixes the tracks in. Signal-killed ffmpeg fails loudly. Output container is
chosen by the `outPath` extension; **MP4 is the tested path** (H.264 /
H.265, `yuv420p`). WebM is not supported by these codecs.

Frame timing is `t = i / fps` for `ceil(duration × fps)` frames.
`fps` is passed to ffmpeg as a decimal, so `29.97` means exactly 29.97, not
30000/1001.

The frame cache lives at `$DAVIDUP_CACHE/frames` (default
`~/.davidup/cache/frames`), keyed by source path + mtime + trim window + fps
+ box size, LRU-pruned to 5 GB.

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
- `pause()` / `resume()` — freeze / continue the clock.
- `seek(t)` — moves the playhead, re-primes the RAF loop if it had self-stopped.
- `pickItemAt(x, y, t?) → PickHit | null` — id-buffer hit test; children of a
  `group` resolve to the child id.
- `getItemBoundsAt(itemId, t?) → ItemBounds | null` — four world-space corners
  for selection rings; group bounds are AABB of descendants.
- `getResolvedItemAt(itemId, t?) → Item | null` — the item with tweens applied.
- `getSourceMap() → SourceMap | null` — file + JSON-pointer for each resolved
  item, when `emitSourceMap: true`.

Video items are pickable but not painted in the browser; audio is never
played in the browser.

---

## CLI — `davidup`

```
davidup new <dir> [--template=<name>] [--force]
davidup edit <dir> [--port=<n>] [--host=<h>] [--no-open]
davidup render <project|comp.json> -o <out.mp4> [--codec=<c>] [--crf=<n>] [--fps=<n>] [--preset=<p>]
davidup list                          # or: davidup recent
davidup --version | --help
```

- `new` scaffolds a project. The only template today is `basic`
  (composition.json, library/, assets/, renders/, README). Refuses non-empty
  dirs without `--force`. Validates the scaffolded composition against the
  live schema.
- `edit` validates `composition.json`, boots the editor in `<dir>` (default
  port 3333), opens the browser, and watches the project's library.
- `render` renders a project directory or a raw composition file headlessly.
  `-o` is required. `--codec` is `libx264` (default) or `libx265`, `--crf`
  0–51 (default 18), `--fps` overrides the composition's frame rate,
  `--preset` is any ffmpeg preset (default `medium`). Faststart is always on.
  Progress goes to stderr; exit code 2 for bad arguments, 1 for invalid input
  or a failed render.
- `list` / `recent` prints the recents registry as a table (NAME / PATH /
  LAST OPENED / MODIFIED), auto-pruning dead entries.

State directory: `$DAVIDUP_STATE_DIR` (default `~/.davidup`). Contains
`recents.json`, `state.json`, `editor.sqlite3`, `cache/`, and (by default)
the global `library/`.

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
- No scenes or image assets are seeded; add your own or save them from the
  editor.

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
| `examples/four-scenes-browser/` | Four scenes time-mapped into a 60s reel | `bun run dev:four-scenes` |
| `examples/four-scenes-60s/`, `examples/ball-showcase-60s/` | Headless versions of the scene reels | `bun run examples/<dir>/render.ts` |
| `examples/time-mapping-mcp/` | MCP-driven time-mapping demo | `bun run examples/time-mapping-mcp/render.ts` |
| `examples/video-pip/`, `video-bg-text/`, `video-freeze-trim/` | Video-item samples, each with a real-ffmpeg integration test | `davidup render examples/video-pip -o out.mp4` |
| `examples/editor-demo/` | Scaffolded project for editor onboarding | `davidup edit examples/editor-demo` |
| `examples/launch-video/` | **The v1.0 launch video** — 26 s, 1080p30, music track; authored entirely by an AI agent over MCP | `davidup render examples/launch-video -o launch.mp4` |

---

## Determinism

- `(composition, t) → pixels` is a pure function. Same composition + same `t`
  → exact same pixels on the same platform and binaries.
- The resolver (`computeStateAt`) is pure: no global state, no I/O.
- **No PRNG** inside the engine. `shake` and similar "random-looking"
  behaviors are fully deterministic emissions.
- Precompile returns new objects, never mutates input. The source-map
  overlay is strict — emitting it does not change resolved JSON.
- Tween ids are deterministic: behaviors emit `${parentId}__${suffix}`,
  template/scene expansions use stable prefixes, scene loops add `__loop${i}`.
- Overlap detection uses a fixed 1 µs epsilon — chained `start + duration`
  arithmetic that drifts by ≤ 1 ULP still validates.
- Pixel-changing fixes bump `BEHAVIOR_EXPANSION_VERSION` (now 2) or
  `SCENE_EXPANSION_VERSION` (now 3) and are logged in `CHANGELOG.md`.

What the test harness guarantees (`tests/determinism/`):

- **Golden frames**: sha256 of raw RGBA at 10 / 50 / 90 % of five examples,
  keyed by platform (`darwin-arm64`, `linux-x64` captured on CI).
- **Bit-exact MP4**: the same composition rendered twice in one process
  (single-stage, with audio, with a custom font) produces byte-identical
  files (`-fflags +bitexact`).
- **Node ↔ browser parity**: mean per-channel RGB difference < 6 against
  headless Chromium (tolerance-based, not bit-exact).

Not guaranteed: cross-platform pixel identity, byte identity across ffmpeg or
skia-canvas versions, browser/node bit-exactness.

---

## Known limitations

Things v1.0 does not do. Each is either an open ledger item in
[`BUGS.md`](./BUGS.md) or a documented design boundary.

**Video items (b-roll)**

- **Frames are pre-scaled to the item box, so `fit` has no effect.** A clip
  whose aspect ratio differs from its `width × height` box is stretched,
  even with `fit: "contain"` or `"cover"`. Keep the box at the source's
  aspect ratio until this is fixed.
- Video items are **not drawn** in the browser preview, the editor stage, or
  `render_preview_frame` / `render_thumbnail_strip`; only a full render
  composites them.
- All extracted frames are decoded into memory before encoding; a 30 s
  full-frame 1080p clip is ~900 bitmaps. Watch RAM on small machines.
- A video item's own audio is always dropped. Register the sound separately
  as an `audio` asset if you need it.

**Output**

- MP4 only in practice (H.264 / H.265, `yuv420p`). No alpha / transparent
  export, no ProRes, no WebM, no PNG-sequence export, no time-range render.
- No colour-space tags are written; output is untagged `yuv420p`.
- Fractional frame rates are decimal (`29.97`), not rational (`30000/1001`).
- Odd `width`/`height` fail inside ffmpeg (`E_RENDER_FAILED`) rather than at
  validation. Use even dimensions.
- Audio is always stereo AAC-LC 48 kHz 192 kb/s; overlapping tracks are
  summed without a limiter.

**Authoring**

- Text is single-line, single-style: no wrapping, multiline, letter-spacing,
  line-height, stroke or shadow (`TEXT_V2_DESIGN.md`).
- No cubic-bezier or custom easings; no visual effects (blur, glow, shadow).
- Group opacity multiplies into children rather than compositing the group
  as one layer (overlapping children show through).
- Template params are whole-string substitution only; no arithmetic or
  `$repeat` (`REPEAT_EXPRESSIONS_DESIGN.md`).
- `define_user_behavior` is catalog metadata only; user behaviors cannot be
  expanded. Scene `clip` mapping throws on tweens that straddle the boundary
  instead of trimming; `reverse` is not implemented.
- The composition schema is not strict: unknown keys are silently dropped
  rather than reported (R-23).
- Fonts are not bundled; a standalone MCP session must `register_asset` a
  font before `add_text` (R-30).

**Editor**

- Video items show a static thumbnail in the Inspector but not on the stage.
- No keyframe curve editor, no timeline zoom, no arrow-key nudge, no
  polygon tool; the source drawer is read-only.
- External edits to `composition.json` are not watched.
- Reveal in Finder / QuickTime are macOS-only.
- In dev mode (`bun run cli -- edit`), a stray `bin/server.js` can outlive
  the session (bug 2.2); the packaged path is unaffected.

**MCP standalone server**

- One process, one store: state persists across conversations until `reset`
  (R-29). `reset` does not clear user-defined templates / scenes / behaviors.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `E_RENDER_FAILED` with `height not divisible by 2` in `stderrTail` | Odd composition dimensions with `yuv420p` | Use even `width` / `height` |
| Footage looks stretched | Video item box aspect ≠ source aspect (see Known limitations) | Match the box to the source aspect ratio |
| Video item invisible in the editor / preview PNG | Preview paths have no video frame provider | Render to MP4 to see it |
| `dyld: Library not loaded: libx265…` when ffmpeg starts | Broken Homebrew ffmpeg being used as `ffmpegPath` | Drop `ffmpegPath` to use bundled `ffmpeg-static`, or `brew reinstall ffmpeg x265` |
| `EPIPE: broken pipe, send` from `renderToFile` | ffmpeg crashed | Inspect the thrown error's `message` for the stderr tail |
| MP4 doesn't play in the browser inline | Missing faststart atom (node API default is off) | Pass `movflagsFaststart: true` to `renderToFile` |
| `tools list is empty` in your MCP client | The Davidup subprocess didn't start | Run `bun run src/mcp/bin.ts` (or `node dist/mcp/bin.js`) manually — anything on stderr is the real error. Use absolute paths in the config |
| `skia-canvas` install fails | Native build prerequisites missing | macOS: `xcode-select --install`. Linux: install `build-essential` + `libcairo2-dev` |
| `davidup` / `davidup-mcp` command not found or stale | `dist/` missing or out of date | `bun run build` (and `bun link --force` if bin paths moved) |
| Editor's Library panel is empty | Global library not seeded | `bun run seed:library` |
| Agent gets `E_FEATURE_UNAVAILABLE` from `list_library` / `current_project` / `get_render` | Tool requires the editor host | Use the tool from inside `davidup edit`, or inject `LibraryControls` / `ProjectControls` / `RenderControls` when calling `createServer()` |
| Agent's new composition already has items from a previous chat | Standalone server state persisted (R-29) | Call `reset` first |
| Tests time out on `registerAsset*` under full load | First ffprobe spawn on a saturated CPU exceeds the 5 s test timeout | Re-run; they pass in isolation in < 300 ms |

More agent-side troubleshooting: [`examples/mcp-demo.md` §7](./examples/mcp-demo.md).

---

## Repo layout

```
src/
  schema/         Zod schemas + validator + tweenable lookup     (design-doc §3, §3.5)
  easings/        19 named easings + lookup helpers              (§3.4)
  color/          hex / rgba parser + RGB lerp                    (§3.3)
  engine/         computeStateAt, renderFrame, drawItem,          (§5.1–5.4)
                  computeFitRects, MCP_ERROR_CODES, MCPToolError,
                  source-map types
  assets/         AssetLoader interface + browser/node impls      (§5.5)
  compose/        precompile pipeline:                            (§8.x)
                    behaviors / templates / scenes / params /
                    imports / jsonPointer / builtInTemplates
  drivers/
    node/         renderToFile via skia-canvas + ffmpeg,          (§5.6, §6)
                  video pre-extraction cache, audio mux, ffprobe
    browser/      attach() — RAF preview + pick + bounds + source (§5.6)
  mcp/            server + 58 tools + in-memory store + bin       (§4)
  cli/            bin + commands (new / edit / render / list) + scaffold templates

apps/
  editor/         AdonisJS + Inertia + Vue editor (v1.0)

scripts/
  seed-global-library.ts   curated starter pack for ~/.davidup/library
  build-editor.mjs         builds editor-dist/ with a vendored davidup copy
  copy-templates.mjs       copies CLI scaffold templates into dist/
  regenerate-goldens.ts    rewrites this platform's golden frame hashes
  eval-agents/             nightly agent benchmark (10 briefs, needs ANTHROPIC_API_KEY)

tests/            Vitest unit + integration tests: schema, engine, compose,
                  drivers (real ffmpeg), mcp, cli, determinism, e2e editor smoke
examples/         hello-world + browser demos + video samples + MCP transcript
                  + editor demo + launch video
dist/, editor-dist/   build outputs (committed for the packaged CLI path)

design-doc.md            Spec (live document)
ARCHITECTURE.md          High-level architecture
COMPOSITION_PRIMITIVES.md Primitive-level design notes
BUGS.md / FIXED_BUGS.md  Defect ledger with R-numbers from DAVIDUP_V1_REVIEW.md
CHANGELOG.md             Pixel-changing expansion bumps
TEXT_V2_DESIGN.md, REPEAT_EXPRESSIONS_DESIGN.md   v1.1 designs (no code yet)
server.json              MCP server manifest
.mcp.json                Repo-local MCP client config
```

CI (`.github/workflows/ci.yml`) runs root typecheck + the full vitest suite
(including ffmpeg integration, determinism, and the editor smoke test) and
the editor's `vue-tsc` + `ace test` on every push. `eval-nightly.yml` runs
the agent benchmark nightly; it is informational, not a gate.

---

## Roadmap

Shipped in v1.0:

- **Editor** (AdonisJS + Inertia + Vue, end-to-end command bus, timeline,
  render queue, library, undo/redo).
- **Headless CLI** (`davidup new` / `render` / `edit` / `list`) with a
  Node-only packaged path (`npm pack` → works without Bun).
- Video items (`add_video` / `update_video`): trim, fit, loop,
  freeze-on-last-frame, picture-in-picture, cached frame extraction.
- Audio tracks (`add_audio_track` …): timeline placement, in-source
  `trimIn`, volume, fades, mixed to AAC.
- Scene primitives (definition, instances, `identity` / `clip` / `loop` /
  `timeScale`), templates (5 built-in + 11 library), behaviors (11 built-in).
- `$ref` imports + JSON-pointer evaluation; source-map emission.
- Engine discovery tools, structured errors, `visible` / `locked` / `name` /
  `enter` / `exit` flags.
- Determinism harness (golden frames, bit-exact MP4, node ↔ browser parity)
  and a nightly agent-eval benchmark.

Planned for v1.1 (designs written, no code yet):

- Text v2 — wrapping, multiline, letter-spacing, line-height, stroke, shadow
  (`TEXT_V2_DESIGN.md`).
- `$repeat` + expressions in templates (`REPEAT_EXPRESSIONS_DESIGN.md`).
- Strict schema (R-23), per-session MCP state (R-29), bundled starter font
  (R-30), editable source drawer, template round-trip edits.

Still open beyond that: cubic-bezier easings, frame-range parallelization,
visual effects (blur, glow, drop shadow), alpha / ProRes export, video
frames in the live preview. Full discussion: [`design-doc.md` §8](./design-doc.md).

---

## Contributing

- Schema or tool changes must land in `design-doc.md` first.
- Every new tool gets exhaustive coverage in `tests/mcp/` (success path,
  every error code, idempotency check).
- Any change that alters rendered pixels bumps the relevant
  `*_EXPANSION_VERSION`, gets a `CHANGELOG.md` entry, and regenerates the
  goldens (`bun run regenerate:goldens`).
- The integration test (`tests/drivers/node.integration.test.ts`) is the
  end-to-end smoke check — keep it green.
- `server.json`'s tool list and the tool count cited in this README and
  `examples/mcp-demo.md` must stay in lockstep with `TOOL_NAMES` — the
  `tests/mcp/manifest.test.ts` enforces both.
- After engine changes, run `bun install` again before working in
  `apps/editor`: the editor compiles against a snapshot of the workspace
  package, not a live symlink.

```bash
bun run typecheck && bun run test
```

is the gate.

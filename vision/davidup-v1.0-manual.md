
---
doc_type: analysis
doc_title: davidup v1.0 — Manual & Evaluation
version: 1.0
date: 2026-05-19
author_email: narcis75@gmail.com
companion_to: davidup-v1.0-editor-prd.md
sections:
  - tldr — single-paragraph TL;DR and verdict
  - stats — headline numbers (LOC, tools, behaviors, templates, easings, tests)
  - architecture — three-layer diagram and what each layer is responsible for
  - getting-started — install, three hello-world flavors
  - editor — UI layout, daily workflows, keyboard shortcuts
  - authoring — items, layers, tweens, behaviors, templates, scenes, time-mapping
  - assets — upload pipeline, library scopes, thumbnails, MCP equivalents
  - rendering — UI flow, MCP flow, options, history, queue
  - mcp — 40+ tool surface, client wiring, worked Acme Coffee example
  - determinism — what is guaranteed and what is not
  - bugs — every notable finding with severity, location, fix
  - high-leverage — ordered improvements with the best impact-per-day
  - saas — readiness scorecard and security findings
  - roadmap — alpha and public-launch phase strips
  - verdict — final assessment
---

# davidup v1.0 — Manual & Evaluation

A deterministic 2-D programmatic video engine, an AdonisJS + Inertia + Vue editor that wraps it, and a 40+ tool MCP server that lets AI agents drive both — assessed end to end against its v1.0 scope and SaaS aspirations.

## TL;DR

**davidup is one engine, three surfaces.** The engine is a ~7.2k LOC TypeScript core: a Zod-validated composition schema, a pure resolver + Canvas2D renderer, a precompile pass that lowers authoring sugar (`$ref` / `$template` / `$behavior` / scene instances) to canonical JSON, and two drivers — a browser RAF previewer and a Node skia-canvas + ffmpeg recorder. The editor wraps that engine in a single-tenant local web app that funnels every mutation (Inspector, timeline, library drop, AI agent) through one command bus. The MCP server is the agent-facing surface: 40+ atomic tools, structured-error envelopes, validate-before-render enforcement, and an editor bridge that lets a human and an agent share the exact same composition byte-for-byte.

**v1.0 verdict.** Engine, editor, and MCP are production-quality for the documented v1.0 scope — a local-first, single-user, single-project desktop-style web app driven by either a human or an attached AI agent. The architecture is genuinely impressive: command bus + Zod-validated discriminated union shared by UI and MCP, debounced atomic persistence, in-memory canonical state, precompile source-map plumbed end-to-end through the inspector. SaaS-readiness, by deliberate scope choice, is essentially unstarted. Roughly 3 weeks of focused work would close the gap to a private alpha; 3–5 months to a public launch.

## Stats — by the numbers

- ~7,200 LOC engine core, 4 layers (schema / engine / compose / drivers)
- 40+ MCP tools (count is drifting: README says 25, server.json says 24, test asserts 44, workflows agent counted 41)
- 11 built-in behaviors: fadeIn, fadeOut, popIn, popOut, slideIn, slideOut, rotateSpin, kenburns, shake, colorCycle, pulse
- 5 built-in templates: titleCard, lowerThird, captionBurst, bulletList, kenburnsImage
- 19 named easings
- 4 scene time-mapping modes: identity, clip, loop, timeScale
- 26 stable MCP error codes
- 187+ engine tests including a real ffmpeg integration test; ~10 editor functional spec files pinning byte-equal UI ⇄ MCP invariants

## Architecture at a glance

davidup is a single repo with three deployable surfaces:

1. The engine (`src/`) — pure functions and drivers. `(composition, t, ctx) → pixels`. No global state in the resolver or renderer.
2. The MCP server (`src/mcp/`) — stdio JSON-RPC, registers a flat catalog of tools that mutate an in-memory `CompositionStore`. Standalone via `davidup-mcp`, or hosted inside the editor via `DAVIDUP_MCP_STDIO=1`.
3. The editor (`apps/editor/`) — AdonisJS 6 + Inertia 2 + Vue 3, one canonical in-memory composition per process, every mutation routed through `CommandBus.apply()` and persisted via a 500ms debounced atomic disk write.

Critical seam: the editor's MCP bridge (`apps/editor/app/services/mcp_bridge.ts`) intercepts every mutating MCP tool name and re-routes it through the same CommandBus the UI uses. This is what makes human ⇄ agent edits byte-equal — a property pinned by `tests/functional/command.spec.ts`.

## Getting started

### Install

- Bun ≥ 1.1 (Node ≥ 20 also works for most paths).
- `bun install` — pulls dev-deps including `ffmpeg-static` / `ffprobe-static` so the integration test renders without a system ffmpeg.
- `bun run typecheck` — `tsc --noEmit`, strict.
- `bun run test` — vitest; the suite includes `tests/drivers/node.integration.test.ts` which renders the §3.1 hello-world to MP4 and verifies it with ffprobe.

### Hello-world A — browser preview

```
bun run dev:browser
```

Opens `examples/browser-demo` on Vite. The page calls `attach(comp, canvas)` from `davidup/browser`. Variants: `dev:comprehensive`, `dev:comprehensive-split`, `dev:two-templates`, `dev:four-scenes`.

```ts
import { attach } from "davidup/browser";
const handle = await attach(comp, canvas);
// handle.stop(), handle.seek(seconds)
```

### Hello-world B — render to MP4

```
bun run examples/render.ts
```

```ts
import { renderToFile } from "davidup/node";
import { validate } from "davidup/schema";
if (!validate(comp).valid) throw new Error("invalid");
await renderToFile(comp, "out.mp4", { codec: "libx264", crf: 18 });
```

One `Canvas` reused across every frame, RGBA bytes piped to ffmpeg stdin with backpressure. ffmpeg stderr tail surfaces in any thrown `Error.message`.

### Hello-world C — drive it with an AI agent (MCP)

Wire the standalone MCP server into your client (`~/.claude.json` for Claude Code):

```jsonc
{ "mcpServers": { "davidup": { "command": "bun", "args": ["run", "/abs/path/to/davidup/src/mcp/bin.ts"] } } }
```

Then prompt: "Build a 3-second clip with a logo that fades in and pops in scale." The agent calls `create_composition` → `add_layer` → `add_shape` / `add_sprite` → `add_tween` / `apply_behavior` → `validate` → `render_preview_frame` → `render_to_video`. Full transcript: `examples/mcp-demo.md`.

## The editor — daily workflows

### Boot

`davidup edit <project-dir>` (or `npx davidup edit ./my-clip`). Flags: `--port=<n>` (default 3333), `--host=<h>`, `--no-open`. The CLI spawns the AdonisJS server with `DAVIDUP_PROJECT=<absolute dir>`, polls until reachable, opens the browser.

### Layout

Five-region CSS grid (top bar / library / stage / inspector / timeline / status bar):

- App bar — brand mark, project switcher dropdown, save-status pill (`Saved` / `Saving…` / `Error`), `RenderStrip`, help button.
- Library panel — Templates / Behaviors / Scenes / Assets / Fonts, plus Project / Global / All scope filter.
- Stage panel — engine canvas + selection-ring overlay + drop overlays.
- Inspector panel — typed property editor for the selected item or tween.
- Timeline panel — ruler + per-item tracks with colored tween bars + playhead.
- Status bar — error/warning pills, selection, playhead, stage status, render status.

### Keyboard shortcuts (`useShortcuts`)

| Keys | Action |
|---|---|
| Space | Toggle stage play/pause (restarts when ended) |
| Backspace | Delete selected item |
| ⌘0 / Ctrl+0 | Seek to t=0 |
| ⌘J / Ctrl+J | Toggle reveal-in-source drawer |
| ⌘R / Ctrl+R | Start a render |
| ⌘S / Ctrl+S | Force flush + `Saved` toast (autosave already runs) |
| ? | Toggle the Help overlay |
| Esc | Dismiss overlays, menus, the project switcher |

**Notable gap:** no `⌘Z` for undo. `CommandBus.undo()` exists server-side but no keyboard binding is wired. Single-line fix in `useShortcuts`.

### Project lifecycle

- Picker: GET `/` → `home.vue`. CTAs to open existing or create new; recents list.
- Open: POST `/api/project { directory }` → `ProjectStore#load(dir)` → `precompile` → `validate` → broadcast `changed` SSE on `/api/projects/events`.
- Create: POST `/api/projects { directory, name?, template? }` → `scaffoldProject` from the engine CLI → `ProjectStore#load`. Returns 201.
- Save: there is no manual save. Every command round-trips through `POST /api/command` → `CommandBus.apply` → `applyCommand` → engine MCP handler → validate → 500ms debounced atomic write to `composition.json`. `⌘S` is a UX affordance.
- External edits: the CLI installs a watcher that re-POSTs `/api/project` on disk changes; SSE drives cross-tab `router.reload()`.

## Authoring compositions

### Items, layers, tweens

Items: `sprite`, `text`, `shape` (rect / circle / polygon), `group`. Every item has a `transform` ({ x, y, scaleX, scaleY, rotation, anchorX, anchorY, opacity }) plus type-specific properties.

Layers: positive `z` (higher = on top). Stable-sorted with declaration order as tiebreaker. Engine support for layer `opacity` and `blendMode`.

Tweens: a single property animated from `from` to `to` over `[start, start+duration]` with an easing. Bucket-indexed by `(target, property)` and binary-walked at sample time — no per-frame sort. Overlap on the same `(target, property)` is rejected by `validate` with `E_TWEEN_OVERLAP`.

UI: drag a library card onto a Timeline track row to attach a behavior; drag onto the Stage to create an item with an `add_sprite` / `add_text` / `add_shape`. Drag a Timeline bar's body to move `start`, drag the left/right edges to resize. One `update_tween` per gesture, fired on pointerup.

### Behaviors (11 built-ins)

`apply_behavior { target, behavior, start, duration, params?, easing?, id? }`. Atomic — if any emitted tween conflicts, every tween from the call is rolled back.

| Behavior | Notes |
|---|---|
| fadeIn / fadeOut | opacity |
| popIn / popOut | scale ramp |
| slideIn / slideOut | parameterized by axis |
| rotateSpin | rotation |
| kenburns | combined position + scale |
| shake | bounded jitter (deterministic, no PRNG) |
| colorCycle | hue cycling |
| pulse | scale oscillation |

Discovery: `list_behaviors` returns descriptors with params + produced tween suffixes.

### Templates (5 built-ins)

`apply_template { templateId, layerId, start?, params?, id?, compositionId? }`. The five built-ins: `titleCard`, `lowerThird`, `captionBurst`, `bulletList`, `kenburnsImage`. Any `$behavior` block inside a template's `tweens` is expanded before being committed.

User templates: `define_user_template { id, description?, params?, items, tweens? }` registers a template on the global registry.

### Scenes + time-mapping

Scenes are sealed mini-compositions with their own `duration`, `items`, `tweens`, `params`, `assets`. The instance is expanded to a synthetic group + namespaced inner items + time-shifted tweens.

Time mapping on `add_scene_instance` / `update_scene_instance`:

- `{ mode: "identity" }` — baseline, default.
- `{ mode: "clip", fromTime, toTime }` — trim a sub-range.
- `{ mode: "loop", count }` — repeat back-to-back, count ≥ 1.
- `{ mode: "timeScale", scale }` — divide every tween's start / duration by `scale`.

End-to-end demo: `examples/time-mapping-mcp/` exercises all four modes via in-process MCP dispatch.

## Asset management

### Upload pipeline

Drop one or more files onto the Library panel or anywhere on the editor (page-level drag overlay). `POST /api/assets` multipart. Pipeline:

1. Reject non-supported extensions (png / jpg / jpeg / webp / gif / svg / mp4 / mov / webm / mkv / mp3 / wav / ogg / m4a / aac / flac); size cap 50 MB.
2. SHA-256 the bytes → name file `<hash><ext>`.
3. `ffprobe` / `loadImage` for metadata; generate thumbnail when applicable.
4. Register in destination library's `library/index.json` (project or global).

Hash dedup: re-uploading the same bytes is a no-op.

### Two-root library

- `<project>/library/` — per-project pool.
- `~/.davidup/library/` — global pool (override via `$DAVIDUP_LIBRARY`).
- Project wins over global on `(kind, id)` collisions; loser carries `overridden: true`.
- Watcher: `fs.watch` on `library/index.json` + `*.{behavior,template,scene}.json`; UI polls every 2s for cross-tab changes.

### MCP equivalents

- `register_asset { id, type, src, family? }` — fonts require `family`.
- `list_assets { compositionId? }` — declaration order.
- `remove_asset { id }` — errors `E_ASSET_IN_USE` if referenced.
- `list_library { q?, kind?, scope? }` — editor-only; returns merged project + global catalog with `thumbnailUrl` per item.

### Thumbnails

GET `/api/library/thumbnail?kind=<kind>&id=<id>` synthesizes a 0.5s preview frame; falls back to a deterministic placeholder PNG (`X-Thumbnail-Placeholder: 1`). Cards lazy-load via `IntersectionObserver` (80px rootMargin) and cache-bust by `lib.generation`.

## Rendering to MP4

### From the editor

`POST /api/renders { filename? }` → `RenderJob` constructed with the current snapshot of `projectStore.composition` → fire-and-forget `job.run()` → response with `{ jobId, totalFrames, outputPath, relativeOutputPath, eventsUrl }`. Output lands in `<project>/renders/`.

Browser subscribes to `GET /api/renders/:id/events` (SSE):

- `progress { jobId, frame, total, elapsedMs }`
- `done { jobId, outputPath, relativeOutputPath, frameCount, durationMs }`
- `error { jobId, message }`

One render at a time per UI (single-slot). The server registry can hold 32 jobs and replays the terminal state on late SSE subscribers.

### Render history

`RenderHistory.vue` collapses inside the `RenderStrip`. Lists `.mp4`s under `<project>/renders/`, newest first. macOS-only row actions: `Reveal` (`open -R <file>`) and `Play` (`open -a "QuickTime Player" <file>`). Direct video link opens `/project-renders/<filename>` in a new tab. Non-macOS gets 501 on the shell endpoint.

### From MCP

- `render_preview_frame { time, format? }` → `{ image (base64), mimeType, width, height }`. Validates first.
- `render_thumbnail_strip { count, format? }` → N uniformly-sampled frames + sample times. `count: 1` returns midpoint.
- `render_to_video { outputPath, codec?, crf?, preset?, pixFmt?, wait? }` — standalone is blocking; editor-hosted is async by default. `wait: true` blocks until completion.
- `get_render { jobId }` — editor-only; current snapshot.
- `list_renders {}` — editor-only; newest first; bounded retention.

ffmpeg options: codec `libx264` (default) or `libx265`; `crf` integer 0–63 (default 18); `preset`; `pixFmt`.

## AI agents via MCP

### Wiring clients

- **Claude Code:** edit `~/.claude.json`, add an entry under `mcpServers`. Use absolute paths.
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).
- **MCP Inspector:** `npx @modelcontextprotocol/inspector bun run src/mcp/bin.ts`.
- **Custom SDK client:** `@modelcontextprotocol/sdk` + `StdioClientTransport`.

**Editor-hosted (recommended for project work):** launch `davidup edit <dir>` with `DAVIDUP_MCP_STDIO=1`. Mutations route through the editor's CommandBus (`source: 'mcp'`); UI and agent see byte-identical state. The Inspector renders an "AI edit" pill on the most-recently-MCP-edited item.

### Tool catalog (grouped)

| Group | Tools |
|---|---|
| Composition lifecycle | `create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset` |
| Assets | `register_asset`, `list_assets`, `remove_asset` |
| Layers | `add_layer`, `update_layer`, `remove_layer` |
| Items | `add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item` |
| Tweens | `add_tween`, `update_tween`, `remove_tween`, `list_tweens` |
| Behaviors | `apply_behavior`, `list_behaviors` |
| Templates | `apply_template`, `list_templates`, `define_user_template` |
| Scenes | `define_scene`, `import_scene`, `list_scenes`, `remove_scene`, `add_scene_instance`, `update_scene_instance`, `remove_scene_instance` |
| Render | `render_preview_frame`, `render_thumbnail_strip`, `render_to_video`, `get_render`, `list_renders` |
| Project lifecycle (editor-only) | `current_project`, `list_projects`, `open_project`, `create_project` |
| Library (editor-only) | `list_library` |

### Error envelope

`MCPErrorBody` carries `code`, `message`, optional `hint`, plus `issues` / `warnings` arrays and a `details` bag. 26 stable codes including `E_NO_COMPOSITION`, `E_DUPLICATE_ID`, `E_NOT_FOUND`, `E_VALIDATION_FAILED`, `E_TWEEN_OVERLAP`, `E_ASSET_IN_USE`, `E_ASSET_TYPE_MISMATCH`, `E_ASSET_CONFLICT`, `E_LAYER_NOT_EMPTY`, `E_INVALID_PROPERTY`, `E_INVALID_VALUE`, `E_RENDER_FAILED`, `E_SCENE_UNKNOWN`, `E_UNKNOWN`. Editor adds `E_TIME_MAPPING_TWEEN_SPLIT`, `E_TARGET_NOT_EMPTY`, `E_TEMPLATE_NOT_FOUND`, `E_TEMPLATE_INVALID`, `E_PROJECT_NOT_FOUND`, `E_COMPOSITION_MISSING`, `E_FORBIDDEN_PATH`.

### Idempotency

Every `add_*` / `register_asset` accepts an optional `id`. Always supply one — retried calls return `E_DUPLICATE_ID` instead of silently duplicating, and transcripts replay deterministically.

### Worked example — 10-second Acme Coffee ad

```
create_composition { width: 1280, height: 720, fps: 60, duration: 10, background: "#0a0e27" }
add_layer { id: "bg", z: 0 }
add_layer { id: "fg", z: 10 }
register_asset { id: "logo", type: "image", src: "./assets/logo.png" }
apply_template { templateId: "titleCard", layerId: "fg",
                 params: { title: "Acme Coffee", subtitle: "Wake up." } }
add_sprite { layerId: "bg", asset: "logo", x: 640, y: 360,
             width: 400, height: 400, opacity: 0 }
apply_behavior { target: "<sprite-id>", behavior: "fadeIn",
                 start: 0, duration: 1.5 }
apply_behavior { target: "<sprite-id>", behavior: "kenburns",
                 start: 1.5, duration: 7 }
validate {}
render_preview_frame { time: 5 }
render_thumbnail_strip { count: 6 }
render_to_video { outputPath: "/abs/path/acme.mp4",
                  codec: "libx264", crf: 18 }
```

The agent gets six base64 PNGs, inspects them inline, patches anything wrong (cropped text, wrong color, mistimed pop), re-previews, then commits.

## Determinism — what is and isn't guaranteed

**Guaranteed within a single host.** `(composition, t) → ResolvedScene` is a pure function. No PRNG, no `Date.now()` in the engine itself (driver wall-clock helpers exist for RAF / progress, not for resolved state — render time on the node side is `i / fps`, not the clock). Stable-sorted iteration in every compose pass. `OVERLAP_EPS = 1e-6` documented inline in `src/schema/validator.ts:35` with a regression test.

**Bounded across hosts.** Pixels differ between browser Canvas2D and Node skia-canvas — they must: font hinting, sub-pixel AA, image decoders, and bezier rasterizers are all implementation-defined. README is upfront about this. The product positioning ("MP4 is ground truth, browser is preview") makes the trade acceptable. For byte-exact MP4 reproducibility you'd want a frame-hash assertion (the integration test only checks ffprobe metadata today) and a node ↔ browser pixel-parity SVG-only snapshot test — neither exists yet.

**Validation gaps that allow validate-then-crash at render time.** Three small fixes close the class:

- `LayerSchema.blendMode` is `z.string()` with no validation — host-divergent on invalid input.
- Color-tween endpoints aren't validated for parseability; `lerpColorString` will throw at render time if the user supplies `"magenta"`.
- `clampForProperty` only clamps `transform.opacity` — overshoot easings (`easeOutBack`) can drive `width` / `height` / `fontSize` negative, crashing some hosts on `arc(r, r, -5, ...)`.

## Bugs found

Compiled from the engine, MCP, editor, and SaaS audits. Severity reflects single-user local impact (SaaS-only criticality is called out under SaaS findings).

### Engine

- **HIGH** **E1** Layer `blendMode` is `z.string()` with zero validation. `src/schema/zod.ts:90`, applied at `src/engine/render.ts:150`. Invalid strings produce host-divergent behavior. Fix: `z.enum([...Canvas2DCompositeOps, "normal"])`.
- **HIGH** **E2** Sprite tint with semi-transparent PNGs double-multiplies alpha. `src/engine/render.ts:188-202`. The `destination-in` mask step applies the source image's alpha a second time after `globalAlpha * tr.opacity` already did. Fix: paint a `source-over` opaque fill onto a copy of the alpha channel rather than masking via `destination-in`.
- **MEDIUM** **E3** `seek()` past `duration` shows the last canvas state instead of holding the final frame. `src/drivers/browser/index.ts:288-300`. Fix: clamp `t` to `[0, duration]` inside `tick()` before the early-return.
- **MEDIUM** **E4** Color-tween endpoints not validated for parseability. `src/schema/validator.ts:209-217`. Composition validates, then `parseColor("magenta")` throws at render. Fix: run `parseColor` on color-kind tween `from`/`to`.
- **MEDIUM** **E5** `BaseAssetLoader.images`/`.fonts` Maps are unbounded. `src/assets/loader.ts:24-30`. Long-running editor sessions that switch projects retain previous assets until process exit. Fix: project-switch should call `loader.clear()`.
- **LOW-MED** **E6** Validator does not clamp negative width/height/fontSize/strokeWidth/cornerRadius from overshoot easings. `easeOutBack` past `to: 0` can crash some hosts on `arc(r, r, -5, ...)`. Fix: extend `clampForProperty`.
- **LOW** **E7** `MCPToolError` imported from `src/mcp/errors.js` inside `src/compose/scenes.ts:62` — a compose→mcp layer violation. Fix: extract to `engine/errors.ts` and re-export from `mcp/errors.ts`.
- **LOW** **E8** `setByPath` defensive fallback (`src/engine/resolver.ts:150-171`) is dead code given the current tweenable surface; either delete or guard against non-object intermediates.

### MCP

- **HIGH** **M1** Tool-count drift. README and `examples/mcp-demo.md` claim 25 tools; `server.json` claims 24; `tests/mcp/server.integration.test.ts:87` asserts 44. Trivially fixable; add CI to keep them in sync.
- **HIGH** **M2** `render_to_video` returns three different shapes — standalone-blocking, editor-async, editor-with-`wait:true`. The single least LLM-friendly surface. Fix: always return the async shape with `result: null | { ... }` populated by `wait:true`, or split into two tools.
- **HIGH** **M3** `import_scene` reads arbitrary filesystem paths with no sandboxing in either standalone or editor server. `src/mcp/tools.ts:1141-1192`. Fix: sandbox to `<project>/scenes/` (editor) or refuse unless `DAVIDUP_ALLOW_FS=1` (standalone).
- **HIGH** **M4** Template/scene/behavior registries are process-global module state (`src/compose/templates.ts`, `src/compose/scenes.ts`). Two MCP sessions on the same backend see each other's `define_user_template` mutations. Critical SaaS blocker.
- **MEDIUM** **M5** No `list_easings` / `list_fonts` / `list_engine_capabilities`. Agent must hit `E_INVALID_VALUE` to discover valid easing names.
- **MEDIUM** **M6** `render_preview_frame` and `render_thumbnail_strip` re-preload every asset on every call. `src/mcp/render.ts:80-87, 112-113`. For a comp with 20 PNGs + a font, this is the biggest agent-iteration latency cost. Fix: cache the `NodeAssetLoader` keyed by `comp.assets` content hash.
- **MEDIUM** **M7** Tool descriptions do not document coordinate convention (origin top-left), anchor (fractional 0..1), or rotation (radians vs degrees). Agents must read the design doc. Three sentences in each `add_*` description fixes it.
- **MEDIUM** **M8** `MCPLibraryItem.thumbnailUrl` returns `/api/library/thumbnail?...` — a relative URL agents have no base for. Fix: expose thumbnails as base64 inline or via MCP resources.
- **LOW** **M9** Tool description prose includes internal "polish §20.31" references. Wastes tokens in the schema.
- **LOW** **M10** `tools.ts:228, 240, 252` use `E_UNKNOWN` for "feature not available on this server". A dedicated `E_FEATURE_UNAVAILABLE` would let agents branch cleanly.
- **LOW** **M11** No `cancel_render` MCP tool. Worker supports `abort()`; surface it.
- **LOW** **M12** `MCPToolError.hint` is inconsistently populated. Hints are the single most valuable field for agent self-correction. Audit + populate.

### Editor

- **HIGH** **D1** `useStage` watcher snaps playhead to a stale wall-clock baseline after a paused-then-seek. `apps/editor/inertia/composables/useStage.ts:268-277`. Repro: pause, wait 5s, edit the inspector → playhead jumps forward 5s. Fix: when status is paused/stopped/ended, call `start({ resumeAt: playhead.value })` instead of `start({ resume: true })`.
- **HIGH** **D2** `/api/projects/events` SSE listener leak when the socket errors before `close` fires. `projects_controller.ts:199-247`. Over hours of dev reloads this trips `setMaxListeners(64)`. Fix: also bind `'error'` and `'finish'`.
- **MEDIUM** **D3** `useTimelineDrag.suppressNextClick` can swallow an unrelated click. `useTimelineDrag.ts:195-209`. Fix: scope to the bar element.
- **MEDIUM** **D4** Asset pipeline silently persists images when skia `loadImage` dim-probing fails. `asset_pipeline.ts:310-323`. The file is already moved by the time the probe runs; the index entry lacks `width`/`height`. Fix: roll back the move, or mark the entry with a warning.
- **MEDIUM** **D5** `renders_controller.shell` does case-sensitive prefix check on macOS HFS+ default case-insensitive filesystems. `renders_controller.ts:344-350`. Fix: normalize case before comparing, or use `path.relative` everywhere.
- **MEDIUM** **D6** Font upload is rejected by the assets controller ext list even though the pipeline supports it. Adding a font today requires hand-editing `library/index.json`.
- **LOW** **D7** `Timeline.vue` playhead line hard-codes the 160px ruler-gutter width. Should be a CSS variable.
- **LOW** **D8** `useLibraryDrag` doesn't re-validate `duration > 0` / `Number.isFinite` when reconstructing the payload from `dataTransfer` JSON.
- **LOW** **D9** `silent_auth_middleware.ts` is dead AdonisJS-starter code.

### SaaS-only (critical when hosted, irrelevant locally)

- **CRITICAL** **S1** No auth on any HTTP route. `auth` middleware is defined but applied to zero routes.
- **CRITICAL** **S2** SSRF via `asset.src`. `src/assets/node.ts:41-50` passes URLs straight to `skia.loadImage()`. Cloud metadata endpoints (`http://169.254.169.254/...`), internal services, file:// URIs — all reachable from a malicious composition. Fix: reject non-relative, non-`global:`, non-`data:` srcs in the validator and the MCP `register_asset` tool.
- **HIGH** **S3** `APP_KEY` literal `zKXHe-Ahdb7aPK1ylAJlRgTefktEaACi` is committed in `.env.example` and `.env`. Rotate, scrub history, add pre-commit secrets hook.
- **HIGH** **S4** CSRF disabled for all `/api/*` routes (`config/shield.ts:22`). Every mutating action bypasses CSRF.
- **HIGH** **S5** Path-guard at `project_paths.ts:33` blocks `/etc`/`/proc`/`/Library/Keychains` but not `~/.ssh` or `~/.aws`. Combined with unauthenticated `/project-files/*` you can exfiltrate from any project the service user can read.
- **HIGH** **S6** Render worker unbounded — no semaphore, no per-tenant queue, no timeout, no real cancel after start (`AbortSignal` not plumbed into `renderToFile`).
- **HIGH** **S7** Asset upload — no MIME magic-byte verification, no decompression-bomb cap, no AV. `skia.loadImage` happily decodes a 60000×60000 PNG and OOMs the process. Bodyparser cap (20MB) and controller cap (50MB) disagree.
- **HIGH** **S8** No rate limiting anywhere. `grep -r "rate\|throttle\|quota" apps/editor/` returns zero hits.
- **MEDIUM** **S9** `/project-files/*` and `/library-files/*` serve arbitrary files unauthenticated; SVGs served as `image/svg+xml` with no sanitization (stored-XSS surface).
- **MEDIUM** **S10** CSP disabled.

## High-leverage improvements

Ordered by impact per day. The top five are < 1 day each.

1. **Fix the tool-count drift.** Regenerate `server.json` from `TOOL_NAMES`, update README and `examples/mcp-demo.md`, add a CI assertion. Stops every new agent from being told the wrong capability set. **M1**
2. **Validate `blendMode` against a Canvas2D enum.** 5 lines in `zod.ts` + a unit test. Closes a real cross-host determinism vector. **E1**
3. **Clamp negative numeric tween outputs.** Extend `clampForProperty` to clamp `width` / `height` / `fontSize` / `strokeWidth` / `cornerRadius` to ≥ 0. 6 lines. Closes the overshoot-easing crash class. **E6**
4. **Validate color-tween endpoint parseability.** 10 lines in `validator.ts` to run `parseColor` over each color-kind tween's `from`/`to`. Closes the "validate-then-crash" gap. **E4**
5. **Wire ⌘Z to `commandBus.undo()`.** One-line shortcut. Full backend exists. **(undo-shortcut gap)**
6. **Document coordinate / anchor / rotation / easing conventions inline in tool descriptions.** Three sentences in each `add_*` tool description saves the agent from needing the design doc. **M7**
7. **Add `list_easings` (or attach `EASING_NAMES` to the `easing` field's `.describe()`).** 10-line discovery tool. **M5**
8. **Normalize `render_to_video` to one return shape.** Single biggest LLM-visible surface inconsistency. **M2**
9. **Sandbox `import_scene`** to `<project>/scenes/` in the editor; refuse in standalone unless `DAVIDUP_ALLOW_FS=1`. **M3**
10. **Cache `NodeAssetLoader` per composition** keyed by `comp.assets` content. Agent iterations compound — every preview is 5–10 image preloads today. **M6**
11. **Fix `useStage` watcher resume bug.** One conditional. **D1**
12. **Add Stage drag-to-move/resize for the selected item.** The picker + bounds-at-time machinery is already in place; `update_item` is already a supported command. Unlocks the "feels like a real editor" experience. **(polish gap)**
13. **Plumb codec/CRF/preset to `POST /api/renders`.** MCP can already pass them; the UI just needs the form. **(polish gap)**
14. **Add a `revision` field to the in-memory composition.** Reject commands whose base revision doesn't match. Keystone for any future multi-user. **(SaaS prep)**
15. **Add a `BlobStore` interface seam.** Local FS today, S3/R2 tomorrow. **(SaaS prep)**
16. **Fix sprite-tint-over-alpha.** Medium effort; needs a different approach to the multiply step. **E2**
17. **Make `BaseAssetLoader` LRU-capable.** 30 lines. Required for any long-running editor server hosting multiple projects. **E5**
18. **Scope template/scene/behavior registries to the store.** Multi-tenant SaaS blocker. **M4**

## SaaS-readiness scorecard

| Dimension | Stars | Verdict |
|---|---|---|
| Tenancy model | LOSE 0/5 | No tenant concept exists in code. Single-process, single-project, OS-user level. |
| Authentication | LOSE 1/5 | Adonis auth scaffolded (users table, scrypt, session guard). Zero login/register/logout routes; zero auth middleware on any HTTP route. |
| Authorization | LOSE 0/5 | No ownership check anywhere. |
| Asset storage | MEH 2/5 | Hash-named, idempotent, ext+size validated. No MIME magic-byte, no decompression-bomb cap, no AV, no S3, no per-tenant prefix. |
| Render pipeline | LOSE 1/5 | In-process, no queue, no concurrency limit, no per-tenant fairness, no meter, no timeout, no cancel after start. |
| MCP exposure | LOSE 1/5 | Stdio only, runs as the OS user. No auth, no rate limit, no scope. |
| Observability | LOSE 1/5 | Pino logs to stdout. No metrics, traces, Sentry, audit table, or request-id correlation. |
| Security headers | MEH 2.5/5 | XFO=DENY, HSTS, CSRF on session routes — but CSP disabled and `/api/*` exempt from CSRF. CORS origin = [] (deny). |
| Compliance / legal | LOSE 1/5 | No ToS, no privacy policy, no DPA, no data export, no delete-me, font-licensing unstated. |
| Deployment | LOSE 1/5 | `node ace serve` works locally. No Dockerfile, no CI workflow, no skia-canvas container build, APP_KEY committed. |

**Aggregate readiness for a hosted multi-tenant product: ~10%.** Engine and authoring surface are largely production-quality for a *local* tool; the SaaS-shell layer below is deliberately deferred to v2.0.

## Roadmap

### Private alpha (5–10 tenants, ~3 focused weeks)

| Phase | Items |
|---|---|
| Auth (1.5d) | Add `/login`, `/register`, `/logout` (magic-link is fine). Apply `auth` middleware to every `/api/*` route. |
| Tenancy (4d) | Add `Project` model + migration with `owner_user_id`. Refactor `projectStore` to a per-(user+project) cache. Tenant-scope `~/.davidup/`. |
| Hard fixes (2d) | Rotate `APP_KEY`, scrub history. SSRF fix on `asset.src`. Re-enable CSRF on `/api/*` or switch to bearer-token auth. |
| Render safety (1d) | `pLimit(2)` per process. `RENDER_TIMEOUT_MS` default 10min. Reject with 503 when full. |
| Quota + uploads (1.5d) | Per-tenant disk quota. `file-type` magic-byte sniff. Reject `loadImage` results > 64MP. |
| Metering (3d) | `usage_events` table. Writers in render worker + asset pipeline + MCP router. Stripe Meter wiring. |
| Ops (2d) | Sentry hook + request-id middleware. Privacy / ToS pages. Dockerfile. Hetzner CX32 + Coolify. Healthchecks.io alert. |

### Public launch (1000+ tenants, ~3–5 months)

| Phase | Items |
|---|---|
| Web ↔ render split | BullMQ + Redis. Separate `editor-web` and `render-worker` deploys. SSE proxied from worker via Redis pub/sub. |
| Object storage | Abstract asset pipeline + composition writer + render writer over a `BlobStore`. R2 / S3 in prod. Presigned download URLs. |
| Postgres migration | Lucid supports both; exercise the upgrade on a snapshot. Per-tenant connection pooling. |
| Library in DB | Replace per-project `library/index.json` + fs.watch with DB rows; cluster can't share a filesystem. |
| Sessions in Redis | Switch session driver from `cookie` to `redis`. |
| Hosted MCP | MCP-over-HTTP-SSE per tenant with bearer-token auth. The keystone differentiator. |
| Rate + WAF | `@adonisjs/limiter` on every mutating endpoint + per-tenant render-minutes guardrails. Cloudflare WAF. |
| Compliance | GDPR data-export and delete-me flows. DMCA takedown form. C2PA provenance baked into rendered MP4s. AV scan on uploads. |
| Observability | Pino → Loki, OpenTelemetry traces → Tempo, Prometheus → Grafana. Per-tenant dashboards. |
| Hardening | CSP enforced. HSTS preload. HTTP/3 termination at edge. SOC2-readiness primitives (change log, access log, secrets rotation). |

### High-leverage single move

If only one thing can be done first, refactor `apps/editor/app/services/project_store.ts` and every importer of it into a tenant-aware façade. Don't add auth yet, don't add billing yet, don't add the Dockerfile yet. The store refactor is the keystone — every other SaaS-ification item is a brick that needs it to be in place. Once the store knows about tenants, the rest is straightforward.

## Verdict for v1.0

**The engine is one notch above "ships."** Schema, resolver, renderer, and asset loader are tight, well-tested, and unambiguously deterministic at the `(comp, t) → ResolvedScene` boundary. Three one-day fixes (blend-mode enum, color-tween parseability, numeric-property clamping) would close the validate-then-crash failure class.

**The MCP layer is the strongest part of the project.** Atomic, orthogonal, structured-error tools backed by a deterministic engine, with an editor bridge that proves human + agent edits can share one canonical state. What gates v1.0 quality here is consistency (the 25 → 44 count drift), discoverability (`list_easings`, `list_fonts`), and SaaS-readiness (registry isolation, fs sandboxing).

**The editor is shippable as a v1.0 local-first single-user app** and meaningfully impressive at that scale. The architectural skeleton is the right shape. Visible bugs are minor; none are corruption-class under the documented single-user workflow. Top polish items: undo shortcut, Stage drag, render presets UI, Linux/Windows reveal-in-finder parity.

**It is not a SaaS** — and trying to make it one without breaking it apart at the seams above (per-tenant state, real storage abstraction, signed asset URLs, render-as-queue, auth on every route, project access model in DB) would be a rewrite, not a port. The good news is the seams are already clean. A SaaS conversion is bounded engineering, not architectural surgery.

This is not "vibe-coded for a demo." The author knew they were building a single-user local tool and did so cleanly. The cost to close the SaaS gap is real but bounded — 3 weeks to alpha, 3–5 months to public launch, for one engineer. The dominant risk right now is premature platformification: build the alpha shell, ship to ten paying users, let their behavior pick the next ten items.

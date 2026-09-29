# Davidup — Architecture & Implementation Reference

> A deep, code-grounded tour of how Davidup works **as it stands today**.
> Written so a new developer can read this once, then navigate the codebase
> on their own and know *where* to look and *why* the code is shaped that
> way.
>
> Scope: every functional area currently in `src/`, with particular emphasis
> on (a) the **composability layer** (templates, scenes, behaviors, imports,
> params) and (b) the **dual rendering system** (browser Canvas2D / RAF and
> Node.js skia-canvas + ffmpeg).
>
> Companion docs: [`design-doc.md`](./design-doc.md) is the live spec;
> [`COMPOSITION_PRIMITIVES.md`](./COMPOSITION_PRIMITIVES.md) is the full
> composability spec; this document is the *implementation* view.

---

## 0. Table of Contents

1. [Mental model & key invariants](#1-mental-model--key-invariants)
2. [Repo layout](#2-repo-layout)
3. [Schema layer (`src/schema`)](#3-schema-layer-srcschema)
4. [Engine layer (`src/engine`)](#4-engine-layer-srcengine)
5. [Easings & color (`src/easings`, `src/color`)](#5-easings--color)
6. [Asset loading (`src/assets`)](#6-asset-loading-srcassets)
7. [The dual-driver system (`src/drivers`)](#7-the-dual-driver-system)
    - 7.1 [Shared `Canvas2DContext` contract](#71-shared-canvas2dcontext-contract)
    - 7.2 [Browser driver: `attach()` + RAF](#72-browser-driver-attach--raf)
    - 7.3 [Node driver: `renderToFile()` + ffmpeg](#73-node-driver-rendertofile--ffmpeg)
    - 7.4 [Symmetry & drift risks](#74-symmetry--drift-risks)
8. [The composability layer (`src/compose`)](#8-the-composability-layer)
    - 8.1 [Two-layer model](#81-the-two-layer-model)
    - 8.2 [Precompile pipeline](#82-the-precompile-pipeline)
    - 8.3 [JSON pointer & imports](#83-json-pointer--imports-ref)
    - 8.4 [Params](#84-params-token-substitution)
    - 8.5 [Templates](#85-templates)
    - 8.6 [Scenes](#86-scenes)
    - 8.7 [Behaviors](#87-behaviors)
9. [The MCP layer (`src/mcp`)](#9-the-mcp-layer)
10. [End-to-end data flow](#10-end-to-end-data-flow)
11. [Determinism guarantees](#11-determinism-guarantees)
12. [Glossary of error codes](#12-glossary-of-error-codes)
13. [Where to extend things](#13-where-to-extend-things)

---

## 1. Mental model & key invariants

Davidup is a **pure function**: `(composition, t) → pixels`. The same JSON,
sampled at the same time, produces the same image, in any host, every run.

Three layers separate concerns cleanly:

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Authored JSON (v0.2+)                                       │
 │  Templates, scenes, behaviors, $ref, params                  │
 └────────────────────────────┬─────────────────────────────────┘
                              │  precompile() — pure, deterministic
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  Canonical JSON (v0.1) — composition / assets /              │
 │  layers / items / tweens — engine input format               │
 └────────────────────────────┬─────────────────────────────────┘
                              │  computeStateAt(comp, t)
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  ResolvedScene — items with tweens applied at time t         │
 └────────────────────────────┬─────────────────────────────────┘
                              │  drawScene(scene, ctx, assets)
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  Canvas2DContext — host-specific (DOM or skia-canvas)        │
 └─────────────────────────────────────────────────────────────┘
```

The hard invariants that make this work:

- **The engine never touches I/O.** It takes a `Canvas2DContext` and an
  optional `AssetRegistry` from the host.
- **The resolver is pure.** No globals, no PRNG, no time-of-day reads.
- **Composability is compile-time only.** `$ref`, `$behavior`, `$template`,
  `type: "scene"` are all *lowered* to canonical primitives before the
  engine sees anything.
- **One Canvas API surface, two implementations.** Both browser and node
  drivers conform to `Canvas2DContext` declared in
  `src/engine/types.ts:6-46`.

---

## 2. Repo layout

```
src/
  schema/      Zod schemas + semantic validator (E_* error codes)
  engine/      computeStateAt, renderFrame, drawItem (Canvas2D pipeline)
  easings/     19 named easings, easings.net formulas
  color/       hex / rgba parser + linear-RGB lerp (no OKLab yet)
  assets/      BaseAssetLoader + BrowserAssetLoader + NodeAssetLoader,
               src schemes (asset: / global: / bundled:), library.ts
  drivers/
    browser/   attach(comp, canvas) → { stop, seek } — RAF loop
    node/      renderToFile(comp, outPath, opts) — skia-canvas + ffmpeg,
               videoExtract (decoded frames), audioMux (the sound track)
  compose/     templates, scenes, behaviors, imports, params, precompile
  mcp/         MCP server + tools catalog + in-memory store + dispatch,
               assets.ts (the asset library tools), hdf.ts (render_hdf_clip)
  cli/         `davidup` bin: render, edit, scaffold

assetlib/      the asset library: shelves, records, search, previews, the
               `asset` bin (plain ESM, zero deps; shared with handdrawn/)
assets/        the house shelf (catalogue.json + blobs/), shipped in the package
handdrawn/     the hand-drawn film package (hdf), a sibling program
apps/editor/   the visual editor (AdonisJS + Vue), `davidup edit`
tests/         vitest, including real MP4 integration tests
examples/      hello-world, render.ts, mcp-demo, browser-demo, four-scenes-60s
```

Subpath exports declared in `package.json`:

| Subpath              | Use for                                                  |
|----------------------|----------------------------------------------------------|
| `davidup/schema`     | parsing JSON, validating before render                   |
| `davidup/easings`    | the same easing math from custom code                    |
| `davidup/engine`     | sampling state at a time, custom drivers                 |
| `davidup/assets`     | custom asset loaders (CDN/S3/…)                          |
| `davidup/browser`    | live preview: `attach(comp, canvas) → { stop, seek }`    |
| `davidup/node`       | render MP4: `renderToFile(comp, outPath, opts)`          |
| `davidup/mcp`        | embed the MCP server; call handlers in-process from tests|
| `davidup/compose`    | `precompile` and the authoring passes                    |
| `davidup/assetlib`   | the asset library package (`assetlib/index.js`)          |

---

## 3. Schema layer (`src/schema`)

The schema is **Zod-first**: TypeScript types are inferred from Zod schemas,
not authored independently (`src/schema/types.ts`).

### 3.1 Composition shape (`src/schema/zod.ts`)

```ts
Composition = {                             // CompositionSchema
  version: string
  composition: {                            // CompositionMetaSchema
    width: int>0, height: int>0,
    fps: number>0 | "N/D",                  // FpsSchema: "30000/1001" is exact NTSC
    duration: ≥0,
    background: color | "transparent",      // transparent ⇒ alpha codecs keep alpha 0
    audioMaster?: { limiter?, targetLufs? },
    markers?: Marker[]                      // { t, name, source? } — cues, never drawn
  }
  assets:  Asset[]                          // image | font | audio | video (discriminated on `type`)
  layers:  Layer[]                          // { id, z, opacity, blendMode, items[] }
  items:   Record<string, Item>             // keyed by id; sprite|text|shape|group|video
  tweens:  Tween[]                          // { id, target, property, from, to,
                                            //   start, duration, easing? }
  audio?:  AudioTrack[]                     // { asset, start, end?, trimIn?, volume?,
                                            //   fadeIn?, fadeOut?, loop?, markers? }
}
```

**Assets are four types** (`AssetSchema`, a `z.discriminatedUnion("type")`).
Every one is `{ id, type, src }` plus its own fields, and any of them may
carry `credit` (the attribution line) and `licence` (`ASSET_LICENCES`:
`CC0 | CC-BY | CC-BY-SA | OFL | PD | own | unknown`, the same list as the
asset library's `LICENCES`; a CC-BY or CC-BY-SA asset with no credit is
`W_ASSET_CREDIT`).

| Type    | Schema             | Own fields                                                           | Used by |
|---------|--------------------|----------------------------------------------------------------------|---------|
| `image` | `ImageAssetSchema` | `sheet?` (`SpriteSheetSchema`: frameWidth, frameHeight, columns, count, fps, cycles, anchor) | sprite items |
| `font`  | `FontAssetSchema`  | `family` (required: the name `ctx.font` asks for)                    | text items |
| `audio` | `AudioAssetSchema` | `duration? sampleRate? channels? codec?` (ffprobe, at `register_asset`) | `audio[]` tracks |
| `video` | `VideoAssetSchema` | `duration? width? height? fps? fpsRational? hasAlpha? codec? pixelFormat? hasAudio?` | video items |

`src` is a string the *host* resolves; the engine never reads it (§6). It
is one of: a path (absolute, or relative: the render CLI and the editor
resolve it against the composition's directory), a URL or `data:` URI,
`asset:<id>[@<sha12>]` (a record of the asset library),
`global:<path>` (a file under the legacy global pool `~/.davidup/library`),
or `bundled:<file>` (a font the package ships). `register_asset` and the
store admit an audio or video path only with one of
`AUDIO_ASSET_EXTENSIONS` / `VIDEO_ASSET_EXTENSIONS`; an `asset:` src is
checked against the record's kind and extension instead. There is no library field on an asset: a
library reference *is* the src, so the render contract is the same for a
file on disk and a record on a shelf.

Each `Item` carries a `Transform`:

```ts
Transform = {
  x: number, y: number,
  scaleX: number, scaleY: number,
  rotation: number,            // radians
  anchorX: number, anchorY: number,   // [0,1], fraction of the item's box
                                      // (a group's box is its own width/height,
                                      //  absent ⇒ the anchor is inert)
  opacity: number              // [0,1]
}
```

and the shared flags (`ItemFlagsSchema`): `visible? locked? name? enter?
exit? effects?` (blur / shadow / glow).

Item variants and their unique properties:

| Type    | Extra fields                                                  |
|---------|---------------------------------------------------------------|
| sprite  | `asset` (image-asset id), `width`, `height`, `tint?`; on a sheet `cycle?` / `frame?` |
| text    | `text`, `font` (font-asset id, or `font:default`), `fontSize`, `color`, `align?`, text v2 (`maxWidth lineHeight letterSpacing fontWeight fontStyle strokeColor strokeWidth shadow`) |
| shape   | `kind: "rect"|"circle"|"polygon"`, width, height, points, fill/stroke, cornerRadius |
| group   | `items: string[]` — child ids; rendered with transform composition; optional `width`/`height` = the anchor box (a pivot only — never clips); `isolate?`, `blendMode?` |
| video   | `asset` (video-asset id), `width`, `height`, `start`, `end?`, `trimIn?`, `trimOut?`, `fit` (`cover|contain|fill|none`), `loop`, `keepAudio?` |

### 3.2 Tweenable properties (`src/schema/tweenable.ts`)

A property is tweenable only if the `(itemType, path)` pair is in the table.
The validator rejects any `add_tween` against a non-tweenable property with
`E_PROPERTY_INVALID`.

```ts
// Common to every item type:
transform.x, transform.y, transform.scaleX, transform.scaleY,
transform.rotation, transform.opacity, transform.anchorX, transform.anchorY

// Sprite extras:    width, height, tint(color)
// Text extras:      fontSize, color(color)
// Shape extras:     width, height, fillColor(color), strokeColor(color),
//                   strokeWidth, cornerRadius
// Group extras:     width, height  (the anchor box, v1.3 L-3)
```

`getTweenable(type, path)` looks up via a precomputed
`Record<ItemType, Map<string, PropertyDescriptor>>` in O(1).

### 3.3 Semantic validator (`src/schema/validator.ts`)

```ts
validate(input: unknown): {
  valid: boolean
  errors:   ValidationError[]
  warnings: ValidationWarning[]
}
```

Two passes:

1. **Zod parse** → on failure, returns `E_SCHEMA`.
2. **Semantic checks** on the parsed value:
    - All `layer.items`, `group.items`, `tween.target` ids must exist → `E_ITEM_MISSING`.
    - `sprite.asset` must exist and be `type: "image"`; `text.font` must exist and be `type: "font"` → `E_ASSET_MISSING`.
    - Tween `property` must be tweenable on the item type → `E_PROPERTY_INVALID`.
    - `from` / `to` value kind must match the property descriptor (`number` vs `color`) → `E_VALUE_KIND`.
    - **No two tweens on the same `(target, property)` may overlap**.
      Overlap test uses a **1µs (1e-6 s) tolerance** to absorb IEEE-754
      drift on chained `start + duration` sums (validator line 35).
      Touching at endpoints is OK. → `E_TWEEN_OVERLAP`.
    - DFS on group containment hierarchy detects cycles, with a canonical
      cycle representation in the error → `E_GROUP_CYCLE`.
    - `tween.start + tween.duration > composition.duration` issues a
      **warning** (`W_TWEEN_TRUNCATED`), not an error.

---

## 4. Engine layer (`src/engine`)

Three files, all pure:

- `engine/types.ts`    — `Canvas2DContext`, `AssetRegistry`, `OffscreenSurface`, `RenderOptions`
- `engine/resolver.ts` — `computeStateAt(comp, t)`, `indexTweens(comp)`, `lerp()`
- `engine/render.ts`   — `renderFrame(comp, t, ctx, opts)`, `drawScene`, `drawItem`

### 4.1 Resolver (`src/engine/resolver.ts`)

**TweenIndex** — precomputed bucketed structure, reusable across frames:

```ts
indexTweens(comp): {
  buckets: ReadonlyMap<string, ReadonlyArray<Tween>>   // key = "${target}::${property}"
}
// Each bucket sorted by tween.start.
```

`computeStateAt(comp, t, index?)` resolves each bucket independently:

```
if no tween yet (t < first.start)   → first.from
inside an active tween               → lerp(active.from, active.to, easing(progress))
between two tweens on same property  → hold most recent .to value
after last tween ends                → last.to
property has no tween                → base item value (unmodified)
```

Implementation notes:

- Items are **shallow-cloned** (`cloneItem` ~line 133) before mutation.
  `transform` is always re-cloned per frame so resolver writes don't leak.
- Property paths are dot-notated: `"transform.x"`, `"color"`, `"tint"`.
  `setByPath` handles one level of nesting today; multi-level is supported
  defensively for future fields.
- `transform.opacity` is **clamped to [0,1]**. All other numerics pass
  through unchanged — including negative scale (mirrors are legal).
- Easings dispatch via `getEasing(name)`. `undefined → linear`.
- `lerp` is overloaded: `(number, number, t, "number") → number`,
  `(string, string, t, "color") → string` (via `lerpColorString`).

### 4.2 Renderer (`src/engine/render.ts`)

`renderFrame(comp, t, ctx, opts)` is the public entry. It:

1. Resolves the scene at `t` via `computeStateAt`.
2. Paints background: save → reset `globalAlpha=1`/`composite=source-over`
   → `fillRect` → restore. (This restore is important — keeps the
   background paint from contaminating layer opacity multiplication.)
3. Sorts layers by `z` ascending, **stable** — ties keep declaration order.
4. For each layer: save → multiply `globalAlpha` by layer opacity → set
   blend mode → draw each item → restore.

`drawItem(ctx, item, scene, assets, dc)` applies the transform stack:

```
save()
translate(tr.x, tr.y)
rotate(tr.rotation)               if non-zero
scale(tr.scaleX, tr.scaleY)       if non-identity
globalAlpha *= tr.opacity
translate(-tr.anchorX * w, -tr.anchorY * h)   // anchor offset
… type-specific draw …
restore()
```

For groups the recursive `drawGroupChildren` simply iterates `item.items[]`
and calls `drawItem` on each child. Canvas2D's save/restore stack composes
transforms automatically. `w`/`h` in the anchor line above come from
`anchorWidth`/`anchorHeight`: the declared box for sprite/video/shape, the
optional `width`/`height` for a group (v1.3, L-3), and 0 for anything that
declares none — text measures its own block inside `drawText`.

**Sprite tinting** is the most subtle bit. To tint without flattening
texture, the renderer uses an offscreen surface (`createOffscreen`
supplied by the driver):

```
offscreen.drawImage(image)                   // 1. paint texture
offscreen.compositeOp = "multiply"
offscreen.fillRect(tint)                     // 2. multiply with tint color
offscreen.compositeOp = "destination-in"
offscreen.drawImage(image)                   // 3. mask back to image alpha
main.drawImage(offscreen.source)
```

Identity tints (`#fff`, `#ffffff`, `white`, `rgb(255,255,255)`,
`rgba(255,255,255,1)`) skip the offscreen path. The check is cheap string
matching — false negatives cost an alloc but never corrupt output.

**Shape drawing**:

- `rect` — `cornerRadius > 0` triggers a hand-rolled rounded-rect path
  (Canvas2D has no native `roundRect`); radius is clamped to half-width/
  half-height.
- `circle` — `width` is **diameter**. The path is `arc(r, r, r, 0, 2π)`
  so anchor `(0.5, 0.5)` pivots around the geometric center.
- `polygon` — `points: [[x,y], ...]`; moveTo first, lineTo rest, closePath.
- `paintShape` applies fill (if `fillColor`), then stroke (if
  `strokeColor && strokeWidth > 0`).

**Text** uses `ctx.font = "${fontSize}px \"${family}\""` where `family`
is resolved through `AssetRegistry.getFontFamily(fontId)` (falling back to
the font id as a literal family name). `textBaseline` is hardcoded
`"alphabetic"` in v0.1.

### 4.3 The `Canvas2DContext` contract

Declared in `src/engine/types.ts:6-46`. The engine uses only this subset
of the Canvas2D API; *both* the DOM `CanvasRenderingContext2D` and
`skia-canvas`'s context satisfy it structurally — no adapter layer
needed. Method-level surface:

```ts
interface Canvas2DContext {
  save(); restore();
  translate(x, y); rotate(a); scale(x, y);
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string; strokeStyle: string; lineWidth: number;
  fillRect/strokeRect/clearRect(...);
  beginPath/closePath/moveTo/lineTo/arc/rect/fill/stroke();
  font: string; textAlign: string; textBaseline: string;
  fillText(text, x, y);
  drawImage(image: unknown, dx, dy, dw, dh);   // image is opaque (HTMLImage | skia Image)
}
```

---

## 5. Easings & color

### 5.1 Easings (`src/easings`)

19 named easings, all canonical easings.net formulas, plus two parametric
object forms (v1.1): `{ bezier: [x1, y1, x2, y2] }` (CSS cubic-bezier) and
`{ steps: n }` (CSS steps(n), jump-end). Hard invariant for each:
`f(0) === 0` and `f(1) === 1` (back-easings and overshooting beziers leave
[0, 1] in the middle but hit endpoints exactly). Default is `linear`.

```
linear
easeInQuad/Out/InOut          easeInCubic/Out/InOut
easeInQuart/Out/InOut         easeInBack/Out/InOut        (overshoots)
easeInSine/Out/InOut          easeInExpo/Out/InOut        (edge-cased at 0/1)
```

`getEasing(easing | undefined): (t: number) => number` is the only entry
point the resolver uses. `cubicBezier(x1, y1, x2, y2)` solves x(s) = t with
Newton–Raphson and a bisection fallback, the same method browsers use, with
only + − × ÷ so node and browser agree; the closed-form cube-root solution
would need `cbrt`/`acos`, whose last bits can differ between JS engines.
`steps(n)` is `floor(t·n)/n`. Nothing is cached: a closure is built per
call.

### 5.2 Color (`src/color`)

- `parseColor(input)` → `RGBA = { r:0-255, g:0-255, b:0-255, a:0-1 }`.
  Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r,g,b)`,
  `rgba(r,g,b,a)`. Throws on garbage.
- `formatColor(c)` → `"rgba(r, g, b, a)"` with channels clamped & rounded.
- `lerpColor(a, b, t)` is **linear-RGB**, not OKLab. (Design-doc Q2:
  open question whether to upgrade.)
- `lerpColorString(a, b, t) = formatColor(lerpColor(parseColor(a), parseColor(b), t))`.

---

## 6. Asset loading (`src/assets`)

The engine reads two things about assets, an image by id and a font family
by id (`AssetRegistry`). Where the bytes live is the host's business, and
it is decided by the asset's `src`.

### 6.0 Srcs and where they resolve

| `src`                  | Node (`resolveGlobalSrc`, `src/assets/node.ts`)                          | Browser (`BrowserAssetLoader`)                  |
|------------------------|---------------------------------------------------------------------------|-------------------------------------------------|
| `asset:<id>[@<sha12>]` | the record's blob on the first shelf holding `id` (`resolveLibraryAsset`, §6.3) | `/asset-files/<id>[@<sha12>]` (`assetBaseUrl`) |
| `global:<path>`        | `<root>/<path>`, root `$DAVIDUP_LIBRARY` else `~/.davidup/library`         | `/library-files/<path>`                         |
| `bundled:<file>`       | the package's `fonts/<file>` (`bundledFontsDir`; `font:default` is Inter) | `/bundled-fonts/<file>` (`bundledBaseUrl`)      |
| anything else          | unchanged: a path skia-canvas and ffmpeg open, or a URL                  | unchanged, or prefixed with `baseUrl` when relative |

`resolveAssetSrcAgainst(src, baseDir)` rewrites a *relative path* against
the composition's directory and leaves every `scheme:` src alone (B-5):
the render CLI (`src/cli/render.ts`) and the editor's render worker
(`apps/editor/app/workers/render_worker.ts`) call it before handing a
composition to the Node driver. The `/asset-files/`, `/library-files/`
and `/bundled-fonts/` routes are the editor's
(`apps/editor/start/routes.ts`); the editor also rewrites a project-relative
path to `/project-files/<path>` before the page sees it
(`rewriteAssetsForBrowser` in `apps/editor/app/controllers/editor_controller.ts`)
and leaves `asset:` srcs symbolic, because only the server knows the
shelves.

### 6.1 Loaders

```
AssetRegistry              ← engine reads from this (getImage, getFontFamily)
   ▲
AssetLoader extends AssetRegistry
   ▲                       ← adds load / preloadAll / has / clear
BaseAssetLoader            ← abstract; handles dedup, caching, inflight tracking
   ▲                ▲
BrowserAssetLoader  NodeAssetLoader
```

`BaseAssetLoader` (`src/assets/loader.ts`) owns:

- `images: Map<string, LoadedImage>` — `LoadedImage = unknown`. Engine
  passes whatever object is here straight to `ctx.drawImage(...)`.
- `fonts: Map<string, string>` — by id → family name.
- `inflight: Map<string, Promise<void>>` — concurrent loads of the same id
  share the same promise.

It loads `image` and `font` assets only. `audio` and `video` are not canvas
resources and are skipped: the Node driver decodes a video item's frames
through `src/drivers/node/videoExtract.ts` and mixes `audio[]` (and
`keepAudio` clips) through `src/drivers/node/audioMux.ts`, both resolving
the src with the same `resolveGlobalSrc`; the browser driver takes decoded
frames from an injected `VideoFrameProvider`. `withBundledAssets(comp)`
(`src/assets/bundled.ts`) adds the virtual `font:default` asset when a
text item uses it and the composition does not define that id.

Subclasses implement two methods:

```ts
protected abstract fetchImage(asset: ImageAsset): Promise<LoadedImage>;
protected abstract fetchFont(asset: FontAsset): Promise<string>;
```

`BrowserAssetLoader` (`src/assets/browser.ts`):

```ts
fetchImage → new Image(); img.crossOrigin = "anonymous"; img.onload/onerror; img.src = resolveUrl(src)
fetchFont  → new FontFace(family, `url("${resolveUrl(src)}")`); await face.load(); document.fonts.add(face)
```

Options: `baseUrl` (prefix for relative srcs), `bundledBaseUrl` (default
`/bundled-fonts/`), `assetBaseUrl` (default `/asset-files/`). An `asset:`
src is parsed (`parseAssetSrc`) before it is fetched, so a malformed ref
throws instead of 404ing. `clear()` also removes its faces from
`document.fonts`.

`NodeAssetLoader` (`src/assets/node.ts`):

```ts
fetchImage → skia.loadImage(resolveGlobalSrc(src, globalLibraryRoot, { project }))
fetchFont  → skia.FontLibrary.use(family, [resolved src])   // claim-counted per family
```

Options: `skiaCanvas` (inject a module, tests), `globalLibraryRoot`
(overrides `$DAVIDUP_LIBRARY` for `global:`), `project` (the directory
whose `assets/` shelf `asset:` srcs search first). skia-canvas is imported
lazily (`importSkiaCanvas`) so the module does not break browser builds
that happen to depth-import it. `renderToFile`'s `project` option is
threaded to the loader, `videoExtract` and `audioMux`.

### 6.2 `asset:` srcs (`src/assets/assetSrc.ts`)

```
asset:teapot                  the record `teapot`, wherever it now points
asset:teapot@611b2de0b430     only those bytes (12+ hex of its sha256)
```

`parseAssetSrc` is pure and browser-safe (`ASSET_SRC_PREFIX`,
`isAssetSrc`); the id follows the library's rule
(`/^(pack:)?[a-z0-9][a-z0-9-]*$/`). A pin is how a composition says "these
bytes": the render reproduces on any machine that holds the record, and a
record replaced under the same id fails loudly (`E_ASSET_STALE`) instead of
rendering something else. `use_asset` and a search hit's `use.davidup`
always pin.

### 6.3 The asset library (`assetlib/`, `src/assets/library.ts`)

The asset library is shared with the hand-drawn film package, so it lives
in its own zero-dependency, plain-ESM package at the repo root,
`assetlib/` (exported as `davidup/assetlib`; `assetlib/README.md` is its
reference, `docs/asset-library-plan.md` the design). In short:

- **A shelf is a directory**: `catalogue.json` (id → entry), `blobs/<sha256>.<ext>`,
  `thumbs/<sha256>.png`. No database, no daemon.
- **Three shelves, searched in order**: `project` (`<project>/assets`),
  `user` (`$DAVIDUP_ASSETS`, else `~/.davidup/assets`), `house`
  (`$DAVIDUP_HOUSE`, else the package's own `assets/`, which ships in the
  npm package). The same id on two shelves: the earlier wins, the record
  lists the others in `shadowed`.
- **A record** says what an asset is (`kind`, and the `media` derived from
  it), where it came from (`licence`, `credit`, `source`, and `made` when
  our own tools made it), what it is for (`name`, `desc`, `tags`) and what
  its bytes say (size, length, family, palette, `dark`, `room`). Kinds are
  davidup's four (`image video audio font`) and hdf's seven (`cutout clip
  puppet hand stock motif sample`).
- **Every search hit carries `use`**: `use.davidup` is the exact
  `register_asset` call (a pinned `asset:` src with the record's credit
  and licence), or null for a kind davidup cannot take.

davidup's side of it:

| Symbol (`src/assets/library.ts`) | Does |
|---|---|
| `openAssetLibrary({ project, env, home, previewers })` | the standard shelves (`standardShelves`), `project` first when there is one; `project` defaults to `$DAVIDUP_PROJECT` |
| `resolveLibraryAsset(src, opts)` | an `asset:` src → `{ path, record, shelf, root }`, or throws `AssetRefError` |
| `AssetRefError` | `code`: `E_ASSET_INVALID` (bad ref, unreadable shelf), `E_ASSET_MISSING` (no such id; names the shelves searched), `E_ASSET_STALE` (the pin is not the record's sha) |
| `assetProjectOf(dir)` | `dir` when it holds `assets/catalogue.json`: the render CLI takes the composition's directory as the project this way |

The shelves are read on every call: a catalogue is a few KB, and a
long-lived process (the editor, the MCP server) sees a record the moment
`asset add` writes it. Who names the project: the render CLI
(`assetProjectOf`, and `checkLibraryAssets` fails the render before the
first frame on a missing or stale record), the editor (its open project),
the MCP tools (the editor's project, else `$DAVIDUP_PROJECT`).

Validation stays pure: `validate(comp, { checkAssetFile })` takes the disk
check as a callback, and the MCP `validate` tool passes `assetFileProblem`
(`src/assets/node.ts`), so an `asset:` or `global:` src with nothing behind
it on this machine is a `W_ASSET_FILE_MISSING` warning there.

The other readers of the same shelves:

- **MCP** (`src/mcp/assets.ts`): `search_assets`, `get_asset`,
  `get_asset_preview`, `add_asset`, `tag_asset`, `use_asset`, and the
  library half of `list_library` / `get_library_thumbnail` (§9.4). They work
  on the standalone server. Previews come from the hosts `loadHosts()`
  finds (hdf's `handdrawn/cli/host.mjs` draws its seven kinds) plus
  davidup's own for `image` and `font` (`src/mcp/assetPreviews.ts`), else
  assetlib's card. `render_hdf_clip` puts what hdf made on a shelf with a
  `made` block (`putDerived`, `src/mcp/hdf.ts`).
- **The editor**: the Library panel's Assets and Fonts tabs list the
  records davidup can take (`apps/editor/app/services/library_shelves.ts`),
  uploads and promotes are `put` / `move` on a shelf
  (`apps/editor/app/services/asset_pipeline.ts`,
  `apps/editor/app/services/promote_library_item.ts`), and
  `/asset-files/*` serves blobs (`apps/editor/app/services/asset_files.ts`)
  from the three shelves' `blobs/` only.
- **The `asset` bin** (`assetlib/cli.js`, `VERBS`): `find show add tag
  desc rm mv gc facts thumb sheet ls check migrate remake export import`
  from a terminal.
- **hdf** (`handdrawn/core/assets.js`): `fromStore(ids)` reads the same
  records; `hdf find/import/remove/gc` are the `asset` verbs.

`global:` keeps working for files in the old `~/.davidup/library` pool;
nothing new writes it (`asset check --legacy` lists the files there that
are on no shelf, with the `asset add` line that moves each one over).

## 7. The dual-driver system

This is the defining architectural feature: **one composition runs
identically in the browser (live preview) and Node (MP4 render)**.

### 7.1 Shared `Canvas2DContext` contract

Both hosts provide a `Canvas2DContext` (see §4.3). The engine cares about
no host APIs beyond that interface — no DOM, no Node fs, no ffmpeg.

That's it. That's the trick. Everything below is "how each host produces
that ctx, when, and what it does with the bytes after".

### 7.2 Browser driver: `attach()` + RAF

`src/drivers/browser/index.ts`:

```ts
async function attach(
  comp: Composition,
  canvas: AttachableCanvas,
  options?: AttachOptions,
): Promise<{ stop(): void; seek(seconds: number): void }>
```

Lifecycle:

1. `canvas.getContext("2d")` → the host's `CanvasRenderingContext2D`.
2. `precompile(comp)` — lowers v0.2+ primitives. No-op for canonical v0.1.
3. `loader = options.loader ?? new BrowserAssetLoader()`.
4. `await loader.preloadAll(compiled.assets)` — images + fonts ready
   before first paint.
5. `tweenIndex = indexTweens(compiled)` — built once, reused for every
   frame.
6. **First paint synchronously** (avoid one-frame flicker before RAF kicks
   in).
7. Start RAF loop:
   ```ts
   const tick = () => {
     const t = (now() - startTime) / 1000;
     if (t > duration) return;                // stop scheduling; last frame holds
     renderFrame(compiled, t, ctx, { assets: loader, index: tweenIndex,
                                     createOffscreen });
     rafId = raf(tick);
   };
   ```

Clock is **wall-time-based**: `t = (now() - startTime) / 1000`. `seek(s)`
mutates `startTime` so the next tick computes `t = s`; if the loop had
finished (`t > duration`), seek re-primes the RAF. `stop()` flips a
`cancelled` flag and cancels any pending RAF.

`createOffscreen` defaults to a function that constructs a real off-DOM
`<canvas>` for sprite tinting; clients can override it. The RAF/clock
deps (`now`, `requestAnimationFrame`, `cancelAnimationFrame`) are all
injectable for tests.

### 7.3 Node driver: `renderToFile()` + ffmpeg

`src/drivers/node/index.ts`:

```ts
async function renderToFile(
  comp: Composition,
  outPath: string,
  opts?: RenderToFileOptions,
): Promise<{ frameCount: number; durationMs: number; outputPath: string }>
```

Lifecycle:

1. `precompile(comp)` — same as browser.
2. `skia = await importSkiaCanvas()` — dynamic import; module-level
   lazy load so browser bundles don't try to resolve it.
3. `loader = new NodeAssetLoader({ skiaCanvas: skia })`; `await loader.preloadAll(...)`.
4. **Allocate one Canvas** and reuse it across every frame (per
   design-doc §5.7 — avoids per-frame alloc cost). Same for the
   `tweenIndex`.
5. `totalFrames = Math.max(1, Math.ceil(duration * fps))` — always at
   least one frame.
6. Spawn ffmpeg with stdio: `["pipe", "pipe", "pipe"]`.
7. Capture stderr in a 4 KiB rolling tail (`STDERR_TAIL_BYTES`) — this
   tail is appended to the thrown `Error.message` if ffmpeg fails.
8. Frame loop:
   ```ts
   for (let i = 0; i < totalFrames; i++) {
     if (stdinErrored) throw stdinErrored;        // EPIPE bail-out
     const t = i / meta.fps;
     ctx.clearRect(0, 0, w, h);
     renderFrame(compiled, t, ctx, { assets: loader, index: tweenIndex });
     const raw = await Promise.resolve(canvas.toBuffer("raw"));   // RGBA bytes
     const ok = stdin.write(toNodeBuffer(raw));
     if (!ok) await waitForDrain(stdin);          // honor backpressure
   }
   ```
9. `stdin.end()`, `await waitForClose(ffmpeg)`; non-zero exit code →
   throw with stderr tail.

**ffmpeg argv** (`buildFfmpegArgs`):

```
ffmpeg -y
  -f rawvideo -pix_fmt rgba -s WxH -r FPS -i pipe:0    # input: raw RGBA from stdin
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p # output codec/quality
  [-movflags +faststart]                               # optional, for streaming
  outPath
```

Why these choices:

- `-pix_fmt rgba` on input: matches `canvas.toBuffer("raw")` byte order.
- `-pix_fmt yuv420p` on output: standard for H.264; needed by browsers/YT.
- `-crf 18`: visually transparent; 0–18 indistinguishable, 18–28 visibly
  compressed.
- `+faststart`: moves the MP4 `moov` atom to the file head so streaming
  players start before the full file downloads.

**Pixel format** — `canvas.toBuffer("raw")` is RGBA bytes in scan order,
no row padding (`stride = width * 4`), **not** premultiplied. Canvas2D
handles premultiplication internally during compositing and
un-premultiplies at export.

**Backpressure** — `stdin.write()` returns `false` when its internal
buffer (default ~16 KiB on Node) is full. We then `await once(stdin,
"drain")`. Without this, a slow encoder would balloon Node's outbound
buffer. With it, peak memory stays bounded.

**Known quirk** (README §Troubleshooting): `waitForClose` returns
`code ?? 0`; if ffmpeg is *signal-killed*, `code === null` is treated as
success. `examples/four-scenes-60s/render.ts` works around this by
checking output file size post-render. This is tracked as known issue;
fix lives in `src/drivers/node/index.ts`.

**ffmpeg binary** — caller supplies `opts.ffmpegPath`; default is the
string `"ffmpeg"` (relies on `$PATH`). The example resolves
`ffmpeg-static`'s exported path so CI works without a system install.

### 7.4 Symmetry & drift risks

What's guaranteed identical across hosts:

- **Tween math**: same `computeStateAt`, same easing curves.
- **Transform composition**: same `save/translate/rotate/scale/restore`
  sequence; Canvas2D semantics match across implementations.
- **Path geometry**: rect, circle, polygon, rounded-rect — pixel-shape is
  deterministic.

What can drift:

| Source              | Why                                                   | Mitigation                                |
|---------------------|-------------------------------------------------------|-------------------------------------------|
| Font glyph rendering| Browser uses OS font stack; skia uses bundled freetype| Bundle font files; embed via `FontAsset`  |
| Image decode        | Different decoders for jpeg/png/webp                  | Use PNG, same source bytes for both       |
| Anti-aliasing       | Subpixel rasterization differs                        | Accept; visible only at 1px scale         |
| Color management    | Both assume sRGB, no ICC profiles                     | Stay in CSS-color space                   |

The engine deliberately avoids `measureText`, image rescaling shortcuts,
or anything else that could amplify these differences.

---

## 8. The composability layer

> Composability is what makes Davidup tractable for both agents and humans.
> Without it, a 20-second clip is 1,300+ lines of flat JSON. With it,
> the same clip is ~300–500 lines across small files, plus reusable units.

### 8.1 The two-layer model

```
Authored JSON (v0.2+)            Canonical JSON (v0.1)
─────────────────────            ───────────────────────
$ref, $behavior,                 composition, assets,
$template, type:"scene",   ──►   layers, items, tweens
params, scenes registry          (engine input format)
```

**Authored** = what you write (or what an agent emits). **Canonical** =
what the engine consumes.

Every authoring construct **compiles away**. The engine never grew a new
opcode for templates, scenes, or behaviors. All complexity lives in pure,
testable compiler passes that lower to v0.1 primitives.

> Design principle (`COMPOSITION_PRIMITIVES.md` §2): **Compile, don't
> interpret.**

### 8.2 The precompile pipeline

`src/compose/precompile.ts:57-77` runs four passes in order:

```
authored JSON
    │
    ▼  resolveImports         — $ref → inlined values + spread support
    ▼  expandTemplates        — $template instances → items + tweens
    ▼  expandSceneInstances   — type:"scene" items → group + namespaced inner + shifted tweens
    ▼  expandBehaviors        — $behavior blocks → individual tweens
canonical JSON
```

Order is non-negotiable:

- Imports first — every later pass needs the inlined tree.
- Templates before scenes — scenes may contain template instances.
- Scenes before behaviors — scene-internal tweens may be `$behavior`s.
- Behaviors last — they expand to final `Tween` records.

**Short-circuit**: if input has no `$ref`/`$template`/`$behavior`/`type:"scene"`,
the precompiler returns input unchanged with near-zero overhead.

All passes are pure functions with sorted-key iteration and stable id
derivation — same authored input → byte-identical canonical output.

### 8.3 JSON pointer & imports (`$ref`)

`src/compose/jsonPointer.ts` implements an RFC 6901 subset:

- Empty pointer `""` → root.
- `/`-separated tokens descend into objects and arrays.
- Escapes: `~0` → `~`, `~1` → `/`, decoded in that order.
- Errors on missing keys, OOB indices, descent into non-containers.

`src/compose/imports.ts` (`resolveImports`):

```jsonc
{ "$ref": "./scenes/intro.json" }                       // inline whole file
{ "$ref": "./libs/transitions.json#/wipeLeft" }         // pointer into a file
```

Resolution rules:

- Relative refs resolve from the **containing file's** directory.
- Cycle detection on (file, pointer) chain → `E_REF_CYCLE`.
- File cache per compile pass (one parse per file).
- **Array spread**: if `$ref` is an array element and the target is an
  array, the elements are spliced in place:

  ```jsonc
  "tweens": [
    { "$ref": "./a.json#/tweens" },         // ← spreads if target is array
    { "id": "inline", "...": "..." }
  ]
  ```

`$ref` is **compile-time only**. The engine never sees it; the validator
never sees it. It is a JSON preprocessor — that's all.

### 8.4 Params: token substitution

`src/compose/params.ts:30-79`. **Whole-string** substitution only:

```
"${params.X}"   matches /^\$\{(params|\$)\.([A-Za-z_$][A-Za-z0-9_$]*)\}$/
"${$.X}"        reserved namespace for metadata (start, duration, …)
```

Partial substitution (`"Hello ${params.name}"`) is **not supported** in
the current release. Callers compute composite values (`barY = y + 80`)
before passing them as params. This keeps the param engine to ~50 lines —
no expression parser, no operator precedence.

Missing required params throw `E_*_PARAM_MISSING`; type mismatches throw
`E_*_PARAM_TYPE`. `(*)` is `BEHAVIOR`, `TEMPLATE`, or `SCENE` depending
on the call site.

### 8.5 Templates

A template is a **named, parameterized bundle of items + tweens**.

Definition (`src/compose/templates.ts:40-48`):

```ts
TemplateDefinition = {
  id: string
  description?: string
  params: TemplateParamDescriptor[]    // name, type, required?, default?
  items: Record<string, unknown>       // local ids, ${params.X} placeholders inside
  tweens: unknown[]                    // may still contain $behavior blocks
}
```

Instance (`src/compose/templates.ts:58-67`):

```ts
TemplateInstance = {
  template: string                     // references TemplateDefinition.id
  params?: Record<string, unknown>
  start?: number                       // global timeline offset
  layerId?: string                     // which layer hosts the expansion
}
```

**Expansion** (`expandTemplate`):

1. Look up template (user registry first, then built-ins).
2. Validate all required params, type-check each, fill defaults.
3. Substitute `${params.X}` (whole strings only).
4. Prefix every local item id with the instance id: `bar → myLowerThird__bar`.
5. Rewrite tween targets to use prefixed ids.
6. Shift `tween.start` into global time: `instance.start + local.start`.
7. Return expanded items + tweens (behaviors may still need expansion).

Templates are **eagerly precompiled**. The canonical output has no
template markers — agents can edit the expansion freely; round-tripping
edits back to template source is deferred to v1.1.

#### 8.5.1 Built-in templates

`src/compose/builtInTemplates.ts` registers five templates at module
load:

| Template       | Items                     | Tweens (behaviors)                | Use case                       |
|----------------|---------------------------|-----------------------------------|--------------------------------|
| `titleCard`    | title + subtitle text     | popIn + fadeIn                    | Centered headline + tagline    |
| `lowerThird`   | bar shape + name + role   | 2× fadeIn + 1 width tween         | Broadcast-style lower-third    |
| `captionBurst` | caption text              | popIn                             | Emphatic short phrase          |
| `bulletList`   | 3 text items (fixed)      | 3× fadeIn (staggered)             | Sequential bullet reveal       |
| `kenburnsImage`| sprite                    | fadeIn + kenburns                 | Image with slow zoom-and-pan   |

Each emits items at rest with `opacity: 0` and applies entry tweens. Arithmetic
on params (e.g., `y + 80`) is **resolved by the caller**, not in placeholder
strings — keeps templates declarative.

### 8.6 Scenes

A scene is a **self-contained mini-composition**: own duration, own
items, own tweens, own assets, own parameters. Conceptually equivalent
to After Effects' pre-comp.

Definition (`src/compose/scenes.ts:56-72`):

```ts
SceneDefinition = {
  id: string
  duration: number                     // scene-local timeline length
  size?: { width, height }             // informational (visual editor hint)
  background?: string                  // "transparent" or hex/rgba
  params: SceneParamDescriptor[]
  assets: Asset[]                      // merged into root composition.assets at compile
  items: Record<string, unknown>
  tweens: unknown[]
}
```

Instance — appears in the composition's `items` map as an item of
`type: "scene"`:

```ts
SceneInstance = {
  scene: string                        // references SceneDefinition.id
  params?: Record<string, unknown>
  start?: number                       // parent-timeline offset
  layerId?: string
  transform?: Partial<Transform>       // applied to the wrapper group
}
```

#### The expansion rule (the key trick)

When `expandSceneInstance` lowers a scene instance with id `intro` and
`start = 0`:

1. **Synthetic wrapper group**: the instance becomes a `type: "group"`
   item with the instance id (`intro`) and the parent-supplied transform.
2. **Inner items prefixed**: every scene item id is rewritten to
   `intro__X`. The wrapper group's `items[]` lists these prefixed ids.
3. **Inner tweens shifted**: each scene tween is cloned, its `target` is
   rewritten to use the prefixed id, and its `start` is shifted by
   `instance.start` (`scenes.ts:662-669`).
4. **Asset merge** into root `composition.assets`. Same id + same `src` →
   dedupe. Same id + **different** `src` → `E_ASSET_CONFLICT` (forces
   disambiguation; prevents silent shadowing).
5. **Background rect**: if the scene declares `background` and `size`, a
   full-bleed shape rect is added as the **first child** of the wrapper
   group (so it renders behind all scene contents).

After this lowering the composition is pure v0.1. The engine's group
recursion (`drawGroupChildren`) handles transform composition
automatically — moving, scaling, or fading the wrapper group cascades to
every inner item without any new engine code.

#### Time mapping

`SceneInstance.time` selects one of four shipped modes (validated and
applied in `src/compose/scenes.ts`):

- `identity` (default) — scene-local `t = 0` plays at `instance.start`;
  every scene tween shifts by the same delta.
- `clip { fromTime, toTime, strict? }` — plays the half-open scene-local
  window; tweens fully outside are dropped, and a tween straddling an edge is
  trimmed to the window with its `from`/`to` resampled through its own easing
  at the cut (`strict: true` rejects it with `E_TIME_MAPPING_TWEEN_SPLIT`
  instead, the pre-v4 behavior).
- `loop { count }` — plays the scene `count` times back-to-back, each
  iteration with deterministic `__loop${i}` id suffixes.
- `timeScale { scale }` — plays the scene at `scale×` speed (`scale > 0`).
- `reverse {}` — plays the scene backwards. A tween on `[s, s+d)` lands on
  `[duration − (s+d), duration − s)` with `from`/`to` swapped and its easing
  mirrored (`easeIn* ↔ easeOut*`, exact for every name and for
  cubic-bezier), so the motion retraces itself rather than replaying its
  acceleration backwards.

`clip` auto-trim and `reverse` need concrete `from`/`to` values, so both
lower the `$behavior` blocks they touch into literal tweens early, via the
same `expandBehavior` the later pass uses. Every other mode leaves blocks
alone. The wrapper group's default `enter`/`exit` spans the mode's effective
duration (see CHANGELOG "Expansion v3").

#### Sealed instances (§8.7)

The compiler **forbids parent-authored tweens from targeting
scene-internal ids**. Only the wrapper group (i.e., the instance id) is
addressable from outside:

```ts
if (allInternalIds.has(tween.target))
    throw new MCPToolError("E_SCENE_INSTANCE_DEEP_TARGET", ...)
```

This enforces encapsulation. Scenes define their own motion; parents
compose them as units. Variation goes through declared params, not deep
mutation.

#### Nested scenes & recursion guard

A scene's `items` may contain other scene instances. `expandSceneInstance`
recurses with a `chain` parameter; re-entering a scene id throws
`E_SCENE_RECURSION`. After full expansion, all nested tweens and inner
items are time-shifted together as a single flat composition.

### 8.7 Behaviors

A behavior is a **named, parameterized bundle of tweens** — motion macros.

Block syntax (`src/compose/behaviors.ts:48-63`):

```jsonc
{
  "$behavior": "popIn",
  "target": "logo",
  "start": 0.2,
  "duration": 0.6,
  "easing": "easeOutBack",
  "params": { "fromScale": 0, "toScale": 1 },
  "id": "logoPop"                     // optional — used as prefix for derived tween ids
}
```

Each behavior is a pure function `(ExpandContext) → RawTween[]`. The
expansion uses the **derived id prefix**:

```ts
deriveParentId(block) =
  block.id ?? `${block.target}_${block.behavior}_${block.start}`
```

The derived id is suffixed per output tween: e.g., `popIn` always emits
`<id>__opacity`, `<id>__scaleX`, `<id>__scaleY`. Stable, deterministic.

#### Built-in behaviors (11 total)

| Behavior       | Tweens emitted                       | Required params                          |
|----------------|--------------------------------------|------------------------------------------|
| `fadeIn`       | `opacity 0→1`                        | —                                        |
| `fadeOut`      | `opacity 1→0`                        | —                                        |
| `popIn`        | `opacity`, `scaleX`, `scaleY`        | —                                        |
| `popOut`       | `opacity`, `scaleX`, `scaleY` (rev)  | —                                        |
| `slideIn`      | `x` or `y`                           | `from`, optional `axis`                  |
| `slideOut`     | `x` or `y`                           | `to`, optional `axis`                    |
| `rotateSpin`   | `rotation`                           | optional `turns` (def 1)                 |
| `kenburns`     | position + scale                     | `fromScale`, `toScale`, `pan`            |
| `shake`        | 4·cycles short tweens                | `amplitude`, `cycles`                    |
| `colorCycle`   | N-1 tweens through color stops       | `colors[≥2]`                             |
| `pulse`        | scale-out then scale-in              | `peakScale`                              |

Behaviors **compose with** the validator's overlap check naturally:
parking `fadeIn` then `fadeOut` on the same target is fine because they
occupy disjoint time windows. Stacking two `shake`s with overlap is not —
`E_TWEEN_OVERLAP` will fire.

---

## 9. The MCP layer

`src/mcp/` exposes Davidup to AI agents via the Model Context Protocol.
The same handlers also work in-process for tests and tools.

### 9.1 Wire-up (`src/mcp/server.ts`)

```ts
createServer({ store?, name?, version?, depsFactory?, router?, sessionTtlSeconds?, log? })
  → registers every TOOL with @modelcontextprotocol/sdk
  → wires up the stdio transport
  → returns { mcp, store, start(), close() }
```

The CLI entry (`src/mcp/bin.ts`, the `davidup-mcp` bin) stays thin:

```ts
#!/usr/bin/env node
import { createServer, resolveSessionTtl } from "./server.js";
const sessionTtlSeconds = resolveSessionTtl(process.argv.slice(2), process.env);
await createServer({ sessionTtlSeconds }).start();
```

`--session-ttl <seconds>` (or `$DAVIDUP_SESSION_TTL`) resets all state
after that much idle time. The editor embeds the same server with a
`depsFactory` (a fresh store per call from the canonical document, plus
its `projectControls` / `libraryControls` / `renderControls`) and a
`router` that sends mutating tools through its CommandBus.

`server.json` is the MCP manifest; its `tools` array lists `TOOL_NAMES`
in order (`tests/mcp/manifest.test.ts` holds it, the README's tool count
and `examples/mcp-demo.md` to the catalog):

```json
{ "transport": { "type": "stdio" },
  "command": "bun", "args": ["run", "src/mcp/bin.ts"], "tools": [ ... ] }
```

Tool registration loops over `TOOLS` from `src/mcp/tools.ts`. Each
`ToolDef` carries a hand-written Zod input shape; the SDK uses it to
validate args before reaching the handler, and `dispatchTool` re-parses
it for in-process callers.

### 9.2 The store (`src/mcp/store.ts`)

A single in-memory `CompositionStore` supports **multiple compositions**
keyed by id. Whichever was created first becomes the `defaultId`; every
tool that takes `compositionId?` falls back to it.

Internal shape of one `MutableComposition`:

```ts
{
  id: string
  meta: { width, height, fps, duration, background }
  assets: Map<id, Asset>             // insertion-ordered (preserves authoring order)
  layers: Map<id, Layer>             // insertion-ordered
  items:  Map<id, Item>              // keyed by id; separate itemLayer map tracks ownership
  itemLayer: Map<itemId, layerId>
  tweens: Map<id, Tween>             // insertion-ordered
  sceneInstances: Map<instanceId, SceneInstanceRecord>   // for atomic rollback
  nextSeq: { layer, item, tween, comp, scene }           // monotonic id counters
}
```

Mutations are **immutable rebuilds** for values: `{ ...layer, z: newZ }`,
never in-place. Maps themselves are mutated for add/delete. This makes
rollback trivial — the `apply_template` / `add_scene_instance` /
`update_scene_instance` handlers snapshot before doing batched changes
and restore on any inner failure.

### 9.3 Dispatch & errors (`src/mcp/dispatch.ts`, `src/mcp/errors.ts`)

```ts
dispatchTool(tool, rawArgs, deps): Promise<
  | { ok: true,  result: unknown }                        // unwrapped handler return
  | { ok: false, error: { code, message, hint? } }
>
```

Validation is two-step: SDK-level (when called over JSON-RPC) and
dispatch-level (when called in-process). The dispatcher catches
`MCPToolError` (typed code + message) and converts to the error result;
unknown throws become `E_UNKNOWN`.

Stable error codes (see §12) — agents branch on `code`, not on
substring-matching `message`.

### 9.4 The full tool catalog

66 tools, in `TOOLS` order by group (see `src/mcp/tools.ts` for input
schemas and the full descriptions agents read). "Mutates" is the
composition store; *shelf* means the tool writes an asset library shelf on
disk; *editor* marks a tool that needs the editor to host the server and
answers `E_FEATURE_UNAVAILABLE` on the standalone `davidup mcp` server.

#### Composition lifecycle

| Tool                       | Mutates? | Purpose                                          |
|----------------------------|----------|--------------------------------------------------|
| `create_composition`       | yes      | New composition; first becomes default           |
| `get_composition`          | no       | Full JSON snapshot                               |
| `set_composition_property` | yes      | Patch width/height/fps/duration/background/audioMaster/markers |
| `validate`                 | no       | Run validator; errors + warnings (`W_ASSET_FILE_MISSING` for an `asset:`/`global:` src with no file here) |
| `reset`                    | yes      | Drop one composition, or all plus the session's templates/scenes/behaviors |
| `replace_composition`      | yes      | Swap the whole composition for a JSON document (authoring constructs expanded) |

#### Assets

| Tool             | Mutates? | Purpose                                            |
|------------------|----------|----------------------------------------------------|
| `register_asset` | yes      | Add an image, font, audio or video asset (ffprobe facts; an `asset:` src takes the record's facts; `replace: true` swaps in place) |
| `list_assets`    | no       | Enumerate, in declaration order, with credit and licence |
| `remove_asset`   | yes      | Unregister; `E_ASSET_IN_USE` if referenced         |

#### Layers

| Tool           | Mutates? | Purpose                                              |
|----------------|----------|------------------------------------------------------|
| `add_layer`    | yes      | Create layer with z, opacity, blendMode              |
| `update_layer` | yes      | Patch fields                                         |
| `remove_layer` | yes      | Delete; `E_LAYER_NOT_EMPTY` unless `cascade: true`   |

#### Items

| Tool                  | Mutates? | Purpose                                       |
|-----------------------|----------|-----------------------------------------------|
| `add_sprite`          | yes      | Image item (a sprite sheet plays a `cycle`)   |
| `add_text`            | yes      | Text item (`font` omitted ⇒ bundled `font:default`) |
| `add_shape`           | yes      | Vector shape (rect / circle / polygon)        |
| `add_group`           | yes      | Container for other items                     |
| `update_item`         | yes      | Patch type-aware fields                       |
| `move_item_to_layer`  | yes      | Move between layers                           |
| `remove_item`         | yes      | Delete + cascade tweens; detach from groups   |
| `add_video`           | yes      | Video clip item (trim, fit, loop, keepAudio)  |
| `update_video`        | yes      | Patch any field of a video item               |

#### Tweens

| Tool           | Mutates? | Purpose                                                |
|----------------|----------|--------------------------------------------------------|
| `add_tween`    | yes      | One tween; overlap-checked at add                      |
| `update_tween` | yes      | Patch + re-check overlap (self-excluded)               |
| `remove_tween` | yes      | Delete                                                 |
| `list_tweens`  | no       | Filter by target/property                              |

#### Audio

| Tool                 | Mutates? | Purpose                                            |
|----------------------|----------|----------------------------------------------------|
| `add_audio_track`    | yes      | Place a registered audio asset on the timeline     |
| `update_audio_track` | yes      | Patch a track (volume, fades, trim, loop, markers) |
| `remove_audio_track` | yes      | Delete a track                                     |
| `list_audio_tracks`  | no       | Enumerate, optionally by asset                     |

#### Behaviors (composability)

| Tool                   | Mutates? | Purpose                                                       |
|------------------------|----------|---------------------------------------------------------------|
| `apply_behavior`       | yes      | Expand a named behavior to tweens; atomic, rolls back on err  |
| `list_behaviors`       | no       | Built-ins, library behaviors and this session's               |
| `define_user_behavior` | yes      | Register a session-scoped behavior                            |

#### Templates (composability)

| Tool                    | Mutates? | Purpose                                                    |
|-------------------------|----------|------------------------------------------------------------|
| `apply_template`        | yes      | Instance a template — adds items+tweens atomically         |
| `list_templates`        | no       | Enumerate built-in + library + session templates           |
| `define_user_template`  | yes      | Register a session-scoped template (shadows a global id)   |
| `remove_user_template`  | yes      | Drop a session template                                    |

#### Scenes (composability)

| Tool                     | Mutates? | Purpose                                                                |
|--------------------------|----------|------------------------------------------------------------------------|
| `define_scene`           | yes      | Register a session-scoped scene                                        |
| `import_scene`           | yes      | Read scene JSON from file + register                                   |
| `list_scenes`            | no       | Enumerate                                                              |
| `remove_scene`           | yes      | Unregister (existing instances already lowered are not affected)       |
| `add_scene_instance`     | yes      | Place scene in composition; expands to group+inner+tweens+assets       |
| `update_scene_instance`  | yes      | Re-expand with new params/transform/start; rolls back on err           |
| `remove_scene_instance`  | yes      | Cleanup instance and its derived items/tweens/unused assets            |

#### Render (visual feedback for agents)

| Tool                     | Mutates? | Purpose                                                    |
|--------------------------|----------|------------------------------------------------------------|
| `render_preview_frame`   | no       | Single frame → MCP image content (PNG/JPEG)                |
| `render_thumbnail_strip` | no       | N uniformly-sampled frames (linspace; midpoint if N=1)     |
| `render_to_video`        | no¹      | Full clip or a `from`/`to` window → MP4 / MOV / WebM; queued in the editor, blocking standalone |
| `get_render`             | no       | *editor* — one render job's status, progress, result      |
| `list_renders`           | no       | *editor* — the render queue, newest first                  |
| `cancel_render`          | no       | *editor* — cancel a non-terminal job                       |
| `render_hdf_clip`        | yes, shelf | Render a hand-drawn film (hdf) and register it as a video (and sprite sheets); the clip goes on a shelf with a `made` block (needs `handdrawn/` beside davidup) |

¹ writes a file to disk; no store mutation.

#### Projects

| Tool              | Mutates? | Purpose                                              |
|-------------------|----------|------------------------------------------------------|
| `current_project` | no       | *editor* — the loaded project (root, paths)          |
| `list_projects`   | no       | *editor* — recently opened projects                  |
| `open_project`    | yes      | *editor* — load a project directory                  |
| `create_project`  | yes      | *editor* — scaffold a project from a template and load it |

#### Library

| Tool                    | Mutates? | Purpose                                                    |
|-------------------------|----------|------------------------------------------------------------|
| `list_library`          | no       | The editor's templates/behaviors/scenes/assets/fonts (*editor*) plus the asset library's records davidup can take as `asset`/`font` (standalone too) |
| `get_library_thumbnail` | no       | A PNG preview of one `list_library` item (asset/font records standalone too) |

#### Asset library (§6.3; all work standalone)

| Tool                | Mutates? | Purpose                                                    |
|---------------------|----------|------------------------------------------------------------|
| `search_assets`     | no       | Ranked, faceted search over the project, user and house shelves; every hit carries `use` |
| `get_asset`         | no       | One record in full: shelves, blob, thumb, `made.from` / `made.into`, `use` |
| `get_asset_preview` | no       | A record's preview, or a captioned contact sheet of several, as MCP image content |
| `add_asset`         | shelf    | Put a file on a shelf (hashed, probed, validated), or move a record between shelves |
| `tag_asset`         | shelf    | Edit tags, name, desc, credit, source, licence in place; bytes untouched |
| `use_asset`         | yes      | Register a record by its pinned `asset:` src and place it (sprite, video, audio track; a font is registered only) |

#### Discovery

| Tool                       | Mutates? | Purpose                                              |
|----------------------------|----------|------------------------------------------------------|
| `list_easings`             | no       | Named easings and the `{ bezier }` / `{ steps }` forms |
| `list_fonts`               | no       | The bundled `font:default`, the composition's fonts, the asset library's font records |
| `list_engine_capabilities` | no       | Schema version, easings, blend modes, item types, containers, tweenable paths, `server.flavor`, hdf films, in one call |
| `get_source_map`           | no       | The precompiled composition plus each id's authorship trail (`file`, `jsonPointer`, `originKind`) |

### 9.5 Visual-feedback rendering (`src/mcp/render.ts`)

Both `render_preview_frame` and `render_thumbnail_strip`:

- Lazy-load skia-canvas (`loadSkia()`).
- Construct a `NodeAssetLoader` and `preloadAll(comp.assets)`.
- Allocate one Canvas; reuse it (strip case loops over `sampleTimes`).
- Call the same `renderFrame(comp, t, ctx, { assets, index })` the Node
  driver uses — same pixels.
- Return base64 of `canvas.toBuffer("png" | "jpeg")`.

`sampleTimes(duration, count)`:
- `count <= 0` → `[]`
- `count == 1` → `[duration / 2]` (midpoint)
- `count >= 2` → linspace including endpoints: `[0, …, duration]`

`render_to_video` calls into `renderToFile` from the Node driver
verbatim. Validation runs first — `E_VALIDATION_FAILED` if it would
produce broken output.

### 9.6 In-process embedding

Anything an MCP client can do, your tests / scripts can do without
spawning a subprocess:

```ts
import { CompositionStore, TOOLS, dispatchTool } from "davidup/mcp";

const store = new CompositionStore();
const deps  = { store };

const create = TOOLS.find(t => t.name === "create_composition")!;
const res = await dispatchTool(create, { width: 1280, height: 720, fps: 60, duration: 3 }, deps);
// res = { ok: true, result: { compositionId: "comp-1" } }
```

This is how the test suite (`tests/mcp/`) exercises every tool — fast,
isolated, no JSON-RPC plumbing.

### 9.7 Idempotency & atomicity

- **Idempotent retries**: every `add_*` and `register_asset` accepts
  `id?`. Always pass one. A retried call returns `E_DUPLICATE_ID`
  (recoverable, expected) rather than silently creating a second copy.
- **Atomic composite tools**: `apply_behavior`, `apply_template`,
  `add_scene_instance`, `update_scene_instance` snapshot before, batch
  the changes, and roll back on any failure. Either the whole expansion
  lands or nothing does. The store never ends up in a partial state.

---

## 10. End-to-end data flow

A typical agent-driven render:

```
agent: create_composition + add_layer + add_sprite + add_tween + add_tween + …
                  │
                  ▼
            CompositionStore (in memory)
                  │
agent: render_preview_frame(t=0.5)
                  │
                  ▼
            store.toJSON() → Composition (canonical)
                  │
                  ▼
          precompile() ─────── no-op for canonical input
                  │
                  ▼
          validate() ─────── E_VALIDATION_FAILED short-circuits before render
                  │
                  ▼
        NodeAssetLoader.preloadAll(comp.assets)
                  │
                  ▼
        new skia.Canvas(w, h) → ctx
                  │
                  ▼
        renderFrame(comp, t, ctx, { assets, index })
                  │
                  ▼
        canvas.toBuffer("png") → base64 → back to agent
```

A typical authored-JSON render (`examples/four-scenes-60s/render.ts`):

```
read composition.json
       │
       ▼
precompile(authored, { sourcePath })
       │     ├─ resolveImports         ($ref → 4 scene files inlined)
       │     ├─ expandTemplates        (no-op here)
       │     ├─ expandSceneInstances   (4 type:"scene" items → 4 groups
       │     │                          + 100+ namespaced inner items
       │     │                          + ~250 time-shifted tweens
       │     │                          + 1 merged font asset)
       │     └─ expandBehaviors        (every $behavior → 1–4 tweens)
       ▼
validate(compiled) → ok / errors
       ▼
renderToFile(compiled, "output/four-scenes-60s.mp4", { codec, crf, preset })
       │     ├─ load skia-canvas
       │     ├─ NodeAssetLoader.preloadAll
       │     ├─ alloc one Canvas, reuse
       │     ├─ spawn ffmpeg with rawvideo→libx264 pipeline
       │     ├─ for each frame: renderFrame → toBuffer("raw") → stdin.write
       │     └─ stdin.end; wait close; surface stderr tail on failure
       ▼
MP4 on disk
```

---

## 11. Determinism guarantees

| Property                                        | Mechanism                                              |
|-------------------------------------------------|--------------------------------------------------------|
| Same composition + same `t` → same pixels       | Pure resolver + pure renderer; no globals              |
| Same authored input → same canonical output     | Sorted iteration in every compile pass; stable id derivation |
| No PRNG in v0.1                                 | Engine forbids it (`Math.random` not used)             |
| No time-of-day reads in engine                  | Driver-supplied clock, never `Date.now()` in resolver  |
| Resolved scene never mutates input              | `cloneItem` + fresh transform per frame                |
| Two tweens on same `(target, property)` → fail  | Validator with 1µs tolerance for IEEE-754 drift        |
| Scene instances can be replaced safely          | Sealed-instance rule + atomic rollback in store        |

Pixel-level reproducibility across hosts is bounded by font-stack and
image-decoder differences (see §7.4). The *engine output before encoding*
is bit-deterministic.

---

## 12. Glossary of error codes

| Code                              | Origin              | Meaning                                                    |
|-----------------------------------|---------------------|------------------------------------------------------------|
| `E_SCHEMA`                        | validator           | Zod parse failed                                           |
| `E_ASSET_MISSING`                 | validator           | sprite.asset / text.font references unknown id or wrong type|
| `E_ASSET_MISSING`                 | library / MCP       | an `asset:` src or a library tool names an id no shelf holds (the shelves searched are named) |
| `E_ASSET_STALE`                   | library / render    | an `asset:<id>@<sha12>` pin is not the record's sha any more |
| `E_ASSET_INVALID`                 | library             | not `asset:<id>[@<hex>]`, or a shelf that cannot be read   |
| `E_ASSET_TYPE_MISMATCH`           | store / MCP         | an asset of the wrong type for the item or track, or a record davidup cannot take |
| `W_ASSET_CREDIT`                  | validator (warning) | a CC-BY or CC-BY-SA asset carries no `credit`              |
| `W_ASSET_FILE_MISSING`            | validator (warning) | an `asset:` / `global:` src with no file behind it on this machine (MCP `validate`) |
| `E_ITEM_MISSING`                  | validator           | layer/group/tween references unknown item id               |
| `E_PROPERTY_INVALID`              | validator           | property not tweenable on item type                        |
| `E_VALUE_KIND`                    | validator           | from/to type mismatch (number vs color)                    |
| `E_TWEEN_OVERLAP`                 | validator / store   | two tweens on same (target,property) overlap               |
| `E_GROUP_CYCLE`                   | validator           | cycle in group containment                                 |
| `E_DIMENSION_ODD`                 | validator / MCP     | composition width or height is odd (libx264 + yuv420p needs even) |
| `W_DIMENSION_LARGE`               | validator (warning) | composition width or height exceeds 4096px                 |
| `W_TWEEN_TRUNCATED`               | validator (warning) | tween extends past composition.duration                    |
| `W_ITEM_INVISIBLE_OPACITY`        | validator (warning) | item/ancestor group/layer opacity is 0 for the whole run, untweened |
| `W_ITEM_OFF_CANVAS`               | validator (warning) | item's full range of motion never overlaps the canvas rect  |
| `W_FONT_UNREGISTERED`             | validator (warning) | text.font doesn't resolve to a registered font asset (host-dependent fallback at render) |
| `W_SCENE_INSTANCE_OUTLIVES`       | validator (warning) | scene-instance wrapper group stays visible well past its content's last tween |
| `W_GROUP_ANCHOR_NO_BOX`           | validator (warning) | group sets an anchor on an axis it declares no `width`/`height` for |
| `W_VIDEO_NO_AUDIO_STREAM`         | validator (warning) | video item sets `keepAudio` but its asset was probed with no audio stream |
| `W_MARKER_OUTSIDE`                | validator (warning) | a composition marker past the end, or an audio-track marker that never plays inside the composition |
| `E_NO_COMPOSITION`                | store / dispatch    | no default composition; pass `compositionId`               |
| `E_DUPLICATE_ID`                  | store               | id already in use                                          |
| `E_NOT_FOUND`                     | store               | entity (item/layer/asset/tween) does not exist             |
| `E_VALIDATION_FAILED`             | render tools        | cannot render — composition invalid                        |
| `E_INVALID_PROPERTY`              | store               | update_item rejected a property not valid for that type    |
| `E_LAYER_NOT_EMPTY`               | store               | can't remove layer without `cascade: true`                 |
| `E_ASSET_IN_USE`                  | store               | asset still referenced by sprite/text                      |
| `E_INVALID_VALUE`                 | dispatch            | input failed Zod parse                                     |
| `E_RENDER_FAILED`                 | render              | ffmpeg crashed / asset missing / I/O failure               |
| `E_REF_MISSING`, `E_REF_CYCLE`    | imports             | `$ref` target missing or cyclic                            |
| `E_BEHAVIOR_UNKNOWN`              | compose             | behavior name not registered                               |
| `E_BEHAVIOR_PARAM_MISSING/TYPE`   | compose             | behavior param wrong / missing                             |
| `E_TEMPLATE_UNKNOWN`              | compose             | template name not registered                               |
| `E_TEMPLATE_PARAM_MISSING/TYPE`   | compose             | template param wrong / missing                             |
| `E_SCENE_UNKNOWN`                 | compose             | scene name not registered                                  |
| `E_SCENE_PARAM_MISSING/TYPE`      | compose             | scene param wrong / missing                                |
| `E_SCENE_RECURSION`               | compose             | scene instance chain self-references                       |
| `E_SCENE_INSTANCE_DEEP_TARGET`    | compose             | parent tween targets scene-internal id (sealed-instance)   |
| `E_ASSET_CONFLICT`                | compose             | scene asset id collides with different src in parent       |
| `E_UNKNOWN`                       | dispatch            | unexpected throw (not an `MCPToolError`)                   |

---

## 13. Where to extend things

> Read this section before starting any feature — it points at the right
> file and the contract you need to satisfy.

### Adding a new item type (e.g., `video` sprite)

1. Extend `ItemSchema` in `src/schema/zod.ts` (add discriminator).
2. Add tweenable property entries in `src/schema/tweenable.ts`.
3. Add a `drawXxx` function in `src/engine/render.ts` and a switch case
   in `drawItem`.
4. If it needs special transform anchoring (like sprite/shape width-anchor),
   update `getItemSize` in `drawItem`.
5. Extend the MCP tool catalog: `add_xxx` in `src/mcp/tools.ts` and
   handler in `src/mcp/store.ts`.
6. Update `update_item`'s allowed-keys list.

### Adding a new easing

1. Add the function in `src/easings/functions.ts` (must satisfy
   `f(0)=0, f(1)=1`).
2. Add the name in `src/easings/names.ts` (extend `EASING_NAMES`).
3. No engine changes needed — `getEasing` already dispatches by name.

### Adding a new behavior

1. Implement `(ctx: ExpandContext) => RawTween[]` in
   `src/compose/behaviors.ts`.
2. Add to `BUILT_IN_BEHAVIORS` map.
3. Decide derived-id suffixes (e.g., `__opacity`, `__x`). Keep them
   stable — they become user-visible tween ids after expansion.
4. Tests in `tests/compose/behaviors.test.ts`.

### Adding a new built-in template

1. Write the `TemplateDefinition` in `src/compose/builtInTemplates.ts`.
2. Register it at module bottom (`for (const def of […]) registerTemplate(def)`).
3. Keep arithmetic out of `${params.X}` placeholders — accept composite
   values as separate params.
4. Tests in `tests/compose/builtInTemplates.test.ts`.

### Adding a new MCP tool

1. Define a `ToolDef` in `src/mcp/tools.ts`:
   - `name`, `title`, `description`
   - `inputSchema` as a Zod object shape
   - `handler(args, deps): Promise<result>` (or sync)
2. Push it onto `TOOLS`.
3. If it mutates the store, add the corresponding store method.
4. Throw `MCPToolError(code, message, hint?)` for stable errors.
5. Tests in `tests/mcp/` — every new tool gets success path + every
   error code path + idempotency check.
6. Add the name to `server.json`'s `tools` (in `TOOLS` order) and bump the
   tool count in `README.md` and `examples/mcp-demo.md` (and its catalog
   table); `tests/mcp/manifest.test.ts` fails until all three agree. Add
   its row to §9.4 here.

### Adding an asset kind or a library field

1. The record lives in `assetlib/record.js` (`KINDS`, `SCHEMAS`, the
   kind's `media`) and `assetlib/index.d.ts`; `assetlib/README.md` says
   what it means.
2. What davidup takes it as is `assetlib/use.js` (`DAVIDUP_TYPE`), which
   `use_asset`, `register_asset`'s `asset:` path and the editor's Library
   panel all read.
3. A preview is a host's previewer (`src/mcp/assetPreviews.ts` for
   davidup, `handdrawn/cli/previews.mjs` for hdf); anything without one
   gets assetlib's card.

### Adding a new compile pass (e.g., new authoring primitive)

1. Implement `(input, ctx) => output` in `src/compose/`.
2. Insert it into `precompile()` in the correct order (see §8.2).
3. Make it a **no-op** when the input doesn't use your primitive — keeps
   the canonical-v0.1 short-circuit fast.
4. Use sorted iteration and stable id derivation. **Never** read clocks,
   PRNGs, or environment.

### Adding a new driver (e.g., WebGPU offscreen for a worker)

1. Implement an object satisfying `Canvas2DContext` (or wrap an existing
   API to match it).
2. Provide an `AssetRegistry` — typically by subclassing `BaseAssetLoader`
   and implementing `fetchImage` + `fetchFont`.
3. Drive the clock yourself: call `renderFrame(comp, t, ctx, opts)` with
   whatever `t` your host provides.
4. Optionally provide `createOffscreen` if sprite tinting is in scope.

The engine and resolver need zero changes for new drivers — that's the
whole point of the architecture.

---

*Last updated by `ARCHITECTURE.md` synthesis pass. Cross-checks: every
file/line citation here was traced against the current code on `main`.*

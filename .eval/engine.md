# davidup engine — technical evaluation

Scope: `src/` only. Cross-referenced against `design-doc.md`, `ARCHITECTURE.md`,
`COMPOSITION_PRIMITIVES.md`, `COMPOSITION_GAP.md`, `KNOWN_BUGS.md`,
`polish_plan.md`, and the test tree under `tests/`.

## Overview

The "engine" is a ~7.2k-LOC TypeScript core split into four cleanly layered
modules: a Zod-typed schema + semantic validator (`src/schema/`), a pure
resolver and Canvas2D renderer (`src/engine/`), a precompile pipeline that
expands `$ref` / `$template` / `$behavior` / scene-instance authoring sugar
into canonical v0.1 JSON (`src/compose/`), and two thin drivers — a Node
`skia-canvas → ffmpeg` recorder (`src/drivers/node/`) and a browser
`Canvas2D + RAF` previewer with hit-testing and source-map support
(`src/drivers/browser/`). The hot path is genuinely a pure function
`(Composition, t, ctx) → drawing-side-effects`; both drivers wrap that
function unchanged. Determinism is the load-bearing design constraint and the
code visibly takes it seriously (frame-rate clocked off `i / fps`, no PRNG, no
`Date.now()` in the engine itself, an explicit `OVERLAP_EPS` to absorb IEEE
drift, sorted iteration in the precompile passes).

## What's good

- **The resolver/renderer split is small and pure.** `computeStateAt`
  (`src/engine/resolver.ts:44`) does no I/O, builds no global state, and is
  exported so callers can sample any frame without painting — exactly what an
  agentic "diff this frame against that one" workflow needs.
- **Tween dispatch is property-keyed and bucketed.**
  `indexTweens` (`src/engine/resolver.ts:29`) precomputes a
  `Map<"${target}::${property}", Tween[]>` once and the per-frame resolver
  binary-walks the sorted bucket — no per-frame sort, no O(N) scan of the
  whole tween list. Drivers correctly reuse this index across frames
  (`src/drivers/node/index.ts:104`, `src/drivers/browser/index.ts:190`).
- **The Canvas2D abstraction is structural, not nominal.**
  `Canvas2DContext` in `src/engine/types.ts:6` names only the methods the
  renderer touches; both the browser DOM context and skia-canvas's context
  satisfy it without `any`. This is the single most important piece of
  glue making the dual-driver story work without `#ifdef`.
- **Schema strictness on tweenable properties.**
  `tweenable.ts` (`src/schema/tweenable.ts:13-54`) gates *what* may be tweened
  per item type with a per-property value-kind tag (number vs color). The
  validator (`src/schema/validator.ts:191-217`) refuses tweens that target a
  non-existent property and refuses `from`/`to` whose JS type doesn't match
  the expected kind, returning structured `E_PROPERTY_INVALID` / `E_VALUE_KIND`
  errors with paths. Few drag-and-drop animation tools enforce this much.
- **OVERLAP_EPS is the right amount of paranoia.** The 1µs epsilon in
  `src/schema/validator.ts:35` is justified inline (sub-frame at 120fps),
  and the comment in `KNOWN_BUGS.md` shows the exact 1 ULP failure it
  closes. This is the rare "fix the bug, write the regression test, document
  why the constant is what it is" combo.
- **Tween index keys are guaranteed collision-free.** `"::"` joiner with the
  schema's `z.string().min(1)` IDs is enough — no special escaping needed
  because the schema forbids the separator from appearing in either half.
  Documented in `src/engine/resolver.ts:24-26`.
- **The asset loader deduplicates in-flight loads.** `BaseAssetLoader.load`
  (`src/assets/loader.ts:32-51`) returns the same promise to concurrent
  callers, then drops the inflight entry once resolved. No double-decodes,
  no race on first paint.
- **Precompile is a four-pass pure function.** `precompile`
  (`src/compose/precompile.ts:140-164`) is straightforward to follow; it
  short-circuits when there are no v0.2+ markers, and emits an optional
  source map for the editor without touching the canonical output bytes.
- **Recursion guard on scene/scene-instance cycles.** `expandSceneInstance`
  threads a `chain` through nested expansions (`src/compose/scenes.ts:219-227`)
  and throws `E_SCENE_RECURSION` with the full chain in the message. Same
  for `$ref` cycles (`src/compose/imports.ts:130-138`).
- **Time-mapping math is non-cumulative.** Looping multiplies once per
  iteration (`src/compose/scenes.ts:875` — `parentStart + i * sceneDuration`)
  rather than chaining adds, with an explanatory comment. This is the
  rounding-discipline detail that separates a render engine from a toy.
- **Test coverage is broad.** 40 test files, including a real ffmpeg
  integration test (`tests/drivers/node.integration.test.ts`) and parity
  tests for the picker (`tests/drivers/browserPick.test.ts`). The
  precompile pipeline has its own dedicated suite.

## Determinism analysis

**Verdict: strong determinism guarantees within a single host; cross-host
parity is "best-effort within the limits of the underlying Canvas2D
implementation," which is honest but worth calling out.**

What's genuinely deterministic:

- **No PRNG.** Confirmed by grep — no `Math.random` anywhere under `src/`
  except the CLI's edit-watch loop. The engine itself is clean.
- **No `Date.now()` in the resolver or renderer.** Both `Date.now` and
  `performance.now` only appear in driver wall-clock helpers (`nowMs` in
  `src/drivers/node/index.ts:281`, `defaultNow` in
  `src/drivers/browser/index.ts:755`). The render time on the node side is
  derived from `i / fps`, not the clock — `src/drivers/node/index.ts:143`.
- **Insertion-order stability.** Layers are stable-sorted by `z` with
  declaration order as the tiebreaker (`src/engine/render.ts:123-131`).
  Sorted key iteration is used wherever a `Record<>` becomes a `[]` in the
  compose passes (e.g. `src/compose/scenes.ts:253`, `:473`,
  `src/compose/templates.ts:151`, `:294`).
- **Floating-point math is identical across V8 and JSC** because both
  follow IEEE 754 for `+ - * / Math.sin/cos`. Easings (`src/easings/functions.ts`)
  use only those primitives.

What's deterministic *in principle* but host-dependent in practice:

- **Pixels differ between browser Canvas2D and skia-canvas.** They must:
  font hinting, sub-pixel anti-aliasing, image decoder, and bezier
  rasterizer are all implementation-defined by the host. The README is
  upfront about this ("subject to matching skia-canvas + ffmpeg versions
  for byte-for-byte identical MP4s"). For a video product this is the
  right trade — the *composition state* `(comp, t) → ResolvedScene` is
  bit-exact (it's pure JS), and the host only differs in the pixel
  realisation step. The engine cannot guarantee more without rolling its
  own rasterizer.
- **Font metrics diverge between hosts.** `drawText` writes
  `ctx.font = "${px}px \"${family}\""` (`src/engine/render.ts:225`) and
  trusts the host's font shaper. There is no font-bbox normalization, no
  shared font fallback table, and `textBaseline` is hard-coded to
  `"alphabetic"`. Two hosts with different versions of the same font
  (e.g., a stripped subset font in browser vs. the full TTF on disk)
  will produce different glyph widths. This is essentially unsolvable
  without a font-metric oracle baked into the engine; the current design
  is defensible but worth flagging in user docs.
- **Color space.** `lerpColor` in `src/color/index.ts:117` is a straight
  linear interpolation in sRGB-encoded space, which is the "wrong"
  perceptual interpolation but the obvious deterministic one. Both
  drivers will produce the same intermediate RGBA values; the host's
  display-color-management pipeline then applies its own profile on top.
  As long as both drivers feed the same RGBA bytes to their pixel sinks
  (and they do — `canvas.toBuffer("raw")` returns pre-encoding RGBA on the
  Node side), determinism holds up to that boundary.
- **Asset-load timing can affect the first preview paint.** `attach()`
  awaits `preloadAll` before the first `tick()` (`src/drivers/browser/index.ts:183`),
  so this is correct — but in the Node driver, `preloadAll` is similarly
  awaited (`src/drivers/node/index.ts:99`). I found no path where a
  late-loaded asset could affect paint order. Good.
- **`OffscreenSurface` tinting is *not* host-symmetric.** The browser
  driver creates DOM `<canvas>` elements for sprite tinting
  (`src/drivers/browser/index.ts:783-798`); the node driver creates
  `new skia.Canvas` (`src/drivers/node/index.ts:105-108`). Both use
  `multiply` + `destination-in` (`src/engine/render.ts:195-202`). The
  multiply-blend formula is `Cr = Cb * Cs`, which is well-specified, but
  the actual pixel values depend on whether the source canvases are
  premultiplied or straight-alpha. Empirically browsers premultiply on
  read-back; skia-canvas's `toBuffer("raw")` returns straight RGBA per
  its docs. **This is a real divergence vector for tinted sprites with
  any alpha < 1.** I did not find a test that compares browser and node
  tinted output pixel-for-pixel.

What's *missing* if you want byte-exact MP4 reproducibility:

- No frame-hash assertion in the integration test
  (`tests/drivers/node.integration.test.ts` only checks ffprobe metadata).
- No "render an SVG-only composition" snapshot test that would be free of
  font and image variance.

## Bugs found

### 1. `seek()` past `duration` on a stopped loop ignores out-of-range times silently — medium

- **Location:** `src/drivers/browser/index.ts:288-300`.
- **What happens:** `seek(secondsBeyondDuration)` sets `startTime` so the
  next `tick()` computes a `t > duration`, which short-circuits before
  rendering (`:213`). The pick-time fallback is updated to that
  out-of-range value (`:293`) but the canvas keeps showing whatever was
  on it before.
- **Why it's wrong:** Editor users dragging the playhead past the end
  will see a stale frame, not the final frame held. This contradicts the
  documented "last rendered frame holds on screen" contract
  (`:1-7` of the same file).
- **Fix:** Clamp `t` to `[0, duration]` inside `tick()` before checking
  the early-return, or render the last in-range frame when `t > duration`.

### 2. Tween index iteration order is non-deterministic across V8 versions for the *bucket key* — low (latent)

- **Location:** `src/engine/resolver.ts:56`.
- **What happens:** `computeStateAt` iterates `idx.buckets` in `Map`
  insertion order, which mirrors the order tweens appear in
  `comp.tweens`. That's deterministic *if* `comp.tweens` is — but
  `expandBehaviors` (`src/compose/behaviors.ts:229-241`) and several
  scene/template passes append to that array in source order, which is
  fine. The risk is that two unrelated tweens that *write the same
  property on the same item* via different buckets cannot exist (they'd
  share a bucket), so the only way order matters is via cross-property
  composition through the transform matrix — and that's *correctly*
  insensitive to bucket iteration order because `transform.x` and
  `transform.y` are commutative under translate.
- **Why it's wrong:** Not wrong today, but the comment at
  `src/engine/resolver.ts:56` does not document that the loop is
  order-insensitive. A future change adding a tween that writes a
  derived property (say, `width` and `transform.scaleX` competing for
  visible width) would silently depend on bucket iteration.
- **Fix:** Add a comment asserting order-insensitivity, or sort the
  bucket keys before iteration so any future addition is unambiguous.

### 3. Background blend mode is fixed but layer blend mode is `z.string()` with zero validation — high

- **Location:** `src/schema/zod.ts:90`, applied at `src/engine/render.ts:150`.
- **What happens:** `LayerSchema.blendMode` is `z.string()` — *anything*
  goes through. `applyBlendMode` does `ctx.globalCompositeOperation = mode`
  for everything except `"normal"`. If the string is invalid (e.g.
  `"darker"` — not a Canvas2D op), browsers silently ignore the
  assignment and keep the previous mode; skia-canvas may throw, may
  warn, or may silently fall back depending on version.
- **Why it's wrong:**
  - Different hosts handle the invalid string differently — a real
    determinism failure mode.
  - The validator never catches the user's typo. Composition validates
    but renders with whatever the host's last `globalCompositeOperation`
    happened to be.
- **Fix:** Make `blendMode` a `z.enum([...])` of the Canvas2D-spec values
  (`source-over`, `multiply`, `screen`, etc.) plus the alias `"normal"`,
  or add a `validateBlendModes` semantic check.

### 4. `applyBlendMode` does not reset between layers explicitly — low

- **Location:** `src/engine/render.ts:71-81`.
- **What happens:** Each layer does `ctx.save()` then sets composite,
  then `ctx.restore()`. That's correct. But `drawBackground` at
  `:139-145` also sets `globalCompositeOperation = "source-over"` inside
  a save/restore, and `globalAlpha = 1` — the initial state is
  guaranteed clean.
- **Why it's wrong:** This isn't a bug as written; it's a footgun if the
  driver ever calls `drawScene` after non-engine drawing without
  resetting state. Not user-facing.
- **Fix:** Document the assumed-clean state expectation on the public
  `renderFrame` / `drawScene` entrypoints.

### 5. `setByPath` defensive fallback can crash on shallow path with non-object intermediate — low

- **Location:** `src/engine/resolver.ts:150-171`.
- **What happens:** The dotted-path setter handles `transform.*` and
  flat keys explicitly, then falls through to a generic recursive
  walker. The walker does `cur = cur[k] as Record<string, unknown>`
  without checking that `cur[k]` is actually an object. With the
  current tweenable surface (`tweenable.ts:13-54`) the only paths in
  use are `transform.*` and flat names — so the fallback is dead code.
- **Why it's wrong:** Either dead code that should be deleted, or
  insufficiently defensive for the "future tweenable additions" it
  claims to protect. If a future spec adds e.g. `shadow.blur` and the
  item lacks a `shadow` object, the walker will throw at a confusing
  spot.
- **Fix:** Either delete the fallback (YAGNI) or guard with an
  `if (typeof cur[k] !== "object" || cur[k] === null) return;`.

### 6. Sprite tint with semi-transparent images double-multiplies alpha — high

- **Location:** `src/engine/render.ts:188-202`.
- **What happens:** Tinting paints the image, then multiplies a fill,
  then masks back via `destination-in`. The `destination-in` step uses
  the source image's alpha. Combined with the renderer's
  `ctx.globalAlpha = ctx.globalAlpha * tr.opacity` at `:97`, an image
  with an internal alpha gradient (e.g., a PNG with soft edges)
  gets its alpha applied twice during the composite: once during the
  initial `drawImage` into the offscreen, then again during the
  `destination-in` mask. The visible effect is *more* transparent than
  the original image at semi-transparent pixels.
- **Why it's wrong:** The intent of the comment at `:185-191` is
  "preserve luminance, take hue from tint" — but the implementation
  also pre-darkens semi-transparent regions of the source.
- **Fix:** Skip the `destination-in` step and rely on the multiply
  result's natural alpha, or paint a `source-over` opaque fill onto a
  copy of the image's alpha channel.

### 7. Browser pick buffer never invalidates on canvas resize — low

- **Location:** `src/drivers/browser/index.ts:201-258`.
- **What happens:** `pickBuffer` is created on first pick and reused
  forever. The comment says "composition's canvas size doesn't change
  for the lifetime of an attach() so a single buffer is enough." That's
  true today.
- **Why it's wrong:** Future "responsive composition" or "live resize"
  features will surface this. Not blocking.
- **Fix:** Recreate buffer if `compiled.composition.{width,height}`
  ever becomes mutable, or assert size invariance.

### 8. `precompile` source-map mode mutates the input object's items — low

- **Location:** `src/compose/precompile.ts:206-248`.
- **What happens:** `annotateAuthored` calls `{ ...comp }` at the top
  level then *re-assigns* `out.items = annotateItemsMap(...)`. The
  inner annotator builds a fresh `out` map but the values it spreads
  are the **same item references** (`{ ...value, __source: ... }`) —
  so the **resolved canonical output's items are different objects
  than the input's**, which is fine. But the *templates* and *scenes*
  fields go through the same spread-with-source-tag, then through the
  expansion passes which spread again. The end result: the original
  `comp` object reference is untouched, but it shares many sub-object
  references with the annotated copy. If a caller mutates the resolved
  output later, they could surprise themselves.
- **Why it's wrong:** Subtle — defensible because Compositions are
  meant to be treated as immutable.
- **Fix:** Add a sentence in the JSDoc on `precompile` documenting
  the shallow-shared-references rule.

### 9. `BaseAssetLoader.images` and `.fonts` Maps are unbounded — medium

- **Location:** `src/assets/loader.ts:24-30`.
- **What happens:** Loaded images and font families accumulate
  forever. `clear()` exists but no caller invokes it on its own.
  Long-running editor sessions that switch projects will keep the
  previous project's assets in memory until process exit.
- **Why it's wrong:** Editor-scale concern. For a render-once CLI
  it's fine.
- **Fix:** Project-switch should call `loader.clear()` (`polish_plan.md`
  step 20.11 alludes to this for `libraryIndex.detachProject` but
  doesn't mention loader cleanup). For SDK use, document that the
  loader is per-render-job.

### 10. ffmpeg child-process signal-killed exit is correctly surfaced, but… — low

- **Location:** `src/drivers/node/index.ts:174-184`.
- **What happens:** A `code === null` close (signal kill) is now
  surfaced as a failure with the signal name. Good. The
  `README.md` "Troubleshooting" still lists this as a known issue
  (`README.md:234`) — the README is stale.
- **Why it's wrong:** Documentation drift. Easy fix.
- **Fix:** Update the troubleshooting table in `README.md`.

### 11. `clampForProperty` only clamps `transform.opacity` — medium

- **Location:** `src/engine/resolver.ts:123-131`.
- **What happens:** Only `transform.opacity` is clamped to `[0,1]`.
  Sprite/shape `tint` / `fillColor` / `strokeColor` can be lerped to
  unrepresentable colors only if the user supplies bad inputs (lerp
  itself stays in range as long as `from` and `to` are valid RGBA).
  However, the tweenable kind tag `"color"` doesn't actually validate
  *parseability*: the validator at `src/schema/validator.ts:209-217`
  only checks `typeof === "string"`.
- **Why it's wrong:** A user can author `{ from: "magenta", to: "#fff" }`
  and `lerpColorString` will throw at render time because
  `parseColor("magenta")` doesn't recognize named CSS colors
  (`src/color/index.ts:12-17` rejects anything not starting with `#` or
  `rgb(`). This is render-time failure, not validation-time.
- **Fix:** Add a parseability check on color-kind tween endpoints in
  `validator.ts`, or extend `parseColor` to accept named colors
  (`white` already works as a *render-time* fill via Canvas2D, but not
  as a tween endpoint because the lerp will throw).

### 12. `slideIn` / `slideOut` suffix collides with `kenburns` axis suffix when stacked — low

- **Location:** `src/compose/behaviors.ts:574-577`, `:642-666`.
- **What happens:** Both behaviors emit a tween with `suffix: axis`
  (`"x"` or `"y"`). If a user applies a `slideIn` and a `kenburns` on
  the same target with the same `start`, the derived parent ids
  (`${target}_slideIn_0` vs `${target}_kenburns_0`) are different, so
  the emitted tween ids don't collide. OK, but the validator's
  overlap-on-same-property check *will* catch any genuine overlap.
  False alarm — not a bug, just brittle.
- **Fix:** None needed.

### 13. `expandTemplatesInScene` does not exist as documented in `COMPOSITION_GAP.md` — gap

- **Location:** Templates inside scene definitions.
- **What happens:** This is the documented gap. Reading
  `src/compose/templates.ts:203-277` confirms `expandTemplatesInScene`
  has been *implemented* (lines 424-468) since `COMPOSITION_GAP.md`
  was written. The gap doc is therefore stale — but the implementation
  matches what the doc proposed.
- **Why it's wrong:** Stale doc. Move on.
- **Fix:** Mark `COMPOSITION_GAP.md` as resolved or delete it.

### 14. Validator does not enforce per-frame property domain on shape width/height — low

- **Location:** `src/schema/zod.ts:60-71`, `src/engine/resolver.ts:123`.
- **What happens:** Shape `width` / `height` are `z.number().nonnegative().optional()`,
  but a *tween* can drive them through negative values (the lerp clamp
  only fires for `transform.opacity`). Canvas2D `rect(0, 0, -5, -5)`
  paints a flipped-orientation rect; `arc(r, r, -5, ...)` throws on
  some hosts.
- **Why it's wrong:** Possible mid-tween crash on certain hosts when
  authors over-shoot `to: 0` with `easeOutBack`.
- **Fix:** Extend `clampForProperty` to clamp `width` / `height` /
  `fontSize` / `strokeWidth` / `cornerRadius` to `>= 0`.

### 15. `expandSceneInstance` accepts `instance.start` as a non-negative number, but the schema doesn't validate this until very late — low

- **Location:** `src/compose/scenes.ts:229-234`.
- **What happens:** The `MCPToolError` thrown here surfaces as a
  precompile-time crash. The validator doesn't run on the authored
  composition (the input shape is v0.2 with `$template` / `type:"scene"`
  blocks), only on the canonical output. So bad scene-instance
  `start` values can only be reported via precompile errors, not via
  the structured `ValidationResult` shape.
- **Why it's wrong:** Inconsistent error surface — agents get
  `MCPToolError` for some errors and `ValidationError[]` for others,
  for the same conceptual category ("bad input").
- **Fix:** Either run a "v0.2 input validator" before precompile, or
  catch `MCPToolError` in the editor/MCP layer and re-shape it into
  the same `ValidationResult`. Mostly an SDK ergonomics issue.

## Gaps & missing features

What the docs promise vs. what's in `src/`:

- **`design-doc.md` §2** says rotations are in **radians**. Confirmed.
  The schema does not document this; `TransformSchema` (`zod.ts:30-39`)
  just types `rotation: z.number()` without a JSDoc. Cheap fix.
- **`design-doc.md` §3.4** lists 19 named easings. Confirmed —
  `EASING_NAMES` (`src/easings/names.ts:5-25`).
- **`README.md` "Determinism"** claims "no PRNG inside the engine in
  v0.1 (Q10 in design-doc §7)." Confirmed by grep.
- **`README.md`** lists `dyld libx265` as a Troubleshooting item but
  also lists the "signal-killed treated as success" bug — which is
  fixed in `src/drivers/node/index.ts:178-184`. README is stale.
- **`COMPOSITION_PRIMITIVES.md` §10.3** describes a 4-pass precompile
  pipeline. Confirmed in `src/compose/precompile.ts:148-163`.
- **`design-doc.md` §3.3 / §3.4** mention "color: hex or `{r,g,b,a}`."
  In code: only the string form is supported (`zod.ts:67` is
  `z.string().optional()`; `parseColor` accepts hex and `rgb()`/`rgba()`
  but not `{r,g,b,a}` objects). Either update the design-doc or extend
  `parseColor`.
- **`README.md`** advertises `davidup/engine` exports including
  `computeStateAt`, `renderFrame`, `drawScene`, `indexTweens`. All
  present in `src/engine/index.ts`. Good.
- **Audio**, **cubic-bezier easings**, **video clips**, **VFX** — all
  documented as v0.2+ on the roadmap; nothing in `src/` pretends to
  support them. Good.
- **Per-frame thumbnail strip** is in `src/mcp/render.ts` (not in scope
  for this review but worth noting it exists).
- **Source maps for the editor** are fully wired through precompile
  (`precompile.ts:166-202`) and the browser driver
  (`drivers/browser/index.ts:158-180`). Solid v1.0-ready feature.
- **Hit-testing via ID buffer** is present and clearly documented
  (`drivers/browser/index.ts:512-573`). The picker even falls back to
  `lastRenderedT` instead of wall-clock to handle background tab
  throttling (`:198-219`) — that's the kind of subtle correctness most
  prototypes miss.

What I expected to find and didn't:

- **No pixel-parity test between node and browser drivers.** Given
  determinism is the headline feature, an integration test that
  renders the same frame with both drivers and asserts the RGBA buffer
  matches (within a tolerance) would be the single most valuable test
  to add.
- **No fuzz / property-based test on `computeStateAt`** — e.g., "for
  any composition with N tweens on the same property, `t = 0` always
  resolves to the first tween's `from`."
- **No "snapshot the canonical output of precompile" test** for the
  comprehensive demo composition. There's
  `tests/compose/comprehensive-split.test.ts` but it asserts
  high-level invariants, not the full canonical bytes.
- **No memory-bounded asset cache.** See bug 9.

## High-leverage improvements

Ordered by impact ÷ effort. The top three are < 1 day each.

1. **Validate `blendMode` against a Canvas2D enum** (bug 3). 5 lines in
   `zod.ts` + a unit test. Closes a real cross-host determinism vector.
2. **Clamp negative `width` / `height` / `fontSize` / `strokeWidth` /
   `cornerRadius` at tween resolve time** (bug 14). 6 lines in
   `clampForProperty`. Closes the `easeOutBack` overshoot crash class.
3. **Validate color-tween endpoints are parseable** (bug 11). 10 lines
   in `validator.ts` to run `parseColor` over each color-kind tween's
   `from` / `to` and surface `E_VALUE_KIND` instead of a render-time
   throw.
4. **Add a `browser ↔ node` pixel-parity integration test** rendering
   an SVG-only composition (shapes + colored rects, no text/images) at
   `t = 0`, `t = 0.5`, `t = 1`. The composition should fit in the
   intersection of both rasterizers' deterministic surface. Establishes
   a regression dam against blend-mode / multiply / opacity drift.
5. **Document the rotation-in-radians and color-format contracts in
   JSDoc on `TransformSchema` and shape color fields.** Two lines.
   Stops every new SDK user's first mistake.
6. **Fix sprite tint over semi-transparent PNGs** (bug 6). Medium
   effort — needs a new approach to the multiply step. Probably
   `multiply` against a copy of the original, then a `source-over`
   draw with the tint masked by the original alpha.
7. **Make `BaseAssetLoader` LRU-capable** (bug 9). 30 lines. Required
   for any long-running editor server hosting multiple projects.
8. **Replace `KNOWN_BUGS.md`'s stale troubleshooting entry in
   `README.md`.** Trivial.
9. **Add a `validate({ strictColors: true })` mode** that runs
   `parseColor` over every color-kind field (item colors, background,
   tweens). Useful for the SDK to surface authoring errors before any
   render attempt.
10. **Split the 1209-line `scenes.ts`.** Time mapping (>200 lines) and
    the readSceneDefinition/instance helpers (>250 lines) can live in
    `scenes/time-mapping.ts` and `scenes/io.ts` respectively. Pure
    refactor; no behavior change. Improves grep-ability for the next
    bug hunt.

## Code quality notes

- **TypeScript discipline is high.** `tsconfig.json` is `strict`, and
  the codebase uses `as unknown as X` only at well-justified host
  boundaries (DOM Canvas → `Canvas2DContext`, skia `Canvas` → same).
  See the 12 hits from grep — all in compose helpers or driver edge
  glue, none in the resolver/renderer core. No `@ts-ignore` / `@ts-nocheck`
  anywhere.
- **Comments are unusually load-bearing in a good way.** Most files
  start with a multi-paragraph header explaining design intent and
  the spec section they implement. `src/compose/precompile.ts:11-59`
  is a particularly nice example of stating the algorithm before
  showing the code.
- **No dead code in `src/engine/`.** Compose layer has a couple of
  defensive branches (`resolver.ts:164-170`) that look unreachable
  given the current tweenable surface; see bug 5.
- **Module boundaries are crisp.** `engine` never imports from
  `compose`; `compose` never imports from drivers; drivers import
  from both. This unidirectional layering is exactly what a pluggable
  SDK needs.
- **The schema/types/zod separation is correct.** `types.ts` re-exports
  inferred types from `zod.ts` so there's a single source of truth.
- **MCP error codes leak into compose.** `src/compose/scenes.ts:62`
  imports `MCPToolError` from `../mcp/errors.js`, which is a layer
  violation — compose is supposed to be MCP-agnostic. In practice
  this couples the precompile error vocabulary to the MCP server.
  Minor design smell; fix by extracting `MCPToolError` to a generic
  `engine/errors.ts` and re-exporting from `mcp/errors.ts`.
- **Big files:** `scenes.ts` (1209 lines), `browser/index.ts` (821),
  `behaviors.ts` (783). The first two read fine because their
  comments explain the structure; `behaviors.ts` is mostly built-in
  declarations which is acceptable. None are over-engineered, but
  `scenes.ts` is at the point where a split would help.
- **Test files mirror src structure 1:1.** Every src module has a
  corresponding test file. The integration tests are isolated under
  `tests/drivers/`.
- **Naming.** Mostly clear. `getEasing` returning `linear` for an
  undefined name (`src/easings/functions.ts:77-80`) is the kind of
  forgiving default I'd expect for an LLM-targeted product.

## Verdict for v1.0

**The engine core is production-ready for the documented v1.0 scope.**
The schema, resolver, renderer, and asset loader are tight, well-tested,
and unambiguously deterministic at the `(comp, t) → ResolvedScene`
boundary. The dual-driver story works because the engine surface is
small and abstract.

The honest caveats:

- **Cross-host pixel parity is host-bounded.** This is unavoidable
  without bundling a rasterizer. The product positioning ("MP4 is the
  ground truth, browser is preview") makes this acceptable, but any
  marketing claim of "byte-exact" should be qualified to "byte-exact
  within a single host." The intermediate `ResolvedScene` is in fact
  bit-deterministic and the README is appropriately careful.
- **Validation has surgical gaps** (bugs 3, 11, 14) that allow
  compositions to validate-then-crash at render time. Two of three are
  one-day fixes and would close the "agent-authored composition
  validates but produces a broken video" failure class. Worth doing
  before declaring v1.0 ready for third-party SDK consumers.
- **The composition system (scenes / templates / behaviors) is
  ambitious for a v1.0** but the implementation is coherent — recursion
  guards, sealed-instance enforcement, deterministic id prefixing,
  pure-function pre-compile. The 4-pass pipeline is genuinely a small
  algorithm presented clearly. The main complexity cost is `scenes.ts`
  size; the main correctness risk is the layer interaction between
  templates-inside-scenes and behaviors-inside-templates, which the
  tests under `tests/compose/` cover well.
- **For SaaS / third-party template hosting**, the engine has no
  sandboxing because there's nothing to sandbox — user input is pure
  JSON. The risk surface is `parseColor` on attacker-controlled
  strings (no regex DOS — see `src/color/index.ts`), `evaluatePointer`
  on attacker JSON pointers (bounded by the parsed file), and
  `$ref` against attacker paths (the resolver does *not* sandbox file
  reads — `src/compose/imports.ts` will happily read absolute paths
  the host's `readFile` accepts). **For SaaS use, ship `precompile`
  with a custom `readFile` that enforces a chroot.** This is a
  driver-layer concern, not an engine bug, but worth flagging.

Net assessment: the engine is one notch above "ships." The remaining
work (close validation gaps, add a node-vs-browser pixel test,
document host-bounded determinism more sharply) is half a sprint.
The composition layer's surface area is large but the implementation
is unusually disciplined. I would ship `davidup/engine` and
`davidup/schema` as public SDK packages today; I'd hold `davidup/node`
behind a "v1.0-rc" tag until bug 6 (tint over alpha) is verified or
documented as a known artifact.

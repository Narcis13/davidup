# Gradient fills — linear and radial paint on shapes and text

**Status:** design only (v1.3 Session G9). Nothing below is implemented; the
implementation is one following session (§13 orders it). Written against
`v1.3_showcase_findings.md` **L-5** — *"No gradient fills (linear/radial) on
shapes or text"* — whose cost in the showcase was the ambient background:
three 1000 px circles under a 140 px blur in an isolated group
(`examples/showcase-vertical/build.mjs:94`), the single most expensive thing
in every frame (**P-1**; after G8 that one blur is still ~90 % of paint time).

**Companion docs:** `TEXT_V2_DESIGN.md` (the text item this extends),
`v1.3_showcase_findings.md` §G8 (the blur cost this is meant to delete).

---

## 1. Problem

Every fill in the engine is one CSS color string:

- `ShapeItemSchema.fillColor` / `strokeColor` — `z.string().optional()`
  (`src/schema/zod.ts:386-387`), handed straight to `ctx.fillStyle` in
  `paintShape` (`src/engine/render.ts:671-684`).
- `TextItemSchema.color` — `z.string()` (`src/schema/zod.ts:364`), assigned in
  `drawText` (`src/engine/render.ts:574`).
- `composition.background` — `z.string()` (`src/schema/zod.ts:127`), assigned
  in `drawBackground` (`src/engine/render.ts:319-338`).

Canvas2D has had `createLinearGradient` / `createRadialGradient` since forever
and **both of our hosts implement them** (§8), so the capability is sitting
right there behind a schema that only knows how to say `"#5b7cfa"`. The
consequences are all authoring-side:

1. **Soft backgrounds cost a blur.** The only way to get a two-colour wash
   today is several big blurred shapes in an isolated group. That is a
   full-canvas offscreen plus a large-σ blur *per frame*, which is exactly
   what P-1 measured and G8 spent a session making 3.6× cheaper. A gradient
   rect is one `fill()` and no offscreen at all.
2. **Every "modern" title treatment is out of reach.** Gradient type is the
   single most common motion-graphics text treatment, and an agent asking for
   one today gets a flat colour and no diagnostic.
3. **Fake gradients pollute the item tree.** The workaround — N stacked
   shapes at stepped opacities — multiplies item count, defeats the source
   map, and still bands.
4. **The seed library can't ship a gradient look.** Every template
   (`scripts/seed-global-library.ts`) is flat by construction, so "make it
   look less like a wireframe" has no answer that isn't hand-built.

## 2. Goals / non-goals

**Goals**

- G1: `fillColor` (shape) and `color` (text) accept a linear or radial
  gradient object in place of a colour string.
- G2: Resolution-independent authoring — a gradient on a library template
  looks right at any size the template is instantiated at, and works on text
  whose measured box the author cannot know.
- G3: Stop **colours** tween (§6), so the showcase's act-by-act colour shifts
  survive the move from three blobs to one gradient.
- G4: Zero change to existing renders. The paint field is a union whose string
  arm is byte-identical to today; every golden must hold without regeneration
  (§10), and no `⚠` pixel-change marker is needed.
- G5: Both hosts agree within the existing parity tolerance (§8), and a
  malformed gradient is rejected by the validator rather than thrown by the
  rasterizer mid-render.

**Non-goals (deferred, §12)**

Conic gradients, gradient *strokes*, gradient `composition.background`,
gradients on `sprite.tint`, image/pattern fills, geometry tweening, per-stop
easing, non-sRGB stop interpolation, repeating gradients, and on-canvas
gradient handles in the editor.

## 3. Schema

### 3.1 The paint union

```ts
// src/schema/zod.ts — new, above TextItemSchema

const GradientStopSchema = z.tuple([z.number().min(0).max(1), z.string()]);

const LinearGradientSchema = strictObject({
  linear: strictObject({
    from: z.tuple([z.number(), z.number()]),
    to: z.tuple([z.number(), z.number()]),
    stops: z.array(GradientStopSchema).min(2),
    units: z.enum(["box", "px"]).optional(),   // default "box"
  }),
});

const RadialGradientSchema = strictObject({
  radial: strictObject({
    center: z.tuple([z.number(), z.number()]),
    radius: z.number().positive(),
    focus: z.tuple([z.number(), z.number()]).optional(),   // default = center
    focusRadius: z.number().nonnegative().optional(),      // default 0
    stops: z.array(GradientStopSchema).min(2),
    units: z.enum(["box", "px"]).optional(),
  }),
});

export const GradientSchema = z.union([LinearGradientSchema, RadialGradientSchema], {
  errorMap: paintErrorMap,
});

export const PaintSchema = z.union([z.string(), GradientSchema], { errorMap: paintErrorMap });
```

Then `fillColor: PaintSchema.optional()` on `ShapeItemSchema` and
`color: PaintSchema` on `TextItemSchema`. Nothing else in the schema moves.

Four deliberate shapes here:

- **A wrapper key, not a `type` discriminant.** `{ linear: {…} }` /
  `{ radial: {…} }` follows `BezierEasingSchema` / `StepsEasingSchema`
  (`src/schema/zod.ts:59-70`) exactly: two `strictObject`s in a plain union,
  so `{ linear, radial }` together is *rejected* rather than resolved by union
  order. It also dodges the discriminatedUnion/`.refine` trap that
  `VideoItemSchema` documents (repo-known: a `.refine` on a variant breaks
  `z.discriminatedUnion`).
- **Tuple stops**, `[offset, color]`, matching `points: [[x, y]]` on the same
  item (`src/schema/zod.ts:385`). Compact for agents writing JSON by hand,
  and `§6` gives the tween paths readable names anyway.
- **`min(2)` stops.** A one-stop gradient is a flat colour written the long
  way; refusing it removes a whole class of "why is my gradient invisible".
- **A custom `errorMap`.** A bare Zod union reports `"Invalid input"` when
  nothing matches — the exact problem `easingErrorMap`
  (`src/schema/zod.ts:71-86`) was written to fix. `paintErrorMap` prints
  `Invalid paint <json>. Expected a CSS color string, { linear: { from, to,
  stops } } or { radial: { center, radius, stops } }.`

### 3.2 No schema defaults

`units` and `focusRadius` are resolved by the renderer's `??`, **not** by
`z.default()`. `src/schema/defaults.ts` (G2/B-6) walks the schema for declared
defaults and materialises them into the authored composition — which the
editor then writes back over the user's `composition.json`. Adding defaults
here would rewrite every hand-authored gradient with `"units": "box"` noise on
first open. The B-6 class of bug (a `.default()` the renderer never sees) is
avoided the other way: the renderer never reads a field that only the parse
output has.

### 3.3 DUAL mirrors

The paint union must be mirrored, or the field is silently stripped:

| File | What |
|---|---|
| `apps/editor/app/types/commands.ts:118` | `update_item.props.fillColor` → `z.union([z.string(), GradientSchema])` |
| `apps/editor/app/types/commands.ts` (`color`, line 108) | same for text |
| `apps/editor/app/types/commands.ts:397` | `add_shape.payload.fillColor` |
| `apps/editor/app/types/commands.ts` (`add_text`) | `add_text.payload.color` |
| `src/mcp/tools.ts:1131` `ITEM_PROP_SHAPE` | `fillColor`, `color` |
| `src/mcp/tools.ts:1031` `add_shape` / `:960` `add_text` | input schemas |
| `src/mcp/store.ts:236,304` | the store's `AddShapeInput` / item types |

The editor keeps its own copy on purpose (client code never imports server
types — see `useCommandBus.ts`), so this is a copy, not an import. Plus the
standing traps: `bun install` re-vendors the engine into the editor (stale
snapshot), and **no new MCP tool is added**, so `server.json` / README /
`mcp-demo` tool counts do not move (`manifest.test` stays green).

## 4. Coordinate space — `units: "box"` is the default

Gradient coordinates are interpreted in the item's own frame, at the moment
`fill()` runs — i.e. after the transform *and* after the anchor translate, the
same frame `points`, `width`, `cornerRadius` and the text block live in.

**`units: "box"` (default)** multiplies the coordinates by the item's **paint
box**, so `from: [0, 0] → to: [0, 1]` is "top to bottom of this item" whatever
its size:

| Item | Paint box |
|---|---|
| `shape/rect` | `[0, 0, width, height]` |
| `shape/circle` | `[0, 0, width, width]` (width is the diameter, §3.2 of the primitives doc; `anchorHeight` already falls back this way, `src/engine/anchor.ts:38-44`) |
| `shape/polygon` | bounding box of `points` — the same min/max sweep `itemPaintBounds` already does (`src/engine/bounds.ts:229-245`), **without** the miter spike, which is a stroke allowance and not part of the fill |
| `text` | the laid-out block: `layout.blockWidth × blockHeight` from `applyTextStyle` (`src/engine/render.ts:605`) |

A radial `radius` in box units scales by `max(w, h)`: `0.5` reaches the long
edges, `≈0.71` reaches the corners of a square.

**`units: "px"`** passes the numbers through untouched, for the cases where a
gradient must be pinned to a known pixel geometry (a 240 px highlight band on
a 1080 px panel).

Why box-by-default rather than the px-only form sketched in the findings
entry: text is the forcing case. The author cannot know `blockWidth` — it is
measured at draw time against a font the validator does not have (this is
exactly why `bounds.ts:214-216` refuses to guess a text extent), so a px-only
gradient on text is unauthorable without a `measure_text` round trip. Box
units also make G2 true for free: a library template instantiated at half size
keeps its gradient.

**Consequence — the point-mode fast path.** `applyTextStyle`
(`src/engine/render.ts:614-624`) deliberately skips measurement for a single
point-mode line and reports `blockWidth: 0`. A box-unit gradient needs the
real width, so `drawText` must bypass that fast path when `item.color` is a
gradient (one extra `measureText` per text item per frame, only for gradient
text). Zero-size boxes (an empty string, a zero-width rect) collapse the
gradient geometry to a point; §7 makes that a validated warning and a defined
paint (the last stop), never a throw.

## 5. Renderer

One new module, `src/engine/paint.ts`:

```ts
export function resolvePaint(
  ctx: Canvas2DContext,
  paint: Paint,
  box: readonly [number, number],   // the §4 paint box
): string | CanvasGradientLike
```

- A string returns unchanged — the existing code path, byte for byte.
- A gradient calls `ctx.createLinearGradient` / `createRadialGradient` with
  the resolved coordinates, then `addColorStop` per stop, and returns it.
- If the host exposes neither creator, it returns the **first stop's colour**
  — the same "degrade, don't throw" contract `getImageData` (blur) and
  `getTransform` (isolated groups) already have in `Canvas2DContext`
  (`src/engine/types.ts:88-94`). A bare test double keeps working.

`paintShape` (`src/engine/render.ts:671`) and `drawText`
(`src/engine/render.ts:574`) each gain one call. Nothing else in the renderer
changes: a `CanvasGradient` is a legal `fillStyle` value, shadows, blend
modes, isolated groups, effects and the blur path all compose with it
unchanged.

**Type change (`src/engine/types.ts:44`).** `fillStyle: string` widens to
`fillStyle: string | CanvasGradientLike`, and the two creators join the
interface as **optional** members returning `CanvasGradientLike` (`{
addColorStop(offset: number, color: string): void }`). Verified on this
machine: skia-canvas 3.0.8 returns a real `CanvasGradient` and
`typeof ctx.fillStyle` is `"object"` after assignment, so the narrow `string`
type is a lie the moment a gradient is set — the widening is required, not
cosmetic. `strokeStyle` stays `string` until gradient strokes land (§12).

**Cost.** One `createLinearGradient` + N `addColorStop` per gradient fill per
frame. That is a small allocation against a `fill()` that already costs
milliseconds, and it replaces a blur that costs ~76 ms after G8. The G8
profiler (`davidup render --profile`, `src/cli/profileReport.ts`) is the
instrument if this ever looks wrong; no caching in v1 — a cache keyed on
(item, box, resolved stops) would have to be invalidated by every stop tween,
which is the same "deep compare that never hits" G8 rejected for static
subtrees.

## 6. Tweening — stop colours, yes; geometry, not yet

The findings entry asks "tweenable stops?". **Yes for stop colours, no for
geometry**, on this evidence: the aurora the gradient is meant to replace
tweens its blob colours at every act change (`build.mjs`, the `AURORA`
table) — shipping a gradient that cannot do that would make L-5's fix a
regression for its own motivating case. Nothing in the showcase animates
gradient *geometry*, and geometry paths are addable later without a schema
change (they are TABLE rows, §12).

**Paths.** Mirroring the effect precedent `effects.<index>.<field>`
(`src/schema/tweenable.ts:87-147`):

```
fillColor.stops.<i>.color     kind: "color"     (shape)
color.stops.<i>.color         kind: "color"     (text)
```

`<i>` indexes the `stops` array; `.color` maps to tuple slot 1. The readable
field name is what makes the compact tuple storage acceptable (§3.1); the
resolver's writer does the mapping.

**Three touch points, all with an exact precedent:**

1. `src/schema/tweenable.ts` — a `GRADIENT_STOP_PATH` regex and a branch in
   `getItemTweenable` (`:138`), which already takes the *item*, so it can
   check that the paint really is a gradient and that stop `i` exists — the
   same check `effects.<i>.<field>` does against `item.effects[i]`.
   `getTweenable` (type-only, `:121`) accepts the path shape without the
   existence check, exactly as it does for effects.
2. `src/engine/resolver.ts:243` `setByPath` — a fourth branch writing
   `stops[i][1]`. And `cloneItem` (`:221`) must deep-copy a gradient paint the
   way it already deep-copies `effects` (`item.effects?.map(e => ({...e}))`),
   or frame N's tween mutates the authored composition and leaks into frame
   N+1. This is the aliasing trap `TEXT_V2_DESIGN.md` §3 calls out for nested
   objects; effects solved it with a targeted copy, and so does this.
3. `src/schema/validator.ts` rule 4 — a `from`/`to` on a stop path is a colour
   string, so the existing `parseColor` check (`:960-982`, `E_COLOR_INVALID`)
   applies with no new code.

**Tweening the whole paint stays string-only.** `fillColor` / `color` keep
their `kind: "color"` TABLE rows (`src/schema/tweenable.ts:34,44`), so a tween
endpoint is still a colour string — a gradient object as `from`/`to` is
already rejected by `E_COLOR_INVALID`. A tween on `fillColor` of a
gradient-filled item is *legal* and defined (the gradient shows until the
tween's first frame, then the item goes flat), which is a footgun worth one
lint warning: **`W_PAINT_OVERWRITTEN`** — *"Tween X sets `fillColor` on item Y,
whose fill is a gradient; the gradient is replaced from t=…"*.

## 7. Validation

New semantic checks (`src/schema/validator.ts`), because **skia throws at
rasterization time** and a throw at frame 412 kills a 900-frame render:

| Check | Code |
|---|---|
| Every stop colour parses (`parseColor`, `src/color/index.ts:12`) | `E_COLOR_INVALID` |
| Stop offsets non-decreasing | `W_GRADIENT_STOP_ORDER` |
| `radial.radius > 0`, `focusRadius ≥ 0`, `focusRadius ≤ radius` | `E_INVALID_VALUE` |
| `linear.from` equals `linear.to` (degenerate) | `W_GRADIENT_DEGENERATE` |
| Gradient on an item with a zero-size paint box | `W_GRADIENT_DEGENERATE` |

The first and third are the load-bearing ones, and both were **measured on
this machine** against skia-canvas 3.0.8:

- `addColorStop(0, "notacolor")` throws `TypeError: Could not be parsed as a
  color`. Unvalidated, a typo'd stop takes down the render (and the editor's
  preview worker) at the first frame that paints it.
- `createRadialGradient(0, 0, -1, 0, 0, 10)` is **accepted** by skia. The
  HTML spec makes a negative radius an `IndexSizeError` `DOMException`, so the
  browser is expected to throw where node silently renders *(spec-derived; not
  re-verified in a browser in this session)*. That is the worst failure mode
  this design has — a composition that renders fine from the CLI and breaks
  the editor's stage — and the validator closing it is the whole reason the
  radius rules are errors and not warnings.

A degenerate linear gradient did **not** throw in skia (verified); the warning
exists because the paint is then host-defined, not because it crashes.

## 8. Host parity

The parity contract is `tests/determinism/nodeBrowserParity.integration.test.ts`:
node's skia-canvas and Chromium's Canvas2D must agree within a similarity
tolerance (not byte-identical — two different Skia embeddings).

Measured on skia-canvas 3.0.8, a 256 px `#000 → #fff` linear ramp:

```
x:   0    1   64  128  192  255
R:   1    1   64  128  192  255
```

— a straight 8-bit sRGB lerp with no gamma correction and no dithering, which
is what Chromium does too (premultiplied sRGB interpolation, per spec). Alpha
stops interpolate straight as well (`rgba(255,0,0,0) → rgba(255,0,0,1)` gives
exact quarter-points). So gradients are the *easy* parity case: the divergence
risk is rounding in the last unit, well inside the existing threshold, unlike
the rotated/curved-edge antialiasing the parity fixture deliberately avoids.

Three parity facts to hold the implementation to:

1. **Both hosts have all three creators.** Verified present on skia-canvas:
   `createLinearGradient`, `createRadialGradient`, `createConicGradient`,
   `createPattern`. We ship only the first two (§12).
2. **Coordinates are resolved by us, not by the host.** §4 turns box units
   into pixels in `engine/paint.ts`, so both hosts receive identical numbers —
   no host-side "object bounding box" semantics (that is an SVG concept
   Canvas2D does not have) can diverge.
3. **The browser pick buffer is unaffected.** `paintShapePath` /
   `paintTextHitArea` (`src/drivers/browser/index.ts:797-830`) assign their own
   flat id-colour to `fillStyle` before filling, so a gradient can never leak
   into hit-testing. A gradient with transparent stops still picks as solid
   ink — the same as a flat `rgba(…, 0)` fill today.

Editor previews (`Stage.vue` via the browser driver) and library thumbnails
(`apps/editor/app/services/library_thumbnail.ts`) go through the same engine
and need no gradient-specific work.

## 9. MCP and editor surfaces

**MCP — no new tools.** `add_shape` (`src/mcp/tools.ts:1031`), `add_text`
(`:960`) and `update_item`'s `ITEM_PROP_SHAPE` (`:1131`) widen their paint
fields to `PaintSchema`; `store.ts` passes the value through
(`:1017`, `:2816`) and the `rejectKeys` allowlists (`:2826`) are unchanged
because no key is new. `list_engine_capabilities` (`:3018`) gains

```jsonc
"paint": { "gradients": ["linear", "radial"], "units": ["box", "px"], "tweenableStops": true }
```

so an agent discovers gradients the way it discovers `groups.isolate`, without
an `E_SCHEMA` round trip. The tool *count* does not change, so the
`server.json` / README / `mcp-demo` sync rule is not triggered.

**Templates and `$repeat` come free.** `substitute`
(`src/compose/params.ts:74-96`) recurses through any plain object and array,
so `${params.brand}` inside a stop, or an expression-driven stop offset in a
`$repeat`, works on day one with no compose-pass change.

**Inspector.** `fillColor` / `color` move from `kind: 'color'` to a new
`kind: 'paint'` (`Inspector.vue:455,508`) backed by a new
`inputs/Paint.vue`, registered in `INPUT_FOR_KIND` (`:747`). It follows
`inputs/Shadow.vue` exactly: a compound editor that emits the **whole value**
on every edit so one change is one `update_item`, with number sub-fields
committing on `change` so the echo can't clobber typing. Layout:

```
[ flat | linear | radial ]         ← mode segmented control
  flat   → the existing Color swatch, unchanged
  linear → from x/y, to x/y, units toggle, stop list
  radial → center x/y, radius, (focus…), units toggle, stop list
  stop list → [swatch] [offset 0..1] [×]  + "add stop"
```

Switching to `flat` emits the first stop's colour (lossy, and the undo stack
covers it); switching to `linear` from flat seeds
`{ from:[0,0], to:[0,1], stops:[[0, current],[1, "#000000"]] }` so the item
never blinks to an invalid state. `tweenValueKindForField` (`:913`) maps the
new kind to `'unknown'` for the whole-field "+ animate" affordance; per-stop
animation is reached from each stop row, which resolves to the §6 path.

## 10. Tests

| Test | What it pins |
|---|---|
| `tests/schema/gradients.test.ts` (new) | union accepts both forms; `{ linear, radial }` together rejected; `< 2` stops rejected; `paintErrorMap` message; unknown key inside `linear` gets the "did you mean" |
| `tests/schema/validator.test.ts` | the five §7 codes, including negative `radius` |
| `tests/engine/paint.test.ts` (new) | box→px resolution per item type (rect, circle, polygon bbox, text block); `units: "px"` passthrough; the no-creator fallback returns the first stop |
| `tests/engine/resolver.test.ts` | `fillColor.stops.1.color` tweens; the authored composition is **not** mutated across two `computeStateAt` calls (the aliasing trap) |
| `tests/drivers/node.test.ts` | a gradient rect's pixels ramp; a gradient text item draws |
| `tests/determinism/parity/fixture.ts` | a gradient panel + gradient headline added to the parity composition |
| `tests/determinism/goldenFrames.integration.test.ts` | **no hash may move.** A new `gradient` example adds keys; existing hashes changing means the string path was disturbed |
| `apps/editor/tests/functional/command.spec.ts` | `update_item { fillColor: { linear: … } }` round-trips through the command bus |

Golden note (repo memory): `regenerate-goldens.ts` adds darwin-arm64 entries
that were never committed, so only a **changed existing hash** counts as a
diff; and `comprehensive` flakes ~1 in 6 full-suite runs on clean HEAD.

## 11. Migration and compatibility

No migration. The string arm is unchanged, `COMPOSITION_VERSION` stays
`"0.1"` (the accepted shape only widens — every v1.3 document is still valid),
and an older reader meeting a gradient fails at `E_SCHEMA` with a clear
message rather than mis-rendering. The showcase's aurora can then become one
gradient-filled rect, deleting the isolated group, the 140 px blur and the
three blob tweens — the L-5 workaround the findings doc asks each fix session
to remove.

## 12. Deferred

| Deferred | Why, and what it would cost later |
|---|---|
| **Gradient strokes** | `strokeStyle` is the same widening plus a `strokeStyle` type change; box units would need a stroke-aware box. Cheap follow-on, no schema change to the gradient itself. |
| **`composition.background`** | `drawBackground` (`render.ts:319`) is a third paint site with `"transparent"` sugar layered on it; worth doing, but it is a separate decision about what the paint box of the *canvas* is (trivially `[width, height]`). |
| **Conic gradients** | Present in skia (verified) and Chromium, but not in Safari before 16.4 and not in the parity budget for one session. Adds a third union arm, nothing structural. |
| **Geometry tweening** | `fillColor.from.0` style paths; a TABLE/regex row plus a `setByPath` branch, no schema change. Waiting for a composition that needs a sweeping highlight. |
| **`sprite.tint`, patterns/images as fill, repeating gradients, per-stop easing, OKLab interpolation** | Each is a bigger idea than L-5 asked for; sRGB stop interpolation is what both hosts agree on today (§8), and changing colour space later is a breaking pixel change. |
| **On-canvas gradient handles in the editor** | The Inspector form (§9) is the v1 affordance. Handles need stage-level drag targets in the item's frame, which is its own session. |

## 13. Implementation order (next session)

1. `PaintSchema` + `paintErrorMap` in `src/schema/zod.ts`; widen the two item
   fields. Tests: schema.
2. `src/engine/paint.ts` (box resolution + `resolvePaint`) and the two call
   sites; widen `Canvas2DContext`. Tests: engine + node driver.
3. Validator rules §7. Tests: validator.
4. Tween paths §6 — `tweenable.ts`, `resolver.ts` (including the deep copy).
   Tests: resolver.
5. MCP widening + `list_engine_capabilities.paint`. DUAL mirror in
   `apps/editor/app/types/commands.ts`, then `bun install` to re-vendor.
6. `inputs/Paint.vue` + Inspector field kind. Tests: editor functional.
7. Parity fixture + a `gradient` golden example; confirm **no existing golden
   hash moves**.
8. Delete the aurora workaround in `examples/showcase-vertical/build.mjs` and
   re-measure with `--profile` — the number that closes both L-5 and P-1.

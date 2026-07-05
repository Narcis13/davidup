# Text v2 — multiline, wrapping, measured extents, stagger reveal

**Status:** design only — v1.1 candidate (`DAVIDUP_V1_REVIEW.md` §6 item 22,
`v1_implementation_plan.md` Session 30). **No schema or engine code changes
land with this document.**

**Companion doc:** `REPEAT_EXPRESSIONS_DESIGN.md` (§6 item 23). The two are
independent — Text v2 deliberately does *not* depend on `$repeat` or
expressions (see §7, rejected alternative B).

---

## 1. Problem

The `text` item (`src/schema/zod.ts:214`) is a single `fillText` call at the
origin (`drawText`, `src/engine/render.ts:447-458`). Concretely:

1. **No multiline.** A `\n` in `text` renders as a missing-glyph box or is
   collapsed, host-dependent. Every paragraph, list, caption block, or
   two-line title must be hand-assembled from N separate text items with
   hand-computed `y` offsets.
2. **No wrapping.** Agents cannot flow copy into a box; they must guess line
   breaks, and the guess is wrong whenever the font, size, or copy changes.
3. **No extents.** `anchorWidth`/`anchorHeight` return 0 for text
   (`src/engine/render.ts:217-236`), so `anchorX`/`anchorY` are spatially
   inert on text — centering a title means eyeballing pixel offsets. The
   engine's `Canvas2DContext` (`src/engine/types.ts:6`) deliberately omits
   `measureText`, so neither the renderer, the validator, nor the editor can
   know how wide a string is. The editor's selection ring guesses
   `fontSize × 0.6` per glyph (`src/drivers/browser/index.ts:543-558`), and
   agents are blind (they can't even guess).
4. **No per-line / per-word reveal.** The staggered text reveal is the #1
   motion-graphics idiom, and today it requires exploding copy into one item
   per word plus one behavior per item — precisely the 30-tool-call authoring
   cliff the review calls out.

## 2. Goals / non-goals

**Goals**

- G1: `\n`-multiline and box-constrained word wrap.
- G2: `measureText`-backed extents: working anchors on text, a real editor
  selection ring, and a server-authoritative `measure_text` MCP tool.
- G3: Per-line / per-word / per-character stagger reveal as a *renderer*
  capability driven by one tweenable scalar, plus behavior sugar
  (`textRevealIn` / `textRevealOut`).
- G4: Zero change to existing renders. Every new field is optional; a v1.0
  composition renders byte-identically.

**Non-goals (deferred, see §12)**

- Rich spans (mixed color/weight inside one item), letter-spacing, vertical
  alignment inside the box, text-on-path, RTL/bidi shaping guarantees,
  variable fonts, editable text-box resize handles in the editor.

## 3. Schema changes (`TextItemSchema`)

All new fields are optional. No new union variant — this avoids the
discriminatedUnion/refine trap documented for `VideoItemSchema`
(`src/schema/zod.ts:268-277`); any cross-field rule goes in the semantic
validator, matching the video precedent.

```jsonc
{
  "type": "text",
  "text": "Ship faster.\nBreak nothing.",   // \n is now a hard line break
  "font": "font-display",
  "fontSize": 64,
  "color": "#ffffff",
  "align": "left" | "center" | "right",     // existing

  // ── new in v1.1 ──
  "width": 720,                  // optional wrap box width (px). Presence
                                 // switches the item from POINT to BOX mode (§4).
  "wrap": "word" | "char" | "none",  // default "word" when width present,
                                     // forced "none" without width
  "lineHeight": 1.2,             // multiplier on fontSize; line advance =
                                 // lineHeight * fontSize. Default 1.2.
  "maxLines": 3,                 // optional clamp; overflow lines dropped
                                 // (lint warns, §9)

  // ── reveal (§6) — flat fields, not a nested object ──
  "revealUnit": "line" | "word" | "char",   // default "line"
  "revealProgress": 1,           // 0..1, TWEENABLE. Default 1 (fully shown).
  "revealStagger": 0,            // 0..1 overlap fraction. Default 0.
  "revealMode": "fade" | "rise"  // default "fade"
}
```

Reveal fields are **flat** (`revealProgress`, not `reveal.progress`) on
purpose: the resolver clones items shallowly with only `transform` deep-copied
(`src/engine/resolver.ts:180-195`) and `setByPath` only understands flat
props and `transform.*` (`src/engine/resolver.ts:198`). A nested `reveal`
object would be aliased across frames and mutated in place; flat fields ride
the existing machinery untouched.

**Tweenable surface** (`src/schema/tweenable.ts` `TEXT_PROPS`): add exactly
one entry — `{ path: "revealProgress", kind: "number" }`. `width`,
`lineHeight`, `maxLines` are *not* tweenable in v1.1: tweening the wrap box
re-runs line-breaking every frame and produces discontinuous jumps when a
word hops lines; if demand appears it can be added later without schema
change (it's just a TABLE row).

**DUAL mirror:** every new field must be mirrored in
`apps/editor/app/types/commands.ts` or the editor silently strips it off UI
payloads (repo-known trap), and `bun install` re-vendors the engine into the
editor (stale-snapshot trap).

## 4. Layout model: point text vs box text

Mirrors the point-text / paragraph-text split every motion tool uses (AE,
Illustrator), discriminated by the presence of `width`:

### 4.1 Point mode (no `width`) — backward compatible

- `text` split on `\n` into lines. Single line ⇒ *exactly* today's draw
  path: baseline-alphabetic `fillText` at the local origin, `align` via
  `ctx.textAlign`. **Pixel-identical to v1.0 for every existing item.**
- Additional lines draw at `y = i · lineHeight · fontSize` below the first
  baseline, each aligned around the origin x per `align`.
- Anchor box stays **0×0** in point mode. Rationale: making anchors suddenly
  live would move every existing text item authored with a non-zero
  `anchorX/Y` (there are compositions in the wild that set them, harmlessly
  today). Point mode = origin-is-first-baseline, forever.

### 4.2 Box mode (`width` present)

- Local origin is the **top-left of the box** (like sprite/shape/video), not
  a baseline. First line's baseline sits at `ascent ≈ 0.8 · fontSize` below
  the top edge — the same 0.8 approximation the editor ring already uses;
  see §5.3 for why we do *not* use measured ascent here.
- `wrap: "word"` (default): greedy fill. Accumulate words; a candidate line
  is measured as a whole string (`measureText(candidate).width`) so kerning
  across spaces is respected; when the candidate exceeds `width`, break
  before the last word. A single word wider than the box overflows on its
  own line (never clipped) and lint warns (§9). `wrap: "char"` breaks inside
  words at code-point granularity. `wrap: "none"`: only `\n` breaks; lines
  may overflow the box (lint warns).
- `align` aligns each line inside the box (`left`/`center`/`right` against
  `width`), implemented by explicit per-line x offsets — `ctx.textAlign` is
  pinned to `"left"` in box mode so layout owns alignment.
- **Anchor box** = `(width, blockHeight)` where
  `blockHeight = lineCount · lineHeight · fontSize`. `anchorX/anchorY`
  finally work on text — `anchorX: 0.5, anchorY: 0.5` centers the block on
  `(x, y)`. This is gated on box mode only, so G4 holds.

### 4.3 The layout function

One pure function, shared by renderer, pick buffer, selection ring, and the
`measure_text` tool:

```ts
// src/engine/textLayout.ts (new)
interface TextUnit { text: string; x: number; lineIndex: number }
interface TextLine { text: string; x: number; y: number; width: number; units?: TextUnit[] }
interface TextLayout {
  lines: TextLine[];
  blockWidth: number;    // box mode: item.width; point mode: max line width
  blockHeight: number;   // lineCount * lineHeight * fontSize
  unitCount: number;     // per current revealUnit
}
function layoutText(item: TextItem, measure: (s: string) => number): TextLayout
```

- Input is the item plus a `measure` closure (`ctx.measureText(s).width`
  with the item's font already set). No other metric is consumed — see §5.
- Deterministic for fixed `(text, font-family, fontSize, width, wrap,
  lineHeight, maxLines, revealUnit)` and a fixed measure function.
- Renderers may cache the layout per item keyed on those fields; reveal
  tweens (which only change `revealProgress`) never invalidate the cache, so
  the per-frame cost of a reveal is the draw calls, not re-layout.

### 4.4 Unit segmentation

- `line` units: the post-wrap lines.
- `word` units: within each laid-out line, maximal non-whitespace runs; each
  unit's x comes from measuring the line's prefix (kerning-correct).
- `char` units: **code points** (`Array.from(str)`), *not*
  `Intl.Segmenter` graphemes. Segmenter output varies with the host's ICU
  version — a determinism hazard the engine refuses on principle. Cost: a
  ZWJ emoji sequence reveals in pieces during a char reveal; acceptable, and
  recorded as an open question (§12-Q4).

## 5. Measurement and the determinism contract

### 5.1 `Canvas2DContext` gains `measureText`

```ts
measureText(text: string): { width: number };
```

Only `width` is in the contract. Both hosts (skia-canvas ≥3 on node,
`CanvasRenderingContext2D` in browsers) satisfy this structurally with their
richer native `TextMetrics`; typing only what layout consumes keeps the
interface honest to its own header comment ("we list only the
methods/properties the renderer actually uses").

### 5.2 What is and isn't metric-dependent

Deliberate split to minimize the determinism blast radius:

| Quantity | Depends on font metrics? |
|---|---|
| Line advance / block height / anchor box height | **No** — `lineHeight · fontSize · lineCount`* |
| Anchor box width (box mode) | **No** — authored `width` |
| Line breaking (where words wrap) | **Yes** (`wrap:"word"/"char"` only) |
| Per-line x for `align` in box mode | **Yes** |
| Word/char unit x offsets | **Yes** |
| Point-mode single line | **No** (unchanged v1.0 path) |

\* `lineCount` is metric-free given `wrap:"none"` (count of `\n` segments)
and metric-dependent otherwise.

### 5.3 Position in the existing contract

The determinism promise is *same host, same pixels* (the Session 23 harness
renders via skia-canvas on node). Cross-host (browser preview vs node
render) text rasterization already differs, and an unregistered font is
already flagged as "renders inconsistently across hosts"
(`W_FONT_UNREGISTERED`, `src/schema/validator.ts:485-503`). Text v2 keeps
the same shape:

- **Node renders are deterministic**: same font *file* (registered asset) +
  same skia-canvas version ⇒ identical `measureText` ⇒ identical layout.
  The Session 23 harness gets one new golden: a box-mode wrapped, char-reveal
  composition.
- **Browser preview may break lines slightly differently** than the node
  render when metrics differ. This is an accepted preview/render gap of the
  same class as rasterization differences. It is exactly why the first-line
  baseline in box mode uses the fixed `0.8 · fontSize` approximation rather
  than measured ascent: vertical layout stays bit-identical across hosts,
  confining any drift to horizontal line-break choices.
- **Canonical JSON never stores derived layout.** Layout is recomputed by
  whoever draws. (This is also why compile-time text splitting was rejected,
  §7.)

## 6. Stagger reveal

### 6.1 Semantics

One tweenable scalar drives the whole idiom. With `N = unitCount`,
`s = revealStagger ∈ [0,1]`, `P = revealProgress ∈ [0,1]`:

```
d       = 1 / (1 + s·(N − 1))        // per-unit local duration (normalized)
start_i = i · s · d                  // unit i begins
p_i     = clamp((P − start_i) / d, 0, 1)
```

- `s = 0` → all units animate together (`p_i = P`).
- `s = 1` → strictly sequential, each unit gets `1/N` of the ramp.
- Intermediate `s` → overlapping cascade, the classic look.
- `P = 0` ⇒ every `p_i = 0` (fully hidden); `P = 1` ⇒ every `p_i = 1`
  (fully shown, and the renderer takes the plain no-reveal fast path).

Per-unit application, after layout (units never reflow during a reveal):

- `fade`: draw unit with `alpha · p_i`.
- `rise`: `fade` plus `translateY((1 − p_i) · 0.4 · fontSize)` — a fixed
  rise distance keeps the knob count down (§12-Q2 tracks making it a param).

The easing curve of the *driving tween* shapes the whole cascade; per-unit
easing is intentionally out of scope (each unit's ramp is linear inside its
window). This matches how the existing resolver/easing split works: easing
lives on tweens, not on items.

### 6.2 Behavior sugar

Two new built-ins in `src/compose/behaviors.ts`, no new machinery — each
expands to a single tween on `revealProgress`:

| Behavior | Expands to | produces |
|---|---|---|
| `textRevealIn`  | `revealProgress 0→1` over the block window | `["reveal"]` |
| `textRevealOut` | `revealProgress 1→0` | `["reveal"]` |

`revealUnit` / `revealStagger` / `revealMode` remain *item* fields (they
describe what the text is, not the motion), so the behaviors need no params
beyond the standard block. If the behavior targets a non-text item, the
existing post-expansion validator rejects it — `revealProgress` exists only
in `TEXT_PROPS`, so `E_PROPERTY_INVALID`-class checking is free.

Agent authoring of the #1 idiom becomes exactly two calls:

```
add_text({ id: "title", text: "Ship faster.\nBreak nothing.", width: 720,
           revealUnit: "word", revealStagger: 0.6, revealMode: "rise", ... })
apply_behavior({ target: "title", behavior: "textRevealIn", start: 0.5, duration: 1.2,
                 easing: "easeOutQuad" })
```

## 7. Rejected alternatives

**A. Reveal as N per-unit opacity tweens (compile-time explosion of tweens
onto one item).** Can't work: all units share the item's single
`transform.opacity`; per-unit properties would need dynamic property paths
(`unit[3].opacity`), a much bigger resolver change than one scalar.

**B. Compile-time split into N text items (one per word/line) + staggered
`fadeIn`s — i.e. build reveal out of `$repeat`.** Rejected because
line/word boundaries require `measureText`, which would make the *compile*
pipeline (`src/compose/precompile.ts` — today four pure, host-independent
passes) depend on a rendering backend and a loaded font. Consequences:
canonical JSON differs per host (determinism break), compile becomes async
on font loading in a new way, source maps bloat with hundreds of synthetic
items, and editing the copy means re-exploding. Reveal-at-render keeps
canonical JSON copy-shaped and the store small.

**C. Grapheme segmentation via `Intl.Segmenter`.** Rejected on ICU-version
determinism grounds (§4.4).

**D. Measured ascent for box-mode first baseline.** Rejected to keep
vertical layout metric-free (§5.3).

## 8. MCP surface

- **`add_text` / `update_item`**: accept the new optional fields; tool
  descriptions document point-vs-box mode and the reveal fields. (DUAL
  `commands.ts` mirror, as §3.)
- **New tool `measure_text({ itemId, compositionId? })`** → the
  `TextLayout` of §4.3 (lines with text/x/y/width, blockWidth, blockHeight,
  lineCount, unitCount), computed with node-side skia metrics. This is the
  agent's replacement for eyes: "how tall did that paragraph wrap?" feeds
  directly into positioning the next item. Server metrics are authoritative
  (they are what `render_to_video` will use).
- **`list_engine_capabilities`**: advertise `textV2: true` plus the reveal
  units/modes, so agents can feature-detect (server.json + README + mcp-demo
  sync per the manifest test).
- **`apply_behavior`**: `textRevealIn`/`textRevealOut` appear via
  `list_behaviors` automatically.

## 9. Validation and lint

Semantic validator (`src/schema/validator.ts`), pure/sync, metric-free:

- `E_INVALID_VALUE`: `wrap`/`maxLines` present without `width`;
  `revealProgress`/`revealStagger` outside `[0,1]`; `lineHeight ≤ 0`;
  `maxLines < 1`; `width ≤ 0`.
- Existing `W_FONT_UNREGISTERED` unchanged (and matters more now: wrapping
  against a fallback system font produces host-dependent line breaks).

Compose-lint pass (Session 26 infrastructure), which runs where a driver
*may* be available:

- `W_TEXT_OVERFLOW` — a single word wider than the wrap box, or
  `wrap:"none"` lines exceeding `width` (metric-dependent ⇒ lint-tier, only
  emitted when metrics are available, mirroring how font lint degrades).
- `W_TEXT_CLIPPED` — `maxLines` dropped lines.
- `W_REVEAL_INERT` — reveal fields set but `revealProgress` is statically 1
  with no tween on it (invisible-outcome class: the agent thinks it authored
  a reveal and nothing animates).

## 10. Editor impact

- **Selection ring**: browser driver replaces the `fontSize × 0.6` glyph
  heuristic with real layout (`layoutText` + the live 2D context) — the
  ring finally hugs multiline blocks. Point-mode fallback keeps the
  heuristic when no context is reachable.
- **Pick buffer**: `paintTextHitArea` draws every laid-out line (same
  per-line `fillText` loop as the renderer) so all lines are clickable.
- **Inspector**: width/wrap/lineHeight/maxLines under a "Text box" group;
  reveal fields under "Reveal"; `revealProgress` scrubbable like any
  tweenable.
- **Timeline**: `revealProgress` tweens appear on the existing property-lane
  machinery for free (it's just a tweenable number).

## 11. Test plan (for the future implementation session)

1. Golden frames: point single-line (byte-identical to v1.0 goldens — the
   G4 regression gate), point multiline, box wrap word/char/none, each
   align, anchors in box mode, `fade`+`rise` reveals at P ∈ {0, 0.33, 1}.
2. `layoutText` unit tests with a fake linear-width measurer (deterministic,
   no skia needed): wrap decisions, overflow word, maxLines, unit
   segmentation incl. code-point emoji case.
3. Stagger math property tests: p_i monotone in P; P=0/1 boundary; s=0/1
   degenerate cases.
4. Determinism harness: new wrapped+reveal golden across CI runs.
5. Editor Playwright: add box text → ring matches block; click second line
   selects the item.
6. Eval-harness brief (Session 27 bench): "3-line staggered word reveal" —
   expected ≤ 3 tool calls, frame assertions at reveal midpoint.

## 12. Open questions

| # | Question | Lean |
|---|---|---|
| Q1 | `valign` (top/middle/bottom) inside the box? | Defer; `anchorY` covers most centering needs. |
| Q2 | `revealRise` distance as a param vs fixed `0.4·fontSize`? | Fixed now; promote to param if briefs demand. |
| Q3 | Tweenable `width` (animated re-wrap)? | No — discontinuous by nature; revisit with real demand. |
| Q4 | Grapheme-correct char reveal (emoji/ZWJ)? | Code points for determinism; revisit if a pinned segmentation library appears. |
| Q5 | `letterSpacing`? skia-canvas and modern browsers both expose `ctx.letterSpacing`. | Defer — audit skia/browser parity first. |
| Q6 | Should `measure_text` also run inside `validate` for overflow lint? | Yes at the MCP layer (async, driver in reach); the pure validator stays metric-free. |

## 13. Spec cross-check (COMPOSITION_PRIMITIVES.md)

- **§6.3/§6.7** — `textRevealIn/Out` follow the built-in behavior contract:
  pure `(args) → Tween[]`, stable `${parentId}__reveal` ids, discoverable
  via `list_behaviors`. No registry changes needed.
- **§16-O12 (behavior `delay` sugar)** — orthogonal; reveal stagger is
  *inside* one tween, not between sibling behaviors.
- **§17 risk "scope creep: variable fonts, conditionals…"** — respected:
  no rich spans, no conditional layout; the one new primitive-ish concept
  (reveal) is a renderer feature behind one tweenable scalar.
- **§10 compile pipeline** — untouched. Text v2 adds zero compile passes;
  that's the point of rejecting alternative B.
- **design-doc §9 convention** — when implementation is scheduled, schema
  additions land in `design-doc.md` §3 first; this document is the source
  material for that edit.

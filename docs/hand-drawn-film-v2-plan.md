# hand-drawn film 2.0: implementation plan

Builds the system described in `hand-drawn-canvas-animation-redesign.md`
(itself grounded in `hand-drawn-canvas-animation-analysis.md`). The v1 skill
at `.claude/skills/hand-drawn-canvas-animation` is inspiration and a port
source; it is not edited and keeps syncing from upstream.

This is a coding plan. Phases are ordered so that each ends with something
that runs. There are no review gates, design docs or reports between phases;
the only artefacts are code, example films, goldens and the skill files.

---

## 0. Shape of 2.0

**Decision: a standalone package plus a thin agent skill.**

- `handdrawn/` at the repo root. Plain ES modules, no build step, no browser
  dependency. Node needs `skia-canvas` and `ffmpeg`. It has its own
  `package.json` and is not a workspace of `davidup` (it can become one
  later; nothing in it imports from `src/`).
- The "small web app" is the player: one `player.html` shell plus
  `player.js`, served by `hdf dev <film>` with hot reload. It is also what
  `hdf bundle` inlines into a single shareable HTML.
- `.claude/skills/hand-drawn-film/` is the 2.0 skill. It is short, because
  the package does the work the v1 prose asked the agent to do: recipes are
  functions, lint replaces most of the checklist, packs replace "draw a
  puppet from scratch".

```
handdrawn/
  package.json            name "handdrawn", bin { hdf: "cli/hdf.mjs" }, deps: skia-canvas ^3
  core/                   the pure half + rasteriser (browser and Node)
    list.js  rand.js  curves.js  tree.js  looks.js  finish.js  tools.js
    text.js  glyphs.js  fx.js  raster.js  synth.js  lint.js  fit.js  index.js
  engines/                traced.js  sim.js  stage3d.js
  recipes/                shots.js  score.js  book.js
  packs/                  creatures.js  objects.js  tech.js  manifest.json  sheets/
  player/                 player.html  player.js  shell.css
  cli/                    hdf.mjs  render.mjs  worker.mjs  ffmpeg.mjs  sheets.mjs
                          dev.mjs  bundle.mjs  photo.mjs  clip-convert.mjs  donate.mjs
  films/                  example films (one .js each) + assets + goldens/
  test/                   node:test files
```

Author-facing surface is `core/index.js`, which re-exports: list
constructors, `cel`, `shot`, `seq`, `par`, `hold`, `cut`, `place`, `fx`,
`look`, `film`, curves and easings, `handText`, `signOff`, recipes and
motifs. Everything else is internal.

---

## 1. Fixed specifications

These are decided here so no phase re-derives them.

### 1.1 Paths

A path is polylines only. Curves are flattened at construction with a fixed
segment count, so transforms, projection, measuring and hashing are trivial.

```js
// { sub: [{ pts: number[] /* flat x0,y0,x1,y1,... */, closed: bool }], box: [x, y, w, h] }
circle(cx, cy, r, n = 48)        ellipse(cx, cy, rx, ry, n = 48)     rect(x, y, w, h)
roundRect(x, y, w, h, r, n = 6)  poly(pts, closed = true)            line(x0, y0, x1, y1)
cubic(p0, c0, c1, p1, n = 16)    spline(pts, { tension = .5, closed, n = 8 })   arc(cx, cy, r, a0, a1, n)
xf(path, m)  box(path)  len(path)  at(path, s)  inside(path, x, y)  resample(path, step)  union(...paths)
```

Logical units: short side 1080, `W`, `H`, `CX`, `CY` from the format.

### 1.2 Display list ops

```js
{ op: 'paper' }                                   // stock, bands, grain from the look; first op of a shot
{ op: 'night' }                                   // dark stock
{ op: 'fill',   path, role, finish?: true, cov?: 1 | { kind: 'radial'|'linear', ... }, alpha?, seed? }
{ op: 'stroke', path, role, tool: 'pen'|'brush'|'pencil'|'chalk'|'crayon'|'marker', w, wobble?, taper?, order?, alpha?, seed? }
{ op: 'dots',   path, role, cell, density?, angle?, blend?: 'multiply', seed? }
{ op: 'text',   str, x, y, size, role, tool, align?, order? }       // expanded by text.js into strokes
{ op: 'image',  src, x, y, w, h, sil?: path, alpha? }                // src is an asset id registered with the film
{ op: 'group',  name, xf: [a, b, c, d, e, f], kids, box?, cache?: 'auto'|'never', inputs? }
{ op: 'clip',   path, kids }
{ op: 'fx',     kind, args, kids, seed }
{ op: 'look',   look, kids }
{ op: 'meta',   tag: 'anchor'|'intent'|'shotStart'|..., data }       // read by lint only
```

`role` is a string (`paper ink chalk night shade light blush fills.N
accents.N inks.N`) or `{ base, tint?, shade?, alpha?, hue?, mix?: [role, t] }`.
Raw hex is never a role; lint fails it. `cov` and every other value in an op
is data, never a function, so a list is always hashable and serialisable.

### 1.3 Hashing, seeds, time

- `hash(list)`: FNV-1a 64 over a canonical walk (op tag bytes, key order
  fixed, numbers quantised to 1/1024, strings as UTF-8). Returns 16 hex.
  Memoised per op object in a WeakMap.
- Seeds are paths: `seedOf(parentSeed, name)` = 32-bit hash. `film` seed is
  `hash(filmName)`; shots derive from it; groups derive from their parent
  and their `name` (index if unnamed). Explicit `seed` overrides.
- `FPS = 12`, output 24. `t = k / 12`. Durations must satisfy
  `|d * 12 − round(d * 12)| < 1e-9` or `seq` throws at construction.
- Boil: `boil(i, every)` returns an integer phase to pass as a cel input.

### 1.4 Look

```js
{ name, palette: { paper, paperBand, ink, chalk, night, shade, light, blush, fills[], accents[], inks[] },
  finish: 'hatch'|'halftone'|'dots'|'graphite'|'wash',
  paper: 'bands'|'cream'|'pastel'|'night',
  tools: { pen: { w, wobble, bleed }, brush: { taper, amp }, pencil: {...}, chalk: {...} },
  edition: seedInt }
```

Six presets ported from v1: `paperInk`, `risoPop`, `screenSea`,
`pencilMinimal`, `blueprintNight`, `doodlePastel`. Derivations:
`derive(look, { hue, sat, light })`, `duotone(look, a, b)`, `pastel(look, n)`.
The look hash goes into every cache key.

### 1.5 Cache key and placement

`key = hash(node) + hash(look) + S + W + H`. A group is cached only when
its `xf` is a translation with optional x-flip (`a = ±1, d = 1, b = c = 0`).
Rotating or scaling groups draw direct. Cached blits snap to output pixels.
First sighting of a key draws direct; the second rasterises to a layer.

### 1.6 File formats

- **Film module**: `export default film({ name, look, timeline, score?, format?, assets? })`.
- **Traced clip** (found motion): `{ n, fps, h, credit, source, frames: [{ outer: path, lines: [{ path, w }] }] }`.
- **Cutout** (doodle photos): `{ name, credit, src: dataURL, w, h, sil: path }`.
- **Pack manifest**: `{ cels: [{ name, pack, box, inputs, desc, sheet: 'sheets/<name>.jpg' }] }`.
- **Goldens**: `films/goldens/<film>.json` = `{ frames: { "0": sha256, ... }, wav: sha256 }`
  over raw RGBA at 1:1 480 px wide (small, fast, still bit-exact).

### 1.7 CLI

```
hdf render <film.js> [--ar 1:1|16:9|9:16] [--width 1080] [--workers 4] [--out dir] [--disk-cache]
hdf grid   <film.js> [--n 24] [--width 480]
hdf only   <film.js> 0,37,74
hdf board  <film.js>                 storyboard cards
hdf sheet  <film.js> <cel>           cel at 3 scales × input extremes × every look + silhouette + 240 px
hdf lint   <film.js>
hdf changed <film.js>                frames whose list hash moved since last render, before/after
hdf golden <film.js> write|check
hdf dev    <film.js>                 serves player with hot reload on :4321
hdf bundle <film.js>                 single HTML
hdf photo  <img> --name --credit     cutout + silhouette path + check sheet
hdf clip   <roto.py json> --name     convert a traced clip to the v2 format
hdf donate <film.js> <cel...>        copy cels into a pack, regenerate manifest + sheets
```

---

## 2. Phases

### P0. Scaffold (half a day)

- `handdrawn/package.json` (`type: module`, bin `hdf`, dep `skia-canvas`,
  script `test: node --test test/`).
- `cli/hdf.mjs`: subcommand dispatch, flag parser, `loadFilm(path)` which
  does `await import(pathToFileURL(...))` and validates the default export.
- `core/index.js` re-export stub.
- `npm i` inside `handdrawn/`. Confirm `skia-canvas` loads on this machine.

Done when: `node cli/hdf.mjs` prints usage; `npm test` runs zero tests.

### P1. The pure half (1 to 2 days)

**`core/rand.js`** (40 lines): `hash32(...parts)`, `hash64(walker)`,
`seedOf(parent, name)`, `rng(seed)` (same generator as v1 so ported marks
look the same).

**`core/list.js`** (~200 lines): path constructors from 1.1; op constructors
`paper() night() fill() stroke() dots() text() image() group() clip() fx()
lookNode() meta()`; `hashList`; `bounds(list)` (union of boxes through
`xf`); `walk(list, visit)`; `mapPaths(list, f)` (used by projection and
fit); `serialise`/`parse` (JSON with paths as flat arrays).

**`core/curves.js`** (~120 lines): `curve(keys, ease)`, `ease.{linear, in,
out, io, back, bounce}`, `ramp(a, b, t, ease)` (v1 `sm`), `add mul delay
repeat pingpong clampC onTwos onThrees`, `follow(pathPoly)` → `{x, y,
heading}` at `t`, `pulse(i, every, hold)`, `flicker(i, period)`, `boil(i,
every)`. Every curve is `t => value` evaluated on the frame grid by the
caller; nothing here touches `Date` or global state.

**`core/tree.js`** (~250 lines):

```js
cel(name, draw, { box, inputs })         // returns (inputs = {}) => group op; quantises inputs by declared step
place(x, y, { rot, scale, flip }, node)  // sets xf; a rotation makes the node uncacheable, by 1.5
shot(name, dur, draw, { fit })           // draw({ t, k, i, T, seed, W, H, CX, CY, look }) => list
seq(...nodes)  par(...nodes)  hold(dur, node)  cut(kind, dur, a, b)  lookOn(look, node)
film({ name, look, timeline, score, format, assets })
frame(film, i)  // => { list, look, shot, t, k } ; the only entry point the rasteriser and lint use
describe(film)  // indented text: tree, durations, cues, cels per shot
cues(film)      // { shots: [{ name, t0, dur }], cuts: [t], end }  used by score and lint
```

`cut` evaluates `a` at its last frame and `b` at its first, and returns
`[group(a), fx(kind, { p }, [b])]`, so a transition is a node like any
other. `hold` evaluates its child at `T − 1/12`. `frame` assigns seeds top
down and wraps the shot's list in `look` if the shot or an ancestor set one.

**`core/fit.js`** (60 lines): `anchor` (default, content centred on `CX, CY`
of the target format), `reframe` (scale to cover), `letterbox` (draw in
1080² and pad with paper). Applied inside `frame` by rewriting `W, H, CX,
CY` passed to the shot, or by wrapping in a `group` with a scale.

**`test/list.test.js`, `test/tree.test.js`**: hashing is stable across
runs; adding a sibling does not change a neighbour's seed; a duration off
the grid throws; `frame(i)` of a 3 s film has 36 frames with `hold`
repeating the last; `cut` produces the expected op shape.

Done when: `npm test` passes and `hdf board films/mini.js` prints
`describe()` (cards come later).

### P2. One look, end to end (2 to 3 days)

Goal: the mini film from the analysis (a rolling ball, then a sign-off)
renders identically in the browser and in Node, in the `paperInk` look.

**`core/looks.js`** (~250 lines): colour maths ported from v1 (`parse mix
tint shade alpha withHsl rotateHue saturate lighten ramp harmony`),
`resolveRole(role, look)` → hex, the six presets, `derive duotone pastel`,
`hashLook`.

**`core/finish.js`** (~200 lines): `expand(list, look, S)`: a list-to-list
pass that turns every `fill{finish:true}` into geometry, clipped to the fill:
`hatch` → one `stroke` op with hundreds of short sub-polylines plus a
`dots`-like grain op; `halftone` → `dots` with per-ink angle and
`blend:'multiply'`; `dots` → straight grid; `graphite` → sparse thin
strokes; `wash` → an offset translucent fill. Riso coverage (`cov`) sets
dot radius per cell; `cov` descriptors (radial, linear) are evaluated per
cell centre. Overlapping inks mix through multiply, which is the v1 plate
model without the plate canvas. This phase implements `hatch` and grain
only; the others land in P5.

**`core/tools.js`** (~250 lines): `drawStroke(ctx, op, look, S, seed)` for
`pen` (v1 `wob`), `chalk` (dashed alpha), `brush` (v1 `brush`, pressure
taper), `pencil`, `crayon`, `marker`. Partial reveal: `op.order` plus the
list-level `reveal(p, node)` helper that trims each stroke's polyline to
`p` of its length in `order`. This phase: `pen` and `chalk`.

**`core/glyphs.js`** (data) + **`core/text.js`** (~120 lines): a single-stroke
font drawn by hand as polylines in a 100-unit em: `a–z`, `0–9`, `. , : ' -
! ? &`; uppercase maps to lowercase forms at 1.25× until P5 adds true
capitals. `handText(op)` → group of `stroke` ops with per-glyph seeds, a
baseline drift curve and an optional second-ink offset. `signOff(a, b, {
x, y, size, pA, pB })` → two dots then two words revealed in stroke order.
`squiggleText(box, lines, seed)` for pencil-look text walls.

**`core/raster.js`** (v0, ~120 lines): `draw(ctx, list, { look, S, W, H })`
without caching: `paper`, `fill`, `stroke` → tools, `dots`, `group`
(setTransform), `clip`, `look` (push/pop). Rejects unknown ops.

**`player/player.html` + `player/player.js`** (v0): loads a film module by
`?film=`, draws frame `?frame=N` on a canvas at `?w=`, exposes
`window.__frame(i)` and `__NDRAW`. No UI yet.

**`cli/render.mjs`** (v0): single thread, skia `Canvas`, `frame(i)` →
`expand` → `draw` → `toBuffer('raw')` → ffmpeg stdin (`-f rawvideo
-pix_fmt rgba -framerate 12 ... -r 24 -pix_fmt yuv420p -crf 18`). Copy
the spawn, backpressure and drain handling from
`src/drivers/node/index.ts` (lines 470 to 520) rather than re-deriving it.
`hdf grid` and `hdf only` write JPEG sheets and PNGs through skia.

**`films/mini.js`**: the analysis film in the new API (about 30 lines).

Done when: `hdf render films/mini.js` writes `out/mini.mp4`; `hdf grid
films/mini.js` matches `docs/hand-drawn-canvas-mini/mini-grid.jpg` by eye;
`hdf dev` is not needed yet, opening `player.html?film=../films/mini.js`
from a static server shows the same frame.

### P3. The renderer proper (2 to 3 days)

**`core/raster.js`** (final): hashing per group with the key from 1.5; the
"seen once, cache on second sighting" rule; LRU by bytes (`--cache-mb`,
default 512); snapped blits; `fx` dispatch to `fx.js`; optional disk cache
`.cache/<key>.png` via a `store` interface (Node: files; browser: none).
Frame-level dedup: `frame(i)` list hash equal to the previous → return
`{ dup: true }` and the driver rewrites the last raw buffer.

**`core/synth.js`** (~150 lines): event `{ t, dur, hz, type, gain, attack =
.02, release = 'exp' }`, `type` in `sine triangle square saw noise`; render
to `Float32Array` at 44.1 kHz, ADSR exactly as v1 `note` and `noiseBurst`
(linear attack to `gain` over 20 ms, exponential release to 0.0008); master
gain clamp 0.6; `toWav16(samples)`. `pentHz(octave, step)`.

**`recipes/score.js`**: motifs from the v1 table as functions returning
events: `plucks(t0, dur)`, `swell(t0, dur)`, `cueNotes(times)`,
`travel(t0, dur)`, `sparse(t0, dur)`, `impact(t)`, `dyad(t0, dur)`. A
film's `score` is `(cues) => events[]`; `film()` stores it, the driver
renders it, the player plays the rendered buffer through Web Audio so
both hear the same samples.

**`cli/worker.mjs` + `cli/render.mjs`** (final): `--workers N` (default
`min(4, cores)`), each worker imports the film, owns a skia canvas and a
cache, renders a contiguous range, posts `{ i, buf }` with the buffer
transferred; the main thread writes frames in order to ffmpeg with a
bounded reorder window, then muxes the WAV (`-c:v copy -c:a aac
-shortest`). Contact sheet at two tiles per second with cut lines and
note onsets drawn under the tiles (`cli/sheets.mjs`).

**`hdf golden write|check`**: sha256 per drawn frame at 480 px plus the WAV.

**`test/raster.test.js`**: cached vs direct render of `mini` differ by zero
channels on skia (CPU raster, no premultiplication drift at integer
placement); dedup count on `mini` equals 6 of 36 as measured for v1.

Done when: `hdf render films/mini.js --workers 4` is bit-identical to
`--workers 1` (golden check), and `out/mini-final.mp4` has sound.

### P4. Artefacts before pixels (1 to 2 days)

**`core/lint.js`** (~200 lines), all over `frame(i)` lists and `cues()`:

| check | how |
|---|---|
| role not in look, raw colour | walk `fill/stroke/dots/text` roles |
| shot's first op not `paper/night/image(backdrop)` | first op of each shot at `k = 0` |
| two finishes in one shot, or a `look` op inside a shot | collect per shot |
| anchor absent from a shot | `meta{tag:'anchor'}` present in every shot's list |
| more than two scribbled parts | count `fx{kind:'scribble'}` per frame |
| cel ops outside its declared box | `bounds(kids)` vs `box` |
| text words per shot above the look's allowance | count `text` ops |
| `cut` longer than 1 s, two cuts adjacent | from the tree |
| sign-off not complete 1.5 s before the end | the last shot's `signOff` reveal `p` at `end − 1.5` |
| subject box under the 240 px floor, or cut by the edge without `meta{intent:'crop'}` | `bounds` of the anchor group scaled by 240/1080 |
| cue not on the 1/12 grid | `cues()` (already thrown by `seq`, reported here too) |
| `Math.random`, `Date`, `filter`, `shadowBlur`, `createLinearGradient` in film source | static grep of the module text |

`hdf lint` prints `file:shot:frame  rule  detail` and exits 1 on any.

**`hdf board`**: one card per shot (name, duration, look, camera, anchor
present, recipe name if from `recipes/`) as a JPEG grid, drawn with the
list API itself so it is in the house style.

**`hdf sheet <cel>`**: the cel at 0.6, 1, 1.8 scale, at each input's min
and max, in every preset look, its silhouette (union of fills), and a 240
px cell. One JPEG.

**`hdf changed`**: keep `out/<film>.hashes.json`; on the next run render
only frames whose list hash moved and write a before/after grid.

Done when: `hdf lint films/mini.js` is clean, and deliberately breaking
each rule in a scratch film produces exactly one finding.

### P5. Looks, fx, recipes (3 to 4 days)

**`core/finish.js`** completes `halftone`, `dots`, `graphite`, `wash`.
Riso extras as list helpers: `knockout(path)` (a `fill` with `cov: 0`),
`plateOrder` by `inks` index (darkest last).

**`core/tools.js`** completes `brush`, `pencil`, `crayon`, `marker`;
adds `gouache` (opaque white with a dry edge).

**`core/fx.js`** (~250 lines), each `(ctx, args, renderKids, seed, S)`:
`blot` (reveal kids through a bristly blob at `p`), `iris`, `mosaic` (hex
retile, cell ≥ 12 px), `flash`, `flicker`, `nightShot` (kids drawn twice,
ink inside light pools and chalk outside, masked), `bleed` (seeded
diffusion widening strokes), `glow`, `scribble` (misregistered accent
hatch over a part; counted by lint), `photoMask` (clip kids to a cutout's
silhouette). All read their randomness from `seed`.

**Photos**: `cli/photo.mjs` ported from v1 (rembg, then flood fallback),
now also tracing the alpha into a silhouette path with marching squares
on skia `getImageData`, emitting the cutout format from 1.6 into
`<film>-photos.js`. `image` ops carry `sil`, so `rim(cutout, side, v)`,
`shadow(cutout)`, `mask` are list-level helpers over that path.

**`core/glyphs.js`**: true capitals.

**`recipes/shots.js`**: every v1 recipe that is more than a sentence
becomes a function returning a `shot` (or a `seq`), with the parameters
the prose lists. Names follow v1 letters so `scenes.md` stays a lookup:
`establishing` (A), `blotToBlueprint` (B), `sparkConstruct` (C),
`doubling` (D), `bands` (E), `macroInsert` (F), `followTravel` (G),
`povMosaic` (H), `network` (I), `impact` (J), `vibration` (K),
`timePassing` (L), `coda` (M), `seedRipples` (N), `montage` (O),
`badgeGallery` (P), `duotoneBeat` (Q), `starfield` (R), `signOffShot` (S),
`landscapeDayNight` (U), `origami` (V), `tornPage` (W), `darkSection` (X),
`patternSampler` (Y), `enso` (Z), and the doodle set `becomesVehicle`
(AA), `livesInside` (AB), `doesItsJob` (AC), `timeOnIt` (AD),
`nightFalls` (AE), `printsOnALine` (AF), `lightEscapes` (AG),
`alongTheEdge` (AH), `insideTheTube` (AI), `looksBack` (AJ), `getaway`
(AK), `caughtLetGo` (AL), `sunrise` (AM). `T` (constant protagonist) is a
`film` option, not a shot. Motifs, lattices and marks that recipes need
(`seedDot ripples dashedRing dottedArc plant tornEdge section stickyNote
thread hexLattice aster dotBurst speedLines loops construction cross`)
are ported into `core/list.js` helpers as list-returning functions.

**Camera**: `cam({ x, y, zoom, rot })` and `whip` are list-level: a shot
returns `group({ xf: cameraMatrix }, kids)`. A `follow` recipe composes it
with `curves.follow`.

**Films**: port `four-looks` (all four flat looks and their devices) and
`fly-style` (recipes A to H) to `films/`. Write goldens.

Done when: both films render in every preset look by changing the root
`look` only, lint is clean on both, and their grids match the v1 previews
by eye.

### P6. The player (1 to 2 days)

**`player/player.js`** (~300 lines): transport (play, pause, scrub, frame
step, loop), sound from the synth buffer through an `AudioBufferSource`
started at the scrub position, onion skin (lists of `i − 1` and `i + 1`
drawn in chalk at low alpha, from the same `frame()`), a shot list from
`describe()` that jumps on click, a panel with one slider per declared
input of the selected cel and a "copy values" button that writes the
inputs object to the clipboard, and a hash-changed indicator.

**`cli/dev.mjs`**: static server on `:4321` serving `handdrawn/` and the
film's directory, an SSE endpoint that fires on file change; the player
re-imports the film with a cache-busting query and jumps to the first
frame whose list hash changed.

**`cli/bundle.mjs`**: single HTML: the shell, an import map whose entries
are `data:text/javascript;base64,...` for every module the film imports
(walked from `import` statements), assets inlined. No bundler.

Done when: `hdf dev films/fly-style.js` scrubs with sound, editing a
curve in the film jumps the player to the changed frame, and `hdf bundle`
produces a file that opens from disk and plays.

### P7. Engines (4 to 5 days)

**`engines/traced.js`** (~150 lines): `registerClip(name, data)` on the
film's `assets`; `traced(name, k, { h, flip, rot, fill, wash, ink, weight,
p })` returns a group: `fill` of the outer contour, optional `wash`, and
`brush` strokes with widths scaled by `h / clip.h`, ordered longest first so
`reveal` works. `gap(name, k)`, `airborne(name)`. `cli/clip-convert.mjs`
turns `roto.py` JSON (unchanged script, copied into `cli/`) into the 1.6
format. Port `gallop` with its clips.

**`engines/sim.js`** (~300 lines): `sim(name, { N = 540, world, dt = 1/48,
every = 24, gestures, init, tint })` returns a node factory `bed(t)` that
yields an `image` op. State is a `Float32Array` height field plus grain
and hand state; `stateAt(k)` rebuilds from the nearest checkpoint (a
cloned typed array every `every` drawn frames, kept in a Map). Gestures
ported from v1 `G.*` (`pour sprinkle finger palm comb dab fill wind fly
move`), `scanFill`, `circlePts`, `spiralPts`, the shading in `sandImage`,
and `sandLook` as a camera curve. Workers: a worker whose range starts at
`k` calls `stateAt(k)` once, which steps from checkpoint `floor(k /
every) · every`. Port `one-year`.

**`engines/stage3d.js`** (~300 lines): `stage3d({ cam, light, floor },
...sheets)` and `sheet3(node, quad, { back })`. Because paths are
polylines and finishes are already geometry, projection is per point
through the pinhole camera (`cam3`, `proj3` ported), so fills and strokes
land in screen space as ordinary ops and the pen strokes them crisp;
stroke `w` scales with depth. `image` ops are the one exception and use
the v1 triangle mesh (`quad3`) on a temporary raster. Shading: Lambert
darkening becomes a `role.shade` amount on the sheet's fills. Shadows:
project the union of the sheet's fills along the light onto the floor
plane as a translucent `fill`. **`recipes/book.js`**: `book3` ported on top
(leaves on a spine, spreads, cut-outs rising with the spread). Port
`moon-book`.

Done when: `gallop`, `one-year` and `moon-book` render with goldens, and
`hdf render --workers 4` on `one-year` matches `--workers 1`.

### P8. Packs, doodle film, goldens (2 days)

- `packs/creatures.js` (fly, horse-from-trace, hedgehog), `packs/objects.js`
  (paper boat, teapot, lamp, book), `packs/tech.js` (GPU, server, token,
  chip): cels harvested from the ported films, each with `box`, `inputs`,
  `desc`. `hdf donate` copies a cel's source (via `toString` on the draw
  function plus its declared metadata) into a pack and regenerates
  `manifest.json` and `sheets/<name>.jpg` with `hdf sheet`.
- Port `held-once` (doodle look, five cutouts) as the photo example, with
  cutouts regenerated by `hdf photo` from the v1 data URLs.
- `hdf golden write` for every film in `films/`; `npm test` runs `golden
  check` on all of them.
- `npm test` also runs lint on every film.

Done when: `npm test` is green from a clean checkout after `npm i` (skia
prebuilt) with ffmpeg on PATH.

### P9. The 2.0 skill (1 day)

`.claude/skills/hand-drawn-film/`:

- `SKILL.md` (under 250 lines): what it is, the six looks, the three
  engines, the procedure below, the rules that lint cannot check (taste:
  composition, timing, one idea per shot), and the review list reduced to
  what needs eyes.
- `references/api.md`: generated from `core/index.js` JSDoc by a small
  script, one line per export.
- `references/recipes.md`: the v1 `scenes.md` timing prose kept, each
  entry pointing at its function and parameters.
- `references/looks.md`: palettes, deriving, finishes, riso coverage.
- `references/engines.md`: found motion, sand, paper in space, condensed.
- `references/brief-template.md`: unchanged from v1.
- `examples/`: symlink or copy of `handdrawn/films/`.

Procedure the skill prescribes:

1. Fill the brief. Pick a look and an anchor.
2. Write the timeline from recipes and packs; `hdf board`; look once.
3. Write or pick cels; `hdf sheet <cel>` for each; look once per cel.
4. `hdf lint` until clean. `hdf grid --n 24`; look once.
5. Fix; `hdf changed`; look at the changed frames only.
6. `hdf render`; look at the contact sheet once. Deliver mp4, film file,
   bundle.

Done when: a fresh agent session given the skill and the prompt "20
seconds, the life of a request inside a GPU server, riso look, a seed dot
as the anchor" produces a film using only packs, recipes and one new cel,
with lint clean before the first full render.

---

## 3. Port map (v1 `core.js` → 2.0)

| v1 | 2.0 |
|---|---|
| `setFormat W H CX CY S` | `film({ format })`, values passed into every shot's context; `fit.js` |
| colour maths, `PALETTES usePalette makePalette derivePalette duotone pastel` | `looks.js` |
| `rng easeIO easeOut easeIn sm flicker pulse boil` | `rand.js`, `curves.js` |
| `ellPts ellPath circPath rectPath roundRectPath polyPath pathLength bez spline splinePath` | `list.js` paths |
| `layer cam resetT setView viewT whip blit` | `group` with `xf`; camera helpers in `list.js`; layers are the rasteriser's business |
| `wob crayon brush pen` | `tools.js` |
| `hatch grain dotScreen surface plate printPlate` | `finish.js` expansion; `dots` op |
| `paper night backdrop` | `paper`/`night` ops interpreted by the look; `backdrop` is a `fill` of the frame |
| `scribble cross construction squiggleText handText signOff` | `fx.scribble`, `list.js` marks, `text.js` |
| `hexPath hexCells hexLattice aster dotBurst speedLines loops seedDot ripples dashedRing dottedArc plant tornEdge section stickyNote thread` | `list.js` list-returning helpers |
| `selfDraw` | `reveal(p, node)` over `order` |
| `blot iris mosaic flash montage badges` | `fx.js` for the raster ones; `montage`, `badges` are `recipes/shots.js` |
| `registerPhoto PHOTOS photo photoFront photoSheet place on onAll nightfall glow chalkPalette nightShot rim wash gouache doodle` | `image` op with `sil`; `fx.nightShot`, `fx.glow`; `rim shadow mask` helpers; `wash gouache` in tools/finish |
| `styleSheet paletteSheet gridSheet` | `hdf sheet`, `hdf board`, `hdf grid` |
| `defineFilm drawFrame buildPlayer` | `film`, `frame`, `player.js` |
| `note noiseBurst pentHz` | `synth.js`, `recipes/score.js` |
| `roto.js`, `sand.js`, `paper3d.js` | `engines/traced.js`, `engines/sim.js`, `engines/stage3d.js` + `recipes/book.js` |
| `render.mjs` (puppeteer) | `cli/render.mjs` (skia, workers, raw frames) |
| `photo.mjs` | `cli/photo.mjs` + silhouette tracing |
| `roto.py` | copied unchanged; `cli/clip-convert.mjs` |

Not ported: `HAND_FONT` and every host-font dependency; `Path2D` in
author code; the `mode: 'blueprint'` branch (a look now); the manual cache
pattern; `window.__*` hooks other than `__frame` and `__NDRAW` kept for the
player.

---

## 4. Films to port and their role

| film | look/engine | proves |
|---|---|---|
| `mini` | paperInk | P2 end to end, dedup count, cache exactness |
| `four-looks` | riso, screen, pencil, ink | finishes, riso multiply, look switch on a cut |
| `fly-style` | ink + blueprint | recipes A to H, camera follow, mosaic, blot cut |
| `held-once` | doodlePastel | cutouts, `sil`, rim, nightShot, brush, wash, gouache |
| `gallop` | traced | found motion, reveal on traced strokes |
| `one-year` | sim | checkpoints, workers on a stateful engine, one take |
| `moon-book` | stage3d | projection, shading, shadows, `book3` |

`night-shift`, `one-seed` and `paper-horse` are not ported in 2.0; the
skill points at their v1 files as reading for ambitious briefs.

---

## 5. Out of scope for 2.0

- Hosting films as a `davidup` item type and MCP tools for beats and cels
  (redesign step 8). The list format is JSON-serialisable and `frame(i)`
  is pure, which is all that step needs later.
- GPU or WebCodecs rendering; the skia path is the deliverable, the browser
  is the preview.
- A visual editor beyond the player's sliders.
- Chrome/puppeteer rendering. Removed entirely.

## 6. Rough total

| phase | days |
|---|---|
| P0 scaffold | 0.5 |
| P1 pure half | 1.5 |
| P2 one look end to end | 2.5 |
| P3 renderer, synth, workers, goldens | 2.5 |
| P4 lint, board, sheet, changed | 1.5 |
| P5 looks, fx, recipes, two films | 3.5 |
| P6 player, dev server, bundle | 1.5 |
| P7 three engines, three films | 4.5 |
| P8 packs, doodle film, goldens | 2 |
| P9 skill | 1 |
| | **~21 days** |

P0 to P4 are the product; a film written against P4 keeps working through
P9 without changes.

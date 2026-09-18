# The hand-drawn-canvas-animation skill: how it works, and how to grow it

An analysis of `.claude/skills/hand-drawn-canvas-animation` (upstream:
`alesha-pro/tools`, commit `9dee46e`), written after reading every file in
it, building the smallest possible film on top of it, and profiling the real
render pipeline on this machine.

Part 1 explains what the skill is and what happens under the hood, with a
runnable 40-line film. Part 2 separates what the LLM does from what is
deterministic, with measured costs. Part 3 proposes extensions built around
composability (assets as functions in a tree) and around cutting both LLM
tokens and wall-clock time. Every number in this document was measured here
unless it is labelled as an estimate.

The runnable example, the memoisation prototype and the grid sheet it
produced live next to this file in `docs/hand-drawn-canvas-mini/`.

---

## Part 1. What it is and how it works

### 1.1 One paragraph

The skill makes 10 to 45 second films that look hand-drawn, hand-printed,
drawn on photos, poured in sand, or stood up as a pop-up book. Nothing is a
video model and nothing is an image, except the photo in the doodle look.
A film is **one HTML file** that loads a shared `core.js` and defines three
things: a palette, a list of scene functions with durations (the timeline),
and optionally a score. Each scene function draws one frame on a Canvas 2D
context given the time since the scene started. A headless Chrome calls that
function for every frame, pulls the pixels out as PNG, and ffmpeg packs them
into an mp4. The same page renders the score offline through Web Audio into a
WAV that ffmpeg muxes in. The LLM's job is to write the HTML file; the core,
the renderer and the audio path are fixed code.

### 1.2 The pipeline end to end

```
 user request
      │
      ▼  (LLM)                       (LLM edits)                 (deterministic)
 brief + beat sheet  ───►  my-film.html  ─────────────►  render.mjs  ───►  Chrome (headless)
 palette, anchor            palette                       puppeteer            core.js + film
 puppets, scenes            PUPPET section                                     drawFrame(i) for i in 0..N-1
 score notes                SCENES section                                     canvas.toDataURL('image/png')
                            SCORE section                        ◄────── PNG per frame, as base64
                            defineFilm({timeline, score})                       OfflineAudioContext → WAV
                                                          ffmpeg
                                                            ├─ 12 fps PNGs → 24 fps mp4 (each frame doubled: "on twos")
                                                            ├─ contact sheet (2 tiles / second)
                                                            └─ mp4 + WAV → <film>-final.mp4
      ▲
      └──── the LLM looks at out/<film>-grid.jpg or the contact sheet, fixes the file, re-renders
```

The loop at the bottom is the whole working method: the skill insists that a
frame cannot be judged from code, so every step ends with "render and look".

### 1.3 The seven mechanisms in `core.js`

`core.js` is 498 dense lines and about 130 top-level functions. It reads as
a library, but it is really seven ideas.

**1. A logical frame, scaled at the end.** The short side of the frame is
always 1080 logical units; `W`, `H`, `CX`, `CY` follow the aspect ratio
(`setFormat`). A single scale factor `S` maps logical units to output pixels
and is baked into the context transform (`resetT(c)` is
`setTransform(S,0,0,S,0,0)`). Scenes never see pixels, so one film renders
square, wide, tall, 1080 or 4K by changing a flag on `render.mjs`.

**2. A pure frame function over a timeline.** `defineFilm` sums the
durations, computes `NDRAW = seconds × 12`, and installs `drawFrame(i)`:
find the timeline entry containing `t = i/12`, reset the transform, call
`scene.fn(ctx, tau, i)` where `tau` is seconds into the scene and `i` the
global drawn frame. There is no state between frames. This is the property
everything else rests on: any frame can be rendered alone, in any order, on
any machine, and it comes out the same.

**3. Seeded randomness everywhere.** `rng(seed)` is a tiny hash-based
generator; `Math.random` is banned. Every texture, jitter, speckle and
scribble takes a seed. That is why textures do not "boil" between the frames
of a still shot, and why deliberate boil is a function (`boil(i, every)`)
that changes the seed on a schedule rather than an accident.

**4. A palette as global state.** `PAL` has fixed keys (`paper`, `ink`,
`night`, `chalk`, `fills[]`, `shade`, `light`, `blush`, `accents[]`,
`inks[]`, `finish`). Scenes address colours by role, never by hex. Because
the roles are fixed, `usePalette('risoPop')` re-colours a scene written for
`paperInk`, and `derivePalette`, `duotone`, `pastel` build new ones from old.
The `finish` key is read by `surface()`, so the same puppet code hatches in
the ink look and halftones in the riso look.

**5. Fill, then finish, then a wobbly outline.** Every drawn shape is a
`Path2D` filled flat, then textured by `surface(c, path, box, opts)`
(hatching and grain, a rotated dot screen, a straight dot grid, or sparse
graphite, depending on `PAL.finish`), then outlined with `wob()`, a polyline
with seeded jitter that deliberately does not coincide with the fill. The
riso look adds a real print model: draw ink coverage in black on a white
"plate" canvas, then `printPlate` samples it at a coarse cell size and prints
halftone dots with `multiply`, so overlapping inks mix like ink on paper.

**6. Layers and composition.** `layer()` makes an offscreen canvas in output
pixels that follows the format. Transitions are compositions of layers:
`blot` reveals one layer through a bristly blob, `iris` clips a draw
callback to a circle, `mosaic` re-tiles a layer as a hex grid, `montage`
picks one card function per 0.25 s, `badges` renders cards once and caches
them as round stamps. The doodle look adds `photo`, `doodle` (a stroke-order
drawing that draws itself on), `nightShot` (draw the shot twice, in ink
inside the pools of light and in chalk outside them, masked by a light
layer) and `rim` (walk along the real alpha silhouette of a cutout).

**7. Render hooks and an offline score.** `defineFilm` exposes
`window.__frame(i)` (draw frame i, return it as a PNG data URL),
`window.__grid(n)` (n evenly spaced frames tiled into one JPEG),
`window.__wav()` (the score rendered through an `OfflineAudioContext` into
16-bit WAV, base64), plus `__NDRAW`, `__size`, `__ready`. `render.mjs`
opens the page with `?bare=1`, waits for `__ready`, and calls these. The
score is a function `(ac, t0, dest)` that schedules oscillators; because it
reads the same `TIMELINE`, cues land on cuts by construction.

The three engines each replace one part of "draw the frame":

| engine | file | what it swaps out | how |
|---|---|---|---|
| found motion | `roto.js` + `roto.py` | where the poses come from | `roto.py` traces each frame of a clip into closed silhouette contours plus skeleton strokes with pen widths; `roto(c, clip, k, …)` redraws pose k with the core's `brush`. |
| sand | `sand.js` | what the frame is made of | a `Float32Array` height field (540×540 cells) on a backlit "glass"; gestures (pour, finger, palm, comb, wind, fly) modify it at a fixed 1/48 s step; `sandImage` shades the field to pixels. Purity is kept by rebuilding from zero when an earlier time is requested. |
| paper in space | `paper3d.js` | where the paper is | sheets are 2D canvases (`tex3`) mapped onto 3D quads with a mesh of affine-transformed triangles (`quad3`), with a pinhole camera (`cam3`, `proj3`), Lambert-style darkening (`shadeOf`) and projected silhouette shadows; `book3` turns that into leaves on a spine and pieces that stand up as a spread opens. |

### 1.4 The simplest possible film

This is `docs/hand-drawn-canvas-mini/mini.html`. It was rendered and
verified here. A ball rolls in for two seconds, then a one-second sign-off.
Three seconds is 36 drawn frames and 72 output frames.

```html
<!doctype html>
<meta charset="utf-8">
<title>mini</title>
<canvas id="c" width="1080" height="1080"></canvas>
<script src="core.js"></script>
<script>
'use strict';
usePalette('paperInk');

// PUPPET: geometry once (Path2D), drawn per frame with fill -> surface -> wobbly outline.
const BALL = circPath(0, 0, 90), BOX = [-90, -90, 180, 180];
function drawBall(c, seed) {
  c.fillStyle = PAL.fills[0]; c.fill(BALL);           // 1. flat fill
  surface(c, BALL, BOX, { seed });                    // 2. finish (hatching + grain, because PAL.finish === 'ink')
  c.strokeStyle = PAL.ink; c.lineWidth = 2.6;
  wob(c, ellPts(0, 0, 90, 90), 1.8, seed + 1, true);  // 3. jittered outline that never coincides with the fill
}

// SCENE 1: pure function of (tau, i). Same inputs, same pixels.
function sceneRoll(c, tau, i) {
  paper(c);                                           // stock colour + bands + grain, resets the transform
  const x = lerp(CX - 400, CX + 300, sm(0, 1.6, tau, easeOut));   // eased motion, sampled on the 12 fps grid
  c.strokeStyle = PAL.ink; c.lineWidth = 3; wob(c, [[0, CY + 100], [W, CY + 100]], 2, 7);   // floor
  c.save(); c.translate(x, CY); c.rotate(x / 90); drawBall(c, 3); c.restore();
  if (pulse(i, 6)) construction(c, x, CY, 110, 9);    // guide lines flash one frame in six
}
// SCENE 2: the signature. The cut between scenes is hard: no tween, just a new timeline entry.
function sceneSign(c, tau) { paper(c); signOff(c, 'mini', 'film', { x: CX, y: CY, progressA: sm(0, .5, tau), progressB: sm(.5, 1, tau) }); }

// SCORE: the same timeline drives the music, so notes land on the cut.
function score(ac, t0, dest) { const m = ac.createGain(); m.gain.value = .5; m.connect(dest);
  for (let t = 0; t < 2; t += .5) note(ac, m, pentHz(0, t * 2), t0, t, .4, 'triangle', .2);
  note(ac, m, pentHz(-1, 0), t0, 2, 1, 'sine', .3); }

defineFilm({ timeline: [{ name: 'roll', dur: 2, fn: sceneRoll }, { name: 'sign', dur: 1, fn: sceneSign }], score });
</script>
```

To run it:

```bash
mkdir mini && cd mini
SK=/path/to/.claude/skills/hand-drawn-canvas-animation
cp $SK/assets/core.js $SK/scripts/render.mjs $SK/scripts/package.json .
cp /path/to/docs/hand-drawn-canvas-mini/mini.html .
npm i --no-audit --no-fund            # puppeteer-core only; uses the Chrome you have
node render.mjs mini.html --grid 12   # 12 evenly spaced frames in one JPEG, in about a second
node render.mjs mini.html             # out/mini.mp4, out/mini-contact.jpg, out/mini-score.wav, out/mini-final.mp4
```

The grid sheet it produced (`docs/hand-drawn-canvas-mini/mini-grid.jpg`):
the ball rolls right and slows down (easeOut), the construction lines show
only on frames 0 and 6 (`pulse(i, 6)`), and after the cut the two words of
the sign-off write themselves in, with the two ink dots first.

**What happens for drawn frame 6, step by step.**

1. `render.mjs` evaluates `window.__frame(6)` in the page.
2. `drawFrame(6)`: `t = 6/12 = 0.5 s`; the first timeline entry (`roll`,
   2 s) contains it, so `sceneRoll(ctx, 0.5, 6)` is called after
   `resetT(ctx)`.
3. `paper(c)`: resets the transform, fills `#f3e6cf`, draws the diagonal
   light bands from `PAL.paperBand`, then 1400 seeded speckles. Seed 5, so
   the speckles are the same on every frame.
4. `sm(0, 1.6, 0.5, easeOut)` = `1 − (1 − 0.3125)³` ≈ 0.675, so
   `x ≈ 140 + 700 × 0.675 ≈ 612`.
5. The floor is a two-point `wob` polyline with seed 7: the same jitter on
   every frame, so it does not shimmer.
6. `drawBall`: fill the circle with `PAL.fills[0]`; `surface` sees
   `PAL.finish === 'ink'` and lays a hatch layer (one `beginPath`, hundreds
   of short segments, one `stroke`) plus 140 grain rects, both clipped to the
   circle, both from seed 3; then the outline from seed 4, jittered by up to
   1.8 units.
7. `pulse(6, 6)` is true (6 mod 6 = 0), so `construction` draws its three
   guide lines with ticks, a circle and five crosses around the ball.
8. `drawFrame` resets the transform and alpha; `__frame` returns
   `canvas.toDataURL('image/png')`; `render.mjs` writes `0006.png`.
9. Output frames 12 and 13 of the mp4 are both this PNG (ffmpeg reads at
   12 fps and writes at 24).

Everything the LLM had to decide is in the 25 lines between the two script
tags. Everything else is deterministic code.

---

## Part 2. What the LLM does, what is deterministic, and what it costs

### 2.1 The split today

| stage | who | what exactly |
|---|---|---|
| brief, beat sheet, anchor, look, palette choice | LLM | fills `brief-template.md`; chooses recipes from 39 prose descriptions in `scenes.md` |
| puppet geometry and pose parameters | LLM | `Path2D` parts in local coordinates, a pose object, a draw function with an ink/blueprint switch |
| scene code | LLM | 8 to 14 functions of `(c, tau, i)`, each re-implementing a recipe from prose with kit calls |
| score | LLM | oscillator notes placed against the beat sheet, using the motif table as guidance |
| review | LLM vision | opens the grid or contact JPEG, walks the 15-item checklist, decides fixes |
| colour maths, palettes, finishes, marks, motifs, reveals, camera | deterministic | `core.js` |
| timeline → frame index → scene call | deterministic | `defineFilm`, `drawFrame` |
| frames → mp4 → contact sheet → WAV → final mp4 | deterministic | `render.mjs`, Chrome, ffmpeg |
| photo cut-out, coordinate check sheet | deterministic (rembg model) | `photo.mjs` |
| tracing motion into strokes | deterministic | `roto.py` |
| sand physics, 3D projection | deterministic | `sand.js`, `paper3d.js` |

The grey zone, where prose currently makes the LLM do deterministic work by
hand:

- The 39 scene recipes are prose. Each film re-derives the code for
  "establishing shot on a textured surface" or "ink blot into blueprint".
  `examples/four-looks.html` and `fly-style.html` contain working versions,
  so the LLM either reads 17 to 40 KB of example and adapts it, or
  reinvents it.
- The 14 style rules and the 15-item review checklist are enforced by
  looking at pictures. At least nine of them are mechanically checkable
  (see 3.3).
- The score motif table is prose; the score is hand-placed notes.
- Caching of static layers is a documented pattern that each film
  implements by hand.

### 2.2 What a film costs the LLM (measured sizes, estimated tokens)

| thing | size | note |
|---|---|---|
| `SKILL.md` + all references | 17,460 words | the procedure tells the agent to read `style.md`, `palettes.md`, `scenes.md`, `architecture.md` before drawing: about 9,000 words, roughly 12k tokens (estimate) |
| look-specific reference | 1,100 to 2,600 words | `doodle.md` is the largest at 2,583 |
| `core.js` | 66 KB, 498 lines | the API index in `architecture.md` is meant to spare reading it; in practice an agent debugging a call reads parts of it |
| one example film | 17 to 40 KB | `night-shift.html` is 39.7 KB; about 5 to 12k tokens each (estimate) |
| the template the LLM starts from | 8.4 KB | |
| the film the LLM ends with | 13 to 40 KB | 96 to 258 lines of very dense JS; about 4 to 12k output tokens for one draft (estimate) |
| one grid or contact sheet | one JPEG | 1 to 1.5k tokens per look (estimate); the procedure asks for a look after every scene plus full reviews, so 15 to 30 looks per film |

The final file is not the dominant cost. The dominant costs are (a) reading
references and examples before the first line, roughly 25 to 45k input
tokens, and (b) the render → look → fix loop, which the skill rightly
insists on, at several thousand tokens and about ten seconds of wall-clock
per turn. Reducing the number of loop turns, and the number of turns that
need vision at all, is where LLM optimisation pays.

### 2.3 Where the wall-clock goes (measured)

Full renders, headless Chrome, 1080 × 1080, this Mac:

| film | drawn frames | frame loop | total wall (Chrome launch + frames + WAV + ffmpeg) |
|---|---|---|---|
| `mini` | 36 | 0.4 s | 1.4 s |
| `fly-style` | 114 | 2.2 s | 4.6 s |
| `four-looks` | 162 | 5.9 s | 9.1 s |

Inside one frame, three costs in series. "Issue" is the JS that calls the
canvas API; "raster" is the GPU finishing the paint (forced with a 1 × 1
`getImageData`); "encode" is `toDataURL('image/png')` on the finished
canvas.

| film (engine) | issue | raster | PNG encode | sum per frame |
|---|---|---|---|---|
| `mini` (ink) | 0.4 ms | 2.5 ms | 4.5 ms | 7 ms |
| `four-looks` (riso, screen, pencil, ink) | 14 ms | 27 ms | 11 ms | 52 ms |
| `night-shift` (doodle, photos, night) | 15 ms | 36 ms | 22 ms | 73 ms |
| `gallop` (found motion) | 7 ms | 15 ms | 24 ms | 45 ms |
| `moon-book` (paper in space) | 6 ms | 9 ms | 21 ms | 35 ms |
| `one-year` (sand) | 62 ms | 13 ms | 27 ms | 102 ms |

On top of that, per frame and outside the page: the PNG travels to Node as
base64 inside a `page.evaluate` result, is written to disk, and ffmpeg
decodes it again.

Three conclusions:

1. **Drawing is not the bottleneck for flat looks.** Issue time is 0.4 to
   15 ms. PNG encode plus transfer plus ffmpeg decode is the larger half.
   Caching static drawings saves LLM effort and helps the heavy riso and
   photo scenes, but the pipeline shape matters more for time.
2. **Sand is the exception.** 62 ms of CPU per frame is the height-field
   simulation, which is inherently sequential. Memoisation does not apply;
   checkpointing does.
3. **Exact duplicate frames are common.** By file hash: `mini` 6 of 36,
   `fly-style` 7 of 114, `four-looks` 39 of 162 (24 %). Held shots with
   `pulse` twitches produce runs of identical frames that are encoded,
   written and decoded again.

### 2.4 Chrome is not bit-exact

Two paints of the same frame in the same page differed in 86 of 4.6 million
channels, by up to 5 levels. That is GPU raster noise, small but real. The
davidup engine's determinism thesis, sha256 goldens on raw RGBA, holds
because it rasters on the CPU through skia-canvas. Any golden-frame or
hash-based change detection for this skill must either use a tolerance or
move the raster to skia. This matters for several proposals below.

---

## Part 3. Extensions

Organised as: composability first (the asset tree the question asks
about), then LLM-usage optimisation, then time optimisation, then features
that fall out once those exist, then a prioritised roadmap.

### 3.1 Assets as functions in a tree, memoised

**The observation.** Because `drawFrame(i)` is pure and every mark is
seeded, any drawing whose inputs have not changed paints the same pixels.
That is a licence to paint it once into a layer and blit the layer until an
input changes. Today `core.js` does this by hand in two places (`badges`
caches cards, `rotoSprite` caches a pose) and `architecture.md` documents a
manual cache pattern per film. It can be one primitive.

**The primitive.** An asset is a pure draw function with declared bounds
and declared inputs. Position, rotation and scale are applied by the parent,
outside the child, so a moving child still hits its cache.

```js
// asset(name, draw, { box })  ->  (c, inputs) => void
// draw(c, inputs) paints in local coordinates inside box = [x, y, w, h] (logical units).
const _memo = new Map();
function asset(name, draw, { box, memo = true } = {}) {
  return (c, inputs = {}) => {
    if (!memo) return draw(c, inputs);
    const key = name + '|' + JSON.stringify(inputs) + '|' + S + '|' + PAL.finish + PAL.paper;   // see "cache key" below
    let L = _memo.get(key);
    if (!L) { L = layer(box[2], box[3]); const g = L.getContext('2d');
      g.setTransform(S, 0, 0, S, -box[0] * S, -box[1] * S); draw(g, inputs); _memo.set(key, L); }
    c.drawImage(L, box[0], box[1], box[2], box[3]);
  };
}

const ground = asset('ground', c => { /* 3 hatch layers + 7000 grain */ }, { box: [0, 0, W, H] });
const ball   = asset('ball', (c, { twitch }) => { /* fill, surface, wob */ }, { box: [0, 0, 200, 200] });

function scene(c, tau, i) {
  paper(c); ground(c);
  const x = lerp(CX - 400, CX + 300, sm(0, 1.6, tau, easeOut));
  c.save(); c.translate(Math.round(x) - 100, CY - 100); ball(c, { twitch: pulse(i, 6) ? 1 : 0 }); c.restore();
}
```

A composite asset is just an asset whose draw function calls children. The
tree is the call graph, and each node caches independently: the puppet's
eye, the puppet, the puppet-on-ground stage. Nothing about the drawing
vocabulary changes; `surface`, `wob`, `scribble` are called inside `draw`
as before.

**Prototype results** (`docs/hand-drawn-canvas-mini/memo.html`, 24
frames, a heavy hatched ground plus a moving ball with a two-state twitch):

| | raw redraw | memoised |
|---|---|---|
| issue time per frame | 15.7 ms | 6.8 ms |
| cache misses / hits | | 3 misses (ground, ball×2 states), 45 hits |
| pixels vs raw, sprite snapped to whole pixels | | 3,412 channels differ (0.07 %), max delta 15 |
| pixels vs raw, sprite at fractional position | | 36,184 channels differ, max delta 88 (visible blur) |
| Chrome's own noise, raw vs raw | 86 channels, max 5 | |

**Rules learned from the prototype**, which the primitive must encode:

- **Snap placement to output pixels.** A cached raster drawn at a fractional
  offset is resampled and softens; at 12 fps on twos nobody sees a
  half-unit snap, and the difference drops to alpha-rounding noise.
- **The cache key must include everything that changes pixels:** the
  inputs, `S`, the palette identity (not just `finish` and `paper`; a hash
  of `PAL` is safest), the mode (`ink` vs `blueprint`), and for full-frame
  assets `W` and `H`. Missing any of these produces a stale frame that is
  very hard to spot on a contact sheet.
- **Quantise continuous inputs.** A wing angle should be rounded to, say,
  1/24 rad before it becomes part of the key, or every frame is a miss.
  Give assets a `quant` map and do this inside the primitive.
- **Layer compositing is not bit-identical to direct painting** (premultiplied
  alpha at antialiased edges). Visually identical, hash-different. Goldens
  need a tolerance, or the raster must be CPU (3.4).
- **Budget the cache.** A 1080² layer is 4.6 MB; a 4K one is 33 MB. LRU
  with a byte budget, and never cache a node whose inputs change every
  frame (a miss on every call is pure overhead: an extra layer plus a
  blit).
- **Cadence is an input.** Deliberate boil is `seed + boil(i, 4)`; if the
  boil phase is an input, the cache holds one layer per phase and the line
  breathes for free.
- **Persist to disk, keyed by source.** Add a hash of `draw.toString()` to
  the key and write layers as PNG in `.cache/`. Then a re-render after
  editing one puppet repaints only that puppet's subtree, across renders
  and across films. The function's own source is its version number.

**Why this is the composability story, not only a speed-up.** Once assets
are named, pure, bounded, and keyed by inputs:

- A film becomes a tree the LLM can describe, not a monolith it must write.
  The LLM authors leaves (the creative bit) and a small tree.
- A style sheet, a 240 px readability check, a blueprint variant, a
  thumbnail for a library: all are generic operations on any asset.
- Assets harvested from finished films become a pack (3.5). The next film
  imports `creatures.fly` and writes only a beat sheet.
- The same tree renders in every look, because the palette is an input to
  every node. "Four looks" stops being a 165-line example and becomes
  `usePalette` on a cut.

### 3.2 Turn prose into functions: recipes, puppets, score, camera

The biggest LLM saving is not in the render; it is in what the LLM has to
write. Today, the 39 recipes in `scenes.md` are the film's real vocabulary,
and every one of them exists only as prose plus an example the LLM adapts by
hand. Make them code:

```js
// recipes.js: each recipe is an asset-producing function with the parameters the prose already lists
const peach = recipeEstablishing({ puppet: fly, ground: { color: PAL.fills[0], r: 700 }, push: [1.15, 1.3], twitchEvery: 8 });
const blot  = recipeBlotToBlueprint({ from: peach, dur: .8, centre: 'puppet' });
const cards = recipeMontage({ cards: CARDS, per: .25, anchor: seedDot });
```

Then a film is a **beat sheet as data** plus puppets:

```js
const BEATS = [
  { name: 'peach',   dur: 2.4, recipe: 'establishing', puppet: 'fly', push: [1.15, 1.3], sound: 'plucks' },
  { name: 'blot',    dur: 0.8, recipe: 'blotToBlueprint', from: 'peach', sound: 'swell' },
  { name: 'egg',     dur: 3.2, recipe: 'doubling', cues: [1.1, 1.4, 1.7, 2.0, 2.3], sound: 'cues' },
  { name: 'flight',  dur: 2.2, recipe: 'follow', path: [[300, 2000], [1300, 1500], [500, 700], [1900, 450]], sound: 'travel' },
  { name: 'signoff', dur: 1.5, recipe: 'signOff', words: ['fly', 'style'] },
];
defineFilm(compileFilm(BEATS, { puppets: { fly }, cards: CARDS }));
```

`compileFilm` is deterministic: it validates durations against the 1/12 s
grid, instantiates recipes, checks the anchor appears in every beat, builds
the timeline, and builds the score from the `sound` column using the motif
table in `scenes.md` (which is already a table; it just is not code). The
LLM writes puppets and the beat sheet, and drops to raw scene code only
where no recipe fits. The 17 to 40 KB film shrinks toward 5 to 10 KB
(estimate), and the recipes are debugged once instead of once per film.

The same move for **puppets**: today a puppet is a draw function with an
`ARGS` object and a hand-written ink/blueprint branch. Most of it is
mechanical: for each part, fill, surface, outline; in blueprint, chalk
outline only. A puppet as data (parts, draw order, pose parameters, per-part
markings) plus a generic renderer gives blueprint mode, the style-sheet
placement at three scales, the 240 px test, and a thumbnail for free, and
the LLM writes 15 lines instead of 40. Keep the escape hatch: a part can be
a custom draw function.

And for the **camera**: `cam`, `setView`, `whip` exist, but every scene
calls them by hand. A `camera` field on a beat (`push`, `follow: 'puppet'`,
`whipOut`) compiled into the recipe removes a class of bugs (forgetting
`resetT`, literal centres) entirely.

### 3.3 Make the review deterministic wherever it can be

Every "look" the LLM does not need is tokens and a render turn saved. Of
the 15 review items, these are checkable without vision:

| checklist item | check | how |
|---|---|---|
| `Math.random`, literal `540`, gradients on the final canvas, `filter`, `shadowBlur` | static | grep the SCENES section; allow gradients only inside functions that call `plate()` |
| a colour not in `PAL` | runtime | render once with a `Proxy` on the context that intercepts `fillStyle`/`strokeStyle` and checks membership in the closure of `PAL` under `alpha`, `tint`, `shade`, `mix` (tag the helpers' outputs) |
| a palette change inside a shot | runtime | wrap `usePalette`; allow it only at `tau === 0` |
| two finishes in one shot | runtime | wrap `surface`; record finishes per timeline entry |
| more than two scribbled parts | runtime | count `scribble` per frame |
| the first call is not `paper`/`night`/`backdrop` | runtime | wrap the three; assert per frame |
| a cue time not on the 1/12 s grid | static | check `dur × 12` is an integer per entry |
| blank or near-blank frame | pixels | variance of the 240 px downscale below a threshold |
| texture boil in a static shot | pixels | consecutive frames of a held shot differ by more than the outline band |
| the anchor missing from a shot | runtime | the anchor is a named asset; assert it was drawn in every entry |
| closing card still writing in the last frame | runtime | `signOff` progress must be 1 at `DUR − 1.5` |
| text in the frame outside allowed places | runtime | wrap `handText`; count words per shot |
| "reads at 240 px" | pixels, heuristic | downscale, measure edge energy inside the subject's bounding box vs outside; flag low contrast |

Package these as `node lint.mjs film.html` that runs a full pass in the
same headless page and prints a report. The LLM then looks at pictures only
for what pictures are for: composition, timing, taste.

Two more vision-savers:

- **Changed-frames-only sheet.** Hash every frame at render time (a 4.6 MB
  `getImageData` and a rolling hash cost about 2 ms, less than the PNG
  encode). Keep the hashes from the last render. The grid sheet marks
  changed frames and the contact sheet shows previous and current side by
  side for those only. One image per iteration, and the LLM does not
  re-inspect 140 unchanged frames. Use a per-channel tolerance of about 8
  because of 2.4.
- **Storyboard before drawing.** Compile the beat sheet into placeholder
  cards (name, recipe, duration, camera) and render that as a grid. The
  structure can be approved by the user at near-zero cost before any puppet
  exists.

### 3.4 Time: fix the pipeline shape, then parallelise

In order of payoff for effort:

1. **Skip exact duplicates.** Hash in-page before encoding; if the hash
   equals the previous frame's, hard-link the previous PNG (or emit a
   concat list with durations). 24 % of `four-looks` frames disappear from
   encode, transfer and ffmpeg decode.
2. **Render the grid small.** `--width 480` for `--grid` cuts raster and
   encode by about 5× through the existing `S` scaling and makes the JPEG
   the LLM reads smaller. The full-size render is only for the final pass.
3. **Stop going through PNG and base64.** Options, from least to most
   change:
   - In-page `VideoEncoder` (WebCodecs) producing H.264 chunks; the page
     hands Node a finished elementary stream. Hardware-encoded, no PNGs,
     ffmpeg only muxes.
   - Chrome's `getImageData` → raw RGBA sent through a `WebSocket` or CDP
     binary channel to a Node process that pipes into `ffmpeg -f rawvideo`
     stdin. No encode, no decode.
   - **Host `core.js` in Node on skia-canvas** (below). Then the frame is
     `canvas.toBuffer('raw')` straight into ffmpeg stdin, which is exactly
     what `src/drivers/node/index.ts` in this repo already does, with
     backpressure handling.
4. **Parallel pages.** Frames are independent; N Chrome pages each take a
   slice. Near-linear until the GPU saturates. Sand is the exception: give
   `sand.js` checkpoints (snapshot the bed every k frames; `sandAdvance`
   already knows how to rebuild from zero, so it can rebuild from the
   nearest snapshot) and each worker starts from the checkpoint before its
   slice.
5. **Memoise** (3.1). Worth 2× on issue time for hatched grounds and
   printed riso cards (`printPlate` does a `getImageData` per plate per
   frame today; a card is static and should be printed once).

**The skia-canvas host.** `skia-canvas` 3.0.8 is already a dependency of
this repo, and a smoke test here confirmed it has everything `core.js`
uses: `Path2D.roundRect`, `clip`, `setLineDash`, `multiply` and other
composite operations, radial gradients, `getImageData`, `drawImage` of
another canvas, and `toBuffer('raw' | 'png')`. What `core.js` needs shimmed
is small: `document.createElement('canvas')` → `new Canvas()`, `Image` →
`loadImage`, `location.search` and the `window.__*` hooks, and the score.
The score is the one real piece of work: `note()` and `noiseBurst()` are an
oscillator, a gain envelope and a noise buffer; a 60-line offline synth in
plain JS reproduces them sample-exactly and writes the WAV. The gains:

- CPU raster, so frames are bit-exact run to run and machine to machine,
  which makes sha256 goldens and cheap change detection possible.
- Fonts come from `FontLibrary.use`, so `handText` and `signOff` stop
  depending on whichever cursive font the host has, a pitfall the
  references warn about twice.
- No browser launch, no data URLs, raw frames into ffmpeg, workers via
  `worker_threads`.
- The same film still opens in a browser for scrubbing; only the renderer
  changes.

### 3.5 Features that fall out

- **Asset packs.** `packs/creatures.js`, `packs/objects.js`, `packs/tech.js`:
  named assets with pose parameters, each with an auto-rendered thumbnail
  sheet in all five looks. `SKILL.md` gains one line: "look in the pack
  before drawing a puppet". Every finished film can donate its puppets back,
  with the disk cache warm.
- **Look as a parameter.** With palette in every cache key, "the same film
  in riso" is a flag on `render.mjs`, and a look change on a cut is a beat
  field. Duotone beats, night variants and blueprint interludes become
  render-time choices rather than scene code.
- **Puppets from a silhouette.** `roto.py` already traces a figure into
  contours and skeleton strokes. Run it on one CC0 drawing or photo and the
  LLM gets a traced puppet outline to which it only adds pose parameters,
  bridging the doodle and found-motion engines with the flat looks.
- **Cue markers on the contact sheet.** Draw the score's note onsets and the
  cut lines under the tiles so timing of sound against picture can be
  judged from one image.
- **A tuning player.** The in-page player already scrubs; add sliders for a
  selected asset's inputs and a "copy values" button. The human, or the
  LLM through the browser tools, tunes a pose in seconds instead of
  editing numbers and re-rendering.
- **davidup as a host.** This repo is a deterministic Canvas 2D engine with
  a JSON composition, a browser preview, a skia-canvas server renderer,
  golden-frame tests, an editor and 59 MCP tools. A `canvasFn` item type
  (or a "hand-drawn layer") whose payload is an asset tree from this skill
  would let the LLM build a film with atomic tool calls (add a beat, set a
  palette, place a puppet, render a preview frame) instead of writing a
  40 KB file, and would put these films in the editor for humans to scrub
  and retime. It is the largest change on this list and the most strategic
  one, since it collapses two renderers, two determinism stories and two
  agent interfaces into one.

### 3.6 Prioritised roadmap

| tier | item | effort | what it buys |
|---|---|---|---|
| now | frame dedup by hash in `render.mjs` | hours | 10 to 25 % less encode and ffmpeg work |
| now | small `--grid` width by default | minutes | faster look loop, smaller images to the LLM |
| now | `asset()` primitive in `core.js` with snap, quantisation, full key, LRU | a day | 2× on static-heavy scenes; the base for everything below |
| now | static lint (rules 1, 2, 6, 9, cue grid) | hours | fewer vision looks, fewer silent format bugs |
| next | recipes as functions for the ten most used recipes (A, B, C, G, H, N, O, P, S, AA) | days | film size and LLM writing halved; recipes debugged once |
| next | `compileFilm(BEATS)` with the score compiler and the anchor check | days | the LLM writes a beat sheet, not plumbing |
| next | runtime lint via a context proxy; changed-frames-only sheet with a tolerance | days | the review becomes mostly deterministic |
| later | skia-canvas host with a shim, an offline synth and bundled fonts; raw frames into ffmpeg; workers | a week | bit-exact frames, no Chrome, parallel render, fonts fixed |
| later | asset packs with thumbnails and a disk cache keyed by source hash | a week | films start from a library; reuse across films |
| later | davidup item type plus MCP tools for beats and assets | weeks | one engine, one editor, one agent interface |

### 3.7 What not to change

The skill gets several things right that the extensions must preserve:

- **Purity of `drawFrame(i)`.** Every optimisation above depends on it. An
  asset that reads the clock or keeps state breaks caching, parallel render
  and change detection at once.
- **Seeds, not randomness.** Same reason.
- **Look, then fix.** Deterministic checks remove the looks that are not
  about taste. The ones that are about taste stay, and the grid sheet is
  the right instrument for them.
- **One file per film that opens in a browser.** Whatever the renderer
  becomes, a human should still be able to double-click the film and scrub
  it with sound.
- **The rules.** Paper first, texture as a finish, fill and outline apart,
  one anchor, hard cuts, a signed ending. They are the style; the tooling
  should make them harder to break, not optional.

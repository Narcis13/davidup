# A hand-drawn film engine designed from scratch

Companion to `hand-drawn-canvas-animation-analysis.md`. That document
explains the skill as it is. This one asks: keeping only the idea (every
frame is drawn by JavaScript on a 2D canvas from one small file, in a family
of hand-made looks, rendered to mp4 with a generated score, and authored by
an agent that renders and looks) and the working method, what would a
better-crafted system look like if it were designed today with four
constraints: plain JavaScript, determinism, simplicity, composability.

Nothing here is implemented. Every code sample is a sketch of an API, not a
promise about syntax.

---

## 1. The one decision everything follows from

**A drawing is data before it is pixels.**

In the current core, a puppet is a function that calls the canvas directly:
`c.fill(path)`, `surface(...)`, `wob(...)`. Once those calls have run, the
drawing exists only as pixels. That is why the blueprint mode is a second
branch inside every puppet, why the self-drawing reveal needs its own stroke
list, why the 3D engine has to map textures instead of lines, why the review
is done by looking at JPEGs, and why caching is a pattern each film writes
by hand.

The redesign puts a small vector intermediate representation between the
author's code and the canvas. Call it the **display list**. A cel (the unit
of drawing) is a pure function from its inputs to a display list. Looks,
effects, reveals, engines, lint, caching and change detection are all
functions over display lists. Rasterising is the last step, and the only
step that touches a canvas.

```
author code  ──►  display list (plain arrays and objects)  ──►  look + tools  ──►  canvas
   pure              hashable, serialisable, lintable          interpreter       pixels
```

A display list is plain JSON-able JavaScript:

```js
[
  { op: 'fill',   path: PATH, role: 'fills.0', finish: true },
  { op: 'stroke', path: PATH, role: 'ink', w: 2.6, tool: 'pen', wobble: 1.8, order: 0 },
  { op: 'group',  xf: [1, 0, 0, 1, 612, 540], name: 'ball', kids: [ ... ] },
  { op: 'text',   glyphs: [...], role: 'ink', tool: 'pen' },
  { op: 'fx',     kind: 'blot', p: 0.4, seed: 91, kids: [ ... ] },
]
```

Paths are the engine's own representation (arrays of points and cubic
segments in logical units), not `Path2D`, so they can be transformed,
projected, measured, hashed and written to disk.

What falls out of this single choice:

| need | today | with a display list |
|---|---|---|
| blueprint interlude | an `if (mode === 'blueprint')` branch in every puppet | a look that interprets fills as nothing and strokes as chalk |
| self-drawing reveal | a hand-written stroke list per puppet | `reveal(p, node)`: strokes are drawn in `order` up to progress `p` |
| silhouette, shadow, rim walk | alpha sampling of a rendered cutout | the union of the cel's fill paths |
| paper in 3D | texture-mapping a rendered sheet onto a quad | project the paths, then stroke them with the pen in screen space, so the wobble stays crisp |
| memoisation | a manual cache per film | automatic: the renderer caches rasters keyed by the hash of a group's list |
| duplicate frames | hash the PNG after encoding | hash the frame's list before drawing anything |
| changed-frames sheet | compare pixel hashes with a tolerance | compare list hashes, exact |
| most of the review checklist | look at pictures | walk the list |
| a puppet library | copy code between films | serialise the list, thumbnail it, import it |

Cost: one extra allocation per frame of a few thousand small objects, and a
hash. Both are cheaper than one PNG encode.

---

## 2. Six primitives, all values

Everything the author touches is a value built by a plain function. There
are no classes, no globals except the format constants, and no hidden state.

### 2.1 `cel`: a timeless drawing

```js
const ball = cel('ball', ({ twitch = 0 }) => [
  fill(circle(0, 0, 90), 'fills.0', { finish: true }),
  stroke(circle(0, 0, 90), 'ink', { w: 2.6, wobble: 1.8 + twitch }),
], { box: [-100, -100, 200, 200], inputs: { twitch: [0, 1, 0.5] } });
```

A cel declares its name, its draw function, its bounds, and its inputs with
ranges and a quantisation step. It knows nothing about time or the frame; it
paints in local coordinates and the parent places it. Because the output is
a list, the same cel gives the ink version, the chalk version, the
silhouette and the stroke-order reveal without extra code.

Inputs with ranges do three jobs: the player can show a slider per input,
the style sheet can render the cel at its extremes, and the renderer can
quantise continuous inputs before hashing so a wing angle does not defeat
the cache.

### 2.2 `shot`: a drawing over time

```js
const roll = shot('roll', 2, ({ t, i, T }) => [
  paper(),
  stroke(line(0, CY + 100, W, CY + 100), 'ink', { w: 3 }),
  place(x(t), CY, { rot: x(t) / 90 }, ball({ twitch: pulse(i, 6) })),
  guides(i, x(t), CY),
]);
```

A shot is a cel with a clock. It receives `t` (seconds into the shot on the
frame grid), `i` (the global drawn frame), `T` (its duration) and returns a
display list. It is still pure: same `(t, i)`, same list.

Time never arrives as a free float. `t` is always `k / FPS` for an integer
`k`, and curves are evaluated on the frame grid, so two machines cannot
disagree on where a pose lands.

### 2.3 `curve`: motion as a value

```js
const x = curve([[0, CX - 400], [1.6, CX + 300]], ease.out);
const y = add(curve([[0, CY], [2, CY - 40]]), wobbleCurve(6, 3, seed));
const held = onTwos(y);         // sample-and-hold every second frame
const late = delay(0.25, x);    // shift in time
const loop = repeat(0.5, x);    // period
```

A curve is a function of `t` with combinators: `add`, `mul`, `delay`,
`repeat`, `pingpong`, `onTwos`, `onThrees`, `clamp`, `follow(cel)`. This
replaces the `lerp(a, b, sm(t0, t1, tau, ease))` idiom that every scene
today re-types, and it makes timing a thing the author declares instead of
computes.

### 2.4 The time tree: `seq`, `par`, `hold`, `cut`

```js
const timeline = seq(
  roll,
  cut('blot', 0.8, roll, blueprint(roll)),   // a transition is a node with two children
  par(background, foreground),               // two shots stacked, same duration
  hold(1, signOff('mini', 'film')),
);
```

The timeline is a tree, not a flat list. `seq` sums durations, `par` stacks,
`hold` freezes the last frame of its child, `cut` is a transition device
with a duration and two children. Durations are validated against the frame
grid at construction, so a cue that misses the 1/12 s grid throws before
anything renders.

The whole film is then one function `frame(i)` that walks the tree, finds
the active leaf, evaluates it, and returns a display list. Any frame, any
order, any machine.

### 2.5 `look`: a palette, a finish, a set of tools

```js
const film = look('paperInk', timeline);
const interlude = look('blueprintNight', someShot);   // a look change on a cut is a node
const duotoneBeat = look(duotone('fluoPink', 'teal'), cards);
```

A look is the interpreter for a display list: which colour each role maps
to, which finish `finish: true` means (hatching, halftone screen, dot grid,
graphite), how `tool: 'pen'` lays a stroke (nib width curve, pressure,
wobble amplitude, ink bleed), what `paper()` draws. Looks nest, and the
innermost wins. "The same film in riso" is a one-line change on the root.

A look also carries an **edition seed**: paper grain, plate misregistration,
speckle placement. Rendering the same film with a different edition gives a
different print of the same drawing. The film's hash is unchanged; the
print's hash is not.

### 2.6 `fx`: raster effects as nodes

Some devices need pixels: the ink-blot reveal, the iris, the hex mosaic, the
pool-of-light night shot, a mask through a cutout photo. They are nodes too:

```js
fx('blot', { p: curve(...), seed: 91 }, child)
fx('iris', { r: curve(...), cx: CX, cy: CY }, child)
fx('nightShot', { lights: [...] }, child)
```

The renderer rasterises the child into a layer, applies the effect, and
composites. Because the node's inputs and the child's list are both hashed,
effects are cached like everything else.

---

## 3. Determinism as a discipline, not a hope

- **Seeds are paths.** Every node derives its seed from its parent's seed and
  its own name: `seed = hash(parentSeed, name)`. Adding a sibling never
  re-seeds its neighbours. Authors stop typing `seed: 3, seed: 7, seed: 9`;
  they only override a seed when they want two things to match.
- **Deliberate boil is an input.** `boil(i, 4)` returns a phase; a cel that
  takes `{ phase }` breathes on schedule and caches one raster per phase.
- **No fonts from the host.** Hand lettering is a single-stroke glyph set
  embedded as data (a Hershey-style font drawn once, by hand, in the house
  style). Text is strokes, so it wobbles with the pen, reveals in stroke
  order, and renders identically everywhere.
- **No `Math.random`, no `Date`, no `filter`, no `shadowBlur`, no gradients
  outside plate rendering.** These are not rules in a document; the
  rasteriser does not expose them, and the lint pass fails a list that asks
  for them.
- **CPU raster for the record.** The browser draws the preview (GPU, not
  bit-exact, fast). Node draws the deliverable through `skia-canvas`, which
  is bit-exact run to run, so each film has sha256 goldens per frame. Both
  paths share the same core, and the Node shim is tiny because the core only
  ever needs `fill`, `stroke`, `clip`, `drawImage`, `getImageData`,
  composite modes and `setTransform`.
- **The score is sample-exact.** A 60-line offline synth in plain JS (sine,
  triangle, square, filtered noise, an ADSR gain) replaces Web Audio for
  rendering, so the WAV is identical in Node and in the browser. The browser
  player still plays through Web Audio for scrubbing.

---

## 4. The renderer: caching without asking

Per frame:

1. Evaluate `frame(i)` to a display list. Hash the whole list. If the hash
   equals the previous frame's, emit a repeat and stop. No pixels.
2. Walk the tree. For each `group` or `fx` node, hash its subtree with the
   active look, the scale factor `S` and the format. If a raster for that
   hash is in the cache, blit it at a snapped integer position. Otherwise,
   if this hash has been seen before at least once (so the node is stable
   across frames), rasterise into a layer and cache it. If it is the first
   sighting, draw directly; a node that changes every frame never pays for
   a layer.
3. LRU by bytes. A 1080² layer is 4.6 MB; the budget is a flag.
4. Optionally persist layers to `.cache/<hash>.png`. A re-render after
   editing one puppet repaints only that puppet's subtree, across renders
   and across films.

Sand, the one stateful engine, becomes `sim(name, step, { dt, every })`: a
node whose state is a pure function of frame index by rebuilding from the
nearest checkpoint. The primitive owns checkpointing, so a parallel worker
starting at frame 300 loads checkpoint 288 and steps twelve times.

Frames are independent, so `render --workers 8` splits the range across
`worker_threads`, each with its own skia canvas, each writing raw RGBA into
one ffmpeg stdin in order. No PNG, no base64, no Chrome.

---

## 5. What the author sees: artefacts before pixels

The working method stays "render and look", but most looks stop needing
pixels, and the ones that do get smaller and rarer.

| step | artefact | vision needed |
|---|---|---|
| structure | `film.describe()`: the time tree as indented text with durations, looks, cels per shot, cue times | no |
| storyboard | `render --storyboard`: one placeholder card per shot (name, duration, look, camera, anchor present?) | one small grid |
| each cel | `render --sheet ball`: the cel at three scales, at its input extremes, in every look, plus its silhouette and 240 px version | one sheet per cel |
| lint | `render --lint`: walks every frame's list | no |
| iteration | `render --changed`: only the frames whose list hash moved since the last render, previous and current side by side | one small grid |
| final | contact sheet, mp4, goldens | one sheet |

The lint pass, on the list alone:

- a colour role not in the look;
- a shot whose first op is not `paper`, `night` or `backdrop`;
- two finishes in one shot, or a look change inside a shot;
- the anchor cel absent from a shot;
- more than two scribbled parts in a frame;
- a cel whose list has ops outside its declared box;
- text ops in a shot beyond the allowed word count;
- a `cut` longer than 1 s, or two cuts in a row;
- a sign-off whose reveal is not complete 1.5 s before the end;
- a subject whose bounding box at 240 px is under the readability floor,
  or is cut by the frame edge with no `intent: 'crop'` flag.

Every one of these is a walk over arrays. None needs a picture. The agent
looks at pictures for composition, timing and taste, which is what pictures
are for.

The player gets the same tree: scrub with sound, onion skin (draw the lists
of `i − 1` and `i + 1` in chalk, free because they are pure), a slider per
declared cel input with a "copy values" button, and hot reload that jumps to
the first frame whose hash changed.

---

## 6. Engines as node kinds

| engine | node | what it consumes | what it returns |
|---|---|---|---|
| found motion | `traced(clip, k)` | a clip traced offline into paths with pen widths (the current `roto.py` output, now in the display-list format) | a display list for pose `k`, so it composes with `place`, `reveal`, `look` like any cel |
| sand | `sim('bed', step, { dt: 1/48 })` inside a shot | gestures as curves (`pour`, `finger`, `palm`, `comb`, `wind`) | an `image` op with the shaded height field, checkpointed |
| paper in space | `stage3d({ cam }, sheet3(node, quad), ...)` | any node as a sheet, a camera curve, a light | projected paths stroked in screen space with the pen; fills mapped; shadows cast from the sheet's silhouette |
| ink physics | `fx('bleed', { amount })` | a subtree | strokes widened and feathered deterministically by a seeded diffusion, for wet-ink shots |
| light | `fx('nightShot', { lights })` | a subtree and light positions | the subtree drawn twice, ink inside the pools and chalk outside, masked |
| photos | `photo(cutout)` | a cutout produced offline with its silhouette path | an `image` op plus a path, so `rim`, `shadow` and `mask` work on it like on a cel |

Because each engine returns or consumes display lists, they combine without
special cases: a sand bed can be a sheet in the 3D book, a traced horse can
be revealed stroke by stroke, a photo can cast a shadow onto the paper.

---

## 7. Composability at the level of films

- **Packs.** A pack is an ES module exporting cels. Each cel carries its
  box, inputs and a one-line description. A pack ships with an auto-rendered
  thumbnail sheet in every look and a JSON manifest, so an agent can pick
  from a catalogue instead of drawing from scratch. A finished film can
  donate its cels back with one command.
- **Recipes.** The 39 prose recipes become functions returning shots:
  `establishing({ puppet, ground, push })`, `blotToBlueprint({ from })`,
  `montage({ cards })`, `badgeGallery({ cards })`, `doubling({ cues })`,
  `follow({ path, puppet })`. Each is debugged once, has a storyboard card,
  and takes the parameters the prose already lists.
- **A film is data plus leaves.** The tree is JSON-serialisable except for
  the cel bodies, which are named and registered. That means a film can be
  edited by a tool (add a beat, retime a shot, swap a look) without parsing
  JavaScript, diffed against its previous version, and hosted by a
  composition engine such as this repository's as one item type.
- **Format is a policy, not a rewrite.** Logical units with the short side
  at 1080, as today, plus a `fit` per node for the long side: `anchor`,
  `reframe`, `letterbox`. One tree renders 1:1, 16:9 and 9:16 with the
  safe areas drawn on the storyboard.
- **Score in the same shape.** The score is a tree of motifs
  (`plucks`, `swell`, `cues`, `travel`) aligned to the time tree, and
  motifs are functions returning note events. Cues land on cuts because the
  boundaries come from the same tree. The contact sheet draws note onsets
  under the tiles.

---

## 8. Simplicity guard

The core is a handful of ES modules with no build step and no dependency
in the browser. Node rendering needs `skia-canvas` and `ffmpeg`, nothing
else.

| module | lines (target) | holds |
|---|---|---|
| `list.js` | 150 | ops, paths, bounds, hashing, transforms |
| `tree.js` | 200 | `cel`, `shot`, `seq`, `par`, `hold`, `cut`, `place`, `fx`, `frame(i)` |
| `curves.js` | 120 | curves and combinators, easings, `pulse`, `boil` |
| `looks.js` | 250 | palettes, roles, finishes, the four print models, editions |
| `tools.js` | 250 | pen, brush, pencil, chalk, plates: list ops to canvas calls |
| `text.js` | 120 + glyph data | the stroke font, `handText`, `signOff` |
| `rand.js` | 40 | hash, path seeds, `rng` |
| `raster.js` | 200 | the cached renderer, snapping, LRU, disk cache |
| `synth.js` | 120 | offline score renderer, WAV |
| `lint.js` | 200 | the list-level checks |
| `player.js` | 250 | scrub, onion skin, sliders, hot reload |
| `render.mjs` | 250 | Node driver: workers, ffmpeg, sheets, goldens |
| engines | 300 each | `traced`, `sim`, `stage3d` |

Roughly 2,500 lines for the core against the current 498 dense lines plus
three engines, but each module has one job, and the display list is the
only interface between them. An author needs `tree.js`, `curves.js` and the
list constructors. Everything else is behind `look` and `render`.

What the author writes for a film shrinks to: a brief as a comment, one to
three cels, a tree of shots (many of them recipe calls), a score tree, and
`export default film(...)`. The 13 to 40 KB of dense JS today should land
between 3 and 8 KB.

---

## 9. What stays exactly as it is

- Every frame is drawn on twos at 12 fps; the mp4 is 24 fps.
- Paper first, texture as a finish, fill and outline apart, one anchor,
  hard cuts, a signed ending. These are the style. The list format makes
  them checkable; it does not make them optional.
- One film file that opens in a browser and scrubs with sound. The
  redesign moves it from one HTML file to one ES module plus a fixed shell,
  and a `render --bundle` command inlines everything back into a single
  HTML for sharing.
- The agent still renders and looks. It just looks at fewer, smaller,
  better-targeted pictures, and only after a lint pass has removed the
  defects that never needed eyes.

---

## 10. Order of building

1. `list.js`, `rand.js`, `curves.js`, `tree.js`: the pure half. Testable
   with no canvas at all, by hashing lists.
2. `looks.js`, `tools.js`, `text.js`: one look end to end (ink on paper),
   the stroke font, `paper`, one finish. The mini film from the analysis
   renders.
3. `raster.js` with hashing, dedup and the cache; `render.mjs` on
   skia-canvas with workers and raw frames into ffmpeg; goldens.
4. `lint.js` and the storyboard, sheet and changed-frames commands.
5. The other looks, the fx nodes, the recipe functions.
6. `player.js` with onion skin and sliders.
7. Engines: `traced`, `sim`, `stage3d`.
8. Packs and the manifest; bundling; optional hosting in a composition
   engine.

Steps 1 to 4 are the product. Everything after is content on top of a core
that no longer needs to change.

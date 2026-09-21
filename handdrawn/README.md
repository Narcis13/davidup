# handdrawn

Short films that look hand-drawn or hand-printed, where every frame is drawn by
JavaScript. A film is one ES module. Its shots return **display lists** (plain
data: paths, fills, strokes, groups), not pixels. The package lints, hashes,
caches, dedups and renders those lists on Canvas 2D through `skia-canvas`,
then writes an mp4 with a generated score. No browser is involved in
rendering, and the output is bit-exact from run to run.

```
film.js (your code)  ──►  display list  ──►  look + finish + tools  ──►  skia canvas  ──►  ffmpeg
   cels, shots,          plain JSON-able      roles → colours,            CPU raster,       mp4 + wav
   recipes, packs        data, hashable       fills → hatch/dots/…        bit-exact         + contact sheet
                              │
                              └──►  hdf lint · hdf board · hdf changed · the player (all read lists, not pixels)
```

This is version 2.0 of the `hand-drawn-canvas-animation` skill. Plain ES
modules, no build step. It needs Node ≥ 20, `skia-canvas` (ships prebuilt)
and `ffmpeg` on `PATH`. The design is explained in
`docs/hand-drawn-canvas-animation-redesign.md` and the build plan in
`docs/hand-drawn-film-v2-plan.md`. The agent skill that drives this package is
`.claude/skills/hand-drawn-film/`.

---

## Contents

1. [Quick start](#1-quick-start)
2. [What it can make](#2-what-it-can-make)
3. [Writing a film](#3-writing-a-film)
4. [Looks](#4-looks)
5. [Recipes](#5-recipes)
6. [Packs](#6-packs)
7. [Engines: found motion, sand, paper in space, photos, the asset store, puppets, actors](#7-engines)
8. [Score](#8-score)
9. [The CLI](#9-the-cli)
10. [The working loop and the agent skill](#10-the-working-loop-and-the-agent-skill)
11. [Player, dev server, bundle](#11-player-dev-server-bundle)
12. [Lint](#12-lint)
13. [Determinism, caching, goldens, speed](#13-determinism-caching-goldens-speed)
14. [Package layout](#14-package-layout)
15. [Known limits](#15-known-limits)
16. [Ideas for clips](#16-ideas-for-clips)

---

## 1. Quick start

```bash
cd handdrawn
npm i                                   # skia-canvas ships prebuilt binaries
ffmpeg -version                         # must be on PATH (or set FFMPEG=/path/to/ffmpeg)

node cli/hdf.mjs render films/mini.js   # a 4.5 s film in about two seconds
open out/mini-final.mp4                 # picture + sound
open out/mini-sheet.jpg                 # contact sheet: two tiles a second, cuts and note onsets
```

Every command runs from `handdrawn/` as `node cli/hdf.mjs <cmd>`. This README
writes it as `hdf <cmd>`; an alias helps: `alias hdf="node $PWD/cli/hdf.mjs"`.
Outputs go to `handdrawn/out/`.

Other things to try:

```bash
hdf render films/gallop.js                   # 34.5 s of Muybridge's horses, traced and redrawn
hdf render films/four-looks.js --look pencilMinimal   # the same film restyled with one flag
hdf render films/mini.js --ar 9:16           # the same film re-fitted to vertical
hdf dev films/fly-style.js                   # player with scrubbing, sound, onion skin, hot reload
hdf bundle films/moon-book.js                # one HTML file that plays from disk
npm test                                     # 111 tests, ~30 s, including a golden check of every film
```

Work on your own films in `handdrawn/work/<film>/<film>.js` (gitignored). A
film there imports the package by name through package.json self-reference:

```js
import { film, shot, seq, cel, place, paper, fill, stroke, circle, meta } from 'handdrawn';
import { establishing, signOffShot } from 'handdrawn/recipes/shots.js';
import { gpu, server } from 'handdrawn/packs/tech.js';
```

---

## 2. What it can make

A 10 to 40 second film, drawn at 12 frames a second ("on twos") and delivered
as a 24 fps mp4 with a score. It has one of six hand-made looks, and can use
one of three engines that go beyond drawing on a flat frame.

| | what it looks like |
|---|---|
| **ink** (`paperInk`) | warm paper with light bands and grain, wobbly brown outlines, hatched fills, construction lines, fluorescent accents |
| **riso** (`risoPop`) | fluorescent inks printed as halftone plates that multiply where they overlap, card montages, badge galleries, a seed dot |
| **screen** (`screenSea`) | flat shapes under a straight dot grid, a constant protagonist, day and night |
| **pencil** (`pencilMinimal`) | cream and charcoal, thin graphite, torn paper sections, walls of squiggle text, dark sections |
| **blueprint** (`blueprintNight`) | chalk on navy: the "look inside" interlude |
| **doodle** (`doodlePastel`) | brush pen and watercolour drawn over cut-out photos of real objects (a teapot becomes a ship) |

| engine | what the frame is |
|---|---|
| **found motion** (`traced`) | poses traced from real movement (Muybridge, or your own video), redrawn stroke by stroke with the brush |
| **sand** (`sim`) | a bed of sand on a backlit glass that a hand pours, sweeps and combs, in one take with no cuts |
| **paper in space** (`stage3d`, `book3`) | flat drawn sheets stood up in a lit 3D room: pop-up books, paper theatres, turning pages, shadows |

The eight example films in `films/` are the worked examples:

| film | length | look / engine | what it shows |
|---|---|---|---|
| `mini.js` | 4.5 s | paperInk | the smallest complete film: a hatched ball rolls, a handwritten sign-off |
| `four-looks.js` | 14.5 s | riso, screen, pencil, ink | one paper boat through four looks: ripples, a card montage, a badge gallery, day/night, torn pages |
| `fly-style.js` | 12.2 s | ink + blueprint | a fruit fly on a peach, an ink blot into blueprint, a doubling egg, a camera-follow flight, what the fly sees |
| `gallop.js` | 34.5 s | found motion | "do all four hooves leave the ground?": Muybridge's horse, a zoopraxiscope disc, elephant, kangaroo, pigeons |
| `one-year.js` | 39.5 s | sand | a tree goes through a year in one take, poured, swept and combed |
| `moon-book.js` | 29 s | paper in space | *The hedgehog and the moon*, a pop-up book on a table: the cover opens, pieces rise, a lamp lights the page |
| `held-once.js` | 22.75 s | doodle | five museum objects (The Met, CC0) and a hedgehog who uses them anyway |
| `fox-and-teapot.js` | 17 s | doodle + a puppet | the store's fox through three hedgehog recipes by `actor: CAST.FOX`: tea, a helmet that roars, a teapot that bolts; then a pop-up book where it turns around with the page |

---

## 3. Writing a film

Six ideas, all plain values built by plain functions.

### Cel: a timeless drawing

```js
export const ball = cel('ball', ({ twitch = 0 }) => [
  fill(circle(0, 0, 90), 'fills.0', { finish: true }),          // flat colour + the look's texture
  stroke(circle(0, 0, 90), 'ink', { w: 2.6, wobble: 1.8 + twitch }),
], { box: [-92, -92, 184, 184], inputs: { twitch: [0, 1, 1] }, desc: 'a hatched ball' });
```

A cel is centred on its origin (or stands on `y = 0`). It declares its `box`
and its `inputs` as `[min, max, step]`. It draws only **roles**, never hex
colours. Inputs are quantised to their step, so frames that repeat a pose
hash the same, dedup and hit the cache. `hdf sheet` draws a cel at three
scales, at every input extreme, in every look, as a silhouette, and at 240 px.
A cel can also arrive as data instead of code -- see [puppets](#puppets).

### Shot: a drawing over time

```js
const roll = shot('roll', 2, ({ t, i, W, CX, CY }) => {
  const x = curve([[0, CX - 400], [1.6, CX + 300]], ease.out)(t);
  return [
    paper(),                                        // first op: paper, night, or a backdrop
    stroke(line(0, CY + 100, W, CY + 100), 'ink', { w: 3, wobble: 2, name: 'floor' }),
    meta('anchor', { cel: 'ball' }),                // the element that survives every cut
    place(x, CY, { rot: x / 90 }, ball({ twitch: +pulse(i, 6) })),
  ];
});
```

`draw` receives `{ t, k, i, T, W, H, CX, CY, look, seed }`. `t` is seconds
into the shot, always on the 1/12 s grid; `k` is the shot's frame; `i` is the
film's drawn frame; `T` is the duration. Given the same inputs, a shot returns
the same list. Positions come from `W H CX CY`: the short side is 1080 logical
units whatever the output size.

### Curves: motion as a value

`curve(keys, ease)`, `ramp(a, b, t, ease)` (0..1 between two times), and
combinators `add mul delay repeat pingpong clampC onTwos onThrees follow(path)`.
`pulse(i, every)`, `flicker(i, period)` and `boil(i, every)` quantise idle
motion. Easings: `ease.linear in out io back bounce`.

### Timeline: a tree

```js
timeline: seq(
  open,
  cut('blot', 0.75, open, inside),        // a transition is a node with two children
  par(background, foreground),            // stacked, same duration
  lookOn('blueprintNight', interlude),    // a look change on a subtree
  hold(1, lastShot),                      // freeze the last frame
  signOffShot({ a: 'the', b: 'end' }),
)
```

Durations must sit on the 1/12 s grid (0.25, 0.5, 11/12 are fine; 0.3 is
not); `seq` throws at construction otherwise. Transition kinds: `dissolve
wipe blot iris mosaic flash flicker`, plus the other fx (below).

### Look: the interpreter

The same list renders as ink on paper, riso dots or graphite by changing one
name (section 4).

### Film

```js
export default film({
  name: 'mini',               // also seeds everything: renaming reprints the grain
  look: 'paperInk',           // a preset name or a look object
  format: '1:1',              // '16:9' | '9:16'; any film can be re-fitted with --ar
  timeline: seq(roll, sign),
  score: ({ shots, end }) => [...plucks(shots[0].t0, 2), ...dyad(end - 2.5, 2.5)],
  assets: IDS,                // ids in the asset store, if any (or a 2.0 { id: record } object)
});
```

`films/mini.js` is the whole thing in 41 lines.

### Display list ops

| op | built with | notes |
|---|---|---|
| `paper`, `night` | `paper()`, `night()` | the look's stock: colour, bands, grain |
| `fill` | `fill(path, role, { finish, cov, alpha, blend })` | `finish: true` means the look's texture; `cov` is riso coverage |
| `stroke` | `stroke(path, role, { tool, w, wobble, taper, dash, order })` | tools: `pen brush pencil chalk crayon marker gouache` |
| `dots` | `dots(path, role, { cell, cov, angle })` | a dot screen inside a path |
| `text` | `text(str, x, y, { size, align, width })`, `handText`, `textBox`, `bullets`, `signOff` | single-stroke hand lettering, no fonts; it wobbles and reveals like a drawing; `width` wraps it, `\n` breaks it |
| `image` | `image(src, x, y, w, h, { sil })` | a registered asset (a cutout photo, a sand bed) |
| `group` | `group(name, kids, { xf })`, `place(x, y, {rot, scale, flip}, node)` | the cache unit |
| `clip` | `clip(path, kids)` | |
| `fx` | `fx(kind, args, kids)` | `dissolve wipe blot iris mosaic flash flicker nightShot bleed glow scribble photoMask soft` |
| `look` | `lookOn(look, node)` / `lookNode` | innermost look wins |
| `meta` | `meta('anchor', {cel} \| {name})`, `meta('intent', 'crop')` | read by lint and the board, never drawn |

Lettering is laid out from the hand's own glyphs: their advances place it,
the ink of their strokes makes its box.

```js
layout('Copy that wraps.', { size: 40, w: 300 })   // { lines: [{ str, x, y, w }], box, truncated }
measureBox('two\nlines', 40)                       // the ink box the copy needs, baseline at 0
textBox(copy, [x, y, w, h], { size: 36, align: 'center', valign: 'middle', maxLines: 4 })
bullets(['mix', 'add two eggs', 'bake'], [x, y, w, h], { marker: 'number' })   // dot, dash, number, check
text(copy, x, y, { size: 40, width: 300 })         // the op wraps too; w on a text op is the pen
```

`textBox` and `bullets` return groups whose `.box` is the bounds of what they
draw, and `bounds()` of a `text` op is measured the same way (in the shot's
hand), so the `cel-box` rule judges lettering by its ink.

Paths are flattened polylines, so they transform, project, measure and hash
trivially: `circle ellipse rect roundRect poly line cubic spline arc`, plus
`xf box len at inside resample union`.

`reveal(p, node)` draws any node's strokes and lettering on in pen order up
to progress `p`, which is how outlines, signatures and traced horses "draw
themselves".

---

## 4. Looks

A look is `{ name, palette, finish, paper, tools }`. Ops carry roles; the
look resolves them.

| role | for |
|---|---|
| `paper`, `paperBand`, `night` | the stocks |
| `ink`, `chalk`, `chalkDim`, `guide` | lines, lettering, construction |
| `fills.N`, `shade`, `light`, `blush` | bodies, hatching, highlights |
| `accents.N` | four loud colours |
| `inks.N` | riso / screen print inks |
| `{ base, tint, shade, alpha, hue, mix }` | an adjusted role: `{ base: 'fills.0', tint: 0.3 }` |

| preset | finish | paper |
|---|---|---|
| `paperInk` | hatch | bands |
| `risoPop` | halftone | cream |
| `screenSea` | dots | cream |
| `pencilMinimal` | graphite | cream |
| `blueprintNight` | hatch | night |
| `doodlePastel` | wash | pastel |

Variants:

```js
withLook('risoPop', { palette: { fills: ['#3a7ca5', '#d9a441'] }, words: 3 })   // override keys; the only place hex belongs
derive('screenSea', { hue: 40, sat: 0.8, light: 0.05 })                         // shift the whole palette
derive('doodlePastel', { from: PHOTOS.teapot })                                   // repaint it in a cutout's own colours
duotone('risoPop', '#ff48b0', '#0078bf')                                          // two inks on the look's paper
pastel('doodlePastel', 'mint')                                                    // another sheet: rose mint butter sky cream peach lilac sand night
```

Riso cards are plates: `risoCard([[shapes for ink 0], [ink 1], [ink 2]])`,
where each shape is a fill with a coverage (`0.6`, `radial(...)`,
`linear(...)`) and `knockout(path)` keeps a subject out of a plate. Overlaps
multiply the way ink does. Full reference:
`.claude/skills/hand-drawn-film/references/looks.md`.

---

## 5. Recipes

Recipes are shots that have been debugged once and take parameters
(`recipes/shots.js`, with the doodle set in `recipes/doodle.js`). The letters
follow v1's `scenes.md`. `R(opts)` returns a shot, every option has a default,
and `R.layer(ctx, opts)` is the drawing alone for composing two recipes in one
shot. Subjects are functions, so any cel rides any recipe:
`establishing({ subject: (ctx, mode) => gpu({ spin: 1 }) })`.

| | recipe | look | beat |
|---|---|---|---|
| A | `establishing` | ink | subject on a textured ground, construction lines, camera push-in |
| B | `blotToBlueprint` | ink | an ink blot grows and reveals the same scene in blueprint |
| C | `sparkConstruct` | ink | spark, construction lines, a self-drawing outline, a hex lattice |
| D | `doubling` | ink | particles double on cues, spindles, a lineage tree |
| E | `bands` | ink | flat accent bands appearing in rhythm inside a body |
| F | `macroInsert` | ink | a two-frame zoom insert |
| G | `followTravel` | ink | camera follows a traveller along a curve, speed lines, loops, shadow |
| H | `povMosaic` | ink | the world seen through a compound eye (hex mosaic in an iris) |
| I | `network` | ink | particles orbiting clusters on seeded arcs |
| J | `impact` | ink | flash, blob, droplets, red construction circles |
| K | `vibration` | ink | a zig-zag that redraws every frame, circles leaving the source |
| L | `timePassing` | ink | a sun on an arc, tally marks, day/dusk flicker |
| M | `coda` | ink | night, two sparks, the subject in blueprint fading |
| N | `seedRipples` | riso | the seed dot, crayon rings, an iris opening on a card |
| O | `montage` | riso | printed cards at 4 a second, the seed dot on each |
| P | `badgeGallery` | riso | every card as a round stamp on dashed rings, shrinking to the dot |
| Q | `duotoneBeat` | riso | the cards reprinted in two inks |
| R | `starfield` | riso | night in three grains, a ring wakes circled dots |
| S | `signOffShot` | any | two handwritten words, two dots; the last shot of every film |
| T | *(a film pattern)* | screen | one constant protagonist while the world cuts around it |
| U | `landscapeDayNight` | screen | flat landscape, the cut from day to night is the beat |
| V | `origami` | screen | a written sheet folds into a boat in hard cuts |
| W | `tornPage` | pencil | squiggle text, sticky note, a rising torn section, a dark section |
| X | `darkSection` | pencil | dotted arcs, dot bursts, a chalk figure on night |
| Y | `patternSampler` | pencil | a 4 × 4 grid of lattices, one cell per frame |
| Z | `enso` | pencil | a brush circle draws itself round a figure |
| AA–AM | `becomesVehicle livesInside doesItsJob timeOnIt nightFalls printsOnALine lightEscapes alongTheEdge insideTheTube looksBack getaway caughtLetGo sunrise` | doodle | gags on a cut-out photo: it becomes a boat, someone lives inside, it pours, night falls, the prints hang on a line… |

`CARDS` exports three sample riso cards that O, P and Q use by default.
Timing notes for each recipe are in `references/recipes.md`.

---

## 6. Packs

Ready-made cels with box, inputs, a description and a thumbnail sheet
(`packs/sheets/<cel>.jpg`), listed in `packs/manifest.json`:

| pack | cels |
|---|---|
| `packs/creatures.js` | `fly` (wing, flap, legs, walk; ink or blueprint), `hedgehog` (dir, fright), `horse` (12 traced Muybridge poses) |
| `packs/objects.js` | `boat` (ink or blueprint), `teapot` (lid, steam), `lamp` (on), `book` (open) |
| `packs/tech.js` | `gpu` (spin, hot), `server` (units, load), `token` (hue, glow), `chip` (pulse) |

`hdf donate <film.js> <cel>` copies a cel from a finished film into a pack,
together with the helpers and imports it reaches. It checks that the copy
hashes identically at every input extreme, then regenerates the manifest and
the sheet.

---

## 7. Engines

Engines change what a frame is made of, not the rules. Each one still
produces display lists, so lint, board, grid, workers, goldens and the player
work on them unchanged. The detailed guide is
`.claude/skills/hand-drawn-film/references/engines.md`.

### Found motion (`engines/traced.js`, see `gallop.js`)

Real movement is traced into vector strokes offline, and the film redraws the
strokes with the brush, one pose per drawn frame.

```bash
ffmpeg -i clip.mp4 -vf fps=12 work/cat/%03d.png                    # or a Muybridge GIF from Wikimedia
python3 cli/roto.py work/cat --name cat --kind dark --js work/clips.js --credit "..."   # numpy, scipy, scikit-image, Pillow
hdf clip work/clips.js --js work/<film>/clips.js
```

Then `hdf import work/<film>/clips.js --v2 --licence PD` puts every clip in the
asset store, and the film names the ids:

```js
fromStore(['cat']);                                                               // core/assets.js
clipFromStore('cat');                                                             // hand it to the engine
traced('cat', i, { x: CX, y: 900, h: 470, wash: 'fills.0', p: ramp(0, 1, t) })   // pose i, feet at (x, y), drawn on by p
gap('cat', k); airborne('cat');                                                   // height off the ground; the highest pose
```

A clip can also drive a puppet. `--rig quadruped|biped` (on roto.py, `hdf clip`,
or `hdf clip --store <id>` for a clip already in the store) labels a skeleton in
every frame from its silhouette (`core/rig.js`: hooves, hip, shoulder, head, tail
tip by position; out/clip-<id>-skel.jpg shows them), and `hdf retarget` turns
the chain directions into a puppet cycle through a map in `assets/src/`:

```bash
hdf clip --store horse --rig quadruped
hdf retarget --clip horse --to fox --map horse-fox.json --name gallop   # joints on 2 degrees, a lift per frame
hdf sheet store fox --cycle gallop
```

`fox.cycle('gallop', t)` then draws Muybridge's horse on the fox
(`fox-and-teapot.js`, the chase); the actor contract lifts the stage by each
frame's `lift`, the moment in the air. Re-importing the fox's SVG keeps the cycle.

Or film yourself. `hdf clip --kind pose` runs MediaPipe's pose landmarker
(`cli/pose.py`) over a folder of phone frames and puts a biped clip in the
store: the skeleton comes from the 33 landmarks (`core/pose.js`: a limb keeps
its side, a left/right swap is undone, the frames go to 12 fps and are cut to
their best loop), the outline is their hull. Then the fox walks like you:

```bash
python3 -m pip install mediapipe                       # once (or HDF_PYTHON=<a venv's python>)
ffmpeg -i me.mov -vf fps=30 work/me/%04d.png            # walk across the frame, side on, whole body in shot
hdf clip --kind pose work/me --name me --fps 30         # keeps the landmarks in out/pose-me.json
hdf retarget --clip me --to fox --map biped-fox.json --name walk   # replaces the hand-authored walk
hdf sheet store fox --cycle walk
```

Without MediaPipe the command says what to install; `hdf clip --kind pose
out/pose-me.json --name me` remakes the clip from kept landmarks with nothing
installed. Film two strides or more so a loop can be found (a single stride is
kept whole).

### Sand (`engines/sim.js`, see `one-year.js`)

A height field of sand on a light table, stepped at 48 Hz and shaded as
backlit glass. Gestures are values with start and end times. Checkpoints make
any frame reachable, so parallel workers render sand bit-exactly.

```js
const bed = sim('tree', { gestures: [
  G.sprinkle(0.2, 0.8, row, { r: 240 }),        // a cloud: skies, ground
  G.pour(0.9, 1.6, TRUNK, { r: 15 }),           // a stream: lines, trunks, letters
  G.finger(1.7, 2.1, BRANCH, { r: 9 }),         // clears a line to the light
  G.wind(9, 11, { strength: 0.08, lift: 0.85 }),
] });
shot('sand', 30, ({ t }) => [...bed.frame(t), meta('anchor', { name: 'sand:tree' })]);
// score: bed.hiss() makes every gesture hiss for as long as it lasts
```

Gestures: `pour sprinkle finger palm comb dab fill move wind fly`. You can
start from `cover({ box })` (a covered table), and `view` gives a camera
window over a table larger than the frame.

### Paper in space (`engines/stage3d.js`, `recipes/book.js`, see `moon-book.js`)

Sheets are ordinary display lists projected point by point through a pinhole
camera, so strokes stay crisp and textures land in perspective. A lamp
darkens each sheet by its angle, and shadows fall on the floor and the pages.

```js
const cam = camera3({ eye: [0, 1000, 1300], target: [0, 120, 0], f: 1500 });
stage3d({ cam, look: ctx.look }, sheet3(card3(260, 600, moonOps), [TL, TR, BR, BL]));
const book = book3({ cover, spreads: [{ left, right, pieces: [{ base, h, card }] }] });
book.draw({ turn: 1.4, cam, look: ctx.look });          // leaves in the air, pieces rising as the spread opens
```

### Photos (doodle look)

```bash
hdf photo teapot.jpg --name teapot --credit "Teapot, ca. 1755, The Met, CC0" --source <url> --js work/<film>/photos.js
```

This cuts the object out (with `rembg` if it is on `PATH`, otherwise a colour
flood), traces its silhouette, quantises its opaque pixels into a `colours`
table (the biggest eight by area, which `derive({ from })` and
`--look 'preset~from:<id>'` paint a look with), and writes a check sheet with a
u,v grid. You
read attachment points (spout, hub, lip) off that grid. Then
`pin(photo, { x, y, h, rot })` places it, `on(pl, u, v)` attaches drawings so
they move with the object, `rim` walks its real edge, `mask` draws on its
surface, `photoFront` lays part of it back over a drawing, and
`fx('nightShot')` turns the lights off.

### The asset store

Anything a film did not draw in code -- a cutout, a traced clip, a puppet, a
hand, a paper stock, a motif, a sample -- lives in `assets/`, once, addressed
by the sha of its own bytes:

```bash
hdf import work/teapot.png --kind cutout --name teapot --licence CC0 --credit "The Met" --source <url>
hdf find teapot                     # id, kind, licence, what it takes, its check sheet and credit
hdf find --kind puppet              # the whole kind
```

`assets/catalogue.json` holds one entry per id (`kind`, `sha`, `licence`,
`box`, and for a cutout its `w`, `h`, `sil` and `colours`);
`assets/blobs/<sha>.{webp,png,json}` holds the payload, so two imports of the
same file are one blob. `hdf import` validates the payload against its kind's
schema (`core/assets.js`) before anything is written, and `--licence` is
closed: `CC0 | CC-BY | CC-BY-SA | PD | own | unknown`.

A film names store assets instead of inlining them. `fromStore` reads the
records at the top of the module, `assets` declares the ids for the loader:

```js
import { fromStore } from '../core/assets.js';       // the one import a film takes from outside core/index.js

const IDS = ['teapot', 'watch'];
const PHOTOS = fromStore(IDS);                       // { teapot: record, watch: record }, also in the registry
...
export default film({ name, look, timeline, score, assets: IDS });
```

`cli/load.mjs` resolves those ids through the store next to the package (or
`{ id, from: '../other-store' }`), rebuilds the record `pin()` and
`derive({ from })` expect, and decodes each blob once per process. The 2.0
shape -- `assets` as an object of records -- still loads unchanged, and
`hdf lint` warns about any of them carried as a data URL.

`hdf import --v2 <photos.js|clips.js>` migrates a 2.0 data module: one entry
per record, the pixels (or the poses) as the blob, the silhouette, the colours
table and the provenance in the entry. The bytes are kept exactly as they came,
so nothing on screen moves.

### Puppets

A puppet is a cel whose drawing is data: a payload in the store, so a cast
member can be imported rather than written. `puppet(id)` turns one into a cel
-- frozen, boxed, memoised, quantised, hashable -- like any other:

```js
const FOX = puppet('fox');                  // after fromStore(['fox'])
FOX({ eye: 'happy', 'arm-l': 112 })         // a group tagged `cel`, in the look of the shot
FOX.pose('wave', k)                         // rest -> wave by k: joints lerp, variants switch at k >= 0.5
FOX.cycle('walk', t)                        // the cycle's frame on the 1/12 s grid, wrapping
```

The payload (`assets/src/fox.puppet.json` is the worked example) is
`{ units, box, ground, parts, inputs, poses, cycles }`. Parts are drawn in key
order -- painter's -- each as a group whose `xf` turns it about its `pivot`; a
part naming a `parent` nests inside it and keeps its place in that order, so a
tail listed before the body is drawn behind it and still swings with it. A
part's ops are ordinary role-drawn ops (`fill`, `stroke`, paths as `$p`) in its
own coordinates with its pivot at the origin; a part with no pivot rides its
parent's. Joints are degrees on a 2 degree step, so two frames of a cycle that
land on the same angles are one group object, hash the same and dedup. A part
with `variants` takes a key instead of an angle (`eye: 'sleep'`, `mouth: 2`).

Parts also slide and scale (4.0 K1). `slide: { x: [-4, 4, 1], y: [-3, 3, 1] }`
declares inputs `pupil.x` and `pupil.y` (units, in the parent's frame);
`scale: { y: [0.8, 1.2, 0.05], keepArea: true }` declares `body.sy`, and with
`keepArea` the other axis is its inverse (a squash is a stretch). A part's `xf`
is `translate(pivot) . translate(dx, dy) . rotate(a) . scale(sx, sy)`; at rest
it is what it was without the inputs, so a puppet that declares none draws and
hashes as before. `when: { eye: ['open'] }` draws a part only while the named
variant input holds one of the values, so the fox's pupil hides behind a happy
or sleeping eye:

```js
FOX({ 'pupil.x': 4, 'brow-l': -12 })        // looks across and frets: brow-l turns, the pupil slides
FOX({ 'brow-l.y': -5, 'brow-r.y': -5 })     // both brows up (y up is negative)
```

The fox has `pupil` (slides), `brow-l` and `brow-r` (turn and slide); `EMOTES`
use them (`worried` is new), and lint's `puppet-joint` checks every move a pose
or cycle sets against its range and step. `cel-box` and the sheets see every
move at its min and max.

```bash
hdf import assets/src/fox.puppet.json --kind puppet --name fox --licence own
hdf sheet store fox --cycle walk    # every look x every pose and variant x 3 scales, the walk as a strip
```

### Puppets from SVG

A puppet can also be drawn in Figma (or Illustrator, or by hand) and imported
with `hdf svg` (`core/svg.js`). The fox in the store comes from
`assets/src/fox.svg`, whose side view draws exactly what the JSON above draws
(its other views are under Turnarounds). The ids
are the rig:

- a `<g id="arm-l">` is a part, and document order is painter order (and reveal
  order, so draw the outline last and it reveals last);
- inside it, a `<circle id="pivot">` (or `data-pivot="x,y"` on the g) is the
  pivot and is not drawn; `data-parent="body"`, or nesting inside another
  part's g, gives the parent;
- `<g id="eye" data-variants>` takes its child g ids as variants; sibling ids
  `mouth-0`, `mouth-1`, ... become one stepped part `mouth`;
- `data-slide="x:-4..4:1,y:-3..3:1"` and `data-scale="y:0.8..1.2:0.05,keep-area"`
  on a part's g declare its moves (min..max:step, the slide in the file's
  units); `data-when="eye:open|wide"` shows it only with those variants;
- `<g id="pose:wave" data-joints="arm-l:112,head:-6,eye:happy"/>` is a pose and
  `<g id="cycle:walk" data-fps="12">` a cycle, one `<g data-joints="...">` per
  frame; neither draws. A top-level `<circle id="ground">` is the ground point;
- the root's `viewBox` is the box and `data-units` the units it is drawn in
  (`--units` rescales the file).

Every shape (path, rect, circle, ellipse, line, polyline, polygon, with its
transforms) is flattened to polylines at `--flatten` (0.6 units). `use`, text,
gradients, patterns, filters, masks, clip paths, CSS and embedded images are
refused with a message naming the element and its line. Every colour is mapped
to a role (the darkest `ink`, the lightest `paper`, the rest to the nearest house
fill or accent) and the table is printed; `--roles ask` writes it next to the
SVG to edit and pass back with `--roles <file>`. Fills in `fills.n` and
`accents.n` get the look's finish.

```bash
hdf svg assets/src/fox.svg --name fox --roles ask       # fox.roles.json: edit, then
hdf svg assets/src/fox.svg --name fox --licence own --roles assets/src/fox.roles.json
```

### Turnarounds

A puppet can be drawn from more than one side. `views: ['side',
'three-quarter', 'front']` in the payload, and any part's `ops`, any variant
and any `pivot` may be keyed by view (`{ side: [...], front: [...] }`). A part
with nothing of its own in a view is drawn as in the first view, so only what
changes needs drawing again: the fox redraws its head, eyes, mouths and bib for
three-quarter and front, and its arms and feet for front, and keeps one tail.
Such a puppet takes a `dir` input (-1 .. 1 on a half step): |dir| 1 is the
side, 0.5 three-quarter, 0 front, and a negative dir mirrors the drawing about
the ground point. In an SVG, each view is a top-level `<g id="view:side">` with
the same part ids inside; poses, cycles and the ground stay outside the views.
`hdf sheet store fox` starts with the turnaround: side, three-quarter, front,
and the two turned back.

```js
FOX({ dir: 0 })                 // the front
FOX.look(0.5)                   // an actor: { dir: 0.5 }, three-quarter, or the side if it has none
```

`book3` spreads take an actor as a piece, `{ base, h, actor, state }`: it
stands on its page and turns as the page does -- the front while the page
lies flat, three-quarter as it lifts, the side upright -- staying upright
itself, as a figure in a paper theatre does. The turn shot of
`films/fox-and-teapot.js` is the worked example.

### Actors

An actor is a cast member a recipe can direct (`core/actor.js`). `actorOf`
wraps a puppet, a code cel or a v1 doodle builder; the recipe asks it for
states -- plain input objects -- merges them and puts the result on the stage:

```js
import { CAST, doesItsJob } from 'handdrawn/recipes/doodle.js';
fromStore(['teapot', 'fox']);
doesItsJob({ photo: PHOTOS.teapot, actor: CAST.FOX })   // the fox waits by the cups instead of the hedgehog

A.put(d, x, y, s, { ...A.idle(tau), ...A.look(-1), ...A.emote('happy'), ...A.cycle('run', tau) })
```

`idle(t, seed)` breathes and blinks on the twos, `look(dir)` faces (and turns
a puppet with views to the view `dir` stands for), `emote(name)`
is `happy | sleep | wide | sad` (a puppet's own pose of that name wins),
`cycle(name, t)` is a declared cycle, `reveal(tau)` draws it in stroke order.
For a puppet they come from its poses, cycles and the conventional part names
(`head`, `eye`, `mouth`, `tail`, `body`, `arm-l`, `arm-r`); `hand: [x, y]` aims
an arm. A cycle the actor lacks falls back to a two-pose bob and marks the
drawing, which lint reports when it stays on screen over 1 s. Every doodle
recipe AA to AM takes `actor:` (default `HOG`, the hedgehog, drawing exactly
what it drew before; `who: builder` still works), and so do recipes A, G, M, U,
W, X and Z, where the actor takes the boat's place. `films/fox-and-teapot.js`
is the worked example.

The store is read with `node:fs`, which the browser has not got:
`hdf dev` and `hdf bundle` serve `core/assets.web.js` in place of
`core/assets.js` (`cli/modules.mjs` TWINS), and hand the page the records it
needs as `window.HDF.catalogue` and `window.HDF.assets`. A plain static server
(`player.html?film=...`) can only play a film that carries its assets inline.

---

## 8. Score

The score is data too. `film({ score })` is a function
`(cues) => events` (or `{ master, events }`), where `cues` is
`{ shots: [{ name, t0, dur }], cuts, end }`, so the music reads the timeline
and cannot drift from it. A small offline synth (`core/synth.js`: sine,
triangle, square, saw, noise, band-passed hiss, the v1 envelopes) renders the
same samples in Node and in the browser.

| motif | for |
|---|---|
| `plucks(t0, dur)` | establishing shots, the sea: slow pentatonic triangles |
| `swell(t0, dur)` | blueprint interludes: a low saw and a sine |
| `cueNotes(times)` | doubling, cards: one rising note per cue |
| `travel(t0, dur)` | follows: an eighth-note arpeggio with a pulse |
| `sparse(t0, dur)` | pencil pages |
| `impact(t)` | a noise burst and a 55 Hz thump |
| `dyad(t0, dur)` | galleries, sign-offs |
| `bed.hiss()` | sand gestures |

Raw events: `note(t, hz, dur, type, gain)`, `burst(t, dur, gain, seed)`,
`pentHz(octave, step)`. `hdf render` writes the wav and muxes it into
`-final.mp4`; the contact sheet draws note onsets under the tiles.

---

## 9. The CLI

Every command that takes a film also takes `--look <preset>` (restyles every
shot that does not name its own look). A preset may carry modifiers, and those
reach the looks a film pins shot by shot as well, because they change a palette
rather than replace a look: `--look 'doodlePastel~from:teapot'` paints the whole
film in that cutout's own colours and leaves every scene its own sheet. Outputs
are named `<film>[-<look>][-<ar>]`, so variants never overwrite each other.

| command | does |
|---|---|
| `hdf render <film> [--ar 1:1\|16:9\|9:16] [--width 1080] [--workers 4] [--out dir] [--cache-mb 512] [--disk-cache] [--no-sound] [--frames N]` | mp4, wav, `-final.mp4` with sound, contact sheet; records frame hashes for `changed`. `--frames N` draws the first N frames only, to `<film>-<N>f.*` |
| `hdf grid <film> [--n 24] [--width 480]` | n frames spread over the film in one JPEG |
| `hdf only <film> 0,37,74` | single frames as full-size PNGs |
| `hdf board <film> [--cols 4]` | the time tree as text plus one storyboard card per shot |
| `hdf sheet <film> <cel>` | the cel at 3 scales × input extremes × every look, silhouette, 240 px |
| `hdf sheet store <id> [--pose p] [--cycle c]` | a puppet in the store: every pose, every variant, a cycle as a strip → `assets/sheets/<id>.jpg` |
| `hdf lint <film>` | the rules over every frame's list; exits 1 on any finding |
| `hdf changed <film>` | frames whose list hash moved since the last render, as before/after pairs |
| `hdf golden <film> write\|check [--workers N]` | sha256 per frame at 480 px plus the wav |
| `hdf dev <film> [--port 4321]` | the player with hot reload |
| `hdf bundle <film> [--out dir]` | one self-contained HTML player |
| `hdf photo <img> --name <id> [--credit] [--source] [--js photos.js] [--flood\|--keep] [--punch u,v]` | a cutout with its silhouette, colours table and check sheet |
| `hdf photo --refresh <photos.js>` | add the colours table to a module written before it existed |
| `hdf clip <roto.py output> [--js clips.js] [--rig quadruped\|biped]` | a traced clip in the v2 format, with a skeleton per frame when rigged |
| `hdf clip --store <id> --rig <rig>` | a skeleton for a clip already in the store, in place |
| `hdf clip --kind pose <frames-dir\|landmarks.json> --name <id> [--fps 30] [--model] [--no-loop]` | your own motion: MediaPipe pose landmarks per frame -> a biped clip in the store |
| `hdf retarget --clip <id> --to <puppet> --map <map.json> --name <cycle> [--dry]` | a clip's skeleton as a puppet cycle in the store |
| `hdf import <file> --kind <kind> --name <id> [--credit] [--source] [--licence] [--tags]` | any payload into the asset store, validated and hashed |
| `hdf import --v2 <photos.js\|clips.js> [--licence] [--tags]` | a 2.0 data module into the store: one entry per record |
| `hdf svg <file.svg> --name <id> [--kind puppet\|motif] [--roles map.json\|ask] [--flatten 0.6] [--units]` | an SVG into the store as a puppet (rigged from its ids) or a motif, with its colour table and check sheet |
| `hdf find <words...> [--kind]` | search the store: id, kind, licence, what it takes, its check sheet and credit |
| `hdf donate <module> <cel...> [--pack name]`, `hdf donate --manifest` | move cels into packs; rebuild the manifest and sheets |

### handdrawn ↔ davidup

The two projects meet through a pair of bun scripts at the repo root, not a new
item type: a film becomes an ordinary davidup video asset. Both render with
`hdf render`, copy the files into the project's `assets/hdf/` and register them
through davidup's own `register_asset` (in-process, so a clip gets the same
ffprobe metadata an agent's call would). Only the `assets` array of
`composition.json` is rewritten, and an open editor reloads it.

```bash
# a film (and the model sheet of every store puppet it reads) into a project
bun run scripts/hdf-to-davidup.ts fox-and-teapot --project ~/videos/promo [--look risoPop]
#   hdf-fox-and-teapot  video  assets/hdf/hdf-fox-and-teapot.mp4  (1080x1080, 19.5s, sound)
#   hdf-fox-model       image  assets/hdf/hdf-fox-model.jpg

# a video item that plays a film: render it and point the item's asset at the mp4
bun run scripts/davidup-hdf-clip.ts ~/videos/promo/composition.json fox-clip
```

`--project` takes a project directory or a name from the editor's recents
(`davidup list`). The film is a path or a bare name from `handdrawn/films/`.
`davidup-hdf-clip` reads the film from the item's `name`, `"hdf:<film>"`, or
from `--film`; the item keeps its box, timing and fit. Both take `--look`,
`--frames N` (a quick first N frames) and `--dry-run` (print what it would
register; renders nothing). Re-running replaces the assets in place, so after
editing a film, run the script again. Place a registered film with `add_video`
or from the editor like any other clip.

---

## 10. The working loop and the agent skill

Most of the review happens on lists; pictures are for composition, timing and
taste. The loop the skill prescribes, where every "look" means opening one
image once:

1. **Brief.** Subject, length, format, look, and the **anchor**: the one
   element that survives every cut. Template:
   `references/brief-template.md`.
2. **Timeline from recipes and packs**, with a beat sheet as a comment, then
   `hdf board`. Look once.
3. **Cels** that no pack has (usually one or two), then `hdf sheet` for each.
   Look once per cel; it must read at 240 px.
4. **`hdf lint` until clean**, then `hdf grid --n 24`. Look once.
5. **Fix, then `hdf changed`**, and look only at the frames that moved.
6. **`hdf render`**, look at the contact sheet once, then `hdf bundle`.
   Deliver the module, `-final.mp4` and the HTML.

### Using the skill in Claude Code

The skill lives at `.claude/skills/hand-drawn-film/` and loads automatically
when you ask for this kind of film. For example:

> Make a 20-second film about the life of a request inside a GPU server, riso
> look, with a seed dot as the anchor.

> Doodle on this teapot photo: it becomes a ship. 15 seconds, vertical.

> A sand animation of a river from source to sea, one take, 30 seconds.

The agent fills the brief, builds the timeline from recipes and packs, writes
only the missing cels, lints before it renders, and delivers the film module,
the mp4 and a bundle. `work/gpu-request/gpu-request.js` is the result of the
first prompt above: ten beats, the tech pack plus one new cel, and lint clean
before the first full render.

| skill file | holds |
|---|---|
| `SKILL.md` | the model, looks and engines, the procedure, what lint cannot check (the review list), pitfalls |
| `references/api.md` | every export, one line each, generated from the source comments by `node cli/apidoc.mjs` (a test fails if it is stale) |
| `references/recipes.md` | every recipe with timing, plus editing rules and the score motifs |
| `references/looks.md` | roles, presets, deriving palettes, finishes, riso plates |
| `references/engines.md` | found motion (and retargeting), sand, paper in space and photos, condensed |
| `references/assets.md` | the store: every schema, the importers, the SVG and Figma conventions, the hand sheet, rigs and retarget maps, the davidup bridge |
| `references/brief-template.md` | the brief |
| `examples/` | a link to `handdrawn/films/` |

---

## 11. Player, dev server, bundle

`player/player.html` + `player/player.js` draw frames with the same
`core/raster.js` the Node renderer uses. The player has:

- transport: space plays or pauses, ←/→ step a frame (shift: a shot),
  Home/End, `L` loops;
- sound: the synth's samples through Web Audio, started from the scrub
  position, with short grains while scrubbing;
- onion skin (`O`): frame i − 1 in red and i + 1 in blue, drawn in chalk from
  their lists;
- text boxes (`B`): the box of every text op and lettered group in the frame,
  dashed, as `bounds()` and lint see it;
- a shot list from `describe()` that jumps on click;
- one slider per input of the selected cel, a live preview, and "copy values";
- a changed-frame marker.

`hdf dev <film>` serves it on `:4321`. On every edit, to the film or to the
package, it re-imports the module graph without reloading the page and jumps
to the first frame whose list hash moved. `hdf bundle` inlines the player,
every module the film imports (through a data-URL import map) and the records
of every asset it named into one HTML file that plays from disk. For a static
server, use `player.html?film=../films/mini.js&look=risoPop&ar=16:9` (a film
that reads the asset store needs `hdf dev` or `hdf bundle`).

---

## 12. Lint

`hdf lint` walks every frame's list and the time tree. It fails on:

- a colour that is not a role;
- a shot that does not start on paper, night or a backdrop;
- two finishes in one shot, or a look op inside a shot (unless it is an `inset`
  print);
- a missing anchor, or an anchor under 24 px at 240 px wide, or one cut by the
  frame edge without `meta('intent', 'crop')`;
- more than two scribbled parts;
- a cel drawing outside its declared box;
- words beyond the look's allowance (0 by default, 3 for doodle; `look.words`
  changes it);
- a cut longer than 1 s, or two cuts in a row;
- no sign-off, or one still writing 1.5 s before the end;
- cues off the 1/12 s grid;
- an actor's fallback bob (a cycle it lacks) on screen over 1 s in a shot;
- `Math.random`, `Date`, `filter`, `shadowBlur` or gradients in the source.

`hdf import --kind puppet` runs three of them over a payload before it reaches
the store: `puppet-joint` (a pose or a cycle frame that names nothing, or sets
a joint off the 2 degree grid or outside -180..180), `roles-raw` (a hex that
came in from a drawing program where a role belongs) and `cel-box` over the
rest pose, every named pose, every variant and every cycle frame.

It warns, without failing, on an asset the film carries as a data URL instead
of naming in the store (`hdf import --v2`). A film built in memory -- a test, a
sketch -- is welcome to keep its pixels.

Each finding names the shot, frame, rule and fix. Taste (one idea per shot,
composition, timing, cuts, riso density) is the review list in `SKILL.md`.

---

## 13. Determinism, caching, goldens, speed

- **Pure frames.** `frame(film, i)` is a pure function. Seeds are paths: a
  node's seed is `hash(parent seed, name)`, so adding a sibling never
  reseeds its neighbours. No `Math.random`, no `Date`, no host fonts (lettering
  is a built-in single-stroke font).
- **CPU raster.** skia-canvas defaults to the GPU, which is not bit-exact, so
  every Node canvas is created through `cli/skia.mjs` with `gpu = false`.
- **Frame dedup.** A frame whose list hash equals the previous one is not
  drawn; the previous buffer is written again.
- **Layer cache.** A group seen a second time is rasterised once into an
  isolated layer and then blitted from an LRU bounded by bytes (`--cache-mb`).
  Groups that blend with what is under them (multiply, markers, `nightShot`,
  `glow`), or that paint past their bounds (`iris`, `blot`, `scribble`,
  `mosaic`), draw direct. `--disk-cache` persists layers in
  `.cache/engine-<hash of core/ and engines/>/`, so an engine change starts a
  fresh folder.
- **Workers.** `--workers N` splits the film into roughly one-second chunks
  over `worker_threads`. Frames are written to ffmpeg in order through a
  bounded reorder window. Sand workers step from checkpoints. Output is
  identical for any worker count, and the golden test checks every film with 4
  workers.
- **Goldens.** `films/goldens/<film>.json` holds a sha256 per drawn frame at
  480 px wide, plus the wav. They are written on darwin-arm64.

Rendering at 1080 px on an Apple Silicon laptop with 4 workers, including
ffmpeg, the contact sheet and the `changed` baseline:

| film | frames | render |
|---|---|---|
| mini | 54 | 0.6 s |
| held-once | 273 | 6.4 s |
| gallop | 414 | 12.2 s |
| moon-book | 348 | 12.5 s |
| one-year | 474 | 13.7 s |

---

## 14. Package layout

```
handdrawn/
  core/          the pure half and the rasteriser (browser and Node)
    list.js        paths, ops, hashing, bounds, walk, serialise
    rand.js        FNV hashing, path seeds, rng
    curves.js      curves, easings, combinators, pulse / boil
    tree.js        cel, shot, seq, par, hold, cut, lookOn, film, frame, describe, cues
    fit.js         formats and the anchor / reframe / letterbox fits
    looks.js       colour maths, the six presets, derive / duotone / pastel / withLook
    finish.js      finishes as geometry (hatch, halftone, dots, graphite, wash), riso plates, the stock
    tools.js       pen, brush, pencil, chalk, crayon, marker, gouache; reveal
    glyphs.js      the single-stroke hand font (a-z, A-Z, 0-9, punctuation and signs: 94 glyphs)
    text.js        handText, layout, textBox, bullets, measureBox, signOff, squiggleText
    layout.js      line breaking and boxes from a hand's advances and ink (list.js bounds reads it)
    spline.js      the cardinal spline's arithmetic (glyphs.js builds on it at load)
    fx.js          the raster effects
    raster.js      the cached renderer
    synth.js       the offline score renderer and WAV writer
    lint.js        the rules
    marks.js       motifs (seedDot, ripples, hexLattice, aster, tornEdge, thread, ...) and the camera
    photo.js       pin, on, rim, shadow, mask, photoFront, nightfall, glow
    doodle.js      the self-drawing doodle builder
    sources.js     procedural image sources (the sand bed)
    puppet.js      puppets: the data form of a cel (parts, pivots, variants, poses, cycles)
    assets.js      the asset store: kind schemas, validators, the catalogue, fromStore (Node only)
    assets.web.js  its browser twin: the records hdf dev / hdf bundle put on the page
    store.js       the registry fromStore fills, read back by id (browser-safe)
    index.js       the author-facing surface
  assets/        catalogue.json, blobs/<sha>.{webp,json}, src/ (authored payloads), sheets/ (gitignored)
  engines/       traced.js  sim.js  stage3d.js
  recipes/       shots.js (A–Z)  doodle.js (AA–AM)  score.js (motifs)  book.js (book3)
  packs/         creatures.js  objects.js  tech.js  manifest.json  sheets/
  player/        player.html  player.js  deps.js  shell.css
  cli/           hdf.mjs and one module per command; roto.py (tracing); jsscan.mjs (donate); apidoc.mjs
  films/         the seven example films, their clips and photos, goldens/
  test/          node:test suites (npm test)
  work/          your films in progress (gitignored)
  out/           renders (gitignored)
```

---

## 15. Known limits

These came up in the final review and are left as they are, because fixing
them would change how existing films look (and their goldens), or because
they are rough edges rather than defects:

- The pen's `bleed` setting is unused.
- **Lint** counts scribbles per shot rather than per frame, does not check
  roles passed inside fx arguments, and counts distinct words only.
- `mapPaths` moves paths only (not text positions, image boxes or fx
  arguments).
- The doodle recipes (AA–AM) need a `photo`, and have no `.defaults` or
  `.layer`.
- `hdf clip` reads roto.py output, not a v2 clips module.
- A flag without a value placed before the film path swallows it: write the
  path first.
- `sandLook` (v1's camera curve for sand) is not ported; `bed(t, { view })`
  covers the need.
- Goldens are only checked on darwin-arm64; other platforms rasterise
  differently.

---

## 16. Ideas for clips

Each idea below uses the package as it stands: a look, recipes and packs,
usually one or two new cels, and an engine only where the subject asks for
one.

### Explainers

| clip | look | how |
|---|---|---|
| **The life of a request in a GPU server** (20 s) | riso | seed dot as the anchor on the request envelope; N → A (rack, `server`) → G (the envelope flies) → B (blot into the GPU, blueprint) → D (the work splits) → O (eight cards: tokenise, attention, matmul, …) → P → S. See `work/gpu-request/`. |
| **How a vaccine teaches the body** (25 s) | ink | A (a cell on a hatched ground) → C (a spark and construction lines) → D (antibodies double on the cues, `cueNotes`) → J (impact) → M (coda in blueprint) → S |
| **Compound interest, drawn** (15 s) | pencil | Y (pattern sampler as months) → D (coins doubling) → W (a torn section rises with the curve) → Z (an enso closes on the total) |
| **What's inside a coffee grinder** (15 s) | ink + blueprint | A on the grinder cel → B (the blot reveals burrs in chalk) → F (a two-frame macro insert on the burr) → K (vibration as it grinds) → S |
| **How the internet routes a packet** (20 s) | ink | I (clusters as routers, particles as packets) → G (camera follows one packet) → H (the router's "eye" as a mosaic) → S |
| **What a bee sees** (12 s) | ink | A (a flower) → H (the compound-eye mosaic) → G (flight between flowers) → E (UV bands on the petals) → S |

### Found motion (your own movement, traced)

| clip | how |
|---|---|
| **Your dog's run, as Muybridge would have drawn it** | film 12 fps of the dog in slow motion on a plain wall, run `roto.py --kind dark`, then `traced` with `wash`, `airborne()` to freeze the moment all four feet are off the ground, and a `reveal` of the strokes for the title |
| **A dancer's phrase as a brush drawing** | trace a 2-second phrase, play it at half speed (`Math.floor(i / 2)`), draw on with `p`, then hold the pose as a sign-off |
| **Skate trick breakdown** | the same clip three times: at speed, as a zoopraxiscope disc of 12 poses spinning, and frozen at `airborne` with red construction circles (recipe J's devices) |
| **The fox walks like you** | film yourself walking side on, `hdf clip --kind pose`, `hdf retarget --map biped-fox.json --name walk`, and every recipe that walks the fox walks your walk |
| **The parade** | `gallop.js`'s last shot with your own animals: every traced clip crossing the frame on the same ground line |

### Sand (one take, no cuts)

| clip | how |
|---|---|
| **A river from source to sea** (30 s) | sprinkle the mountains, pour the river, comb the water, a palm sweep turns the valley into a delta, and a finger writes the name last |
| **A wedding or anniversary story** (40 s) | two figures poured side by side, the palm sweeps them into a house, the house becomes a tree, and the tree's crown becomes the date, written with a finger |
| **A city grows** (25 s) | start from `cover()` (a dark table); fingers draw streets to the light, sprinkles become blocks, and wind at the end thins it back to a field |
| **Seasons of one window** | `one-year.js`'s structure with a window frame poured first and the world outside it changing; `bed.hiss()` plus a slow pentatonic line |

### Paper in space (pop-ups and paper theatres)

| clip | how |
|---|---|
| **A children's story as a pop-up book** (30 s) | `book3` with three spreads; each spread's pieces rise as it opens, the camera takes one slow move per page, and the lamp dims for the night spread |
| **Product unboxing as a pop-up** (15 s) | the cover is the box lid; the product rises as a cut-out card, and features stand up on the next spread as small cards with drawn labels |
| **Company timeline** (25 s) | one spread per era, each year a standing card on the page; the last leaf shuts the book beside a sign-off card |
| **Paper theatre** | no book: `stage3d` with three layered flats (backdrop, middle and front wings) and a character sheet sliding between them; the shadows sell the depth |

### Doodles on photos (the doodle look)

| clip | how |
|---|---|
| **Grandmother's things at night** (20 s) | five museum photos (The Met or Rijksmuseum, CC0) and a hedgehog: the teapot pours (AC), the clock's hands sweep (AD), the lamp's light escapes (AG), night falls (AE), prints on a line (AF) |
| **A sneaker becomes a rocket** (10 s, 9:16) | `becomesVehicle` on the shoe with a drawn flame, `getaway` for the launch, a vertical render for social |
| **Kitchen objects on strike** | each object "looks back" (AJ), one runs away (AK), and a jar catches the escaped light (AL) |
| **Sunrise over a bowl** | a semicircular object rises behind a drawn hill (AM); a 4-second loopable sting |

### Montages, stings, social

| clip | how |
|---|---|
| **Year in review in 3 seconds** | O with twelve riso cards (one per month) at 4 a second, then P shrinking to the seed dot |
| **Brand sting** (4 s) | N (seed ripples) → S with the brand name as the two handwritten words, in a `withLook` palette built from the brand colours |
| **One film, three formats** | author once at 1:1 and render `--ar 16:9` and `--ar 9:16`; shots fit with `anchor`, `reframe` or `letterbox` |
| **The same story in four looks** | `four-looks.js`'s idea for any subject: render with `--look risoPop`, `screenSea`, `pencilMinimal` and `paperInk`, and cut the four together |
| **24 hours of a lighthouse** (screen print) | T (the lighthouse constant at the same spot) while U cuts day and night around it every 0.5–1 s, with L's tally marks counting the hours |
| **A meditation app intro** (pencil) | W (the page) → X (the dark section) → Z (the enso closes slowly) → S, scored with `sparse` and `dyad` |

### Ambitious (several engines in one film)

None of these has been built yet. They follow from engines returning display
lists, but each needs a first test.

- **Paper horse**: a traced horse drawn on a sheet that stands up in the
  pop-up book and gallops across the spread. `traced` returns a group, so it
  can be a `card3`'s content.
- **Sand in a book**: the sand bed is an image op, and `stage3d` turns image
  ops into meshes, so a page of `book3` could show a hand still drawing in
  sand.
- **Doodle, then sand**: a doodle scene hard-cuts to a sand bed poured into
  the same composition, and a palm sweeps it away for the sign-off.

The v1 skill (`.claude/skills/hand-drawn-canvas-animation/examples/`) has
three films that were not ported and are worth reading for these briefs:
`night-shift.html`, `one-seed.html` and `paper-horse.html`.

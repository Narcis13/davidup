# Looks: palettes, deriving, finishes, riso coverage

A look is `{ name, palette, finish, paper, tools, edition }` (`core/looks.js`).
Ops never carry colours, only **roles**, which resolve against the look in
force: the film's `look`, a `lookOn(look, node)` around a subtree, or a shot's
own `{ look }` option (innermost wins). That is why the same cel renders as ink
on warm paper, riso dots, a screen print or graphite by changing one name, and
why `hdf sheet` can show every cel in every look.

`tools` holds each tool's defaults (the pen is 2.6 wide, 1.6 in
`pencilMinimal`, 4 in `doodlePastel`, 2.2 in `cutout`, 3.4 in `whiteboard`, 3.2 in `chalkboard`, 3.6 in `crayon`, drawn half as thick again, 2.4 in `notebook`); a stroke without its
own `w` or `wobble` takes them, and under a look with a `hand` the hand's pen
profile comes first (see Modifiers below). `edition` (0 in every preset) reseeds every shot drawn in
the look: `withLook('risoPop', { edition: 2 })` is a second print of the same
film, with other hatching, grain, wobble and dot jitter. Ops with an explicit
`seed` keep it.

## Roles

| role | what it is for |
|---|---|
| `paper`, `paperBand` | the daylight stock; faint diagonal light bands (or null) |
| `night` | the dark stock of night and blueprint shots |
| `ink` | outlines and lettering |
| `chalk`, `chalkDim` | light line on night, and its quiet version |
| `guide` | construction lines (carries its own alpha) |
| `fills.N` | 3 to 8 flat fills for subjects and grounds |
| `shade`, `light`, `blush` | hatch or dots over fills; highlights; a warm second shade |
| `accents.N` | four loud colours: scribbles, wakes, sparks, scarves |
| `inks.N` | 2 to 4 print inks for riso plates and dot screens |

Indices wrap (`fills.9` on a 6-fill palette is `fills.3`). A role object
adjusts one: `{ base: 'fills.0', tint: 0.3 }` (towards white),
`{ base: 'ink', shade: 0.4, alpha: 0.35 }`, `{ base: 'light', mix:
['accents.2', 0.5] }`, `{ base: 'fills.1', hue: 20 }`. Use tint and shade
for depth inside one fill (a far ridge `tint: .3`, a near one `shade: .2`);
never a new hue for depth.

## Presets

| preset | look | paper / night | finish | stock |
|---|---|---|---|---|
| `paperInk` | warm paper, brown fills, four fluorescent accents (the fruit-fly film) | `#f3e6cf` / `#0b0d1f` | hatch | bands |
| `risoPop` | cream stock, fluorescent riso inks, purple-navy night (the flipbook) | `#f0ece2` / `#2a2050` | halftone | cream |
| `screenSea` | sea blues, cream sky, an orange desk (the paper boat) | `#e8e6db` / `#1a1c2e` | dots | cream |
| `pencilMinimal` | cream and charcoal, pale sections, thin graphite (the website) | `#f4efe4` / `#27251f` | graphite | cream |
| `blueprintNight` | chalk on navy only | `#0b0d1f` / `#0b0d1f` | hatch | night |
| `doodlePastel` | pastel paper, brush-pen ink, watercolour fills (the doodle film) | `#efd2d1` / `#2c2f5e` | wash | pastel |
| `cutout` | printed card on a table: rust, teal, mustard, olive; a thin steady pen (Gilliam) | `#e6dcc4` / `#1e1b26` | flat | card |
| `whiteboard` | a classroom board: black, blue, red, green markers; light marker fills | `#eceeea` / `#23272e` | marker | board |
| `chalkboard` | a classroom slate: white chalk, yellow, pink and blue chalks; muted rubbed fills | `#2a3b33` / `#161f1b` | chalk | slate |
| `crayon` | wax crayons on cream construction paper: a near-black, red, blue and green crayon; bright waxy fills | `#efe3c6` / `#2d3057` | wax | construction |
| `notebook` | a ruled school notebook page: navy, red, blue and green felt tips; highlighter-bright fills | `#f8f6ee` / `#1c2238` | felt | ruled |

The flipbook is 45% cream paper, then navy, tan, teal and plum, a third of
pixels saturated; the boat film is 41% blues; the website 92% cream and
charcoal. That is how far a derived palette can drift and still be the look.

## Making a palette

```js
look: 'risoPop'                                                        // a preset by name
look: withLook('risoPop', { name: 'gpu', palette: { fills: ['#3a7ca5', '#d9a441', '#c94c4c'] } })   // override keys
look: withLook('paperInk', { palette: { wood: '#b88a5a' } })           // a new role: 'wood' (moon-book does this)
look: derive('screenSea', { hue: 40, sat: 0.8, light: 0.05 })          // the whole palette shifted
look: derive('doodlePastel', { from: PHOTOS.teapot })                   // the palette read off a cutout
look: duotone('risoPop', '#ff48b0', '#0078bf')                          // two inks on the look's paper, halftone
look: pastel('doodlePastel', 'mint')                                    // the doodle palette on another sheet
look: withLook('pencilMinimal', { words: 3 })                           // allow three handwritten words a shot
```

- `withLook(base, part)` replaces fields; `palette` and `tools` merge one level
  deep. It is the only place raw hex belongs.
- `derive(look, { hue, sat, light })` rotates hue (degrees), multiplies
  saturation, adds lightness across fills, accents, inks, shade and blush;
  paper, ink, night and light stay. A cool or warm variant without repainting.
- `derive(look, { from })` takes `from` a cutout record from the store
  (`PHOTOS.teapot` after `fromStore`; every cutout carries a `colours` table,
  `hdf photo --refresh <photos.js>` adds one to a 2.0 module): `fills`
  become its colours biggest area first, `accents` its four most saturated at
  mid lightness, `inks` end on its darkest saturated colour, `shade` on its
  darkest and `blush` on its warmest. The sheet does not move. On the command
  line it is `--look 'doodlePastel~from:teapot'`, which reaches the looks a
  film pins shot by shot too, each keeping its own paper.
- `duotone(look, a, b)`: one or two shots in two inks inside a colour film is
  a strong beat (recipe Q, `duotoneBeat`).
- `pastel(look, sheet)`: `rose mint butter sky cream peach lilac sand night`,
  measured off the reference, or any colour. The doodle look changes sheet
  with every object.
- A look changes only on a cut: give the shot `{ look }`, or wrap a subtree
  in `lookOn`. Lint fails a look op inside a shot (except a print's
  thumbnail marked `inset: true`).

## Modifiers: `~hand:`, `~from:`, `~alpha`, `~ghost:` and `~sheet:`

A preset name may carry modifiers, applied in this order and folded into the
look's name (so caches never collide): `'risoPop~hand:narcis'`,
`'doodlePastel~from:teapot'`, `'paperInk~hand:test~from:violin'`.

- `~hand:<id>`: `look.hand` becomes that store hand (`assets.md`, "Hands").
  Every `handText`, sign-off, doodle reveal and pen stroke of the film is
  lettered and drawn in it; a stroke with `wobble: 0` (hatching, rules) is
  not. Absent, the house hand: byte-identical to 2.0.
- `~from:<id>`: `derive(look, { from })` with that cutout's colours table.
- `~alpha` (4.0 D1): no stock. `paper()` and `night()` draw nothing, so the
  frame is transparent round the drawing; the `paper` role keeps its colour
  (a bubble, an eye white, a knockout). A wash (`blend: 'wash'`) puts the
  paper in behind what is already drawn inside its own path before it
  multiplies, so a watercolour body looks as it does on the page and stays
  opaque; a plain translucent fill (a shadow) stays translucent. `nightShot`
  darkens the drawing only. A `lookNode` inside a list inherits it. `hdf
  render --alpha` (and `loadFilm(path, { alpha: true })`) applies it to
  every look the film pins.
- `~ghost:<alpha>` (4.0 L2; 0.15 when bare): every shot draws the shot
  before it in its seq, at its last frame, over its own stock: that shot's
  stock dropped, the rest flattened and wiped to `alpha` by `fx('erase', {
  mode: 'clear' })`, the way a board is never quite clean. One shot back only
  (a ghost has no ghost of its own); a cut is passed over, so after
  `seq(a, cut('erase', 0.5, a, b), b)` the cut reveals b over a's ghost and b
  keeps it; a hold of a shot keeps that shot's ghost; the first node of a seq
  has what its seq had. `look.ghost` is the field (`withLook(l, { ghost })`).
  Lint reads shots alone, so a ghost's words are not counted.
- `~sheet:<name>` (4.0 L3): another sheet of paper under any look: a
  `SHEETS` name (construction paper: cream, sky, pink, mint, butter, lilac,
  peach, grey), a `PASTELS` name, or any colour (`'crayon~sheet:#c4dcee'`).
  Only the `paper` role changes; the stock's fade, tooth and fibres are drawn
  in it.
- They work in `film({ look })` and a shot's `look` (name the id in
  `assets:`), and as `--look` on any command (found in the store by itself),
  where they also reach the looks shots pin, each keeping its own paper.
- `withLook(base, { hand: record })` pins a hand record directly.

## The cut-out look

`cutout` is a look, not an engine: `finish: 'flat'` (no hatch, no dots), the
`card` stock, and a `cutout` field only the finish pass reads. Under it every
**puppet** on screen is rebuilt as card on a table: each part with a pivot of
its own becomes a piece with a soft shadow down-right, a light paper edge
up-left and a brass fastener (`accents.2`) at its pivot; pivotless parts (an
eye, a mouth) are printed on their piece; the whole puppet is squashed a
touch (`tilt`) as if the camera sat above the table. Code cels and photos are
drawn as usual. The film changes nothing but `look: LOOKS.cutout` (and
`paper: null` on doodle recipes so the card shows); `cutout-fox.js` is
`fox-and-teapot.js` under it. It allows 3 words a shot, like doodle.

## The whiteboard

`whiteboard` is the explainer's home (4.0 L1). Its stock, `board`, is a cool
white sheet with a soft glare across the upper left, the ghosts of old
lessons (the board's, so they stay put across cuts) and an aluminium tray
along the bottom edge with a capped marker in it; keep the bottom 45 units
clear of anything that must read. `penTool: 'bullet'` draws every pen
stroke, lettering included, with the **bullet** marker: round tip, nearly
opaque, a paler dry streak down a broad line, and the look's hand when it has
one (`whiteboard~hand:<id>`). `tool: 'marker'` is still the broad chisel
marker that multiplies. The inks are the four marker colours: `inks.0` black,
`inks.1` blue, `inks.2` red, `inks.3` green; `accents` are the same red, blue
and green and an orange, and `fills` are light enough to letter on. It allows
12 words a shot.

The board's eraser is an fx: `fx('erase', { p, mode, box, band, ghost },
kids)` sweeps a felt eraser row under row across `box` (the frame by
default) as `p` runs 0 to 1. `mode: 'clear'` wipes the kids away where it has
been and leaves a ghost of them (`ghost` 0.06); `'reveal'` (the default) shows
them there, so `cut('erase', 0.8, a, b)` wipes shot `a` off the board to
`b`. `band` is the eraser's width (0.14 of the frame's short side);
`eraser: false` sweeps with no eraser drawn.

```js
fx('erase', { p: ramp(1, 2.2, t), mode: 'clear', box: [120, 200, 600, 400] }, oldDiagram)
```

## The chalkboard

`chalkboard` (4.0 L2) is the board's dark twin. Its stock, `slate`, is a
green-black sheet with the haze of lessons wiped with a felt, a line or two of
old cursive never quite gone (both the slate's, fixed across cuts), chalk dust
in the grain, and a wooden ledge along the bottom with dust on it, a white and
a yellow stick and an eraser; keep the bottom 40 units clear. `penTool:
'chalk'` draws every pen stroke, lettering included, with the chalk tool at
the pen's width and wobble (3.2, 1.1) and the chalk's dashes (13, gap 2.6), in
the look's hand when it has one. `dust: 1` makes every chalk stroke in the
look shed specks either side of the line and let the board show through it
here and there, seeded along the line so a write-on keeps its dust; a ruled
line (`wobble: 0`) sheds none, and no other preset has the field. The inks
are chalks: `inks.0` white, `inks.1` yellow, `inks.2` pink, `inks.3` blue,
and `accents` the same yellow, pink, blue and a green; `fills` are muted, the
colour chalk leaves rubbed into slate, light lines reading over them. The
`paper` role is the slate, so a bubble or an eye white is drawn in chalk
outline. `toolFor('chalkboard')` is `'chalk'` (the writing hand holds a
stick), and `chalkTaps` is its sound. It allows 12 words a shot.

```js
film({ name: 'moon', look: 'chalkboard~ghost:0.15', timeline: seq(a, cut('erase', 0.6, a, b), b), score:
  ({ shots }) => ({ events: [chalkTaps(TITLE, { t0: shots[0].t0, wps: 2 })] }) })
```

## Crayon

`crayon` (4.0 L3) is for the youngest audience: a film with `audience:
'kids-5'` and no `look` of its own is drawn in it (`AUDIENCES['kids-5'].look`;
the other audiences have none, so they still need one). Its stock,
`construction`, is a sheet of construction paper in the `paper` role (cream;
`~sheet:<name>` for another), faded a little in places, with a fine tooth of
pits and ridges and short fibres of the pulp (the fade and fibres the sheet's,
fixed across cuts). `penTool: 'crayon'` draws every pen stroke, lettering
included, with the crayon tool at the pen's width (3.6) times `thick` (1.5), its
three waxy passes half the wobble apart so letters stay legible, in the look's
hand when it has one. `tooth: 1` makes every crayon line in the look skip the
paper's tooth: bites of the sheet through the line and crumbs of wax at its
edges, seeded along the line so a write-on keeps them; a ruled line (`wobble:
0`) or a hairline under 2 wide has none, and no other preset has the field.
`tools.crayon` is 7 wide (the finish and `stroke(..., { tool: 'crayon' })`).
The inks are crayons: `inks.0` a near-black, `inks.1` red, `inks.2` blue,
`inks.3` green; `fills` are bright. `toolFor('crayon')` is `'crayon'` (the
writing hand holds one; `squeak(t, { tool: 'crayon' })` is its sound). It
allows 6 words a shot; kids-5's own allowance is 8.

```js
film({ name: 'moon', audience: 'kids-5', timeline: [a, b] })     // crayon on cream
film({ name: 'moon', audience: 'kids-5', look: 'crayon~sheet:sky', timeline: [a, b] })
```

## Notebook

`notebook` (4.0 L4) is a page of a school notebook. Its stock, `ruled`, is an
off-white sheet with pale blue rules right across it (the `guide` role, so a
film's construction lines are drawn in the same blue) below a clear band at
the top, a red margin line (`accents.0`) and three punched holes down the left
edge; all of it printed (ruled, fixed seed), so every shot is the same page and
only the grain is reseeded. Sizes are in `RULED` (rules 38 apart from 148 down,
the margin 150 in, in units of the frame's short side / 1080): a tall frame
gets more lines, not wider ones. `penTool: 'felt'` draws every pen stroke,
lettering included, with the `felt` tool: a narrow fibre tip (2.4), nearly
opaque and source-over (it caches like the pen), the ink wicking a hair into
the paper along the line and pooling in a dot at each end of a line, in the
look's hand when it has one; a ruled or dashed line neither wicks nor pools.
Inks are felt tips: `inks.0` navy, `inks.1` red, `inks.2` blue, `inks.3` green.
`toolFor('notebook')` is the pen. It allows 12 words a shot.

The margin's motifs (`core/marks.js`), in roles, so they work in any look:
`margin(W, H)` is the strip left of the red line, `[0, 0, 150, H]` at 1080;
`marginDoodle(kind, x, y, s, seed, { role, w })` a small pen doodle about `s`
across (`MARGIN_DOODLES`: spiral, star, cube, heart, flower, zigzag);
`coffeeRing(x, y, r, seed, { role, alpha, twice })` the ring a mug left (a
broken dried rim, a faint stain, a second rim a little off; the coffee is
`fills.4` mixed halfway to `shade`); `paperClip(x, y, len, a, seed, { role, w
})` a wire clip lying along angle `a` in `chalkDim` with a glint and a shadow;
`stickyNote(x, y, s, seed, kids)` as before.

The page turns with `fx('flip', { p, dir, tilt }, kids)`: the page already
drawn lifts at its edge and folds over, its back a paper tone with a sheen
where it curls, casting a shadow on the kids coming into view. `dir` is the
way the page moves (`left`, a book's, by default; `up` for a pad bound at the
top; `right`, `down`), `tilt` how far the corner leads (0.3; 0 is a straight
fold); p eases in and out. As a cut, `cut('flip', 0.5, a, b)` turns shot `a`
over to `b`, in any look.

```js
film({ name: 'notes', look: 'notebook', timeline: seq(a, cut('flip', 0.5, a, b), b),
  score: ({ cuts }) => ({ events: [hits(cuts, { kind: 'flip' })] }) })
shot('a', 3, ({ H }) => [paper(), marginDoodle('star', 75, 260, 60, 1), coffeeRing(880, 860, 120, 2), ...])
```

## Finishes

A fill gets texture from the look's finish when it asks: `fill(path, role,
{ finish: true })`. The finish expands into geometry before rasterising
(hatch strokes, dots, grain rects), so it hashes, projects in 3D and never
boils between frames: it is seeded by the op's seed.

| finish | look | marks |
|---|---|---|
| `hatch` | ink, blueprint | short strokes along the form, 4 to 6 px apart, plus grain |
| `halftone` | riso | a rotated dot screen with a little jitter |
| `dots` | screen | a regular dot grid in a darker tone |
| `graphite` | pencil | sparse thin lines and a few dots |
| `wash` | doodle | watercolour off register from the line; replaces the flat fill |
| `marker` | whiteboard | the flat fill and the faint overlaps of each marker pass, in a darker tone of the fill |
| `chalk` | chalkboard | the flat fill and broad broken passes of a stick's side, in a lighter tone of the fill |
| `wax` | crayon | the fill at 0.3 (`base`), a crayon going back and forth over it in the same colour with the tooth through it, and flecks of the sheet |
| `felt` | notebook | the fill at 0.55 (`base`), then close felt-tip lines at a slant in a touch darker tone, darker where they overlap |

`finish` may also name a finish or carry options: `{ finish: 'hatch' }`,
`{ finish: { density: 0.16, role: 'inks.0', gap: 7, len: 12, alpha: 0.22,
grain: 30, cell: 8 } }` (the boat's faint body). Loose helpers:
`hatchIn(path, { angle, gap, len, role, alpha })` for a light or shadow
patch over a fill, `grain(box, n, role, alpha, seed)` clipped to a path for a
textured ground, `wash(path, role, { al, off })` and `gouache(path, role)`
for the doodle look.

Rules that hold across finishes:

- One finish per shot (lint). Hatching and dot screens in one frame read as two
  films glued together; switch looks on a cut instead.
- Paper first (lint): stock grain is part of every finish.
- Screens are in `shade` or an `inks.N`, never a new hue.

## Riso: dots, coverage, plates

Two ways to riso:

1. **Per shape.** `fill(path, role, { finish: true })` under `risoPop`, or a
   `dots(path, role, { cell, cov, angle })` op. `cov` is coverage 0..1: a
   number, `radial(x, y, r0, r1, c0, c1)` or `linear(x0, y0, x1, y1, c0,
   c1)`. This is the only gradient there is, and it becomes dot size, never a
   smooth ramp.
2. **Per plate.** A card is three plates, one per ink, each a list of shapes
   giving that ink's coverage; later shapes cover earlier ones and
   `knockout(path)` clears. `risoCard(plates, { inks, angles })` prints them
   as rotated halftone screens multiplied onto the paper, so overlaps mix like
   real ink:

```js
const c = (path, cov) => fill(path, 'ink', { cov });          // coverage on this plate
risoCard([
  [c(rect(0, 0, 1080, 600), linear(0, 0, 0, 600, 0.02, 0.35)), knockout(circle(540, 430, 150)), c(rect(0, 600, 1080, 480), 0.85)],  // inks.0
  [c(rect(0, 0, 1080, 600), radial(540, 430, 60, 520, 0.9, 0))],                                                                   // inks.1
  [c(circle(540, 430, 150), 0.95), c(rect(0, 600, 1080, 480), 0.4)],                                                               // inks.2
]);
```

- Design a card as silhouettes with knockouts: the subject white on the plates
  that should not tint it, the sky on one plate only, gradients only as radial
  glows. Angles 15, 75 and 0 degrees (the default) keep screens from moiré.
- Coverage is capped (`maxCov` 0.78) so paper shows between dots. Solid ink is
  an accent, not a fill.
- A card reads at 120 px (badge size). Eight cards make a beat; the reference
  flipbook uses about forty. `four-looks.js` has eight worth copying.
- `plate(role, kids, { box, cell, angle })` is one plate on its own, for a
  plate over a drawn scene.

## Blueprint

Blueprint means "look inside": the same geometry in chalk on night, no fills,
lattices as outlines. Cels that support it take `mode: 'blueprint'` (the pack
`boat` and `fly`); recipes pass `mode` to their subject function
(`(ctx, mode) => node`). For anything else, draw the outline in `'chalk'`
under `lookOn('blueprintNight', ...)`. Recipe B (`blotToBlueprint`) grows the
blueprint out of an ink blot; recipe M (`coda`) fades a blueprint subject.

## Checks

`hdf sheet <film> <cel>` shows a cel in every preset, which is also the
palette check: a cel that only reads in one look is using the wrong roles.
`hdf only <film> 0` at full size shows the stock and finish of the first shot.

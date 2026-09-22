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

**Chapters (4.0 E1).** A lesson runs up to 180 s, cut into chapters of 20 to
40 s. `chapter(title, ...nodes)` (from `recipes/shots.js`) is a `seq` of a
title card (`titleCard`, named `card: <title>`), the nodes, and a hold of the
last node's last frame:

```js
timeline: seq(
  chapter({ title: 'the moon', actor: SAM, audience }, labelled({ ... }), counting({ ... })),
  chapter({ title: 'phases', sub: 'eight of them', actor: SAM, audience, hold: 1 }, cycleShot),
  chapter({ title: 'quiz', card: false }, quizShot),   // card: a node of your own, options for titleCard, or false
  signOffShot({ a: 'sam', b: 'says hi' }),
)
```

The options other than `card` and `hold` go to the title card (`sub`, `actor`,
`audience`, `hand`, `side`, ...). `hold` defaults to the audience's dwell, at
least its cut floor, so the beat between chapters is never a shot lint calls
too short; `0` for none. Marking a seq a chapter changes no frame (the core
form is `chapterSeq(title, nodes, { card, hold })`), and chapters do not nest.
`chapters(film)` lists them (`n` from 1, `f0`, `frames`, `t0`, `dur`), the
score's cues carry them as `chapters: [{ n, title, t0, dur }]`, and
`chapterFilm(film, n)` is one chapter as a film of its own: an excerpt whose
frames are the whole film's, pixel for pixel, and whose sound is the whole
score's stretch under it. `hdf board` gives a card per chapter, `hdf grid
--chapter n` and `hdf render --chapter n` take one, and lint ends with a line
per chapter. A chapter's title card is its own word allowance, like the
sign-off.

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

The teacher's pen (4.0 T7, `core/marks.js`) marks up lettering or anything
drawn. A target is a box, a point, or a group with a `.box` (`textBox`,
`bullets`, another mark); `wordBox(lettered, 'light')` is one word's ink, by
the word or its index. Each mark is a group `mark:<kind>` of pen strokes (in
the look's pen and the shot's hand, so they overshoot and hook like its
lettering). It draws on with `p` and is seeded by its `name`, so an unnamed
mark wobbles the same wherever it goes. Its `.box` is what it draws. Its
strokes come in `order` (1e6 by default), so on a card with lettering it
comes after the words: give each mark its own order (1e6, 2e6, ...) and one
`writeOn` writes the words and then the marks, each in turn. Marks are not
words; a callout's copy is.

```js
underline(wordBox(g, 'light'), p, { wavy, double })   circleAround(target, p, { pad, turns })
arrowTo(from, to, { curve: 0.2, head: 'open' | 'closed' | 'none', p })   // boxes: edge to edge
highlight(target, p)    // a marker band, multiplied: draw it before the copy
strike(target, p, { double })     bracket(target, 'left' | 'right' | 'top' | 'bottom', p, { kind: 'curly' | 'square' | 'round' })  // .tip
starburst(at, p, { n })   tickMark(at, p)   crossMark(at, p)   question(at, 120, p)   // a big drawn ?
callout('a star', target, { leader: 'dot' | 'arrow' | 'line' | 'none', box | dir, reach, p })   // .copy
```

Numbers (4.0 T8, `core/maths.js`) are drawn the way a teacher draws them.
Each is a group `maths:<kind>` built round `{ x, y }`, its `.box` what it draws
when done. Drawn things write on with `p` in stroke order (a fill, a die's pip,
arrives with the stroke before it); coins and pictographs pop in one at a time
as `p` passes each one's share. Figures are lettering, so lint counts them as
words; the ticks, pips and tally marks are not.

```js
equation('2 + 3 = ?', { answer: 5, p })   // p to 0.5 writes it, past 0.5 the ? (a drawn mark) gives way to 5
equation('-3 + (4*2) = 1/2 x')            // "−3 + (4 × 2) = ½x": spaced, * as ×, digits over digits stacked
fraction(3, 4, { whole: 2 })   tally(n)   // tally(2.5): two marks and half the third
numberAxis(0, 10, { at: [3, 7], arrows: true })   clock(3, 40, { numbers: 'quarters' | 'all' | 'none' })
dice(5)   dice([2, 6])   coins(7, { value: 5, layout: 'row' | 'stack' })   pictograph(3.5, apple)
countOn(5, t, { t0, per, at: [[x, y], ...] | [x, y] })   countTimes(5, { t0, per })   // objects on the same beat
textRound('january', { x, y, r, at: -Math.PI / 2, side: 'out' | 'in' })   // upright all the way round a circle
```

The core number line is `numberAxis`, so it does not clash with the AT recipe
`numberLine`. Lint measures lettering turned along a path (textOnPath,
textRound) across its own line: a month standing up the side of a ring is
judged by its letters' height, not their width.

Accented letters are composed, not drawn twice: `ă` is the hand's `a` and a
breve. `MARKS` in `core/glyphs.js` holds fourteen marks (acute, grave,
circumflex, umlaut, tilde, breve, caron, ring, cedilla, comma-below, ogonek,
stroke, macron, dot-above) and `COMPOSE` says which base takes which, filled
from Unicode's decomposition for every letter of Latin-1 and Latin Extended-A,
with the exceptions written out: `ł ø đ ħ ŧ` struck through, the Czech
apostrophe carons `ď ť ľ`, Latvian commas, Romanian `ș ț`, `ı` and an `i` or
`j` that loses its dot under an accent, `ő ű` with two acutes. An accent sits
above the base's measured ink top (lower-set on a capital, clear of a quick
pen's overshoot), a comma under the baseline, a cedilla or ogonek hanging from
the ink, and a second accent stacks on the first. Typographic quotes, dashes,
`…`, `æ œ ĳ` and `¿ ¡` are written with the glyphs they come from; `ß ð þ Þ ŋ
Ŋ ĸ ſ « »` are house glyphs. A mark comes from the hand when it has one (the
`marks` page of the hand sheet), else the house's; either way the advance is
the base's, so `measure` and layout see a composed glyph like any other.
Anything else that decomposes into a base and known marks (pinyin's `ǎ`)
composes too; an unknown mark is dropped.

```js
handText('mulțumesc, pa', 40, 80, { size: 48 })   // ț is t plus comma-below
fallbacks('Dvořák', 'narcis')                     // what the house draws for a hand: letters or marks it lacks
unknowns('спасибо', romans)                        // a hand record: what nothing draws: it letters as '?' (lint hand-missing)
```

Hershey fonts come in as hands (4.0 T3, `core/hershey.js`): `hdf hand
--hershey <file.jhf> --name <id>` reads James Hurt's JHF format (each glyph a
line of coordinate pairs as letters about `R`, ` R` lifting the pen). A
position map says which character each of a file's 96 ASCII-ordered glyphs is:
`ascii`, `greek` or `cyrillic`. The em is scaled so capitals stand at 72, and
the advance is the glyph's bounds (track 0, so a script's joins meet).
Licence `PD`, and the credit carries the acknowledgement the licence requires.
`--merge <hand>` adds a file's glyphs to a stored hand and keeps the hand's
own. `assets/src/hershey/` vendors `romans`, `scripts` and `cyrillic`, and the
store has them as `hershey-romans`, `hershey-script` and `hershey-cyrillic`. A
hand's own base letter takes Unicode's marks too: `Ё` in `hershey-cyrillic` is
its `Е` and the house's umlaut.

Any font comes in as a hand too (4.0 T4): `hdf hand --font <file.ttf|otf>
--name <id> [--glyphs latin,cyrillic,greek,symbols] [--px 400] --licence OFL`
loads the file with skia-canvas's `FontLibrary`, draws each character the font
itself has (the text's runs say when skia falls back to another face) black
on white at 400 px, and traces it as the sheet reader traces a box: Zhang-Suen
(with Lü and Wang's rule, so a two-pixel diagonal survives: the second bar of
`×`), whiskers pruned, then `serifs()` (a pair of thin spurs across a stroke's
end goes; an f's cross bar, a t's, an x's bars stay), the font's pen taken
from its `l`. The em is scaled from the traced centre lines of its `H` and
`z`, splitting the difference between the house's cap height (72) and
x-height (48), the H's foot on the baseline. The advance is the font's (track
0), the pressure its width profile, hook 0, and the wobble the pen's that
letters it. Its spacing accents (´ ˘ ˇ ...) become the hand's marks. The report
names what the font lacks and the glyphs whose stroke count is more than two
off the house's, to eyeball on the sheet. Without `--licence` the hand is
`unknown`, and lint `credit` fails any film that letters in it (or names any
asset so licensed); a free font is usually `OFL`.

And the other way (4.0 D3): `hdf hand --export-ttf <id> [--family] [--pen 4.5]
[--no-composites] [--text '...']` writes a stored hand (or `house`) as
`out/<id>.ttf`, a TrueType font anything that sets type can use: davidup's
text item, a word processor. Each glyph is its centre lines as `handText`
draws them (slanted, corners overshot, entries hooked, seeded per stroke) swept
by the pen (4.5 em units, `handText`'s own): a round cap at each end and at
each join that turns more than 20°, a wedge at a gentler one, and a four-sided
run along each step as wide as the hand's pressure at its middle, as the pen
presses. The pieces overlap and all wind one way, so TrueType's non-zero fill
is their union with no boolean work. The em is 1000 units (10 per em unit),
ascender 950 and descender -300 (a line of 1.25, `layout`'s), the advance the
glyph's plus the hand's track. A composed glyph (4.0 T2) that is one base and
marks moved into place is a composite of the base's glyph and the marks' own
(unencoded `mark.<name>` glyphs), so `ă` is `a` and a breve; a mark fitted to
its base or squashed over a capital, and `æ`, are outlines. Characters
the hand would letter as `?` are left out, so a type setter falls back to
another face; `.notdef` is the hand's `?`. `core/ttf.js` writes the tables
(glyf, loca, cmap format 4, hmtx, name, OS/2, post): opentype.js writes CFF
with no composites, so there is no dependency. `out/<id>-ttf.png` is the proof,
a line set in the font by skia above the same line lettered by `handText`.

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

The teaching set (4.0 E2 to E4): AN `titleCard`, AO `labelled`, AP `counting`,
AQ `compare`, AR `process` (cards with arrows), AS `cycleDiagram` (steps on a
ring, their names along it, a marker going round), AT `numberLine` (hops a
unit at a time, `hopTimes` for the score), AU `growth` (a bar or a pictograph
rising, its number counting on), AV `questionCard` (a big drawn `?`, the
teacher shrugging), AW `quiz` (options, a pause, the wrong ones crossed, the
right one ringed; `quizTimes` for the tick and the ding), AX `mapRoute` (a
marker travels a route over a drawn `map` or a cutout photo, the label along
it), AY `dialogueShot` (two actors on a ground playing T9's `dialogue`;
`dialogueOf` for the score), and `chapter` (E1) that opens each chapter
of a lesson with AN. `process` shares its name with Node's global: import it
as `process as steps` in a film that also reads `process.argv`.

`textOnPath(str, path, { size, offset, align, at })` (core) letters one line
along any path by arc length, each glyph turned to the heading at its middle,
standing on the path's left as it runs; round the bottom of a ring, run the
path left to right beneath it to keep the letters upright. It is a lettered
group like `handText`'s, so lint counts and reads it.

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

The clip keeps its stride (4.0 K7): `advance`, how far the body travels each
frame in figure heights, read off the planted foot (of the ankles moving back
against the hip, the lower), so a panning camera or a treadmill does not fool
it; `hdf clip` prints it beside how far the hips crossed the picture, which
agree when the camera held still. `hdf retarget` carries it onto the cycle as
`advance` in the puppet's box heights, scaled by leg length (the puppet's hip
to ankle over yours), and says what the puppet's own feet make of it (a few
percent under: the 2 degree grid). `strideOf` and `walkTo` still measure the
feet where a foot is down, so nothing slides; the clip's advance fills the
frames with no foot down (a lifted frame: a run's flight) and a puppet with no
two feet, and `strideOf(...).captured` is the clip's stride to hold the
measured one against.

### Your face and hands

A phone clip of you talking drives a puppet's face (4.0 K7, `core/face.js`).
`hdf clip --kind face` runs MediaPipe's face landmarker (`cli/track.py`, its 52
blendshapes a frame) and stores a *face track*: a clip entry with `track:
'face'`, twelve channels a frame at 12 fps (jaw, smile, pucker, blink-l,
blink-r, wide, brow-up, brow-outer, down-l, down-r, look-x, look-y), each less
the take's resting level, a blink kept as the most of its twelfth of a second.
`--kind hands` does the same with the hand landmarker: five finger curls per
hand a frame (1 straight, 0 curled), the hand further left in the picture `l`.

```bash
ffmpeg -i talk.mov -vf fps=30 work/talk/%04d.png
hdf clip --kind face work/talk --name me-face        # out/face-me-face.json kept; model in .cache/
hdf clip --kind hands work/talk --name me-hands      # out/hands-me-hands.json
hdf stick --name sam --hands fingers                 # hands with open, fist, point and thumb
```

```js
const T = fromStore(['me-face', 'me-hands', 'talk']);
SAM.place(x, y, s, { ...state, ...SAM.face('me-face', t, t0), ...SAM.hands('me-hands', t, t0) });
score: [voice('talk', t0)]                            // the recording the face was filmed with
```

`actor.face(id | track, t, t0 = 0, { mirror })` is a state patch: the mouth
(jaw 0.5 D, 0.3 C, a pucker E or F, a little B, a smile the puppet's happy
mouth, else X, through the puppet's own mouths as V3 maps them), the eye (both
blinks its shut eye, one a wink, half-shut `half`, wide `wide`, else `open`,
each only when it has it), the brows (its own `worried`, `surprised` and
`angry` scaled by brow-up, brow-outer and down, on their grids) and the pupils
(the gaze times their slide range); `{}` outside the track or for a code cel.
`actor.hands(id | track, t, t0, { mirror })` picks, for a hand part with
variants, the nearest of `open fist point thumb` it has. The picture's left
drives the drawing's left (`-l`), which for a person and a puppet both facing
us is the same side of the body; a selfie camera's mirrored picture wants
`mirror: true`. MediaPipe and the model files are needed once; the kept
landmarks remake the track with nothing installed. A track draws nothing:
`registerClip` refuses one.

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
closed: `CC0 | CC-BY | CC-BY-SA | OFL | PD | own | unknown`.

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

### Stick puppets

A stickman is its own rig (4.0 K2, `core/stick.js`). A stick payload names
joints (the side view, facing right, ground at y = 0) and the bones between
them; `puppet()` compiles it to ordinary parts, so sheets, lint, the cut-out
look and the actor contract see a puppet like any other:

```bash
hdf stick --name sam [--h 300] [--build kid|adult|tall|round] [--style line|tube] [--hands dots|mitts|none] [--no-face]
hdf retarget --clip me --to sam --name walk     # no --map: a stick's joints are the biped rig's
hdf sheet store sam --cycle walk                # the turnaround and the walk
```

`hdf stick` writes `<store>/src/sam.stick.json` (edit it and `hdf import` it
as a puppet to take the edit) and stores it compiled, the source kept as the
payload's `stick`. A bone is a part pivoting at its proximal joint, one pen
stroke to its distal joint (a filled capsule in `tube`), named for the distal
joint in the standard biped names: `body, neck, arm-l, fore-l, leg-l, shin-l,
foot-l`, ... ; the root is `hips`, the head a circle on a part at the neck,
hands `hand-l/-r` at the wrists. A face prints on the head: `eye` (open,
happy, sleep, wide, half, wink), `pupil` (slides), `brow-l/-r` (turn and slide), `mouth`
0..5 (shut, three openings, an oo, a smile: `emote('happy')` takes the
smile). The three views are generated from the joints: the front stands each
pair `spread` from the middle, -l on the drawing's left; painter order is -l
limbs, trunk and face, -r limbs. The box holds anything the limbs reach from
the hip, so a raised arm fits. A regenerated stick keeps its retargeted
cycles.

### A drawing that walks: the rig sheet

A child draws a character in labelled boxes and it walks (4.0 W1,
`core/rigsheet.js`, `cli/sketch.mjs`):

```bash
hdf hand --template --rig biped > out/rig-sheet.pdf          # print it (--rig biped,biped-front adds the face-on page)
hdf sketch mia.jpg --sheet biped --name mia                  # the photo -> the puppet 'mia' and its sheet, walking
hdf sketch mia.jpg mia-front.jpg --name mia                  # with the face-on page: views side and front
hdf hand --template --rig biped --drawn > out/rig-drawn.jpg  # a sheet drawn in by the package (tests, a demo)
```

The sheet has a box a piece, one side: head, body, upper arm, forearm, hand,
thigh, shin, foot, drawn side on, looking right. Each box prints an orange
dot, where the piece is pinned, and orange rings, where the pieces below it
are pinned, over a faint guide shape; arms and legs hang straight down. Every
box is a window onto one figure (`RIG.joints`, 180 mm tall on the page, 300
units in the puppet), so the pieces meet when they are put together. The
corner marks, homography and sampling are the hand sheet's; the code squares
say which sheet a photo is (rig sheets are 4 and 5, hand pages 0 to 2), so
`hdf hand` refuses a rig sheet and `hdf sketch` a hand page.

Reading a box: pixels are judged against the box's own paper. Dark grey marks
are ink: thicker than 2.6 mm a blob (a black shoe), small and round a dot (an
eye), the rest thinned to strokes as the hand sheet thins letters. Colour
(crayon, felt tip) is split into colour classes, each closed over together
with the ink round it, so a coloured-in area is one `fill` with `finish: true`
that reaches under its outline and swallows colouring over the line; a thin
run of colour is a stroke of its own. The colour most lines are drawn in is
`ink`, as is any dark grey; the others get roles from `autoRoles` (the nearest
house fill or accent), so looks recolour the drawing. A greyscale photo still
reads, but light colours drop out and dark ones become ink.

The puppet has the standard biped names in painter order far arm, far leg,
near leg, `hips` (the root, drawing nothing), body, head, near arm; both sides
come from the one box. `views: ['side']`, or `['side', 'front']` with the
face-on page (its head, body and foot; the limbs hang from the shoulders and
hips its body box marks, the -l ones mirrored). Its box holds the vocabulary's
cycles untempered, so `walk`, `run` and `jump` play at full swing, and it
carries `skeleton` (joints and bones in the stick's names), so `hdf retarget
--clip me --to mia --name walk` needs no map. `hdf sketch` writes
`out/sketch-<id>-trace.jpg` (the photo straightened, lines red, fills blue,
dots green) and the store sheet with the walk as its strip: `hdf sheet store
<id> --cycle <name>` now falls back to the vocabulary's cycle when the puppet
has none of its own. A blank box is reported and its part draws nothing; a
blank body is an error. Re-reading a sheet keeps retargeted cycles.

### The pose vocabulary

Every biped knows how to point, shrug and cheer (4.0 K3). `packs/poses/biped.json`
holds poses (`idle, stand, point-l, point-r, wave, think, shrug, cheer,
facepalm, bow, sit, kneel, fall, sleep, look-up, carry, push, write, present,
hands-on-hips, arms-crossed`), cycles (`walk` 8, `run` 6, `jump` 6, `breathe` 4,
`talk-hands` 6) and expressions (`happy, sad, wide, sleep, surprised, angry,
confused, thinking, laughing, worried, wink, bored`), all keyed on the standard
biped part names, joints on the 2° grid:

```js
const SAM = actorOf(puppet('sam'));
SAM.put(d, x, y, s, { ...SAM.pose('point-r'), ...SAM.emote('confused') })
SAM.pose('cheer', k)        // rest -> cheer by k: joints lerp, variants switch at half-way
SAM.cycle('talk-hands', t)  // the vocabulary's cycle, as the puppet has none of its own
SAM.vocabulary              // { poses, cycles, expressions } that apply to it
```

`pose`, `emote` and `cycle` look in the puppet's own poses and cycles first and
the vocabulary after, through the actor's `known()`, which drops the parts a
puppet lacks: a stick has every name, the fox takes its arms, legs and face
(no forearms, so no `hands-on-hips`), the octopus its arms and eyes. An entry
*applies* when the puppet has every part in its `needs` and keeps a key;
`pose()` of one that does not is `{}` and `cycle()` bobs as before. A variant
may be a list, the first the puppet has winning (`eye: ["wink", "happy"]`).
The vocabulary's `body` is a trunk above the hips, so a puppet whose `body` is
its root (the fox, the octopus) does not take its turns: the fox bows with its
head. An entry is *tempered* to fit: its turns and slides are scaled towards
rest in tenths until the figure stays in its box in every view whose rest does,
so lint's `cel-box` holds for whatever the vocabulary asks (the octopus cheers
as high as its box lets it). Sign convention: an -l limb turned positive and
an -r limb turned negative swing out and up; in profile a negative turn swings
any limb forward. `views` names the poses drawn side on (`sit`, `bow`, `walk`,
...); the rest read from the front. A vocabulary frame's `lift` is the stage's
(4% of the figure's height), not puppet units. `EMOTES` is the file's
expressions. A code cel or a doodle builder (the hedgehog) has no vocabulary.

```bash
hdf sheet store sam --vocabulary    # assets/sheets/sam-vocabulary.jpg: every pose, expression, cycle that applies
```

`hdf bundle` inlines the file as a JSON module (`data:application/json`);
`hdf dev` serves it as JSON.

### Performance: a pose timeline

Direct a character with a script, not a state per frame (4.0 K4,
`core/perform.js`):

```js
const act = perform(SAM, [
  [0, 'idle'],                                              // where it starts: held from before, no blend
  [0.5, 'point-r', { ease: 'out', dur: 0.25 }],             // a pose, blended in over dur
  [1.5, { head: 10 }],                                      // a patch: only the keys it names
  [2, ['cheer', 'happy'], { anticipate: 0.15, overshoot: 0.1 }],
  [3, 'walk'],                                              // a cycle is a moving target
]);
SAM.place(x, y, s, act.state(t));   // pure in t
act.events(shot.t0);                // a soft pluck as each named entry lands (not the first; sound: false)
act.beats;                          // [{ t, from, land, settle, names }]
```

A name is looked up as a pose, then an expression, then a cycle, the
puppet's own before the vocabulary's; `'pose:sleep'`, `'emote:sleep'`,
`'cycle:walk'` say which. A named pose is the whole body: a key the last pose
put there and this one lacks goes back to rest. An expression is the whole
face the same way, and an object changes only its keys until something sets
them again, so a cheer's smile stays when the walk after it has none. A blend
starts from wherever the key is, so an entry that interrupts another picks it
up mid-move. `anticipate` spends that many seconds before `t` winding a tenth
of the change the other way; `overshoot` passes the target by that fraction
of the change and settles back over half the blend (at least a drawn two).
Variants (eye, mouth: `actor.variantKeys`) switch half-way. The state is
evaluated on the twos (`{ on: 1 | 2 | 3 }`) and quantised on each input's
step, so frames where the pose holds are the same list and dedup
(`films/pointing.js`: sam points at three labels in turn).

`layer(base, extra, { parts, weight, rest })` adds extra's change from rest
to base on the named parts, so a walk carries a wave:
`layer(perform(SAM, [[0, 'walk']]), SAM.pose('wave'), { parts: ['arm-r',
'fore-r'] })`. Either side may be a state, `t => state` or a performance;
`dir` and variants are not added (extra's win at a weight of a half or
more). The recipes that take `actor:` for a subject or figure (A, G, M, U, W,
X, Z) take `perform:` too, a performance of that actor or its script, played
in place of the idle (G's walk; the facing still follows the path).

### Reach, look-at, planted feet

Inverse kinematics where it earns its place: hands, eyes, feet (4.0 K5,
`core/ik.js`). Everything works in the puppet's own drawing, unmirrored and
facing +x, on the standard biped names, and hands back a state patch
quantised on each input's step, so a held reach dedups like a held pose.

```js
const at = [x, y, s];                                        // where the actor stands on the stage
reach(SAM, 'hand-r', [700, 380], { at, state });             // { 'arm-r', 'fore-r' }: the wrist on the point
reach(SAM, 'foot-l', [300, 950], { at, state, elbow: 'front' });   // a leg: leg-, shin-, the ankle
SAM.place(x, y, s, { ...state, reach: { 'hand-r': [700, 380] } });  // the same, done by place
lookAt(SAM, [900, 200], { at, state });                      // { dir?, head, 'pupil.x', 'pupil.y' }
lookAt(SAM, FOX, { at, state, other: [fx, fy, fs, foxState] });   // at the other's head
const w = walkTo(SAM, -150, 520, 0.5, 3, { s: 260 });        // x0 -> x1 from t0, arriving at t1
SAM.place(w.x(t), y, 260, w.state(t));                       // w.steps: when each foot lands (a score)
SAM.place(x, y, s, stand(SAM, act.state(t)));                // the lower ankle on the ground line
```

`reach` is analytic two-bone IK on shoulder, elbow and wrist (hip, knee and
ankle). The end lands on the point, or the limb straightens towards it when
the point is out of reach. `elbow` says which way the middle joint bends:
`down`, `up`, `front`, `back`, `out` or `in`. An arm bends `down` by default
and a leg `front` (`out` in the front view). A limb of one segment (the fox's
arms) is aimed at the point, as `place`'s `hand` always aimed one. `hand` now
reaches with two bones on a puppet that has a forearm and a hand. `lookAt`
turns the head towards the point (at most `max`, 30°, and never so far that
the figure leaves its box) and slides the pupils the rest of the way in the
head's frame. A puppet facing away turns round (`turn: false` stops it). Front
on, only the pupils move. `headAt` and `partAt` say where a head or a part's
pivot is on the stage. `dialogue(..., { gaze: true })` has the speakers look
at each other.

`strideOf(actor, 'walk')` measures how far the body travels each frame of a
cycle so the foot on the ground stays put. It uses the cycle's own `advance`
when the frames carry one (K7). Otherwise it measures the ankles: the planted
foot is the lower of the feet moving back. `walkTo` deals the cycle's frames
out over the time (a slow walk holds frames, a quick one skips) and moves x
with the planted foot frame by frame, the rounding spread thin. It arrives on
a frame with both feet down, holds it `hold` seconds, then stands. Each
walking frame goes through `stand`, which lifts or sinks the body so the lower
ankle is where the rest pose has it. A walking state carries `walking`, so
`place` adds `meta('feet')` with the ankles on the stage, and lint's
`foot-slide` fails a frame where every ankle on the ground drifts more than 2
units along it. A cycle slid across at a steady speed fails; `walkTo` passes
(`films/walk-on.js`: sam walks on, looks up at a balloon and takes its
string; the fox looks at the teapot's handle and reaches it). A code cel or a
doodle builder has no skeleton: `reach` gives `{}`, `lookAt` only turns it,
and `walkTo` slides it at `speed`.

### Secondary motion: tails and scarves

Tails, ears, hair and scarves follow through (4.0 K6, `core/follow.js`). A
part with `follow` is not a joint the film sets but a spring on its parent's
world angle: it aims at the parent's angle plus its own stated angle (so a
stated wag still wags), gets there late and swings past, and the pivot's
acceleration swings it like a pendulum (a jump, a landing).

```js
parts.tail  = { parent: 'body', pivot: [-34, -128], follow: { lag: 2, damp: 0.7 }, ops };
parts.scarf = { parent: 'neck', pivot: [0, -255], chain: { n: 4, len: 18, w: 9, angle: 60, role: 'inks.2', taper: 0.3 },
                follow: { lag: 2, damp: 0.5, limit: 45 } };             // scarf, scarf-2 .. scarf-4
SAM.place(x, y, s, act.state, t);             // a state function and the time: follow parts settled
SAM.follow(act.state, t);                     // the same state, to merge or hand on
FOX.cycle('walk', t);  fox.frameOf('walk', t); // a cycle's frame, the tail settled on the loop
fox.settle(stateAt, t, { lift });             // { tail: deg }: the puppet-level answer
```

`follow` takes `lag` (frames to catch up, default 2), `damp` (the damping
ratio, 0 to 1, default 0.7: 1 never swings past, 0.3 swings a few times),
`inertia` (how much the pivot's acceleration swings it, default 1), `limit`
(degrees it may trail its target, default 75) and `len` (the pendulum's length;
by default 4/3 of the distance from the pivot to the part's ink centre). The
answer is pure in t: the spring is run over the frames before t on the 1/12 s
grid, from rest a few settling times back, reading the state function at each
(the actor passes the function, not a value), so nothing remembers frames and a
worker starting its range anywhere draws the same frame. The joint comes back
on its grid and in its range. A state that never changes settles to exactly
the angle it states, so a plain state object draws as before: only a film that
hands `place` a function (or a recipe's `perform:`, which does) sees the lag.
A stage `lift` in the history (a jump) counts as the pivot moving up.

`chain: { n, len, w, angle, role, taper }` makes a rope of `n` parts from one:
the part is the first link and `<part>-2` .. `<part>-n` hang from it, each a
stroke `len` long pointing `angle` degrees from straight down (positive is
back, towards -x), `w` wide narrowing by `taper` to the tip. Every link
follows, so a turn of the neck runs down the scarf a link at a time. A stick
source takes extra parts in `parts` (a pivot may name a joint: `pivot:
'neck'`; `before: 'head'` sets painter order). In SVG: `data-follow="lag:2,damp:0.7"`
and `data-chain="n:4,len:18,w:6,angle:60"`. The fox's tail follows, so `hdf
sheet store fox --cycle walk` shows it a frame behind the walk; every film
that places the fox with a state object is unchanged. `films/follow.js`:
sam jumps in a four-link scarf that swings after the landing, bows and
stands; the fox walks on, waves with its tail overshooting, and falls asleep.

### Props: sockets and attach

The teacher holds the chalk; the fox holds the teapot (4.0 K8,
`core/props.js`). A puppet's `sockets` are places on its parts where something
is held; a prop is drawn *inside* the part's group, so it turns with the hand,
mirrors with the puppet and sits in painter order with it.

```js
sockets: { 'hand-r': [x, y, angle] }                     // on the part of that name, in its own coordinates
sockets: { 'hand-r': { part: 'arm-r', at: [0, 45], angle: 0 } }   // on any part; at, angle may be keyed by view

const POT = attach(FOX, 'hand-r', photo(pin(PHOTOS.teapot, { x: 0, y: 0, h: 110, pivot: [0.95, 0.32], flip: true }), { shadow: 0 }),
                   { s: 150, level: true, rot: tilt, tip: SPOUT });
FOX.place(x, y, 150, { ...state, props: [POT] });         // the pot in the paw
propAt(FOX, POT, [x, y, 150], state)                      // where the spout is on the stage: the tea pours from it
const CHALK = attach(SAM, 'hand-r', heldTool({ tool: 'chalk' }), { scale: 0.45 });
SAM.place(x, y, s, { ...state, ...held(SAM, CHALK, [700, 480], { at: [x, y, s], state }), props: [CHALK] });
writer(node, t, { ...WRITE, by: { actor: SAM, at: [x, y, s], state, prop: CHALK } });   // sam writes it
```

A socket is `[x, y]` in its part's coordinates (the pivot the origin, as the
part's ops are) and `angle`, the degrees a prop's +x points there; it draws
nothing, so a puppet with sockets hashes as one without. In SVG a `<circle
id="socket:hand-r" data-angle="0">` inside a part is one (per view, where it
moves). The fox has a socket in each paw (`hand-l`, `hand-r`, on its
one-segment arms); a stick has one in each hand, at the hand's middle and
pointing on along the forearm (with no hands, at the wrist). A stick source's
`sockets` add more.

`attach(actor, socket, what, o)` makes a prop: `what` is a cel (called with
`o.inputs`), an op or a list, or `{ node, grip, tip }`; `grip` is the point of
it that sits in the socket, `tip` the point that does the job (a chalk's end,
a spout); `rot` turns it about the grip; `scale` is drawing units per unit of
it, and with `s` (the actor's stage size) it is drawn in stage units; `level`
keeps its own angle in the drawing whatever the arm does (a pot carried
upright, tipped only by `rot`); `behind` draws it first in the part's group.
`place` takes `props: [prop, ...]`; each is worked out from the final state,
so it follows `reach`, a walk, a mirror. The drawing's box grows to hold it.
`held(actor, prop, [x, y], { at, state, elbow })` is `reach` for the tip: the
two-bone solve runs the lower bone out to the tip (`reach`'s `tip: { part, at
}`), so the chalk's end lands within the 2 degree grid (a few units); a
one-segment arm points the tip at the point. `propAt` and `socketAt` say where
a point of a prop or a socket is on the stage. `heldTool({ tool, ink })` is a
pen, marker, chalk or crayon on its own, gripped at the origin, its point
ahead; `writer`'s `by` has a puppet write instead of the drawn hand: the arm
rises over the lead, the tip follows the pen and lifts between units, and the
actor is drawn before and after. A prop and the groups that hold it draw
direct, never from the layer cache: a cached layer of a group holding a turned
photo differs by a few levels from the group drawn straight, and which one a
frame got would depend on the frames before it.

`films/holding.js`: the fox lifts the teapot it holds, level, tips it and
pours into a cup under the spout; sam writes `1 + 2` on a chalkboard with
the chalk in its hand, walks on (half a stride, feet planted), writes `= 3`,
walks clear of the sum and turns to us.

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
- `data-follow="lag:2,damp:0.7"` makes a part follow its parent (4.0 K6) and
  `data-chain="n:4,len:18,w:6,angle:60"` a rope of following links from it;
- `<circle id="socket:hand-r" data-angle="0">` inside a part is a socket where
  a prop is held (4.0 K8); it is not drawn;
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
is any expression of the vocabulary (a puppet's own pose of that name wins),
`pose(name, k)` a named pose, its own or the vocabulary's (above),
`cycle(name, t)` is a declared cycle or the vocabulary's, `reveal(tau)` draws it in stroke order.
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

### Sound effects and a bed

`recipes/sfx.js` (4.0 V4) is a kit built from the same synth. Each effect is
`(t, options) => events`:

| effect | sound |
|---|---|
| `pop(t)` | a cork: a sine swept up an octave and a half in 70 ms, and a click |
| `boing(t)` | a spring: a triangle bent up a fifth with a wide vibrato |
| `whoosh(t, { dur, down })` | noise swelling through a band-pass swept up (or down) |
| `ding(t)` | a bell: a sine, a 2.76 partial and an octave, ringing 1.4 s |
| `tada(t, { key })` | a short triad, then the triad held with its octave |
| `tick(t)` | a short high noise and a click |
| `squeak(t, { tool, dur })` | a tool on the surface: `marker` (a squeal), `chalk`, `pen`, `pencil`, `crayon` |
| `flip(t)` | a page turning and landing |
| `erase(t, dur, { strokes })` | an eraser scrubbing, a swell a stroke |
| `pencilScratch(t, dur)` | seeded grains of high, narrow noise |
| `chalkTap(t)` | a knock and a dry tick |

`hits(cues.cuts, { kind })` puts an accent on each cut: by default a whoosh
centred on it, or pop, tick, boing, ding or flip. `writerSounds(node, { t0,
tool, ...schedule })` takes the same schedule as `writeOn` / `writer` and
plays the tool on each unit the hand writes, from the end of its lift.
`eraserSounds({ t, dur, box, band })` plays one scrub for each row of
`fx('erase')`'s track.

`bed({ mood, key = 'C', tempo, from, to, gain })` is a chord loop through four
chords. The moods are `bright` (I V vi IV, triangle hits, eighth-note
arpeggio), `calm` (sine pads), `mystery` (a minor key, low pads, a few high
notes) and `march` (square hits on every beat, a snare on 2 and 4). Its bar is
a whole number of twelfths, so the tempo is snapped (112 becomes 110.77) and
every downbeat lands on a frame. The result is an array of events, so you can
drop it into a score as it is, and it carries `bar`, `tempo`, `bars`,
`stop(t)` (everything released by `t + 0.35`) and `sting(t)` (the tonic
climbed on the frames, then held). The bed ducks 9 dB under a voice along
with the rest of the score.

The synth fields behind the kit work on any event, and an event without them
sounds exactly as before. `hz1` with `bend` and `glide: 'exp' | 'linear'`
moves a note's pitch, or a hiss's band, from `hz`. `vib` and `vibDepth` add
vibrato. `sus` holds a note at its gain for that fraction of `dur` before the
release. `swell: true` makes a hiss rise and fall over `dur` with no tail.
`films/quiz-time.js` (21 s, whiteboard, kids-9) uses them all: two narrated
lines over a bright bed in G, the marker, a whoosh, a pop per option, a tick
per wrong answer, a ding, the eraser, and the sting.

### Narration

A recorded line is a store sample under a shot (4.0 V1):

```bash
say -v Samantha -o line.wav --file-format=WAVE --data-format=LEI16@22050 "Here comes the ball."
hdf import line.wav --kind sample --name mini-line --licence own --credit "macOS say"
```

```js
import { voice } from 'handdrawn';
film({ ..., assets: ['mini-line'], score: (c) => [plucks(0, 2), voice('mini-line', c.shots[0].t0 + 0.5)] });
```

`voice(id, t, { gain = 1, dur })` plays the sample from `t` at `gain` (as
recorded; the master does not scale it), cut at `dur` when given. Everything
else in the score ducks 9 dB under the line's voiced part (energy above
-40 dBFS), with 0.15 s ramps either side. `core/wav.js` reads 8/16/24/32-bit
PCM and float wavs, plain or extensible, any rate and channel count (walking
past `LIST` chunks), and the synth decodes each sample once per process to
mono at 44.1 kHz. `hdf render` mixes it into the wav and `-final.mp4`, the
contact sheet draws a voice bar under the tiles (the whole sound faint, the
voiced part solid), and the player plays the same samples: `hdf bundle`
inlines the wav, `hdf dev` serves its blob. Name the id in the film's
`assets` so the bundle and `hdf find` see it. The package only takes wavs:
`say`, piper, edge-tts or a phone recording (converted with `ffmpeg -i in.m4a
line.wav`) all make one. `films/mini-voice.js` is `mini` with one line.

### Word timing and captions

Captions follow the voice (4.0 V2). `alignOf(id)` gives each word of a sample
its `t0` and `t1` in the sample's seconds. When nothing is stored, the timing
is an estimate made from the wav at render time: `speech()`'s syllable grid is
stretched over the voiced part, and each comma or full stop in the copy is
pinned to the silence in the recording that falls near it. The copy is the
entry's `desc` (`hdf import ... --desc "..."`) or `--text`. `hdf align`
stores a better timing on the entry, so a render needs nothing installed:

```bash
hdf align moon-para --text "The moon does not make its own light. ..."   # faster-whisper or whisper-timestamped under $HDF_PYTHON
hdf align moon-para --json words.json      # any tool's [{ text, t0, t1 }]
hdf align moon-para --estimate             # store the estimate as it is
hdf align moon-para --show                 # what a render would use; writes nothing
```

The transcriber's words go onto the copy through a word-level edit distance,
so its spelling and punctuation never reach the screen. With no transcriber
installed, `hdf align` stores the estimate and says so. On `moon-para`
(18 s, `say`), the estimate's word starts are 0.16 s from whisper's on
average (0.45 s at worst).

```js
const CAPS = captions('moon-para', { t0: 0.5 });   // the recording starts 0.5 s into the shot
shot('moon', 19.75, ({ t, W, H }) => [paper(), ..., CAPS.draw(t, { W, H })]);
const line = FOX.say(null, 1, { voice: 'moon-1' });  // letters, syllables, mouth from the timing; events() is the voice
```

`captions(id | alignment, { t0, size = 44, lines = 2, box, hold = 0.8,
reveal: 'word' | 'page', role, mark = 'accents.0', sheet = 'paper', hand })`
letters the copy in a strip at the bottom of the frame, in pages of `lines`
lines. The last row of a page ends at a full stop when it can, and never
leaves one or two words of a sentence for the next page. Each word appears as
it is spoken, and the word being said is underlined as it starts. Captions
are the voice's words, so they do not count against the look's allowance.
Lint warns `caption-sync` when a line longer than 3 s is captioned from the
estimate. The timing is read on first use, so captions built at a film's top
level wait for the player to fetch the wav. `films/narrated.js` is an 18 s
paragraph under a moon that changes phase as the voice says so.

With no recording, give the copy as a list (4.0 T9): `captions(['the moon is
a ball of rock', 'it has no light of its own'], { t0, audience: 'kids-7' })`.
Each string opens a page of its own, lettered whole (`reveal: 'page'` unless
you say otherwise), and the underline walks it at the audience's reading speed
with `gap` seconds (the audience's dwell) between strings. `audience` also
sizes the letters (44 by its `text` scale) on voiced captions.

### Lip sync from a recording

A voiced line moves the mouth with the recording (4.0 V3), not with a
syllable cycle. `mouthFrom(id)` is the sample's mouth track, one letter per
1/12 s from the start of the sample. The letters are the Preston Blair set as
Rhubarb Lip Sync names them: A shut (m b p), B a little open on clenched
teeth (most consonants), C open, D wide, E slightly rounded, F puckered (oo w),
G teeth on the lip (f v), H the tongue up (l), X at rest. With nothing stored,
the track is made from the wav at render time, the same in Node and the
player. It measures the energy in the voice band (300 Hz to 2.5 kHz), four
windows to a frame. A frame all under the floor rests (X). A window that dips
between louder ones shuts the mouth (A). Otherwise the frame's level opens it
(B, C, D), scaled to the loud part of the take so that a quiet recording
opens as wide as a loud one. `hdf align --mouth` stores a better track on the
entry (`mouth`):

```bash
hdf align hello-there --mouth              # Rhubarb (on PATH, or RHUBARB=<path>) with the copy as its dialog
hdf align hello-there --mouth --json cues.json   # any tool's [{ start, end, value }] or { mouthCues }
hdf align hello-there --mouth --estimate   # store the energy track as it is
hdf align hello-there --mouth --show       # what a render would use; writes nothing
```

When a cue is laid on the grid, a frame takes the cue that covers most of it.
A shut cue of a quarter frame or more wins the frame outright, so a quick m,
b or p still closes the lips. `--recognizer phonetic` gives Rhubarb its
language-free recogniser for a line that is not in English. With Rhubarb
missing, the energy track is stored and the command says so.

```js
const HELLO = FOX.say('Hello there!', 0.75, { voice: 'hello-there' });
FOX.place(x, y, s, { ...FOX.emote('happy'), ...HELLO.state(t) });   // the recording's mouth over the emote
SAM.place(x2, y, s, { ...SAM.mouth('hello-there', t, 2.5) });        // the same line, no bubble; score it with voice(id, 2.5)
```

The puppet's mouth variants decide how a letter is drawn. A variant named by
the letter wins, so a puppet that draws the set names its mouths `A` to `H`.
Otherwise `mouthIndex(shape, n)` maps the letter by how many mouths the puppet
has. The fox has four (0 shut, 1 a little open, 2 wide, 3 a smile), and with
so few, clenched teeth count as shut, so the fox closes on consonants. The
stick face has six, including its oo. A puppet with eight takes A to H as 0 to
7. A say fragment's `shape(t)` is the letter, and `mouth(t)` is the letter as
one of the four drawn mouths. `actor.mouth(id, t, t0)` returns `{}` before
the first voiced frame and after the last, so the emote's mouth comes back.
`films/hello.js`: the fox says a recorded "Hello there!" and shuts its mouth
on the "th", then sam answers with the same recording on six mouths.

### Speech, bubbles and dialogue

`actor.say(text, t0, o)` (S9) letters a line in a bubble over the speaker's
head while its mouth moves. Since 4.0 T9 the copy may run to several lines:
`'\n'` breaks it, and a line wider than `width` (11 letter sizes by default)
wraps, the bubble sized from the lines (a single line draws exactly as it
always has). `kind` picks the bubble, `core/marks.js bubble(box, tail, { kind
})`:

| kind | outline | tail |
|---|---|---|
| `speech` | a wobbly rounded rect (the default) | a wedge to the speaker |
| `whisper` | the same, dashed | a dashed wedge |
| `shout` | spikes round the copy | one spike runs out to the speaker |
| `thought` | a cloud of lobes | three shrinking puffs |
| `caption` | a plain strip | none |

`audience` (a key of `AUDIENCES`, now in `core/audience.js`) sets the letter
size (48 by its `text` scale) and the hold: at least its dwell after the last
word, and the whole line up for its reading time. Without it the hold is the
old 0.75 s.

`dialogue(turns, o)` turns several `say`s into a conversation:

```js
const WHERE = { fox: [290, 790, 104], sam: [790, 790, 104] };   // name -> [x, y, s] on the stage
const talk = dialogue([
  [FOX, 'have you seen a teapot?', { emote: 'worried' }],
  [SAM, 'a teapot?', { kind: 'thought' }],
  [FOX, 'it ran away!', { kind: 'shout', emote: 'wide' }],
  [SAM, 'it went that way.', { kind: 'whisper' }],
], { t0: 0.5, where: WHERE });
shot('talk', talk.until + 0.25, ({ t }) => [
  ..., FOX.place(...WHERE.fox, { ...FOX.idle(t), ...talk.state(FOX, t) }),
  SAM.place(...WHERE.sam, { ...SAM.idle(t), ...talk.state(SAM, t) }), talk.draw(t),
]);
// score: talk.events(shot.t0)
```

Each line starts after the one before has been read at the audience's
reading speed (or `gap` seconds after it ends), on the grid. A line's bubble
stays up through the reply, so a question and its answer are on screen
together, and goes when its speaker talks again. `state(actor, t)` is the
mouth, the turn's `emote` while its line is up, and `look(dir)` towards the
actor it is talking or listening to. `where` also gives each actor a lane
(the stage split halfway between neighbours): the copy wraps to fit it and
the bubbles lean towards each other without crossing, a shout's spikes and a
thought's lobes included. A turn takes any `say` option (`voice`, `size`,
`hold`); `where` can instead be passed to `state` and `draw` for actors who
move. The fox and `sam`, a stick teacher, talk this way in
`films/fox-and-teapot.js` (the `talk` shot). The words in bubbles count
against the look's allowance, so that shot carries 14 (`withLook(..., {
words: 14 })`).

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
| `hdf render <film> [--ar 1:1\|16:9\|9:16] [--width 1080] [--workers 4] [--out dir] [--cache-mb 512] [--disk-cache] [--no-sound] [--frames N] [--chapter N] [--alpha [mov\|webm]]` | mp4, wav, `-final.mp4` with sound, contact sheet; records frame hashes for `changed`. `--frames N` draws the first N frames only, to `<film>-<N>f.*`. `--chapter N` draws chapter N only, to `<film>-ch<N>.*`, with its stretch of the score (with `--frames`, that chapter's first N frames). `--alpha` draws on no stock (the `~alpha` look modifier on every look the film pins) and keeps the transparency: `<film>-alpha.mov` (ProRes 4444) or `.webm` (VP9), `-final.mov` / `.webm` with sound, the contact sheet on a checkerboard; `golden --alpha` is a golden of its own |
| `hdf grid <film> [--n 24] [--width 480] [--chapter N]` | n frames spread over the film (or one chapter, `<film>-ch<N>-grid.jpg`) in one JPEG |
| `hdf only <film> 0,37,74` | single frames as full-size PNGs |
| `hdf board <film> [--cols 4] [--chapter N] [--shots]` | the time tree as text plus one storyboard card per shot; in a film with chapters, one card per chapter (its title card written, span, shots, cuts, recipes, lint), `--chapter N` that chapter's shots, `--shots` every shot |
| `hdf sheet <film> <cel>` | the cel at 3 scales × input extremes × every look, silhouette, 240 px |
| `hdf sprite <puppet\|stick:<name>> [--states idle,walk,happy] [--fps 12] [--h 300] [--alpha] [--dir 1] [--cols N] [--idle 2] [--look] [--film <film>]` | a cast member as a sprite sheet for davidup's sprite item (4.0 D2): `out/<id>-sprite[-alpha].png`, each state a run of equal cells (a cycle one loop at `--fps`, a travelling one standing on its planted foot; a pose or expression one held frame), and `<id>-sprite.json` beside it (`frameWidth`, `frameHeight`, `columns`, `count`, `fps`, `cycles` with a walk's `speed` in px/s, `anchor` at the feet, `frames`). The puppet is a store id, `stick:<name>[:<build>]`, a payload `.json`, or with `--film` a member of that film's cast (its store puppets and its `cast` export) |
| `hdf hand --export-ttf <id\|house> [--family] [--pen 4.5] [--no-composites] [--text '...'] [--out dir]` | a hand as a TrueType font (4.0 D3): `out/<id>.ttf`, each glyph its centre lines swept by the pen (pressure, slant, overshoot and hook as `handText` pens them), composed glyphs as composites; `out/<id>-ttf.png` the proof, the font set by skia over the hand lettered |
| `hdf sheet store <id> [--pose p] [--cycle c]` | a puppet in the store: every pose, every variant, a cycle as a strip (its own, else the vocabulary's) → `assets/sheets/<id>.jpg` |
| `hdf hand --template --rig biped[,biped-front] [--paper] [--drawn]` | the rig sheet a character is drawn on (4.0 W1), a box a piece; `--drawn` one drawn in by the package, as a JPEG |
| `hdf sketch <photo.jpg ...> --name <id> [--sheet biped\|biped-front] [--licence] [--cycle walk] [--root] [--no-sheet]` | a photographed rig sheet into the store as a puppet with the standard biped names (lines as strokes, coloured-in areas as fills, the face-on sheet adding the front view); `out/sketch-<id>-trace.jpg` and its sheet with the walk as the strip |
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
| `hdf clip --kind face\|hands <frames-dir\|landmarks.json> --name <id> [--fps 30] [--model]` | your face (blendshapes) or hands (finger curls) per frame -> a track in the store, read by `actor.face` / `actor.hands` |
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

# an overlay: the film on no stock, its transparency kept (ProRes 4444, or --alpha webm)
bun run scripts/davidup-hdf-clip.ts ~/videos/promo/composition.json fox --alpha
#   fox plays hdf-fox-wave  video  assets/hdf/hdf-fox-wave.mov  (1080x1080, 3s, alpha, sound)

# the hand the film letters in, as a font for davidup's text items (--fonts a,b for others)
bun run scripts/hdf-to-davidup.ts walk-on --look 'paperInk~hand:test' --project ~/videos/promo --fonts --no-video --no-sheets
#   hdf-test-font  font  assets/hdf/hdf-test-font.ttf  (family hdf-test)

# the cast as sprite sheets, no video: each member an image with its `sheet`
bun run scripts/hdf-to-davidup.ts walk-on --project ~/videos/promo --sprites --no-video --no-sheets
#   hdf-fox-sprite  image  assets/hdf/hdf-fox-sprite.png  (33 frames of 234x300, cycles idle, walk, happy)
#   hdf-sam-sprite  image  assets/hdf/hdf-sam-sprite.png  (33 frames of 317x300, cycles idle, walk, happy)
```

`--project` takes a project directory or a name from the editor's recents
(`davidup list`). The film is a path or a bare name from `handdrawn/films/`.
`davidup-hdf-clip` reads the film from the item's `name`, `"hdf:<film>"`, or
from `--film`; the item keeps its box, timing and fit. Both take `--look`,
`--frames N` (a quick first N frames) and `--dry-run` (print what it would
register; renders nothing). Re-running replaces the assets in place, so after
editing a film, run the script again. Place a registered film with `add_video`
or from the editor like any other clip.

From an agent the same thing is one MCP call (4.0 D5): davidup's
`render_hdf_clip` renders a film, registers the clip and places it (or points
an existing video item at it), cut to the composition's marks with its
chapters written back as markers, and with `sprites` registers the cast's
sheets. `examples/hdf-clip/agent.mjs` builds a card declaratively and
summons the fox-wave overlay onto it that way; `hdf sprite --film <film>
--cast` lists the cast it draws from.

With `--alpha` (4.0 D1) the clip is an overlay: `paper()` and `night()` draw
nothing, a wash brings its paper in behind the drawing so a doodle body stays
opaque, and `register_asset` records `hasAlpha`, which davidup's frame
extraction keeps. `films/fox-wave.js` is the pattern (one character, a soft
shadow, `meta('intent', 'clip')` so lint wants no sign-off), and
`examples/hdf-overlay/build.mjs <photos...>` puts it over a slideshow.

With `--sprites [a,b]` (4.0 D2) each cast member (the film's store puppets and
the entries of its module's `cast` export; `films/walk-on.js` exports sam) is
drawn by `hdf sprite --film --alpha` and registered as an image with a
`sheet`, so a davidup sprite plays its states by name: `add_sprite` with
`cycle: "walk"` walks it, a tween on `x` at the cycle's `speed` moves it
without the feet sliding, and a second sprite on the same sheet with
`cycle: "happy"` takes over at the walk's `exit`. `--states`, `--h` and
`--no-video` shape it. `examples/hdf-sprite/agent.mjs` does that as an agent
does, over the MCP protocol.

With `--fonts [a,b]` (4.0 D3) the hand the film letters in (its look's, a
`--look` modifier too; `house` when none) or the hands named are written by
`hdf hand --export-ttf` and registered as `hdf-<hand>-font`, a font asset of
family `hdf-<hand>`: `add_text` with `font: "hdf-<hand>-font"` sets a title in
the film's own hand through davidup's text path. `examples/hdf-font/agent.mjs`
does that as an agent, and saves the frame beside the proof.

**Cues both ways (4.0 D4).** A film can be cut to marks it is given rather
than to numbers it holds. `atMark('drop', { or: 4.75 })` is the time of a
named mark and `marksNamed('beat', { or: [...] })` every one, both on the
1/12 s grid (so a cut on a beat is within 1/24 s of it); `or` is what the film
gets with no marks (the player, lint, a golden), so it always renders on its
own. `perform` takes those times like any other, and the score sees the marks
unsnapped as `cues.marks`. The marks come from `--cues-from` on any film
command (`render`, `cues`, `grid`, `lint`, `golden`, `dev`, `bundle`, ...):

```bash
# a davidup composition: its markers, its audio tracks' beats (source seconds, through trimIn and loops),
# every item's <id>.start / <id>.end, in the seconds of the item the film plays in
hdf render films/on-beat.js --cues-from ~/videos/promo/composition.json --at film
# another film's cues, or a plain { "marks": [{ "t": 1.2, "name": "drop" }] }
hdf render films/b.js --cues-from out/a-cues.json

# the other way: shots, cuts, chapters, note onsets, spoken words and the marks it was cut to
hdf cues films/on-beat.js [--out out/on-beat-cues.json]
```

`davidup-hdf-clip.ts` passes the item's own composition (`--cues-from
<composition.json> --at <item>`) and then writes the film's chapters into the
composition's `markers` (`source: "hdf:<item>"`, replaced on each run), which
the editor draws as flags on its ruler; `hdf-to-davidup.ts` does the same for
every video item that plays `hdf-<film>`. `--no-cues` turns both off.
`films/on-beat.js` is the pattern (bars cut on every fourth `beat`, a cheer on
the `drop`), and `examples/hdf-cues/build.mjs` builds a 128 bpm composition
around it, renders it through davidup and checks every cut against a beat.

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
- words beyond the allowance (the audience's; for `general` the look's, 0 by
  default, 3 for doodle and cut-out, 12 on the whiteboard; `look.words` wins);
- a cut longer than 1 s, or two cuts in a row;
- no sign-off, or one still writing 1.5 s before the end;
- cues off the 1/12 s grid;
- an actor's fallback bob (a cycle it lacks) on screen over 1 s in a shot;
- a voice whose sample the store lacks (or cannot decode), or that runs past
  the film's end;
- `Math.random`, `Date`, `filter`, `shadowBlur` or gradients in the source;
- lettering too small, too quick, too faint or crossing other lettering for
  the film's audience (below).

### Audience profiles (4.0 T10)

`film({ audience })` names who the film is for: `general` (the default),
`beginner`, `kids-9`, `kids-7` or `kids-5`, the same keys the teaching
recipes, `say`, `dialogue` and `captions` take (`core/audience.js
AUDIENCES`). Lint checks the film against that profile; `hdf lint <film>
--audience kids-5` checks it against another one without touching the film.

| profile | words a shot | least x-height at 240 px | on screen a word | shortest shot | contrast |
|---|---|---|---|---|---|
| general | the look's | 2.5 px | 0.15 s | none | 3:1 |
| beginner | 16 | 3.5 px | 0.3 s | 1 s | 4.5:1 |
| kids-9 | 14 | 4 px | 0.4 s | 1.5 s | 4.5:1 |
| kids-7 | 10 | 4.5 px | 0.5 s | 2 s | 4.5:1 |
| kids-5 | 8 | 5 px | 0.7 s | 2.5 s | 4.5:1 |

`general` asks what lint asked before: every film that was clean still is.
Each other row sits under what the recipes make for that audience, so a
title card, a label, a count, copy captions or a dialogue built with
`audience: 'kids-7'` lints clean in a `kids-7` film. The rules, over the text
units of each frame (text ops, and groups already lettered as `text:<copy>`,
read by `core/legible.js textUnits`):

- `words`: an audience's allowance replaces the look's table; `look.words`
  still wins over both.
- `text-size`: the largest x-height a piece of lettering reaches (so a line
  being written on is judged written), measured through every transform; a
  lettered group is measured on its own x-height letters. The sign-off is
  exempt.
- `text-dwell`: every run of frames a piece of text is up (across shots,
  through holds, and while a `par` keeps a short shot's last frame) lasts
  `perWord` a word. A recording's captions and the sign-off keep their own
  clocks; copy captions are read like any text.
- `text-contrast`: the text's colour against what is under the middle of it:
  the last fill drawn before it whose path holds that point (translucent fills
  laid over it, a multiply multiplied, a coverage ramp such as a vignette
  ignored), else the stock. A picture under it has no colour and is skipped.
  It fails only when the text never stands at the contrast for as long as it
  needs reading, so words that fade with the light on their way off are fine.
- `caption-overlap`: two different pieces of text whose ink boxes cross in
  one frame.
- `cut-floor`: a shot (or hold) shorter than the floor.
- `credit`: an asset the film names, or a hand a look letters in, whose
  licence is `unknown` (4.0 T4: a font made a hand without `--licence`).

`hdf import --kind puppet` runs three of them over a payload before it reaches
the store: `puppet-joint` (a pose or a cycle frame that names nothing, or sets
a joint off the 2 degree grid or outside -180..180), `roles-raw` (a hex that
came in from a drawing program where a role belongs) and `cel-box` over the
rest pose, every named pose, every variant and every cycle frame.

It warns, without failing, on an asset the film carries as a data URL instead
of naming in the store (`hdf import --v2`); a film built in memory (a test, a
sketch) is welcome to keep its pixels. It also warns (`caption-sync`) on
captions or a voiced `say` timed by the estimate over more than 3 s: `hdf
align <id>` fixes that.

It warns (`length`) on a film over 180 s, a film over 40 s in no chapters, and
a chapter over 40 s. A film in chapters ends its lint with a line per chapter:
`chapter 2 'counting'  9.42-15.92s  6.50s  2 shots  1 cut  AN AP  lint clean`
(its span, its shots and the cuts inside it, a hold not counted as either, the
recipes it uses, and the findings on its frames).

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
    glyphs.js      the single-stroke hand font (a-z, A-Z, 0-9, punctuation, signs, ß ð þ...: 104 glyphs), 14 marks, composed accents
    hershey.js     Hershey JHF fonts read into hand records (4.0 T3): parseJhf, the ascii / greek / cyrillic maps, mergeHand
    fonthand.js    any font as a hand (4.0 T4): the glyph sets, emScale, pressureOf, strays (cli/hand.mjs draws the glyphs)
    text.js        handText, textOnPath, textRound, layout, textBox, bullets, wordBox, measureBox, signOff, squiggleText
    layout.js      line breaking and boxes from a hand's advances and ink (list.js bounds reads it)
    spline.js      the cardinal spline's arithmetic (glyphs.js builds on it at load)
    fx.js          the raster effects
    raster.js      the cached renderer
    synth.js       the offline score renderer and WAV writer
    lint.js        the rules
    marks.js       motifs (seedDot, ripples, hexLattice, aster, tornEdge, thread, ...), bubbles, emphasis marks (4.0 T7) and the camera
    maths.js       numbers (4.0 T8): fraction, equation, tally, numberAxis, clock, dice, coins, pictograph, countOn
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
  recipes/       shots.js (A–Z)  doodle.js (AA–AM)  score.js (motifs)  sfx.js (effects, bed)  book.js (book3)
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

---
name: hand-drawn-film
description: Make a 10 to 40 second film that looks hand-drawn or hand-printed, written as a JavaScript module on the handdrawn package (display lists drawn on Canvas 2D by skia-canvas, rendered to mp4 with a generated score, no browser). Seven looks - ink on warm paper with hatching, riso halftone prints in fluorescent inks, flat screen prints with dot grids, graphite minimalism with torn sections, chalk blueprints, brush-pen doodles on cut-out photos of real objects, and cut-out card pinned with brass fasteners - drawn on twos (12 fps). Three engines - found motion (poses traced from real movement, retargeted onto a puppet, or your own walk filmed on a phone), sand on a light table in one take, and paper in space (a pop-up book in a lit room). A cast of puppets (drawn in Figma as SVG or written as JSON) that any recipe directs, speaks, turns and walks; the film lettered in the user's own handwriting from a photographed sheet; an asset store searched before anything is drawn; shots from recipes (A to Z, AA to AM), cels from packs; lint before pixels; a bridge into davidup compositions. Use when the user asks for a hand-drawn animation or explainer, "мультик", "рисованный ролик", a riso or screen-print look, doodles on photos, a cut-out or paper-puppet look, sand animation, a pop-up book, rotoscope, a character that talks or walks like them, a film in their handwriting, a procedural short film, or a canvas video in this family of styles. Not for UI animation, charts or slide decks.
---

# Hand-drawn film 3.0

A film is one ES module that exports `film({...})`. Shots return **display
lists** (plain data: paths, fills, strokes, groups), not pixels, so the package
can hash, lint, cache, dedup and render them. `hdf` (the package CLI) turns
the module into storyboards, cel sheets, lint findings, grids, an mp4 with its
score, and a single-file HTML player.

3.0 adds an **asset store**: anything a film does not draw in code (a cutout
photo, a traced clip, a puppet, a handwriting, a motif) lives in
`handdrawn/assets/` once, by id, and a film names the ids. A **puppet** is a
cel whose drawing is data, an **actor** is a puppet (or a code cel) that any
recipe can direct, and a **hand** is a set of glyphs and a pen profile a look
letters and draws in. The rule that follows from it: **`hdf find` before
drawing anything**, and **ask for an SVG before writing polylines**.

The package is `handdrawn/` at the repo root. The films in `examples/` (a link
to `handdrawn/films/`) are the worked examples; read one before writing yours.

| film | look / engine | read it for |
|---|---|---|
| `mini.js` | paperInk | the smallest complete film: a cel, a shot, a sign-off, a score |
| `fox-and-teapot.js` | doodlePastel | **the 3.0 film**: store assets, the fox as `actor:` on recipes AC AJ AK AF, `say()`, a retargeted gallop, a turnaround on a `book3` page |
| `cutout-fox.js` | cutout | the same three scenes as card on a table: `look: LOOKS.cutout, paper: null` and nothing else changed |
| `four-looks.js` | riso, screen, pencil, ink | recipes N O P U W A S, riso cards as plates, a look per shot |
| `fly-style.js` | ink + blueprint | recipes A to H, camera follow, mosaic, blot into blueprint |
| `held-once.js` | doodlePastel | cutout photos, doodle recipes AA to AF with the hedgehog |
| `gallop.js` | found motion | `traced`, `airborne`, reveal on traced strokes, a clip read from the store |
| `one-year.js` | sand | one take, gestures on a running clock, `bed.hiss()` in the score |
| `moon-book.js` | paper in space | `book3`, `project`, `shadows`, a camera path |

## Setup

```bash
cd handdrawn && npm i            # skia-canvas ships prebuilt; ffmpeg must be on PATH
mkdir -p work/<film>             # one folder per film; work/ is scratch
node cli/hdf.mjs find --kind puppet     # what the store holds before you draw a thing
```

Every command below runs from `handdrawn/`, as `node cli/hdf.mjs <cmd>`
(written `hdf <cmd>` for short). Outputs land in `handdrawn/out/`
(`out/<film>.thumbs/` and `.hashes.json` are `hdf changed`'s state); check
sheets of store assets land in `handdrawn/assets/sheets/` (gitignored).

A film in `work/<film>/<film>.js` imports the package by name (package.json
self-reference exports; any file inside `handdrawn/` can do this):

```js
import { film, shot, seq, cel, place, paper, fill, stroke, circle, meta, ease, ramp, LOOKS, pastel } from 'handdrawn';
import { establishing, signOffShot } from 'handdrawn/recipes/shots.js';
import { CAST, doesItsJob } from 'handdrawn/recipes/doodle.js';
import { gpu, server, token } from 'handdrawn/packs/tech.js';
import { fromStore } from 'handdrawn/core/assets.js';       // the one import from outside the index: the store
```

## The model in one screen

```js
// a cel: a timeless drawing; inputs are quantised by [min, max, step] so frames dedup and cache
export const dot = cel('dot', ({ lit = 0 }) => [
  fill(circle(0, 0, 70), lit ? 'accents.0' : 'fills.1', { finish: true }),
  stroke(circle(0, 0, 70), 'ink', { w: 2.6, wobble: 1.6 }),
], { box: [-74, -74, 148, 148], inputs: { lit: [0, 1, 1] }, desc: 'a dot that lights' });

// store assets: name the ids, read the records once at the top; CAST.FOX exists only after fromStore(['fox'])
const IDS = ['teapot', 'fox'];
const PHOTOS = fromStore(IDS);                          // { teapot: cutout record, fox: puppet payload }
const FOX = CAST.FOX;                                   // the fox puppet as an actor, 2.6 stage units tall

// a shot: name, seconds (on the 1/12 s grid), draw({ t, k, i, T, W, H, CX, CY, look }) => list
const hello = shot('hello', 2, ({ t, i, CX, CY }) => [
  paper(),                                              // first op: paper, night, or a backdrop
  meta('anchor', { cel: 'dot' }),                       // the element that survives every cut (see Anchors)
  place(CX + ramp(0, 1.5, t, ease.out) * 200, CY, dot({ lit: +(t > 1) })),
]);

// a recipe with the fox in it: every doodle recipe (and A G M U W X Z) takes actor:; AC also takes say:
const tea = doesItsJob({ name: 'tea', photo: PHOTOS.teapot, spout: [0.005, 0.27], actor: FOX,
  say: FOX.say('hello there', 1.25), word: null });    // say() replaces the caption: 3 words a doodle shot

export default film({
  name: 'hello', look: 'doodlePastel~hand:narcis', format: '1:1',   // '16:9' | '9:16' re-fit at render time
  timeline: seq(hello, tea, signOffShot({ a: 'hello', b: 'world' })),
  score: ({ shots, end }) => [/* synth events, see recipes.md "Score" */],
  assets: [...IDS, 'narcis'],                           // every id the film or its look reads, hands included
});
```

- Positions come from `W H CX CY`, never literal frame pixels (1080 is the
  short side in logical units; recipes lay out on a 1080 square around 540).
- Colours are **roles** (`ink`, `paper`, `fills.2`, `accents.0`, `{ base,
  tint, shade, alpha, mix }`), resolved against the current look. Raw hex
  only ever goes into a look's palette (`withLook`, see `looks.md`) or an
  SVG the importer maps to roles.
- Randomness is `rng(seed)`; timing is `t` (seconds), `k` (shot frame),
  `i` (global drawn frame). `pulse`, `boil`, `onTwos` quantise idle motion.
- Timeline: `seq`, `par`, `hold(dur, node)`, `cut(kind, dur, a, b)` (a
  transition fx: `blot`, `iris`, `dissolve`, `wipe`, `flash`, ...),
  `lookOn(look, node)`. A shot may also carry `{ look }` itself. A cut is
  only the transition between `a`'s last frame and `b`'s first; both shots
  stay in the `seq`: `seq(a, cut('iris', .5, a, b), b)` (lint `cut-orphan`).
- A look string may carry modifiers: `preset~hand:<id>` letters and draws in
  a stored hand, `preset~from:<id>` paints in a cutout's own colours. They
  work in `film({ look })`, in a shot's `look`, and as `--look` on any command.

Every export, one line each: `references/api.md`. The store, every schema,
the importers and the Figma conventions: `references/assets.md`.

**Anchors.** `meta('anchor', { cel: 'gpu' })` points at a placed cel;
`meta('anchor', { name: 'die' })` at any group or op with that `name`
(`group('die', ...)`, `stroke(p, 'ink', { name: 'die' })`, marks like
`seedDot` are `group('seedDot')`). A puppet is a cel: `meta('anchor', { cel:
'fox' })`. Several anchor metas in one shot are alternatives: one of them must
be drawn and big enough (24 px at 240 px wide). Recipes take `anchor: { ... }
| [ ... ]` to replace theirs. Lint checks that each shot anchors something;
that it is *the same* thing across cuts is on you (review list). A small
anchor like the seed dot (~6 px at 240 px) cannot pass alone: pair it with
the shot's large subject, the way recipes N, O and P pair it with ripples,
cards and badges.

## The store

`handdrawn/assets/catalogue.json` is one entry per id; `assets/blobs/<sha>`
is the payload. Kinds: `cutout` (a photo cut out, with its silhouette and
colours), `clip` (traced poses, with a skeleton when rigged), `puppet`,
`hand`, `stock`, `motif`, `sample`. Every entry has a closed `licence`
(`CC0 | CC-BY | CC-BY-SA | PD | own | unknown`) and a credit.

```bash
hdf find teapot                    # id, kind, licence, what it takes, its check sheet, its credit
hdf find --kind puppet             # the whole kind; pack cels are listed next to their mirrors (pack:<cel>)
hdf sheet store fox                # a puppet: every look x pose x variant x 3 scales, cycles as strips
hdf sheet store fox --poses        # the model sheet: turnaround, expressions, hands and feet, poses, cycles, credits
hdf import <file> --kind <kind> --name <id> --licence CC0 --credit "..." --source <url>
```

What it holds today: the **fox** (nine parts, three views, poses `rest wave
asleep`, cycles `walk run gallop`); cutouts from The Met (`teapot cup helmet
hourglass lantern violin watch`, CC0); Muybridge clips (`horse elephant
kangaroo pigeons`, PD; the horse rigged); the `test` hand; and a mirror of
every pack cel (`pack:boat`, `pack:teapot`, ...) so `puppet('pack:teapot')`
draws without importing the pack.

A film names ids in `assets:` and reads them with `fromStore(IDS)` at the
top. A 2.0 film that inlines a data URL still loads; lint warns and `hdf
import --v2 <photos.js|clips.js>` moves it into the store. A new photo:
`hdf photo <img> --name <id> --credit --source --js work/<film>/photos.js`,
look at `out/photo-<id>.jpg`, then `hdf import --v2 work/<film>/photos.js
--licence CC0`.

**Before drawing anything, `hdf find` it.** A subject that is in the store
(as a cutout, a puppet, a pack mirror) is placed, not drawn. A character that
is not there is asked for as an **SVG** before you write a polyline: Figma
export, ids as the rig (`references/assets.md`, "SVG and Figma conventions"),
`hdf svg file.svg --name <id> --licence own`, look at its sheet. Only a
subject nobody can draw for you becomes a code cel.

## Cast: puppets and actors

`puppet(id)` is a cel whose drawing is data: `FOX({ eye: 'happy', 'arm-l':
112, dir: 0.5 })`, `FOX.pose('wave', k)`, `FOX.cycle('walk', t)`. Parts turn
about pivots in painter order; joints are degrees on a 2° step; `eye` and
`mouth` are variants; `dir` picks the view (`1` side, `0.5` three-quarter,
`0` front, negative mirrored) when the puppet has views. Parts may also slide
and scale: `FOX({ 'pupil.x': 4, 'brow-l': -12, 'brow-r.y': -3 })` looks across
and frets (`<part>.x/.y` slide in units, `<part>.sx/.sy` scale; the payload's
`slide`/`scale`, or `data-slide`/`data-scale` in the SVG, give the ranges).

`actorOf(puppet | cel | builder, spec)` makes a **cast member** every recipe
can direct. `CAST.FOX` and `CAST.HOG` (the hedgehog) are ready; a new puppet
is `actorOf(puppet('owl'), { height: 2.4 })`. An actor answers in **states**,
plain input objects a recipe merges and draws:

```js
A.idle(t, seed)            // breathing, a blink, a tail, on the twos
A.look(dir)                // -1 .. 1: facing, the view, the head turn
A.emote('happy')           // happy | sleep | wide | sad | worried; brows and pupil when it has them; its own pose of that name wins
A.cycle('run', t)          // a declared cycle; a missing one is a two-pose bob that lint reports over 1 s
A.say('hello there', t0)   // a fragment: mouth per syllable, letters in a bubble, a pluck per syllable
A.place(x, y, s, state)    // the merged state on the doodle stage (centre x, y; feet at y + .86 s)
A.place(x, y, s, { ...state, shadow: true })   // with a contact shadow on its own floor
```

- **`actor:` on every recipe.** Doodle recipes AA to AM take `actor:`
  (default `HOG`); A, G, M, U, W, X and Z take it where a subject or figure
  is on screen; `book3` pieces take `{ base, h, actor, state }` and the actor
  turns with the page. `becomesVehicle({ photo: PHOTOS.violin, actor: FOX })`
  is the whole change from the hedgehog to the fox. On A, G, M, U, W, X, Z
  `h` sets the actor's drawn height (`h: 300`); without it a puppet is fitted
  by its rig box and reads small.
- **Speech.** `const line = FOX.say('hello there', 1.25)` then `say: line`
  on AC (the only recipe with the option built in) or, in your own shot,
  spread `line.state(t)` into the state, draw `line.draw(t, x, y, s, state)`
  after the actor and add `line.events(shot.t0)` to the score. Spoken words
  count against the look's word allowance (doodle and cutout: 3).
- **Turnarounds.** A puppet with `views` turns through `look(dir)` and on a
  `book3` page as the leaf lifts (`fox-and-teapot.js`, the turn shot). `hdf
  sheet store fox` opens on the turnaround.
- **Model sheet as the brief.** `hdf sheet store <id> --poses [--look
  risoPop]` writes `assets/sheets/<id>-model.jpg`: hand it over before a
  frame is rendered.

## Looks and engines

| look | preset | finish | for |
|---|---|---|---|
| ink | `paperInk` | hatch | warm paper, wobbly outlines, construction lines, blueprint interludes |
| riso | `risoPop` | halftone | fluorescent plates, seed dot, card montages, badge galleries |
| screen | `screenSea` | dots | flat shapes under a dot grid, one constant protagonist, day and night |
| pencil | `pencilMinimal` | graphite | cream and charcoal, torn sections, squiggle text, dark sections |
| blueprint | `blueprintNight` | hatch | chalk on navy only: "look inside" |
| doodle | `doodlePastel` | wash | brush pen and watercolour on cut-out photos of real objects |
| cut-out | `cutout` | flat | printed card on a table: every puppet part a pinned piece with a soft shadow, a paper edge and a brass fastener |

`derive`, `duotone`, `pastel`, `withLook` make variants; `~hand:<id>` and
`~from:<id>` are the two modifiers. Palettes, finishes and riso plates are in
`references/looks.md`. The cut-out look reaches puppets in the finish pass:
the film changes nothing but `look` (and `paper: null` on doodle recipes, so
the card stock shows).

| engine | what the frame is | example |
|---|---|---|
| found motion (`traced`) | drawn as always, poses traced from real movement | `gallop.js` |
| retargeted motion (`hdf retarget`) | a clip's skeleton as a puppet's cycle: the horse's gallop on the fox, or your own walk from a phone | `fox-and-teapot.js` (chase) |
| sand (`sim`) | a bed of sand a hand works in one take, no cuts | `one-year.js` |
| paper in space (`stage3d`, `book3`) | flat sheets stood up in a lit 3D room | `moon-book.js` |

Pick one only when the brief asks for it or the subject is better served by
it: a real animal's movement, a story that must not cut, a book or a stage.
`references/engines.md` has each condensed.

## Copy in a box

Lettering wraps from the hand's real glyph widths. Put copy in a box rather
than placing lines by hand:

```js
textBox('A caption that wraps into its box.', [80, 760, 920, 220], { size: 48, align: 'center', valign: 'middle', maxLines: 3 })
bullets(['first', 'second, which wraps', 'third'], [120, 200, 700, 600], { marker: 'number', size: 40 })   // dot dash number check
layout(str, { size, w })   // the lines and ink box without drawing; measureBox(str, size, { w }) the box alone
```

Both return groups with `.box` (what they draw); anything that needs to sit
beside the copy reads it. `hdf dev` shows every text box with `B`.

## Hands: the film in the user's handwriting

A hand is a store asset: up to 94 glyphs plus a pen profile (wobble, overshoot,
hook, pressure, speed). `look.hand` is the house hand unless a look says
`~hand:<id>`; then every `handText`, sign-off, doodle reveal and pen stroke
of the film is in that hand (hatching and ruled lines stay).

```bash
hdf hand --template > out/hand-template.pdf      # two pages, A4 (--paper letter); print them
#   page latin: 62 boxes on the baseline in their own pen, then the last row: three lines left to
#   right, a circle, a square, a zigzag, a long S; page symbols: 32 boxes of punctuation and signs
#   (' " : ; ( ) [ ] / + = % ° × ÷ → ← ↑ ↓ ~ * _ # @ $ € ...); each photographed flat, corner marks in
hdf hand latin.jpg symbols.jpg --name narcis     # traces every glyph, fits the pen; out/hand-narcis-trace*.jpg
hdf sheet --hand narcis                          # house | narcis, every glyph (house fallbacks marked), pangrams
hdf render work/<film>/<film>.js --look 'doodlePastel~hand:narcis'      # or pin it in film({ look })
```

Look at the trace page once: red traces over the straightened photo. A box
the trace missed falls back to the house glyph and is listed; lint
`hand-missing` fails a sign-off that falls back. `--thr` adjusts the ink
threshold on a dim photo. `hdf hand --synth <id>` makes a deterministic hand
from the house one (`test` is in the store) for checks before the sheet
comes back. A film that pins a hand names it in `assets:`.

## Motion: retargeting and the phone

```bash
hdf clip --store horse --rig quadruped                                    # a skeleton per frame, once
hdf retarget --clip horse --to fox --map horse-fox.json --name gallop     # maps in assets/src/
hdf sheet store fox --cycle gallop                                        # the strip: is it the horse?
ffmpeg -i me.mov -vf fps=30 work/me/%04d.png
hdf clip --kind pose work/me --name me                                    # MediaPipe (python); says what to install
hdf retarget --clip me --to fox --map biped-fox.json --name walk          # the fox walks like the user
```

A map names which puppet part follows which skeleton chain (`assets/src/
horse-fox.json`, `biped-fox.json`); the cycle carries a `lift` per frame so
the feet meet the ground where the hooves did. `fox.cycle('gallop', t)` and
`fox.liftOf('gallop', t)` read it; the actor's stage rises by it. The
package's fox keeps its hand-authored walk until someone films theirs.

## davidup

A film becomes an ordinary davidup video asset; a puppet's model sheet an
image asset. Run from the repo root:

```bash
bun run scripts/hdf-to-davidup.ts fox-and-teapot --project <dir|name> [--look risoPop] [--dry-run]
bun run scripts/davidup-hdf-clip.ts <project>/composition.json <video-item-id> [--film <film>]
```

The first renders and registers `hdf-<film>` (video) and `hdf-<puppet>-model`
(image) into `<project>/assets/hdf/`; the second renders the film a video
item names (`"name": "hdf:<film>"`) and points its asset at the mp4. Both
take `--frames N` for a quick first cut, and re-running replaces in place.

## Procedure

You cannot judge a frame from code. "Look" means open the JPG and look at it,
once, then act on what you saw.

1. **Brief.** Fill `references/brief-template.md` from the request, as the
   comment at the top of the film. Ask at most one round of questions
   (subject, length, format, look, cast, whose hand). Pick the look and the
   **anchor**: the one element that survives every cut.
2. **Find before drawing.** `hdf find <subject>` for every subject and
   character in the brief. What is in the store is placed by id. A character
   that is not: ask for an SVG (or draw one by hand in the Figma conventions),
   `hdf svg`, look at its sheet, `hdf sheet store <id> --poses` for the
   model sheet, show it. A pack cel is `puppet('pack:<cel>')` or the code cel.
3. **Timeline from recipes and packs.** Write the beat sheet (start, dur,
   shot, look, recipe, cels, cast, sound) under the brief, then the timeline
   (a stub cel that draws a labelled box is fine where a new cel will go):
   recipes from `references/recipes.md` with `actor:` where a cast member is
   on screen, cels from the packs and the store. Placeholders are fine: a
   recipe with its default subject is a shot. Then
   `hdf board work/<film>/<film>.js`: it prints the tree and writes
   `out/<film>-board.jpg`, one card per shot. **Look once.**
4. **Cels.** Write the cels no pack or store has (usually one or two). Each
   declares `box`, `inputs` and `desc`, is centred on its origin (or stands
   on `y = 0`), and draws only roles. For each:
   `hdf sheet work/<film>/<film>.js <cel>` writes
   `out/<film>-sheet-<cel>.jpg`: three scales, every input extreme, every
   look, the silhouette, 240 px. **Look once per cel.** It must read at 240 px.
5. **Lint, then grid.** `hdf lint work/<film>/<film>.js` until it prints
   `lint clean` (every finding names shot, frame, rule and what to fix).
   Then `hdf grid work/<film>/<film>.js --n 24`: 24 frames across the film
   in `out/<film>-grid.jpg`. **Look once.**
6. **Fix; look only at what moved.** After edits, `hdf changed
   work/<film>/<film>.js` lists the frames whose display list changed since
   the last render or `changed` run and writes before/after pairs to
   `out/<film>-changed.jpg` (the first run only records a baseline, so run
   it once before you start fixing). Look at those, not the whole film.
   `hdf only <film.js> 0,37,74` renders single frames at full size.
7. **Render and deliver.** `hdf render work/<film>/<film>.js` writes
   `out/<film>.mp4`, `out/<film>.wav`, `out/<film>-final.mp4` (with
   sound) and `out/<film>-sheet.jpg`. **Look at the contact sheet once.**
   `hdf bundle work/<film>/<film>.js` writes `out/<film>.html`, a player
   that opens from disk. Deliver the film module, `-final.mp4`, the bundle,
   one line per shot saying what it shows, and the credit line of every
   store asset it used (`hdf find` prints them). Into a davidup project:
   `hdf-to-davidup.ts`.

While working, `hdf dev work/<film>/<film>.js` serves the player on :4321
with hot reload; it jumps to the first frame an edit changed. `--ar 16:9`
or `--ar 9:16` renders another format; `--width 1920` a larger one;
`--look <preset>` restyles every shot that does not name its own look, and
a modifier (`~hand:`, `~from:`) reaches the looks shots pin too.
`--frames N` draws the first N frames only, to `<film>-<N>f.*`.

## What lint checks, and what it cannot

Lint (`core/lint.js`) fails on: colours that are not roles; a shot not
starting on paper, night or a backdrop; two finishes or a look op in a shot;
a missing anchor; more than two scribbled parts; a cel drawing outside its
box; words beyond the look's allowance (0; doodle and cutout 3, spoken words
included; `look.words` to change it); a cut over 1 s or two cuts in a row;
no sign-off, or one still writing 1.5 s before the end; an anchor under
24 px at 240 px wide, or cut by the frame edge without `meta('intent',
'crop')`; cues off the 1/12 s grid; `Math.random`, `Date`, filters,
`shadowBlur` or gradients in the source. From 3.0: a recipe asking an actor
for a cycle it lacks with the fallback bob on screen over 1 s
(`actor-cycle`); a look naming a hand the store lacks, or a sign-off falling
back to the house hand for a glyph (`hand-missing`); a puppet joint off the
2° grid or out of range, or a pose naming no part (`puppet-joint`); a raw
colour inside an imported puppet (`roles-raw`); an asset carried as a data
URL (`inline-asset`, a warning); a pack cel whose store mirror is stale
(`pack-mirror`, on `hdf lint packs/<pack>.js`). `hdf import` and `hdf svg`
run `cel-box`, `puppet-joint` and `roles-raw` over every pose and variant
before anything is written.

These need eyes, and they are the review list:

- **One idea per shot.** On the grid, each shot reads in a second and a
  half. If it does not, cut something; do not decorate. One large thing
  beats twenty small ones.
- **Composition.** The subject owns the frame (roughly a third to two thirds
  of it), with air around it; the eye lands where the action is. Guides and
  construction lines sit behind, never on top of, the subject's face.
- **Timing.** Establishing 2 to 2.5 s, interludes 0.6 to 1.2 s, action 1.5 to
  3 s, montage cards 0.25 s, inserts 2 drawn frames, sign-off 2.5 s. Camera
  eases (`ease.io`), particles move linearly, reveals `ease.out`, collapses
  `ease.in`. Nothing new appears in the last fifth of a shot.
- **Cuts.** Hard cuts by default; one transition device between two shots;
  a flash at most twice a film; a look change lands on a cut and lasts 1 s
  or more.
- **Texture.** A static shot does not boil: its finish is seeded and stays.
  Deliberate boil goes through a cel input (`boil(i, 3)`), outlines only.
- **Riso.** Paper shows between the dots; a subject is knocked out of the
  plates that should not tint it; cards read at 120 px.
- **Blank or near-blank frames** that are not a deliberate flash.
- **Doodle**: a photo with a recorded source and licence; drawings that
  change what the object is rather than decorate it; see engines.md.
- **Cast.** On the model sheet, every expression reads at 240 px and the
  views agree (same fox from the side and the front). A cycle strip reads as
  its verb: a walk walks, the gallop is the horse's. A retargeted cycle whose
  feet slide needs `ground` in the map, not a fix in the film.
- **Speech.** The mouth moves only while letters arrive; the bubble sits
  above the head and never covers the object; one line a shot.
- **Cut-out.** Shadows fall down-right from every piece, fasteners sit on
  joints only, the card edge is a light line up-left; a photo on the table
  keeps its own shadow.
- **Hand.** On `hdf sheet --hand`, no glyph is marked as a house fallback
  that the sign-off uses; the pen row read back as the user's pen (a heavy
  hand gives a wide pressure curve, a fast one overshoots).

## Pitfalls

- `CAST.FOX` is `undefined` until the film has called `fromStore(['fox'])`:
  read the store at the top of the module, then take the cast.
- `~hand:<id>` and `~from:<id>` resolve wherever a look is built (a
  recipe's `look:`, `withLook(...)` at the top of the module, before or after
  `fromStore`): the id is read from the registry, then the store. Still name
  the id in `assets:` so the loader and lint see it.
- Two actors in one shot: list order is paint order, so draw the one
  further back first, higher up the frame and smaller, and give each
  `place(x, y, s, { shadow: true })` (or a ground line of its own): without
  a floor, the far actor hovers.
- `cut(kind, dur, a, b)` is only the transition; the shots stay in the
  timeline: `seq(a, cut('iris', .5, a, b), b)` (lint `cut-orphan`).
- `say` is an option of AC only; elsewhere spread `state(t)` and draw
  `draw()` yourself. A spoken line plus a caption exceeds the doodle
  allowance: pass `word: null`.
- `pack:teapot` (the pack cel's mirror, a puppet) and `teapot` (the cutout
  photo) are different assets. A mirror draws the cel at the inputs it was
  exported at; an input the cel does not declare (boat's `mode`) needs the
  code cel.
- The cut-out look on doodle recipes needs `paper: null` or the pastel sheet
  covers the card. It allows 3 words, like doodle.
- `impact` is two things: the score motif (`handdrawn`) and recipe J
  (`handdrawn/recipes/shots.js`). Import one `as` another name.
- Durations must be multiples of 1/12 s (`seq` throws otherwise): 0.25, 0.5,
  0.75, 1, 1.25 ... and 11/12 are fine; 0.3 is not.
- Pack cels with a `mode` input (`boat`, `fly`) draw a blueprint version;
  others do not. A whole blueprint shot can be `lookOn('blueprintNight',
  shot)`, but inside recipe B (half ink, half blueprint in one shot) that is
  not possible (a look op in a shot fails lint): give the recipe a subject
  that branches on `mode` and draws the outline in `'chalk'` for
  `'blueprint'`. An actor draws in its own roles whatever the mode.
- Recipe subjects: `(ctx, mode) => node` everywhere except G, whose
  `subject(pose, ctx)` gets `{ x, y, dir, t, k, i }`.
- A recipe's camera (A pushes in) can cut a tall subject off at the top
  without a lint finding (seen in the acceptance run): check the grid. A pack
  cel that stands on `y = 0` (`server`, `lamp`, `teapot`) needs its `y` lower
  than a centred one.
- A recipe without an `extras` option (most of them) is extended by a custom
  shot around its layer: `shot('x', 2, (ctx) => [night(), ...doubling.layer(ctx, o), yourOps])`.
- Never write the shape `import X from '...'` inside a comment: the bundler
  reads it as an import.
- A cel's draw must be pure in its inputs: no `t` from outside, no closures
  over mutable state. Animate by changing inputs or the `place` around it.
- `text` / `handText` / `textBox` / `bullets` count as words; the sign-off
  does not. On a `text` op and `handText`, `w` is the pen: wrap with
  `width` (or `textBox(str, [x, y, w, h])`), break with `\n`.
- `hdf svg` refuses `use`, live text, gradients, filters, masks, clip paths,
  CSS and embedded images by element and line: in Figma, detach instances,
  outline text, turn off "clip content", export with presentation attributes.
- Every `hdf sheet store` page is gitignored: regenerate, do not commit.
- `hdf clip --kind pose` needs MediaPipe in a python (`HDF_PYTHON=<venv>/bin/python`);
  the command prints the install line when it is missing. Landmarks already
  found (`out/pose-<id>.json`) need no python.

## When to reach further

The v1 skill (`.claude/skills/hand-drawn-canvas-animation/`) holds films not
ported to this package and worth reading for ambitious briefs:
`examples/night-shift.html` (a doodle chase at 120 bpm with whip cuts),
`examples/one-seed.html` (sand at full range: camera over a wide table,
wind, snow, seasons), `examples/paper-horse.html` (all three engines at
once) and `examples/sketchbook-bird.html` with `references/redrawn-animation.md`
(a drawn performance: rest, anticipation, extreme, contact, recovery, the
way to plan a puppet's poses before the SVG is drawn). Its
`references/doodle.md` is the long method for finding an idea in an object;
`references/reference-films.md` measures the films the looks come from. Read
them for ideas; write the film against this package.

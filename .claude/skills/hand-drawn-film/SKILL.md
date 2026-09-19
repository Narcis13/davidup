---
name: hand-drawn-film
description: Make a 10 to 40 second film that looks hand-drawn or hand-printed, written as a JavaScript module on the handdrawn package (display lists drawn on Canvas 2D by skia-canvas, rendered to mp4 with a generated score, no browser). Six looks - ink on warm paper with hatching, riso halftone prints in fluorescent inks, flat screen prints with dot grids, graphite minimalism with torn sections, chalk blueprints, and brush-pen doodles on cut-out photos of real objects - drawn on twos (12 fps). Three engines - found motion (poses traced from real movement), sand on a light table in one take, and paper in space (a pop-up book in a lit room). Shots come from recipes (A to Z, AA to AM) and cels from packs (creatures, objects, tech); lint checks the rules before anything renders. Use when the user asks for a hand-drawn animation or explainer, "мультик", "рисованный ролик", a riso or screen-print look, doodles on photos, sand animation, a pop-up book, rotoscope, a procedural short film, or a canvas video in this family of styles. Not for UI animation, charts or slide decks.
---

# Hand-drawn film 2.0

A film is one ES module that exports `film({...})`. Shots return **display
lists** (plain data: paths, fills, strokes, groups), not pixels, so the package
can hash, lint, cache, dedup and render them. `hdf` (the package CLI) turns
the module into storyboards, cel sheets, lint findings, grids, an mp4 with its
score, and a single-file HTML player.

The package is `handdrawn/` at the repo root. The films in `examples/` (a link
to `handdrawn/films/`) are the worked examples; read one before writing yours.

| film | look / engine | read it for |
|---|---|---|
| `mini.js` | paperInk | the smallest complete film: a cel, a shot, a sign-off, a score |
| `four-looks.js` | riso, screen, pencil, ink | recipes N O P U W A S, riso cards as plates, a look per shot |
| `fly-style.js` | ink + blueprint | recipes A to H, camera follow, mosaic, blot into blueprint |
| `held-once.js` | doodlePastel | cutout photos, doodle recipes AA to AF |
| `gallop.js` | found motion | `traced`, `airborne`, reveal on traced strokes |
| `one-year.js` | sand | one take, gestures on a running clock, `bed.hiss()` in the score |
| `moon-book.js` | paper in space | `book3`, `project`, `shadows`, a camera path |

## Setup

```bash
cd handdrawn && npm i            # skia-canvas ships prebuilt; ffmpeg must be on PATH
mkdir -p work/<film>             # one folder per film; work/ is scratch (gitignored)
```

Every command below runs from `handdrawn/`, as `node cli/hdf.mjs <cmd>`
(written `hdf <cmd>` for short). Outputs land in `handdrawn/out/`
(`out/<film>.thumbs/` and `.hashes.json` are `hdf changed`'s state).

A film in `work/<film>/<film>.js` imports the package by name (package.json
self-reference exports; any file inside `handdrawn/` can do this):

```js
import { film, shot, seq, cel, place, paper, fill, stroke, circle, meta, ease, ramp } from 'handdrawn';
import { establishing, signOffShot } from 'handdrawn/recipes/shots.js';
import { gpu, server, token } from 'handdrawn/packs/tech.js';
```

## The model in one screen

```js
// a cel: a timeless drawing; inputs are quantised by [min, max, step] so frames dedup and cache
export const dot = cel('dot', ({ lit = 0 }) => [
  fill(circle(0, 0, 70), lit ? 'accents.0' : 'fills.1', { finish: true }),
  stroke(circle(0, 0, 70), 'ink', { w: 2.6, wobble: 1.6 }),
], { box: [-74, -74, 148, 148], inputs: { lit: [0, 1, 1] }, desc: 'a dot that lights' });

// a shot: name, seconds (on the 1/12 s grid), draw({ t, k, i, T, W, H, CX, CY, look }) => list
const hello = shot('hello', 2, ({ t, i, CX, CY }) => [
  paper(),                                              // first op: paper, night, or a backdrop
  meta('anchor', { cel: 'dot' }),                       // the element that survives every cut (see Anchors)
  place(CX + ramp(0, 1.5, t, ease.out) * 200, CY, dot({ lit: +(t > 1) })),
]);

export default film({
  name: 'hello', look: 'risoPop', format: '1:1',       // '16:9' | '9:16' re-fit at render time
  timeline: seq(hello, signOffShot({ a: 'hello', b: 'world' })),
  score: ({ shots, end }) => [/* synth events, see recipes.md "Score" */],
});
```

- Positions come from `W H CX CY`, never literal frame pixels (1080 is the
  short side in logical units; recipes lay out on a 1080 square around 540).
- Colours are **roles** (`ink`, `paper`, `fills.2`, `accents.0`, `{ base,
  tint, shade, alpha, mix }`), resolved against the current look. Raw hex
  only ever goes into a look's palette (`withLook`, see `looks.md`).
- Randomness is `rng(seed)`; timing is `t` (seconds), `k` (shot frame),
  `i` (global drawn frame). `pulse`, `boil`, `onTwos` quantise idle motion.
- Timeline: `seq`, `par`, `hold(dur, node)`, `cut(kind, dur, a, b)` (a
  transition fx: `blot`, `iris`, `dissolve`, `wipe`, `flash`, ...),
  `lookOn(look, node)`. A shot may also carry `{ look }` itself.

Every export, one line each: `references/api.md`.

**Anchors.** `meta('anchor', { cel: 'gpu' })` points at a placed cel;
`meta('anchor', { name: 'die' })` at any group or op with that `name`
(`group('die', ...)`, `stroke(p, 'ink', { name: 'die' })`, marks like
`seedDot` are `group('seedDot')`). Several anchor metas in one shot are
alternatives: one of them must be drawn and big enough (24 px at 240 px
wide). Recipes take `anchor: { ... } | [ ... ]` to replace theirs. Lint
checks that each shot anchors something; that it is *the same* thing across
cuts is on you (review list). A small anchor like the seed dot (~6 px at
240 px) cannot pass alone: pair it with the shot's large subject, the way
recipes N, O and P pair it with ripples, cards and badges.

## Looks and engines

| look | preset | finish | for |
|---|---|---|---|
| ink | `paperInk` | hatch | warm paper, wobbly outlines, construction lines, blueprint interludes |
| riso | `risoPop` | halftone | fluorescent plates, seed dot, card montages, badge galleries |
| screen | `screenSea` | dots | flat shapes under a dot grid, one constant protagonist, day and night |
| pencil | `pencilMinimal` | graphite | cream and charcoal, torn sections, squiggle text, dark sections |
| blueprint | `blueprintNight` | hatch | chalk on navy only: "look inside" |
| doodle | `doodlePastel` | wash | brush pen and watercolour on cut-out photos of real objects |

`derive`, `duotone`, `pastel`, `withLook` make variants; palettes, finishes
and riso plates are in `references/looks.md`.

| engine | what the frame is | example |
|---|---|---|
| found motion (`traced`) | drawn as always, poses traced from real movement | `gallop.js` |
| sand (`sim`) | a bed of sand a hand works in one take, no cuts | `one-year.js` |
| paper in space (`stage3d`, `book3`) | flat sheets stood up in a lit 3D room | `moon-book.js` |

Pick one only when the brief asks for it or the subject is better served by
it: a real animal's movement, a story that must not cut, a book or a stage.
`references/engines.md` has each condensed.

## Procedure

You cannot judge a frame from code. "Look" means open the JPG and look at it,
once, then act on what you saw.

1. **Brief.** Fill `references/brief-template.md` from the request, as the
   comment at the top of the film. Ask at most one round of questions
   (subject, length, format, look). Pick the look and the **anchor**: the one
   element that survives every cut.
2. **Timeline from recipes and packs.** Write the beat sheet (start, dur,
   shot, look, recipe, cels, sound) under the brief, then the timeline
   (a stub cel that draws a labelled box is fine where a new cel will go):
   recipes from `references/recipes.md`, cels from the packs
   (`references/api.md`, "Packs"; each has a sheet in
   `handdrawn/packs/sheets/<cel>.jpg`). Placeholders are fine: a recipe with
   its default subject is a shot. Then
   `hdf board work/<film>/<film>.js`: it prints the tree and writes
   `out/<film>-board.jpg`, one card per shot. **Look once.**
3. **Cels.** Write the cels no pack has (usually one or two). Each declares
   `box`, `inputs` and `desc`, is centred on its origin (or stands on
   `y = 0`), and draws only roles. For each:
   `hdf sheet work/<film>/<film>.js <cel>` writes
   `out/<film>-sheet-<cel>.jpg`: three scales, every input extreme, every
   look, the silhouette, 240 px. **Look once per cel.** It must read at 240 px.
4. **Lint, then grid.** `hdf lint work/<film>/<film>.js` until it prints
   `lint clean` (every finding names shot, frame, rule and what to fix).
   Then `hdf grid work/<film>/<film>.js --n 24`: 24 frames across the film
   in `out/<film>-grid.jpg`. **Look once.**
5. **Fix; look only at what moved.** After edits, `hdf changed
   work/<film>/<film>.js` lists the frames whose display list changed since
   the last render or `changed` run and writes before/after pairs to
   `out/<film>-changed.jpg` (the first run only records a baseline, so run
   it once before you start fixing). Look at those, not the whole film.
   `hdf only <film.js> 0,37,74` renders single frames at full size.
6. **Render and deliver.** `hdf render work/<film>/<film>.js` writes
   `out/<film>.mp4`, `out/<film>.wav`, `out/<film>-final.mp4` (with
   sound) and `out/<film>-sheet.jpg`. **Look at the contact sheet once.**
   `hdf bundle work/<film>/<film>.js` writes `out/<film>.html`, a player
   that opens from disk. Deliver the film module, `-final.mp4`, the bundle,
   and one line per shot saying what it shows.

While working, `hdf dev work/<film>/<film>.js` serves the player on :4321
with hot reload; it jumps to the first frame an edit changed. `--ar 16:9`
or `--ar 9:16` renders another format; `--width 1920` a larger one;
`--look <preset>` restyles every shot that does not name its own look.

## What lint checks, and what it cannot

Lint (`core/lint.js`) fails on: colours that are not roles; a shot not
starting on paper, night or a backdrop; two finishes or a look op in a shot;
a missing anchor; more than two scribbled parts; a cel drawing outside its
box; words beyond the look's allowance (0; doodle 3; `look.words` to
change it); a cut over 1 s or two cuts in a row; no sign-off, or one still
writing 1.5 s before the end; an anchor under 24 px at 240 px wide, or cut
by the frame edge without `meta('intent', 'crop')`; cues off the 1/12 s
grid; `Math.random`, `Date`, filters, `shadowBlur` or gradients in the
source.

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

## Pitfalls

- `impact` is two things: the score motif (`handdrawn`) and recipe J
  (`handdrawn/recipes/shots.js`). Import one `as` another name.
- Durations must be multiples of 1/12 s (`seq` throws otherwise): 0.25, 0.5,
  0.75, 1, 1.25 ... and 11/12 are fine; 0.3 is not.
- Pack cels with a `mode` input (`boat`, `fly`) draw a blueprint version;
  others do not. A whole blueprint shot can be `lookOn('blueprintNight',
  shot)`, but inside recipe B (half ink, half blueprint in one shot) that is
  not possible (a look op in a shot fails lint): give the recipe a subject
  that branches on `mode` and draws the outline in `'chalk'` for
  `'blueprint'`.
- Recipe subjects: `(ctx, mode) => node` everywhere except G, whose
  `subject(pose, ctx)` gets `{ x, y, dir, t, k, i }`.
- A recipe's camera (A pushes in) can cut a tall subject off at the top
  without a lint finding (seen in the acceptance run): check the grid. A pack cel that stands on
  `y = 0` (`server`, `lamp`, `teapot`) needs its `y` lower than a centred one.
- A recipe without an `extras` option (most of them) is extended by a custom
  shot around its layer: `shot('x', 2, (ctx) => [night(), ...doubling.layer(ctx, o), yourOps])`.
- Never write the shape `import X from '...'` inside a comment: the bundler
  reads it as an import.
- A cel's draw must be pure in its inputs: no `t` from outside, no closures
  over mutable state. Animate by changing inputs or the `place` around it.
- `text` / `handText` count as words; the sign-off does not.

## When to reach further

The v1 skill (`.claude/skills/hand-drawn-canvas-animation/`) holds three
films not ported to 2.0 and worth reading for ambitious briefs:
`examples/night-shift.html` (a doodle chase at 120 bpm with whip cuts),
`examples/one-seed.html` (sand at full range: camera over a wide table,
wind, snow, seasons) and `examples/paper-horse.html` (all three engines at
once). Its `references/doodle.md` is the long method for finding an idea in
an object; `references/reference-films.md` measures the films the looks come
from. Read them for ideas; write the film against this package.

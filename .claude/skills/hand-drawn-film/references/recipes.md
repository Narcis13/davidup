# Recipes: shots, timing, score

Recipes are functions in `handdrawn/recipes/shots.js` (the doodle set AA to AM
lives in `recipes/doodle.js` and is re-exported). Letters follow v1's
`scenes.md`, so a v1 beat sheet is still a lookup. Chain 8 to 14 of them.

```js
import { establishing, blotToBlueprint, montage, signOffShot } from 'handdrawn/recipes/shots.js';
const open = establishing({ name: 'open', dur: 2, subject: () => gpu({ spin: 0 }), scale: 1.6 });
```

- `R(opts)` returns a shot: the ground (paper or night), the drawing, the
  anchor meta and the recipe letter for `hdf board`. Every option has a
  default, so `R()` alone renders; override what the brief needs.
- Common options on every recipe: `name`, `dur`, `look` (the shot's own
  look), `fit`, `camera` (a board label), `anchor` (a meta data object, a
  list of alternatives, or `(o) => either`, replacing the recipe's own:
  `anchor: [{ name: 'subject' }, { name: 'seedDot' }]`), `crop` (true: the
  subject may leave the frame on purpose).
- `R.layer(ctx, opts)` is the drawing alone, for composing two recipes in one
  shot or feeding one into another (`blotToBlueprint({ scene: (ctx, mode) =>
  establishing.layer(ctx, { mode }) })`).
- Subjects are functions, so any cel rides any recipe:
  `subject: (ctx, mode) => node`. `mode` is `'ink'` or `'blueprint'`.
- **`actor:`** a cast member (`core/actor.js`: `CAST.FOX`, `CAST.HOG`, or
  `actorOf(puppet('owl'))`) takes the place of the recipe's subject or figure
  in A, G, M, U, W, X and Z, drawn in its own roles whatever the mode; in G
  it faces the way it travels and walks. Every doodle recipe AA to AM takes
  it (default `HOG`); AC also takes `say:` (a fragment from
  `actor.say(text, t0)`; the actor's mouth, the letters in the bubble and the
  plucks come from one timing). `book3` pieces take `{ base, h, actor, state }`.
  Size an actor on A, G, M, U, W, X and Z with `h`, the rest pose's drawn
  height in recipe units (`establishing({ actor: OCTO, h: 300 })`): without
  it the actor's whole rig box is fitted to the boat's 140 units, and a
  puppet whose poses swing wide reads small. A's push-in stops short of
  cutting the subject (pass `crop: true` to cut it on purpose).
- Coordinates inside recipes are v1's: a 1080 square around (540, 540).
  Other formats are handled by the shot's `fit` (default `anchor`).
- `R.defaults` lists every option with its value; api.md lists the names.

## Ink look (the fruit-fly film)

**A. Establishing shot on a textured surface (1.5 to 2.5 s).** `establishing`.
Ground is a huge circle far below the frame (`ground: { x, y, r, role }`, top
edge about a third up), a light hatch patch and a blush cross-hatch
(`patches`), grain, a wobbly rim. Subject at 1.6 to 1.9x (`scale`, `x`, `y`,
`rot`) with `construction` lines and a `scribble`; camera pushes in from
1.15 to 1.3 (`push`, `at`) with `ease.io`. `extras(ctx, mode)` adds marks in
world space (speed lines on `pulse(i, 9)`).

**B. Ink blot into blueprint (0.6 to 0.8 s).** `blotToBlueprint`. `scene(ctx,
mode)` drawn in ink; from `t0` the same scene in blueprint grows out of a blot
at (`x`, `y`) to `reach`. Also works as the tail of a longer shot (`t0`,
`span`).

**C. Spark, construction, self-drawing outline (1.2 s).** `sparkConstruct`.
An aster ignites over 0.3 s, construction fades in over 0.4 s, the outline of
`body` (`{ x, y, rx, ry, rot }`) draws itself over 0.4 s, a hex lattice fades
in inside. Night ground.

**D. Doubling particles (1.5 to 2 s).** `doubling`. At each time in `cues`
(every ~0.3 s) the count doubles, seeded inside `body`; spindle lines join
siblings for 0.25 s after a cue; a lineage `tree` grows in a corner. Score it
with `cueNotes(cues)`.

**E. Bands (0.8 to 1.2 s).** `bands`. 1 to `n` flat accent bands every
`every` (~0.11 s), with grain, clipped to `body` in its own frame.

**F. Macro insert (2 drawn frames).** `macroInsert`. The same `scene` with
the camera at `zoom` 4 to 6 on (`x`, `y`). Hard cut in, hard cut out.

**G. Camera-follow travel (2 to 3 s).** `followTravel`. Along a cubic `path`
(`[p0, c0, c1, p1]`), heading from the derivative, camera leads by `lead`
(~120); seeded `lines` per frame, `trails` (loops) with a fixed seed, a
hatched `shadow`. `world(ctx)` is in world coordinates;
`subject(pose, ctx)` draws the traveller heading up at the origin.

**H. POV mosaic (0.6 to 1.2 s).** `povMosaic`. `world(ctx)` seen through a
compound eye: hex cells shrinking from `s[0]` (40) to `s[1]` (13) over
`over`, inside an iris of radius `r` with a chalk `rim`; `flicker: true`
alternates with the clean view.

**I. Network (1 to 1.5 s).** `network`. `n` particles on seeded arcs round
`clusters` with asters, a slow camera `turn`, night.

**J. Impact (0.5 s).** `impact` (import `as` something: the score motif has
the same name). One flash frame, a filled blob and 30 droplets, then a hold
with red construction circles. Score: `impact(t)` from `handdrawn`.

**K. Vibration (1 s).** `vibration`. A zig-zag `from` to `to` (thick dark
under thin chalk) changing every drawn frame; circles leave the source every
`every` drawn frames.

**L. Time passing (1 to 2 s).** `timePassing`. A sun disc on an arc, one
tally mark per `every` drawn frames, paper flickering between day and dusk.

**M. Coda (1.5 s).** `coda`. Night, two `sparks`, the subject in blueprint
fading over `fade`.

## Riso look (the flipbook)

**N. Seed dot and ripples (1.5 to 2.5 s).** `seedRipples`. The seed dot at
(`x`, `y`); a ring is born every `every` (4) drawn frames and travels out at
`speed` (~260 px/s), alternating two `roles`; rings past the frame drop.
`iris: { card, from, to }` opens on a card during the last 0.7 s (`card`
is a card function `(ctx) => list`, e.g. `CARDS[0]`).

**O. Card montage (2 to 8 s).** `montage`. `cards: [(ctx) => list]` (no
paper; usually `risoCard`s), one per `per` (0.25 s = 3 drawn frames), hard
cuts, the seed dot on top of every card. `dur` defaults to cards x per.
Designing cards: `looks.md`, "Riso".

**P. Badge gallery (1.5 s).** `badgeGallery`. Every card as a round stamp on
dashed rings over a faint dot `screen`; badges grow in over `grow` (0.5 s,
ease out), hold, then the ring shrinks to the seed dot over `shrink`
(ease in).

**Q. Duotone beat (0.5 to 1 s).** `duotoneBeat({ base, a, b, cards })`. The
same cards in two inks: the audience reads it as a print run.

**R. Starfield with circled dots (1.5 s).** `starfield`. Night in three accent
grains, a ring from the seed wakes twenty dots with dashed rings, a few
sparks, one constellation line per drawn frame.

**S. Sign-off (2.5 s, the last shot).** `signOffShot({ a, b })`. Two words in
hand lettering and two ink dots on paper with faint ripples; the first word
writes over `reveal[0..1]`, the second over `reveal[1..2]`, then holds. Lint
wants it complete 1.5 s before the end.

## Screen look (the paper boat)

**T. Constant protagonist (whole film).** Not a function: a way to use the
others. One cel, the same size at the same spot, while the world cuts around
it 20 to 30 times; each world is 2 to 5 flat shapes under the dot finish and
one accent. Move the horizon, never the protagonist.

**U. Flat landscape, day and night (1 to 2.5 s each).** `landscapeDayNight`.
Day: sun with a dot screen, dotted mountains, reeds, water, wake dashes.
Night (cut at `nightAt`): moon, a hill with a window glowing through a radial
screen, dark water. `subject(ctx, isNight)` bobs at (`x`, `y`). The cut is
the beat.

**V. Origami setup and payoff (1.5 s each).** `origami`. On a `desk`, a written
sheet folds into a boat in hard cuts every `every` (3) drawn frames;
`reverse: true` unfolds it back.

## Pencil look (the website)

**W. Page with torn sections (2 to 3 s).** `tornPage`. A squiggle-text wall, a
small `label` (words: allow them with `look.words`), a sticky note, a section
in `fills.0` rising over `rise` with plants, then a night section over `dark`
with dotted arcs, dot bursts and a blueprint `figure`; a thread over all.

**X. Dark section devices (1.5 s).** `darkSection`. On night: dotted arcs
every `gap` round a still centre, dot bursts, a chalk `figure`, stars as
grain, an optional `caption` in chalkDim.

**Y. Pattern sampler (1.5 s).** `patternSampler`. A 4 x 4 grid, a different
lattice or mark per cell, one more cell per drawn frame.

**Z. Enso (1.5 s).** `enso`. A thick brush circle draws itself (`draw`) round
a thin `figure`, then the paper dims to chalk (`dim`).

## Doodle look (cut-out photos)

Every doodle recipe takes `photo` (a cutout from the store, `PHOTOS.teapot`
after `fromStore`; see assets.md) plus placement in photo units (`pivot`,
`spout`, `hub`, `flame`: `[u, v]` read off the photo's check sheet), `actor`
(the cast member, `HOG` by default; `who: builder` still works), words
(`word: null` drops a caption), `paper` (a pastel sheet name, or `null` to
keep the film's stock, as the cut-out look needs) and `look`. Each is 1.5 to
4 s: the object alone for a few frames, drawings arrive from several pens,
a gag in the last third. `fox-and-teapot.js` runs AC, AJ, AK and AF with the
fox; `held-once.js` runs AA to AF with the hedgehog.

| | function | what happens |
|---|---|---|
| AA | `becomesVehicle` | the object floats (`rot` to lay it down), mast, sail and sailor attached with `on(pl, u, v)` so they bob with it, water drawn over the hull, a far lighthouse |
| AB | `livesInside` | characters drawn after the photo, then the front wall (`lip`) laid back over them; they rise into view |
| AC | `doesItsJob` | it tips over its base (`pivot`) and pours from `spout` into drawn cups; steam turns into a heart; `say:` lets the actor greet it |
| AD | `timeOnIt` | a drawn hand sweeps the real dial from `hub`, a sun crosses with it, the character falls asleep |
| AE | `nightFalls` | the sheet goes to night (`k`), a match lights the `flame`, chalk stars and moon, a friend walks in |
| AF | `printsOnALine` | the last frame of every scene (`lastFrame(shot)`) hung as prints on a string, then the sign-off (`a`, `b`) |
| AG | `lightEscapes` | the light hops out of the lamp; the pool of light goes with it and the lamp goes dark |
| AH | `alongTheEdge` | two runners take the photo's real top edge (`rim`), a note where each step lands, the camera follows |
| AI | `insideTheTube` | the runner vanishes into `mouth`; only its light travels to `bell`, then it bursts out with a recoil |
| AJ | `looksBack` | red lights behind the object's `eye` and `jaw`, a roar, quills up, the runaway pops out laughing |
| AK | `getaway` | the photo itself gallops, dust and speed lines, drawn milestones pass |
| AL | `caughtLetGo` | the light dims in the jar, a held beat with no music, the `lid` tips, it shoots up |
| AM | `sunrise` | a semicircular object rises behind a drawn hill, rays draw on, night goes to 0 |

The long method for finding the idea in an object is v1's
`references/doodle.md`; `held-once.js` is the worked 2.0 example.

## Timing and editing

- Beat sheet first, as a comment above the timeline: start, duration, shot,
  look, recipe, cels, sound cue. `hdf board` then checks it against the tree.
- Durations: establishing 2 to 2.5 s; interludes 0.6 to 1.2 s; action 1.5 to
  3 s; montage cards 0.25 s; screen-look worlds 0.5 to 1 s; inserts 2 drawn
  frames; sign-off 2.5 s. Total 15 to 30 s.
- Everything on the 1/12 s grid; `seq` throws otherwise. Cuts land on drawn
  frames by construction.
- `cut(kind, dur, a, b)` does not wrap `a` and `b`: it is the transition
  from `a`'s last frame to `b`'s first, and it adds `dur` of its own. Both
  shots stay in the timeline: `seq(a, cut('iris', .5, a, b), b)`. A cut on
  its own drops both shots (lint `cut-orphan`).
- Camera eases (`ease.io`); particles move linearly; reveals `ease.out`;
  collapses `ease.in`. `ramp(a, b, t, e)` is 0..1 between two times.
- A flash at most twice a film. Never two transition devices in a row (lint:
  two `cut`s adjacent). A look change lands on a hard cut and lasts 1 s+.
- Must include, for a film of 15 s or more: one establishing shot (A or U),
  one drawn transition (B, an iris, or a torn section), one of C, D, E or O,
  one POV or gallery (H or P), and the sign-off (S).

## Score

`film({ score })` is `(cues) => events` or `{ master, events }`; `cues` is
`{ shots: [{ name, t0, dur }], cuts, end }`, so the music reads the timeline
and cannot drift. Events are `note(t, hz, dur, type, gain)` (types `sine
triangle square saw`) and `burst(t, dur, gain, seed)`; `pentHz(octave,
step)` gives a pentatonic pitch. Motifs (`handdrawn`, from
`recipes/score.js`):

| shot type | motif |
|---|---|
| establishing, sea | `plucks(t0, dur)`: slow pentatonic triangles, one every 0.5 s |
| blueprint interlude | `swell(t0, dur)`: 55 Hz saw plus a sine an octave up |
| doubling, cues, cards | `cueNotes(times)`: one short note per cue, rising; `type: 'square'`, low `gain` for cards |
| travel | `travel(t0, dur)`: 1/8-note square arpeggio plus a sine pulse every 0.5 s |
| page, pencil | `sparse(t0, dur)`: sine an octave down every 0.75 s |
| impact | `impact(t)`: a noise burst plus a 55 Hz sine |
| gallery, sign-off | `dyad(t0, dur)`: a long sine dyad with a 1 s release |
| sand | `bed.hiss()`: every gesture hisses for as long as it lasts |
| speech | `line.events(t0)` from `actor.say()`: one pluck per syllable (`pluckPerSyllable(text, t0)` bare) |
| narration | `voice(id, t, { gain, dur })`: a recorded line from the store (`--kind sample`); the rest ducks 9 dB under it |
| voiced speech | `line.events(t0)` from `actor.say(text, t0, { voice: id })`: the recording itself, in place of plucks |

```js
score: ({ shots, end }) => {
  const at = Object.fromEntries(shots.map((s) => [s.name, s]));
  return [...plucks(at.open.t0, at.open.dur), ...swell(at.inside.t0, at.inside.dur), ...dyad(end - 2, 2)];
},
```

Master gain is clamped to 0.6. `hdf render` writes the wav and muxes
`-final.mp4`; nothing to click.

A voice is a wav in the store, not a synth voice: make it with `say -o
line.wav --file-format=WAVE --data-format=LEI16@22050 "..."` (macOS), piper,
edge-tts or a phone recording (`ffmpeg -i memo.m4a line.wav`), then `hdf
import line.wav --kind sample --name <id> --licence own`, name the id in the
film's `assets` and put `voice('<id>', t)` in the score. Lint rule `voice`
fails a missing sample or a line that runs past the end (cut it with `{ dur
}`). The contact sheet shows it as an orange bar under the tiles.
`captions(id, { t0 })` letters its words as they are spoken, from the timing
`hdf align <id>` stores (4.0 V2).

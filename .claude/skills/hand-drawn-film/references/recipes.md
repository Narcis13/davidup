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

## Teaching (explainers, 4.0)

Recipes AN to AY live in `handdrawn/recipes/teach.js` and are re-exported
from `shots.js`. `films/lesson.js` runs AN to AQ on the whiteboard,
`films/growing.js` AR to AU, `films/asking.js` AV to AY.

- **Chapters (E1).** `chapter(title | { title, card, hold, ...titleCard
  options }, ...nodes)`: AN (named `card: <title>`), the nodes, then a hold of
  the last frame (the audience's dwell, at least its cut floor: general 0.5 s,
  beginner 1, kids-9 1.5, kids-7 2, kids-5 2.5). A chapter is 20 to 40 s; a
  card for a one-word title at kids-9 is about 2 s. `films/chapters.js` has
  three.

- **They time themselves.** `dur` defaults to what the copy needs for
  `audience:` (`general`, `beginner`, `kids-9`, `kids-7`, `kids-5`; the table
  is `AUDIENCES`): the pen writes at `write` characters a second, the viewer
  reads `read` words a second, each new thing `dwell`s, and letters grow by
  `text`. Longer copy gets a longer shot, and a younger audience gets a slower
  one. Pass `dur` to fix it: the timing inside stays put and a longer shot
  holds at the end. Durations land on the 1/12 s grid.
- **`actor:` is the teacher**, not the subject. It stands at the side
  (`side: 'left' | 'right'`, `h` is its rest pose's drawn height), faces us,
  idles, and takes poses from the biped vocabulary: `present`, `point-r`,
  `cheer`, `think`. A cast member without a vocabulary just idles. To label an
  actor, pass it as AO's subject:
  `subject: (ctx) => actorFigure(A, A.idle(ctx.t), 300, 'drawn')`.
- **Words.** Every lettered string counts against the look's allowance,
  digits included. The whiteboard allows 12 a shot, other looks 0 to 3, so set
  `look.words` (`derive`) when you use them elsewhere. Lettering is written on
  in stroke order.
- **A hand to the pen.** `titleCard({ hand: true })` (or writer's options:
  `{ tool, side, scale, skin, ink }`) has a drawn hand write the title and the
  sub a word at a time at the audience's `read` speed, lifting between words,
  and the swash; it comes in over 0.4 s and leaves after the last word (the
  shot grows by the difference). Anything else is written by hand with
  `writeOn` and `writer` from the package (see `films/written.js`); a stroke
  to follow lettering needs `order` past it (`order: 1e6`).

| | function | timing | what happens |
|---|---|---|---|
| AN | `titleCard({ title, sub })` | 3 to 6 s: `at` (0.25 s), the title written, 0.3 s of swash, the sub written, then read | the title written on, centred and wrapped to `width`; a swash in `swash` (accents.0) underlines it; the sub goes under it; the teacher `present`s as the title finishes and smiles once it is all down |
| AO | `labelled({ subject, labels, per })` | per label: 0.3 s leader, the word written, then read (or `per`) | the subject at (`x`, `y`) by `scale` (default: a `flower`); for each `{ text, at, from? }`, a dot on the part, a leader to the word, the word written; words sit `reach` past the side of the subject the part is on, a line and a half apart; the camera eases `nudge` (0.1) towards each label and back to the whole at the end |
| AP | `counting({ items, n, per, tally, label })` | `per` an object (the audience's `count`, 0.5 to 1 s), then the total written and read | `n` objects (a cel or `(ctx, j) => node`, default `apple`) pop in, in rows of `cols`, each numbered underneath; a tally in `mark` grows below (`tally: false` for none); `label` writes the total ("8 phases"); the teacher points, then cheers |
| AQ | `compare({ left, right, sign, labels })` | 3 to 6 s: the divider, the left, the right (each read), the sign, then read | a line splits the frame, `left` pops in with its label, then `right`, then the sign (`'<'`, `'>'`, `'='` drawn, `'vs'` lettered) is drawn last in `mark` in a gap in the line; the teacher thinks, then presents the answer |
| AR | `process({ steps, arrows, per })` | a step a beat: the card 0.35 s, the picture pops at 0.3 s, the text written from 0.45 s and read, the arrow 0.35 s (or `per` a step); then a dwell | `steps` (`[{ text, cel }]` or strings; default seed, sprout, flower) as cards left to right, rows of `cols` past four, clear of the teacher; each card drawn, its `cel` popping in, its text written under it; an arrow (`'straight'` or `'curved'`, in `mark`) drawn on to the next; the teacher points, then cheers |
| AS | `cycleDiagram({ steps, travel, centre })` | `centre` written and read, then a step a beat (node pops, name written and read, 0.4 s arrow to the next; or `per`), then a lap (`lap`, default n × max(0.6, dwell)) × `laps`, then a dwell | `steps` on a ring of radius `r` clockwise from `start` (the top): a node (its `cel`, or a coloured dot) pops in, its name lettered along the ring outside it with `textOnPath` (at the sides level, inside the ring), an arrow along the ring to the next, the last closing the loop; with `travel` (default) a marker goes round, each node swelling as it passes; the teacher points, then cheers |
| AT | `numberLine({ from, to, start, jumpTo, hops })` | 0.5 s line, 1.2 s numbers, the marker pops, a dwell, then a hop a beat (the audience's `count`, or `per`), each leg's `+n` written and read, the landing ringed, a dwell | a line from `from` to `to` with a tick every `step`, numbers under it (`marks`: a list or a step; by default every tick if they fit the audience's words, else the ends, the start and the landings); a marker (`marker`: a cel, default a dot) hops from `start` to each of `jumpTo` a unit at a time (`hops: 'one'` for one leap), each hop an arc drawn as it goes; `hopTimes(opts)` gives the hops' start times for the score |
| AU | `growth({ cel, from, to, count, label })` | `label` written, then a value a beat (the audience's `count`, or `per`) from `from` to `to` in steps of `by` (default at most nine numbers), each rising over 0.8 of its beat, then read and a dwell | a baseline with `label` under it; a bar (no `cel`) rising, or a pictograph stacking a `cel` a `unit` in `cols` columns; the number above it counts on (`count: false` for none); `max` is the value the full `height` stands for; the teacher points, then cheers at the top |
| AV | `questionCard({ text })` | the `?` drawn 0.7 s, its dot pops at 0.2 s, the question written and read, a dwell | a big `?` in `mark` (drawn, so no word for lint) above the question, which is centred, wrapped to `width` and hangs from `y`; the teacher shrugs (`pose`) and looks confused (`emote`) once the mark is down |
| AW | `quiz({ question, options, answer, pause })` | the question written and read; an option a beat (box 0.3 s, written, half read); `pause` (2.5 dwells, at least 1.5 s); a wrong option crossed every 0.6 s; the answer ringed 0.2 s later; read, a dwell | two to four `options` (strings or `{ text, cel }`) under the question, each with a box; three dots fill in over the pause; the wrong ones are crossed in their box and struck through in `strike`, the `answer` (an index) ticked and ringed in `ring`; the teacher thinks, points, cheers; `quizTimes(opts)` gives `{ ticks, ding, pause }` for the score |
| AX | `mapRoute({ map, path, label, ends })` | the map drawn over `draw` (1.2 s), the first end written, the journey (`travel`, or the route's length at `speed` 320 units a second, at least 1.5 s), the X 0.35 s, the second end and the label written, read, a dwell | `map` (a cel, default `map` with `MAP_AT`, `(ctx) => node`, or a cutout photo whose `path` is in its 0..1 u, v) drawn on in stroke order (a photo pops); a pin (or a `marker` cel, turned to face the way) travels the spline through `path` with a dashed trail; an X at the end, `ends` written under the ends, `label` lettered along the route's chord on the side it does not bow to |
| AY | `dialogueShot({ actor, other, lines })` | the dialogue's own timing (T9: each line at the reading pace, held through the reply), then 0.25 s and a dwell | two actors (default two sticks, `sam` and a child `kit`) `h` tall (`[left, right]`, default 330 and 270) with their feet on a `ground` line at `x`, facing each other and looking at the speaker (`gaze`); `lines` are `[speaker, text, { kind, emote, voice }]`, the speaker `0` / `'left'`, `1` / `'right'` or the actor; `dialogueOf(opts)` is the same dialogue for the score (`.events(shot.t0)`); every line counts for `words`, so a long exchange is several shots |

A number line's numbers and a growth's counted values are words for lint
like any lettering: a count from 0 to 8 is nine, and each value must stay up
for the audience's reading time (the counting pace already does).

Objects that pop in (AP's items, AQ's subjects, AR to AX's pictures, nodes
and markers) draw direct, never as cached
layers. The whiteboard's marker is translucent, and a cached layer of it can
differ by one level from the same drawing replayed, which would make a
repeated object render differently across worker splits.

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
| a lesson under it | `bed({ mood, key, from, to })`: a chord loop (bright, calm, mystery, march), its bar whole twelfths; `.stop(t)`, `.sting(t)` |
| a quiz | `pop` per option (`quizTimes(o).options`), `tick` per strike (`.ticks`), `ding` on the answer (`.ding`), `tada` |
| a cut | `hits(cues.cuts, { kind })`: a whoosh centred on each (or pop, tick, boing, ding, flip) |
| a writing hand | `writerSounds(node, { t0, tool, ...writeOn's schedule })`: the tool on each unit (marker, chalk, pen, pencil, crayon) |
| chalk on a board | `chalkTaps(node, { t0, ...writeOn's schedule })`: a `chalkTap` each time the chalk comes down to start a line (`strokeStarts(node, o)`, none closer than `gap` 0.08 s); under `writerSounds(node, { tool: 'chalk' })` for the scratch too |
| an eraser | `eraserSounds({ t, dur, box, band })`: a scrub a row of `fx('erase')`'s track |

```js
score: ({ shots, end }) => {
  const at = Object.fromEntries(shots.map((s) => [s.name, s]));
  return [...plucks(at.open.t0, at.open.dur), ...swell(at.inside.t0, at.inside.dur), ...dyad(end - 2, 2)];
},
```

Master gain is clamped to 0.6. `hdf render` writes the wav and muxes
`-final.mp4`; nothing to click.

Sound effects (4.0 V4, `recipes/sfx.js`): `pop boing whoosh ding tada tick
squeak flip erase pencilScratch chalkTap`, each `(t, options) => events`.
They are built from four synth fields any note or hiss may take: `hz1` (with
`bend`, `glide: 'exp' | 'linear'`) bends the pitch or the hiss's band, `vib` /
`vibDepth` wobble it, `sus` holds a note at its gain for that fraction of its
length, `swell: true` makes a hiss rise and fall with no tail. A bed sits at
about -36 dBFS under a -17 dBFS voice and ducks 9 dB under it like the rest
of the score; keep effects off the narration's voiced part if they must be
heard at full level. `films/quiz-time.js` uses all of it.

A voice is a wav in the store, not a synth voice: make it with `say -o
line.wav --file-format=WAVE --data-format=LEI16@22050 "..."` (macOS), piper,
edge-tts or a phone recording (`ffmpeg -i memo.m4a line.wav`), then `hdf
import line.wav --kind sample --name <id> --licence own`, name the id in the
film's `assets` and put `voice('<id>', t)` in the score. Lint rule `voice`
fails a missing sample or a line that runs past the end (cut it with `{ dur
}`). The contact sheet shows it as an orange bar under the tiles.
`captions(id, { t0 })` letters its words as they are spoken, from the timing
`hdf align <id>` stores (4.0 V2).

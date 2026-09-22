---
name: hand-drawn-film
description: Make a 10 to 40 second film (a lesson up to 180 seconds, in chapters) that looks hand-drawn or hand-printed, written as a JavaScript module on the handdrawn package (display lists drawn on Canvas 2D by skia-canvas, rendered to mp4 with a generated score, no browser). Eleven looks - ink on warm paper with hatching, riso halftone prints in fluorescent inks, flat screen prints with dot grids, graphite minimalism with torn sections, chalk blueprints, brush-pen doodles on cut-out photos of real objects, cut-out card pinned with brass fasteners, a classroom whiteboard in coloured markers with an eraser, a chalkboard in white and coloured chalks with dust and the ghost of the last lesson, wax crayons on construction paper for the youngest, and a ruled school notebook page in felt tip with doodles in the margin and pages that turn - drawn on twos (12 fps). Three engines - found motion (poses traced from real movement, retargeted onto a puppet, or your own walk filmed on a phone), sand on a light table in one take, and paper in space (a pop-up book in a lit room). A cast of puppets (drawn in Figma as SVG or written as JSON) that any recipe directs, speaks, turns and walks; the film lettered in the user's own handwriting from a photographed sheet; an asset store searched before anything is drawn; shots from recipes (A to Z, AA to AM, and the teaching set AN to AY), cels from packs; lint before pixels; a bridge into davidup compositions. Use when the user asks for a hand-drawn animation or explainer, "мультик", "рисованный ролик", a riso or screen-print look, doodles on photos, a cut-out or paper-puppet look, a whiteboard, chalkboard or notebook explainer, a crayon drawing for small children, sand animation, a pop-up book, rotoscope, a character that talks or walks like them, a child's drawing that walks, a film in their handwriting, a procedural short film, or a canvas video in this family of styles. Not for UI animation, charts or slide decks.
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
| `mini-voice.js` | paperInk | `mini` with a narrated line: a store sample, `voice(id, t)`, the score ducking under it |
| `lesson.js` | whiteboard | the teaching recipes AN to AQ (title, labelled, counting, compare) with a stick puppet as the teacher, timed for `audience: 'kids-9'` |
| `growing.js` | whiteboard | the teaching recipes AR to AU: a process in cards, the water cycle on a ring (names along it, a marker going round), hops along a number line, a bar counting on |
| `asking.js` | whiteboard | the teaching recipes AV to AY: a question card (a big `?`, sam shrugging), a quiz (a pause, the wrong options crossed with a tick each, the answer ringed on a ding from `quizTimes`), a route over a drawn map, two sticks in a `dialogueShot` (its lines in the score from `dialogueOf`) |
| `chapters.js` | whiteboard | a lesson in three `chapter(title, ...)`s: each opens on its title card and holds a beat; the board is a card per chapter, `hdf render --chapter 2` renders one alone |
| `pointing.js` | whiteboard | a pose timeline: `perform(SAM, [[t, pose, { anticipate, overshoot }], ...])` points a stick teacher at three labels in turn, held frames dedup |
| `walk-on.js` | whiteboard | IK: `walkTo` walks sam on with its feet planted, `lookAt` turns its head to a balloon, `reach` puts its hand on the string; the fox's one-segment arm reaches a teapot's handle |
| `holding.js` | rose paper, chalkboard | props in sockets: the fox pours the teapot it holds (`attach`, `level`, `propAt` for the spout); sam writes a sum with chalk in hand (`heldTool`, `writer`'s `by`), walking on between the halves |
| `follow.js` | whiteboard | secondary motion: sam's four-link scarf swings after a jump and a bow; the fox's tail lags its walk and overshoots into a wave |
| `written.js` | whiteboard | a caption written by a drawn hand at two words a second: `writeOn` and `writer` on the same node, the hand lifting between words |
| `marked.js` | whiteboard | the teacher's pen: the hand writes a sentence, then underlines a word, circles another and writes a label with an arrow, each mark drawing on in turn (`wordBox`, `underline`, `circleAround`, `callout`) |
| `sums.js` | whiteboard | numbers: a hand writes `equation('2 + 3 = ?', { answer: 5 })`, five apples pop in (`pictograph`) numbered as they land (`countOn`) with a `tally`, the ? gives way to the 5 as the hand comes back; the months written round a ring with `textRound`, a tally mark each |
| `narrated.js` | paperInk | an 18 s narrated paragraph with `captions(id)`: words lettered as spoken, the spoken word underlined, timing from `hdf align` |
| `hello.js` | doodlePastel | lip sync: the fox says a recorded "Hello there!" with its mouth following the Rhubarb track stored on the sample (shut on the "th"); sam repeats it without a bubble through `actor.mouth` |
| `quiz-time.js` | whiteboard | sound effects and a bed: a bright `bed` under the lesson ducking under two narrated lines, the marker squeaking a word at a time (`writerSounds`), a whoosh on the cut (`hits`), a pop per option, a tick per wrong answer, a ding on the right one, the eraser's rows (`eraserSounds`), the bed's `stop` and `sting` |
| `fox-and-teapot.js` | doodlePastel | **the 3.0 film**: store assets, the fox as `actor:` on recipes AC AJ AK AF, `say()`, a retargeted gallop, a turnaround on a `book3` page, a four-line `dialogue` with a stick teacher |
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
  transition fx: `blot`, `iris`, `dissolve`, `wipe`, `flash`, `erase`, `flip`, ...),
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
(`CC0 | CC-BY | CC-BY-SA | OFL | PD | own | unknown`) and a credit.

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
For an explainer's presenter, `hdf stick --name sam [--build kid|adult|tall|round]
[--style line|tube]` makes a **stick puppet**: standard biped part names, three
views, a face (eye, pupil, brows, mouth 0..5), and `hdf retarget --clip me --to
sam --name walk` needs no map because its joints are the biped rig's.
For a character a child drew, print the **rig sheet** (`hdf hand --template
--rig biped > out/rig-sheet.pdf`), have them draw a piece in each box, and
`hdf sketch photo.jpg --sheet biped --name mia` makes a puppet with the same
biped names that walks from the vocabulary (details in references/assets.md).
To pose a stored puppet by hand, `hdf dev <film>` has a **Rig** tab (`R`):
drag its joints (IK on hands and feet), record a pose or a cycle's frames,
move a pivot a sketch got wrong or a socket; each edit is written back to the
store and the film reloads, so a pose the film names changes with no text
edit (references/assets.md, "The workbench").
Every biped shares a **pose vocabulary** (`packs/poses/biped.json`): the actor
drops what a puppet lacks (the fox has no forearms, the octopus no legs) and
tempers a pose until it fits the puppet's box, so `A.pose('cheer')` is safe on
any cast member. `hdf sheet store <id> --vocabulary` shows what applies before
you direct it.

`actorOf(puppet | cel | builder, spec)` makes a **cast member** every recipe
can direct. `CAST.FOX` and `CAST.HOG` (the hedgehog) are ready; a new puppet
is `actorOf(puppet('owl'), { height: 2.4 })`. An actor answers in **states**,
plain input objects a recipe merges and draws:

```js
A.idle(t, seed)            // breathing, a blink, a tail, on the twos
A.look(dir)                // -1 .. 1: facing, the view, the head turn
A.emote('happy')           // happy sad wide sleep worried surprised angry confused thinking laughing wink bored; its own pose of that name wins
A.pose('point-r', k)       // its own pose or the vocabulary's: idle stand point-l/-r wave think shrug cheer facepalm bow sit
                           //   kneel fall sleep look-up carry push write present hands-on-hips arms-crossed
A.cycle('run', t)          // its own cycle, else the vocabulary's (walk run jump breathe talk-hands); else a bob lint reports over 1 s
A.vocabulary               // { poses, cycles, expressions } that apply to this puppet
A.rest, A.variantKeys      // its inputs at rest; the inputs that switch drawings (eye, mouth) rather than turn
A.say('hello there', t0)   // a fragment: mouth per syllable, letters in a bubble, a pluck per syllable
A.place(x, y, s, state)    // the merged state on the doodle stage (centre x, y; feet at y + .86 s)
A.place(x, y, s, { ...state, shadow: true })   // with a contact shadow on its own floor
A.place(x, y, s, { ...state, reach: { 'hand-r': [px, py] } })   // a hand on a stage point (two-bone IK)
```

- **`actor:` on every recipe.** Doodle recipes AA to AM take `actor:`
  (default `HOG`); A, G, M, U, W, X and Z take it where a subject or figure
  is on screen; `book3` pieces take `{ base, h, actor, state }` and the actor
  turns with the page. `becomesVehicle({ photo: PHOTOS.violin, actor: FOX })`
  is the whole change from the hedgehog to the fox. On A, G, M, U, W, X, Z
  `h` sets the actor's drawn height (`h: 300`); without it a puppet is fitted
  by its rig box and reads small. On the teaching recipes AN to AX the actor
  is the teacher, not the subject: it stands at the side (`side`, `h`) and
  presents, points, cheers, thinks or shrugs from the biped vocabulary. AY
  (`dialogueShot`) stages two actors instead: `actor` on the left, `other` on
  the right.
- **Performance.** Direct an actor with a script, not a state per frame:
  `const act = perform(SAM, [[0, 'idle'], [0.5, 'point-r', { dur: 0.25,
  ease: 'out' }], [1.5, { head: 10 }], [2, ['cheer', 'happy'], { anticipate:
  0.15, overshoot: 0.1 }]])`, then `SAM.place(x, y, s, act.state(t))` and
  `act.events(shot.t0)` (a pluck as each pose lands). A name is a pose, an
  expression or a cycle (`'pose:sleep'` when it is several); a pose is the
  whole body, an expression the whole face, an object only its keys.
  `anticipate` is seconds winding a tenth of the change the other way,
  `overshoot` a fraction past the target, settled. The state is on the twos
  and quantised, so a held pose dedups. `layer(walk, SAM.pose('wave'), {
  parts: ['arm-r', 'fore-r'] })` adds a wave to a walk. Recipes A, G, M, U,
  W, X, Z take `perform:` (the performance, or its script) next to `actor:`.
- **Reach, look, walk.** `reach(SAM, 'hand-r', [x, y], { at: [ax, ay, s],
  state })` is two-bone IK (an arm bends `elbow: 'down'`, a leg `front`);
  `place(..., { ...state, reach: { 'hand-r': [x, y] } })` does the same.
  `lookAt(SAM, point | otherActor, { at, state, other })` turns the head and
  slides the pupils (and turns round a puppet facing away). `const w =
  walkTo(SAM, x0, x1, t0, t1, { s })` then `SAM.place(w.x(t), y, s,
  w.state(t))`: the planted foot holds still, `w.steps` are the footfalls.
  Never slide a walk cycle across at a steady speed: lint's `foot-slide`
  fails it. `stand(SAM, state)` keeps the feet on the ground line in any pose;
  `dialogue(..., { gaze: true })` has speakers look at each other.
- **Tails and scarves follow.** A part with `follow: { lag: 2, damp: 0.7 }`
  (SVG `data-follow`) lags its parent and swings past; `chain: { n: 4, len,
  w, angle }` (SVG `data-chain`, or a stick source's extra `parts: { scarf:
  { parent: 'neck', pivot: 'neck', chain, before: 'head' } }`) makes a rope
  of following links. They only move when the actor sees the history: pass
  the state *function* and the time, `SAM.place(x, y, s, act.state, t)` (or
  `SAM.follow(act.state, t)` for the state); a plain object draws them where
  it says. Recipes with `perform:` do this for you. The fox's tail follows.
- **Props in hand.** `const pot = attach(FOX, 'hand-r', node, { s, level:
  true, rot, tip })` then `FOX.place(x, y, s, { ...state, props: [pot] })`:
  it is drawn in the paw, turns and mirrors with it; `propAt(FOX, pot, [x, y,
  s], state)` is where its tip is (pour from the spout). The fox has a socket
  in each paw, a stick in each hand (a puppet's `sockets`, SVG `<circle
  id="socket:hand-r">`). `held(SAM, chalk, [x, y], { at, state })` puts the
  prop's tip on a point (reach for the tip); `writer(node, t, { ...sched, by:
  { actor: SAM, at, state, prop: attach(SAM, 'hand-r', heldTool({ tool:
  'chalk' })) } })` has the puppet write instead of a drawn hand. A stick's
  arm is short (about 0.3 of its height with the chalk): keep what it writes
  within reach, or walk it on (`walkTo`, half a stride lands on a contact).
- **Speech.** `const line = FOX.say('hello there', 1.25)` then `say: line`
  on AC (the only recipe with the option built in) or, in your own shot,
  spread `line.state(t)` into the state, draw `line.draw(t, x, y, s, state)`
  after the actor and add `line.events(shot.t0)` to the score. Spoken words
  count against the look's word allowance (doodle and cutout: 3; raise it
  for a talking shot with `withLook(look, { words: n })`). `say` takes
  several lines (`'\n'`, or wrapped at `width`), `kind: 'speech' |
  'thought' | 'shout' | 'whisper' | 'caption'` and `audience` (letter size,
  hold for the reading time).
- **Dialogue.** `dialogue([[FOX, 'line'], [SAM, 'line', { kind: 'shout',
  emote: 'wide' }], ...], { t0, where: { fox: [x, y, s], sam: [...] } })`:
  the turns are timed at a reading pace, each bubble stays up through the
  reply and keeps to its speaker's lane, and the listener turns to the
  speaker. In the shot, spread `talk.state(A, t)` into each actor's state,
  draw `talk.draw(t)` after them, and add `talk.events(shot.t0)` to the score
  (the fox and `sam` in `fox-and-teapot.js`, the talk shot).
- **Narration.** A recorded line is a wav in the store: `say -o line.wav
  --file-format=WAVE --data-format=LEI16@22050 "..."` (macOS), piper,
  edge-tts or the user's phone (`ffmpeg -i memo.m4a line.wav`); `hdf import
  line.wav --kind sample --name <id> --licence own`; name `<id>` in `assets`
  and add `voice('<id>', t)` to the score. The package never synthesises
  speech. The score ducks 9 dB under it; lint fails a line past the end.
- **Captions and voiced lines.** Put the copy on the sample (`--desc "..."`
  on import), then run `hdf align <id>`: it uses faster-whisper under
  `$HDF_PYTHON` if that is installed, and otherwise stores an estimate.
  `captions(id, { t0 })` letters the words as they are spoken, underlines
  the spoken word, and is drawn with `CAPS.draw(t, { W, H })` in the shot.
  With no recording, `captions(['line one', 'line two'], { t0, audience })`
  shows a page per string at the audience's reading pace.
  `FOX.say(null, t0, { voice: id })` speaks the recording: its letters
  follow the timing, and `line.events(t)` is the voice itself.
- **Sound effects and a bed.** `recipes/sfx.js`: `pop boing whoosh ding tada
  tick squeak flip erase pencilScratch chalkTap` are `(t, options) => events`.
  `hits(cues.cuts)` puts a whoosh on each cut; `writerSounds(node, { t0, tool,
  ...schedule })` gives a writing hand its tool on every unit it writes, with
  the same schedule as `writeOn`; `chalkTaps(node, { t0, ...schedule })` knocks
  the chalk on the board at every line it starts (`strokeStarts` has the
  times); `eraserSounds({ t, dur })` gives the eraser a
  scrub a row. `bed({ mood: 'bright' | 'calm' | 'mystery' | 'march', key,
  from, to })` is a chord loop whose bar is a whole number of twelfths (the
  tempo is snapped to it); `b.stop(t)` ends it and `b.sting(t)` closes it. It
  ducks under a voice with the rest of the score. For a quiz, use
  `quizTimes(o)` for `.options`, `.ticks` and `.ding`.
- **Lip sync.** A voiced say's mouth is the recording's own. By default it
  comes from the voice band's energy, one letter A to H or X per 1/12 s.
  `hdf align <id> --mouth` stores Rhubarb's track if `rhubarb` is on PATH,
  and otherwise stores the energy track. `actor.mouth(id, t, t0)` moves a
  mouth with no bubble; put `voice(id, t0)` in the score. A puppet that draws
  its own mouths names them `A` to `H`.
  Captions do not count as words. Lint warns `caption-sync` on an estimate
  over 3 s.
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
| whiteboard | `whiteboard` | marker | a classroom board: round-tip markers in black, blue, red, green (`inks.N`) draw every pen line, fills coloured in with marker passes, `fx('erase')` / `cut('erase', ...)` |
| chalkboard | `chalkboard` | chalk | green-black slate with a wooden ledge: chalk draws every pen line with dust off it, coloured chalks in `inks.1..3` and `accents`, fills rubbed in; `~ghost:0.15` keeps the last shot, half erased, under the next |
| crayon | `crayon` | wax | wax crayons on construction paper for the youngest (`audience: 'kids-5'` picks it): thick crayon draws every pen line with the paper's tooth through it, fills coloured in back and forth; `~sheet:sky` (cream pink mint butter lilac peach grey, a pastel or a colour) changes the sheet |
| notebook | `notebook` | felt | a ruled school notebook page (blue rules, a red margin, three punched holes): a narrow felt tip in navy, red, blue, green (`inks.N`) draws every pen line, fills coloured in with close felt lines; `coffeeRing`, `paperClip`, `stickyNote`, `marginDoodle` in the `margin()`; `cut('flip', ...)` turns the page |

`derive`, `duotone`, `pastel`, `withLook` make variants; `~hand:<id>` and
`~from:<id>` are the two modifiers. Palettes, finishes and riso plates are in
`references/looks.md`. The cut-out look reaches puppets in the finish pass:
the film changes nothing but `look` (and `paper: null` on doodle recipes, so
the card stock shows). So do the boards: `--look whiteboard` or `--look
chalkboard` restyles any film; each allows 12 words a shot, a lesson's title
and labels. `--look 'chalkboard~ghost:0.15'` (or `withLook('chalkboard', {
ghost: 0.15 })`) lays each shot over the one before it, wiped not quite clean.
`--look crayon` (or `'crayon~sheet:sky'`) redraws any film in wax crayon on
construction paper; it allows 6 words a shot, and a film with `audience:
'kids-5'` and no `look` gets it. `--look notebook` puts any film on a page of
a school notebook (12 words a shot); `seq(a, cut('flip', 0.5, a, b), b)` turns
the page to the next shot, `hits(cues.cuts, { kind: 'flip' })` its sound.
To have a drawn hand write something (4.0 T6), give the same node to
`writeOn(node, { t, at, per: 'word', wps: 2 })` and, drawn after it,
`writer(node, t, { same options, look })`: the hand holds the look's tool
(`toolFor`: a marker on the whiteboard, chalk on the chalkboard, a crayon in crayon), comes in, lifts between words and
leaves. `penAt(p, node)` is the tip at any reveal progress.
To mark something up (4.0 T7), `core/marks.js` has `underline`,
`circleAround`, `arrowTo`, `highlight`, `strike`, `bracket`, `starburst`,
`callout`, `tickMark`, `crossMark` and `question`. Each takes a box, a point or
a group with a `.box`, and `wordBox(g, 'word')` gives one word of lettering.
Each draws on with `p` or joins a `writeOn` card: give the marks orders past
the lettering's (1e6, 2e6, ...) and they come in turn. Marks are not words.
For numbers (4.0 T8), `core/maths.js` has `fraction(a, b)`,
`equation('2 + 3 = ?', { answer, p })` (spaced as a teacher writes it; the ?
is a drawn mark and gives way to the answer as p passes 0.5), `tally(n)` (a
fractional n draws the last mark part way), `numberAxis(a, b, { at })` (the
line alone; the AT recipe `numberLine` hops along one), `clock(h, m)`,
`dice(n)`, `coins(n)`, `pictograph(n, cel)` and `countOn(n, t, { per, at })`,
with `countTimes` to put the objects on the same beat. Each is built round
`{ x, y }` with a `.box` and draws on (or pops in) with `p`. Labels round a
circle: `textRound(str, { x, y, r, at, side })`, upright all the way round.
Several lettered pieces in one `writeOn` write at once unless each has its own
`order` range (`order: i * 1000`): lettering numbers its strokes from 0.

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

A hand is a store asset: up to 104 glyphs and 14 accent marks plus a pen
profile (wobble, overshoot, hook, pressure, speed). `look.hand` is the house
hand unless a look says `~hand:<id>`; then every `handText`, sign-off, doodle
reveal and pen stroke of the film is in that hand (hatching and ruled lines
stay). Accented letters (Romanian, French, German, Spanish, Polish, Czech,
Nordic, Turkish: all of Latin-1 and Latin Extended-A) are composed from the
hand's base letter and a mark, so copy can be written as the brief spells it.

```bash
hdf hand --template > out/hand-template.pdf      # three pages, A4 (--paper letter); print them
#   page latin: 62 boxes on the baseline in their own pen, then the last row: three lines left to
#   right, a circle, a square, a zigzag, a long S; page symbols: 32 boxes of punctuation and signs
#   (' " : ; ( ) [ ] / + = % ° × ÷ → ← ↑ ↓ ~ * _ # @ $ € ...); page marks: the 14 accents alone and
#   ß ð þ Þ ŋ Ŋ ĸ ſ « » (skip it and the house's accents stand in); each photographed flat, corner marks in
hdf hand latin.jpg symbols.jpg marks.jpg --name narcis   # traces every glyph and mark, fits the pen; out/hand-narcis-trace*.jpg
hdf sheet --hand narcis                          # house | narcis, every glyph (house fallbacks marked), pangrams
hdf render work/<film>/<film>.js --look 'doodlePastel~hand:narcis'      # or pin it in film({ look })
```

Look at the trace page once: red traces over the straightened photo. A box
the trace missed falls back to the house glyph and is listed; lint
`hand-missing` fails a sign-off that falls back. `--thr` adjusts the ink
threshold on a dim photo. `hdf hand --synth <id>` makes a deterministic hand
from the house one (`test` is in the store) for checks before the sheet
comes back. A film that pins a hand names it in `assets:`.

**Cyrillic, Greek, a script: Hershey hands.** The store has three Hershey
fonts as hands, public domain: `hershey-romans` (a plain single-stroke
roman), `hershey-script` (joined cursive) and `hershey-cyrillic` (the whole
Russian alphabet, serif). A brief in Russian letters through
`--look 'paperInk~hand:hershey-cyrillic'`. Ё and Й are that hand's Е and И
with the house's umlaut and breve. It has no Latin letters of its own, so
English copy in that look is lettered by the house hand. The rest of the
Hershey set (Greek, Gothic, italics, duplex romans) is at
github.com/kamalmostafa/hershey-fonts (`hershey-fonts/*.jhf`):

```bash
hdf hand --hershey greeks.jhf --name hershey-greek          # --map ascii | greek | cyrillic when the name does not say
hdf hand --hershey assets/src/hershey/romans.jhf --merge hershey-cyrillic --name ru-en   # Latin added, its own glyphs kept
```

Lint `hand-missing` also fails a sign-off with letters no glyph draws, which
letter as `?` (Cyrillic in a Latin hand or in the house's).

**Any font: `hdf hand --font`.** The user's favourite font, still drawn by
the pen: every glyph the font has is traced to its centre lines (serifs
pruned) and lettered with the look's wobble. Diacritics, Cyrillic and Greek
come with it when the font has them. Say the licence (free fonts are usually
`OFL`); a hand left `unknown` fails lint `credit` in any film that uses it.

```bash
hdf hand --font ~/Library/Fonts/Nunito-Regular.ttf --name nunito --licence OFL      # every set the font has
hdf hand --font JetBrainsMono-Bold.ttf --glyphs cyrillic,symbols --name mono-ru --licence OFL
```

Look at the sheet it draws (`assets/sheets/<id>.jpg`) before using it. The
report lists glyphs whose stroke count is far off the house's: a serif that
stayed as a spur, a bar lost. A heavy serif face (Georgia, Times) keeps some
slab serifs; a plain sans traces cleanest.

## Motion: retargeting and the phone

```bash
hdf clip --store horse --rig quadruped                                    # a skeleton per frame, once
hdf retarget --clip horse --to fox --map horse-fox.json --name gallop     # maps in assets/src/
hdf sheet store fox --cycle gallop                                        # the strip: is it the horse?
ffmpeg -i me.mov -vf fps=30 work/me/%04d.png
hdf clip --kind pose work/me --name me                                    # MediaPipe (python); says what to install
hdf retarget --clip me --to fox --map biped-fox.json --name walk          # the fox walks like the user
hdf clip --kind face work/talk --name me-face                             # the user's face: a track (K7)
hdf clip --kind hands work/talk --name me-hands                           # their hands: finger curls
```

A map names which puppet part follows which skeleton chain (`assets/src/
horse-fox.json`, `biped-fox.json`); the cycle carries a `lift` per frame so
the feet meet the ground where the hooves did. `fox.cycle('gallop', t)` and
`fox.liftOf('gallop', t)` read it; the actor's stage rises by it. The
package's fox keeps its hand-authored walk until someone films theirs.

A pose clip keeps its stride (`advance`, from the planted foot); retarget
scales it by leg length onto the cycle and prints what the puppet's feet make
of it. `walkTo` stays planted either way. A face track drives a face:
`SAM.place(x, y, s, { ...state, ...SAM.face('me-face', t, t0) })` sets mouth,
eyes, brows and pupils from the user's (score the same recording with
`voice(id, t0)`); `SAM.hands('me-hands', t, t0)` picks open, fist, point or
thumb for a stick made with `hdf stick --hands fingers`. The picture's left
drives the drawing's left; a mirrored selfie wants `{ mirror: true }`.

## davidup

A film becomes an ordinary davidup video asset; a puppet's model sheet an
image asset. Run from the repo root:

```bash
bun run scripts/hdf-to-davidup.ts fox-and-teapot --project <dir|name> [--look risoPop] [--dry-run]
bun run scripts/davidup-hdf-clip.ts <project>/composition.json <video-item-id> [--film <film>] [--alpha [mov|webm]]
bun run scripts/hdf-to-davidup.ts walk-on --project <dir> --sprites [sam] [--states idle,walk,happy] [--no-video]
bun run scripts/hdf-to-davidup.ts <film> --project <dir> --fonts [narcis,house] [--no-video] [--no-sheets]
```

The first renders and registers `hdf-<film>` (video) and `hdf-<puppet>-model`
(image) into `<project>/assets/hdf/`; the second renders the film a video
item names (`"name": "hdf:<film>"`) and points its asset at the mp4. Both
take `--frames N` for a quick first cut, and re-running replaces in place.

**An overlay.** `--alpha` draws the film on no stock and keeps the
transparency (ProRes 4444 `.mov`; `--alpha webm` is VP9, which the editor's
browser preview also plays), so a character stands over a davidup photo or
video with the picture all round it. Write the clip as a clip: one character,
no backdrop fill, a soft `shade` shadow at alpha 0.3 if it stands on
anything, and `meta('intent', 'clip')` in its last frame instead of a
sign-off (the composition signs off). Washes bring their paper with them, so
a doodle body stays opaque, with a thin paper edge like a sticker.
`handdrawn/films/fox-wave.js` is the pattern; `examples/hdf-overlay/` puts it
over a slideshow of photos.

**A sprite.** When davidup lays out the scene and the character only has to
walk, stand and react, `hdf sprite <puppet|stick:sam> --states idle,walk,happy
--alpha` draws its states as one sheet (a cycle one loop, a pose or
expression one held frame) and a JSON; `--sprites` on `hdf-to-davidup.ts`
registers each cast member (store puppets, and the film module's
`export const cast = { sam: SAM }`) as an image with that `sheet`. In davidup
the sprite plays a state by name (`add_sprite` with `cycle: "walk"`), stands
on its feet with the sheet's `anchor` as anchorX/anchorY, and crosses the
stage by an `x` tween at the cycle's `speed`; a second sprite on the sheet
takes over (`exit` / `enter`) to stop and be happy.
`examples/hdf-sprite/agent.mjs` is the pattern. A performance (reach, look
at, lip sync) stays a film.

**A title in the hand.** When davidup sets the words (a title card, lower
thirds, captions in a composition), `hdf hand --export-ttf <id>` writes the
hand as `out/<id>.ttf`, its strokes swept by the pen, and `--fonts` on
`hdf-to-davidup.ts` registers the film's hand (or the ones named) as
`hdf-<id>-font`; `add_text` with that `font` letters in the same hand as the
film. Look at `out/<id>-ttf.png` (the font above the lettering) first. The font
is still: no wobble, no draw-on. Words that write themselves stay a film.
`examples/hdf-font/agent.mjs` is the pattern.

**Cut to the music.** When the film plays in a davidup composition with a
beat, cut it to the composition instead of guessing times: in the film,
`const beats = marksNamed('beat', { or: [...] })` and `const drop =
atMark('drop', { or: 4.75 })` (grid-snapped seconds; `or` is the fallback the
film renders with on its own, so lint and goldens work), and build shot
durations as differences of those times; `perform` entries and `score({ marks })`
read them too. The composition's audio track carries the beats as `markers`
(`[{ t, name }]`, seconds into the music). `davidup-hdf-clip.ts` renders with
`--cues-from <composition.json> --at <item>` and writes the film's chapters
back as composition markers; `hdf cues <film>` prints the cue file.
`handdrawn/films/on-beat.js` and `examples/hdf-cues/build.mjs` are the pattern.

**From an agent, in one call.** Inside a davidup MCP session the scripts are
one tool: `render_hdf_clip { film, look, ar, width, frames, alpha, place |
item, cues, sprites, states, video }` renders the film, registers the clip
(`hdf-<film>`, replaced on a re-run) and with `place` adds the video item
(named `hdf:<film>`, sound kept when the film has a score) or with `item`
points an existing one at it; a placed clip is cut to the composition's marks
and its chapters come back as markers, as with `davidup-hdf-clip.ts`;
`sprites: true` registers the cast's sheets. It blocks while hdf renders, so
try things with `frames` and a small `width`.
`list_engine_capabilities.handdrawn.films` names the films it can render.
`examples/hdf-clip/agent.mjs` is the pattern.

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
   `out/<film>-board.jpg`, one card per shot (per chapter in a lesson;
   `--chapter n` for that chapter's shots). **Look once.**
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
`--alpha [mov|webm]` draws on no stock (`paper()` and `night()` draw
nothing; the `paper` role keeps its colour) to `<film>-alpha.mov` or
`.webm`, the contact sheet on a checkerboard; `--look 'x~alpha'` is the same
look for `only`, `grid` or the player.

## What lint checks, and what it cannot

Lint (`core/lint.js`) fails on: colours that are not roles; a shot not
starting on paper, night or a backdrop; two finishes or a look op in a shot;
a missing anchor; more than two scribbled parts; a cel drawing outside its
box; words beyond the look's allowance (0; doodle and cutout 3, spoken words
included; `look.words` to change it); a cut over 1 s or two cuts in a row;
no sign-off, or one still writing 1.5 s before the end (a clip, with
`meta('intent', 'clip')` in its last frame, needs none); an anchor under
24 px at 240 px wide, or cut by the frame edge without `meta('intent',
'crop')`; cues off the 1/12 s grid; `Math.random`, `Date`, filters,
`shadowBlur` or gradients in the source. From 3.0: a recipe asking an actor
for a cycle it lacks with the fallback bob on screen over 1 s
(`actor-cycle`); a walking actor whose planted ankle drifts over 2 units a
frame (`foot-slide`, 4.0 K5); a look naming a hand the store lacks, or a
sign-off falling back to the house hand for a glyph (`hand-missing`); a
puppet joint off the 2° grid or out of range, or a pose naming no part
(`puppet-joint`); a raw colour inside an imported puppet (`roles-raw`); an
asset carried as a data URL (`inline-asset`, a warning); a pack cel whose store mirror is stale
(`pack-mirror`, on `hdf lint packs/<pack>.js`). `hdf import` and `hdf svg`
run `cel-box`, `puppet-joint` and `roles-raw` over every pose and variant
before anything is written.

**Length.** A film is 10 to 40 s. A lesson runs up to 180 s, cut into
chapters of 20 to 40 s: `chapter({ title, sub, actor, audience }, ...nodes)`
(from `recipes/shots.js`) is a seq that opens on a title card (AN, its words
not counted against the look) and ends on a hold (the audience's dwell, at
least its cut floor; `hold: 0` for none; `card: false` or a node of your
own). The board gives a card per chapter; `hdf grid --chapter n` and `hdf
render --chapter n` work on one chapter at a time (out/<film>-ch<n>.*, its
frames the whole film's and its sound the whole score's under it), so a
fix to chapter 3 is looked at and rendered in seconds; lint ends with a line
per chapter and warns (`length`) on a chapter over 40 s or a long film with
none. The score's cues carry `chapters: [{ n, title, t0, dur }]`.

For a lesson, name the audience on the film: `film({ ..., audience:
'kids-7' })` (general, beginner, kids-9, kids-7, kids-5; 4.0 T10). Lint then
checks that profile: words a shot (it replaces the look's allowance;
`look.words` still wins), lettering whose x-height at 240 px is too small
(`text-size`), text up for less than its words need (`text-dwell`; a
recording's captions and the sign-off exempt), text too faint on what it sits
on for as long as it needs reading (`text-contrast`), two pieces of text
crossing (`caption-overlap`) and shots under the floor (`cut-floor`). Build
the recipes, `say`, `dialogue` and `captions` with the same `audience:` and
they pass. `hdf lint <film> --audience kids-5` tries another profile without
editing the film. `general` asks what lint always asked.

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
  above the head and never covers the object; one line a shot, or a
  `dialogue` whose bubbles lean towards each other without crossing.
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
- `hdf clip --kind pose | face | hands` needs MediaPipe in a python (`HDF_PYTHON=<venv>/bin/python`)
  (face and hands also a model file in `handdrawn/.cache/`, as `cli/track.py --help` says);
  the command prints the install line when it is missing. Landmarks already
  found (`out/pose-<id>.json`, `out/face-<id>.json`, `out/hands-<id>.json`) need no python.

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

# hand-drawn film 4.0: cartoons that teach

A plan for the next version of the `handdrawn` package and the
`hand-drawn-film` skill: explainers for beginners and children, characters
with skeletons that perform, text that teaches, a voice, and a tighter meeting
with davidup. Written 2026-09-21 against 3.0 (commit `e8f4df1`, 221 tests, all
seventeen v3 sessions done, the twelve rough edges closed). Nothing here is
built.

Same shape as `hand-drawn-film-v3-ideas-plan.md`: one session per block, a
done-when, one commit `hdf: <id> <title>`, `npm test` green, goldens holding
for every film a session does not name, `node cli/apidoc.mjs` when the API
moves.

---

## 0. The verdict

**Doable: yes.** The substrate is the right one and none of it has to change:
frames are pure functions of data, drawings carry roles not colours, motion
sits on a 1/12 s grid, the store gives every asset provenance, the actor
contract lets thirteen recipes direct any cast member, and a person's
handwriting is a look field. Explainers add vocabulary on top of that, they do
not fight it. Lint before pixels is worth more for teaching than for art:
"can a seven-year-old read this in the time it is on screen" is a rule over a
list, not a taste.

**Recommended: yes, with one thesis and one discipline.**

The thesis: *an explainer is a character who talks, text that teaches, and a
diagram that draws itself, all in one hand.* Every session below serves one of
those four (character, text, voice, diagram) or the meeting with davidup.
Anything else waits.

The discipline: the two branches stay two branches. `handdrawn` is
imperative and owns *drawing*: characters, lettering, per-frame performance,
diagrams that construct themselves. `davidup` is declarative and owns
*assembly*: media, layout across assets, timing across tracks, the editor, the
MCP surface. They meet through assets that flow both ways (video with alpha,
sprite sheets, fonts, cue files), never through a new davidup item kind (the
memory note on what an item kind costs still holds) and never through a second
timeline editor inside the player.

What 3.0 lacks for the thesis is exactly the explainer's vocabulary, and it
is listed in section 1. The largest single gap is letters: the hand font has
68 glyphs. The second is a humanoid: there is no biped in the cast, and joints
only rotate. The third is a voice: the score is a synth and there is no way to
put a recorded line under a shot. Those three are the spine of the plan.

---

## 1. Where 3.0 stops (audit)

Each row is a fact of the code today, with where to look.

| area | today | consequence for an explainer |
|---|---|---|
| glyph set | `core/glyphs.js`: a–z, A–Z, 0–9, `. , - ! ? &`, space | no apostrophe, colon, quotes, brackets, `% + = / °`; no diacritics (ă â î ș ț, é ü ñ); no Cyrillic or Greek, though the skill triggers on Russian briefs |
| text layout | `core/text.js`: one line, `align` only; `measure` is advance width; bounds are a 0.55 em estimate (README §15) | no wrap, no multi-line, no box, no columns or lists, no text on a path; `cel-box` lint misjudges lettered cels |
| word allowance | `core/lint.js:41-48`: 0 words by default, 3 for doodle and cut-out | right for a 20 s film, wrong for a lesson: labels, titles and captions fail lint |
| reveal | `core/tools.js reveal/trim`: stroke order only | no per-word or per-line schedule tied to reading speed; nothing knows where the pen tip is, so no drawn hand can write |
| speech | `core/text.js speech`, `core/actor.js speak`: a fixed viseme cycle 0-2-3-1 per syllable on the grid, one-line bubble | no recorded voice, no captions, no thought or shout bubbles, no dialogue between two actors |
| puppet joints | `core/puppet.js partGroup`: `xf = translate(pivot) · rotate(angle)` | parts cannot slide (pupils, brows, a drawer) or scale (squash and stretch, breathing) |
| poses | `poseOf`: linear from `rest` to one pose; cycles are frame lists; a state merge is override, not additive | no pose-to-pose timeline with easing, holds, anticipation; no "walk plus wave" |
| IK | `actor.js place`: `hand: [x, y]` aims one single-segment arm | no two-bone reach, no look-at, no foot planting; a cycle played across the stage slides its feet (`core/pose.js` drops the hip's x, so no stride is known) |
| rigs | `core/rig.js`: quadruped and biped chains, no hands, no face; `cli/pose.py`: pose landmarks only | no face capture (blink, brows, mouth), no finger poses |
| cast | fox, hedgehog, octopus (user's), pack creatures; `EMOTES` has four faces | no humanoid, no stickman, no brows or pupils, no standard biped part names a vocabulary could key on |
| sound | `core/synth.js` + `recipes/score.js`: generated motifs only | no narration wav, no sound effects (pop, boing, ding), no ducking |
| output | `cli/ffmpeg.mjs` takes RGBA frames but encodes opaque h264; `paper()` always draws | no transparent render, so a character cannot sit over a davidup scene |
| davidup bridge | S16: mp4 + model-sheet jpg registered as assets | no alpha, no sprites, no fonts, no cues in either direction |
| length | the norm is 10 to 40 s; `hdf grid --n 24` and the board assume it | explainers run 60 to 180 s and want chapters |
| unbuilt v3 | Q3 sketch import, Q7 workbench | a drawing on paper cannot become a puppet; poses are typed as numbers |

---

## 2. Fixed decisions (so sessions do not re-derive them)

- **Everything stays data.** Strokes stay geometry drawn by the tools; no
  raster brushes, no host fonts at render time. A font that comes in becomes
  a *hand* in the store, once, and is drawn by the pen like any hand.
- **The hand record is the one text primitive.** Hershey files, TTFs and
  photographed sheets all produce hand records (`kind: 'hand'`). A film names
  hands; the look picks one with `~hand:<id>`. Glyphs missing from a hand fall
  back per glyph, as today.
- **Composed glyphs** (base + mark) live in `core/glyphs.js` as one table and
  apply to every hand, so a photographed hand never needs `ă` drawn: it needs
  `a` and a breve.
- **Puppet part inputs** beyond rotation (`slide`, `scale`) are declared in the
  payload and quantised on a step like joints, so hashing, dedup, sheets and
  lint work unchanged. A **stick puppet** is a payload with `bones`; `puppet()`
  compiles it to ordinary parts, so nothing downstream learns a new kind.
- **Standard biped part names**: `head, neck, body, hips, arm-l, arm-r
  (upper), fore-l, fore-r, hand-l, hand-r, leg-l, leg-r (thigh), shin-l,
  shin-r, foot-l, foot-r, eye, pupil, brow-l, brow-r, mouth, tail`. A
  vocabulary of poses keyed on these lives in `packs/poses/biped.json`; the
  actor's `known()` drops what a puppet lacks, so the fox (single-segment
  arms) takes the subset. Stick joints use the same names as `core/rig.js`'s
  biped rig, so a pose clip *is* a stick cycle with no map.
- **Audio** is store assets (`kind: 'sample'`, which exists). Word and mouth
  timing is stored on the sample's catalogue entry: an estimate by default
  (the `speech()` grid stretched to the sample's voiced length), refined by an
  external tool when one is on PATH (`whisper`, `rhubarb`), never needed at
  render time.
- **Alpha**: `--alpha` draws no stock and encodes ProRes 4444 (`.mov`) or VP9
  (`.webm`), the codecs davidup's own alpha export uses. Goldens already hash
  RGBA.
- **Audience profiles**: `film({ audience })` with `general` (today's numbers,
  the default, so every golden holds), `beginner`, `kids-9`, `kids-5`. They
  set lint allowances (words, text size, dwell, cut floor) and recipe
  defaults (sizes, speeds).
- **davidup**: bridges are `scripts/*.ts` plus one MCP tool. No item kind.
- **Recipe letters** AN–AZ are the teaching recipes.

---

## 3. Text (T)

### T1. Punctuation and symbols

*The house hand can write a sentence.*

- `core/glyphs.js`: `' " : ; ( ) [ ] / + = % ° × ÷ → ← ↑ ↓ ~ * _ # @ $ €`,
  drawn in the house style (single stroke, the arc/line/spline helpers).
- `cli/hand.mjs --template --pages latin,symbols`: a second sheet page with
  those boxes, same corner marks, so a photographed hand carries its own.
  `core/handsheet.js` takes a page list; the reader labels boxes by page.
- `hdf hand --synth test` regenerates the test hand with the new glyphs
  (its golden is keyed by look, `mini-paperInk~hand:test.json`; rewrite it).

Done when: `handText("it's 3 + 4 = 7 (yes!)", ...)` letters every character,
the template prints two pages, and `mini`'s default golden holds.

### T2. Composed glyphs: diacritics

*Romanian, French, German, Spanish, Polish, Czech, Nordic, Turkish, without
drawing a letter twice.*

- `core/glyphs.js`: `MARKS` (acute, grave, circumflex, umlaut, tilde, breve,
  caron, ring, cedilla, comma-below, ogonek, stroke, macron, dot-above) as
  strokes in em units, and `COMPOSE = { 'ă': ['a', 'breve'], 'ș': ['s',
  'comma-below'], 'ł': ['l', 'stroke'], ... }` covering Latin-1 and Latin
  Extended-A. A mark sits above the base's ink top (x-height or cap height,
  measured from the glyph, not assumed) or below its baseline, centred on the
  base's advance; `ł` and `ø` strike through.
- `glyph(ch, H)` composes when `H` lacks `ch` and `COMPOSE` has it; a hand
  may still draw the whole letter itself. The mark strokes come from the hand
  when it has them (template page `marks`, 14 boxes), else the house.
- `measure` and `handText` need no change: a composed glyph is `{ w, s }`.

Done when: a Romanian sign-off ("mulțumesc", "pa") letters in the house hand
and in `test`, and a hand photographed with the marks page uses its own marks.

### T3. Hershey fonts as hands

*Cyrillic, Greek, and five stroke styles in one afternoon, free.*

- `cli/hand.mjs --hershey <file.jhf> --name <id> [--map romans|greeks|cyrillic|...]`:
  parse the JHF format (one glyph per line, coordinates as letter pairs about
  `R`), map glyph numbers to Unicode through the standard mapping tables,
  scale the 32-unit em to the 100-unit house em, order strokes as the file
  does, write a hand record with `credit` carrying the Hershey notice and
  `licence: 'PD'`.
- Vendor three under `assets/src/hershey/` (`romans` simplex, `scripts`,
  `cyrillic`) and import them at `npm test` time into a temp store for the
  tests; the skill names the URL for the rest.
- A hand may hold several scripts: `--merge <id>` adds a file's glyphs to an
  existing hand (Latin from one, Cyrillic from another).

Done when: `hdf render films/mini.js --look 'paperInk~hand:hershey-script'`
letters in script, and a Cyrillic sign-off renders through `hershey-cyrillic`.

### T4. Any font as a hand

*The user's favourite font, still drawn by the pen. Diacritics, Cyrillic and
Greek for free when the font has them.*

- `cli/hand.mjs --font <file.ttf|otf> --name <id> [--glyphs latin,cyrillic,greek,symbols] [--px 400]`:
  load the file with skia-canvas's `FontLibrary.use`, draw each glyph black
  on white at 400 px through `cli/skia.mjs` (CPU), threshold, and run
  `core/skeleton.js` (Zhang-Suen, whisker pruning, the distance transform for
  widths, `trace`), exactly the sheet reader's path without the photo.
  Scale to the em by the font's own metrics (x-height from `x`, cap height
  from `H`), keep the width profile as `pressure`, order strokes longest
  first. `wobble` and `hook` are 0 (it is a font); the look's pen adds its own.
- `--licence` is required for anything but `unknown`; lint `credit` reports
  a rendered `unknown` hand as it does an asset.
- Serifs skeletonise as spurs: prune by width ratio, and print the glyphs
  whose stroke count differs from the house glyph's by more than two, so the
  author can eyeball the sheet (`hdf sheet store <id>` already draws a hand).

Done when: a hand made from a font on this Mac letters `mini` in that face
with the pen's wobble, and a Cyrillic string renders through a font that has
it.

### T5. Layout: boxes, wrapping, lines, lists

*Copy flows into a box and the box is known.*

- `core/text.js`: `layout(str, { size, w, lineH, wrap: 'word', maxLines,
  align, valign, hand })` → `{ lines: [{ str, x, y, w }], box }` from real
  glyph advances and ink bounds (no more 0.55 em); `textBox(str, box, o)` →
  a group of `handText` lines with `.box` set, `\n` honoured; `bullets(items,
  box, { marker: 'dot' | 'dash' | 'number' | 'check' })`.
- `text()` op gains `w` (wrap width) and multi-line strings; expansion goes
  through `layout`, so the raster learns nothing.
- `list.js bounds` for a text op uses `layout`'s box (this can move `cel-box`
  findings, never pixels; run every film through lint and fix what it names).
- `measureBox(str, size, { w })` exported; the player shows a text op's box.

Done when: a paragraph wraps into a box in every hand, bullets number
themselves, and every film's goldens hold.

### T6. Reveal schedules, the pen tip, a hand that writes

*The whiteboard idiom: a drawn hand writes the words at reading speed.*

- `writeOn(node, { t, per: 'glyph' | 'word' | 'line' | 'stroke', wps, lead })`:
  a node's reveal as a function of shot time at a reading speed (words per
  second, from the audience profile), returning what `reveal(p, node)`
  returns; `revealed(node, t)` reports the progress for lint's dwell rule.
- `penAt(p, node)` in `core/tools.js`: the tip point and direction at progress
  `p`, from `trim`'s arithmetic; between strokes the pen is "up" (a lift).
- `packs/hands.js`: `writingHand({ tool: 'pen' | 'marker' | 'chalk' | 'crayon',
  side: 'r' | 'l', skin })` a cel of a hand holding that tool, drawn from a
  three-quarter-above angle; `writer(node, t, o)` places it at `penAt`,
  lifted between strokes, hidden after the last, so any lettering or diagram
  can be "written by hand".
- `fx('erase', box, kids)`: a smeared wipe (for whiteboard and chalkboard).

Done when: a caption writes itself with a hand at 2 words a second in
`whiteboard` (L1) and the hand lifts between words.

### T7. Emphasis marks

*The teacher's pen.*

- `core/marks.js`: `underline(target, p)`, `circleAround(target, p)`,
  `arrowTo(from, to, { curve, head, p })`, `highlight(box)` (a marker band
  behind, multiply), `strike(target, p)`, `bracket(box, side)`, `starburst(at)`,
  `callout(str, at, { leader, box })`, `tick(at)`, `cross(at)` (exists),
  `question(at, s)` a big drawn `?`. `target` is a box or a text group (its
  `.box` from T5). All are pen strokes that draw on with `p`, seeded by name.
- `hdf lint`: emphasis marks are not words.

Done when: a labelled sentence gets an underline, a circle and an arrow, each
drawing on in turn, in the sign-off's hand.

### T8. Text on a path, numbers

*Names around a circle, a river's label along the river, and arithmetic.*

- `textOnPath(str, path, { size, offset, align })`: each glyph placed by arc
  length along a polyline with the local tangent; labels round `cycleDiagram`
  (E3) and along `mapRoute` (E4).
- `core/maths.js`: `fraction(a, b)`, `equation('2 + 3 = ?', { answer: 5, p })`
  (spacing rules, the `?` resolves as `p` passes 0.5), `tally(n)`,
  `numberLine(a, b, { marks, at })`, `clock(h, m)`, `dice(n)`, `coins(n)`,
  `pictograph(n, cel)`. Digits count on: `countOn(n, t, { per })` writes each
  number as its object appears.

Done when: "2 + 3 = ?" resolves to 5 as five apples appear with a tally, and
the months letter round a ring.

### T9. Speech, bubbles, dialogue

*Two characters talk.*

- `core/marks.js bubble` gains `kind: 'speech' | 'thought' | 'shout' |
  'whisper' | 'caption'` (cloud, spiky, dashed, a plain strip) and sizes
  itself from T5's box, so a line wraps inside.
- `actor.say` takes multi-line text, `kind`, and `voice: <sample id>` (V2) for
  its timing; `hold` defaults from the audience's reading speed.
- `dialogue([[A, 'line'], [B, 'line', { kind: 'shout' }], ...], { t0, gap })` →
  a fragment: turns scheduled with reading-time gaps, each speaker's `say`,
  the other's `lookAt` (K5) or `look(dir)`, and the events; a recipe spreads
  it like `say`.
- `captions(lines | sampleId, { style })`: a strip at the bottom in the
  audience's size, the current word underlined (V2 makes it follow a voice).

Done when: the fox and a stick teacher exchange four lines in `fox-and-teapot`
(new shot, golden rewritten), the bubbles facing each other.

### T10. Legibility lint and audience profiles

*What lint can now say about teaching.*

- `film({ audience })` and `core/audience.js`: `{ words, minX (x-height at
  240 px), dwell (s per word), cutFloor, wps }` per profile; `general` is
  today's numbers.
- Rules in `core/lint.js`: `text-size` (an x-height under `minX`),
  `text-dwell` (words on screen shorter than `dwell × words`, using
  `revealed()`), `text-contrast` (a text role on a fill role the look
  resolves to under 4.5:1; the look's own maths), `caption-overlap` (two text
  boxes intersecting), and `words` reads the profile.
- `hdf lint --audience kids-5` overrides a film's profile for a check.

Done when: a caption that flashes for 0.3 s fails `text-dwell` under `kids-7`
and passes under `general`; every film passes at its own profile.

---

## 4. Skeletons and stickmen (K)

### K1. Part inputs: slide and scale

*Pupils that look, brows that rise, a body that squashes.*

- Payload: `parts.<n>.slide: { x: [min, max, step], y: [...] }` and
  `parts.<n>.scale: { x: [...], y: [...], keepArea: true }` declare inputs
  `<n>.x`, `<n>.y`, `<n>.sx`, `<n>.sy`; `partGroup` builds
  `translate(pivot) · translate(dx, dy) · rotate(a) · scale(sx, sy)`; a part
  with `keepArea` and one scale input gets the other as its inverse.
- SVG conventions (`core/svg.js`): `data-slide="x:-6..6:1,y:-4..4:1"`,
  `data-scale="y:0.8..1.2:0.05"`.
- Lint `puppet-joint` covers the new inputs' ranges and steps; sheets show a
  slide part at its extremes.
- The fox gets `pupil` (slide) and `brow-l`, `brow-r` (rotate + slide) in
  `assets/src/fox.svg`; `EMOTES` uses them. Goldens that show the fox move
  (fox-and-teapot, cutout-fox): rewrite.

Done when: `FOX({ 'pupil.x': 4, 'brow-l': -12 })` looks left and worried, and
the walk strip is unchanged for a puppet without the new inputs.

### K2. Stick puppets

*The explainer's first citizen: a stickman that is its own rig.*

- Payload `{ kind: 'stick', units, joints: { hip, chest, neck, head,
  shoulder-l, elbow-l, wrist-l, ..., knee-l, ankle-l, toe-l }, bones:
  [['hip', 'chest', w], ...], head: { r, face }, hands: 'dots' | 'mitts',
  style: 'line' | 'tube' }`. `puppet()` compiles it: a bone is a part with
  its pivot at the proximal joint and one stroke to the distal joint (taper
  from the pen), parents from the bone graph rooted at `hip`, painter order
  far limbs → body → near limbs, face prints on the head (eyes, `pupil`
  slide, `brow-l/r`, `mouth` variants 0..5). Views `side`, `three-quarter`,
  `front` are generated from the joint layout (front: legs side by side).
  The part names are the standard biped names.
- `hdf stick --name sam [--h 300] [--build kid|adult|tall|round] [--style tube] [--face]`
  writes `assets/src/sam.stick.json` and imports it.
- `hdf retarget --clip me --to sam` needs no map: the stick's joints are the
  biped rig's, so `retarget` derives the chains itself.

Done when: `hdf stick --name sam && hdf sheet store sam --cycle walk` shows
the turnaround and the walk after a phone clip is retargeted with no map.

### K3. The pose vocabulary

*Every biped knows how to point, shrug and cheer.*

- `packs/poses/biped.json`: poses `idle, stand, point-l, point-r, wave,
  think, shrug, cheer, facepalm, bow, sit, kneel, fall, sleep, look-up,
  carry, push, write, present, hands-on-hips, arms-crossed`; cycles `walk
  (8), run (6), jump (6), breathe (4), talk-hands (6)`; expressions `happy,
  sad, wide, sleep, surprised, angry, confused, thinking, laughing, worried,
  wink, bored` on brows, pupils, eyes and mouth. Joint values on the 2° grid.
- `core/actor.js`: `actor.pose(name, k)` and `emote` fall back to the
  vocabulary after the puppet's own, through `known()`; `actor.vocabulary`
  lists what applies to this puppet. `EMOTES` moves into the file.
- `hdf sheet store <id> --vocabulary` draws the poses that apply.

Done when: `sam`, the fox and the octopus each draw `cheer` and `confused`
with what they have, and `hedgehog` (a builder) is unchanged.

### K4. Performance: a pose timeline

*Direct a character with a script, not a state per frame.*

- `perform(actor, [[0, 'idle'], [0.5, 'point-r', { ease: ease.out, dur: 0.25 }],
  [1.5, { head: 10 }], [2, 'cheer', { anticipate: 0.15, overshoot: 0.1 }]])`
  → `{ state(t), events }`: targets blended with easing over `dur`, held
  between, `anticipate` a counter-move of a tenth of the change over that
  many seconds before, `overshoot` past the target then settled, all evaluated
  on the twos and quantised, pure in `t`. Variants switch at half-way.
- `layer(base, extra, { parts, weight })`: additive on named joints, so a
  walk carries a wave.
- Recipes A, G, U, W, X take `perform:` in place of a state.

Done when: a stick teacher points at three labels in turn with anticipation
and the frames dedup where the pose holds.

### K5. Reach, look-at, planted feet

*Inverse kinematics where it earns its place: hands, eyes, feet.*

- `reach(actor, 'hand-r', [x, y], { elbow: 'up' | 'down' })`: analytic
  two-bone IK on shoulder–elbow–wrist (or hip–knee–ankle), quantised, from
  stage coordinates through `stager.local`; a single-segment arm falls back
  to today's aim.
- `lookAt(actor, [x, y])`: head angle, pupil slide, and `dir` for a puppet
  with views; `lookAt(actor, otherActor)` for dialogue.
- Stride: a cycle's stride in puppet units (K7's `advance`, or measured from
  the ankles' excursion); `walkTo(actor, x0, x1, t0, t1)` → `{ x(t), state(t) }`
  with speed = stride × cycles per second so feet stay planted;
  `stand(actor, y)` fixes feet on a ground line whatever the pose.
- Lint `foot-slide`: a planted ankle that drifts more than 2 units between
  frames of a walk.

Done when: `sam` walks across the frame and `hdf changed` shows no frame with
a sliding foot; the fox reaches the teapot's handle.

### K6. Secondary motion

*Tails, ears, hair and scarves follow through.*

- Payload `parts.<n>.follow: { lag: 2, damp: 0.7 }`: the part's joint is
  derived from its parent's world angle history, evaluated from the actor's
  `state(t)` at `t - k/12` (pure; the actor passes the function, not a
  value), so it needs no frame memory. `chain: { n: 4, len, w }` generates a
  rope of parts (a tail, a scarf) with `follow` on each.
- `actor.place` accepts a state *function* and a time for these parts.
- The fox's tail gets `follow`; `hdf sheet store fox --cycle walk` shows the
  lag. Fox goldens: rewrite.

Done when: the tail lags the body in the walk strip and a scarf of four links
swings after a jump.

### K7. Capture: stride, face, hands

*More of you on the puppet.*

- `core/pose.js`: keep `advance` per frame (hip x over figure height), so
  a pose clip's cycle knows its stride (K5).
- `hdf clip --kind face <frames|json> --name me-face`: MediaPipe's face
  landmarker blendshapes (jawOpen, mouthSmile, mouthPucker, eyeBlink l/r,
  browInnerUp, browDown l/r) per frame, resampled to 12 fps, quantised, as a
  `face` clip; `actor.face(clipId, t)` maps to mouth variants, eye variants,
  brow rotate and slide. Optional python as in S15; landmarks kept in
  `out/` so nothing is needed twice.
- `hdf clip --kind hands`: finger poses for a `hand` part with variants
  (`open, fist, point, thumb`), by nearest.

Done when: a phone clip of the user talking drives `sam`'s face, and the
walk's stride matches the clip's.

### K8. Props: sockets and attach

*The teacher holds the chalk; the fox holds the teapot.*

- Payload `sockets: { 'hand-r': [x, y, angle] }` (SVG:
  `<circle id="socket:hand-r">` with `data-angle`); `puppet.worldOf(part,
  state)` the part's world matrix at a state.
- `attach(actor, 'hand-r', cel, { rot, scale })` draws a cel through the
  socket each frame, in front of or behind the hand (`behind: true`), and
  `held(actor, cel, [x, y])` combines with `reach`.

Done when: the fox pours the teapot it holds, and `sam` writes on the board
with the chalk in its hand while T6's `writer` follows the strokes.

---

## 5. Voice and sound (V)

### V1. Narration

*A recorded line under a shot.*

- `hdf import line1.wav --kind sample --name moon-1` (the kind exists;
  decode to mono float once per process, resample to the synth rate).
- `voice(id, t, { gain })` score events; `core/synth.js` mixes samples and
  ducks everything else under a voice by 9 dB with 0.15 s ramps; the contact
  sheet draws voice bars under the tiles; the player plays them.
- The skill says what makes a wav (macOS `say -o line.aiff`, piper, edge-tts,
  a phone recording); the package only takes wavs.

Done when: `mini` with one narrated line plays in sync in the player and the
`-final.mp4`.

### V2. Word timing and captions

*Captions that follow the voice.*

- `alignOf(id)` → `{ words: [{ text, t0, t1 }] }`: default estimate is
  `speech()`'s syllable grid stretched over the sample's voiced region
  (energy above a floor); `hdf align <id> --text "..."` refines with
  `faster-whisper` or `whisper-timestamped` under `HDF_PYTHON`, or
  `--json words.json` from any tool; the result is stored on the sample's
  catalogue entry (`align`), so renders need nothing installed.
- `captions(id, { style })` (T9) letters the words as spoken; `say(text, t0,
  { voice: id })` takes its letters and syllables from the alignment.
- `hdf lint`: `caption-sync` warns when a caption's alignment is an estimate
  over 3 s long.

Done when: a 20 s narrated paragraph captions itself word by word and the
underline lands on the spoken word.

### V3. Lip sync from audio

*The mouth follows the recording.*

- `mouthFrom(id)`: per 1/12 s, the sample's RMS energy → open amount 0..3,
  smoothed and quantised, stored on the entry (`mouth`);
  `hdf align <id> --mouth` refines with Rhubarb Lip Sync (`rhubarb -f json`,
  on PATH like `rembg`), mapping its A–H to the puppet's mouth set (four for
  the fox, six for a stick face, eight for a puppet that draws them:
  `mouth-0..7`).
- `say(..., { voice })` uses it; `actor.mouth(id, t)` alone for a caption-free
  line.

Done when: the fox says a recorded "hello there" and the mouth closes on the
consonants.

### V4. Sound effects and a music bed

*Pop, boing, whoosh, ding, ta-da.*

- `recipes/sfx.js`: `pop(t) boing whoosh ding tada tick squeak(tool) flip
  erase pencilScratch chalkTap` from the synth (pitch sweeps, noise bursts,
  envelopes); `hits(cues.cuts)` an accent on each cut; the writer (T6) and
  eraser (T6) call their own.
- `bed({ tempo, key, mood: 'bright' | 'calm' | 'mystery' | 'march', from,
  to })`: a chord loop whose bar is a whole number of twelfths (tempo snapped
  to make it so), ducked under voice (V1), with a `stop(t)` and a `sting`.

Done when: a quiz's wrong answers tick and the right one dings over a bright
bed that ducks under the narration.

---

## 6. Looks for the classroom (L)

Each is ~200 lines of `looks.js` and `finish.js`, one golden of `mini` under
it, and a row in `references/looks.md`.

### L1. `whiteboard`
White stock with a faint glare band and a tray; `marker` tools in black,
blue, red, green (`inks.N`); a flat marker finish with a faint streak; no
hatch; `writingHand` (T6) with a marker by default; `fx('erase')`. Words
allowance from the audience profile.

### L2. `chalkboard`
Green-black stock, chalk with dust (small `dots` along strokes), coloured
chalks as accents, a chalk-tap sound on each stroke start (V4), a
half-erased ghost of the previous shot as an option (`ghost: 0.15`).

### L3. `crayon`
Construction-paper stocks (the pastel sheets) with a waxy finish (broken
coverage, paper showing through, thick outlines), the `crayon` tool wider,
a paper-tooth grain. For the youngest audience; profile `kids-5` picks it.

### L4. `notebook`
Ruled lines and a red margin stock, a narrow felt-tip `marker`, doodles in
the margin as motifs (a coffee ring, a paper clip, a sticky note exists),
a page-flip cut (`fx('flip')`).

Done when (all four): `hdf render films/mini.js --look whiteboard` (and each
other) restyles the film and the goldens for the six old looks hold.

---

## 7. Teaching recipes and structure (E)

### E1. Chapters and length

- `chapter(title, ...nodes)`: a `seq` with a title card (recipe `titleCard`)
  and its own anchor allowance; the board, `hdf grid --chapter n` and lint's
  cut counts group by chapter; `hold` at a chapter's end; the length norm in
  the skill becomes 180 s with a chapter every 20 to 40 s.
- `hdf render --chapter n` renders one chapter (as `--frames` does a prefix).

Done when: a three-chapter film boards as three cards and renders one chapter
in a few seconds.

### E2. Recipes: title, label, count, compare (AN–AQ)

- `titleCard({ title, sub, actor })`: the title written on (T6), the actor
  presenting; `labelled({ subject, labels: [{ text, at, from }], per })`: a
  subject with leader-line labels arriving in order, a small camera nudge to
  each; `counting({ items: cel, n, per, tally: true })`: objects appear with
  digits and a tally (T8); `compare({ left, right, sign: 'vs' | '=' | '>' })`:
  a split frame, two subjects, the sign drawn last.

### E3. Recipes: process, cycle, number line, growth (AR–AU)

- `process({ steps: [{ text, cel }], arrows: 'straight' | 'curved' })`: cards
  with arrows, one per beat; `cycleDiagram({ steps, travel: true })`: steps
  on a ring, `textOnPath` labels, an arrow travelling round;
  `numberLine({ from, to, marks, jumpTo })`: a hop along the line;
  `growth({ cel, from, to, count: true })`: a pictograph or a bar rising with
  its number counting on.

### E4. Recipes: question, quiz, map, dialogue (AV–AY)

- `questionCard({ text, actor })`: a big drawn `?`, the question lettered,
  the actor shrugging (K3); `quiz({ question, options, answer, pause })`:
  three options, a pause, the wrong ones ticked off, the right one circled
  with a ding (V4); `mapRoute({ map: cel | photo, path, marker })`: a marker
  traces the route over a drawn map with a label along it; `dialogueShot`:
  two actors staged left and right on a ground, T9's `dialogue` as the beat.

Done when (E2–E4): each recipe has a timing row in `references/recipes.md`,
takes `actor:` and `audience:`, and `work/moon/` (section 10) uses nine of
them lint-clean.

### E5. Script to beat sheet

- `hdf script brief.md`: a small dialect (`# chapter`, `- sam says: ...`,
  `- text: ...`, `- show: labelled(...)`, `- voice: moon-1`) → durations from
  the audience's reading speed and the samples' lengths, printed as the
  beat-sheet comment the skill expects, plus a timeline stub in
  `work/<film>/<film>.js` with the recipes named. The skill writes the film;
  the tool does the arithmetic.

Done when: the moon film's brief round-trips to the beat sheet it was built
from.

---

## 8. davidup: the two branches meet (D)

### D1. Alpha render and the overlay clip

- `hdf render --alpha [mov|webm]`: `paper()` and `night()` draw nothing, the
  `paper` role resolves transparent, finishes keep their geometry; encode
  `prores_ks -profile:v 4444 -pix_fmt yuva444p10le` (`.mov`) or
  `libvpx-vp9 -pix_fmt yuva420p` (`.webm`); `--frames` and workers unchanged.
- `scripts/davidup-hdf-clip.ts --alpha` registers the `.mov`; verify that
  davidup's video frame extraction keeps alpha for an input clip (its own
  alpha *export* exists; the import path is the thing to check) and fix on
  the davidup side if it flattens.

Done when: the fox waves over a davidup photo slideshow with the photo
showing through.

### D2. Sprite sheets for davidup's sprite item

- `hdf sprite <puppet|cel> --states idle,walk,happy --fps 12 --h 300 --alpha`
  → a PNG sheet and a JSON (frame boxes, fps, cycle ranges), registered as a
  davidup `sprite` asset; `hdf-to-davidup --sprites` does every cast member
  of a film.

Done when: an agent builds a davidup scene with a walking `sam` through
`add_sprite`, no video involved.

### D3. A hand as a font

*The user's handwriting as a davidup font, declaratively.*

- `hdf hand --export-ttf <id>`: each glyph's strokes swept by the pen width
  with round caps and joins as overlapping contours in one winding
  (TrueType's non-zero fill needs no boolean union), 1000-unit em, advances
  from `w` + track, composed glyphs (T2) as composite glyphs, written with
  `opentype.js` (a dev dependency used only by this command); registered as a
  davidup `font` asset by `hdf-to-davidup --fonts`.

Done when: a davidup title in `narcis.ttf` renders through davidup's own text
path and reads as the same hand the film is lettered in.

### D4. Cues both ways

- `hdf cues <film> --out cues.json`: shots, cuts, chapter marks, note onsets,
  voice words; `hdf render --cues-from composition.json`: davidup item
  starts and ends and audio markers become `cues.marks`, readable by the
  score and by `perform` (`atMark('drop')`); both bridge scripts pass them.

Done when: a film's cuts land on a davidup audio track's beats and davidup's
markers show the film's chapters.

### D5. One MCP tool

- `render_hdf_clip { film, look, ar, alpha, frames, sprites }` in davidup's
  server, wrapping `davidup-hdf-clip.ts` and `hdf sprite`; `server.json`,
  README, `mcp-demo` and the manifest test updated together (the memory note).

Done when: the mcp-demo shows a declarative composition summoning an
imperative clip in one call.

---

## 9. Kids: draw it and it moves (W)

### W1. The rig sheet

*A child draws inside the boxes; the drawing walks.*

- `hdf hand --template --rig biped`: a page with corner marks (S12) and
  labelled boxes (head, body, upper arm, forearm, hand, thigh, shin, foot,
  one side), each with a light printed pivot dot and a faint guide silhouette.
- `hdf sketch photo.jpg --sheet biped --name mia`: homography, per-box crop
  and threshold (the reader's path), strokes through `core/skeleton.js`,
  filled blobs as `fill` ops with `finish: true`, the pivot from the printed
  dot's known place, parts named with the standard names, the other side
  mirrored, imported as a puppet with `views: ['side']`. A second sheet
  (`--rig biped-front`) adds the front.
- It gets K3's vocabulary and K2's cycles for free.

Done when: a photographed sheet becomes a puppet that walks in its own strip
in one command.

### W2. The workbench: a pose editor in the player

- A `Rig` tab for the selected puppet: drag a joint (FK) or a hand or foot
  (K5's IK), slide pupils, pick variants, onion skin of the previous frame;
  `record pose <name>` and `record frame` for a cycle; `hdf dev` writes the
  payload back to `assets/src/<id>.puppet.json` and re-imports it, and the
  film side hot-reloads as today. The same tab moves pivots on an imported
  sketch and sets sockets (K8).

Done when: a pose recorded by dragging appears in `hdf sheet store <id>` and
in the film without a text edit.

### W3. Auto-rig a single drawing (stretch)

- A flat humanoid drawing (PNG or SVG) → biped: `core/rig.js` labels the
  silhouette's skeleton, the mask is cut perpendicular to each bone at its
  joints, each piece is traced, pivots sit at the joints. Rough by nature;
  the workbench (W2) fixes what it gets wrong.

---

## 10. The acceptance film

`work/moon/moon.js`, **"Why does the moon change shape?"**, about 75 s,
`audience: 'kids-7'`, `whiteboard` (L1) with a `chalkboard` (L2) chapter:

1. A title written by a hand (T6, E2) while `sam` (K2, from a rig sheet, W1)
   walks in without sliding (K5) and presents (K3).
2. Narration (V1) with captions (V2); `sam`'s mouth follows it (V3).
3. The moon labelled (E2 `labelled`) with leader lines and a circle-around
   (T7).
4. Eight phases counted (E2 `counting`) with digits and a tally (T8).
5. The month as a ring (E3 `cycleDiagram`) with names on the path (T8).
6. The fox asks "de ce?" and `sam` answers in a bubble (T9, T2).
7. A quiz (E4) with a ding (V4) over a calm bed.
8. Sign-off in the user's hand.

Then the same `sam` as an alpha overlay (D1) in a davidup composition over a
photograph of the real moon, captioned by davidup in the exported hand (D3),
its cuts on davidup's audio markers (D4), placed by the MCP tool (D5).

The film is the exit test of 4.0 as `pink-octopus` was of 3.0; its rough edges
go in `docs/hand-drawn-film-v4-rough-edges.md`.

---

## 11. Order and size

The spine first: after these ten the thesis is visible and the moon film can
start.

| # | session | needs | why first |
|---|---|---|---|
| 1 | T1 punctuation | — | a sentence |
| 2 | T5 layout | T1 | a caption box |
| 3 | K1 slide/scale | — | a face that looks |
| 4 | K2 stick puppets | K1 | a teacher |
| 5 | K3 vocabulary | K2 | the teacher points |
| 6 | V1 narration | — | a voice |
| 7 | V2 word timing | V1, T5 | captions |
| 8 | L1 whiteboard | T5 | the genre's home |
| 9 | E2 label/count/compare | T5, K3 | the first lesson |
| 10 | D1 alpha | — | the meeting with davidup |

Then, in dependency order: T6, T9, K4, K5, T10, E1, E3, E4, V3, V4, T2, T3,
T4, T7, T8, K6, K7, K8, L2, L3, L4, D2, D3, D4, D5, W1, W2, E5, W3.

Thirty-nine sessions. Short (a few hours): T1, T2, T7, E1, V4, L2–L4, D5, E5.
Long (a day or more): T4, T5, K2, K5, V2, W1, W2, D3. The rest are half to
most of a day. About twice v3.

| session | done |
|---|---|
| T1 | [x] 2026-09-21: 24 glyphs (94 with letters and figures), sheet pages latin + symbols told by a code along the bottom edge, `hdf hand <page.jpg ...>` merges pages |
| T5 | [x] 2026-09-21: `layout` / `measureBox` from real advances and glyph ink (`core/layout.js`), `textBox`, `bullets` (dot dash number check), `text` op wraps with `width` (`w` stays the pen) and breaks on `\n`; `bounds` of a text op measures its ink in the shot's hand; player `B` shows text boxes; every film lint clean, every golden holds |
| T2 T3 T4 T6 T7 T8 T9 T10 | [ ] each |
| K1 | [x] 2026-09-21: `slide`/`scale` (`keepArea`) part inputs `<n>.x/.y/.sx/.sy` quantised like joints, xf `translate(pivot).translate(d).rotate.scale`; `when: { eye: ['open'] }` shows a part with a variant (the pupil hides behind a happy eye); SVG `data-slide`/`data-scale`/`data-when`; fox gets `pupil`, `brow-l`, `brow-r` (l = the drawing's left, so worried is brow-l -, brow-r +), EMOTES use them and gain `worried`; lint and both sheets see every move at its extremes; a sliding part is a print in the cut-out look; cutout-fox and fox-and-teapot goldens rewritten, every other golden holds |
| K2 | [x] 2026-09-21: `core/stick.js` compiles `{ kind: 'stick', joints, bones, head, spread }` to parts (bone = part at its proximal joint, named by its distal joint in the biped names, root `hips`, collars to shoulders and hips of a side), three views generated from the joints (front: pairs `spread` apart, -l on the drawing's left), a face (eye 4 variants, pupil slide, brows turn + slide, mouth 0..5 with 5 the smile), dots or mitts, `line` or `tube`; stored compiled with the source as `stick`; `hdf stick` (four builds) writes `src/<id>.stick.json` and imports it, keeping retargeted cycles; `hdf retarget` derives the map from the stick (-l side 1, zero = the bone's rest direction, so a clip in the rest stance retargets to zeros); box is the reach about the hip; every golden holds |
| K3 | [x] 2026-09-21: `packs/poses/biped.json` (21 poses, 5 cycles, 12 expressions, `needs`, `views`) is `VOCABULARY` in `core/actor.js`, `EMOTES` its expressions (the old five unchanged); `actor.pose(name, k)`, `emote`, `cycle` fall back to it through `known()` (a variant may be a list of preferences; a root `body` takes no vocabulary turn), an entry applies only with its `needs`, and is tempered towards rest in tenths until the figure keeps to its box in every view whose rest does (cel-box holds everywhere); `actor.vocabulary` lists what applies (lazy); the stick gains `half` and `wink` eyes; `hdf sheet store <id> --vocabulary`; `hdf bundle` inlines a JSON module as `application/json`; the hedgehog unchanged; every golden holds |
| K4 K5 K6 K7 K8 | [ ] each |
| V1 | [x] 2026-09-21: `core/wav.js` reads PCM 8/16/24/32 and float wavs (extensible, LIST chunks skipped) to mono at 44.1 kHz; `voice(id, t, { gain, dur })` score events mix after the master over a score ducked 9 dB under the voiced part (-40 dBFS floor, 0.15 s ramps in dB), a score with no voice byte-identical; samples read once per process through a reader `core/assets.js` installs (the player fetches each wav before mixing: `hdf bundle` inlines it, `hdf dev` serves its blob); import reads `sec` off the data chunk and refuses a wav the synth cannot read; contact sheet voice bars; lint rule `voice`; the player resolves dev asset URLs against the page (images too); `films/mini-voice.js` with `mini-line` (macOS `say`) plays sample-identical in the bundle, dev and `-final.mp4`; every other golden holds |
| V2 | [x] 2026-09-22: `core/align.js` `alignOf(id)` (the stored `align` on the sample's entry when its copy matches as words, else an estimate made from the wav: `speech()`'s grid over the voiced part with each `, . ! ?` pinned to the nearest silence, a monotone match; 0.16 s mean from whisper on moon-para), `fitWords` lays any tool's words onto the copy (word edit distance); `hdf align <id> [--text] [--json] [--estimate] [--show]` runs `cli/align.py` (faster-whisper or whisper-timestamped under `HDF_PYTHON`), falling back to the estimate; `captions(id \| alignment, { t0, lines, reveal, ... })` letters words as spoken in pages (the last row of a page ends at a stop, with no one- or two-word widows), underlines the spoken word; `say(text \| null, t0, { voice })` takes letters, syllables and mouth from the timing, `events()` is the voice; captions are not words for lint, `caption-sync` warns on an estimate over 3 s (`lintAll` returns findings and warnings); the player registers the page's records; `films/narrated.js` (moon-para, 18 s, whisper-aligned) plays the same in the bundle; every other golden holds |
| V3 V4 | [ ] each |
| L1 L2 L3 L4 | [ ] each |
| E1 E2 E3 E4 E5 | [ ] each |
| D1 D2 D3 D4 D5 | [ ] each |
| W1 W2 W3 | [ ] each |

---

## 12. Not in 4.0

- Speech synthesis inside the package. It takes wavs; the skill says what
  makes them.
- Raster brushes, scanned textures, GPU rendering, realtime playback beyond
  the player.
- A timeline editor in the player. The workbench edits puppets, not films.
- A new davidup item kind. Video, sprite, font and image are enough.
- Shape morphing between arbitrary drawings. Variants still switch; a stick
  bone still rotates; a bendy thing is a chain (K6).
- Three-dimensional characters. `stage3d` stands flat sheets up; that is
  the whole of its ambition.
- Fingers as a rig beyond hand variants (K7); full face rigs beyond brows,
  pupils, eyes and mouth.
- Hosting, sharing, a marketplace of puppets. The store is a folder;
  sharing is git.

## 13. Why this is the right next version

3.0 opened the door for drawings to come in: an SVG, a walk, a handwriting.
4.0 is about what walks out: a character who can be directed with a sentence,
words that a child can read in the time they are on screen, a voice under the
picture, and a diagram that constructs itself the way a teacher draws it. The
declarative branch gets characters, lettering and fonts it could never
describe in JSON, and the imperative branch gets media, timing across tracks
and an editor it should never grow. Every session keeps the 2.0 rules, so
lint, dedup, workers, goldens and the player work on a lesson exactly as they
work on a film.

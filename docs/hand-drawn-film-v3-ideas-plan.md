# hand-drawn film 3.0: the nine ideas, one session each

Implementation plan for section 3 of `hand-drawn-film-v3-plan.md` ("Ideas that
raise the bar"), all nine picked. Written for Claude Code: one task per coding
session, no review gates, no ceremony. Each session ends with a command that
runs, a test that passes and the goldens holding (or a new golden written).

Nothing from v3 is built yet (the package is at 2.0, commit `d0511d9`). Six of
the nine ideas stand on the store, puppets, the actor contract, SVG import,
hands and retargeting, so the minimum of phases Q0, Q1, Q2, Q4 and Q5 is
folded in as sessions. Q3 (sketch import), Q6 (credits/stocks/samples) and Q7
(workbench) are **not** in this plan: none of the nine ideas needs them.

## How to run a session

1. `cd handdrawn`, read the session block below and only the files it names.
2. Build it. Keep the 2.0 rules: everything drawn from data, roles never hex,
   seeded randomness, 1/12 s grid, lists hash and dedup, lint before pixels.
3. Done-when is the exit condition. `npm test` must be green,
   `hdf golden check` must hold for every film not named in the session
   (fly-style, four-looks, gallop, held-once, mini, moon-book, one-year).
4. `node cli/apidoc.mjs` if the public API moved. One commit, message
   `hdf: S<n> <title>`. Tick the box in the table at the bottom.

Sessions are dependency-ordered. S1 has no prerequisites and can run today.

---

## Fixed decisions (so sessions do not re-derive them)

- **Store layout** exactly as v3 plan 1.1: `assets/catalogue.json`,
  `assets/blobs/<sha>.{webp,json}`, `assets/sheets/` gitignored, 40-hex sha
  over payload bytes, closed `licence` enum, kinds
  `cutout | clip | puppet | hand | stock | motif | sample`.
- **Puppet JSON** exactly as v3 plan 1.2, plus one field this plan adds in S7:
  `views` (see S7). Joints are degrees on a 2° step; variants switch at
  `k >= 0.5` in `pose()`.
- **Actor contract** exactly as v3 plan 1.3, plus `actor.say()` (S9).
- **Hand JSON** exactly as v3 plan 1.4. `look.hand` defaults to `'house'`.
- **Look strings** gain a modifier syntax used by `--look` and `resolveLook`:
  `preset~hand:<id>` and `preset~from:<asset>`. Parsed in `looks.js`, applied
  in that order. A look with modifiers hashes differently, so caches never
  collide.
- **New CLI verbs** land in `cli/<verb>.mjs`, get a line in `USAGE` and an
  entry in `COMMANDS` in `cli/hdf.mjs`, and a case in `test/cli.test.js`.
- **New lint rules** go in `core/lint.js` with one test each in
  `test/lint.test.js`.
- **Fox** is the cast member every session after S4 uses. It is the same
  puppet throughout, first authored as JSON (S4), then re-authored as an SVG
  and imported (S6), then given views (S7) and a gallop (S14).

---

## Sessions

### S1. Palette from an asset

*Idea: derive a look from a cutout's own colours. No prerequisites.*

- `cli/photo.mjs`: after matting, quantise the cutout's opaque pixels (posterise
  to 5 bits per channel, count, merge bins within a small RGB distance, keep
  the top 8 by area, sort by area) and write `colours: [{ hex, area }]` into
  the cutout record. `hdf photo --refresh <photos.js>` adds `colours` to every
  cutout of an existing module without re-matting (decode `src`, mask by
  `sil`). Run it on `films/held-once-photos.js` and `films/moon-book-photos.js`.
- `core/looks.js`: `derive(look, { from })` where `from` is a cutout record (or
  a bare `colours` array). `fills` = the colours by area; `accents` = the four
  most saturated, pushed to `s * 1.3` and mid lightness with the hsl helpers;
  `inks` = `[ink, darkest saturated colour]`; `shade` = darkest colour shaded
  0.3; `blush` = the most saturated warm hue tinted 0.3. `paper`, `ink`,
  `night`, `light`, `chalk` are untouched. Name becomes
  `${base}~from:${from.name}`. A record without `colours` throws a message
  naming `hdf photo --refresh`.
- `resolveLook` accepts `'preset~from:<id>'` only when a film is loaded (the
  loader passes the film's assets); `hdf render --look 'doodlePastel~from:teapot'`
  works through `load.mjs`.
- Tests in `test/looks.test.js`: a synthetic colours table gives fills in area
  order, accents saturated, name set; missing `colours` throws.

Done when: `hdf grid films/held-once.js --look 'doodlePastel~from:teapot'`
renders in the teapot's colours, all goldens hold (the photos modules gained
a field, pixels did not move).

### S2. The store, part 1: schemas, import, resolve

*Prerequisite for S3, S4, S11, S16. v3 plan Q0, first half.*

- `core/assets.js`: one schema + validator per kind (plain JS checks, no
  library), `sha(bytes)`, `readCatalogue(root)`, `entry(id)`,
  `payloadPath(entry)`. Cutout schema is today's cutout record with `src` moved
  to a webp blob and `sil`, `colours`, `w`, `h` kept in the catalogue entry.
- `cli/import.mjs`: `hdf import <file> --kind <kind> --name <id> [--credit
  --source --licence]`. Validates, hashes, writes the blob, adds or replaces the
  catalogue entry, prints the id and sha. `--licence` defaults to `unknown`.
- `cli/load.mjs`: `film.assets` may be an array of ids or the 2.0 object. Ids
  resolve through the catalogue next to the package (`handdrawn/assets`) or
  `{ id, from: '<dir>' }`. Decoded images keyed by id as now; cutout records
  are rebuilt from the entry so `pin()`, `silhouette()` and `derive({ from })`
  see the same shape they see today.
- `cli/find.mjs`: `hdf find <words...> [--kind]` searches name, tags, desc,
  credit; prints id, kind, licence, sheet path, inputs.
- Tests: `test/assets.test.js` (validators accept the fixtures, refuse a bad
  licence and a missing box; import is idempotent; same bytes → one blob).

Done when: `hdf import work/some.png --kind cutout --name x` lands in the
store and `hdf find x` prints it; every existing film still loads unchanged.

### S3. The store, part 2: migrate the 2.0 data modules

*v3 plan Q0, second half. Deletes the three largest files in the repo.*

- `hdf import --v2 <photos.js|clips.js>`: reads the module, writes one blob per
  cutout (png data URL → webp, lossless) or clip (JSON), one catalogue entry
  each with `credit`, `source`, `licence: 'unknown'` unless the record has one.
  Prints the rewritten `assets:` line.
- Run it on `held-once-photos.js`, `moon-book-photos.js`, `gallop-clips.js`.
  Rewrite the three films to `assets: ['teapot', ...]`; `registerClips` in
  `gallop.js` reads clips from the store (`engines/traced.js` gets
  `clipFromStore(id)`, `registerClips` unchanged for inline data). Delete the
  three modules.
- `cli/bundle.mjs`: inline only the named ids; write the catalogue entries it
  used to `window.HDF.catalogue`.
- `hdf lint` warns on an inline `{ src: dataURL }` asset.

Done when: `hdf golden check` passes byte-for-byte on held-once, moon-book and
gallop; `git diff --stat` shows the three big files gone.

### S4. Puppets

*Prerequisite for S5 onward. v3 plan Q1, first half.*

- `core/puppet.js`: `puppet(id)` returns a cel exactly like `cel()` does
  (frozen group tagged `cel`, quantised inputs, memoised, boxed). Parts in
  painter order; a part is a `group` with `xf` about its pivot, parented parts
  nest; variants pick one op list; joints are inputs `[-180, 180, 2]`; other
  declared `inputs` pass through. `p.pose(name, k)` lerps joints from `rest`,
  switches variants at `k >= 0.5`. `p.cycle(name, t)` picks the frame on the
  1/12 grid and wraps. Ops are deserialised through `list.js` once and reused.
- Author `assets/src/fox.puppet.json` by hand (Claude writes it): `body`,
  `head` (parent body), `eye` variants `open | happy | sleep | wide`, `mouth`
  variants `0..3`, `arm-l`, `arm-r`, `leg-l`, `leg-r`, `tail`; poses `rest`,
  `wave`, `asleep`; cycle `walk` (8 frames, joints only). Fills use `finish:
  true`, strokes the look's pen. `hdf import fox.puppet.json --kind puppet
  --name fox --licence own`.
- `cli/sheet.mjs`: `hdf sheet store fox [--pose wave] [--cycle walk]` (the
  first argument `store` means look in the catalogue). Sheet shows every look,
  three scales, each pose, each variant; a cycle adds a strip row.
- Lint: `puppet-joint` (off-grid or out of range), `roles-raw` (a hex in an
  imported puppet). `cel-box` runs at import over every pose and variant.
- Tests in `test/puppet.test.js`: a one-part puppet hashes the same as an
  equivalent code cel; `walk` frames with equal quantised joints dedup; `pose`
  at `k = 0.5` switches the variant; lint rules fire on fixtures.

Done when: `hdf sheet store fox --cycle walk` writes `assets/sheets/fox.jpg`
and the strip reads as a walk.

### S5. The actor contract

*v3 plan Q1, second half. Every doodle recipe accepts any cast member.*

- `core/actor.js`: `actorOf(puppetOrCel, spec)` → `name, box, ground,
  (inputs), idle(t, seed), look(dir), emote(name), cycle(name, t), reveal(tau)`.
  For a puppet the methods derive from poses, cycles and the conventional part
  names; a missing cycle falls back to a two-pose bob and records it (for lint).
  For a code cel the spec supplies the methods.
- `recipes/doodle.js`: `HOG = actorOf(hedgehogDrawer, {...})` wrapping today's
  `hog(d, x, y, s, o)` so `who = hog` keeps working; every recipe AA to AM gains
  `actor:` (default `HOG`), uses `actor.look`, `actor.emote`, `actor.cycle('run')`
  where it drew `dir`, `eye`, `run` before. `CAST` gains `FOX = actorOf(puppet('fox'))`
  lazily (only when the store has it).
- `recipes/shots.js`: recipes that place `boat`, `fly`, `horse` gain `actor:`
  where a cast member is on screen (A, D, K, Q at least; check by grep for the
  pack import).
- Lint `actor-cycle`: fallback bob on screen over 1 s.
- `films/fox-and-teapot.js`: the fox through `doesItsJob`, `looksBack` and
  `getaway` with `actor: FOX`, doodlePastel. Write its golden.

Done when: `held-once` golden holds unchanged (same lists, HOG draws exactly
what `hog` drew); `fox-and-teapot` renders and has a golden.

### S6. SVG import

*Prerequisite for S7 (turnarounds come from one SVG with three groups).
v3 plan Q2 without `--export`.*

- `core/svg.js` (pure, no Node imports): parse with a small hand-written XML
  tokenizer (no dependency), support `path rect circle ellipse line polyline
  polygon g transform`, flatten beziers and arcs at `--flatten` using
  `list.js cubic` sampling, refuse `use`, gradients, filters, `text`, masks and
  rasters by element name. Rig from ids as v3 plan 1.5 (parts, `pivot`,
  `data-parent`, `data-variants`, `mouth-0..3`, `pose:<name>` groups). Colour
  table → house palette order mapping; `--roles map.json` overrides;
  `--roles ask` writes the table and stops. Document order is stroke order.
- `cli/svg.mjs`: `hdf svg <file.svg> --name fox [--kind] [--roles] [--flatten]
  [--units]` → validate as a puppet, import into the store, write the sheet.
- Re-author the S4 fox as `assets/src/fox.svg` following the Figma conventions
  (Claude writes the SVG by hand, mirroring the JSON), import it over the id
  `fox`. Roles table printed and checked into `assets/src/fox.roles.json`.
- Tests in `test/svg.test.js`: each element kind flattens to the expected
  polylines; rig extraction; refusal messages name the element; the S4 JSON
  fox and the SVG fox produce lists with the same part names and boxes.

Done when: `hdf svg assets/src/fox.svg --name fox --licence own` reimports the
fox and `fox-and-teapot` golden holds (drawing identical) or is rewritten
with a one-line note if the SVG fox is intentionally nicer.

### S7. Turnarounds

*Idea: a puppet that turns as the page does.*

- Puppet JSON: optional `views: ['front', 'three-quarter', 'side']`; a part's
  `ops` (or each variant) may be an object keyed by view. Missing view falls
  back to the first declared. `dir` input `[-1, 1, 0.5]` (a half step, so 0
  and ±0.5 exist) picks `side` (flipped for -1), `0` picks `front`;
  `three-quarter` is chosen by `actor.look(±0.5)` when present. (Built: a
  `pivot` may be keyed by view too, and actors on a turning page stay upright.)
- `core/svg.js`: a top-level `<g id="view:side">` wraps a whole view; parts
  inside keep their ids. The fox SVG gains three views.
- `core/actor.js`: `look(dir)` picks the view, then head turn and eye variant
  within it.
- `recipes/book.js`: `book3` spreads accept an `actor` placed on a page that
  turns with the page (`view` follows the page angle: front at rest,
  three-quarter mid-turn, side at the edge).
- `films/fox-and-teapot.js`: add a short spread where the fox turns. Golden
  rewritten.

Done when: `hdf sheet store fox` shows three views; the film's turn shot
reads as a turn.

### S8. Pose sheets as briefs

*Idea: a model sheet before a frame is rendered.*

- `cli/sheet.mjs`: `hdf sheet store fox --poses [--look risoPop]` writes
  `assets/sheets/fox-model.jpg`: a title card in hand text, turnaround row,
  expressions row (every `emote` name), hands and feet at 2x, every named pose,
  every cycle as a strip, credits line. One look, the film's or `--look`.
- Reuses `sheets.mjs tileSheet`; the sheet itself is a display list so it
  hashes and lint's `cel-box` runs over it.
- Test: the model sheet's list hash is stable across two runs; the row count
  equals views + 1 + poses + cycles + 2.

Done when: `hdf sheet store fox --poses --look risoPop` produces a sheet you
would hand to a client.

### S9. Speech scribbles

*Idea: `actor.say('hello there', t0)`.*

- `core/actor.js`: `say(text, t0, { at, size, bubble })` returns a shot fragment:
  mouth variants driven per syllable (syllables = vowel groups, a fixed viseme
  cycle `0 → 2 → 3 → 1` at 1/12 steps), the words revealed letter by letter in
  hand text inside a bubble motif anchored at `at` (default above the head),
  and score events. Actors without a `mouth` part draw a small three-stroke
  mouth overlay at `spec.mouthAt` (HOG gets one).
- `core/marks.js`: `bubble(box, tail)` motif (a wobbly rounded rect with a
  tail, fill `paper` + pen stroke).
- `recipes/score.js`: `pluckPerSyllable(text, t0)` events on the pentatonic
  helpers already in `synth.js`.
- Lint's existing word allowance counts spoken words.
- `fox-and-teapot`: the fox says "hello there" at the teapot. Golden rewritten.
- Tests: syllable split on a fixture list; viseme sequence on the grid;
  say() is deterministic per seed.

(Built: the fragment is `{ state(t), draw(t, x, y, s, o), events(t), mouth(t), syllables }` in shot
seconds; a recipe spreads `state` into the actor's state and draws `draw` at the actor's own stage place, and
the doodle recipes take it as `say` (AC first). Visemes index the mouth variants (the fox's 0 shut, 1 open,
2 wide, 3 smile). Syllable timing lives in `core/text.js speech()`, shared by the mouth, the letters and
`pluckPerSyllable`. The greeting replaces the tea shot's caption, keeping it inside doodle's three words.)

Done when: the shot plays with mouth, letters and plucks in sync.

### S10. Cut-out look

*Idea: a seventh look, Gilliam by way of `stage3d`.*

- `core/looks.js`: `cutout` preset (card colours, finish `flat`, paper `card`)
  plus a look field `cutout: { shadow: 0.3, fastener: 3, edge: 0.6, tilt: 0.94 }`
  read only by `puppet.js`.
- `core/puppet.js`: when `look.cutout` is set, each part is wrapped as: an
  `fx('soft')` drop shadow of the part's silhouette offset down-right, the part,
  a light offset `stroke` of its outline (paper edge), and a `dots` op at the
  pivot (the brass fastener). The whole puppet gets `xf` scale-y `tilt` so the
  camera sits above the table.
- `core/finish.js`: `flat` finish (no hatch, no dots; fills stay flat).
- `core/fx.js`: reuse `FX.soft`; no new fx unless the shadow needs a
  silhouette op (then `silhouetteOf(group)` in `list.js`).
- `films/four-looks.js` stays as is (golden untouched). New `films/cutout-fox.js`:
  fox-and-teapot's three shots under `cutout`. Golden written.

(Built: the look reaches a puppet in the finish pass, not in `puppet.js`'s draw, because a cel never sees
the look. `puppet()` registers each built puppet by cel name (units, ground, each part 'joint' / 'card' /
'print'), so the drawing carries nothing extra and still hashes like the same cel in code; under a look with
`cutout`, `expand` and the rasteriser hand a registered cel to `asCutout()`. Only parts with a pivot of their
own are cards; pivotless parts (eye, mouth) are printed on theirs. Shadow offset 3 and blur 2 hundredths of the
puppet's units, always down-right on the table through joints and the turnaround mirror; the paper edge is a
`light` stroke up-left along the coloured fills; fasteners are rim + brass + a dot-screen highlight in
accents.2. `card` stock is coarser grain. cutout-fox is the three scenes plus the sign-off (lint wants one),
all through the doodle recipes with `look: LOOKS.cutout, paper: null`. lint allows the cutout look 3 words.)

Done when: `hdf render films/cutout-fox.js` reads as layered card with
fasteners and shadows; every other golden holds.

### S11. Hands, part 1: the hand asset and `look.hand`

*Prerequisite for the "same film, two hands" idea. v3 plan Q4, first half.*

- `core/assets.js`: `hand` schema as v3 plan 1.4.
- `core/glyphs.js`: `houseHand()` returns the current glyph set and tool
  defaults as a hand record named `house`.
- `core/text.js`: glyphs come from `look.hand` (resolved to a record; `house`
  when absent). `measure` takes the look. `track`, `slant`, `baselineDrift`
  applied in `handText`.
- `core/tools.js`: pen reads `wobble`, `overshoot`, `hook`, `pressure`, `speed`
  from the hand when the op does not override them; implement `overshoot`
  (extend each corner past the vertex by ratio × segment length) and `hook`
  (a short entry curl) as path transforms applied before jitter, seeded.
- `core/doodle.js`: reveal speed reads `hand.stroke.speed`.
- `looks.js`: `preset~hand:<id>` modifier; the hand record is part of the look
  hash. `hdf render film.js --look 'risoPop~hand:test'` works.
- A deterministic `test` hand: the house glyphs perturbed by a seeded rng
  (slant -6, wobble 2.2, overshoot 0.15) generated by `node cli/hand.mjs
  --synth test` and imported. `mini` re-rendered with `--look
  'paperInk~hand:test'` gets a second golden entry.
- Lint `hand-missing`.

(Built: a cel never sees the look, so `evalShot` draws each shot inside `withHand(handOf(look))` and
`handText`, `measure` and `doodle` read that hand when not told one (a text op gets the look's at expand
time); a cel drawn under a hand other than house is memoised apart. `look.hand` is the whole record (absent =
house, so no preset's hash moved); `~hand:<id>` finds it in the film's assets or the store registry, and
`loadFilm` reads the hands a look names from the store. House output is byte-identical: drift, track and
wobble scale by exact 1s. The hand's pen (wobble before the look's, overshoot, hook, pressure) applies only
under a look with a hand and never to a `wobble: 0` stroke (hatching, ruled lines); overshoot is capped at
24 pen widths, the hook is a 60-120 degree flick of radius hook x 1.5 pen widths, pressure draws a segment at a
time. Hand strokes are stored flat like `glyphs.js` (`[[x, y], ...]` also accepted). `hdf hand --synth <id>`
is the verb (`--template` and sheets are S12); the test hand has track 6, slant -6, drift 1.8, wobble 2.2,
overshoot 0.15, hook 0.35, pressure [0.7, 1, 0.85], speed 1150. `hdf golden --look` writes
`goldens/<film>-<look>.json`; the hand draws the pens too, so every mini frame with a stroke moves under it.)

Done when: `hdf render films/mini.js --look 'paperInk~hand:test'` is visibly
lettered in another hand; `mini` default golden holds.

### S12. Hands, part 2: your hand from a photographed sheet

*v3 plan Q4, second half. Same film, two hands, for real.*

- `cli/hand.mjs --template > out/hand-template.pdf` (skia-canvas PDF export):
  A4 and letter, 62 glyph boxes with corner marks and a printed exemplar in
  each, a last row of line, circle, square, zigzag, long S.
- `hdf hand sheet.jpg --name narcis`: find corner marks (dark L shapes at
  known relative positions, perspective-corrected with a 4-point homography),
  crop each box, threshold, skeletonise in JS (`core/skeleton.js`, a port of
  `roto.py`'s Zhang-Suen pass and `trace()`), trace strokes with widths, scale
  to the 100-unit em, order strokes longest first. Fit the stroke profile from
  the last row: wobble (RMS deviation from the ideal line), overshoot (corner
  extension on the square), hook (entry curl on the line), pressure (width at
  0.1/0.5/0.9), rounding (corner radius on the square), tremor (high-pass
  residual). Missing glyphs fall back to house per glyph and are listed.
- `hdf sheet --hand narcis` shows house and the new hand side by side.
- Test: render the template to a jpg with the package itself, letter it with
  the `test` hand, run `hdf hand` on that jpg, and check every glyph traces
  and the profile lands within tolerance of the `test` hand's values.

(Built: the geometry lives in `core/handsheet.js` (pure: a luminance plane in, canvas-agnostic drawing out),
so the PDF, the tests' lettered sheets and the reader share it. The frame is 180 x 250 mm, centred on A4 or
letter (`--paper letter`), in em units of 0.2 mm, so what is written on the baseline comes back at house size.
The marks are thick Ls found as components that fill a third to a half of their box with one quarter empty, the
four spanning the largest quad; a square key beside the top-left one lets a sideways photo read; the homography
is fitted to their centroids. Guides, exemplars and box borders print light and drop out under a per-box
threshold (ink < 0.6 x the box's 90th-percentile paper, `--thr`). `core/skeleton.js` is Zhang-Suen plus a
staircase pass, a Felzenszwalb distance transform for widths, whisker pruning, roto.py's `trace()`, and a join
of branches that run straight through a junction (so x and t come back as two strokes); dots come back as small
circles. Glyphs are centred in an advance 6 wider than their ink. The pen row is three lines (drawn left to
right) plus the circle, square, zigzag and S; lines give wobble (RMS off the fitted line, x sqrt 18, less the
skeleton's own noise), pressure (width at 0.1/0.5/0.9, over the widest), hook (ink reach off the line at the
start beyond the end's, in 1.5 pen widths) and tremor (high-pass residual); the square (side 80, room for
overshoot 0.35) gives overshoot (skeleton ends outside the fitted square, median per corner, over the side) and
rounding. Wobble and hook read 0.85 of the pen's own values in a six-seed sweep and are scaled back; hook
scatters about +-0.15 because the pen curls each entry through a random 60-120 degrees. Speed is not on a sheet
(the house's). `hdf hand --template --letter <id>` fills the sheet in with a stored hand; `hdf hand sheet.jpg`
also writes `out/hand-<id>-trace.jpg` (straightened, traces in red) and the house | hand page that `hdf sheet
--hand <id>` (and `hdf sheet store <id>` for a hand) draws. The test photographs the lettered sheet in
perspective on a dark table, lit unevenly: all 62 glyphs trace within 0.3-1.7 em units of the strokes handText
wrote, and wobble, overshoot, pressure and hook land within 20%, 0.03, 0.07 and 0.2 of the test hand's.)

Done when: a photo of the printed sheet becomes a hand and `hdf render
film.js --look 'risoPop~hand:narcis'` letters and draws the film in it.

### S13. Living packs

*Idea: pack cels visible to `hdf find` and usable as puppets.*

- `cli/donate.mjs --export <cel>`: draw the pack cel at each input extreme,
  serialise the list (`list.js serialise`), write a one-part-per-extreme
  puppet (`variants` keyed by the input combination) into the store under
  `pack:<name>`, with the cel's `desc`, `box`, `inputs`.
- `packs/manifest.json` gains `store: { id, sha }` per cel; `hdf donate
  --manifest` refreshes the mirror; a stale sha is a lint finding on the pack
  (`pack-mirror`).
- `hdf find boat` lists both the code cel and its mirror; `puppet('pack:boat')`
  works without importing `packs/objects.js`.
- Test: `puppet('pack:boat')({ note: 1 })` hashes equal to `boat({ note: 1 })`
  for every extreme; the mirror is regenerated idempotently.

Done when: `hdf find` sees all 11 pack cels as store entries and a film
draws `puppet('pack:teapot')`.

(Built: a mirror is a one-part puppet with a `mirror` field { pack, export, defaults, values, pool }. It
covers every step of the input grid when that is 64 combinations or fewer, and otherwise each input's min,
default and max; a value in between draws the nearest mirrored one. Every op is stored once in a pool, with
numbers at the shortest decimal the list hash reads the same, so the 11 mirrors come to about 1.6 MB (1.3 MB
of it the horse's 24 traced states). Defaults are probed from the cel. Inputs the cel does not declare (boat's
`mode`, hedgehog's `eye`) need the code cel. `hdf donate --manifest` re-exports every mirror, drops the old
blob and drops mirrors of removed cels; `hdf lint packs/<pack>.js` reports `pack-mirror`; `hdf find` lists
pack cels (kind `cel`) next to their mirrors; `hdf sheet store pack:<cel>` works. Checking the full grid found
a real box bug: the teapot's box did not hold lid-up-with-steam, and is now [-128, -240, 244, 244].)

### S14. Skeletons in clips and retargeting

*Prerequisite for the phone idea. v3 plan Q5.*

- `cli/roto.py`: emit `skel: { joints: { name: [x, y] }, chains: [[...]] }` per
  frame from the skeleton's end points and junctions, labelled by a `--rig
  quadruped|biped` template (hip, shoulder, knee-*, ankle-*, head, tail-tip
  by position order). `hdf clip` keeps `skel`; migrate the horse clip in the
  store (source frames are not in the repo, so if `work/horse` is absent,
  synthesise `skel` from the existing traced lines by the same labelling and
  note it in the commit).
- `cli/retarget.mjs`: `hdf retarget --clip horse --to fox --map horse-fox.json
  --name gallop`: per frame, chain direction → part angle relative to the
  parent, quantised to 2°, scaled by `units` so leg length matches; writes
  `cycles.gallop` into the fox puppet blob (new sha, catalogue updated).
- `assets/src/horse-fox.json` map checked in.
- `fox-and-teapot`: a fourth shot, `fox.cycle('gallop')` across the frame.
  Golden rewritten.

Done when: `hdf sheet store fox --cycle gallop` shows a 12-frame gallop that
is recognisably the horse's motion.

(Built: the labelling lives in one place, `core/rig.js`, in JS: the silhouette is filled into a mask, thinned
(core/skeleton.js), pruned, and its end points named by position. roto.py `--rig` only records the rig and
`hdf clip` labels, so a clip already in the store gets the same skeleton from `hdf clip --store <id> --rig <rig>`;
`work/horse` is not in the repo and this machine has no numpy, so the horse was migrated that way, from its
traced outline. Pairs are numbered 1 (leading) and 2 (knee-h1, ankle-f2). Hip and shoulder sit at the clip's
median place along the spine; frames 9 to 11, where the legs fold into the belly, and frame 3, where the rider's
arm joins the head on, take those joints from their neighbours. Map zeros are "mean" (a horse's level spine is
the upright fox's rest) or a direction; each frame also carries a `lift` in puppet units, so the fox's feet meet
the ground where the hooves did and it leaves it when the horse does. `puppet.liftOf()` reads it, the actor stage
rises by it, the sheet strip shows it. `hdf svg` keeps a retargeted cycle (it carries `from`) when the SVG is
imported again. The chase is the fourth shot of fox-and-teapot.)

### S15. Motion from your phone

*Idea: film yourself, the fox walks like you.*

- `hdf clip --kind pose <frames-dir> --name me`: if `mediapipe` (Python) is on
  PATH, `cli/pose.py` runs the pose landmarker per frame and writes a clip
  whose frames carry only `skel` (33 landmarks reduced to the biped rig) plus
  an `outer` silhouette from the landmark hull; otherwise a clear message
  saying what to install. Frames are resampled to 12 fps on the grid.
- `hdf retarget --clip me --to fox --map biped-fox.json --name walk` overwrites
  the hand-authored walk with the filmed one.
- Test: a synthetic skeleton JSON fixture (a 12-frame biped walk generated by
  code) round-trips through `retarget` into joint angles within 2° of the
  generating angles. The real footage path is a manual check.

Done when: with mediapipe installed, a folder of phone frames becomes
`fox.cycle('walk')` in one command chain; without it the command explains
itself.

(Built: cli/pose.py only finds landmarks (Tasks API with a model file, or the legacy `solutions` API at
complexity 1, which ships its model) and writes them to out/pose-<name>.json; everything else is
`core/pose.js`, in JS: a lost frame is filled from its neighbours, a left/right swap is undone against where
the limbs were heading (comparing with the frame before alone took legs crossing mid-stride for swaps),
resampling to 12 fps, the biped joints by body side (side 1 leads in the first frame, legs and arms alike,
so the map pairs leg-l with ankle-1 and arm-l with wrist-1), x from each frame's hip, and a cut to the best
loop only when its seam is within 3% of the figure's height. The landmarks JSON can be given instead of a
folder, which is how the CLI test runs. `assets/src/biped-fox.json` damps the head to half (ears jitter) and
has the tail follow leg-l at a third, as the hand walk did. Checked on this machine with mediapipe 0.10.21 in
a scratch venv on Muybridge's walking man (Wikimedia Commons, 12 frames, one stride, kept whole): legs swing
+-30, arms counter-swing, and the fox's sheet strip walks. The house fox keeps its hand-authored walk until
someone films theirs.)

### S16. Store as a davidup asset source

*Idea: the two projects meet through a script, not a new item type.*

- `scripts/hdf-to-davidup.ts` (bun): `bun run scripts/hdf-to-davidup.ts
  <film.js> --project <id> [--look]` runs `hdf render`, then registers the mp4
  and each used puppet's model sheet (`hdf sheet store <id> --poses`) as
  davidup assets through the same asset API `register_asset` uses (import the
  engine's asset registration directly, as `seed-global-library.ts` imports the
  library code; do not shell out to the MCP server).
- The reverse direction: `scripts/davidup-hdf-clip.ts <composition.json>
  <item-id>` renders the named `handdrawn` film and rewrites that video item's
  `src` to the mp4. Nothing new in the item union.
- README section "handdrawn ↔ davidup" with the two commands.
- Test: a dry-run flag prints the asset list without rendering; one integration
  test registers a 6-frame `mini` render into a temp project and lists it.

Done when: a davidup composition plays a handdrawn mp4 registered by the
script.

### S17. The 3.0 skill

- `.claude/skills/hand-drawn-film/SKILL.md`: the store, `hdf find` before
  drawing anything, ask for an SVG before writing polylines, `actor:` on every
  recipe, `say()`, turnarounds, the `cutout` look, hands and `~hand:`,
  `~from:`, retargeting, the davidup bridge.
- `references/assets.md`: schemas, importer rules, the Figma conventions on
  one page, the hand template instructions.
- `references/api.md` regenerated; `scripts/update-hand-drawn-skill.sh` run.

Done when: a fresh session given only the skill can put the fox through a
doodle recipe in the user's hand without reading the source.

---

## Order and progress

| # | Session | Needs | Idea served | Done |
|---|---|---|---|---|
| S1 | Palette from an asset | — | palette from an asset | [x] |
| S2 | Store part 1 | — | (prereq) | [x] |
| S3 | Store part 2, migration | S2 | (prereq) | [x] |
| S4 | Puppets | S2 | (prereq) | [x] |
| S5 | Actor contract | S4 | (prereq) | [x] |
| S6 | SVG import | S4 | (prereq) | [x] |
| S7 | Turnarounds | S5, S6 | turnarounds | [x] |
| S8 | Pose sheets as briefs | S7 | pose sheets | [x] |
| S9 | Speech scribbles | S5 | speech scribbles | [x] |
| S10 | Cut-out look | S4 | cut-out look | [x] |
| S11 | Hands part 1 | S2 | same film, two hands | [x] |
| S12 | Hands part 2 | S11 | same film, two hands | [x] |
| S13 | Living packs | S4 | living packs | [x] |
| S14 | Skeletons + retarget | S4 | (prereq) | [x] |
| S15 | Motion from your phone | S14 | motion from your phone | [x] |
| S16 | Store ↔ davidup | S2 | davidup asset source | [ ] |
| S17 | The 3.0 skill | all | — | [ ] |

S9, S10, S11, S13 and S16 only need what is listed and can be pulled forward
whenever a session ahead of them is blocked.

## Rough size

Seventeen sessions. S1, S8, S9, S10, S13, S16 and S17 are short (a few hours).
S3, S6, S12 and S14 are the long ones (a full day each). The rest are half to
most of a day.

# hand-drawn film 3.0: assets, cast, and your own hand

Continues `hand-drawn-film-v2-plan.md`. 2.0 built the drawing-as-data core:
display lists, looks, lint, cache, three engines, packs, `hdf`. It shipped with
11 cels, 10 photo cutouts and one traced clip, all of them made by hand in code
or by two special-purpose commands (`hdf photo`, `hdf clip`).

3.0 is about **where drawings come from**. Today a new character means writing
polylines in JavaScript. In 3.0 a character comes from an SVG drawn in Figma or
Inkscape, from a pencil sketch photographed on a phone, from a Muybridge plate,
or from a pack, and lands in a **content-addressed asset store** as data the
whole package already knows how to hash, lint, cache and re-look. Three ideas
carry the version:

1. **Assets are data, packs are code.** Everything imported (a cutout, a clip,
   an SVG puppet, a paper stock, a hand) is a JSON or binary file under
   `assets/`, addressed by its hash, interpreted by a small set of generic
   cels. Nothing imported is ever `eval`ed or copied as source text.
2. **The Actor contract.** A puppet that declares a handful of named parts and
   poses can stand in for the hedgehog in every doodle recipe, be retargeted
   from found motion, and be placed in the pop-up book. Recipes stop
   hard-coding their cast.
3. **Your hand.** One printed sheet, photographed once, becomes a *hand*: your
   letterforms and your stroke habits (wobble, overshoot, pressure, speed).
   Every stroke and every letter in a film signed with that hand is drawn the
   way you draw. No host fonts, still; but now not the package's hand either.

Fixed rules of 2.0 stay fixed: everything on screen is drawn by code from
data, colour is a role never a hex, randomness is seeded, time sits on the
1/12 s grid, a list hashes and dedups, lint runs before pixels.

---

## 0. What is wrong with assets today

- `films/held-once-photos.js` (671 KB), `moon-book-photos.js` (807 KB) and
  `gallop-clips.js` (739 KB) are base64 and JSON inside JavaScript. They are
  the largest files in the repo, unreadable in review, duplicated when a
  second film wants the same teapot, and re-parsed as JS on every worker
  start.
- A cel is a function. That is right for the packs (drawn in code, reviewed
  as code) and wrong for imports: `hdf donate` has to copy **source text**
  between markers and hash-check the copy because there is no data form of a
  drawing that still takes inputs.
- Cutouts, clips and cels have three unrelated shapes, three registries
  (`film.assets`, `registerClips`, module exports) and three discovery paths
  (`hdf sheet` walks module exports; `manifest.json` lists packs; photos are
  found by importing the module).
- Provenance is a free-text `credit`. Nothing checks it, and the sign-off has
  no place to show it.
- The doodle recipes AA to AM take `photo:` and draw `hog`. There is no way to
  put a different character through `becomesVehicle` or `looksBack` without
  editing the recipe.
- The one-stroke hand font in `glyphs.js` is the only handwriting the package
  has. Every film is lettered by the same hand.

---

## 1. Fixed specifications

Decisions, not proposals. Later phases build on them without re-deriving.

### 1.1 The asset store

```
handdrawn/
  assets/
    catalogue.json               id -> { kind, sha, file, name, tags, credit, source, licence, box, ... }
    blobs/<sha>.webp             raster payloads (cutout pixels, paper scans)
    blobs/<sha>.json             data payloads (puppets, clips, hands, motifs)
    sheets/<id>.jpg              check sheets, regenerated, gitignored
```

- `sha` is 40 hex over the payload bytes. Two imports of the same file are one
  blob. The catalogue entry is what a film refers to, by `id`; the blob is
  what the loader decodes.
- `kind` is one of `cutout | clip | puppet | backdrop | stock | hand | motif |
  sample`. Every kind has a JSON schema in `core/assets.js` and a validator;
  `hdf import` refuses a payload that fails it.
- `licence` is required and closed: `CC0 | CC-BY | CC-BY-SA | PD | own |
  unknown`. `unknown` imports but lint rule `credit` fails any film that
  renders it (see 1.7).
- A film no longer inlines assets. `film({ assets })` keeps its shape but the
  values become catalogue ids or `{ id, from: '../other-store' }`:

  ```js
  export default film({ name, look, timeline, score, assets: ['teapot', 'watch', 'fox', 'narcis-hand'] });
  ```

  `cli/load.mjs` resolves ids through the catalogue, decodes rasters once per
  process (as now) and hands every renderer a `Map<id, decoded>`. A film may
  still pass an inline `{ src: dataURL }` for a one-off; `hdf lint` warns.
- `hdf bundle` inlines only the assets the film names (as now) and writes the
  catalogue entries it used into `window.HDF.catalogue`, so the player can
  show credits.
- Migration: `hdf import --v2 films/held-once-photos.js` moves every cutout
  into the store and rewrites the film's `assets` line. The three big JS
  files are deleted in the same commit as the goldens are re-checked
  (pixels must not move: the payload bytes are the same).

### 1.2 Puppets (the data form of a cel)

A puppet is a cel whose drawing is data. It is what every importer produces
and what the packs can also be exported to.

```jsonc
{
  "kind": "puppet", "name": "fox", "units": 300,            // tallest pose is 300 logical units
  "box": [-120, -300, 240, 310], "ground": [0, 0],          // feet at the origin, y down as everywhere
  "parts": {                                                 // draw order = key order (painter's)
    "tail":   { "pivot": [-40, -90], "parent": "body", "ops": [ ...display list ops, paths as $p ] },
    "body":   { "pivot": [0, -120], "ops": [...] },
    "head":   { "pivot": [0, -230], "parent": "body", "ops": [...] },
    "eye":    { "parent": "head", "variants": { "open": [...], "happy": [...], "sleep": [...] } },
    "mouth":  { "parent": "head", "variants": { "0": [...], "1": [...], "2": [...], "3": [...] } },
    "arm-l":  { "pivot": [-30, -200], "parent": "body", "ops": [...] }
  },
  "inputs": { "eye": ["open", "happy", "sleep"], "mouth": [0, 3, 1], "dir": [-1, 1, 2] },
  "poses": {                                                 // named joint sets, degrees, plus variant picks
    "rest":  { "arm-l": 0, "tail": 0 },
    "wave":  { "arm-l": -70, "head": 8, "eye": "happy" },
    "asleep": { "eye": "sleep", "head": 14, "tail": -20 }
  },
  "cycles": { "walk": { "fps": 12, "n": 8, "frames": [ { "arm-l": 30, ... }, ... ] } },
  "roles": { "#e8734a": "accents.0", "#2b2b2b": "ink" },    // how the source colours were mapped
  "credit": "...", "source": "...", "licence": "own"
}
```

- Ops inside parts are ordinary 2.0 ops (`fill`, `stroke`, `dots`, `group`)
  with **roles**, serialised by `list.js serialise`. A part's `ops` are in
  the part's own coordinates with its pivot at the origin.
- `puppet(id)` in `core/puppet.js` returns a cel exactly like `cel()` does:
  `fox({ eye: 'happy', 'arm-l': -70 })` is a frozen group with a `cel` tag,
  quantised inputs, memoised, boxed. Joint inputs are degrees on a 2° step
  (`[-180, 180, 2]`) so cycles dedup. Part rotation is a `group` with `xf`
  about the pivot; `place()` semantics (rot or scale marks `cache: 'never'`)
  are unchanged, so a rotated part draws direct and the still parts cache.
- `fox.pose('wave', k)` blends from `rest` toward `wave` by `k` (joints
  lerp, variants switch at `k >= 0.5`). `fox.cycle('walk', t)` picks the
  frame on the 1/12 grid. Both return the same group objects as explicit
  inputs would, so hashes agree.
- Variants replace the ad hoc `mode: 'ink' | 'blueprint'` and `eye: 'happy'`
  strings the packs use today; string inputs stay allowed on code cels.

### 1.3 The Actor contract

A cast member is anything that satisfies:

```js
actor.name                          // 'fox'
actor.box, actor.ground             // as a cel
actor(inputs)                       // the cel call
actor.idle(t, seed)                 // breathing, blink, tail: a list on the twos grid
actor.look(dir)                     // -1 | 0 | 1 : facing, head turn, eye variant
actor.emote(name)                   // 'happy' | 'sleep' | 'wide' | 'sad' : eye + mouth + a joint or two
actor.cycle('walk' | 'run' | 'hop', t)   // any declared cycle; missing ones fall back to a 2-pose bob
actor.reveal(tau)                   // draws itself in stroke order (doodle-style), 0..1
```

`core/actor.js` exports `actorOf(puppetOrCel, spec)`: for a puppet the
methods derive from `poses`, `cycles` and part names (`head`, `eye`,
`mouth`, `tail`, `arm-*`, `leg-*` are conventional; unknown parts are simply
still). For a code cel (the hedgehog) the film supplies the methods, which
is what `recipes/doodle.js` `hog` becomes: `HOG = actorOf(hedgehog, {...})`.

Every doodle recipe AA to AM gains `actor:` (default `HOG`). `becomesVehicle
({ actor: FOX, photo: PHOTOS.violin })` is the whole change for a user.
Recipes A to Z that place `boat`, `fly`, `horse` gain the same option where a
cast member is on screen.

### 1.4 Hands

```jsonc
{
  "kind": "hand", "name": "narcis",
  "glyphs": { "a": { "w": 44, "s": [[...], [...]] }, ... },   // the same shape as glyphs.js, 100-unit em
  "track": 6, "slant": -4, "baselineDrift": 1.8,
  "stroke": {                                                // measured from the sample strokes
    "wobble": 1.4, "overshoot": 0.12, "hook": 0.35,          // amplitude, corner overshoot ratio, entry hook
    "pressure": [0.7, 1.0, 0.85], "speed": 1150,             // width along a stroke; units per second
    "tremor": 0.5, "rounding": 0.3                           // high-frequency jitter; how corners soften
  },
  "credit": "...", "licence": "own"
}
```

- `look.hand` (default `'house'`, the 2.0 glyph set and tool defaults) names a
  hand asset. `text.js` reads glyphs from the look's hand; `tools.js` reads
  the pen's wobble, overshoot, hook, pressure and speed from it when the op
  does not override them. `doodle()` reads `speed`.
- The hash of a stroke op is unchanged (the hand is part of the look, and the
  look is already in the cache key). Two hands, two caches, no collisions.
- A hand sheet is a fixed template `hdf hand --template > hand.pdf` (A4 and
  letter): 62 boxes for glyphs (a-z, A-Z, 0-9), then a row of a straight
  line, a circle, a square, a zigzag and a long S. `hdf hand sheet.jpg
  --name narcis` finds the boxes by their corner marks, traces each glyph
  with `cli/trace.mjs` and `roto.py`'s skeletoniser, and fits the stroke
  profile from the last row. Missing glyphs fall back to the house hand per
  glyph, and `hdf sheet --hand narcis` shows which.

### 1.5 SVG import

`hdf svg <file.svg> --name fox [--kind puppet|backdrop|motif] [--roles map.json]
[--flatten 0.6] [--units 300]`

- Geometry: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
  `polygon`, `g` with `transform`. Beziers and arcs flatten to polylines at
  `--flatten` (max deviation in logical units) using `list.js cubic`
  sampling; nothing curved survives import, like everything else in 2.0.
  `use`, gradients, filters, text, masks and embedded rasters are refused
  with a message naming the element (text becomes hand text only if the
  author writes it as a `text` op afterwards).
- Rig from ids: a top-level `<g id="arm-l">` is a part. A child
  `<circle id="pivot">` (or `data-pivot="x,y"`) is its pivot and is not
  drawn. `data-parent="body"` (or nesting) gives the parent. `<g id="eye"
  data-variants>` with children `open`, `happy`, `sleep` gives a variant part.
  Ids `mouth-0..3` collapse to a stepped variant. `<g id="pose:wave"
  data-joints="arm-l:-70,head:8">` declares a pose without drawing.
- Colour to role: every fill and stroke colour in the file is listed with
  its area; the importer maps each to the nearest role of the **house
  palette order** (`ink` for the darkest, `paper` for the lightest, then
  `fills.0..n`, `accents.0..n` by hue distance and saturation) and prints the
  table. `--roles` overrides it; `--roles ask` writes the table to
  `assets/<name>.roles.json` and stops so the author can edit it. Fills get
  `finish: true` so the look hatches or halftones them; strokes get the
  look's pen with `w` from `stroke-width` scaled to units.
- Stroke order is document order, which is the reveal order. Authors draw
  the outline last in Figma and it reveals last, like a pen would.
- Output: the puppet JSON in the store plus `assets/sheets/fox.jpg` (every
  look, three scales, each pose, each variant) and a catalogue entry. Lint's
  `cel-box` rule runs at import on every pose and variant.
- `hdf svg --export fox > fox.svg` round-trips a puppet (or a pack cel at a
  given input set) back to SVG with the same ids and roles as `data-role`, so
  Figma is a first-class editor: import, animate, tweak the drawing, import
  again, and `hdf changed` shows which frames moved.

### 1.6 Sketch import

`hdf sketch <photo.jpg|scan.png> --name owl [--kind puppet|motif] [--thr 120]`

A pencil or ink drawing on plain paper, photographed. Same pipeline as
`roto.py --kind dark` on a single frame: threshold, skeletonise, trace each
stroke with the width the pen had there, order strokes longest first (as
`traced` does), simplify at `--tol`. Output is a one-part puppet whose ops are
pen strokes with `w` per stroke, so it redraws itself in the film's tool and
look and reveals in stroke order. Closed regions the author filled on paper
(detected as dark blobs wider than any stroke) become `fill` ops with `finish:
true`. A `--parts` sheet (the drawing with numbered cut lines the author
photographs back) is out of scope; part splitting for sketches is done in
the player workbench (1.9).

### 1.7 Lint rules added

| rule | finding |
|---|---|
| `credit` | a rendered asset has licence `unknown`, or a CC-BY asset and no credits card |
| `actor-cycle` | a recipe asked an actor for a cycle it lacks and the fallback bob is over 1 s on screen |
| `puppet-joint` | a joint input outside `[-180, 180]` or off the 2° grid |
| `roles-raw` | an imported puppet still carries a hex colour (importer bug or a hand edit) |
| `hand-missing` | the look names a hand the store lacks, or a glyph fell back to house in a sign-off |
| `stock-cover` | a paper stock smaller than the frame is tiled without `meta('intent', 'tile')` |

`creditsShot()` in `recipes/shots.js` (recipe `T`, the letter left free)
draws the credits of every asset the film used, in the film's hand, under the
sign-off. Lint `credit` is satisfied by its presence.

### 1.8 Retargeting found motion

`hdf retarget --clip horse --to fox --map horse-fox.json --name fox-gallop`

`roto.py` already extracts a skeleton per frame; 3.0 keeps the skeleton in
the clip (`frames[k].skel: { joints: { hip, knee-l, ... }, chains }`). The
map names which puppet part follows which skeleton chain (`"leg-l": ["hip",
"knee-l", "ankle-l"]`). The command solves each frame's part angles from the
chain directions, quantises to 2°, and writes a `cycles.gallop` into the
puppet. The horse's 12 poses become a fox's 12 poses; the motion is still
real, the fox is still yours. `hdf sheet fox --cycle gallop` shows the
strip. Puppets from SVG carry `units` so the clip scales to the puppet's
leg length, not its total height.

### 1.9 The player workbench

The 2.0 player has cel sliders, a preview and copy. 3.0 adds a **workbench**
tab that works on store assets, not the film:

- Drop an SVG, a PNG or a photo on the player: it runs the importer in the
  browser (the importer is pure: `core/svg.js`, `core/sketch.js`), shows the
  puppet in every look, and offers *Save to store* (writes through `hdf dev`).
- Click to set pivots, drag to split a sketch into parts along a drawn cut
  line, name parts, pick variants, record a pose by posing the sliders.
- Roles table with live re-look; the same table `--roles` takes.
- Hand tab: photograph the template with the laptop camera, see the traced
  glyphs beside the samples, retype a glyph on a tablet if the trace failed.
- Everything the workbench writes is a store file, so the film side of the
  player is unchanged and hot reload still jumps to the first changed frame.

### 1.10 CLI added or changed

```
import   <file> --kind <kind> --name <id> [--credit --source --licence]   any payload into the store
import   --v2 <photos.js|clips.js>                                         migrate a 2.0 data module
svg      <file.svg> --name <id> [--kind] [--roles map|ask] [--flatten] [--units] [--export <id>]
sketch   <img> --name <id> [--thr] [--tol]
hand     --template | <sheet.jpg> --name <id>
retarget --clip <id> --to <puppet> --map <json> --name <cycle>
find     <words...> [--kind] [--look]     search the catalogue; prints sheet paths, credits, inputs
sheet    <film.js|store> <cel|id> [--hand] [--cycle] [--pose]
stock    <scan.jpg> --name <id> [--tile]   a paper texture as a stock (kind stock)
```

`hdf donate` stays for code cels. `hdf donate --export <cel>` writes the
puppet JSON of a code cel at its input extremes, for round-tripping to SVG.

---

## 2. Phases

Each phase ends with something that runs and a golden that holds.

### Q0. Store and migration (1 to 2 days)

- `core/assets.js`: schemas, validators, `catalogue` reader; `cli/import.mjs`
  and `cli/find.mjs`. `load.mjs` resolves ids. `bundle.mjs` inlines by id.
- `hdf import --v2` on the three data modules; delete them; `hdf golden
  check` on held-once, moon-book, gallop passes byte for byte.
- `film.assets` as an array of ids in every ported film; the skill's
  `api.md` regenerated (`node cli/apidoc.mjs`).

### Q1. Puppets and the actor contract (2 to 3 days)

- `core/puppet.js`: `puppet(id)` from JSON, joints, variants, `pose`,
  `cycle`; `core/actor.js`: `actorOf`. Tests: a puppet's group hashes the
  same as an equivalent code cel; joint quantisation dedups a cycle.
- `hog` becomes `HOG = actorOf(hedgehog, …)`; every doodle recipe takes
  `actor:`; `held-once` golden holds (same lists).
- Lint `puppet-joint`, `actor-cycle`, `roles-raw`.

### Q2. SVG in, SVG out (2 to 3 days)

- `core/svg.js` (pure, browser and Node): parse, flatten, rig from ids, role
  mapping. `cli/svg.mjs` wraps it and writes the sheet.
- A fox drawn in Figma as `assets/src/fox.svg` (kept in git as the source of
  a store asset) with parts, variants, two poses. `films/fox-and-teapot.js`:
  the fox through `doesItsJob`, `looksBack` and `getaway`, with a golden.
- `--export` round trip test: export the pack `teapot`, import it, hash equal
  at every input extreme.

### Q3. Sketch in (1 to 2 days)

- `core/sketch.js` + `cli/sketch.mjs` sharing `trace.mjs` and the
  skeletoniser (ported from `roto.py` to JS for the browser path; the Python
  stays for clips).
- `films/owl-on-paper.js`: one photographed sketch, revealed with the pen,
  then re-looked as riso. Golden.

### Q4. Hands (2 to 3 days)

- Template PDF, box finding, glyph tracing, stroke profile fit. `look.hand`
  in `text.js`, `tools.js`, `doodle.js`.
- `hdf sheet --hand` shows house and the new hand side by side.
- `mini` re-rendered with `--look 'paperInk~hand:test'` (a hand traced from a
  synthetic sheet drawn by the package itself, so the test is deterministic
  and needs no photo). Golden.

### Q5. Retargeting (2 days)

- Skeletons kept in clips (`roto.py` output extended; `hdf clip` migrates
  the horse). `cli/retarget.mjs`. `fox.cycle('gallop')` in
  `fox-and-teapot`, second golden.

### Q6. Credits, stocks, samples (1 day)

- `creditsShot()`, lint `credit`, `hdf stock`, `stock` in `paper()` (a
  scanned texture multiplied under the procedural grain; the procedural stock
  stays the default so every golden holds).
- `sample` kind: a short wav an event can name (`{ sample: 'pencil-scratch',
  at, gain }`); `synth.js` mixes it. Optional; the synth stays pure by default.

### Q7. Workbench (2 to 3 days)

- Player tab, drop handling, importer in the browser, save through `hdf dev`.
- Playwright checks as ad hoc scripts, as in 2.0.

### Q8. The 3.0 skill (1 day)

- `SKILL.md`: the asset store, `hdf find` before drawing anything, "ask for an
  SVG or a photo of a sketch before writing polylines", the actor option on
  recipes, hands. `references/assets.md` (schemas, importer rules, the
  Figma conventions on one page a designer can follow).

Rough total: 14 to 20 days.

---

## 3. Ideas that raise the bar (pick what earns its place)

Listed from cheapest to wildest. None is required by the phases above; the
first four are one-day features on top of them.

- **Palette from an asset.** `derive(look, { from: 'teapot' })` builds a
  look whose fills and accents are the cutout's own dominant colours passed
  through `looks.js` hsl helpers, so a doodle film on a blue cup is drawn in
  the cup's blues. Uses the importer's colour table.
- **Turnarounds.** A puppet with `views: { front, three-quarter, side }` as
  variant sets on every part, and `actor.look(dir)` picking the view. One
  SVG with three groups. The pop-up book gets a character that turns as the
  page does.
- **Speech scribbles.** `actor.say('hello there', t0)` runs the `mouth`
  variant through a fixed viseme cycle per syllable while the words appear
  in the hand, letter by letter, in a bubble motif. Lint's word allowance
  applies. No audio voice; the synth plucks per syllable.
- **Pose sheets as briefs.** `hdf sheet fox --poses` prints a model sheet the
  way an animation studio would: turnaround, expressions, hands, the walk
  strip, in the film's look. Give it to the model or the client before a
  frame is rendered.
- **Same film, two hands.** A hand is a look field, so `hdf render film.js
  --look 'risoPop~hand:narcis'` letters and draws the whole film in a
  different hand. A film signed by two people looks drawn by two people.
- **Cut-out look.** A seventh look, `cutout`: puppets drawn as layered card
  with a drop of `fx('soft')` shadow under each part, visible brass
  fasteners at pivots (a small `dots` op), paper edge strokes, and a
  camera that sits slightly above the table. Terry Gilliam by way of
  `stage3d`. The puppet format already has parts and pivots; the look is
  about 200 lines of `looks.js` and one fx.
- **Motion from your phone.** `hdf clip` already takes a folder of frames.
  Add `--kind pose`: run a pose estimator (MediaPipe, on PATH like `rembg`)
  to produce the skeleton directly instead of thinning a silhouette. Then
  `hdf retarget` puts your own walk on the fox. The chain is: film yourself,
  the fox walks like you, drawn in your hand.
- **Living packs.** Packs stay code, but `packs/manifest.json` grows a
  `store` mirror: every pack cel exported as a puppet at its extremes, so
  `hdf find` sees code and data cels alike, and a film can `puppet('boat')`
  without importing the pack module. This is what lets the player workbench
  edit a pack cel's colours without a JS edit.
- **Store as a davidup asset source.** The davidup MCP server has
  `register_asset` and `list_assets`. A `handdrawn` render can register its
  mp4 and its puppets' sheets as davidup assets, and a davidup composition
  can call `hdf render` for a `handdrawn` clip. Do this as a script in
  `scripts/`, not a new item type in the union (see the memory note on how
  much a new item type costs).

---

## 4. Out of scope for 3.0

- Real voice, speech synthesis, lip sync to recorded audio.
- Vector interpolation between arbitrary shapes (morphing). Variants switch,
  they do not tween; joints rotate, parts do not deform. A bendy tail is a
  spline whose control points are inputs, drawn in code.
- Inverse kinematics. Retargeting solves angles from a chain; authors pose
  joints directly.
- Raster brushes or scanned stroke textures as the pen. Strokes stay
  geometry drawn by the tools, so they hash, cache and re-look.
- A hosted asset service. The store is a folder in the repo; sharing is git.
- Editing packs in the workbench beyond colours and pivots. Pack cels are
  code and stay reviewed as code.

---

## 5. Why this is the right next version

2.0 proved that drawing as data pays for itself: lint before pixels,
byte-identical worker splits, dedup, a change scan that names the frame that
moved. Every one of those wins was blocked at the door by *how a drawing gets
in*: as source text, by hand. 3.0 opens the door without giving up a single
property: an SVG becomes roles and polylines, a sketch becomes seeded pen
strokes, a walk becomes quantised joint angles, and a person's handwriting
becomes a look field. The store makes provenance a rule instead of a comment.
The actor contract makes thirteen recipes work for any character, which is
the difference between a package with one hedgehog and a studio with a cast.

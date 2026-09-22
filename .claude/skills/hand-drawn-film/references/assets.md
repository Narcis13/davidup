# Assets: the store, the schemas, the importers, Figma, the hand sheet

Everything a film does not draw in code lives in `handdrawn/assets/`, once,
by id. This page is the schemas and the rules of every importer; `hdf find`
is the search, `hdf sheet store <id>` the check.

```
handdrawn/assets/
  catalogue.json          id -> { kind, sha, ext, file, name, tags, credit, source, licence, box, ... }
  blobs/<sha>.webp|png|jpg   raster payloads (cutout pixels, paper stocks), the bytes as they came
  blobs/<sha>.json        data payloads (clips, puppets, hands, motifs)
  sheets/<id>.jpg         check sheets, regenerated, gitignored (pack:boat -> pack_boat.jpg)
  src/                    sources worth keeping: fox.svg, fox.puppet.json, fox.roles.json, retarget maps
```

- An id is lower-case letters, digits and dashes; `pack:<cel>` is a pack
  cel's mirror, which only `hdf donate --manifest` writes.
- `sha` is 40 hex over the payload bytes: two imports of the same file are
  one blob; re-importing an id replaces its entry and drops nothing else.
- `catalogue.json` is one entry per line, ids sorted, so a change to one
  asset is a one-line diff. Never re-serialise it with a plain JSON writer
  (a 2000-line diff); change it through the commands.
- `hdf remove <id...>` drops entries (a trial import, a replaced puppet),
  with their sheets and any blob no other entry shares; a `pack:` mirror
  needs `--force` and comes back on the next `hdf donate --manifest`.
  `hdf gc [--dry]` deletes blobs no entry points at (a replaced payload's
  old bytes).
- `licence` is closed: `CC0 | CC-BY | CC-BY-SA | PD | own | unknown`.
  `--licence` defaults to `unknown`. Record `credit` and `source` at import;
  `hdf find` prints them, and the film's delivery repeats them.
- Every kind has a validator in `core/assets.js` that `hdf import`, `hdf
  svg`, `hdf hand` and `hdf retarget` run before writing. A puppet also goes
  through lint's `cel-box`, `puppet-joint` and `roles-raw` at import.

| kind | payload | entry adds | made by |
|---|---|---|---|
| `cutout` | raster with alpha | `w h`, `sil` (traced silhouette), `colours` (`[{ hex, area }]`, top 8 by area), `box` | `hdf photo` + `hdf import --v2`, or `hdf import <png>` of a file already cut out |
| `clip` | json `{ n, fps, h, facing, frames: [{ outer, lines, skel? }] }` | `n fps h box` | `roto.py` + `hdf clip`; `hdf clip --kind pose` (a phone clip: `skel` only) |
| `puppet` | json (below) | `units box` | `hdf svg`, `hdf import <json>`, `hdf donate --manifest` (mirrors), `hdf retarget` (adds a cycle) |
| `hand` | json (below) | `glyphs` (count) | `hdf hand <sheet.jpg>`, `hdf hand --synth` |
| `stock` | raster | `w h box` | `hdf import` |
| `motif` | json: one serialised op list | `box` | `hdf svg --kind motif` |
| `sample` | wav | `sec` | `hdf import` |

## Reading the store from a film

```js
import { fromStore } from 'handdrawn/core/assets.js';     // node only; hdf dev / bundle swap in assets.web.js
const IDS = ['teapot', 'fox', 'narcis'];
const PHOTOS = fromStore(IDS);        // { teapot: cutout record (src, w, h, sil, colours, credit...), fox: payload, ... }
export default film({ ..., assets: IDS });      // the loader resolves the same ids; { id, from: '../other-store' } too
```

A cutout record is what `pin()`, `photo()`, `on()`, `rim()` and `derive({
from })` take. A puppet payload is what `puppet('fox')` reads, by id, from the
registry `fromStore` filled. The look modifiers `~hand:<id>` and `~from:<id>`
read the registry, then the store itself, so a look built anywhere (at a
module's top level above the `fromStore` line, in a recipe's `look:`)
resolves; still name the id in `assets` so the loader and lint see it.

```bash
hdf find fox                          # every entry whose id, name, tags, desc, credit or source holds 'fox'
hdf find horse --kind clip            # narrowed to a kind
hdf find --kind puppet                # the whole kind; pack cels (kind cel) listed next to their mirrors
hdf find teapot --root ../other       # another store
```

One line per hit: id, kind, licence, what it takes (a puppet's inputs, a
clip's poses, a cutout's pixels), then its sheet path and credit.

## Cutouts (photos)

```bash
hdf photo teapot.jpg --name teapot --credit "Teapot, ca. 1755, The Met, CC0" --source https://... --js work/<film>/photos.js
hdf photo cup.jpg --name cup --punch 0.87,0.35 --js ...     # also clear an enclosed hole (u,v off the check sheet)
hdf photo cut.png --name boot --keep --js ...               # the file already has alpha: crop, trace, register
hdf photo flat.jpg --name card --flood --js ...             # flood a plain background by colour (no rembg)
hdf import --v2 work/<film>/photos.js --licence CC0         # every record into the store, bytes untouched
```

`hdf photo` cuts the object out (`rembg` on PATH, else `--flood` / `--keep`),
traces the silhouette, quantises the opaque pixels to a `colours` table and
writes `out/photo-<id>.jpg`: the cutout on magenta (halos show) and on paper
with a u,v grid every 0.1. **Look at it** and read the anchor points (spout,
hub, lip, seat) off the grid for the doodle recipes. `hdf import <png> --kind
cutout` takes a file that is already cut out and traces `sil` and `colours`
itself; it warns when the silhouette is the whole frame. Museum open-access
collections (The Met, Rijksmuseum, Smithsonian; CC0) are the usual source.

## Puppets

A puppet is the data form of a cel. `assets/src/fox.puppet.json` is the
worked example; the fox in the store is its SVG re-authoring.

```jsonc
{
  "kind": "puppet", "name": "fox", "units": 300,            // the tallest pose in logical units
  "box": [-126, -314, 236, 324], "ground": [0, 0],          // feet at the origin, y down
  "desc": "the cast fox: nine parts, three views ...",
  "views": ["side", "three-quarter", "front"],              // optional; the first is the fallback
  "parts": {                                                 // key order is painter order
    "tail":  { "parent": "body", "pivot": [-34, -128], "ops": [ ...ops with roles, paths as $p ] },
    "body":  { "pivot": [0, -120], "ops": { "side": [...], "three-quarter": [...], "front": [...] } },
    "head":  { "parent": "body", "pivot": { "side": [0, -196], "front": [0, -196] }, "ops": {...} },
    "eye":   { "parent": "head", "variants": { "open": [...], "happy": [...], "sleep": [...], "wide": [...] } },
    "mouth": { "parent": "head", "variants": { "0": [...], "1": [...], "2": [...], "3": [...] } },
    "arm-l": { "parent": "body", "pivot": [-36, -170], "ops": [...] }
  },
  "inputs": { "eye": ["open", "happy", "sleep", "wide"], "mouth": [0, 3, 1] },   // joints are implied: [-180, 180, 2]
  "poses": { "rest": {}, "wave": { "arm-l": 112, "head": -6, "eye": "happy" }, "asleep": { "eye": "sleep", "head": 14 } },
  "cycles": {
    "walk": { "fps": 12, "n": 8, "frames": [ { "arm-l": 30, "leg-l": -20, ... }, ... ] },
    "gallop": { "fps": 12, "n": 12, "frames": [ { "leg-l": 44, "lift": 18, ... } ], "from": { "clip": "horse", "map": "horse-fox.json" } }
  },
  "roles": { "#e8734a": "fills.0", "#2b2b2b": "ink" },      // how the source colours were mapped (record only)
  "credit": "", "source": "", "licence": "own"
}
```

- A part is a `group` whose `xf` turns it about its `pivot`; a part naming a
  `parent` nests inside it but keeps its place in the painter order (a tail
  before the body draws behind it and still swings with it). Ops are in the
  part's own coordinates with the pivot at the origin; a part with no pivot
  rides its parent's (an eye, a mouth: a "print" in the cut-out look).
- A joint input is degrees on a 2° step; a `variants` part takes a key. A
  puppet with `views` takes `dir` `[-1, 1, 0.5]`: `|dir|` 1 side, 0.5
  three-quarter, 0 front; negative mirrors about the ground point. `ops`,
  each variant and `pivot` may be keyed by view; a view a part lacks draws the
  first view's.
- `poses` are joint sets plus variant picks; `pose(name, k)` lerps from `rest`
  and switches variants at `k >= 0.5`. `cycles` are frames of the same on the
  1/12 s grid; a frame may carry `lift` (puppet units, up) that `liftOf`
  reads. A cycle with `from` was retargeted and survives `hdf svg` re-import.
- The conventional part names an actor moves: `head`, `eye`, `mouth`, `tail`,
  `body`, `arm-l`, `arm-r`, `leg-l`, `leg-r`. Unknown parts stay still. Emote
  names that match a pose use the pose.
- A **pack mirror** (`pack:<cel>`) is a one-part puppet whose variants are
  the code cel drawn at each input combination, with a `mirror` field; it
  hashes like the code cel. Regenerated by `hdf donate --manifest`.

```bash
hdf import assets/src/fox.puppet.json --kind puppet --name fox --licence own
hdf sheet store fox [--pose wave] [--cycle walk]    # every look x pose x variant x 3 scales; the cycle as a strip
hdf sheet store fox --poses [--look risoPop]        # the model sheet -> assets/sheets/fox-model.jpg
```

## SVG and Figma conventions (one page)

`hdf svg <file.svg> --name <id> [--kind puppet|motif] [--roles map.json|ask]
[--flatten 0.6] [--units 300] [--licence] [--credit] [--source] [--tags]
[--no-sheet]`. `assets/src/fox.svg` is the worked example.

**Geometry.** `path rect circle ellipse line polyline polygon g`, each with
its `transform`. Every curve is flattened to polylines at `--flatten`
(largest deviation, logical units); nothing curved survives. Refused by
element and line: `use`/`symbol` (detach the instance), live `text` (outline
it), gradients and patterns (flat colour; the look finishes fills), `filter`,
`mask`, `clipPath` (in Figma turn off "clip content"), `image` (import it as
a cutout), CSS `<style>` (export with presentation attributes), `marker`,
`switch`, nested `svg`, `a`.

**Root.** `viewBox` is the drawing's frame; `data-units` the logical units
the file is drawn in (default the viewBox height; `--units` rescales);
`data-desc` the description `hdf find` shows. The puppet's box is every pose,
view, variant and cycle frame together: when one swings a part past the
viewBox, the importer widens the box (padded 3%), prints it and the poses that
needed it, and keeps the viewBox as `frame`. No second import for the box.
A motif gets a sheet too: the drawing at three scales in every look.

**Rig from ids.** Document order is painter order and reveal order (draw the
outline last, it reveals last).

| in the file | means |
|---|---|
| `<g id="arm-l">` | a part |
| `<circle id="pivot" cx cy>` inside it, or `data-pivot="x,y"` on the g | its pivot; not drawn |
| `data-parent="body"`, or nesting inside another part's g | its parent |
| `<g id="eye" data-variants>` with child gs `open happy sleep wide` | a variant part |
| sibling gs `mouth-0`, `mouth-1`, `mouth-2`, `mouth-3` | one stepped part `mouth`, inputs `[0, 3, 1]` |
| `<g id="pose:wave" data-joints="arm-l:112,head:-6,eye:happy"/>` | a pose; draws nothing |
| `<g id="cycle:walk" data-fps="12">` with one `<g data-joints="..."/>` per frame | a cycle; draws nothing |
| `<circle id="ground" cx cy>` at top level | the ground point |
| `<g id="view:side">`, `<g id="view:three-quarter">`, `<g id="view:front">` at top level | a turnaround: each wraps a whole view with the same part ids inside; a part drawn only in the first view is the same in all; poses, cycles and the ground stay outside the views |
| `data-finish="false"` on a shape or g | no finish on those fills (`"true"` forces it) |

**Colour to role.** Every fill and stroke colour is listed with its area; the
darkest becomes `ink`, the lightest `paper`, the rest go by hue, saturation
and lightness to the nearest unused `fills.n` / `accents.n` of the house
palette. Fills in `fills.n` / `accents.n` get `finish: true`; strokes get the
look's pen, `stroke-width` becomes `w`. `--roles ask` writes the table next
to the SVG and stops; edit it (`"#fff1d6": "light"`, `"#5a3a28": "shade"`)
and pass it back with `--roles`. The table is kept in the payload as `roles`.

```bash
hdf svg assets/src/fox.svg --name fox --roles ask                                   # fox.roles.json, then
hdf svg assets/src/fox.svg --name fox --licence own --roles assets/src/fox.roles.json
```

**Drawing for the importer, in Figma.** One frame per view, parts as groups
named exactly as above, a tiny circle named `pivot` in each jointed part, no
effects, no masks, text outlined, instances detached, export as SVG with
"include id attribute" and presentation attributes. Mouths as four steps
(`0` shut, `1` open, `2` wide, `3` smile: the viseme order `say()` uses), eyes
as `open happy sleep wide`. Feet on the ground point; the tallest pose is
`units` high.

## Hands

```jsonc
{
  "kind": "hand", "name": "narcis",
  "glyphs": { "a": { "w": 44, "s": [[x0, y0, x1, y1, ...], ...] }, ... },   // 100-unit em, strokes flat or [[x, y], ...]
  "track": 6, "slant": -6, "baselineDrift": 1.8,                            // em units; slant in degrees
  "stroke": { "wobble": 2.2, "overshoot": 0.15, "hook": 0.35, "pressure": [0.7, 1, 0.85], "speed": 1150, "tremor": 0.5, "rounding": 0.3 },
  "credit": "...", "licence": "own"
}
```

`look.hand` is the whole record (absent: the house hand, byte-identical to
2.0). Under a look with a hand, `handText`, `measure`, the sign-off and
`doodle()` reveals use its glyphs, track, slant and drift; the pen reads
`wobble` (before the look's), `overshoot` (corners run past the vertex, capped
at 24 pen widths), `hook` (a 60 to 120° entry flick), `pressure` (width at
0.1 / 0.5 / 0.9 of a stroke) and `speed` (reveal rate). Strokes with `wobble:
0` (hatching, ruled lines) are never touched. A cel drawn under a hand is
memoised apart, so two hands never share a cache.

**The sheet.** `hdf hand --template [--paper a4|letter] [--pages latin,symbols] > out/hand-template.pdf`
prints two pages (or the ones `--pages` names), each a 180 x 250 mm frame with a
thick black L at each corner (a square key beside the top-left one, so a
sideways photo still reads). Page `latin`: 62 boxes (a-z, A-Z, 0-9) and a pen
row: three lines drawn left to right, a circle, a square, a zigzag, a long S.
Page `symbols`: 32 boxes, `. , : ; ' " - ! ? & ( ) [ ] / + = % ° × ÷ → ← ↑ ↓ ~
* _ # @ $ €`. Every box has a baseline, x-height and cap line in light blue and
a grey exemplar. A page says which it is with filled squares along its bottom
edge (latin has none, so a sheet printed before pages existed reads as latin).
Instructions for the user:

1. Print at 100% (no "fit to page"). Write each glyph on its baseline in the
   pen you letter with; leave a box blank rather than correct it (a blank
   falls back to the house glyph and is listed).
2. Draw the pen row at your normal speed: the three lines left to right, the
   circle in one go, the square with corners, the zigzag, the S.
3. Photograph the sheet flat on a dark table, all four corner marks in the
   frame, even light (a phone is fine; perspective is corrected).

```bash
hdf hand latin.jpg symbols.jpg --name narcis [--thr 0.6] [--credit "..."]   # -> the hand in the store, assets/sheets/narcis.jpg,
                                        #    out/hand-narcis-trace.jpg and -trace-symbols.jpg (straightened, traces in red);
                                        #    photos in any order, one page is enough (the house draws the rest)
hdf sheet --hand narcis                                         # house | narcis: every glyph, fallbacks marked, pangrams, the pen
hdf hand --template --letter narcis > out/narcis-sample.jpg     # the latin page filled in by the stored hand (--pages symbols)
hdf hand --synth <id>                                           # a deterministic hand made from the house one (`test`)
```

Reading: the marks are found as components, a homography maps the frame onto
the photo, each box is thresholded against its own paper (`--thr` scales it;
lower on a dim photo), thinned, traced with widths, scaled to the em, strokes
ordered longest first. The pen row gives wobble, pressure, hook and tremor
(lines), overshoot and rounding (square). Speed is not on a sheet (the
house's). Lint `hand-missing` fails a look naming a hand the store lacks and a
sign-off that falls back to the house hand for any letter.

## Clips, skeletons, retargeting, the phone

A clip is traced poses: `frames[k] = { outer, lines, skel? }`, `h` the
tallest pose, `facing` the way it moves. `roto.py` traces (see
`engines.md`); `hdf clip` writes the v2 form and, with `--rig`, labels a
skeleton per frame from the silhouette.

```bash
hdf clip work/clips.js --js work/<film>/clips.js --rig quadruped     # roto.py output -> a clips module, rigged
hdf import --v2 work/<film>/clips.js --licence PD                     # into the store
hdf clip --store horse --rig quadruped                                # rig a clip already in the store, in place
```

Rigs (`core/rig.js RIGS`): `quadruped` (hip, shoulder, head, tail-tip,
knee/ankle f1 f2 h1 h2; 1 leads) and `biped` (hip, shoulder, head,
elbow/wrist 1 2, knee/ankle 1 2; side 1 leads in the first frame). `out/clip-<id>-skel.jpg`
shows the joints over each pose: **look at it** before retargeting.

**A map** (`assets/src/horse-fox.json`, `biped-fox.json`) names which puppet
part follows which chain:

```jsonc
{ "rig": "quadruped", "facing": 1,
  "parts": { "body": { "chain": ["hip", "shoulder"], "zero": "mean" },
             "head": { "chain": ["shoulder", "head"], "zero": "mean", "gain": 0.6 },
             "leg-l": { "chain": ["hip", "ankle-h2"], "zero": "mean" }, "arm-r": { "chain": ["shoulder", "ankle-f1"], "zero": "mean" } },
  "ground": ["leg-l", "leg-r"] }                       // the parts whose feet set the lift
```

`zero` is the chain direction that means the part's rest (`"mean"`: the
clip's average, or a direction); `gain` scales the swing. `hdf retarget
--clip horse --to fox --map horse-fox.json --name gallop [--dry]` writes the
cycle into the puppet (joints on 2°, a `lift` per frame in puppet units, a
`from` record), re-lints it and updates the catalogue.

**The phone.** `ffmpeg -i me.mov -vf fps=30 work/me/%04d.png`, then `hdf
clip --kind pose work/me --name me [--fps 30] [--no-loop]`: MediaPipe's pose
landmarker (python; `HDF_PYTHON=<venv>/bin/python`; the command prints the
install line and the model URL when missing) writes `out/pose-me.json`, and
`core/pose.js` fills lost frames, undoes left/right swaps, resamples to 12
fps, labels the biped rig and cuts to the best loop. A landmarks JSON can be
given instead of a folder. Then `hdf retarget --clip me --to fox --map
biped-fox.json --name walk` and `hdf sheet store fox --cycle walk`.

## Pack mirrors

`packs/manifest.json` carries `store: { id, sha }` per cel. `hdf donate
--manifest` re-exports every mirror (`hdf donate --export <cel>` one of
them); `hdf lint packs/<pack>.js` reports `pack-mirror` when a mirror is
missing or stale. A mirror covers every step of the input grid up to 64
combinations, otherwise min, default and max per input; a value between draws
the nearest. `puppet('pack:teapot')({ lid: 1, steam: 1 })` hashes as
`teapot({ lid: 1, steam: 1 })`.

## davidup

`scripts/hdf-to-davidup.ts <film> --project <dir|name>` renders the film and
the model sheet of every store puppet it reads and registers them as davidup
assets (`hdf-<film>` video, `hdf-<puppet>-model` image) in
`<project>/assets/hdf/`; `scripts/davidup-hdf-clip.ts <composition.json>
<item-id>` renders the film a video item names (`"name": "hdf:<film>"` or
`--film`) into that item's asset. Both take `--look`, `--frames N` and
`--dry-run`, and rewrite only the `assets` array of `composition.json`.
`davidup-hdf-clip.ts --alpha [mov|webm]` renders the film on no stock with its
transparency (`hdf render --alpha`), and `register_asset` records `hasAlpha`,
so davidup's render keeps it: an overlay clip.

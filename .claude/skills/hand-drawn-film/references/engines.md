# Engines: found motion, sand, paper in space (and photos)

An engine changes what the frame is made of, not the rules: paper first,
seeded randomness, drawn on twos, one anchor, a signed ending. Each engine
still produces display lists, so lint, board, grid, workers, goldens and the
player all work on it unchanged. The long v1 write-ups
(`.claude/skills/hand-drawn-canvas-animation/references/found-motion.md`,
`sand.md`, `paper3d.md`) have more on craft; the calls below are 2.0's.

## Found motion (`engines/traced.js`, example `gallop.js`)

A sequence of frames (a public-domain motion study, the user's own video) is
traced into vector strokes, and the film redraws those strokes with the brush,
one pose per drawn frame. The motion is real; every line is still drawn by
code. Use it when a real animal or person has to move.

**Sources.** Muybridge's *Descriptive Zoopraxography* (1893) GIFs on
Wikimedia Commons (public domain, 12 poses a clip: horse, elephant, kangaroo,
pigeons, athletes); his *Animal Locomotion* plates (`--kind dark`); the
user's video (`ffmpeg -i clip.mp4 -vf fps=12 frames/%03d.png`). Fetch from
Wikimedia one file at a time with a real User-Agent; stop on a 429. Record
file page and licence.

**Tracing.** `roto.py` is v1's, copied unchanged; `hdf clip` converts and
`hdf import --v2` puts the clip in the store (the store already holds
`horse`, `elephant`, `kangaroo`, `pigeons`: `hdf find --kind clip`):

```bash
ffmpeg -v error -i horse.gif -vsync 0 work/horse/%03d.png
python3 cli/roto.py work/horse --name horse --kind disc --drop-last --js work/clips.js \
  --credit "Eadweard Muybridge, Descriptive Zoopraxography (1893), public domain" --source https://commons.wikimedia.org/wiki/File:...
node cli/hdf.mjs clip work/clips.js --js work/<film>/clips.js --rig quadruped     # --rig: a skeleton per frame
node cli/hdf.mjs import --v2 work/<film>/clips.js --licence PD
```

Look at roto.py's check sheet: every pose one clean figure standing on the
blue ground line. `--kind disc` (a zoopraxiscope window), `dark` / `light`
(one figure after `--thr`), `--close` (outline gaps), `--drop-last` (the
GIF repeats its first pose), `--no-ground` (fliers). If figures touch on the
card, pick another clip rather than fighting it.

**Drawing.**

```js
fromStore(['horse']);                                              // at module top: every worker imports it
clipFromStore('horse');                                            // hands the record to the engine (registerClips(CLIPS) for inline 2.0 data)
traced('horse', i, { x: CX, y: GY, h: 470, wash: 'fills.0', seed: 5 + boil(i, 2) })   // pose i, feet at (x, y)
meta('anchor', { name: 'traced:horse' })
```

`traced(name, k, o)`: `h` is the tallest pose's height; `flip`, `rot`;
`fill` (a body role, `null` for a wiry line), `wash` (watercolour off the
line), `ink`, `weight`, `amp`, `alpha`, `maxLines`; `p` 0..1 draws the
strokes on, longest first. `gap(name, k)` is how far pose k is off the
ground, `airborne(name)` the pose highest off it, `pose(name, k)` the raw
`{ outer, lines }`. The pack cel `horse` is the gallop clip as a cel.

- One pose per drawn frame (`k = i`) keeps the source's cadence; half speed
  is `Math.floor(i / 2)`; a held pose is a number. Never 24 poses a second.
- The clip keeps its own ground: `y` is where the feet touch and a pose in
  the air lifts itself. Never re-centre a pose by hand.
- Give it a `wash` or `fill` in the palette, or it floats over busy ground.
- Stories that come with their motion: Muybridge's question (do all four
  hooves leave the ground?) answered by the airborne pose; 12 poses tiled as a
  disc that spins one pose per drawn frame so the figures run on the spot.

**Retargeting (3.0).** The motion can leave the traced drawing and drive a
puppet: `hdf clip --store horse --rig quadruped` labels a skeleton per frame,
`hdf retarget --clip horse --to fox --map horse-fox.json --name gallop` turns
the chain directions into the fox's joints (2° steps) with a `lift` per frame,
and `FOX.cycle('gallop', t)` is the horse's gallop on the fox
(`fox-and-teapot.js`, the chase). The user's own movement goes the same way:
`ffmpeg -i me.mov -vf fps=30 work/me/%04d.png`, `hdf clip --kind pose work/me
--name me` (MediaPipe, python) and `hdf retarget --clip me --to fox --map
biped-fox.json --name walk`. Maps, rigs and the pose pipeline: `assets.md`,
"Clips, skeletons, retargeting, the phone". Check the strip (`hdf sheet
store fox --cycle gallop`) before the film: it must read as the source's
verb.

## Sand (`engines/sim.js`, example `one-year.js`)

The frame is a bed of sand on a backlit glass that remembers. A hand pours,
sprinkles, wipes, sweeps and combs it; one picture becomes the next without a
cut. Use it for a story that must not cut, or a brief that says sand.

```js
let T = 0;                                                      // a running clock keeps gestures in order
const go = (dur, make, gap = 0.08) => { const g = make(T, T + dur); T += dur + gap; return g; };
const at = (t) => { T = t; return []; };
const bed = sim('<film>', { gestures: [
  at(0.2), go(0.6, (a, b) => G.sprinkle(a, b, row, { r: 240 })),
  go(0.7, (a, b) => G.pour(a, b, TRUNK, { r: 15 })),
] });
const sand = shot('sand', 30, ({ t }) => [...bed.frame(t), meta('anchor', { name: 'sand:<film>' })]);
// score: ({ end }) => ({ master: 0.6, events: [...bed.hiss(), ...piano] })
```

Gestures (times in shot seconds, points in world units; the table is `world`
units square, 1080 by default = the frame):

| gesture | makes |
|---|---|
| `G.pour(t0, t1, pts, { r: 10, amount })` | a stream from the fist: dark lines, trunks, letters |
| `G.sprinkle(t0, t1, pts, { r: 120 })` | a cloud from the fingers: skies, ground, crowns |
| `G.finger(t0, t1, pts, { r: 9 })` | a fingertip clearing a line to the light |
| `G.palm(t0, t1, pts, { r: 70, keep })` | a sweep; `keep < 1` carries sand off the table |
| `G.comb(t0, t1, pts, { fingers: 4, spacing: 26 })` | several fingers: water, fields, fur |
| `G.dab(t, x, y, { r, hand: null })` | one touch; `hand: null` for a mark nobody makes |
| `G.fill(t0, t1, poly, { tool: 'pour' \| 'finger' })` | a snake that covers a polygon |
| `G.wind(t0, t1, { box, vx, vy, strength, lift, feather })` | the top layer creeps; no hand |
| `G.fly(t0, t1, pts, { r, light, land })` | a seed or flake in the air that lands as a pour |
| `G.move(t0, t1, pts, { hand: 'palm' })` | the hand goes somewhere and touches nothing |

`scanFill`, `circlePts`, `spiralPts`, `pathOf`, `pointAt` build paths;
`init: cover({ box, amount })` starts on a covered table (the strongest
opening: a dark table, a fingertip taking a picture out of it, the palm
wiping it back). `bed(t, { view: { x, y, w }, tint: [r, g, b] })` is the bed
alone through a camera window (centre x, y; width w in world units: make
`world` bigger than the frame and push in) under a lamp tint (`[1.05, .9,
.72]` candle, `[.62, .72, 1.1]` night). `bed.frame(t, { view, tint, over })`
adds what flies and the hand; `over` is a list laid on the glass under the
hand (a sign-off card).

Rules of the medium:

- **Dark is sand, light is glass.** To make something dark, pour or sprinkle;
  to make it light, wipe. A light shape on a light sky is invisible.
- **Nothing disappears.** Wiped sand piles beside the stroke; plan the ridges.
  Sweep with `keep: .05` to take sand away.
- **Sprinkle for air, pour for line.** Letters want a small `r` or they close
  into blobs; one-year.js carries a single-stroke alphabet to copy.
- **The hand is the clock.** One hand cannot be in two corners 0.2 s apart.
- **Wind is gentle.** `strength: .08, lift: .85` thins a crown; `.4` strips
  the tree. Feather a gust (300+) across a drawing.
- The state is the sum of everything before it: `hdf grid` often. Workers
  step from checkpoints, so renders stay bit-exact; just never ask a bed for
  earlier times in a loop.
- Score: `bed.hiss()` gives every gesture a hiss for as long as it lasts; put
  a slow pentatonic line under it and silence where the hand stops.

## Paper in space (`engines/stage3d.js`, `recipes/book.js`, example `moon-book.js`)

Everything is drawn flat, on sheets; the sheets then stand in a room with a
camera and a lamp that shades each by its angle and drops its shadow. Use it
for pop-ups, books, paper theatres, dioramas, a page turning.

```js
const cam = camera3({ eye: [0, 1000, 1300], target: [0, 120, 0], f: 1500 });   // x right, y up, z to viewer; table y = 0
const moon = card3(260, 600, [fill(circle(130, 126, 118), 'light'), ...]);      // a sheet: w x h, (0, 0) top left
stage3d({ cam, look: ctx.look }, sheet3(moon, [TL, TR, BR, BL]))                  // shadows on the floor, then the sheet
```

- A card is ordinary ops in sheet units (fills for its paper, not `paper()`);
  it is projected point by point, so strokes stay crisp and finishes land in
  perspective. Images become meshes.
- `sheet3(card, P, { dark, back, shadow })`: corners in texture order TL TR
  BR BL; `dark` defaults to the lamp's shading (`shadeOf(P)`); `back` is the
  card seen from behind.
- `project(cam, card, P, { dark, look })` projects one sheet by hand;
  `shadows(cam, casters, { clip, alpha })` lays several shadows down together
  so overlaps do not add up (always gather them). `proj3(cam, p)` puts 2D
  effects (a `glow`, words) over a 3D point.
- **The book**: `book3({ PW, PD, cover, spreads: [{ left, right, pieces }] })`
  and `book.draw({ turn, cam, look })`. `turn` counts leaves on the left: 0
  shut, 1 cover open on spread 0, 2 spread 1; a fraction is a leaf in the air.
  A piece `{ base: [[x0, z0], [x1, z1]], h, card, lean, rise, back, mesh }`
  lies flat while its spread is shut and stands as it opens; `x` is distance
  from the spine (negative on the left page), a base across the spine folds
  with both pages. A piece may stand an actor instead of a card: `{ base, h,
  actor, state, face }`. It turns with the page (front flat, three-quarter as
  it lifts, side upright, as far as the puppet has the views) and stays
  upright; `state` is its inputs or `u => inputs` with `u` the page lift
  (`fox-and-teapot.js`, the turn shot).
- Cut-outs are the whole trick: one silhouette per piece, no modelling. Shade
  by angle always (a sheet with no shading reads as a sticker), shadows on the
  page as well as the table.
- The camera is slow: keyframes of `{ eye, target }` eased with `ease.io`
  (moon-book.js `camAt`), one move per beat, still while the page acts. Never
  orbit continuously.
- Text goes on a sheet, not in the room.
- Anchor the book (`meta('anchor', { name: 'book' })`) and mark the crop
  (`meta('intent', 'crop')`): a room is bigger than the frame.

## Photos (the doodle look)

A found photo of a real object, cut out, is the subject; brush-pen doodles
change what it is. Only in the doodle look, only as the subject, only with a
recorded source and licence (museum open-access collections are the usual
source: The Met, Rijksmuseum, Smithsonian, CC0).

```bash
node cli/hdf.mjs find --kind cutout                # seven Met objects are in the store already
node cli/hdf.mjs photo teapot.jpg --name teapot --credit "Teapot, ca. 1755, The Met, CC0" \
  --source https://www.metmuseum.org/... --js work/<film>/photos.js
node cli/hdf.mjs import --v2 work/<film>/photos.js --licence CC0
```

It cuts the object out (`rembg` if on PATH, else a colour flood: `--flood`,
`--keep` for a file with alpha, `--punch u,v` to clear an enclosed hole),
traces its silhouette and colours, writes the cutout into the photos module
(which `import --v2` moves into the store), and writes `out/photo-<name>.jpg`:
the cutout on magenta (halos show) with the traced silhouette, and on paper
with a u,v grid every 0.1. **Look at it**: read the anchor points (spout,
hub, lip) off that grid for the doodle recipes.

```js
import { fromStore } from 'handdrawn/core/assets.js';
const IDS = ['teapot', 'fox'];
const PHOTOS = fromStore(IDS);
const tea = doesItsJob({ name: 'tea', photo: PHOTOS.teapot, spout: [0.005, 0.27], handle: [0.86, 0.1], actor: CAST.FOX });
export default film({ name, look: LOOKS.doodlePastel, timeline: seq(tea, ...), assets: IDS });
```

By hand: `pin(photo, { x, y, h, rot, flip, pivot })` places it, `photo(pl)`
draws it with a contact shadow, `on(pl, u, v)` maps photo units to the frame
(attach drawings with it so they move with the object), `rim(pl, side, t)`
walks its real silhouette, `mask(pl, kids)` draws on its surface,
`photoFront(pl, path)` lays part of it back over a drawing (someone lives
inside), `nightfall`, `glow`, `fx('nightShot', { k, lights })`. Drawings
come from `doodle()` / `pen()`, which draw themselves in stroke order.

Defects: a cutout with a halo or a chewed edge; a photo filling less than a
quarter or more than two thirds of the frame; a character on a busy photo
without a gouache body; drawings attached in frame pixels (they drift);
doodles that decorate the object instead of changing what it is; ink lines
after nightfall (invisible); drawings still arriving in the last 20% of a
shot; a photo with no recorded source and licence.

# The hand-drawn layer: four bridges into handdrawn

The handdrawn package (`handdrawn/`, the hand-drawn-film skill) draws display lists on Canvas 2D in
looks that feel made by a hand: chalk, ink, marker, crayon, felt tip. A davidup video borrows that
feeling in four ways, lightest first.

## 1. Accents over the frame (`v.hand()`)

```js
v.layer('hand');   // declare it under 'fx', so transitions cover the marks
const hand = v.hand({ look: 'chalkboard', ink: '#f5ecdf', colors: ['#f5ecdf', '#e9a23b', '#d4654a'], w: 4.5 });
hand.circle({ of: 'teapot', grow: 0.8, at: 7.6, dur: 0.7, color: 1, until: 10.5 });
hand.callout({ text: 'since 1755', of: 'teapot', grow: 0.8, dir: -Math.PI / 4, reach: 150, at: 8.3, until: 10.5 });
hand.underline({ of: 'three', at: 11.7, color: 1, until: 15 });
hand.write({ text: 'take a break', box: [1200, 820, 600, 120], size: 60, at: 16, hand: true });
```

What happens on `nv build`:

1. `build.mjs` writes `hdf/accents.json`: the marks, the look, the inks, the frame size.
2. `look.ts accents` renders every target alone (`of`, `to`) at `boxAt ?? at` and writes its
   on-screen box into `hdf/accents.resolved.json` (effects left out, so a drop shadow does not
   count; `grow` and `nudge` adjust). A target not on screen then stops the build, named.
3. `accents.mjs` writes `hdf/accents.js`, an hdf film with one shot as long as the video that draws
   each mark on over `[at, at + dur]`, takes it back over `[out, out + 0.3]` and drops it at
   `until`; it renders it with `hdf render --alpha webm` to `hdf/accents.webm` (only when the film
   changed: `hdf/accents.hash`). The contact sheet of that render is `.look/accents-sheet.jpg`.
4. The composition already plays `hdf/accents.webm` full frame on the `hand` layer (item
   `hdf_accents`), so the marks sit exactly on their targets, drawn on twos (12 fps) like
   everything hand-drawn.

The marks (every one takes `at dur until out color w boxAt grow nudge`):

| mark | target | own options | reads as |
|---|---|---|---|
| `underline` | `of` / `box` | `wavy`, `double` | "this word" |
| `circle` | `of` / `box` | `turns` | "this thing" |
| `arrow` | `from` point or `of`, `to` id / point / box | `curve`, `head` | "look here", cause and effect |
| `star` | `of` / `box` | `n` | "new!", a burst of delight |
| `highlight` | `of` / `box` | `alpha` | a marker band: light frames only (it multiplies) |
| `strike` | `of` / `box` | `double` | "not this" |
| `bracket` | `of` / `box` | `side`, `shape: 'curly'\|'square'\|'round'` | "these belong together" |
| `tick`, `cross` | `point` / `of` | | right, wrong |
| `question` | `point` | `size` | a doubt |
| `callout` | `of` / `box` | `text`, `dir` (radians, where the note goes), `reach`, `size`, `leader: 'arrow'\|'dot'\|'line'\|'none'` | a written aside with a leader |
| `write` | `box` (or `of`) | `text`, `size`, `wps` (words a second), `align`, `hand: true` (a drawn hand holds the tool and writes) | a note written as we watch |
| `scribble` | `box` | `dir` | energy, a doodle |

Looks (the `look` option; the inks replace its accent colours, `ink` its ink):

| look | tool | for |
|---|---|---|
| `chalkboard` | chalk with dust | dark frames |
| `paperInk` | ink pen with wobble | light frames, editorial |
| `whiteboard` | round marker | explainers, bright frames |
| `crayon` | wax crayon, thick | children, playful |
| `notebook` | felt tip | school, diary |
| `pencilMinimal` | graphite | quiet, minimal |

`color` is an index into `colors` or a role (`'ink'`); `w` is the pen in pixels at 1080. The
composition must be 16:9, 9:16 or 1:1 (hdf's formats); any size is scaled (1080 on the short side is
one hdf unit). Look at every mark once in a sheet at its time: does it hug its target, does it read
at a glance, does it end with its act?

## 2. A character on a sprite sheet

The house shelf has `fox-sprite` and `octopus-sprite` (idle, walk, wave). `v.character(id, 'fox-sprite',
{ from, to, y, h, t, then, until, layer })` walks it at its own stride (the sheet's `speed`, so the
feet stay planted: a short walk, or start it near its mark) and hands over to `then` on arrival; it
returns the arrival time (put a `star` or a line on it).

Any puppet or stick figure becomes a sheet:

```bash
cd handdrawn
node cli/hdf.mjs sprite stick:sam --states idle,walk,wave --alpha --look chalkboard --out ../videos/<slug>/hdf
node cli/hdf.mjs sprite fox --states idle,walk,happy --alpha --out ../videos/<slug>/hdf     # a store puppet
node cli/hdf.mjs find --kind puppet                                                          # what the store has
```

```js
const sam = v.spriteSheet('sam', 'hdf/sam-sprite-alpha.png');      // reads the json beside it
v.character('sam', sam, { from: 1350, to: 1750, y: 1040, h: 300, t: 12.5, then: 'wave' });
```

Draw the sheet in a look that reads on your ground (`--look chalkboard` for dark frames; the default
doodle ink disappears on dark). A new character the user draws goes through hdf first (the
hand-drawn-film skill: `hdf svg`, `hdf sketch`, `hdf stick`).

## 3. A hand-drawn film as a clip

When a character must act (talk with lip sync, point at something, write with chalk, react), write a
small hdf film in `handdrawn/work/<name>/` or the project's `hdf/` (the hand-drawn-film skill), with
`meta('intent', 'clip')` in its last frame and no backdrop, and render it:

```bash
cd handdrawn && node cli/hdf.mjs render ../videos/<slug>/hdf/wave.js --alpha webm --ar 16:9 --width 1920 --out ../videos/<slug>/hdf/out
```

then `v.asset('wave', 'video', 'hdf/out/wave-16x9-alpha.webm', { hasAlpha: true })` and
`v.add('wave', v.clip('wave', 1920, 1080, { x: CX, y: CY, start: 6, fit: 'fill' }), 'objects')`. A film
cut to the composition's beats: the hand-drawn-film skill's "Cut to the music" (`--cues-from`).

## 4. The hand as type and texture

- Fonts: `hershey-script-font` (joined cursive), `hershey-romans-font`, `hershey-cyrillic-font` on the
  house shelf; the user's own handwriting via `hdf hand` from a photographed sheet, then
  `hdf hand --export-ttf <id>` and `asset add out/<id>.ttf --kind font --family hdf-<id> --project <dir>`.
  A font is still (no wobble, no draw-on); words that write themselves are `hand.write`.
- Paper: `paper-warm`, `paper-kraft`, `paper-white`, `paper-ruled`, `paper-blueprint`,
  `paper-chalkboard` as `v.texture(id, { blend, o })` over the frame, or as a full-frame sprite
  ground under a light composition.
- Cut-out photos of real objects (the Met collection on the house shelf) are the doodle look's
  natural partner: a photo, then a chalk circle and a written note on it.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| a mark draws over a wipe | the `hand` layer is above `fx` | `v.layer('hand')` before `v.layer('fx')` |
| a circle swallows the frame | a wide target (and its shadow) | `grow: 0.75` to `0.85` |
| `'<id>' draws nothing at t` | the target is not on screen then | `boxAt` a time it is, or fix its `enter` |
| a mark is invisible | ink colour on a matching ground, or `highlight` on dark | another ink (`color`), `chalkboard` on dark |
| the marks lag the picture by a frame | drawn on twos | intended; for a mark exactly on a beat, start it a twelfth early |
| `hdf render failed` | the generated film threw | the message names the mark; `node handdrawn/cli/hdf.mjs only <project>/hdf/accents.js 30` renders one frame to debug |

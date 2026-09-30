---
name: new-video
description: Compose and render a new short video (5 to 90 s) that looks designed, not generated - kinetic typography, masked line reveals, colour-band wipes, counters and timers, camera pushes, particles, rings, aurora light and paper texture on davidup's deterministic engine - with hand-drawn accents from the handdrawn package drawn over it here and there (a chalk circle round the product, an underline, an arrow, a written note, a character that walks in), and photos, cut-outs, fonts, music beds and sound effects from the shared asset library. Optionally decomposes reference videos into shots, pacing, motion energy, palette, tempo and beats, and turns them into a style card. Works in a see-and-fix loop - contact sheets with change badges, full frames, onion skins of a move, a rhythm chart against the beat and the reference, and an automated legibility and pacing check - looked at after every pass. Use when the user asks for a new video, a promo, teaser, launch or product video, an explainer opening, a title sequence, an intro or outro, a social reel or short, "make it look like this reference", or any motion-graphics piece that should feel crafted and human. For a film that is hand-drawn from end to end use hand-drawn-film; for one edit to an existing composition use the davidup MCP tools.
---

# New video

A video here is a **program**: a project folder whose `build.mjs` writes an ordinary davidup
composition (`composition.json`) with the **kit** (`scripts/kit.mjs`), and asks the **handdrawn**
package for the hand-drawn layer. You never judge a frame from code: every pass ends with
pictures you open and look at (`nv sheet`, `nv frame`, `nv motion`, `nv rhythm`, `nv check`),
then you change the program and look at what moved.

```
brief.md ─► build.mjs ─► nv build ─► composition.json ──► nv sheet / frame / motion / rhythm / check ──► look ─┐
   ▲            │            └─ hand marks resolved to boxes ─► hdf film ─► hdf/accents.webm (alpha)        │
   │            └─ kit: items, tweens, recipes, library assets, beat grid                                  │
   └──────────────────────────── fix the top three things you saw ◄─────────────────────────────────────┘
refs/<video> ◄─ nv refs (shots, pacing, energy, palette, tempo)          nv render ─► renders/*.mp4 ─► .look/final/
```

The two wings and what each is for:

| davidup (the kit) | handdrawn (hdf) |
|---|---|
| type, shapes, photos and cut-outs, video, audio; crisp, exact, on the beat | the human mark: wobble, chalk, marker, crayon, a pen that writes |
| every title, card, counter, wipe, camera move, texture | 3 to 6 accents: circle, underline, arrow, callout, star, highlight, writing |
| sprites (a character's sheet), fonts (a hand exported as TTF) | the character itself when it must act (a film rendered with alpha) |

The worked example is `examples/nv-steep/` (a 21 s teaser: brief, build, the made bed, the
decomposed reference). Read its `build.mjs` before writing yours.

## The commands

Everything runs from the repo root as `node .claude/skills/new-video/scripts/nv.mjs <cmd>`
(written `nv <cmd>` below). `look`, `validate` and `render` run on bun (`~/.bun/bin/bun` is found
if bun is not on PATH).

| command | what it does | writes |
|---|---|---|
| `nv doctor` | bun, ffmpeg, skia, hdf deps, shelves | - |
| `nv init <dir> [--ar 16:9\|9:16\|1:1] [--dur 20] [--title]` | a project: `brief.md`, `build.mjs`, `assets/` (its shelf), `refs/`, `.gitignore` | the folder |
| `nv refs <video...> --into <dir>` | decompose references | `refs/<name>/{sheet.jpg, rhythm.png, palette.png, summary.md, decomposition.json}` |
| `nv study <video> --from a --to b --into <dir>` | one moment frame by frame | `refs/<name>/study-a-b-{strip,onion}.jpg` |
| `nv beats <audio> --into <dir>` | tempo, beat grid, rises of a track | `refs/<name>/{beats.json, music.png}` |
| `nv bed <dir> --mood bright\|calm\|mystery\|march [--tempo] [--bars 8]` | music made to measure on the project shelf, beats exact | `assets/` record `bed-<mood>-<bpm>` |
| `nv find <words> [--kind] [--media] [--dark --room top]` | search the asset library (`asset find`) | - |
| `nv assets <ids...> --out <png>` | a contact sheet of candidates | the png |
| `nv build <dir> [--force]` | run `build.mjs`, place and render the hand accents, validate | `composition.json`, `hdf/accents.*` |
| `nv sheet <dir> [--n 12 \| --at t,t \| --markers] [--from --to]` | contact sheet; CHANGED badges and `diff.jpg` against the last sheet | `.look/sheet.jpg`, `.look/diff.jpg`, `.look/history/` |
| `nv frame <dir> --at t[,t] [--hide ids \| --only ids]` | full-size frames; hide or isolate items or whole layers | `.look/frame-<t>.png` |
| `nv motion <dir> --from a --to b [--n 8]` | a move as a strip and an onion skin | `.look/motion-*.jpg` |
| `nv rhythm <dir> [--ref refs/<name>] [--full]` | motion over time: scene changes, holds, markers, beats, the reference's curve | `.look/rhythm.png` |
| `nv check <dir> [--safe broadcast\|social\|none] [--strict]` | contrast under every word, size, safe area, reading time, overlaps, crops, still spans, blank holes, validation; exit 1 on an error | `.look/check.jpg`, `.look/check.json` |
| `nv boxes <dir> --at t [--ids]` | where items are on screen at t | stdout, `.look/boxes-<t>.json` |
| `nv progress <dir> --at t` | the same moment across every sheet you made | `.look/progress-<t>.jpg` |
| `nv render <dir> [--draft] [--from --to]` | the mp4, the credits owed, and its own decomposition | `renders/<dir>-vN.mp4`, `.look/final/` |

## Procedure

"Look" means: open the picture with Read, say in one line what you see (not what you meant),
compare it with the brief, then act. Never skip a look to save time; never look twice at an
unchanged picture.

1. **Setup.** `nv doctor`. `nv init videos/<slug> --ar 16:9 --dur 20 --title "..."` (or where the
   user says). The davidup MCP server is optional: the kit and `nv` need none of it.
2. **Brief.** Fill `brief.md` from the request (one round of questions at most: what it is for,
   where it plays and its format, length, the one thing to remember, the copy, must-haves, sound,
   references). Write the copy yourself when the user gives only a topic; keep it short (a
   statement a shot, 2 to 6 words each).
3. **References (when given).** `nv refs <file> --into <dir>` for each. Look at `sheet.jpg` and
   `rhythm.png`, read `summary.md`. For a transition or a move worth stealing, `nv study` it and
   look at the strip and the onion skin. Then fill the **style card** in `brief.md`: pacing,
   palette, type, motion language, hand-drawn layer, texture (`references/references.md`). Take
   structure, rhythm, palette logic and motion ideas; never copy footage, logos, characters or
   exact layouts. With no reference, choose the style card from `references/craft.md`.
4. **Sound first, then the beat sheet.** Pick the bed: `nv bed <dir> --mood ... --tempo ...` (exact
   beats), a house bed (`bed-bright` 110.8 bpm, `bed-calm` 72 bpm; `v.bedBeats(id)`), or the user's
   track (`nv beats track.mp3`; look at `music.png` before trusting the tempo). Put acts on bars
   and hits on beats, and write the beat sheet (`t, dur, act, on screen, motion, hand-drawn, sound`).
5. **Find before making.** For every object, texture, character, face and sound in the beat sheet:
   `nv find <words>`, then `nv assets <ids> --out <dir>/.look/candidates.png` and look. The house
   shelf has Met cut-outs (teapot, cup, violin, watch, hourglass, lantern, helmet), paper stocks,
   the fox and octopus as sprite sheets, Hershey handwriting fonts, sound effects and beds. A file
   the user gives goes onto the project shelf with its licence
   (`asset add <file> --kind image|cutout|font|audio|video --name ... --licence ... --credit ... --project <dir> --shelf project`;
   a woff2 font also needs `--family`). Library display faces (Playfair, Anton, Bebas Neue, DM Sans,
   Space Grotesk, Caveat ...) live in `~/.davidup/library/fonts/`; put the ones you use on the
   project shelf the same way.
6. **Style frames.** Write `build.mjs` for the hero moment of each act first: layout, type, colour,
   no motion yet. `nv build`, then `nv frame <dir> --at <each hero time>`. **Look** at each at
   full size: one focal point, hierarchy, contrast, air, palette discipline
   (`references/craft.md`, "The frame"). Fix until each would work as a poster.
7. **Animatic.** Add entrances, exits, transitions and the camera on the beat grid. `nv build`,
   `nv sheet <dir> --n 16` and `nv rhythm <dir> [--ref refs/<name>]`. **Look** at both: does
   every act read in a second and a half, does something land on every marker, are there dead
   stretches (amber bands on the chart), does the curve have the arc the style card promised?
8. **Motion polish.** For each move that matters (the hook, each transition, the hero reveal),
   `nv motion <dir> --from a --to b` and **look** at the strip and the onion skin: staggers,
   overshoot, settling, paths, nothing arriving at once. `references/craft.md`, "Motion".
9. **The hand-drawn layer.** Add 3 to 6 accents with `v.hand()` (below), a character if the story
   has one, a texture. `nv build` renders them; `nv sheet <dir> --at <their times>` and look: does
   each mark hug its target, read at a glance, and leave before the next act?
10. **Check.** `nv check <dir>` until it prints 0 errors; fix or justify every warning (a flash
    that whites out a title for a beat is a choice; 24 px body copy is not). **Look** at
    `check.jpg`.
11. **Render and deliver.** `nv render <dir>` (a `--draft` first if the piece is long). Look at
    `.look/final/sheet.jpg` and `rhythm.png` (the encoded video, decomposed). Deliver: the mp4, the
    sheet, a line per act saying what it shows, and the credit line of every asset (`nv render`
    prints them; CC-BY and CC-BY-SA credits must appear in the video or its description).

Budget: two to four looks per phase are normal. When a fix does not improve the next picture,
stop and rethink the shot instead of nudging numbers. Log decisions in `brief.md`'s Log.

## Looking well

- Say what you **see**, then what the brief **wanted**, then the **gap**. "The title sits on the
  spout" is actionable; "looks good" is not.
- Fix the **top three** problems per pass, largest first: legibility and layout, then timing, then
  polish. `nv sheet` with the same times shows what changed (CHANGED badges, `diff.jpg`), so
  check only those.
- When a patch looks wrong and you cannot see why, isolate it: `nv frame <dir> --at t --only fx`
  (or `--hide hand`) shows what a layer paints alone.
- Still frames lie about motion. A move is judged with `nv motion` (or the final mp4), rhythm with
  `nv rhythm`, never from a sheet.
- `references/looking.md` has the review list: what to check on each kind of picture.

## The kit in one screen

```js
import { video, beats, EASE } from '../../.claude/skills/new-video/scripts/kit.mjs';
const v = video({ dir: import.meta.dirname, w: 1920, h: 1080, fps: 30, dur: 20, bg: '#17110d' });
const { CX, CY } = v;
const DISPLAY = v.font('playfair-bold');                    // a font record (or 'font:default', or a file)
v.music('bed-calm-80', { volume: 0.6 });
const g = v.bedBeats('bed-calm-80');                        // g.t(n), g.bar(b, beat), g.snap(t), g.period
const ACT = { hook: 0, product: g.bar(1), end: g.bar(5) };
for (const [n, t] of Object.entries(ACT)) v.marker(t, n);
v.layer('bg'); v.layer('objects'); v.layer('main'); v.layer('hand'); v.layer('fx');   // back to front

v.aurora('bg', { colors: ['#e9a23b', '#d4654a'], o: 0.24 });
const w = v.words('hook', 'Everything is fast.', { font: DISPLAY, size: 150, color: '#f5ecdf', t: 0.2, stagger: g.period / 2, from: 'scale' }, 'main');
v.whip(w.id, null, ACT.product - 0.05);
const pot = v.library('teapot').record;                     // a cut-out, pinned src, credit and licence
v.add('pot', v.sprite('teapot', 780, Math.round(780 * pot.h / pot.w), { x: 1340, y: 600,
  effects: [{ type: 'shadow', color: 'rgba(0,0,0,.55)', blur: 40, offsetY: 28 }] }), 'objects');
v.rise('pot', ACT.product + 0.1, { dy: 90, dur: 1.1 });
v.lineReveal('title', 'Steeped\nin patience.', { font: DISPLAY, size: 120, color: '#f5ecdf', x: 500, y: CY, t: ACT.product + 0.5 }, 'main');
v.wipe(ACT.end, { colors: ['#d4654a', '#e9a23b', '#f5ecdf'] });   // bands cover at ACT.end: cut under them
v.sfx('sfx-whoosh', ACT.end - 0.45);

const hand = v.hand({ look: 'chalkboard', ink: '#f5ecdf', colors: ['#f5ecdf', '#e9a23b'], w: 4.5 });
hand.circle({ of: 'pot', grow: 0.8, at: ACT.product + 1.6, color: 1, until: ACT.end });
hand.callout({ text: 'since 1755', of: 'pot', grow: 0.8, at: ACT.product + 2.3, dir: -Math.PI / 4, until: ACT.end });
v.texture('paper-kraft', { blend: 'overlay', o: 0.18 });
v.write();
```

Items default to anchor 0.5 (x, y is their centre); tweens throw at build time on an overlap.
The whole API (every item, recipe and option) is `references/kit.md`. Raw davidup is always
available underneath: `v.add(id, anyItem, layer)`, `v.tw(target, 'effects.0.radius', ...)`,
`v.behavior(...)`, `v.template(...)`, `$repeat` items (see `dotGrid` in kit.mjs).

## Hand-drawn, here and there

Four ways in, lightest first (`references/hand-drawn.md` has each in full):

1. **Accents over the frame** (`v.hand()`): `underline circle arrow star highlight strike bracket
   tick cross question callout write scribble`. Each targets an item (`of: 'title'`, resolved to
   where it is on screen at `boxAt ?? at`, drop shadows and glows left out) or a box, draws on over
   `dur`, stays until `until`, or is taken back at `out`. `grow` and `nudge` adjust what it hugs.
   `nv build` turns them into one hdf film drawn on no stock (`hdf/accents.js`) and renders it to
   `hdf/accents.webm` only when it changed. Looks: `chalkboard` (chalk, for dark frames),
   `paperInk` (ink), `whiteboard` (marker), `crayon`, `notebook`; `colors` become its accent inks.
   The composition must be 16:9, 9:16 or 1:1.
2. **A character on a sprite sheet** (`v.character(id, 'fox-sprite', { from, to, y, h, t, then })`):
   walks at its stride (the walk takes as long as the distance needs; the fox covers ~75 px/s at
   520 px tall, so walk it a short way or start it near), then idles or waves. Any puppet or stick
   figure becomes a sheet with `hdf sprite <puppet> --states idle,walk,happy --alpha` and
   `scripts/hdf-to-davidup.ts --sprites`.
3. **A hand-drawn film as a clip**: a character that acts, talks, points, writes: write a small
   hdf film (the hand-drawn-film skill), render it `--alpha webm`, place it with `v.clip()`.
4. **The hand as type or texture**: `hershey-script-font` (or the user's hand via
   `hdf hand --export-ttf`) as a font for a note; `v.texture('paper-warm' | 'paper-kraft', { blend })`.

Rules: 3 to 6 accents in a 20 s piece, each on a moment that deserves emphasis; one look for all
of them; accent inks from the palette; the hand layer sits under the transitions (`v.layer('hand')`
before `v.layer('fx')`).

## Sound

A bed under everything (loops to the end, fades out), a whoosh 0.3 to 0.45 s before each wipe
lands, a pop on each pop, ticks on a counter's beats, a ding or a tada on the end card. Keep sfx
volumes 0.4 to 0.6 under a bed at 0.5 to 0.7; the master bus limits and normalises to -14 LUFS.
House sounds: `sfx-pop boing ding tada tick whoosh whoosh-out marker chalk pencil eraser page-turn`.
A voice-over: record or synthesise it (macOS `say -o vo.wav --file-format=WAVE --data-format=LEI16@22050 "..."`,
or the user's recording), put it on the project shelf as audio, `v.sfx('vo', t, { volume: 1 })`,
and time the copy to it (`nv beats` gives its rises; `hdf align` gives word times for a sample).

## Pitfalls

- **Full-frame rectangles sliding off-canvas** blank the frame (a skia-canvas 3.0.8 bug: an
  opaque rect path at least the canvas's size, drawn under a transform and partly off-canvas,
  drops everything drawn before it). The kit rounds such rects by 1 px, which avoids it; a
  hand-written full-frame panel needs `cornerRadius: 1`.
- **Hand marks over transitions**: declare `v.layer('hand')` before `v.layer('fx')`; `v.hand()`
  reuses it. Marks that must end with an act take `until`.
- **Hand marks on things with shadows**: boxes are measured without effects; still use
  `grow: 0.8` on wide objects or the circle swallows the frame.
- **A mark's target must be on screen** at `boxAt ?? at`; `nv build` stops and names it otherwise.
- **Positions**: read an item's place back (`v.item(id).transform`, `v.boxOf(id)`) instead of
  retyping numbers; a word of `v.words()` is `${id}_w${k}`.
- **Everything stays until told**: set `exit` (or `until` on counters, `until` on marks) when an act
  ends, or old items linger under the next act.
- **Tween overlaps** throw at build time with both tweens named: end one before the other starts.
- **Tempo from audio** is an estimate (sparse pads can read 90 for 80): prefer a bed's recorded
  tempo (`v.bedBeats`), and look at `music.png` before cutting to a track.
- The first `nv sheet` after the accents film changes extracts its frames once (seconds per
  10 s of video); later looks reuse the cache.
- The davidup MCP `render_preview_frame` does not wire scratch surfaces, so masks, blur and glow
  preview differently from the render there; `nv frame` renders what the mp4 will show.
- Fonts: a woff2 on the project shelf needs `--family`; `font:default` is Inter Regular only.
- Text is one style per item; mixed styles are separate items (`v.words` lays them out).
- A `$repeat` compile makes at most 10,000 entries; counters make one item per value shown.

## When to reach further

`references/craft.md` (what makes motion design look expensive, with timings), `references/kit.md`
(the API), `references/hand-drawn.md` (the bridges), `references/references.md` (reading a
reference), `references/looking.md` (the review list). davidup's primitives are in the root
`README.md`; hdf's in `.claude/skills/hand-drawn-film/SKILL.md`; the asset library in
`assetlib/README.md`.

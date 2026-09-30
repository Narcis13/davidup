# The kit: every call

`scripts/kit.mjs`, plain ESM on node. A project's `build.mjs` imports it by relative path
(`nv init` writes the right one) and ends with `v.write()`. Units are composition pixels and
seconds; angles are radians. Everything returns plain davidup JSON, so anything the kit does not
wrap can be written raw (`v.add(id, item, layer)`, `v.tw(...)`, `v.items[id] = { $repeat: ... }`).

## The video

```js
const v = video({ dir: import.meta.dirname, w: 1920, h: 1080, fps: 30, dur: 20, bg: '#0d0f14',
                  audioMaster: { limiter: true, targetLufs: -14 }, comment });
v.W, v.H, v.CX, v.CY, v.dur, v.fps
v.write()                       // composition.json (+ hdf/accents.json, credits.json); prints a summary
v.toJSON()                      // the composition object
```

## Structure

| call | does |
|---|---|
| `v.layer(id, { blend, o, enter, exit })` | a layer above the ones before (declare them all at the top, back to front); returns the id; a second call with the same id is a no-op |
| `v.add(id, item, layer?)` | an item; in `layer` when named (an item a group lists goes in no layer) |
| `v.item(id)` | the item object (read its `transform`, set `exit`, push `effects`) |
| `v.group(children, { x, y, box, width, height, isolate, blend, ...flags })` | a group item; `box: true` gives it the frame's size so anchor 0.5 pivots on the frame centre |
| `v.template(id, name, params, layer, { start })` | a davidup template instance (`titleCard lowerThird captionBurst bulletList kenburnsImage`, `global:<id>`), its tweens from `start` |

## Items (plain objects, add them with `v.add`)

Common options on every item: `x y`, `s` (both scales) `sx sy`, `r` (radians), `a` (both anchors,
default 0.5) `ax ay`, `o` (opacity), and the flags `enter exit name visible effects`.

| factory | own options |
|---|---|
| `v.text(str, o)` | `font` (an id from `v.font`), `size`, `color`, `align` (centre when anchored at 0.5), `maxWidth`, `lineHeight`, `letterSpacing`, `weight`, `style`, `strokeColor`, `strokeWidth`, `shadow: { color, blur, offsetX, offsetY }` |
| `v.rect(w, h, o)` | `fill`, `stroke`, `strokeWidth`, `radius` (a frame-sized rect is rounded by 1 px automatically, see Pitfalls) |
| `v.circle(d, o)` | `fill`, `stroke`, `strokeWidth` (d is the diameter) |
| `v.poly(points, o)` | `fill`, `stroke` |
| `v.sprite(assetId, w, h, o)` | `tint`, `cycle` (a sheet's cycle), `frame` |
| `v.clip(assetId, w, h, o)` | `start`, `end`, `trimIn`, `trimOut`, `fit` (cover), `loop`, `keepAudio` |

Effects: `effects: [{ type: 'blur', radius }, { type: 'shadow', color, blur, offsetX, offsetY },
{ type: 'glow', color, radius }]`, tweened as `effects.<i>.<field>`. Blend modes only on groups
and layers.

## Tweens

| call | does |
|---|---|
| `v.tw(target, prop, from, to, start, dur, ease)` | one property; `prop` shorthands `x y sx sy r o ax ay`, anything else passes through (`fillColor`, `letterSpacing`, `width`, `effects.0.radius`) |
| `v.anim(target, start, dur, { y: [a, b], o: [0, 1], s: [0.9, 1] }, ease)` | several at once; `s` is both scales |
| `v.behavior(name, target, start, dur, params, ease)` | a built-in behavior: `fadeIn fadeOut popIn popOut slideIn slideOut rotateSpin kenburns shake colorCycle pulse` |

An overlap with another tween of the same target and property throws at build time, naming both.

Easing names: davidup's 19 (`easeOutExpo` ...), short aliases (`in out inOut inQuad outQuad
inQuart outQuart inExpo outExpo inBack outBack sine outSine`), `steps(n)`, `{ bezier: [...] }`, and:

| alias | curve | for |
|---|---|---|
| `snap` | `[0.16, 1, 0.3, 1]` | entrances: fast out, long soft landing (the default) |
| `swift` | `[0.65, 0, 0.35, 1]` | moves, wipes, the camera |
| `punch` | `[0.34, 1.56, 0.64, 1]` | pops and stamps: a little overshoot |
| `accel` | `[0.7, 0, 0.84, 0]` | exits: leaves fast |
| `glide` | `[0.45, 0, 0.55, 1]` | drifts and ambient loops |

## Entrances, exits, emphasis

All return the time the move ends.

| call | move |
|---|---|
| `v.rise(id, t, { dy = 60, dur = .7, ease = 'snap', fade = true })` | up into place, fading in (sets the item's opacity to 0 until then) |
| `v.pop(id, t, { from = .4, dur = .5, ease = 'punch' })` | scales in from `from`, overshooting |
| `v.leave(id, t, { dy = -40, dur = .4, ease = 'accel', s })` | out, fading |
| `v.fadeIn(id, t, dur)`, `v.fadeOut(id, t, dur)` | opacity |
| `v.trackIn(id, t, { from = 40, dur = 1.2 })` | letter-spacing tightens from `from` to the item's own |
| `v.drift(id, t0, t1, { s: [1, 1.05], x, y, r })` | a slow push-in across a hold |
| `v.kenburns(id, t0, t1, { s: [1, 1.1], x, y })` | the same, linear, for a photo |
| `v.shake(id, t, { amplitude = 12, cycles = 3, dur = .3, axis })` | a jolt on a hit |

## Text in motion

| call | makes |
|---|---|
| `v.lineReveal(id, str, { ...text, x, y, t, dur = .8, dir: 'up'\|'down', maskW, ease }, layer)` | the text (`${id}_t`) slides up out of a mask: the most useful title move. Returns the group id. |
| `v.lineHide(id, t, { dur, dir })` | the same, leaving |
| `v.words(id, str, { ...text, x, y, t, stagger = .08, dur = .55, from: 'up'\|'down'\|'scale'\|'blur'\|'fade', align, maxWidth, gap, colors }, layer)` | a word per item (`${id}_w${k}`), measured and laid out as one centred block, arriving one after another; grouped as `id` -> `{ id, ids, end }` |
| `v.typeOn(id, str, { ...text, x, y, t, cps = 18, until, caret = true }, layer)` | typed on a character at a time from `x` (left), a caret blinking at the end -> `{ id, ids, end }` |
| `v.counter(id, { ...text, from, to, t, dur, ease: 'out'\|'linear', format, prefix, suffix, until }, layer)` | a number counting, one item per value shown, grouped as `id` (fade or rise the group) -> `{ id, ids, end }`. A timer: `format: (s) => \`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}\`` |
| `v.measure(str, { font, size, letterSpacing, weight })` | a line's width as the renderer lays it out |
| `v.wrap(str, { maxWidth, ...measure })` | its lines |
| `v.boxOf(id)` | a text item's box `[x, y, w, h]` at rest (no parents, no tweens); `nv boxes` for the truth at a time |

## Lines, bars, rings

| call | makes |
|---|---|
| `v.bar(id, { x, y, len, thick, color, t, dur, dir: 'right'\|'left'\|'down'\|'up', ease, radius })` | a bar growing from (x, y): progress bars, underlines, chart bars |
| `v.line(id, { from: [x, y], to: [x, y], thick, color, t, dur, ease })` | a straight line drawn on |
| `v.ring(id, { x, y, d0, d1, width, color, t, dur })` | a ring expanding and fading: a shockwave on a hit |

## Transitions

All go on the `fx` layer (created if missing; declare it last but for texture).

| call | does |
|---|---|
| `v.wipe(t, { colors, dir: 'left'\|'right'\|'up'\|'down', dur = .9, stagger = .07 })` | bands of colour sweep in and cover the frame at `t`, then sweep out: switch the content at `t` (set the old act's items `exit: t`) |
| `v.flash(t, { color, dur = .3, o = .9 })` | a full-frame flash fading out |
| `v.iris(t, { color, x, y, dur })` | a disc of colour grows from (x, y) to cover at `t`, then fades |
| `v.zoomThrough(fromId, toId, t, { dur = .5, blur = 36, scale = 1.6 })` | the outgoing group pushes through the lens (bigger, blurred, gone), the next lands from behind |
| `v.whip(fromId, toId, t, { dir, dur = .45, blur = 28 })` | a whip pan with motion blur; either id may be null |

## Camera

`v.camera(id, children, [[t, { x, y, s, r }], ...], { layer, ease = 'swift' })`: a frame-sized
group pivoting on its centre, its children in frame coordinates; between two keys the values that
change ease. Put a whole act in a camera to push in, pan across a wide layout or tilt on a hit.
Parallax: two cameras with the same keys scaled differently (the background moves less).

## Backgrounds and texture

| call | makes |
|---|---|
| `v.aurora(layer, { colors, blur = 150, o = .35, t0, t1, seed })` | big blurred blobs drifting: light, depth, never a flat field |
| `v.dotGrid(layer, { gap = 64, size = 5, color, o = .18, ripple: { t, x, y, speed, peak } })` | a `$repeat` grid of dots; a ripple swells them outward from (x, y) at `t` (a drop) |
| `v.texture(libId = 'paper-warm', { blend = 'multiply', o = .5, layer = 'texture', drift })` | a library stock over the frame on a blended layer: `overlay` or `soft-light` at 0.12 to 0.25 on dark frames, `multiply` at 0.3 to 0.6 on light ones |
| `v.particles(layer, { x, y, t, n = 36, dur = 1.1, radius: [a, b], size: [a, b], colors, seed, gravity })` | a seeded burst |

## The library and fonts

| call | does |
|---|---|
| `v.library(libId, { as })` | registers a record of the project, user or house shelf with its pinned `asset:<id>@<sha>` src, credit and licence -> `{ id, record, sheet }` (`record.w/h/sec/colours/dark/room`) |
| `v.font(ref, { family, as })` | `'font:default'` (Inter Regular, bundled), a font record id, or a file path -> the id a text item names |
| `v.asset(id, type, src, extra)` | a raw composition asset (a path relative to the project) |

`credits.json` collects every library record's licence and credit; `nv render` prints them.

## Sound and time

| call | does |
|---|---|
| `v.music(ref, { start, end, volume = .8, fadeIn, fadeOut = 1.2, loop = true, trimIn, markers })` | a bed (a library id or a path), looping to the end |
| `v.sfx(ref, t, { volume = .7, end })` | a sound at t |
| `v.marker(t, name)` | a named moment (the acts): `nv rhythm` and `nv sheet --markers` read them |
| `beats({ bpm \| period, offset, perBar = 4, dur })` | a grid: `g.t(n)`, `g.bar(b, beat)`, `g.snap(t)`, `g.times`, `g.period`, `g.markers(name, { every })` |
| `v.bedBeats(libId)` | the exact grid of a `synth sample` bed (house or `nv bed`) |

## Hand-drawn

```js
const hand = v.hand({ look: 'chalkboard', ink: '#f5ecdf', colors: ['#f5ecdf', '#e9a23b', '#d4654a'], w: 4.5 });
hand.underline({ of: 'title', at: 2.1, dur: 0.45, color: 1, wavy, double, until, out });
hand.circle({ of: 'pot', grow: 0.8, nudge: [0, 10], at: 3, dur: 0.6, turns: 1.1, until: 6 });
hand.arrow({ from: [x, y] | of: id, to: id | [x, y] | [x, y, w, h], at, curve: 0.25, head });
hand.star({ of: 'cup', at, n: 10 });           hand.highlight({ of: 'word', at, color, alpha });
hand.strike({ of, at, double });                hand.bracket({ of, side: 'left', shape: 'curly', at });
hand.tick({ of | point, at });  hand.cross({ of | point, at });  hand.question({ point, size, at });
hand.callout({ text: 'since 1755', of: 'pot', dir: -Math.PI / 4, reach: 150, size: 56, leader: 'arrow', at });
hand.write({ text: 'take a break', box: [x, y, w, h], size: 56, wps: 2.5, align, hand: true, at });
hand.scribble({ of | box, at });
```

Every mark takes `at` (start), `dur` (draw-on), `until` (gone), `out` (taken back from `out` over
0.3 s), `color` (an index into `colors`, or a role: `'ink'`), `w` (pen, px at 1080), `boxAt`
(when to measure `of`, if not `at`), `grow` and `nudge` (adjust the measured box). `look` is any
hdf preset: `chalkboard`, `paperInk`, `whiteboard`, `crayon`, `notebook`, `pencilMinimal`,
`risoPop`, `doodlePastel`. `v.character(id, 'fox-sprite', { from, to, y, h, t, then, until, layer })`
walks a sprite sheet's character in at its stride and returns the arrival time.

## Pitfalls

- A rect at least the frame's size that moves partly off-canvas blanks the frame in skia-canvas
  3.0.8; the kit rounds its corners by 1 px (invisible), so `v.rect` and the transitions are safe.
  A hand-written item needs `cornerRadius: 1`.
- `v.rise`, `v.pop` and `v.fadeIn` set the item's resting opacity to 0 (it appears when the tween
  starts); call them once per item.
- Set `exit` on an act's items at the act's end (`v.item(id).exit = t`, or `exit` in the options);
  a group's exit takes its children with it.
- `v.words`, `v.counter`, `v.typeOn` wrap their items in a group `id`: move, fade or `leave` the
  group, not the words.
- Text anchored at 0.5 is centred on its measured block (davidup's box mode), so `y` is the block's
  middle, not its baseline.

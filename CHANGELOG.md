# Changelog

Entries that change existing render output are marked **⚠ pixel-changing**
and cite the behavior/expansion version marker that moved
(`BEHAVIOR_EXPANSION_VERSION` in `src/compose/behaviors.ts`,
`SCENE_EXPANSION_VERSION` in `src/compose/scenes.ts`,
`TEXT_LAYOUT_VERSION` in `src/engine/textLayout.ts`).

## Unreleased

### Cubic-bezier and steps easings

- A tween's `easing` can now be `{ "bezier": [x1, y1, x2, y2] }` (CSS
  `cubic-bezier`, `x1`/`x2` in [0, 1], `y1`/`y2` may overshoot) or
  `{ "steps": n }` (CSS `steps(n)`, `jump-end`, integer `n` ≥ 1) as well as
  one of the 19 names. Accepted in compositions, `$behavior` blocks,
  templates and scenes, and by `add_tween`, `update_tween` and
  `apply_behavior`.
- The bezier solver works like the browser one (Newton–Raphson, then
  bisection) using only arithmetic, so node and browser renders get the same
  values. It matches Chromium to 1e-6 (`ease` at 0.5 is 0.8024033876). No
  caching. Existing names render exactly as before.
- Schema: exported `EasingSchema`, `BezierEasingSchema`, `StepsEasingSchema`.
  The object forms reject unknown keys, so `{ bezier, steps }` is an error.
  A value that matches no form gets an `E_SCHEMA` message listing the names
  and both forms; out-of-range numbers keep their specific path
  (`tweens.0.easing.bezier.2`).
- `list_easings` adds `parametric` (syntax, example and description for each
  form); `list_engine_capabilities` adds `parametricEasings`.
- `davidup/easings` exports `cubicBezier`, `steps`, `formatEasing`,
  `PARAMETRIC_EASINGS` and the `Easing` / `BezierEasing` / `StepsEasing`
  types. `getEasing` accepts any `Easing`.
- Editor: the command schema takes the object forms. The Inspector's easing
  dropdown (tween panel and "+ animate") adds `cubic-bezier…` and `steps…`
  with number fields. Timeline tooltips show `cubic-bezier(…)` / `steps(n)`.

### `$repeat` blocks in compositions, templates and scenes

- `{"$repeat": {"count": 3, "as": "i", "id": "dot${i}"}, "item": {…}}` as an
  `items` entry, or `{"$repeat": {"count": 3, "as": "i"}, "item": {…}}` in a
  `tweens` array, generates `count` entries. `count` is an integer 0–500,
  literal or an expression (`"${params.count}"`); `as` (default `i`) names the
  loop variable, usable in every `${…}` of the body (`"${i * 40}"`,
  `"dot${i}"`).
- Ids: items default to `${key}__r${i}`, or the header's `id` pattern. Layer
  and group `items` lists that name the key get the produced ids in its place.
  A tween `id` that doesn't interpolate a loop variable gets `__r${i}`
  appended; `$behavior` blocks without an id derive theirs as before.
- Blocks nest (grids) up to 4 levels with distinct `as` names; one items map
  or tweens list may produce at most 2000 entries. Violations throw the new
  `E_REPEAT_INVALID` with `details: { path, reason }`.
- Where it expands: root blocks in a new precompile pass before
  `expandTemplates` (so a root repeat may produce template / scene instances
  and behavior blocks); template and scene blocks during instance expansion,
  with the instance's params bound. A repeat inside a scene may not produce a
  `$template` instance (scene-local templates expand before scene params bind).
- Expressions gain loop variables as bare identifiers and computed param
  lookup `params['y' + (i + 1)]`; inside the brackets `+` may join numbers onto
  strings. Everywhere else string + number stays an error.
- Source maps: products point at the authored block with the new
  `originKind: "repeat"` (template / scene instances it produced keep
  `template` / `scene`).
- `bulletList` is rewritten on `$repeat` with a `count` param (1–6, default 3),
  optional `bullet2`..`bullet6` and `y4`..`y6` (defaults 580 / 640 / 700). Item
  ids stay `b1`..`bN` and every shipped example compiles byte-identically.
  `list_templates` / `list_scenes` report a repeat entry's id pattern in
  `emits` (`"b${i + 1}"`, or `"key__r${i}"` without an `id`).

### Template and scene param expressions

- `${…}` placeholders in template and scene bodies now evaluate expressions:
  number and `'string'` literals, `params.X` / `$.X`, `+ - * / %`, unary
  minus, parentheses, `min()`, `max()`, `round()`. `+` adds numbers or joins
  two strings; anything else needs numbers. No other function calls, no
  nested property access, no JS evaluation. Limits: 256 characters, 64
  tokens, 16 nesting levels.
- Interpolation: `"Hello ${params.name}!"` splices the value into the string
  (`$${` escapes a literal `${`). A string that is exactly one `${expr}`
  returns the raw result, so `"${params.stagger * 2}"` stays a number.
- Compatibility: a bare `${params.X}` / `${$.X}` still returns the value
  unchanged (any JSON type), and a `${…}` that references neither `params.`
  nor `$.` (e.g. `"costs ${price}"`) passes through untouched. Every shipped
  example compiles byte-identically. **Behavior change:** strings that
  embedded `${params.X}` mid-text used to pass through literally; they now
  interpolate.
- New error code `E_TEMPLATE_EXPR` for malformed or mistyped expressions,
  with `details: { path, expression, position }` and a caret in the message.
  Type errors name the declared param type (`params.title (string)`).
  Division or modulo by zero and non-finite results are errors.
- `bulletList` drops its `stagger2` param: the third bullet starts at
  `${params.stagger * 2}`. Passing `stagger2` is ignored (unknown params
  always were), and the default timing is bit-identical.
- Exported from `src/compose/params.ts`: `evaluateExpression`,
  `EXPR_MAX_LENGTH`, `EXPR_MAX_TOKENS`, `EXPR_MAX_DEPTH`.

### Text v2: wrapping, multiline, anchors on text, stroke, shadow ⚠ pixel-changing

- **BREAKING (`TEXT_LAYOUT_VERSION` 1 → 2):** anchors now act on text. A text
  item with a non-zero `anchorX`/`anchorY` switches to box mode: `(x, y)` is
  the top-left of the text block (first baseline `0.8 × fontSize` below), and
  the anchor pivots on the measured block. Before, text anchors did nothing.
  A centred title with `align: "center"` and anchor `0.5, 0.5` keeps its x
  and moves down by `0.2 × fontSize` (now vertically centred on `y`); anchor
  `1, 0` moves down by `0.8 × fontSize`. Text with anchor `0, 0` and no
  `maxWidth` renders exactly as before. Shipped examples with anchored text
  (`davidup-demo-90s`, `launch-video`, `editor-demo`) move accordingly;
  `video-bg-text` now uses anchor `0, 0` so it keeps its pixels.
- New optional text fields: `maxWidth` (greedy word-wrap; also selects box
  mode), `lineHeight` (× fontSize, default 1.2), `letterSpacing` (px),
  `fontWeight`, `fontStyle`, `strokeColor`/`strokeWidth` (drawn over the
  fill, round joins), `shadow {color, blur?, offsetX?, offsetY?}` (cast by
  the fill). `\n` is a line break in both modes.
- New tweenables on text: `letterSpacing`, `lineHeight`, `strokeWidth`.
- MCP `add_text` / `update_item` accept every new text field; on
  `update_item`, `maxWidth: null` returns to point mode and `shadow: null`
  removes the shadow. The editor Inspector edits them (compound shadow
  input), and `get_composition` / the editor's command round-trip no longer
  drop them.
- `Canvas2DContext` gains `measureText`, `strokeText`, `lineJoin`, the four
  shadow properties and an optional `letterSpacing`. Custom contexts must add
  them.
- Layout is exported from `davidup/engine`: `layoutText`, `wrapText`,
  `isBoxText`, `textFontString`, `applyTextStyle`, `TEXT_LAYOUT_VERSION`.
- Browser driver: the pick buffer paints every laid-out line at the rendered
  position, and the selection ring uses measured extents instead of the
  `fontSize × 0.6` guess.
- Determinism: new `text-v2` golden (captured on darwin-x64; other platforms
  skip it until regenerated there). The golden coverage check now allows a
  platform entry to lag behind a new example. Existing goldens are unchanged.
  The node↔browser parity fixture gains a wrapped, anchored, stroked,
  shadowed text block (mean diff 1.6, limit 6).
- Not in this change: MCP `add_text`/`update_item` params and the editor
  Inspector (Session 14), stagger reveal and `measure_text`.

### Time-range render, PNG sequence export, ranged thumbnail strips

- `renderToFile` gains `range?: { from?, to? }` (seconds). Both ends are
  clamped to the composition; the first frame is the one at or before `from`
  and `ceil((to − from) × fps)` frames are rendered. With `audio[]`, the mux
  mixes on the full timeline and cuts the mix at the window start
  (`timelineOffset` on `muxAudioTracks` / `buildAudioFilterComplex`), so fades
  and loops sound as they would in a full render. An empty window throws
  `RangeError` before any work. Helper: `resolveRenderRange`.
- PNG sequences: an `outPath` ending in `%0Nd.png`, or `format: "png-sequence"`
  with a directory (which gets `%05d.png`), writes one skia-encoded PNG per
  frame, numbered from 1. No ffmpeg, no audio.
- CLI: `davidup render --from=<s> --to=<s>`, and `--frames <dir>` in place of
  `-o`.
- MCP: `render_to_video` takes `from`/`to` (standalone and editor render
  queue); `render_thumbnail_strip` takes `from`/`to` and samples inside that
  window, so its "sample a narrower time range" hint can now be followed.
- Renders without a range are unchanged.

### Keep a video item's own audio (`keepAudio`)

- Video items gain `keepAudio?: boolean`. At render, `renderToFile` lowers each
  such item into an `audio[]` track `<itemId>__audio` whose asset is the video
  itself; the mux reads the file's first audio stream (`[n:a:0]`). The track
  mirrors `start`, `end` and `trimIn`, stops where `trimOut` exhausts the
  source, and loops over `[trimIn, trimOut)` when the clip loops. Hidden clips
  stay silent. Renders without `keepAudio` are unchanged.
- The lowering is exported as `synthesizeVideoAudio` (plus `videoAudioTrackId`,
  `VIDEO_AUDIO_TRACK_SUFFIX`) from `davidup/compose`. It runs inside
  `renderToFile`, not `precompile()`, because the editor and CLI keep
  precompiled compositions and would otherwise duplicate the tracks.
- Audio tracks may now reference a video asset at mux time
  (`resolveAudioInputs`); the MCP `add_audio_track` tool still requires an
  audio asset.
- Video assets gain `hasAudio?` from ffprobe at `register_asset`. The validator
  warns `W_VIDEO_NO_AUDIO_STREAM` when `keepAudio` names a source probed with no
  audio stream, and the render skips that item's audio.
- `add_video` / `update_video` accept `keepAudio`; the editor Inspector has a
  "keep audio" checkbox. Inspector edits to video-only fields (start/end/trim,
  fit, loop, keepAudio, and the reset-trim button) now go through
  `update_video`. They used to go through `update_item`, whose command schema
  silently dropped them.

### Audio limiter, loudness target, per-track loop

- **Output-changing (audio only):** every muxed render now runs the mix
  through a lookahead limiter (`alimiter`, −1 dBFS ceiling, no auto-gain,
  latency-compensated), so overlapping music + voiceover can no longer clip.
  Mixes that never came near 0 dBFS are unaffected in level, but the audio
  bytes of every render with `audio[]` change. Video pixels and the
  expansion markers are untouched. Opt out per composition with
  `composition.audioMaster: { limiter: false }`.
- `composition.audioMaster.targetLufs` (−70…−5) normalises the mix to an
  integrated loudness with two-pass `loudnorm`: an extra ffmpeg analysis pass
  measures the mix, the mux pass applies one linear gain. Settable via
  `set_composition_property` (`property: "audioMaster"`, object value, `null`
  to reset) and the editor's Composition settings dialog.
- Audio tracks gain `loop?: boolean`: the source repeats (from `trimIn`) until
  `end`, or the composition end when `end` is omitted. Accepted by
  `add_audio_track` / `update_audio_track`, the editor Inspector (checkbox) and
  timeline (loop chip + repetition seams). A looping track without `end` no
  longer warns about running past the composition.
- New exports: `buildLoudnormAnalysisArgs`,
  `buildLoudnormAnalysisFilterComplex`, `parseLoudnormMeasurement`,
  `MUX_LIMITER_CEILING_DB`, `MUX_LOUDNORM_TRUE_PEAK`, `MUX_LOUDNORM_LRA`, types
  `LoudnormMeasurement` and `AudioMaster`. `buildAudioFilterComplex` takes
  optional `master` and `measurement` arguments.

### Alpha export (ProRes 4444 `.mov`, VP9 `.webm`)

- `composition.background: "transparent"` now clears instead of filling, so
  pixels no item draws stay alpha 0 (the rawvideo input was already RGBA).
  Opaque backgrounds render exactly as before; no pixel or expansion marker
  moved.
- The codec union gains `prores_ks` (ProRes 4444, `yuva444p10le`, `.mov`) and
  `libvpx-vp9` (constant-quality, `yuva420p`, `.webm`) on `renderToFile`,
  `davidup render --codec=…`, `render_to_video`'s `codec` param and the editor
  render queue. ProRes ignores `crf`/`preset`; VP9 ignores `preset`.
- Container/codec mismatches (ProRes not in `.mov`, VP9 not in `.webm`,
  H.264/H.265 in `.webm`) are rejected before any work with
  `E_CONTAINER_CODEC` — a `RenderOptionsError` from `renderToFile`, a
  `RenderError` from `renderComposition`, exit 2 from the CLI, and a new MCP
  error code.
- Audio mux keeps `-c:v copy`: the silent temp video now shares the output's
  container, audio is Opus in `.webm` (AAC elsewhere), and `-movflags` is
  never passed to the WebM muxer. The editor defaults an extension-less output
  to the codec's container and lists `.mov` / `.webm` renders.
- New exports: `VIDEO_CODECS`, `ALPHA_CODECS`, type `VideoCodec`,
  `checkContainerCodec`, `defaultContainerExtension`, `defaultPixFmt`,
  `RenderOptionsError`.

### Colour-space tagging on output — **⚠ pixel-changing**

- Rendered MP4s are now converted RGB→YUV with the **BT.709** matrix at TV
  range and tagged to match: `color_space`, `color_primaries` and
  `color_transfer` are `bt709`, `color_range` is `tv`. Previously ffmpeg used
  its implicit BT.601 matrix and wrote no tags, so players and NLEs had to
  guess (and typically guessed BT.709, shifting colours). The tags are set on
  the stage-1 encode and survive the audio mux (`-c:v copy`).
- Encoded bytes change (different matrix). Pre-encode frame goldens and the
  expansion caches are unaffected, so no expansion version marker moved.
- New option `colorProfile: "bt709" | "untagged"` on `renderToFile` (default
  `bt709`), `davidup render --color=…`, and `render_to_video`'s `colorProfile`
  param (also accepted by the editor render queue). `untagged` reproduces the
  old argv exactly. New export: `COLOR_PROFILES`, type `ColorProfile`.

### Rational frame rates (23.976 / 29.97 / 59.94)

- `composition.fps` accepts an exact rational string `"N/D"` as well as a
  number, e.g. `"30000/1001"`. The render passes `-r 30000/1001` to ffmpeg and
  the video extraction filter uses `fps=30000/1001`, so the MP4's
  `r_frame_rate` is exactly NTSC and cuts line up with camera footage. Frame
  times are `i * den / num`.
- Numbers are unchanged: `29.97` stays a decimal (no NTSC snapping), and
  existing compositions render byte-identically.
- `create_composition`, `set_composition_property` and `davidup render --fps`
  accept the rational form. `probeVideo` also returns `fpsRational` (the
  exact rate ffprobe reported). The editor's composition settings offer
  24 / 25 / 30 / 50 / 60 / 23.976 / 29.97 / 59.94, with the NTSC rates stored
  as rationals.
- New schema exports: `FpsSchema`, `fpsRational`, `fpsValue`, `frameTime`,
  `framesForDuration`, `fpsArg`, `isRationalFps`.

### Bounded-memory video frame decoding

- Video frames are no longer all decoded into memory before a render. The node
  driver keeps a sliding window per clip (2 behind, 16 ahead of the playhead,
  wrapping for `loop`), prefetches the read-ahead in the background and caps
  residency at `preExtract.maxDecodedFrames` (default 64 per clip). Output is
  byte-identical; a 10 s 1080p30 full-frame clip peaked at 261 MB RSS vs 399 MB.
- API: `VideoClip` gains an optional async `prepare()`; hosts that draw with a
  windowed provider await the new `prepareVideoFrames(comp, t, provider)`
  before each `renderFrame` (`renderToFile` and the MCP preview tools do).

### Even composition dimensions are validated (B-2)

- `validate` reports **`E_DIMENSION_ODD`** for an odd composition `width` or
  `height` (libx264 + yuv420p rejects them), so `davidup render` / `render_*`
  fail with `E_VALIDATION_FAILED` up front instead of an ffmpeg stderr tail.
  Previously-"valid" odd-sized compositions now fail validation.
- New warning **`W_DIMENSION_LARGE`** when either axis exceeds 4096px.
- `create_composition` / `set_composition_property` return the same codes
  eagerly as `issues[]` / `warnings[]` on their result (omitted when clean).

### ⚠ Video extraction v2 — video items honour `fit` (B-1)

- **`fit` now works.** Frames were pre-extracted stretched to the item's
  `width × height` box (`scale=W:H`), so `contain`, `cover`, `fill` and `none`
  all rendered the same stretched image. Frames are now extracted at the
  source's aspect ratio (native size, capped so the longest side does not
  exceed the box's longest side × `max(|scaleX|, |scaleY|)`; never upscaled),
  and the draw-time fit letterboxes (`contain`), crops (`cover`), stretches
  (`fill`) or centres 1:1 (`none`).
- Any composition whose video box aspect differs from its source renders
  differently. Matching-aspect boxes change only by resampling (skia scales at
  draw time instead of ffmpeg at extract time). Old frame-cache entries miss
  and re-extract — no migration. Driver-level marker
  `VIDEO_EXTRACTION_VERSION` (`src/drivers/node/videoExtract.ts`) `1 → 2`.

## 1.0.0 — 2026-07-05

- **`davidup render` CLI** — headless MP4 render from a project directory, no MCP or JS required (Session 21, R-8).
- **npx packaging** — `tsc`-built `dist/` with node-shebang bins, dual `bun`/`default` exports, editor shipped prebuilt as `editor-dist/` (Session 22, R-9).
- **Video items** — `type: "video"` with `trimIn`/`trimOut`, `fit`, `loop`; ffprobe-backed `register_asset`, `add_video`/`update_video`, editor timeline trim handles.
- **Audio `trimIn`** — audio tracks seek mid-file independently of timeline `start`/`end` (R-11).
- **Compose lint** — validator warnings `W_ITEM_INVISIBLE_OPACITY`, `W_ITEM_OFF_CANVAS`, `W_FONT_UNREGISTERED`, `W_SCENE_INSTANCE_OUTLIVES` (§6.20).
- **Determinism harness** — golden frame hashes, `+bitexact` byte-identical MP4s, node↔browser pixel parity test (R-14, R-16).
- **Agent eval** — `bun run eval:agents` nightly authoring-success benchmark against a real MCP server (§6.21).
- **Launch video** — `examples/launch-video/`, a 26 s film authored entirely by an agent over MCP.

### ⚠ Expansion v2 — kenburns dual-axis zoom, declaration-order scene painting (R-4, R-24)

- **`kenburns` / `kenburnsImage` now zoom on both axes.** The `kenburns`
  behavior previously emitted a tween for `transform.scaleX` only, leaving
  `transform.scaleY` frozen at its initial value — every "Ken Burns" zoom
  rendered as a horizontal stretch, not a zoom. It now emits matching
  `scaleX` and `scaleY` tweens (the same dual-emit pattern already used by
  `popIn`/`popOut`). Any composition relying on `kenburns` or the
  `kenburnsImage` template will render differently — closer to the intended
  effect. `BEHAVIOR_EXPANSION_VERSION` bumped `1 → 2`.

- **Scene expansion no longer alphabetizes paint order.** `expandSceneInstance`
  built the synthetic group's child list via `Object.keys(def.items).sort()`,
  silently discarding the scene author's declaration order and substituting
  alphabetical order instead. An opaque item declared *after* its siblings
  (so it should paint on top) could end up painted *behind* them if its id
  happened to sort earlier — this was live-caught in a scene where a `panel`
  rect (alphabetically before `bar`/`label`) hid both of those items.
  Scene-local items now paint in declaration order. `SCENE_EXPANSION_VERSION`
  bumped `1 → 2`.

  Compositions that (knowingly or not) depended on the old alphabetized
  paint order — including any that were reordered/renamed as a workaround —
  should be re-rendered and checked.

### ⚠ Expansion v3 — scene instances clip to their own duration (R-26, R-27)

- **Scene instances now default to disappearing when their scene ends.** The
  synthetic group `add_scene_instance` / `type: "scene"` expansion produces
  previously carried no `enter`/`exit`, so once its tweens finished playing
  the instance held its last frame for the rest of the composition — a 4s
  scene instance placed at t=0 stayed visible even at t=30. The wrapper group
  now defaults `enter`/`exit` to `[start, start + effectiveDuration)`
  (`effectiveDuration` follows the instance's time-mapping mode: scene
  duration for identity/timeScale, `toTime - fromTime` for clip, `scene.duration
  * count` for loop). Pass explicit `enter`/`exit` on the instance to opt back
  into a custom or unbounded window. `SCENE_EXPANSION_VERSION` bumped `2 → 3`.

  Compositions that relied on a scene instance's last frame holding past its
  own duration should be re-rendered and checked; add explicit `enter`/`exit`
  to restore the old behavior for a specific instance if needed.

- **`remove_scene_instance` no longer deletes tweens it didn't add.** Removing
  an instance's wrapper group previously cascaded through the store's normal
  "drop tweens targeting a removed item" rule, so a separately-authored tween
  targeting the instance's synthetic group (the only target parent tweens may
  use, per §8.7) was silently deleted alongside the expansion's own tweens.
  `remove_scene_instance` now removes exactly the item/tween/asset ids its
  own `add_scene_instance` (or the most recent `update_scene_instance`) call
  produced; tweens authored separately against the same target survive.

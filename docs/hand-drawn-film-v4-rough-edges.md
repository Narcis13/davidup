# hand-drawn film 4.0: rough edges from the acceptance film

Found on 2026-09-23 while making the exit test of 4.0 (plan section 10), with the 4.0 skill:

- `handdrawn/work/moon/moon.js`, **"Why does the moon change shape?"**, a kids-7 lesson of 107.6 s in four
  chapters. Chapters 1, 3 and 4 are on the `whiteboard`, chapter 2 on `chalkboard~ghost:0.08`, and the
  sign-off is in the (stand-in) user's hand. The film is lint clean for kids-7 and plays its beat sheet
  (`hdf script --check`). Renders go to `out/moon-final.mp4` and `out/moon.html`.
- `handdrawn/work/moon/sam-moon.js`, the same `sam` as a 12 s chalk overlay with alpha. It plays in a 1920×1080
  davidup composition (`work/moon/davidup/composition.json`, rendered to `out/moon-real.mp4`) over Gregory H.
  Revera's photograph of the full moon. davidup sets the captions in the hand exported as a TTF. The clip's
  cuts follow the music track's `cut` markers: moving them from 4/8 s to 3.5/7.5 s moved the cuts. One
  `render_hdf_clip` call rendered, registered and placed it.

What the film exercises, item by item (section 10):

| # | item | how |
|---|---|---|
| 1 | title written by a hand; `sam` from a rig sheet walks on without sliding and presents | `titleCard` (hand) on its own, and `walkTo` with the planted foot; `perform` present/wave. `sam` is drawn into both rig sheets (`work/moon/sam-sheet.mjs`, `drawnRigSheet`), read by `hdf sketch`, with a face grafted on (RE-3) |
| 2 | narration with captions; `sam`'s mouth follows it | `moon-look` / `moon-sun` (macOS `say`, Samantha), word timing by faster-whisper (RE-6). `captions()` with `sam.mouth()` on the energy track (RE-7) |
| 3 | the moon labelled with leader lines and a circle-around | AO on a half-lit moon cel, then `circleAround` on the "bright side" label (RE-8) |
| 4 | eight phases counted with digits and a tally | AP on the chalkboard, the eight shapes as chalk cels (RE-15), "8 shapes" |
| 5 | the month as a ring with names on the path | AS: new, growing, full, shrinking, with a marker going round |
| 6 | the fox asks "de ce?", `sam` answers in a bubble | AY: *"pentru că Soarele o luminează doar pe jumătate!"*, with ă composed (T2) |
| 7 | a quiz with a ding over a calm bed | AW with `moon-ask`, a pop for each option, a tick for each wrong one, a ding, then `moon-yes`; `bed({ mood: 'calm' })` stops on a sting |
| 8 | sign-off in the user's hand | `hershey-script` stands in: no photographed sheet exists yet (RE-16) |
| + | the "why" itself | an orbit diagram on the chalkboard: the sun, the earth and the moon going round, always lit on the sun's side, leaving eight ghosts. An inset shows the shape the earth sees, timed to the words of `moon-sun` |
| D | overlay, font, cues, MCP | D1 `alpha: 'webm'`, D3 `hdf hand --export-ttf hershey-script` registered as a font, D4 `atMark('cut', { nth })` against the pad's markers, D5 `render_hdf_clip { film, alpha, width, place | item }` |

Each item below is one fix for a future session. None blocked the film; each cost a detour.

| # | where | what happened | fix |
|---|---|---|---|
| RE-1 | teaching recipes at 16:9 | The film started at `format: '16:9'`. Every teaching recipe (AN to AY, `chapter` cards) lays out on literal 1080-square coordinates, so a native 16:9 film draws them into the left 1080 px of the 1920 frame. None of `fit: anchor | reframe | letterbox` centres them (anchor assumes content is laid out round `CX`). A `wide()` wrapper had to redraw each recipe on the square and translate it, keeping the ground op and the anchors at the top level. | Have `recipe()` centre its layer on `CX` when the frame is wider than the square (a translate of `(W - 1080) / 2`), or give the teaching recipes a `fit: 'square'` that does it. Say it in the skill: "teaching recipes are 1:1". |
| RE-2 | lint `text-size` at 16:9 | After RE-1, 36 of 39 lint findings at 16:9 were `text-size`. Lint measures x-height "at 240 px wide", so the same lettering in the same 1080-high logical frame scores 1080/1920 of its 1:1 value. Every recipe's kids-7 size fails at 16:9 and passes at 1:1. The package's own rule is that the short side is 1080, so the rule contradicts it. The film moved to 1:1. | Measure against the short side (240 px on the short side), or scale `minX` by `min(W, H) / W`. Add a lint test that one lesson at 1:1 and at 16:9 gets the same `text-size` findings. |
| RE-3 | rig-sheet puppets have no face | `hdf sketch` reads a head as one drawing. With no `eye`, `pupil`, `brow-*` or `mouth` there is no lip sync (V3), no expressions (K3) and no pupils for `lookAt` (K5), yet the plan casts a rig-sheet `sam` who talks. `work/moon/graft-face.mjs` compiles a stick whose neck, head and radius match the sheet's (23 mm × K) and copies its five face parts into the sketch's two views. It works, and the model sheet shows every expression. | Offer it in `hdf sketch --face stick` (or add a face box to the face-on sheet: eyes and a mouth as separate boxes). Say in the rig sheet's instructions to leave the face off when you want one grafted. |
| RE-4 | `hdf sketch` colour roles | Colours go to the nearest *paperInk* house fill or accent, so on the whiteboard sam's skin came out in `fills.0` (light blue) and the jumper in `accents.1`. The darkest fill (dark trousers) became `ink`, the same role as the pen, so the parts could no longer be told apart by role. The graft script remaps roles per part. | Give `hdf sketch` the `--roles` map `hdf svg` has (hex → role, `ask`). Class skin tones to `fills.5` / `blush`. Keep a dark *fill* out of `ink` when the pen is darker still. |
| RE-5 | a paper-coloured fill on a sheet | The white pompom was read as paper and dropped, leaving an empty outline. The graft adds a `light` fill back. It first put that fill 28 mm too low (my bug). The whiteboard model sheet hid the bug because `light` is white on a white board; the chalkboard showed it. | Read a closed, filled shape inside a line as a fill even when it is near paper (it is `light`), and review model sheets in a dark look as well (`--look chalkboard`). |
| RE-6 | `hdf align` with whisper | faster-whisper, given the copy as `initial_prompt`, repeated the whole prompt at the end of the file as zero-length words. `fitWords` matched the ghosts: `moon-sun: 32 words over 0.20 s`, every word at 9.02 s, and the command reported success. The same happened to `moon-yes`. The workaround was to transcribe without the prompt and pass `--json`. | Drop trailing runs of zero-length words (or words past the audio's voiced end) before fitting. Fail when the fitted span is under 30% of the voiced span. Consider passing no prompt and fitting to the copy afterwards, which is what fitWords is for. |
| RE-7 | Rhubarb on the Intel Mac | Rhubarb 1.14 (macOS zip, quarantine cleared) segfaults on every wav with both recognizers (exit 139, empty stderr). `hdf align --mouth` throws `rhubarb failed (null):` with no stderr, which names neither the signal nor the fallback. The film uses the energy track V3 makes by default. | Report the signal (`r.signal`) and fall back to the energy track with a warning instead of throwing. Note it in the skill's lip-sync paragraph. |
| RE-8 | extending a teaching recipe | Ringing AO's "bright side" label with T7's `circleAround` meant rebuilding the label (position from `labelFroms`, size, seed) and its time (`labelPlan`) by hand, because both are private. Titles (`writerSounds` needs AN's title node) and AW (`quizTimes` exists) are the same. | Export `labelledTimes(o)` / `labelledBoxes(o)` and `titleNodes(o)` the way `quizTimes` and `hopTimes` are, or give the teaching recipes an `extras(ctx, parts)` hook that receives their built nodes. |
| RE-9 | `hdf script`: a quiz with `voice:` | In the voice branch the stub writes `voice(...)` but drops `quizTimes`: no tick for each wrong answer and no ding, though a quiz without a voice gets both. | Emit the quiz's ticks and ding in both branches, plus a pop for each option (`quizTimes.options`), as `quiz-time.js` does. |
| RE-10 | the moon test depends on a gitignored brief | `test/script.test.js` asserts the recipe order of whichever `work/moon/moon.md` is on the machine. The E5 session's brief was not on this machine, so the new brief (chapter 1 opens on its hand-written title, `card: false`; the talk moved to chapter 3) failed that line. The line was updated. | Commit the acceptance brief and film as fixtures (`films/moon.js` + `films/moon.md`, as the v3 films are), or make the test assert only the round trip, not a recipe list. |
| RE-11 | one cel, two looks | The eight moon shapes are yellow (`fills.3`) on the whiteboard, but on the chalkboard `fills.3` is a muddy mustard and the shade grey. The phases read as grey discs, so a second set in `light` over `night` was needed for the chalk chapter. A cel's roles cannot depend on the look. | A role alias per look (`{ whiteboard: 'fills.3', chalkboard: 'light' }`) or a look-level role map (`moonLit` → per preset), so one cel draws right on both boards. |
| RE-12 | chalkboard ghost over dense shots | `~ghost:0.15` on the chalk chapter is lovely on the card (the whiteboard's labelled moon half-erased under "the sun lights half"). It is too busy under the counting shot, which already sits over the orbit diagram. Dropped to 0.08 for the whole chapter. | Let a shot opt out or set its own ghost (`shot(..., { ghost: 0 })`), or fade the ghost with the number of ops drawn over it. |
| RE-13 | `render_hdf_clip` with a film path | The placed item is named `hdf:/Users/.../work/moon/sam-moon.js`, so the machine's absolute path goes into the composition (the asset id is `hdf-sam-moon`, fine). | Name the item `hdf:<basename without .js>`, and keep the path in a field the bridge reads. |
| RE-14 | a davidup asset's credit | The moon photo is CC BY-SA 3.0 and must carry its credit. handdrawn's store has `licence` and `credit` on every entry, but a davidup asset has neither, so the credit lives in a README beside the composition. | A `credit` / `licence` on davidup assets (schema + `register_asset`), shown in the editor's Library. |
| RE-15 | no film voice for a child | Narration is macOS `say` Samantha under a boy's mouth. The package rightly does not synthesise speech. Ioana (ro_RO) could voice the Romanian dialogue, but the bubbles stay unvoiced to keep one voice. | Nothing in the package; the skill's narration paragraph could list child-appropriate voices and piper models. |
| RE-16 | the user's hand | Item 8 wants the sign-off in the user's hand, and D3's font too. The store has no hand from a photographed sheet (`narcis` was never made). `HAND = 'hershey-script'` in `moon.js` is the one line to change, and `hdf hand --export-ttf <id>` remakes the font. | Photograph the three hand pages: `hdf hand latin.jpg symbols.jpg marks.jpg --name narcis`, then set `HAND = 'narcis'` and re-run `render_hdf_clip` and the font registration. |

## Timing

The plan guessed about 75 s. The E5 arithmetic gave 98 s for its brief, and this brief (which adds the orbit
diagram) gives 107.6 s: chapters of 29.0, 26.8, 28.1 and 21.3 s, and a 2.5 s sign-off. Every length is the
recipes' own at kids-7, the recordings' word timing, or the reading speed. None is written by hand.

## Assets added to the store

`sam-sheet` (the rig-sheet read, before the graft), `sam` (with the grafted face), and the samples
`moon-look`, `moon-sun`, `moon-ask` and `moon-yes` (macOS `say`, Samantha; aligned by faster-whisper `base`,
mouths from the energy track). All are licence `own`.

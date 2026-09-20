# Vertical showcase — 30 s, 9:16

A 1080×1920, 30 fps short for X / Reels / Shorts that puts every v1.1 feature
and the v1.2 fixes on screen, cut to the music (120 BPM, drops at 3.5 s and
24 s). It ends by shrinking into a phone screen that plays the film itself,
which then closes into the author's avatar and a Follow-on-X card.

```sh
bun run examples/showcase-vertical/render.ts              # → output/davidup-vertical-showcase.mp4
bun run examples/showcase-vertical/render.ts --stills 2,27.5   # single PNG frames for checking
```

| t (s) | Act | On screen |
|---|---|---|
| 0–3.5 | Hook | "THIS VIDEO IS A JSON FILE." inside a 960-dot iris from one nested `$repeat`, laid out with expression-driven rotation + a tweened `anchorX`; bezier implode into the drop |
| 3.5–6 | Logo | additive R/G/B wordmark (`isolate` + `lighter`), `shake` behaviors, glow, multiline tagline |
| 6–9 | Type | text v2 in four library fonts: wrap + breathing `lineHeight`, stroke→fill, tracking, hard shadow |
| 9–12 | Light | RGB Venn that flickers on through a **user-defined** executable behavior (`neonFlicker`), tweened drop shadow, `isolate` false vs true |
| 12–15 | Motion | six easings (incl. `bezier`, `steps(8)`) racing down lanes, replayed with `time: reverse` |
| 15–18.5 | Time | an orrery scene with nested groups (v1.2 ownership fix) under five time mappings, the five instances owned by one group and popping in on their own `size` box (v1.3 L-2/L-3) |
| 18.5–22.5 | Footage | `cover`-cropped b-roll with `keepAudio`, `fit` contain/cover, a circular mask, a ProRes 4444 overlay davidup rendered with alpha and composited back in |
| 22.5–24 | Hush | NO TIMELINE. / NO KEYFRAMES. / JUST JSON. |
| 24–26.4 | Reveal | the film in a rounded phone screen, playing itself (Droste, `--from/--to` range renders fed back in), compile stats |
| 26.4–30 | CTA | the screen closes into `global:assets/X_profile.png`, name + badge + handle, the library's `ctaButton` as a Follow button |

HUD: a single 900-entry `$repeat` frame counter (per-compile budget, v1.2),
code captions from an inline template, `steps(30)` REC dot, progress bar.

```sh
davidup render examples/showcase-vertical/composition.json -o out.mp4
```
renders the film too: `global:` asset srcs (B-5), the library's `ctaButton`
template named by id and the composition's own `neonFlicker` behavior (L-1)
all resolve through the CLI. `render.ts` exists for the *build* — it
regenerates `composition.json`, renders the ProRes alpha overlay, and feeds
each Droste pass back into the next. See `v1.3_showcase_findings.md` for the
other issues this example turned up.
Footage, music and SFX are shared with `../showcase-v1.1/assets/`. The fonts
and profile picture come from `~/.davidup/library`.

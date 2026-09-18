# v1.1 showcase — 30 s

A 1920×1080, 30 fps film that puts every v1.1 feature on screen, cut to the
music (120 BPM, drops at 3.5 s and 25.5 s). It ends by shrinking into a tilted
screen that plays the film itself, several levels deep, with the Mandelbrot
zoom at the bottom of the recursion.

```sh
examples/showcase-v1.1/render.sh        # 6 Droste passes + final → output/davidup-v1.1-showcase.mp4
```

| t (s) | Act | On screen |
|---|---|---|
| 0–3.5 | Ignition | `$repeat` 13×24 dot grid with expression-driven ripple; blur focus-pull; bezier implode |
| 3.5–6.5 | Logo | additive R/G/B wordmark in an `isolate` group with `lighter` children; `shake` behaviors; glow |
| 6.5–10 | Type | text v2: `maxWidth` wrap, `lineHeight`/`letterSpacing` tweens, stroke→fill, hard shadow, metric anchors, bundled `font:default` |
| 10–13.5 | Light | RGB Venn (isolated additive group + blur + glow), tweened drop shadow, `isolate: false` vs `true` |
| 13.5–17 | Motion | six easings incl. `bezier` and `steps(8)`; the same scene replayed with `time: reverse` |
| 17–21 | Time | one scene, five time mappings: identity, timeScale, loop, reverse, clip (auto-trimmed) |
| 21–25.5 | Footage | video items: `fit` contain/cover, circular mask via `destination-in`, Game-of-Life b-roll with `keepAudio` |
| 25.5–30 | Reveal | the Droste screen (`--from/--to` range renders fed back in), real compile stats, sign-off |

Also exercised: an inline template (`actCaption`), a 900-item frame counter
built from `$repeat` + `enter`/`exit`, `audioMaster` limiter + `targetLufs`,
two cut music tracks with fades, synthesized SFX, `--frames` PNG export.

Files: `build.mjs` writes `composition.json` (the authored JSON; everything
compiles down at render), `stats.ts` computes the reveal's numbers,
`assets/` holds the ffmpeg-generated footage (`mandelbrot`, `life`) and SFX.

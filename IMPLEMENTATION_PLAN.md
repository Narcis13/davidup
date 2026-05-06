# MotionForge v0.1 — Implementation Plan

The design doc (`design-doc.md`) is well-specified. Below is a phased plan with the key decisions to approve up front. Implementation total is ~1–2 weeks of focused work.

---

## Decisions to confirm

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | **Runtime** | Bun | Fast TS; works with skia-canvas + ffmpeg subprocess |
| D2 | **Package layout** | Single package, subpath exports (`./engine`, `./node`, `./browser`, `./mcp`) | Simpler than monorepo for v0.1; can split later |
| D3 | **Schema lib** | Zod | Runtime validation + inferred TS types in one place |
| D4 | **Test framework** | Vitest | Works in Bun/Node, fast, good snapshot support |
| D5 | **MCP SDK** | `@modelcontextprotocol/sdk` (stdio transport) | Official, matches §4 tool spec |
| D6 | **Server canvas** | `skia-canvas` | Stated in design doc §5.6 |
| D7 | **Browser demo** | Vite + minimal HTML page | Demo for the §3.1 hello-world; not part of the engine |

---

## External dependencies

- **ffmpeg** on `$PATH` (for `render_to_video`)
- **Bun** ≥ 1.x (or Node ≥ 20)
- macOS build tools for `skia-canvas` native build

---

## Phased build order

### Phase 1 — Foundation
- Init Bun project, TS strict, ESM, Vitest
- Layout: `src/{schema,engine,easings,assets,drivers,mcp}`, `tests/`, `examples/`, `assets/`
- `.gitignore`, `tsconfig.json`, basic `README.md`

### Phase 2 — Schema & validator (§3, §3.5)
- Zod schemas for `Composition`, `Asset`, `Layer`, `Item` union (`Sprite | Text | Shape | Group`), `Tween`, `Transform`
- `validate(json) → { valid, errors, warnings }`
- All 8 validation rules from §3.5 (incl. tween-overlap detection, group-cycle detection)
- Tests: valid/invalid fixtures for each rule

### Phase 3 — Easings & color (§3.4, §3.3)
- 19 named easings as pure `(t: number) → number`
- Color parser (hex `#rgb`/`#rrggbb`/`rgba()`, `{r,g,b,a}`) + RGB lerp
- Tests: known endpoint values, monotonicity

### Phase 4 — Engine core (§5.1–5.4)
- `computeStateAt(comp, t) → ResolvedScene` — pre-indexed tweens, hold-after-end semantics
- Polymorphic `lerp` (numeric, RGB)
- `renderFrame(comp, t, ctx)` — Canvas2D-only, platform-agnostic
- `drawItem` for sprite/text/shape/group with anchor + Canvas2D transform stack for groups
- Tests: resolver determinism; golden-pixel tests with skia in Phase 6

### Phase 5 — Asset loaders (§5.5)
- `AssetLoader` interface with cache
- `BrowserAssetLoader` (Image + FontFace)
- `NodeAssetLoader` (skia-canvas `loadImage` + `registerFont`)
- `preloadAll(assets)` returns when all resolved

### Phase 6 — Server driver (§5.6, §6)
- `renderToFile(comp, outPath, opts)` — skia-canvas + spawn ffmpeg
- RGBA → ffmpeg stdin pipe, backpressure via `drain`
- Canvas reuse, single instance, `clearRect` between frames
- Test: render the §3.1 hello-world to MP4 and assert ffprobe metadata

### Phase 7 — Browser driver (§5.6)
- `attach(comp, canvas) → { stop, seek }` with RAF loop
- Vite demo page playing the §3.1 hello-world

### Phase 8 — MCP server (§4)
- In-memory composition store, default `compositionId`
- All 4.1–4.6 tools with structured `{error: {code, message, hint?}}` responses
- `render_preview_frame` → base64 PNG
- `render_thumbnail_strip` → uniform sampling
- stdio transport, `server.json` manifest
- Test: spawn server, drive a script that builds + validates + renders via MCP

### Phase 9 — Examples & docs
- `examples/hello-world.json` (the §3.1 logo fade-in)
- `examples/render.ts` — JS API usage
- `examples/mcp-demo.md` — how to point Claude Code at the MCP server
- README quickstart (browser preview + render-to-mp4)

---

## Out of scope for v0.1 (per design-doc §1)

Audio sync, video sources, particles, shaders, multi-line wrap, OKLab — deferred to v0.2+.

---

## Open §7 questions — defaults adopted

Following the doc's stated defaults unless overridden:

- **Q1** explicit `from`
- **Q2** RGB lerp
- **Q6** over-duration = warning
- **Q7** group anchor `(0,0)`
- **Q8** rich `add_*`

The rest (cubic-bezier, asset swap, PRNG, frame cache) stay deferred.

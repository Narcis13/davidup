# MotionForge

Deterministic 2D programmatic video engine. Same composition runs in two modes:

- **Browser** — preview live in Canvas2D via `requestAnimationFrame`.
- **Server** (Node/Bun) — frame-by-frame render with `skia-canvas`, piped to `ffmpeg` → MP4.

Composition is canonical JSON. AI agents drive the engine via atomic MCP tools.

See [`design-doc.md`](./design-doc.md) for the full spec and [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the phased build.

## Status

v0.1 — under construction. Phase 1 (foundation) is in place.

## Requirements

- [Bun](https://bun.com/) ≥ 1.1
- `ffmpeg` on `$PATH` (only required at Phase 6+ for MP4 output)

## Quickstart

```bash
bun install
bun run typecheck
bun run test
```

## Layout

```
src/
  schema/    Zod schemas + validator (Phase 2)
  easings/   19 named easings + color lerp (Phase 3)
  engine/    computeStateAt + renderFrame + drawItem (Phase 4)
  assets/    AssetLoader interface + impls (Phase 5)
  drivers/
    node/    renderToFile via skia-canvas + ffmpeg (Phase 6)
    browser/ attach() RAF preview loop (Phase 7)
  mcp/       MCP server + tools (Phase 8)
tests/       Vitest unit + integration tests
examples/    Sample compositions and runners
assets/      Local images / fonts for examples
```

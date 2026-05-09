# Davidup

> Deterministic 2D programmatic video engine for AI agents.
> One JSON composition runs in the **browser** (live preview via Canvas2D +
> `requestAnimationFrame`) and on the **server** (frame-by-frame render with
> [`skia-canvas`](https://github.com/samizdatco/skia-canvas) piped to
> `ffmpeg` → MP4). Same input → same pixels, every host.

- The composition is canonical JSON. See [`design-doc.md`](./design-doc.md) for
  the full spec.
- AI agents drive the engine through 25 atomic MCP tools. See
  [`examples/mcp-demo.md`](./examples/mcp-demo.md) for the agent walkthrough.
- The implementation plan and phase breakdown lives in
  [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

Status: **v0.1**, Phases 1–9 complete (foundation, schema, easings, engine,
asset loaders, server driver, browser driver, MCP server, examples & docs).

---

## Why does this exist?

If you want an LLM to compose a short motion-graphics clip end-to-end, you
need three properties at the same time:

1. **Deterministic output.** `(composition, t) → pixels` must be a pure
   function so the agent can reason about edits, diff frames, and verify
   work without watching the whole clip render.
2. **Inspectable state.** The agent has to be able to peek at any frame, any
   intermediate state, on demand — preview-frame-as-base64 is non-negotiable.
3. **Atomic, orthogonal authoring tools.** Adding a sprite, adding a tween,
   moving an item to a different layer — each is one tool call with a
   structured response. No prose, no codegen, no "maybe this is what I
   meant".

Davidup is built around exactly those three properties. The same engine
core renders both the live browser preview and the final MP4, so what you
see while iterating is what ships.

---

## Requirements

- [Bun](https://bun.com/) ≥ 1.1 (Node ≥ 20 also works for everything except
  the `bun run` shebangs in `bin/`).
- `ffmpeg` on `$PATH` — only required for `render_to_video` / `renderToFile`
  (Phase 6+). The browser preview, single-frame PNG preview, and thumbnail
  strip don't need ffmpeg. The repo dev-deps include `ffmpeg-static` and
  `ffprobe-static` so `bun install` brings working binaries for tests and
  the render example.
- macOS / Linux build tools for the `skia-canvas` native build.

---

## Install

```bash
bun install
bun run typecheck   # tsc --noEmit, strict
bun run test        # vitest, 187 tests including a real MP4 integration test
```

A green `bun run test` confirms your environment is wired correctly: the
integration test in `tests/drivers/node.integration.test.ts` renders the
§3.1 hello-world via the full skia-canvas + ffmpeg pipeline and verifies
the MP4 with `ffprobe`.

---

## Quickstart — three flavors of "hello world"

The same composition (the §3.1 logo fade-in) is wired up three different
ways. Pick whichever entrypoint matches what you're building.

### A) Browser preview — live in the page

```bash
bun run dev:browser
```

Opens [`examples/browser-demo`](./examples/browser-demo) on Vite. The page
loads the composition in JS and calls `attach(comp, canvas)` to start a
`requestAnimationFrame` loop. The buttons exercise the driver's `seek` /
`stop` controls.

```ts
import { attach } from "davidup/browser";

const handle = await attach(comp, canvas);
// handle.stop()        — cancel the RAF loop
// handle.seek(seconds) — move the playhead, keeps playing
```

`attach()` is async because it preloads images and fonts before the first
paint. Once it resolves the canvas is already showing frame 0.

### B) Render to MP4 — JS API tour

```bash
bun run examples/render.ts
```

This runs `examples/render.ts`, which is a full annotated tour of the public
API: load JSON → validate → sample the resolver → render a single PNG frame
→ render the full MP4. Outputs land in `examples/output/`:

- `hello-world.frame-500ms.png` — the §3.1 fade-in at t=0.5s.
- `hello-world.mp4` — the full 3-second clip, libx264 / crf 18 / +faststart.

The minimal-viable version is just three lines:

```ts
import { renderToFile } from "davidup/node";
import { validate } from "davidup/schema";

if (!validate(comp).valid) throw new Error("invalid");
await renderToFile(comp, "out.mp4", { codec: "libx264", crf: 18 });
```

`renderToFile` allocates one `Canvas` and reuses it across every frame
(per design-doc §5.7), pipes RGBA bytes straight into `ffmpeg`'s stdin,
honours backpressure via `drain`, and surfaces ffmpeg's stderr tail in any
thrown `Error.message` so failures are debuggable.

### C) Drive it with an MCP-aware agent

```bash
bun run src/mcp/bin.ts          # smoke test — should hang waiting on stdin
```

That's the MCP server. Wire it into Claude Code (or Claude Desktop, or any
MCP client) by adding to your config — for Claude Code's `~/.claude.json`:

```jsonc
{
  "mcpServers": {
    "davidup": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/davidup/src/mcp/bin.ts"]
    }
  }
}
```

Then ask the model to "build a 3-second clip with a logo that fades in and
pops in scale". It will call `create_composition` → `add_layer` →
`add_shape`/`add_sprite` → `add_tween` × N → `validate` →
`render_preview_frame` to verify visually → `render_to_video`.

Full transcript with every tool call's input and output:
**[`examples/mcp-demo.md`](./examples/mcp-demo.md)**.

---

## API surface

The package exposes one entrypoint per layer (subpath exports declared in
`package.json`):

| Subpath | What's there | Use it for |
|---|---|---|
| `davidup/schema` | `validate`, Zod schemas, `Composition` types | Parsing JSON, validating before render |
| `davidup/easings` | 19 named easings, `EASING_NAMES`, `getEasing` | Custom code that needs the same easing math |
| `davidup/engine` | `computeStateAt`, `renderFrame`, `drawScene`, `indexTweens` | Building your own driver, or sampling state at a time without painting |
| `davidup/assets` | `BrowserAssetLoader`, `NodeAssetLoader`, `BaseAssetLoader` | Custom asset loading (CDN, S3, …) |
| `davidup/browser` | `attach(comp, canvas) → { stop, seek }` | Live preview in a page |
| `davidup/node` | `renderToFile(comp, outPath, opts)` | Render MP4 / MOV / WebM via ffmpeg |
| `davidup/mcp` | `createServer`, `dispatchTool`, `TOOLS`, `renderPreviewFrame`, `renderThumbnailStrip` | Embed the MCP server, or call tool handlers in-process from tests |

---

## Repo layout

```
src/
  schema/    Zod schemas + validator             (Phase 2 — design-doc §3, §3.5)
  easings/   19 named easings, color lerp        (Phase 3 — §3.4, §3.3)
  color/     hex / rgba parser + RGB lerp        (Phase 3 — §3.3)
  engine/    computeStateAt, renderFrame, drawItem (Phase 4 — §5.1–5.4)
  assets/    AssetLoader interface + browser/node impls  (Phase 5 — §5.5)
  drivers/
    node/    renderToFile via skia-canvas + ffmpeg    (Phase 6 — §5.6, §6)
    browser/ attach() RAF preview loop               (Phase 7 — §5.6)
  mcp/       MCP server + tools + in-memory store    (Phase 8 — §4)

tests/       Vitest unit + integration tests (187 tests, incl. real MP4 render)
examples/
  hello-world.json     §3.1 fade-in as canonical JSON
  render.ts            JS API tour — JSON to MP4 in one script
  mcp-demo.md          End-to-end MCP agent walkthrough
  browser-demo/        Vite-served live preview page

design-doc.md            Spec (live document)
IMPLEMENTATION_PLAN.md   Phased build plan
server.json              MCP server manifest
```

---

## Mental model in 30 seconds

1. **Composition** = top-level JSON. Has `composition` (size/fps/duration/bg),
   `assets[]`, `layers[]`, `items{}` (keyed by id), `tweens[]`.
2. **Items** are `sprite | text | shape | group`. Each has a `transform`
   (`x, y, scaleX, scaleY, rotation, anchorX, anchorY, opacity`).
3. **Tweens** interpolate one property of one item over a time window with a
   named easing. Two tweens cannot overlap on the same `(item, property)` —
   the validator rejects it.
4. **Render** is `(composition, t) → pixels`. The same pure function powers
   both browser and server; only the *driver* changes.
5. **Agents author through MCP.** They call `add_*` tools, then `validate`,
   then `render_preview_frame` at key beats, then `render_to_video`.

---

## Determinism

- Same composition + same `t` → exact same pixels, every host. (Subject to
  matching skia-canvas + ffmpeg versions for byte-for-byte identical MP4s;
  the engine output before encoding is bit-deterministic.)
- The resolver is pure — no global state, no I/O. You can sample
  `computeStateAt(comp, t)` from anywhere and get back a fully-resolved
  scene.
- There is no PRNG inside the engine in v0.1 (Q10 in design-doc §7).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `dyld: Library not loaded: libx265.215.dylib` when ffmpeg starts | Broken Homebrew ffmpeg — missing transitive lib. | `brew reinstall ffmpeg x265`, or rely on the bundled `ffmpeg-static` (the example does this automatically). |
| `EPIPE: broken pipe, send` from `renderToFile` | ffmpeg subprocess crashed (bad codec / args / dyld). | Inspect the thrown error's `message` for the ffmpeg stderr tail; verify `ffmpeg -version` runs cleanly. |
| `examples/render.ts` reports success but no MP4 file | ffmpeg killed by a signal mid-stream. The current driver treats signal-killed exits as success — known issue. | The example post-checks file size and exits non-zero in this case. Track the fix in `src/drivers/node/index.ts` (the `waitForClose` helper conflates `code: null` with success). |
| `tools list is empty` in your MCP client | The Davidup subprocess didn't start. | Run `bun run src/mcp/bin.ts` manually — anything on stderr is the real error. Use absolute paths in the MCP client config. |
| `skia-canvas` install fails | Native build prerequisites missing. | macOS: install Xcode CLT (`xcode-select --install`). Linux: install `build-essential` + `libcairo2-dev`. |

For more agent-side troubleshooting, see [`examples/mcp-demo.md` §7](./examples/mcp-demo.md).

---

## Roadmap (excerpts)

- **v0.2** — audio muxing post-render, cubic-bezier easings, frame-range
  parallelization on the server.
- **v0.3** — video clips as sprite sources.
- **v0.4** — visual effects (blur, glow, drop shadow).
- **v1.0** — interactive web editor on top of the same JSON.

Full list and discussion: [`design-doc.md` §8](./design-doc.md).

---

## Contributing

- Schema or tool changes must land in `design-doc.md` first (§9 convention).
- Every new tool gets exhaustive coverage in `tests/mcp/` (success path,
  every error code, idempotency check).
- The integration test (`tests/drivers/node.integration.test.ts`) is the
  end-to-end smoke check — keep it green.

```bash
bun run typecheck && bun run test
```

is the gate.

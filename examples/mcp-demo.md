# MotionForge MCP — agent walkthrough

This document covers everything an MCP client (Claude Code, Claude Desktop, the
[`@modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector),
or your own custom client) needs to drive MotionForge as an autonomous video
composer.

By the end you will:

1. Understand the protocol shape MotionForge speaks (stdio, JSON-RPC over the
   MCP SDK, structured errors).
2. Have the server registered with Claude Code (or your client of choice).
3. Have walked an agent through building, validating, previewing, and
   rendering the §3.1 logo fade-in entirely through tool calls.

> The companion JSON for the same animation is in
> [`examples/hello-world.json`](./hello-world.json), and a non-MCP JS API
> tour is in [`examples/render.ts`](./render.ts). Read those alongside this
> doc — they show the *same* composition reached through three different
> entrypoints.

---

## 1. What the MCP server actually is

The package ships a stdio MCP server at `src/mcp/bin.ts`. When you launch it
with `bun run src/mcp/bin.ts` (or via the `motionforge-mcp` bin shim defined
in `package.json`), the process:

- attaches to `stdin`/`stdout` as an MCP transport (JSON-RPC framed);
- registers the 25 tools from the design doc §4.1–4.6 against an in-memory
  `CompositionStore`;
- never logs to `stdout` — diagnostic output goes to `stderr` so the protocol
  framing stays uncorrupted.

The default `compositionId` is implicit. Any tool with a `compositionId`
argument can omit it and target the active composition. Multiple compositions
are supported (each `create_composition` call returns a fresh id you can pass
explicitly), which is what you want when an agent is iterating on more than
one variant in parallel.

Manifest: see [`server.json`](../server.json) — that's the file consumed by
MCP registries.

### Tool catalog at a glance

| Group | Tools |
|---|---|
| 4.1 Composition lifecycle | `create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset` |
| 4.2 Assets | `register_asset`, `list_assets`, `remove_asset` |
| 4.3 Layers | `add_layer`, `update_layer`, `remove_layer` |
| 4.4 Items | `add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item` |
| 4.5 Tweens | `add_tween`, `update_tween`, `remove_tween`, `list_tweens` |
| 4.6 Render | `render_preview_frame`, `render_thumbnail_strip`, `render_to_video` |

Every tool returns either:

- a payload object (e.g. `{ compositionId: "comp-1" }`, `{ ok: true }`,
  `{ image: "<base64>", mimeType: "image/png", width, height }`); or
- a structured error envelope `{ error: { code, message, hint? } }` with
  `isError: true` on the MCP `CallToolResult`.

Error codes are stable strings (`E_NO_COMPOSITION`, `E_DUPLICATE_ID`,
`E_NOT_FOUND`, `E_VALIDATION_FAILED`, `E_TWEEN_OVERLAP`,
`E_ASSET_IN_USE`, `E_ASSET_TYPE_MISMATCH`, `E_LAYER_NOT_EMPTY`,
`E_INVALID_PROPERTY`, `E_INVALID_VALUE`, `E_RENDER_FAILED`, `E_UNKNOWN`).
Agents are expected to branch on `code`, not on `message`.

---

## 2. Pointing Claude Code at the server

### 2.1 Local checkout (development)

If you have the repo cloned, point Claude Code at the binary directly. From
the project root:

```bash
bun install              # one-time
bun run src/mcp/bin.ts   # smoke test — should hang waiting for stdin
# Ctrl-C to exit; this proves the binary boots.
```

Then add the server to your Claude Code MCP config. The exact config path
depends on your client; for Claude Code (CLI), edit `~/.claude.json` (or use
`claude mcp add ...`). Add an entry under `mcpServers`:

```jsonc
{
  "mcpServers": {
    "motionforge": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/davidup/src/mcp/bin.ts"],
      "env": {}
    }
  }
}
```

Notes:

- Use an **absolute path**. MCP clients launch the subprocess from their own
  cwd — relative paths will not resolve.
- If you don't have `bun` on `$PATH`, swap `command` for the absolute path
  to bun (`/Users/you/.bun/bin/bun` or wherever your install lives).
- `node` works too for environments without bun: replace `bun run` with
  `node --experimental-strip-types` and adjust the entry path. Bun is the
  primary supported runtime per the implementation plan.

Reload Claude Code (`/mcp` to verify) and the 25 tools become callable.

### 2.2 Programmatic registration (`claude mcp add`)

```bash
claude mcp add motionforge \
  --command bun \
  --args run /absolute/path/to/davidup/src/mcp/bin.ts
```

This writes the same JSON entry above. Inspect with `claude mcp list`.

### 2.3 With Claude Desktop

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS (Windows: `%APPDATA%\Claude\claude_desktop_config.json`). Same
schema as above. Restart Claude Desktop after editing.

### 2.4 With the MCP Inspector (debugging)

For poking the server directly without an LLM in the loop:

```bash
npx @modelcontextprotocol/inspector bun run src/mcp/bin.ts
```

The inspector opens a browser UI where you can call any tool with arbitrary
args and inspect the structured response. Fastest way to reproduce a tool
error before reporting it.

### 2.5 With your own MCP SDK client

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "/absolute/path/to/davidup/src/mcp/bin.ts"],
});
const client = new Client({ name: "demo-client", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();          // sanity check
await client.callTool({
  name: "create_composition",
  arguments: { width: 1280, height: 720, fps: 60, duration: 3 },
});
```

For unit-test-style usage that doesn't even spawn a process, import
`dispatchTool` and the tool registry from `motionforge/mcp` and drive
handlers in-process. See [`tests/mcp/`](../tests/mcp/) for examples.

---

## 3. End-to-end agent transcript: building hello-world

This is the recommended flow per design-doc §4.7:
**`add_*` → `validate` → `render_preview_frame` at key beats → `render_to_video`**.

What follows is the literal sequence of tool calls an agent issues to recreate
the §3.1 logo fade-in. Inputs are JSON; outputs are abbreviated.

### 3.1 Create the composition

```jsonc
// → create_composition
{ "width": 1280, "height": 720, "fps": 60, "duration": 3.0, "background": "#0a0e27" }
// ← { "compositionId": "comp-1" }
```

`compositionId` becomes the implicit default. Subsequent tools omit it.

### 3.2 (Optional) Inspect

```jsonc
// → get_composition
{}
// ← { "json": { "version":"0.1", "composition":{...}, "assets":[], "layers":[], "items":{}, "tweens":[] } }
```

Self-inspection lets the agent verify state at any point.

### 3.3 Add a layer

```jsonc
// → add_layer
{ "id": "foreground", "z": 10 }
// ← { "layerId": "foreground" }
```

When `id` is omitted, the server generates one (`layer-<n>`).

### 3.4 Add the logo as a shape

We use a shape so this whole walkthrough requires zero binary assets. Swap to
`add_sprite` once you have a real PNG (and a preceding `register_asset`).

```jsonc
// → add_shape
{
  "layerId": "foreground",
  "id": "logo",
  "kind": "rect",
  "x": 640, "y": 360,
  "width": 320, "height": 320,
  "cornerRadius": 48,
  "fillColor": "#ff6b35",
  "anchorX": 0.5, "anchorY": 0.5,
  "opacity": 0
}
// ← { "itemId": "logo" }
```

Why `opacity: 0` here? The first tween sets `from: 0`, so the *base* value
is irrelevant to the final pixels — but explicit base values make the
composition self-documenting and round-trip cleanly through `get_composition`.

### 3.5 Add the three tweens

```jsonc
// → add_tween (fade-in)
{
  "id": "logo-fade-in",
  "target": "logo", "property": "transform.opacity",
  "from": 0, "to": 1,
  "start": 0.0, "duration": 1.0,
  "easing": "easeOutQuad"
}
// ← { "tweenId": "logo-fade-in" }

// → add_tween (scaleX pop)
{
  "id": "logo-pop-x",
  "target": "logo", "property": "transform.scaleX",
  "from": 0.5, "to": 1.0,
  "start": 0.0, "duration": 1.5,
  "easing": "easeOutBack"
}
// ← { "tweenId": "logo-pop-x" }

// → add_tween (scaleY pop)
{
  "id": "logo-pop-y",
  "target": "logo", "property": "transform.scaleY",
  "from": 0.5, "to": 1.0,
  "start": 0.0, "duration": 1.5,
  "easing": "easeOutBack"
}
// ← { "tweenId": "logo-pop-y" }
```

`add_tween` rejects overlap on the same `(target, property)`. If the agent
tries to add a second `transform.opacity` tween whose `[start, start+duration]`
window crosses the first, it gets:

```jsonc
{ "error": { "code": "E_TWEEN_OVERLAP",
             "message": "Tweens \"logo-fade-in\" and \"logo-fade-2\" overlap on logo::transform.opacity: [0,1] vs [0.5,1.5].",
             "hint": "Pick a non-overlapping window or remove the conflicting tween." } }
```

### 3.6 Validate

```jsonc
// → validate
{}
// ← { "valid": true, "errors": [], "warnings": [] }
```

Whenever `validate` returns `valid: false`, **do not call render tools** —
they short-circuit with `E_VALIDATION_FAILED`. The error list is the agent's
todo list.

### 3.7 Preview a frame at a key beat

```jsonc
// → render_preview_frame
{ "time": 0.5, "format": "png" }
// ← {
//     "image": "<base64-encoded PNG, ~6KB for hello-world>",
//     "mimeType": "image/png",
//     "width": 1280, "height": 720
//   }
```

The MCP client renders the base64 inline (Claude Code shows it as an image
attachment) so the agent — and you watching it — can verify the composition
visually. The pattern is **preview at the beats that matter**: t=0 (start),
mid-key-tween (here 0.5s), end-of-key-tween (1.5s), end of clip.

### 3.8 Get a contact-sheet across the timeline

```jsonc
// → render_thumbnail_strip
{ "count": 6, "format": "png" }
// ← {
//     "images": ["<b64>", "<b64>", "<b64>", "<b64>", "<b64>", "<b64>"],
//     "times":  [0, 0.6, 1.2, 1.8, 2.4, 3.0],
//     "mimeType": "image/png", "width": 1280, "height": 720
//   }
```

`count: 1` returns the midpoint frame. `count: 2+` includes endpoints
(`linspace(0, duration, count)`).

### 3.9 Render the final clip

```jsonc
// → render_to_video
{ "outputPath": "/tmp/hello-world.mp4", "codec": "libx264", "crf": 18, "preset": "medium" }
// ← { "ok": true, "outputPath": "/tmp/hello-world.mp4", "durationMs": 1240, "frameCount": 180 }
```

Failure modes the agent should expect:

| Code | Cause | Recovery |
|---|---|---|
| `E_VALIDATION_FAILED` | Composition not valid at render time. | Call `validate`, address each error, retry. |
| `E_RENDER_FAILED` | ffmpeg crashed, asset missing on disk, codec unavailable. | Read `message` for the ffmpeg stderr tail; check `$PATH`. |
| `E_INVALID_VALUE` | `time < 0`, non-positive `count`, malformed args. | Re-issue with valid args. |

---

## 4. Idempotency and explicit ids

Every `add_*` and `register_asset` accepts an optional `id`. **Always supply
one**. Why:

- The agent can refer to an item / layer / tween in later turns without
  having to remember a server-generated id.
- A retried call (e.g. after a network blip) becomes deterministic: the
  second call returns `E_DUPLICATE_ID` instead of silently duplicating.
- The full transcript of an agent's session becomes a deterministic recipe
  that replays byte-for-byte.

When you do let the server auto-generate, the format is `<prefix>-<n>`
(`layer-1`, `item-3`, `tween-7`, `comp-2`).

---

## 5. Pattern recipes for agents

### Recipe A — "build, preview, iterate, render"

```
create_composition
add_layer
add_sprite | add_text | add_shape | add_group   (×N)
add_tween                                       (×N)
validate
render_preview_frame at key beats
  ↪ if pixels look wrong: update_item / update_tween / remove_tween → validate again
render_to_video
```

### Recipe B — "fan out variations"

When exploring stylistic variants in parallel, create multiple compositions
and pass `compositionId` explicitly to every tool. The server keeps each in
its own bucket; you can `render_thumbnail_strip` each side-by-side and pick
a winner.

### Recipe C — "swap an asset mid-iteration"

```
register_asset    { id: "logo", type: "image", src: "./assets/logo-v1.png" }
add_sprite        { ..., asset: "logo", id: "hero" }
render_preview_frame  → looks bad
remove_asset      { id: "logo" }                  → ok (no item still uses it after we update below)
register_asset    { id: "logo", type: "image", src: "./assets/logo-v2.png" }
update_item       { id: "hero", props: { asset: "logo" } }
render_preview_frame  → better
```

`remove_asset` errors with `E_ASSET_IN_USE` if any item still references it.
The safe sequence is: re-`register_asset` (overwrite by id) and the swap
takes effect on the next render call without touching items at all.

---

## 6. Determinism and reproducibility

Same composition + same time → same pixels. Period. (See design-doc §1.)

Practical consequences for agents:

- A `render_preview_frame` cached against `{ compositionId, time, version }`
  remains valid until the composition mutates.
- Diffing two preview frames is a precise way to verify the effect of an
  edit without watching the whole clip.
- `render_to_video` is *not* sensitive to wall-clock time, RNG seeds, or
  hardware. It only depends on the composition, ffmpeg/skia versions, and
  encoder settings (codec/crf/preset).

There is no PRNG inside the engine in v0.1 (Q10 in design-doc §7 is open).

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tools list is empty in your client | Server didn't start. | Run `bun run src/mcp/bin.ts` standalone — anything on stderr is the real error. |
| `E_RENDER_FAILED: spawn ffmpeg ENOENT` | ffmpeg not on `$PATH` for the spawned process. | Use absolute path, or `env: { "PATH": "..." }` in the MCP config. |
| `E_RENDER_FAILED` with x264/x265 dyld error | Broken local ffmpeg install. | `brew reinstall ffmpeg x265` on macOS. |
| `E_VALIDATION_FAILED` on render | Stale state, missing asset, overlap. | Call `validate` and address each error before retrying. |
| Composition resets between calls | Each `bun run …` spawns a *fresh* server. | The MCP client owns the long-lived process; restart the client to recreate. Don't shell out to `bun run` per call. |
| Preview frames look wrong but `validate` passes | Bug in your tweens. | `list_tweens { target: "<id>" }` — check `from`/`to`/`start`/`duration` for off-by-one. |

---

## 8. See also

- [`design-doc.md`](../design-doc.md) — the canonical spec, especially §4
  (tool reference) and §3.5 (validation rules).
- [`hello-world.json`](./hello-world.json) — the same composition this
  walkthrough builds, but as a hand-authored file.
- [`render.ts`](./render.ts) — same composition again, driven through the JS
  API. Useful when you want to skip MCP entirely and embed MotionForge in a
  larger Node/Bun app.
- [`server.json`](../server.json) — the MCP server manifest (consumed by
  registries).
- [`tests/mcp/`](../tests/mcp/) — exhaustive examples of every tool call's
  success and error paths, executed against an in-process server.

# Time-mapping showcase (MCP-driven)

A 14s composition that registers one scene (`pulseDot`) and instantiates it
four times — once per time-mapping mode shipped in v0.5 §8.5. Every step is
issued through the MCP tool surface; the script invokes the handlers
in-process via `dispatchTool()` so it doubles as an integration test for
both the MCP layer and the time-mapping feature.

```
┌────────────────────────────┬────────────────────────────┐
│  IDENTITY     start=2      │   LOOP ×3      start=0     │
│  one pulse, t=2..6         │   three back-to-back, 0..12│
├────────────────────────────┼────────────────────────────┤
│  TIMESCALE 0.5 start=2     │   CLIP [0..3]  start=2     │
│  one slow pulse, t=2..10   │   trimmed pulse, t=2..5    │
└────────────────────────────┴────────────────────────────┘
```

## Run

```sh
bun run examples/time-mapping-mcp/render.ts
```

Outputs land in `examples/time-mapping-mcp/output/`:

| File | What it is |
|---|---|
| `composition.json` | Canonical compiled JSON returned by `get_composition` (post-expansion: every scene instance is already lowered to a synthetic group + namespaced inner items + time-shifted tweens). |
| `preview-t045.png` | Single-frame preview at t=4.5s — the one moment when every quadrant is alive at once (identity mid pop-down, loop iter-1 fade-in, timescale mid pop-up, clip mid pop-down). |
| `time-mapping-mcp.mp4` | Final render. |

If `ffmpeg` isn't on `$PATH`, the script transparently falls back to
`ffmpeg-static`.

## Tools exercised

In call order, every MCP tool the script touches:

```
reset
create_composition
register_asset
define_scene
list_scenes
add_layer            (×2)
add_text             (×6)   header + subheader + 4 quadrant labels
add_scene_instance   (×4)   one per time mode
update_scene_instance       nudge the clip quadrant up
validate
get_composition             snapshot to disk
render_preview_frame
render_to_video
```

That covers 13 distinct tools, including every entry in the §8.9 scene
group (`define_scene`, `list_scenes`, `add_scene_instance`,
`update_scene_instance`).

## Time-mapping coverage

Each instance hits a different branch of `expandSceneInstance` and the
post-compile validator:

| Quadrant | `time` field passed to `add_scene_instance` | Effective span | Behavior |
|---|---|---|---|
| Top-left | `{ mode: "identity" }` | 4s | baseline; matches v0.4 expansion exactly |
| Top-right | `{ mode: "loop", count: 3 }` | 12s | three back-to-back copies, suffixed `__loop0/1/2`; iteration boundaries are touching but not overlapping (validator's 1µs EPS guard) |
| Bottom-left | `{ mode: "timeScale", scale: 0.5 }` | 8s | every tween's `start` and `duration` divided by 0.5 |
| Bottom-right | `{ mode: "clip", fromTime: 0, toTime: 3.0 }` | 3s | `fadeOut` (start 3.4) is dropped; `popDn` (ends at 3.0) is kept; no boundary-crossing tweens because the scene's authored schedule snaps to the clip edge |

The pulse scene was deliberately authored with quiet gaps (`[0.6,1.0]` and
`[3.0,3.4]`) so `clip` boundaries align with tween edges and never raise
`E_TIME_MAPPING_TWEEN_SPLIT`.

## Why MCP-in-process

The driver imports `TOOLS` and `dispatchTool` from `src/mcp/index.ts`
directly. Same handlers, same Zod schemas, same envelope (`{ ok, result }`
vs `{ ok, error: { code, message, hint? } }`) — but no subprocess and no
JSON-RPC framing. This is the same pattern used in `tests/mcp/` and is the
recommended way to drive Davidup from a larger Node/Bun app. To run the
exact same flow over real stdio, point an MCP client at
`bun run src/mcp/bin.ts`; the call sequence in `render.ts` translates one
tool call → one `tools/call` request.

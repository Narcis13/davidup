# MCP Layer & AI-Agent Authoring — Evaluation

Scope: `src/mcp/*`, `apps/editor/app/services/mcp_bridge.ts`, `apps/editor/start/preload_mcp_stdio.ts`, `.mcp.json`, `server.json`, `tests/mcp/*`, `examples/mcp-demo.md`, `examples/time-mapping-mcp/*`. Cross-references against `README.md`, `ARCHITECTURE.md` §9, `design-doc.md` §4.

## Overview

The MCP layer is the agent-facing surface of Davidup. It is a stdio JSON-RPC server built on the official `@modelcontextprotocol/sdk`, registering a flat catalog of **44 tools** (the README and `examples/mcp-demo.md` still advertise "25 atomic tools" — the count has drifted by 19 across behaviors, templates, scenes, render-queue, project lifecycle, and library tools; `server.json` is also stale at 24 tools, `tests/mcp/server.integration.test.ts:87` is the only place that has the right count).

Tool categories (`src/mcp/tools.ts:1824–1880`):

| Category | Tools | §design-doc |
|---|---|---|
| Composition lifecycle | 5 (`create_composition`, `get_composition`, `set_composition_property`, `validate`, `reset`) | §4.1 |
| Assets | 3 (`register_asset`, `list_assets`, `remove_asset`) | §4.2 |
| Layers | 3 (`add_layer`, `update_layer`, `remove_layer`) | §4.3 |
| Items | 7 (`add_sprite`, `add_text`, `add_shape`, `add_group`, `update_item`, `move_item_to_layer`, `remove_item`) | §4.4 |
| Tweens | 4 (`add_tween`, `update_tween`, `remove_tween`, `list_tweens`) | §4.5 |
| Behaviors | 2 (`apply_behavior`, `list_behaviors`) | §6.7 |
| Templates | 3 (`apply_template`, `list_templates`, `define_user_template`) | §7.8 |
| Scenes | 7 (`define_scene`, `import_scene`, `list_scenes`, `remove_scene`, `add_scene_instance`, `update_scene_instance`, `remove_scene_instance`) | §8.9 |
| Render | 5 (`render_preview_frame`, `render_thumbnail_strip`, `render_to_video`, `get_render`, `list_renders`) | §4.6, §20.31 |
| Project lifecycle (editor-only) | 4 (`current_project`, `list_projects`, `open_project`, `create_project`) | §20.29 |
| Library (editor-only) | 1 (`list_library`) | §20.30 |

Two server entrypoints:

- `src/mcp/bin.ts` — standalone engine server, in-memory store only, no project / library / render queue. Started by `.mcp.json` for Claude Code.
- `apps/editor/app/services/mcp_bridge.ts` (`createEditorMcpServer`) — same `TOOLS` registry, but every mutating tool is routed through the editor's `CommandBus` and every read-only tool runs against a per-call store hydrated from `projectStore.composition`. Activated only when `DAVIDUP_MCP_STDIO=1` (`apps/editor/start/preload_mcp_stdio.ts:20`).

## Tool inventory

`src/mcp/tools.ts:287–1810`. One-line purpose per tool:

| Tool | Purpose |
|---|---|
| `create_composition` (l. 287) | Create comp; first one becomes default. Returns `compositionId`. |
| `get_composition` (l. 313) | Return full canonical JSON. |
| `set_composition_property` (l. 326) | Patch one of width/height/fps/duration/background. |
| `validate` (l. 346) | Run schema + semantic validator; returns `{ valid, errors, warnings }`. |
| `reset` (l. 359) | Drop active or specified comp (drops all if no arg). |
| `register_asset` (l. 375) | Add image or font asset by id. |
| `list_assets` (l. 401) | Enumerate in declaration order. |
| `remove_asset` (l. 413) | Errors `E_ASSET_IN_USE` if referenced. |
| `add_layer` (l. 430) | Add layer with z, optional opacity/blendMode/id. |
| `update_layer` (l. 456) | Patch z/opacity/blendMode. |
| `remove_layer` (l. 479) | Errors `E_LAYER_NOT_EMPTY` unless `cascade: true`. |
| `add_sprite` (l. 506) | Image item on a layer. |
| `add_text` (l. 546) | Text item with `font`, `fontSize`, `color`, optional `align`. |
| `add_shape` (l. 589) | `rect` / `circle` / `polygon`. |
| `add_group` (l. 634) | Group with optional initial child id list. |
| `update_item` (l. 689) | Patch transform + type-aware properties. |
| `move_item_to_layer` (l. 705) | Move existing item to a new layer. |
| `remove_item` (l. 720) | Cascades tween deletion. |
| `add_tween` (l. 738) | Single property tween; rejects overlap on `(target, property)`. |
| `update_tween` (l. 772) | Patch fields, re-checks overlap excluding self. |
| `remove_tween` (l. 797) | Drop by id. |
| `list_tweens` (l. 811) | Filter by target/property. |
| `apply_behavior` (l. 830) | Expand named behavior (e.g. fadeIn, popIn) → tweens, atomically. |
| `list_behaviors` (l. 889) | Enumerate built-ins with param shapes. |
| `apply_template` (l. 912) | Instantiate a template → items+tweens, atomic rollback. |
| `list_templates` (l. 995) | Enumerate built-in + user templates. |
| `define_user_template` (l. 1006) | Register custom template on global registry. |
| `define_scene` (l. 1099) | Register a scene definition (mini-composition) globally. |
| `import_scene` (l. 1141) | Load scene JSON from disk and register. |
| `list_scenes` (l. 1194) | Enumerate scene registry. |
| `remove_scene` (l. 1205) | Unregister from registry (already-expanded instances unaffected). |
| `add_scene_instance` (l. 1356) | Place scene in composition with optional `time` mapping. |
| `update_scene_instance` (l. 1411) | Re-expand same id with new params/transform/start. |
| `remove_scene_instance` (l. 1506) | Cleanup wrapper group + inner items + tweens. |
| `render_preview_frame` (l. 1534) | Single frame → base64 PNG/JPEG. Validates first. |
| `render_thumbnail_strip` (l. 1555) | N uniformly-sampled frames + sample times. |
| `render_to_video` (l. 1577) | Render full clip; blocking standalone, async-by-default with editor queue. |
| `get_render` (l. 1687) | Poll editor job snapshot by `jobId`. Editor-only. |
| `list_renders` (l. 1710) | List active/recent jobs. Editor-only. |
| `current_project` (l. 1727) | Editor-only: current project info. |
| `list_projects` (l. 1740) | Editor-only: recents list. |
| `open_project` (l. 1753) | Editor-only: load project from disk. |
| `create_project` (l. 1791) | Editor-only: scaffold + load new project. |
| `list_library` (l. 1771) | Editor-only: project+global merged library catalog. |

## What's good

1. **Single source of truth for tool handlers.** `dispatchTool` (`src/mcp/dispatch.ts:36`) is transport-agnostic: tests, examples (`examples/time-mapping-mcp/`), and the stdio server all hit the exact same code path. SDK validates inputs at the MCP boundary, the dispatcher re-validates for in-process callers (`dispatch.ts:45`), so behavior is identical.
2. **Structured error envelope is excellent.** `MCPErrorBody` (`src/mcp/errors.ts:52`) carries `code`, `message`, optional `hint`, plus `issues` and `warnings` arrays and a `details` bag. 26 stable error codes (`errors.ts:8–35`). Every failure path lands in `{ error: { code, message, hint? } }` with `isError: true` (`server.ts:115–121`). Agents can branch on `code`, not substring matching.
3. **Validate-before-render is enforced.** `ensureValidForRender` (`tools.ts:1523`) runs the full validator before any `render_*` tool spawns skia. The agent cannot waste a 30-second render on an invalid composition.
4. **Preview-as-base64 is first-class and efficient.** `render_preview_frame` (`render.ts:70`) reuses a single skia `Canvas` and a single `NodeAssetLoader`; `render_thumbnail_strip` (`render.ts:97`) shares both across all sample frames and uses `indexTweens` once. PNG and JPEG supported. Returns `{ image, mimeType, width, height }` — everything the agent needs to caption / cache.
5. **Composite tools are atomic.** `apply_behavior` (`tools.ts:855`), `apply_template` (`tools.ts:944`), `add_scene_instance` (`tools.ts:1330`), `update_scene_instance` (`tools.ts:1468`) all wrap their multi-mutation expansion in try/catch and roll back partially-added items / tweens. Critical for agent UX: a failed `apply_template` does not leave dangling debris.
6. **`update_scene_instance` even attempts to restore the previous expansion on failure** (`tools.ts:1471–1500`) — best-effort but documented and bounded.
7. **Determinism is preserved end-to-end.** No `Date.now`, `crypto.randomUUID`, or `Math.random` anywhere in `src/mcp/`. Auto-generated ids use monotonic counters per composition (`store.ts:84` and `store.ts:271`). Scene instance ids follow `scene-<n>` (`store.ts:837`). The only non-determinism is in the editor render queue (`mcp_bridge.ts:460`, `randomUUID` for `jobId`) — but `jobId` does not enter the composition graph.
8. **Editor bridge is the highest-leverage piece of architecture in the repo.** `mcp_bridge.ts` proves agent and human edits can share one CommandBus (`mcp_bridge.ts:165–169`); read-only tools work against per-call hydrated stores (`mcp_bridge.ts:181–185`) so they never go stale; engine-vocabulary error codes are mapped back from editor-specific errors (`mcp_bridge.ts:609–652`). This is the "AI agent uses the editor" path and it is genuinely well-designed.
9. **Defensive path handling in `create_project`** (`mcp_bridge.ts:252–281`): rejects `..`, NUL bytes, absolute paths, drive letters; double-checks the resolved target lives strictly under `location` with `startsWith(... + sep)`.
10. **Render queue stays inside the project sandbox.** `resolveOutputPath` in `buildRenderControls` (`mcp_bridge.ts:378–404`) refuses any `outputPath` that escapes the active project root, even if the agent passes an absolute path. NUL byte check too.
11. **Multiple compositions out of the box.** Every tool with `compositionId?` defaults to the first-created (`store.ts:274`). Lets an agent explore variants in parallel and `render_thumbnail_strip` each. The fan-out recipe in `examples/mcp-demo.md` §5 Recipe B is real.
12. **Tests are thorough.** 7 test files / 1851 lines under `tests/mcp/` exercise the success path and every error code per tool, plus a real stdio subprocess integration test (`tests/mcp/server.integration.test.ts`) that asserts the exact 44-tool list.

## End-to-end agent walkthrough — "make a 10-second video introducing 'Acme Coffee'"

I'll trace a plausible call sequence and flag the friction points.

**Step 1: orient.** The agent reads the tool list. It sees `list_templates`, `list_behaviors`, `list_library` (editor-only) — promising. With the **standalone server** there is no `list_library`, no way to ask "what fonts are available", and no asset browser. The agent cannot easily discover the local fonts/images on disk; it has to guess paths or read the project manually outside MCP. **First gap.**

**Step 2: create.**

```
create_composition { width: 1920, height: 1080, fps: 30, duration: 10, background: "#ffffff" }
→ { compositionId: "comp-1" }
```

Solid. No friction.

**Step 3: add a logo asset.** Standalone server: agent has to invent a path.

```
register_asset { id: "logo", type: "image", src: "./acme-logo.png" }
```

If the file doesn't exist, `register_asset` succeeds anyway — there is no fs check in `store.registerAsset` (`store.ts:362–396`). The error surfaces much later during `render_preview_frame` as `E_RENDER_FAILED` with a fairly opaque skia message. **Friction point.**

For text, the agent needs a font. The README and `mcp-demo.md` walkthrough avoid fonts entirely by using shapes; **there is no first-party way for an agent to ask "what fonts can I use".** It has to either bundle a font asset and `register_asset` it, or hope the system has a fallback. Without `list_library` (editor-only) or a hypothetical `list_system_fonts`, the agent is flying blind.

**Step 4: layout.** Agent calls `add_layer` for background, midground, foreground, then `add_shape` for a colored backdrop, `add_text` for "Acme Coffee", `add_sprite` for the logo. All works fine — tool descriptions are clear, parameter names are obvious (`x`, `y`, `width`, `height`, `anchorX`, `anchorY`).

The agent has to know the **viewport coordinate convention** (top-left origin, anchor in [0..1]) — but the tool descriptions don't say so. `add_text` doesn't document where `(x, y)` lands relative to the text baseline. The agent has to read `design-doc.md` §3 to find out, which it likely doesn't have. **Documentation gap inside tool descriptions.**

**Step 5: animation.** The agent reaches for templates. `list_templates` returns built-ins. Then `apply_template` to drop in a "title card" template with parametric text. Atomic. Nice.

For the logo, it wants a fade-in + scale pop. Two options:

- Three `add_tween` calls (opacity 0→1, scaleX 0.5→1, scaleY 0.5→1).
- One `apply_behavior { behavior: "popIn", ... }` — depending on what behaviors exist (the agent needs `list_behaviors` to discover this).

Both work. But: there is **no `list_easings` tool**. The Zod schema for `easing` is `z.enum(EASING_NAMES)` (`tools.ts:750`); if the agent guesses `"easeInOutQuart"` and the engine has it as `"easeInOutQuad"`, it gets `E_INVALID_VALUE` with the full enum dumped in the error message. Workable, but ugly. Adding a `list_easings` tool (or putting `EASING_NAMES` into the `easing` field's `.describe()`) would save a roundtrip.

**Step 6: visual check.**

```
validate
→ { valid: true, errors: [], warnings: [] }

render_thumbnail_strip { count: 6 }
→ 6 base64 PNGs at t = 0, 2, 4, 6, 8, 10
```

This is the moment that makes Davidup work for agents. Six small images, the model can look at them, decide "the text is cropped", and patch.

**Step 7: iterate.** The agent calls `update_item { id: "title", props: { x: 200 } }`. Re-renders. Looks good. Adds an `update_tween` to slow the fade. Re-renders.

This loop is where Davidup shines — it is the core differentiator vs prompt-to-video. It works **today** for the basics.

**Step 8: render final clip.**

Standalone: `render_to_video { outputPath: "/tmp/acme.mp4", codec: "libx264", crf: 18 }`. Blocks until done, returns `{ ok, outputPath, durationMs, frameCount }`. The agent has to have a writable `/tmp` or invent an absolute path on the user's machine. **It cannot ask "where should I write the file".**

Editor-hosted: same call returns a `jobId` immediately, plus `eventsUrl`. The agent polls `get_render { jobId }` or passes `wait: true`. Much nicer for the 10-second-clip case.

**Where it would get stuck today:**

1. **Asset discovery.** With the standalone server, the agent cannot enumerate fonts, images, or filesystem paths. The only escape is `list_library` from the editor server, but that requires running the editor.
2. **No "what does this asset look like" tool.** The agent can `register_asset` a PNG but cannot preview the asset itself before placing it. It has to add an item and render a frame.
3. **Coordinate convention is implicit.** Tool descriptions don't say "origin top-left", "anchor is fractional", "rotation is radians vs degrees" (it's degrees per `transform.rotation` in design-doc, but `tools.ts:533` doesn't say). The agent has to guess or read the spec.
4. **`render_to_video` output path.** No discovery tool for "where can I write". Standalone always uses cwd; editor sandbox is `<project>/renders/`. Different UX for the same tool.
5. **Long-running renders block the LLM context.** 10 seconds at 30fps is 300 frames — a few seconds on a fast box, much longer on a slow one. Standalone blocks the entire MCP call. Editor server is async; standalone isn't. Inconsistent surface.

## Bugs & gaps

### High severity

1. **`server.json` advertises 24 tools, README claims 25, reality is 44.**
   - Location: `server.json:18–44`, `README.md:11–12`, `examples/mcp-demo.md:31` ("25 tools from the design doc §4.1–4.6"), `examples/mcp-demo.md:110` ("the 25 tools become callable").
   - Severity: high — MCP registries that scrape `server.json` will show users the wrong capability set; agents reading `mcp-demo.md` will think behaviors/templates/scenes don't exist.
   - Fix: regenerate `server.json` from `TOOL_NAMES`, update README/demo, add a `bun run typecheck` step that asserts the two are in sync.

2. **`render_to_video` shape varies by host.** Standalone returns `{ ok: true, outputPath, durationMs, frameCount }`. Editor-async returns `{ jobId, status, outputPath, relativeOutputPath, totalFrames, startedAt, eventsUrl? }`. Editor-with-`wait: true` returns the legacy shape plus `jobId` and `relativeOutputPath`.
   - Location: `tools.ts:1577–1685`.
   - Severity: high for agents — they need conditional output parsing. The description tries to document this in prose (`tools.ts:1581–1586`) but a single tool returning three different schemas is not LLM-friendly.
   - Fix: always return the async shape with a `result: null | { ... }` field; have `wait: true` populate `result`. Or split into two tools (`render_to_video_sync` vs `render_to_video_async`).

3. **`import_scene` is a filesystem-read tool with no sandboxing in the standalone server.**
   - Location: `tools.ts:1141–1192`, `node:fs/promises` `readFile` on `args.path`.
   - Severity: high — when the standalone server is hosted as SaaS for untrusted agents, `import_scene { path: "/etc/passwd" }` reads the file (it then fails JSON parse, but the file *was* read; timing/error-channel can be used as an oracle).
   - Fix: standalone bin should refuse `import_scene` unless `DAVIDUP_ALLOW_FS=1`, or restrict to `cwd`. Editor bridge already sandboxes most fs-touching tools — but `import_scene` is in the registry-management bucket and **falls through to the default handler** (`mcp_bridge.ts:30`), meaning the editor server has no extra guard either.

4. **`define_user_template`, `define_scene`, `import_scene`, `remove_scene` mutate a process-global, cross-tenant registry.**
   - Location: `src/compose/templates.ts`, `src/compose/scenes.ts` (called from `tools.ts:1035`, `tools.ts:1136`, `tools.ts:1189`, `tools.ts:1220`).
   - Severity: high for SaaS hosting — the registry is **module-level state** shared by every concurrent MCP session. A scene defined by agent A is visible to agent B. Last-write-wins per id means agent B can shadow a built-in template and exfiltrate or corrupt agent A's output if A reuses the same template id later. The README and the design doc both call this "global registry, last-write-wins"; for a single-user CLI it's fine, for multi-tenant SaaS it's a serious leak.
   - Fix: scope template/scene registries to the `CompositionStore` (or to a request-scoped container the dispatcher passes through `deps`). The editor bridge already uses per-call deps (`mcp_bridge.ts:138`) — but the template/scene registry sits *outside* `deps`.

### Medium severity

5. **`render_preview_frame` and `render_thumbnail_strip` re-preload every asset on every call.**
   - Location: `render.ts:80–87` and `render.ts:112–113`.
   - Severity: medium — for a comp with 20 PNGs and a font, every preview frame re-fetches them all. For an agent iterating, this is the single biggest latency cost.
   - Fix: cache the `NodeAssetLoader` per composition id+asset-list hash. The composition is content-addressable so this is straightforward.

6. **`createServer` accepts `options.depsFactory` but the standalone `bin.ts` doesn't use it.**
   - Location: `bin.ts:9`, `server.ts:51`.
   - Severity: medium — every standalone call uses one shared `CompositionStore` for the process lifetime. Acceptable for single-client stdio, but if anyone ever runs the standalone server over an HTTP transport with multiple clients, they'll cross-talk.
   - Fix: this is correct for stdio; just document that the standalone bin is single-tenant.

7. **`render_to_video` description claims `wait: true` "is ignored" on the standalone engine** but the code path doesn't read `wait` at all on that branch (`tools.ts:1663–1684`). Behavior is correct; description could mislead an LLM into thinking it must omit `wait`.

8. **No discovery tool for easing names, behaviors, or templates' default values.**
   - `list_behaviors` and `list_templates` exist but `EASING_NAMES` isn't surfaced. Agent must hit `E_INVALID_VALUE` and parse the enum out of the error message.
   - Fix: add `list_easings` (tiny tool) or attach `EASING_NAMES` to the `easing` parameter's `.describe()` so Claude sees them in the schema.

9. **`MCPLibraryItem.thumbnailUrl` is a relative URL `/api/library/thumbnail?...`** (`tools.ts:124`, `mcp_bridge.ts:523`). An agent that fetches it through MCP-the-protocol has no base. The MCP server has no resources/prompts capability declared (`server.json:13–17` says `resources: false`), so the agent cannot resolve the thumbnail without out-of-band knowledge of the editor's HTTP origin.
   - Fix: either expose thumbnails as base64 inline (like `render_preview_frame`) or enable MCP `resources` and return a `mcp://` URI.

10. **Tool description prose embeds polish-document section numbers** (`tools.ts:1582`: "polish §20.31", `tools.ts:1775`: "polish §20.30").
    - Severity: low — these mean nothing to an LLM and waste tokens in the schema.
    - Fix: strip internal versioning lingo from user-facing descriptions.

11. **`tools.ts:228, 240, 252` error with `E_UNKNOWN`** when a project/library/render-queue tool is called on the standalone server.
    - Severity: low — `E_UNKNOWN` is the catch-all and is misleading. The condition is "feature not available on this server" — a dedicated `E_FEATURE_UNAVAILABLE` would let agents branch cleanly without parsing the message.

12. **`render_to_video` `outputPath` description has no schema-level constraint on extension or path shape.**
    - Editor bridge requires it to live under the project root and defaults to `.mp4` (`mcp_bridge.ts:402`). The standalone server passes it straight to skia/ffmpeg. The tool description never says "must be writable" or "must end in a container ffmpeg recognizes".

13. **`stripCompositionId` in `mcp_bridge.ts:553–560`** silently drops the agent-supplied `compositionId`. Tools that pass an explicit `compositionId` to target a non-default composition will be re-routed to the editor's active project. Inconsistent with the standalone server's multi-comp semantics. The editor bridge documents this as a single-project model, but the silent strip will surprise an agent that wrote portable code targeting both servers.

14. **`renderControls.list` returns "newest first" by reversing in place** (`mcp_bridge.ts:485`). `renderJobs.list()` might be reused elsewhere; mutating the returned array is a hazard. Use a copy.

15. **`reset()` with no args on the standalone server nukes every composition AND resets the autoSeq** (`store.ts:286–288`). An agent calling `reset` to start over loses every other comp it was tracking in parallel. The description (`tools.ts:362`) does mention this but it's easy to miss.

### Low severity

16. **`get_composition` returns `{ json: ... }`** instead of returning the composition object directly. The wrapper is awkward — every consumer immediately unwraps `.json`. Mirror the design-doc surface (`{ json }` per §4.1) is the rationale but it costs tokens for no real benefit.

17. **`render_preview_frame` description does not document the maximum image size** — for a 4K composition the base64 payload is ~10MB. Agents may try to preview a 7680×4320 image and blow their context window. A `quality` knob for JPEG (compression) is missing; only PNG is sized-by-content.

18. **`MCPToolError.hint` is optional but tool authors are inconsistent.** Some throws include a hint (e.g. `tools.ts:228`), many don't. A hint is the single most valuable field for agent self-correction. Audit and add hints to every throw.

19. **No `cancel_render` tool.** The editor render queue supports it (`renderJobs.get(jobId)?.abort()` exists in the worker per the bridge code), but no MCP tool exposes it. An agent that starts a 30-minute render and realizes it sent the wrong composition has no recourse.

20. **The behavior expansion test (`tests/mcp/applyBehavior.test.ts`)** is 199 lines but does not test the rollback path when one of the emitted tweens overlaps an existing tween. The code path is implemented (`tools.ts:874–884`) but uncovered.

## High-leverage improvements for AI authoring

Ordered by impact-per-effort.

1. **Fix the count drift.** `server.json` and `mcp-demo.md` must match `TOOL_NAMES`. Add a CI assertion. This is a 30-minute fix that prevents every new agent from being told 25 tools exist when 44 do.

2. **Inline-document the coordinate, anchor, rotation, and easing conventions** in the relevant tool descriptions. Three sentences in `add_sprite`/`add_text`/`add_shape`/`add_tween` save the agent from needing access to the design doc:
   ```
   "Origin is top-left of the composition. anchorX/anchorY are fractional [0..1]
   relative to the item's bounding box. rotation is in degrees. Valid easings:
   easeInQuad, easeOutQuad, ... (see list_easings)."
   ```

3. **Add `list_easings` (or `get_engine_capabilities`)** as a one-liner discovery tool. Cost: ~10 lines of code. Benefit: every agent learns the right easing names without an error roundtrip.

4. **Add `list_fonts` / `list_assets_on_disk`** for the editor server. The library service is right there. The agent should never have to guess font family names.

5. **Surface `eventsUrl` as a real MCP resource OR add `wait_for_render { jobId, timeoutMs }`.** Polling `get_render` in a loop is the obvious agent pattern but burns tokens. An MCP server can stream resources; right now there is no way for the agent to know when a render completes other than polling.

6. **Add `register_asset_from_base64`.** An agent generating an SVG or composing a logo procedurally has no way to put bytes into the engine — it must write to disk first, which is an out-of-band capability the agent may not have. Take base64 + mime, write to a scratch dir under the project sandbox, register.

7. **Add `diff_frames { time, baselineImage }`.** Given the determinism guarantee, two preview frames at the same `t` after an edit can be diffed pixel-perfectly. An MCP tool that returns `{ identical: bool, percentDifferent, boundingBox, diffImage }` would let the agent verify an edit had the expected effect without LLM-vision in the loop.

8. **Scope template/scene registries to the store** so multi-tenant SaaS hosting works. Today these are process-global module state — a single agent's `define_user_template` leaks into every concurrent session.

9. **Normalize `render_to_video` to one return shape across both servers.** Either both blocking, both async, or one tool each. The current variadic-shape return is the single least LLM-friendly part of the surface.

10. **Replace `import_scene`'s raw filesystem read** with a sandboxed `read_project_scene { name }` that resolves names against `<project>/scenes/`. Standalone server should not accept arbitrary paths.

11. **Add a `hint` to every `MCPToolError` throw.** The error envelope has a beautiful structured field for it; only ~60% of throws populate it. Hints are how agents self-correct without burning a context window.

12. **Add `apply_template_dry_run` / `apply_behavior_dry_run`.** Returns the items+tweens that *would* be added, without mutation. Lets the agent estimate impact before committing.

13. **Add `cancel_render`** so an agent can abort a job started by mistake.

14. **Reduce preview latency.** Cache the `NodeAssetLoader` keyed by `comp.assets` content. The agent calls `render_preview_frame` 5–10× per iteration; this matters.

## SaaS-hosting concerns specific to MCP

Davidup is built around a single-process, single-user stdio server today. Moving to SaaS requires:

1. **Per-tenant store isolation.** `bin.ts` shares one `CompositionStore` per process. SaaS needs one per agent session, keyed off the JSON-RPC connection or an auth token. The `depsFactory` hook is already there (`server.ts:35`) — wire it up.

2. **Per-tenant template/scene/behavior registries.** This is the biggest blocker. Today `define_user_template`, `define_scene`, `import_scene`, `remove_scene` mutate process-global state. Two agents on the same backend will see each other's templates and can overwrite each other's user templates by id. Fix: thread a `registryScope` through `ToolDeps`, default to a global read-only catalog plus a per-session writable overlay.

3. **`import_scene` and `register_asset` fs reads must be sandboxed.** `import_scene` reads arbitrary paths (`tools.ts:1153`). `register_asset` stores arbitrary `src` strings that later get fetched by `NodeAssetLoader` — image URLs to internal IPs (SSRF), file:// URIs to `/etc/passwd`, etc. The editor bridge sandboxes outputs (`mcp_bridge.ts:394`) but **not asset inputs**.

4. **`render_to_video` writes to disk.** Agent-controlled `outputPath`. Standalone: anywhere on disk. Editor: forced under project root. SaaS hosting needs the same restriction — and probably a per-tenant quota and rate limit (render is expensive).

5. **No rate limits, no audit log.** Tool calls go straight through `dispatchTool` without instrumentation. Add a wrapper that:
   - logs every `(tenantId, toolName, argsHash, resultCode, durationMs)` for audit.
   - enforces per-tenant call-rate (especially on `render_to_video`, `render_preview_frame`, `import_scene`).
   - tags errors with `tenantId` so log analysis can spot abuse.

6. **Memory growth.** `CompositionStore` is in-memory only. Sessions that don't `reset()` accumulate indefinitely. A long-lived SaaS process needs a TTL on inactive stores. The store is "ephemeral by design" per the README — make that explicit with a documented session lifecycle.

7. **`MCPToolError` messages can leak filesystem paths.** `import_scene { path: "/etc/passwd" }` returns a message containing the path. For SaaS, scrub paths from messages before they reach the agent.

8. **`render_to_video` calls `renderToFile` which spawns ffmpeg with agent-controlled flags** (`tools.ts:1665`). `codec`, `preset`, `pixFmt` are constrained via Zod enum/string, but `outputPath` is a free string. Confirm ffmpeg argv doesn't allow `-protocol_whitelist file,http` injection via the outputPath (skia-canvas pipes via stdin so direct argv injection is unlikely, but worth a security review).

9. **Prototype pollution risk in `update_item`.** `props` is `z.object({...}).partial()` (`tools.ts:661–687`), then `stripUndefined(args.props)` flows into `store.updateItem`. Zod strips unknown keys by default — confirm; if it doesn't, an agent could send `props: { __proto__: {...} }`. (Spot check: Zod 3 strips unknowns from `.object()` unless `.passthrough()`. Safe.)

10. **DoS via gigantic templates/scenes.** `define_user_template` and `define_scene` accept `items: z.record(z.string().min(1), z.unknown())` with no size cap (`tools.ts:1015`, `tools.ts:1112`). An agent could register a template with a million items. Add a hard cap.

11. **DoS via long compositions.** `create_composition { duration: 100000, fps: 60 }` then `render_to_video` would render 6M frames. No upper bound on `duration` or `fps`. Add policy limits.

12. **Auth.** stdio MCP has no native auth — the client implicitly owns the process. SaaS needs to terminate the agent's connection over a transport that has auth (HTTP+SSE with bearer tokens, the MCP spec's HTTP transport). The current stdio-only setup means moving to SaaS = swapping transports.

## Verdict for v1.0

The MCP layer is the strongest part of the project. The vision — atomic, orthogonal, structured-error tools backed by a deterministic engine — is implemented cleanly and the editor bridge proves the multi-surface architecture works. The base layer (composition / assets / layers / items / tweens / render) is essentially shippable as-is.

What gates v1.0 quality is **consistency, discoverability, and SaaS-readiness**:

- **Counts and docs must match.** "25 tools" appears in three load-bearing places and isn't true anymore. Trivial fix, no excuse to ship wrong.
- **`render_to_video` needs one shape.** This is the most LLM-visible surface inconsistency.
- **Discovery is half-built.** `list_behaviors` / `list_templates` / `list_scenes` are great. `list_easings`, `list_fonts`, `list_engine_capabilities` are missing. The agent shouldn't need the design doc to call tools correctly.
- **Multi-tenant safety is not there yet.** Global registries, `import_scene` fs-read, no rate limits, no audit log — all need to land before exposing this to untrusted agents over the network. None are hard; all are missing.
- **Preview caching is the one perf win that compounds.** Every agent iteration is 5+ preview renders. Cut the asset re-preload and iteration loops become snappy.

If v1.0 means "ship the agent-driven editor in a single-user local Bun/Node app", the MCP layer is essentially ready — fix the count drift, smooth the `render_to_video` shape, add `list_easings`, document conventions in tool descriptions, and ship. If v1.0 also means "host this for multi-tenant SaaS", the registry-isolation and fs-sandbox work is real engineering effort that has not been done yet.

The architecture is sound. The polish gap is mechanical and addressable in 1–2 focused passes.

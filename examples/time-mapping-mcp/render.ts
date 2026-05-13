/**
 * Davidup v0.5 — MCP-driven time-mapping showcase.
 * ===================================================================
 *
 *   bun run examples/time-mapping-mcp/render.ts
 *
 * What this exercises
 * -------------------
 * Every scene/time-mapping primitive shipped in §8.5, driven entirely
 * through the MCP tool surface (no direct calls into the store from
 * userland). The tools are invoked in-process via `dispatchTool()` so
 * the example doubles as a self-contained smoke test for the MCP
 * server's handler layer — same code path that the stdio transport hits,
 * just without a subprocess boundary.
 *
 * Composition: 1280x720, 30fps, 14s.
 * One scene `pulseDot` (4s) is registered and instantiated four times,
 * once per time-mapping mode. Each instance lives in its own quadrant:
 *
 *   ┌────────────────────────────┬────────────────────────────┐
 *   │  IDENTITY     (start=2)    │   LOOP ×3      (start=0)   │
 *   │  one pulse, t=2..6         │   three back-to-back, 0..12│
 *   ├────────────────────────────┼────────────────────────────┤
 *   │  TIMESCALE 0.5 (start=2)   │   CLIP [0..3]  (start=2)   │
 *   │  one slow pulse, t=2..10   │   trimmed pulse, t=2..5    │
 *   └────────────────────────────┴────────────────────────────┘
 *
 * MCP tools touched (in call order):
 *
 *   reset, create_composition, register_asset, define_scene, list_scenes,
 *   add_layer, add_text (×5: header + 4 labels), add_scene_instance (×4),
 *   update_scene_instance (lifts one of the dots), validate, get_composition,
 *   render_preview_frame, render_to_video.
 *
 * Outputs land in `examples/time-mapping-mcp/output/`:
 *   - composition.json       — canonical compiled JSON (pre-render)
 *   - preview-t02.png        — preview frame at t=2.0s (just after fadeIn)
 *   - time-mapping-mcp.mp4   — final render
 *
 * If the MCP `render_to_video` call fails (typically: ffmpeg missing on
 * $PATH), the script falls back to `renderToFile()` with `ffmpeg-static`
 * so the demo still produces a clip on a fresh machine.
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type DispatchResult,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "output");
const COMPOSITION_JSON = join(OUTPUT_DIR, "composition.json");
const PREVIEW_PNG = join(OUTPUT_DIR, "preview-t045.png");
const VIDEO_MP4 = join(OUTPUT_DIR, "time-mapping-mcp.mp4");

const FONT_PATH = resolve(HERE, "..", "fonts", "BebasNeue-Regular.ttf");

// ──────────────── Tiny dispatcher harness ────────────────

function findTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`MCP tool not registered: ${name}`);
  return tool;
}

async function call<T = unknown>(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const out: DispatchResult = await dispatchTool(findTool(name), args, deps);
  if (!out.ok) {
    const e = out.error;
    throw new Error(
      `[MCP ${name}] ${e.code}: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`,
    );
  }
  return out.result as T;
}

// `render_to_video` is the one exception we want to be tolerant of: a missing
// ffmpeg shouldn't kill the demo. Returns the dispatch result raw so the
// caller can branch on success / fall back to a static binary.
async function callTolerant(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<DispatchResult> {
  return dispatchTool(findTool(name), args, deps);
}

// ──────────────── Quadrant + scene constants ────────────────

const SCENE_ID = "pulseDot";
const SCENE_DURATION = 4.0;

// Pulse colors (Tailwind-ish palette for visual contrast).
const COLORS = {
  identity: "#34d399",   // emerald
  loop:     "#60a5fa",   // sky
  timeScale:"#f472b6",   // pink
  clip:     "#fbbf24",   // amber
} as const;

// Wrapper-group positions per quadrant.
type Spot = { x: number; y: number; labelY: number };
// labelY sits 120px below each dot's centre — clears the 168px-diameter
// peak-scale (1.4×120) bounding box with room for the caption underneath.
const SPOTS = {
  identity:  { x: 320,  y: 280, labelY: 410 },
  loop:      { x: 960,  y: 280, labelY: 410 },
  timeScale: { x: 320,  y: 540, labelY: 670 },
  clip:      { x: 960,  y: 540, labelY: 670 },
} satisfies Record<keyof typeof COLORS, Spot>;

// ──────────────── Main flow ────────────────

async function main(): Promise<void> {
  const store = new CompositionStore();
  const deps: ToolDeps = { store };

  const log = (s: string) => console.log(`[davidup] ${s}`);

  // 1. Reset is a no-op against a fresh store but proves the tool is wired.
  await call(deps, "reset", {});

  // 2. Composition shell.
  await call(deps, "create_composition", {
    width: 1280,
    height: 720,
    fps: 30,
    duration: 14,
    background: "#0b0d12",
  });
  log("created composition: 1280x720 @ 30fps, 14s");

  // 3. Font asset for the header + labels.
  await call(deps, "register_asset", {
    id: "font-display",
    type: "font",
    src: FONT_PATH,
    family: "DavidupDisplay",
  });

  // 4. Scene definition. The dot is anchored centre-centre at scene-local
  //    (0,0); each instance positions it via the wrapper transform.
  //
  //    Tween schedule (chosen so CLIP [0..3] keeps every active tween fully
  //    inside the window — no E_TIME_MAPPING_TWEEN_SPLIT):
  //
  //      [0.0, 0.6]  fadeIn       (opacity 0 → 1)
  //      [1.0, 2.0]  popUpX/Y     (scale   1 → 1.4)
  //      [2.0, 3.0]  popDnX/Y     (scale 1.4 → 1)
  //      [3.4, 4.0]  fadeOut      (opacity 1 → 0)
  //
  //    The 0.4s gap between popDn and fadeOut means CLIP toTime=3 ends
  //    exactly at popDn's end (kept — `end > toTime + 1e-9` is false) and
  //    drops fadeOut. Identity / loop / timeScale all see the full schedule.
  await call(deps, "define_scene", {
    id: SCENE_ID,
    description: "A circle that fades in, pulses up & down, then fades out.",
    duration: SCENE_DURATION,
    size: { width: 240, height: 240 },
    params: [
      { name: "color", type: "color", required: true, description: "Dot fill color." },
    ],
    items: {
      dot: {
        type: "shape",
        kind: "circle",
        width: 120,
        height: 120,
        fillColor: "${params.color}",
        transform: {
          x: 0, y: 0,
          scaleX: 1, scaleY: 1,
          rotation: 0,
          anchorX: 0.5, anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      { id: "fadeIn",  target: "dot", property: "transform.opacity", from: 0,   to: 1,   start: 0.0, duration: 0.6, easing: "easeOutQuad" },
      { id: "popUpX",  target: "dot", property: "transform.scaleX",  from: 1,   to: 1.4, start: 1.0, duration: 1.0, easing: "easeOutBack" },
      { id: "popUpY",  target: "dot", property: "transform.scaleY",  from: 1,   to: 1.4, start: 1.0, duration: 1.0, easing: "easeOutBack" },
      { id: "popDnX",  target: "dot", property: "transform.scaleX",  from: 1.4, to: 1,   start: 2.0, duration: 1.0, easing: "easeInQuad" },
      { id: "popDnY",  target: "dot", property: "transform.scaleY",  from: 1.4, to: 1,   start: 2.0, duration: 1.0, easing: "easeInQuad" },
      { id: "fadeOut", target: "dot", property: "transform.opacity", from: 1,   to: 0,   start: 3.4, duration: 0.6, easing: "easeInQuad" },
    ],
  });

  // 5. Sanity: list_scenes must echo the registration.
  const sceneList = await call<{ scenes: Array<{ id: string; emits: string[] }> }>(
    deps,
    "list_scenes",
  );
  const found = sceneList.scenes.find((s) => s.id === SCENE_ID);
  if (!found) throw new Error("define_scene didn't reach the registry");
  log(`scene "${SCENE_ID}" registered (emits ${found.emits.join(", ")})`);

  // 6. Layers: chrome (header + labels) under, action (dots) over.
  await call(deps, "add_layer", { id: "chrome", z: 0 });
  await call(deps, "add_layer", { id: "action", z: 10 });

  // 7. Header.
  await call(deps, "add_text", {
    layerId: "chrome",
    id: "header",
    text: "TIME MAPPING SHOWCASE",
    font: "font-display",
    fontSize: 56,
    color: "#f5f5f5",
    x: 640,
    y: 80,
    align: "center",
  });

  // 8. Subtitle under the header — a smaller line of context.
  await call(deps, "add_text", {
    layerId: "chrome",
    id: "subheader",
    text: "one scene · four time mappings · all driven over MCP",
    font: "font-display",
    fontSize: 24,
    color: "#94a3b8",
    x: 640,
    y: 120,
    align: "center",
  });

  // 9. Four scene instances, one per time-mapping mode.
  //
  //    - identity  (default; we set it explicitly to exercise the schema path)
  //    - loop      count=3  → 3 back-to-back pulses, 12s span
  //    - timeScale 0.5      → one stretched pulse, 8s span
  //    - clip      [0, 3.0] → trimmed pulse: keeps fadeIn + pop, drops fadeOut

  await call(deps, "add_scene_instance", {
    id: "q-identity",
    sceneId: SCENE_ID,
    layerId: "action",
    start: 2,
    params: { color: COLORS.identity },
    transform: { x: SPOTS.identity.x, y: SPOTS.identity.y },
    time: { mode: "identity" },
  });

  await call(deps, "add_scene_instance", {
    id: "q-loop",
    sceneId: SCENE_ID,
    layerId: "action",
    start: 0,
    params: { color: COLORS.loop },
    transform: { x: SPOTS.loop.x, y: SPOTS.loop.y },
    time: { mode: "loop", count: 3 },
  });

  await call(deps, "add_scene_instance", {
    id: "q-timescale",
    sceneId: SCENE_ID,
    layerId: "action",
    start: 2,
    params: { color: COLORS.timeScale },
    transform: { x: SPOTS.timeScale.x, y: SPOTS.timeScale.y },
    time: { mode: "timeScale", scale: 0.5 },
  });

  await call(deps, "add_scene_instance", {
    id: "q-clip",
    sceneId: SCENE_ID,
    layerId: "action",
    start: 2,
    params: { color: COLORS.clip },
    transform: { x: SPOTS.clip.x, y: SPOTS.clip.y },
    time: { mode: "clip", fromTime: 0, toTime: 3.0 },
  });

  // 10. Labels under each dot.
  const labels: Array<{ id: string; spot: Spot; text: string }> = [
    { id: "lbl-identity",  spot: SPOTS.identity,  text: "IDENTITY · 1 pulse" },
    { id: "lbl-loop",      spot: SPOTS.loop,      text: "LOOP ×3 · 12s" },
    { id: "lbl-timescale", spot: SPOTS.timeScale, text: "TIMESCALE 0.5× · slow" },
    { id: "lbl-clip",      spot: SPOTS.clip,      text: "CLIP [0..3.0] · trimmed" },
  ];
  for (const l of labels) {
    await call(deps, "add_text", {
      layerId: "chrome",
      id: l.id,
      text: l.text,
      font: "font-display",
      fontSize: 28,
      color: "#cbd5e1",
      x: l.spot.x,
      y: l.spot.labelY,
      align: "center",
    });
  }

  // 11. Demo update_scene_instance: shift the clip quadrant a few pixels
  //     up so it visually aligns with its label (also exercises the patch
  //     path that re-expands the scene under the same id).
  await call(deps, "update_scene_instance", {
    instanceId: "q-clip",
    transform: { x: SPOTS.clip.x, y: SPOTS.clip.y - 20 },
  });
  log("update_scene_instance: nudged q-clip up by 20px");

  // 12. Validate. Time-mapping output is plain v0.1 tweens after the
  //     compile pass, so the existing overlap detector covers loop
  //     iteration boundaries (1µs EPS handles touching ends).
  const v = await call<{ valid: boolean; errors: unknown[]; warnings: unknown[] }>(
    deps,
    "validate",
  );
  if (!v.valid) throw new Error(`composition invalid: ${JSON.stringify(v.errors)}`);
  log(`validate ok (${v.warnings.length} warnings)`);

  // 13. Snapshot the canonical composition for inspection.
  const snap = await call<{ json: Composition }>(deps, "get_composition");
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(COMPOSITION_JSON, JSON.stringify(snap.json, null, 2) + "\n");
  log(
    `wrote ${COMPOSITION_JSON} ` +
      `(${Object.keys(snap.json.items).length} items, ${snap.json.tweens.length} tweens)`,
  );

  // 14. Preview frame — t=4.5 is the only moment when every quadrant is
  //     visible at once:
  //       - identity   (start=2): scene-local 2.5s, mid pop-down
  //       - loop ×3    (start=0): scene-local 0.5 of iter1, fading in
  //       - timescale  (start=2): scene-local 1.25s (4.5−2 × 0.5), mid pop-up
  //       - clip [0..3](start=2): clip-shifted, mid pop-down
  const preview = await call<{ image: string }>(deps, "render_preview_frame", {
    time: 4.5,
    format: "png",
  });
  await writeFile(PREVIEW_PNG, Buffer.from(preview.image, "base64"));
  log(`wrote preview frame → ${PREVIEW_PNG}`);

  // 15. Render. Try the MCP path first; fall back to direct renderToFile
  //     with ffmpeg-static if the system has no `ffmpeg` on $PATH.
  log(`rendering MP4 → ${VIDEO_MP4}`);
  const startedAt = performance.now();
  const render = await callTolerant(deps, "render_to_video", {
    outputPath: VIDEO_MP4,
    codec: "libx264",
    crf: 20,
    preset: "medium",
  });

  if (render.ok) {
    const wallMs = performance.now() - startedAt;
    const size = await stat(VIDEO_MP4).then((s) => s.size).catch(() => 0);
    const r = render.result as { frameCount: number; durationMs: number };
    log(
      `done via MCP. ${r.frameCount} frames in ${wallMs.toFixed(0)}ms wall ` +
        `(${(size / 1_048_576).toFixed(2)}MB)`,
    );
    return;
  }

  // Fallback: the MCP path failed — almost always a missing/broken ffmpeg.
  // Re-validate and shell out via ffmpeg-static so a fresh checkout still
  // produces an artifact.
  console.warn(
    `[davidup] render_to_video failed (${render.error.code}: ${render.error.message}); ` +
      `retrying with ffmpeg-static`,
  );
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error(
      `Neither system ffmpeg nor ffmpeg-static is available. ` +
        `Install ffmpeg or \`bun add -D ffmpeg-static\`.`,
    );
  }
  const out = await renderToFile(snap.json, VIDEO_MP4, {
    codec: "libx264",
    crf: 20,
    preset: "medium",
    movflagsFaststart: true,
    ffmpegPath,
  });
  const size = await stat(VIDEO_MP4).then((s) => s.size).catch(() => 0);
  log(
    `done via fallback. ${out.frameCount} frames, ${(size / 1_048_576).toFixed(2)}MB`,
  );
}

async function resolveFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = (await import("ffmpeg-static")) as { default?: string | null };
    return mod.default ?? undefined;
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error("[davidup] fatal:", err);
  process.exit(1);
});

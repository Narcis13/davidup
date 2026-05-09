/**
 * Davidup — JS API tour
 * =========================
 *
 * This script exercises every public surface of the v0.1 engine end-to-end:
 *
 *   1. Read   examples/hello-world.json (the §3.1 logo fade-in).
 *   2. Validate via the schema layer (Zod parse + the 8 semantic rules in §3.5).
 *   3. Sample the resolver by hand at a few times — proof that computeStateAt
 *      is a pure function (no canvas, no assets).
 *   4. Render a single PNG frame at t=0.5 through the MCP-flavoured preview
 *      helper (returns base64 — we decode to disk).
 *   5. Render the full 3-second clip to MP4 via the node driver
 *      (skia-canvas → ffmpeg stdin pipeline, per design-doc §5.6 / §6).
 *
 * Run it:
 *
 *   bun run examples/render.ts
 *
 * Outputs land in `examples/output/`:
 *   - hello-world.frame-500ms.png   (single preview frame)
 *   - hello-world.mp4               (full clip)
 *
 * Requirements:
 *   - Bun ≥ 1.1 (or Node ≥ 20 — adjust the shebang and skip `Bun.file`).
 *   - `ffmpeg` on $PATH for the MP4 step. The PNG step has no ffmpeg dependency.
 *
 * Determinism guarantee (per design-doc §1):
 *   The same composition + same time → exact same pixels, every run, every host.
 *   That's why this script is reproducible: the outputs are byte-identical
 *   across machines as long as skia-canvas and ffmpeg versions match.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// All public entrypoints come from subpath exports declared in package.json:
//   "./schema"  → schema parsing + validate()
//   "./engine"  → computeStateAt + renderFrame (platform-agnostic)
//   "./node"    → renderToFile (skia-canvas + ffmpeg subprocess)
//   "./mcp"     → renderPreviewFrame (single-frame PNG/JPEG to base64)
//
// We use file paths here because the example runs from a checkout, but in a
// downstream consumer you'd write `from "davidup/schema"` etc.
import { validate, type Composition } from "../src/schema/index.js";
import { computeStateAt } from "../src/engine/index.js";
import { renderToFile } from "../src/drivers/node/index.js";
import { renderPreviewFrame } from "../src/mcp/render.js";

// ──────────────────────────────────────────────────────────────────────────
// Path setup. Resolve everything relative to *this file* so the script works
// regardless of the cwd it was launched from.
// ──────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSITION_PATH = resolve(HERE, "hello-world.json");
const OUTPUT_DIR = resolve(HERE, "output");
const PREVIEW_PNG_PATH = join(OUTPUT_DIR, "hello-world.frame-500ms.png");
const VIDEO_MP4_PATH = join(OUTPUT_DIR, "hello-world.mp4");

async function main(): Promise<void> {
  // ── Step 1: load the canonical JSON ──────────────────────────────────────
  // The JSON is the source of truth. Engine, drivers, MCP — they all consume
  // the same shape. Loading a hand-authored file (or an LLM-generated one) is
  // exactly the same as building it programmatically.
  log("step 1/5  reading composition", COMPOSITION_PATH);
  const raw = await readFile(COMPOSITION_PATH, "utf8");
  const json = JSON.parse(raw) as unknown;

  // ── Step 2: validate ─────────────────────────────────────────────────────
  // `validate` returns { valid, errors[], warnings[] }. Errors are structural
  // problems (missing assets, overlapping tweens, group cycles, …); warnings
  // are non-fatal (e.g. a tween extends past the composition end).
  log("step 2/5  validating");
  const result = validate(json);
  if (!result.valid) {
    console.error("validation failed:");
    for (const err of result.errors) {
      console.error(`  [${err.code}] ${err.message}${err.path ? ` (${err.path})` : ""}`);
    }
    process.exit(1);
  }
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`  warning [${w.code}] ${w.message}`);
    }
  }
  // After this point we know `json` matches the Composition shape, so we can
  // assert the type. Validate stripped any unknown keys (e.g. our $comment).
  const comp = json as Composition;

  // ── Step 3: poke the resolver (no canvas, no I/O) ────────────────────────
  // computeStateAt is pure: same (comp, t) → same ResolvedScene. This is the
  // primitive every renderer is built on. Useful for tests and debugging
  // animations without touching pixels.
  log("step 3/5  sampling resolver at a few times");
  const samples = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 3.0];
  for (const t of samples) {
    const scene = computeStateAt(comp, t);
    const logo = scene.items["logo"];
    if (!logo) continue;
    const tr = logo.transform;
    console.log(
      `    t=${t.toFixed(2)}s  opacity=${tr.opacity.toFixed(3)}  scale=${tr.scaleX.toFixed(3)}`,
    );
  }
  // Expected output (matches §3.1):
  //   t=0.00 → opacity 0,    scale 0.500
  //   t=0.50 → opacity ≈0.75 (easeOutQuad), scale ≈0.86 (easeOutBack at ~0.33)
  //   t=1.00 → opacity 1,    scale ≈0.99 (still tweening; ends at 1.5s)
  //   t=1.50 → opacity 1     (held), scale 1.000
  //   t=3.00 → opacity 1     (held), scale 1.000

  await mkdir(OUTPUT_DIR, { recursive: true });

  // ── Step 4: single-frame preview to PNG ──────────────────────────────────
  // renderPreviewFrame is the same helper the MCP `render_preview_frame` tool
  // uses internally — it returns base64. We decode to a Buffer and save.
  // No ffmpeg involved here: skia-canvas can encode PNG directly.
  log("step 4/5  rendering preview PNG at t=0.5s →", PREVIEW_PNG_PATH);
  const preview = await renderPreviewFrame(comp, 0.5, { format: "png" });
  await writeFile(PREVIEW_PNG_PATH, Buffer.from(preview.image, "base64"));
  log(
    `          ${preview.width}×${preview.height}  ${preview.mimeType}  ` +
      `${humanBytes(Buffer.byteLength(preview.image, "base64"))}`,
  );

  // ── Step 5: full clip to MP4 ─────────────────────────────────────────────
  // renderToFile drives the entire pipeline: preload assets, allocate a single
  // skia Canvas, walk every frame at i/fps, pipe RGBA bytes to ffmpeg's stdin,
  // wait for ffmpeg to close. CRF 18 = near-lossless; bump to 23 for smaller
  // web-friendly files.
  log("step 5/5  rendering MP4 →", VIDEO_MP4_PATH);
  // Resolve an ffmpeg binary. We prefer the prebuilt one bundled by
  // `ffmpeg-static` (a devDependency in this repo) so the example is
  // reproducible on any dev machine; fall back to whichever ffmpeg is on
  // $PATH otherwise (which is what the public API does by default).
  const ffmpegPath = await resolveFfmpegPath();
  if (ffmpegPath) log(`          using ffmpeg at ${ffmpegPath}`);

  const startedAt = performance.now();
  const out = await renderToFile(comp, VIDEO_MP4_PATH, {
    codec: "libx264",
    crf: 18,
    preset: "medium",
    movflagsFaststart: true, // recommended for web playback (per §6 note)
    ...(ffmpegPath ? { ffmpegPath } : {}),
  });
  const wallMs = performance.now() - startedAt;

  log(
    `          ${out.frameCount} frames in ${out.durationMs.toFixed(0)}ms ` +
      `(wall ${wallMs.toFixed(0)}ms; ${(out.frameCount / (out.durationMs / 1000)).toFixed(1)} fps)`,
  );

  // Belt-and-braces sanity check: if the local ffmpeg is broken (e.g. dyld
  // missing libx265) it can crash mid-stream; the driver currently treats
  // signal-killed exits as success, so the only reliable check from outside
  // is "did a non-empty file appear on disk".
  const fileSize = await stat(VIDEO_MP4_PATH)
    .then((s) => s.size)
    .catch(() => 0);
  if (fileSize === 0) {
    console.error(
      `\n[davidup] WARNING: ffmpeg reported success but ${VIDEO_MP4_PATH} ` +
        `is missing or empty. Your local ffmpeg likely failed to start (broken ` +
        `dynamic library, missing codec). Try: ffmpeg -version on the CLI.`,
    );
    process.exit(2);
  }

  console.log("\ndone.");
  console.log(`  preview frame: ${PREVIEW_PNG_PATH}`);
  console.log(`  rendered clip: ${VIDEO_MP4_PATH}  (${humanBytes(fileSize)})`);
  console.log("  open in QuickTime / VLC / mpv to verify.");
}

async function resolveFfmpegPath(): Promise<string | undefined> {
  // ffmpeg-static is a devDependency. If it's installed we use its bundled
  // binary; otherwise we let renderToFile spawn whatever 'ffmpeg' is on $PATH.
  try {
    const mod = (await import("ffmpeg-static")) as { default?: string | null };
    return mod.default ?? undefined;
  } catch {
    return undefined;
  }
}

function log(...args: unknown[]): void {
  console.log("[davidup]", ...args);
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

main().catch((err) => {
  console.error("[davidup] fatal:", err);
  process.exit(1);
});

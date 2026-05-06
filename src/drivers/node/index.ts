// Server render driver — skia-canvas + ffmpeg subprocess (per design-doc §5.6, §6).
//
// Pipeline per frame:
//   1. clearRect — single Canvas reused across the whole render (per §5.7).
//   2. renderFrame(comp, t, ctx) — engine paints into skia's Canvas2D.
//   3. canvas.toBuffer('raw') — RGBA bytes, fed straight into ffmpeg stdin.
//   4. backpressure: when stdin.write returns false, await 'drain' before the
//      next frame so a slow encoder cannot let the buffer grow without bound.
//
// skia-canvas is lazy-imported (indirect specifier) so this module is safe to
// reference from environments where the native binary is absent — tests inject
// a fake module to exercise behaviour without the dependency.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { Writable } from "node:stream";

import {
  NodeAssetLoader,
  type AssetLoader,
  type SkiaCanvasModule,
} from "../../assets/index.js";
import { indexTweens, renderFrame } from "../../engine/index.js";
import type { Canvas2DContext } from "../../engine/types.js";
import type { Composition } from "../../schema/types.js";

export interface SkiaCanvasInstance {
  getContext(kind: "2d"): Canvas2DContext;
  toBuffer(format: "raw"): Promise<Uint8Array> | Uint8Array;
}

export interface SkiaDriverModule extends SkiaCanvasModule {
  Canvas: new (width: number, height: number) => SkiaCanvasInstance;
}

export type FfmpegSpawn = (cmd: string, args: ReadonlyArray<string>) => ChildProcess;

export interface RenderToFileOptions {
  codec?: "libx264" | "libx265";
  crf?: number;
  preset?: string;
  pixFmt?: string;
  ffmpegPath?: string;
  movflagsFaststart?: boolean;

  // Injection points (primarily for tests; production callers leave unset).
  skiaCanvas?: SkiaDriverModule;
  loader?: AssetLoader;
  spawn?: FfmpegSpawn;
}

export interface RenderToFileResult {
  outputPath: string;
  durationMs: number;
  frameCount: number;
}

const STDERR_TAIL_BYTES = 4096;

export async function renderToFile(
  comp: Composition,
  outPath: string,
  opts: RenderToFileOptions = {},
): Promise<RenderToFileResult> {
  const startedAt = nowMs();
  const skia = opts.skiaCanvas ?? (await importSkiaCanvas());
  const loader = opts.loader ?? new NodeAssetLoader({ skiaCanvas: skia });

  await loader.preloadAll(comp.assets);

  const meta = comp.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(comp);

  const totalFrames = frameCount(comp);

  const args = buildFfmpegArgs(comp, outPath, opts);
  const spawnFn = opts.spawn ?? defaultSpawn;
  const ffmpeg = spawnFn(opts.ffmpegPath ?? "ffmpeg", args);

  const stdin = ffmpeg.stdin;
  if (!stdin) {
    throw new Error("ffmpeg subprocess has no stdin");
  }

  let stderrTail = "";
  if (ffmpeg.stderr) {
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (chunk: string) => {
      stderrTail += chunk;
      if (stderrTail.length > STDERR_TAIL_BYTES) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_BYTES);
      }
    });
  }

  // Race-aware close + stdin error so the loop bails fast on ffmpeg crashes
  // (e.g. EPIPE from a missing codec) rather than hanging on the next drain.
  const closePromise = waitForClose(ffmpeg);
  let stdinErrored: Error | undefined;
  stdin.on("error", (err) => {
    stdinErrored = err as Error;
  });

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (stdinErrored) throw stdinErrored;
      const t = i / meta.fps;
      ctx.clearRect(0, 0, meta.width, meta.height);
      renderFrame(comp, t, ctx, { assets: loader, index: tweenIndex });
      const raw = await Promise.resolve(canvas.toBuffer("raw"));
      const buf = toNodeBuffer(raw);
      const ok = stdin.write(buf);
      if (!ok) await waitForDrain(stdin);
    }
  } catch (err) {
    safeKill(ffmpeg);
    throw err;
  }

  stdin.end();
  const code = await closePromise;
  if (code !== 0) {
    const tail = stderrTail.trim();
    throw new Error(
      `ffmpeg exited with code ${code}${tail ? `:\n${tail}` : ""}`,
    );
  }

  return {
    outputPath: outPath,
    durationMs: nowMs() - startedAt,
    frameCount: totalFrames,
  };
}

export function buildFfmpegArgs(
  comp: Composition,
  outPath: string,
  opts: RenderToFileOptions,
): string[] {
  // Canonical pipeline from design-doc §6. Keep the input/output flag pairing
  // intact: ordering matters to ffmpeg.
  const meta = comp.composition;
  const args: string[] = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${meta.width}x${meta.height}`,
    "-r",
    String(meta.fps),
    "-i",
    "pipe:0",
    "-c:v",
    opts.codec ?? "libx264",
    "-preset",
    opts.preset ?? "medium",
    "-crf",
    String(opts.crf ?? 18),
    "-pix_fmt",
    opts.pixFmt ?? "yuv420p",
  ];
  if (opts.movflagsFaststart) {
    args.push("-movflags", "+faststart");
  }
  args.push(outPath);
  return args;
}

export function frameCount(comp: Composition): number {
  // Match the design-doc reference: ceil(duration * fps). Always at least one
  // frame so a zero-duration composition still produces a valid (1-frame) clip.
  const { duration, fps } = comp.composition;
  return Math.max(1, Math.ceil(duration * fps));
}

function defaultSpawn(cmd: string, args: ReadonlyArray<string>): ChildProcess {
  return nodeSpawn(cmd, args as string[], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function waitForDrain(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      stream.off("drain", onDrain);
      reject(err);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function waitForClose(child: ChildProcess): Promise<number> {
  const [code] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
  return code ?? 0;
}

function toNodeBuffer(raw: Uint8Array): Buffer {
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

function safeKill(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // child already gone; nothing to do.
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function importSkiaCanvas(): Promise<SkiaDriverModule> {
  // String-variable specifier + @vite-ignore so Vite/Vitest don't try to
  // pre-resolve skia-canvas at transform time (it's a native module). The
  // node driver is the only consumer; browser/Vite builds never reach this.
  const specifier = "skia-canvas";
  return import(/* @vite-ignore */ specifier) as Promise<SkiaDriverModule>;
}

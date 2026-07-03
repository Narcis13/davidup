// Pre-extract pipeline for video frames (v0.2 §S7).
//
// Video clips render as textures: a `VideoItem` is drawn from a PNG sequence
// pre-extracted from its source asset (drawing itself lands in §S8). This
// module is the extraction half — before any frame is encoded, the render
// driver asks it to materialise, for every distinct video clip in the
// composition, a directory of numbered PNGs ffmpeg produced with:
//
//   ffmpeg -ss <trimIn> -i <asset> -t <trimOut-trimIn>
//          -vf "fps=<compFps>,scale=<W>:<H>" cache/<hash>/%05d.png
//
// (The plan writes `-to <trimOut>`; we use `-t <duration>` instead — after an
// input `-ss` it is the version-stable way to express the same [trimIn,trimOut)
// window, since `-to` semantics relative to input seeking have varied across
// ffmpeg releases and determinism is a project invariant.)
//
// Caching: the cache directory name is a deterministic hash of everything that
// changes the pixels — the resolved source path, the file's mtime + size (so a
// re-encoded asset at the same path misses), the trim window, the composition
// fps, and the target resolution. Two items that share those params share one
// cache entry, and a second render of the same project is a pure cache hit:
// no ffmpeg runs, the extraction cost collapses to a few stat calls.
//
// Entries are published atomically (extract into a `.tmp-*` dir, then rename)
// so an interrupted extraction never leaves a half-written entry that a later
// run mistakes for a hit. After each run the cache is pruned LRU to a byte
// budget (default 5 GB) using each entry's `accessedAt`, touched on every hit.
//
// The pure pieces (spec collection, hashing, arg building, prune) are exported
// for unit testing; only `preExtractVideoFrames` / `pruneCache` touch the
// filesystem or spawn ffmpeg, and both accept an injectable `spawn` so tests
// run without the native binary.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as nodeOs from "node:os";
import { join } from "node:path";

import { resolveGlobalSrc } from "../../assets/node.js";
import type { Composition, VideoAsset, VideoItem } from "../../schema/types.js";
import { resolveFfmpeg, sweepOrphanExtractDirs } from "./ffmpeg.js";
import type { FfmpegSpawn } from "./index.js";

/** Default LRU byte budget for the frame cache: 5 GB. Overridable per call. */
export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Marker file written into a published cache entry; its presence ⇒ complete. */
const META_FILENAME = "meta.json";

const STDERR_TAIL_BYTES = 4096;

// ───────────────────────────── spec collection ─────────────────────────────

/**
 * A distinct extraction job. Items sharing the same source + trim window + fps
 * + target resolution collapse to one spec (and one cache entry); `itemIds`
 * lists every video item the spec covers, sorted for deterministic reporting.
 */
export interface VideoExtractSpec {
  /** Deterministic cache key (sha256 hex of the pixel-affecting params). */
  hash: string;
  /** Composition item ids that resolve to this spec, sorted. */
  itemIds: string[];
  /** Source video asset id. */
  assetId: string;
  /** Filesystem path handed to ffmpeg (`global:` already resolved). */
  srcPath: string;
  /** Seconds into the source where extraction starts (default 0). */
  trimIn: number;
  /** Seconds into the source where extraction stops; undefined ⇒ to EOF. */
  trimOut: number | undefined;
  /** `trimOut - trimIn` when both are known, else undefined (extract to EOF). */
  duration: number | undefined;
  /** Target output frame rate (the composition fps). */
  fps: number;
  /** Target frame width in pixels. */
  width: number;
  /** Target frame height in pixels. */
  height: number;
}

/** Minimal `fs.stat` shape the hash needs; injectable so tests skip real files. */
export interface FileStat {
  mtimeMs: number;
  size: number;
}

export interface CollectSpecsOptions {
  /** Override the global library root for `global:` srcs (tests). */
  globalLibraryRoot?: string;
  /**
   * Stat a resolved source path. Default: `fs.statSync`. Injected by tests so
   * spec collection (and its hashing) runs without touching the disk.
   */
  statFile?: (path: string) => FileStat;
}

/** True when the composition places at least one video item. */
export function compositionHasVideo(comp: Composition): boolean {
  return Object.values(comp.items).some((it) => it.type === "video");
}

/**
 * Walk the composition's items, resolve every `VideoItem` to an extraction
 * spec, and dedupe by hash. Returned sorted by hash so the processing order
 * (and therefore progress reporting) is deterministic regardless of item
 * insertion order.
 *
 * @throws {Error} when a video item references a missing or non-video asset,
 *   the source file cannot be stat'd, or its box + asset dimensions are both
 *   unusable — the schema validator does not cross-check these, so this is the
 *   last guard before ffmpeg would fail opaquely (mirrors resolveAudioInputs).
 */
export function collectVideoExtractSpecs(
  comp: Composition,
  opts: CollectSpecsOptions = {},
): VideoExtractSpec[] {
  const fps = comp.composition.fps;
  const statFile = opts.statFile ?? defaultStatFile;
  const assetById = new Map(comp.assets.map((a) => [a.id, a] as const));
  const byHash = new Map<string, VideoExtractSpec>();

  for (const [id, item] of Object.entries(comp.items)) {
    if (item.type !== "video") continue;
    const video = item as VideoItem;

    const asset = assetById.get(video.asset);
    if (!asset) {
      throw new Error(
        `Video item "${id}" references unknown asset "${video.asset}".`,
      );
    }
    if (asset.type !== "video") {
      throw new Error(
        `Video item "${id}" references asset "${video.asset}" which is type "${asset.type}", not "video".`,
      );
    }
    const videoAsset = asset as VideoAsset;
    const srcPath = resolveGlobalSrc(videoAsset.src, opts.globalLibraryRoot);

    let fileStat: FileStat;
    try {
      fileStat = statFile(srcPath);
    } catch (err) {
      throw new Error(
        `Cannot stat video asset "${srcPath}" for item "${id}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const trimIn = video.trimIn ?? 0;
    // trimOut defaults to the asset's natural duration when known; otherwise it
    // stays undefined and ffmpeg extracts to EOF (freeze/loop is §S8's job).
    const trimOut = video.trimOut ?? videoAsset.duration;
    const duration =
      trimOut !== undefined ? Math.max(0, trimOut - trimIn) : undefined;

    const { width, height } = resolveExtractDimensions(video, videoAsset, id);

    const hash = computeSpecHash({
      src: srcPath,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      trimIn,
      trimOut: trimOut ?? null,
      fps,
      width,
      height,
    });

    const existing = byHash.get(hash);
    if (existing) {
      existing.itemIds.push(id);
      existing.itemIds.sort();
      continue;
    }
    byHash.set(hash, {
      hash,
      itemIds: [id],
      assetId: asset.id,
      srcPath,
      trimIn,
      trimOut,
      duration,
      fps,
      width,
      height,
    });
  }

  return [...byHash.values()].sort((a, b) =>
    a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
  );
}

// The frame box to extract at. Default: the item's authored width/height
// (rounded), matching the plan's literal `scale=<W>:<H>`. A degenerate box
// (zero/negative) falls back to the asset's native dimensions when known.
// Note: we extract at the BASE box size; width/height tweens are not factored
// in here (the cache is per static resolution). S8 owns the fit math, and can
// revisit the resolution policy — a different choice just yields fresh cache
// entries, no migration needed, because resolution is part of the hash.
function resolveExtractDimensions(
  item: VideoItem,
  asset: VideoAsset,
  itemId: string,
): { width: number; height: number } {
  const w = Math.round(item.width);
  const h = Math.round(item.height);
  if (w >= 1 && h >= 1) return { width: w, height: h };
  if (asset.width && asset.height) {
    return { width: asset.width, height: asset.height };
  }
  throw new Error(
    `Video item "${itemId}" has a degenerate box (${item.width}x${item.height}) ` +
      `and asset "${asset.id}" has unknown dimensions; cannot determine extract resolution.`,
  );
}

interface SpecHashInput {
  src: string;
  mtimeMs: number;
  size: number;
  trimIn: number;
  trimOut: number | null;
  fps: number;
  width: number;
  height: number;
}

/**
 * Deterministic cache key for an extraction. sha256 over a canonical JSON of
 * every pixel-affecting parameter; the asset's mtime + size are included so a
 * file replaced at the same path produces a fresh key (cache miss).
 */
export function computeSpecHash(input: SpecHashInput): string {
  const canonical = JSON.stringify({
    src: input.src,
    mtimeMs: input.mtimeMs,
    size: input.size,
    trimIn: input.trimIn,
    trimOut: input.trimOut,
    fps: input.fps,
    width: input.width,
    height: input.height,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ───────────────────────────── ffmpeg argv ─────────────────────────────────

/**
 * Build the ffmpeg argv that extracts `spec` into `outputPattern`
 * (e.g. `/cache/.tmp-xyz/%05d.png`). Pure — exported for unit testing.
 *
 * Input seek (`-ss` before `-i`) is fast and keyframe-accurate enough for a
 * texture; `-t duration` then caps the window. `-progress pipe:1 -nostats`
 * emits machine-readable `frame=N` lines on stdout for progress reporting.
 */
export function buildExtractArgs(
  spec: VideoExtractSpec,
  outputPattern: string,
): string[] {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    "-ss",
    fmtSeconds(spec.trimIn),
    "-i",
    spec.srcPath,
  ];
  if (spec.duration !== undefined) {
    args.push("-t", fmtSeconds(spec.duration));
  }
  args.push(
    "-vf",
    `fps=${fmtSeconds(spec.fps)},scale=${spec.width}:${spec.height}`,
    outputPattern,
  );
  return args;
}

// ───────────────────────────── orchestration ───────────────────────────────

/** A single cache entry's status after a pre-extract run. */
export interface FrameCacheEntry {
  hash: string;
  /** Absolute path of the published cache directory holding the PNG sequence. */
  dir: string;
  /** Number of PNG frames in the entry. */
  frameCount: number;
  /** Intrinsic pixel width of each extracted frame (drives §S8 `fit`). */
  width: number;
  /** Intrinsic pixel height of each extracted frame. */
  height: number;
  /** Total bytes of the PNG frames (excludes the meta marker). */
  bytes: number;
  /** Composition item ids served by this entry. */
  itemIds: string[];
  /** True when the entry was already present (no ffmpeg ran this round). */
  cached: boolean;
}

/** Progress event emitted while pre-extracting. */
export interface FrameExtractProgress {
  /** 1-based index of the current spec among `totalSpecs`. */
  spec: number;
  /** Total number of distinct extractions this run. */
  totalSpecs: number;
  hash: string;
  /** Composition item ids served by this spec. */
  itemIds: readonly string[];
  /** Frames produced so far for this spec. */
  frame: number;
  /** Expected frame count for this spec, when computable (else undefined). */
  totalFrames: number | undefined;
  /** True when this spec was a pure cache hit (no ffmpeg ran). */
  cached: boolean;
}

export interface PreExtractOptions {
  /** Cache root directory. Default: {@link defaultFrameCacheRoot}. */
  cacheRoot?: string;
  /** LRU byte budget. Default: {@link DEFAULT_CACHE_MAX_BYTES} (5 GB). */
  maxBytes?: number;
  /** Override the ffmpeg binary. Default: bundled `ffmpeg-static`, else `ffmpeg`. */
  ffmpegPath?: string;
  /** Override the spawn function (tests). Default: `child_process.spawn`. */
  spawn?: FfmpegSpawn;
  /** Override the global library root for `global:` srcs (tests). */
  globalLibraryRoot?: string;
  /** Inject the stat used for hashing (tests). Default: `fs.statSync`. */
  statFile?: (path: string) => FileStat;
  /** Progress callback; a throw here never aborts the extraction. */
  onProgress?: (info: FrameExtractProgress) => void;
}

export interface PreExtractResult {
  /** The cache root used. */
  root: string;
  /** Entries keyed by spec hash, parallel to {@link collectVideoExtractSpecs}. */
  entries: Map<string, FrameCacheEntry>;
  /** Total bytes resident in the cache after pruning. */
  cacheBytes: number;
  /** Cache entry hashes evicted by the LRU prune this run. */
  pruned: string[];
}

/**
 * Materialise a PNG sequence for every distinct video clip in the composition,
 * reusing cached entries where possible, then prune the cache to its byte
 * budget. Returns one {@link FrameCacheEntry} per distinct spec.
 *
 * @throws {Error} on a bad asset reference (see {@link collectVideoExtractSpecs})
 *   or when ffmpeg fails / produces no frames for a clip.
 */
export async function preExtractVideoFrames(
  comp: Composition,
  opts: PreExtractOptions = {},
): Promise<PreExtractResult> {
  const specs = collectVideoExtractSpecs(comp, {
    ...(opts.globalLibraryRoot !== undefined
      ? { globalLibraryRoot: opts.globalLibraryRoot }
      : {}),
    ...(opts.statFile !== undefined ? { statFile: opts.statFile } : {}),
  });

  const root = opts.cacheRoot ?? defaultFrameCacheRoot();
  const maxBytes = opts.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
  const entries = new Map<string, FrameCacheEntry>();

  // Best-effort sweep of `.tmp-*` dirs orphaned by a crashed/killed
  // extraction (R-12) before doing any new work. Age-gated so a concurrent
  // render's own in-flight staging dir is never touched; never fails the run.
  await sweepOrphanExtractDirs(root).catch(() => undefined);

  if (specs.length === 0) {
    return { root, entries, cacheBytes: 0, pruned: [] };
  }

  await mkdir(root, { recursive: true });

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const dir = join(root, spec.hash);
    const expectedFrames =
      spec.duration !== undefined
        ? Math.max(1, Math.round(spec.duration * spec.fps))
        : undefined;

    // ── Cache hit: a complete meta marker means the PNGs are already here. ──
    const hitMeta = await readMetaIfComplete(join(dir, META_FILENAME));
    if (hitMeta) {
      await touchAccessed(join(dir, META_FILENAME), hitMeta);
      const entry: FrameCacheEntry = {
        hash: spec.hash,
        dir,
        frameCount: hitMeta.frameCount,
        // Older cache entries may predate width/height in meta.json — fall
        // back to the spec's resolution (identical, since the hash pins it).
        width: hitMeta.width || spec.width,
        height: hitMeta.height || spec.height,
        bytes: hitMeta.bytes,
        itemIds: spec.itemIds,
        cached: true,
      };
      entries.set(spec.hash, entry);
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: hitMeta.frameCount,
        totalFrames: hitMeta.frameCount,
        cached: true,
      });
      continue;
    }

    // ── Cache miss: extract into a private temp dir, then publish atomically. ─
    const tmpDir = join(root, `.tmp-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: 0,
        totalFrames: expectedFrames,
        cached: false,
      });

      await runExtraction(spec, tmpDir, opts, (frame) => {
        report(opts, {
          spec: i + 1,
          totalSpecs: specs.length,
          hash: spec.hash,
          itemIds: spec.itemIds,
          frame,
          totalFrames: expectedFrames,
          cached: false,
        });
      });

      const frames = await listPngFrames(tmpDir);
      if (frames.length === 0) {
        throw new Error(
          `ffmpeg produced no frames for video asset "${spec.assetId}" ` +
            `(${spec.width}x${spec.height} @ ${spec.fps}fps).`,
        );
      }
      const bytes = await sumFrameBytes(tmpDir, frames);
      const now = Date.now();
      const meta: CacheMeta = {
        hash: spec.hash,
        src: spec.srcPath,
        trimIn: spec.trimIn,
        trimOut: spec.trimOut ?? null,
        fps: spec.fps,
        width: spec.width,
        height: spec.height,
        frameCount: frames.length,
        bytes,
        createdAt: now,
        accessedAt: now,
      };
      await writeFile(join(tmpDir, META_FILENAME), JSON.stringify(meta));

      // Publish: drop any stale/partial dir at the target, then rename. rename
      // is atomic on the same filesystem, so a hit can never observe a partial.
      await rm(dir, { recursive: true, force: true });
      await rename(tmpDir, dir);

      const entry: FrameCacheEntry = {
        hash: spec.hash,
        dir,
        frameCount: frames.length,
        width: spec.width,
        height: spec.height,
        bytes,
        itemIds: spec.itemIds,
        cached: false,
      };
      entries.set(spec.hash, entry);
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: frames.length,
        totalFrames: expectedFrames ?? frames.length,
        cached: false,
      });
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  const usage = await pruneCache(root, maxBytes);
  return {
    root,
    entries,
    cacheBytes: usage.bytes,
    pruned: usage.prunedHashes,
  };
}

async function runExtraction(
  spec: VideoExtractSpec,
  tmpDir: string,
  opts: PreExtractOptions,
  onFrame: (frame: number) => void,
): Promise<void> {
  const pattern = join(tmpDir, "%05d.png");
  const args = buildExtractArgs(spec, pattern);
  const ffmpegPath = opts.ffmpegPath ?? (await resolveFfmpeg());
  const spawnFn = opts.spawn ?? defaultExtractSpawn;
  const ffmpeg = spawnFn(ffmpegPath, args);

  // stdout carries `-progress` key=value blocks; pick out the running frame.
  let lastFrame = 0;
  if (ffmpeg.stdout) {
    ffmpeg.stdout.setEncoding("utf8");
    ffmpeg.stdout.on("data", (chunk: string) => {
      for (const m of chunk.matchAll(/frame=\s*(\d+)/g)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= lastFrame) lastFrame = n;
      }
      onFrame(lastFrame);
    });
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

  // Extraction reads from a file input, not stdin — close it so ffmpeg sees
  // EOF immediately (and the test fake, which keys close off stdin end, fires).
  ffmpeg.stdin?.end();

  const [code, signal] = (await once(ffmpeg, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code !== 0) {
    const tail = stderrTail.trim();
    const reason =
      code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    throw new Error(
      `ffmpeg (extract) exited with ${reason}${tail ? `:\n${tail}` : ""}`,
    );
  }
}

// ───────────────────────────── cache meta / LRU ────────────────────────────

interface CacheMeta {
  hash: string;
  src: string;
  trimIn: number;
  trimOut: number | null;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  bytes: number;
  createdAt: number;
  accessedAt: number;
}

export interface CacheUsage {
  /** Total bytes resident across all complete entries (after pruning). */
  bytes: number;
  /** Number of complete entries remaining. */
  entries: number;
  /** Hashes evicted by this prune call. */
  prunedHashes: string[];
}

/**
 * Evict least-recently-accessed cache entries until the cache fits `maxBytes`.
 * Incomplete dirs (missing/invalid meta) and in-flight `.tmp-*` dirs are
 * ignored. Returns the post-prune usage. Safe to call when the root is absent.
 */
export async function pruneCache(
  root: string,
  maxBytes: number,
): Promise<CacheUsage> {
  const entries = await readAllEntries(root);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= maxBytes) {
    return { bytes: total, entries: entries.length, prunedHashes: [] };
  }

  // Oldest access first — classic LRU eviction order.
  entries.sort((a, b) => a.accessedAt - b.accessedAt);
  const prunedHashes: string[] = [];
  let remaining = entries.length;
  for (const entry of entries) {
    if (total <= maxBytes) break;
    await rm(entry.dir, { recursive: true, force: true });
    total -= entry.bytes;
    remaining -= 1;
    prunedHashes.push(entry.hash);
  }
  return { bytes: total, entries: remaining, prunedHashes };
}

interface CacheEntryOnDisk {
  hash: string;
  dir: string;
  bytes: number;
  accessedAt: number;
}

async function readAllEntries(root: string): Promise<CacheEntryOnDisk[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return []; // root not created yet
  }
  const out: CacheEntryOnDisk[] = [];
  for (const name of names) {
    if (name.startsWith(".tmp-")) continue;
    const dir = join(root, name);
    const meta = await readMetaIfComplete(join(dir, META_FILENAME));
    if (!meta) continue;
    out.push({
      hash: meta.hash,
      dir,
      bytes: meta.bytes,
      accessedAt: meta.accessedAt,
    });
  }
  return out;
}

async function readMetaIfComplete(
  metaPath: string,
): Promise<CacheMeta | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return undefined; // no marker ⇒ no (complete) entry
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CacheMeta>;
    if (
      typeof parsed.frameCount === "number" &&
      parsed.frameCount > 0 &&
      typeof parsed.bytes === "number" &&
      parsed.bytes >= 0
    ) {
      return {
        accessedAt: Date.now(),
        createdAt: Date.now(),
        hash: "",
        src: "",
        trimIn: 0,
        trimOut: null,
        fps: 0,
        width: 0,
        height: 0,
        ...parsed,
      } as CacheMeta;
    }
  } catch {
    // Corrupt marker — treat as a miss so the next run re-extracts cleanly.
  }
  return undefined;
}

async function touchAccessed(metaPath: string, meta: CacheMeta): Promise<void> {
  try {
    await writeFile(
      metaPath,
      JSON.stringify({ ...meta, accessedAt: Date.now() }),
    );
  } catch {
    // Best effort — a failed touch only skews LRU ordering, never correctness.
  }
}

async function listPngFrames(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter((n) => n.toLowerCase().endsWith(".png")).sort();
}

async function sumFrameBytes(dir: string, frames: string[]): Promise<number> {
  let total = 0;
  for (const name of frames) {
    try {
      total += (await stat(join(dir, name))).size;
    } catch {
      // A frame that vanished between listing and stat is non-fatal accounting.
    }
  }
  return total;
}

// ───────────────────────────── binary / paths ──────────────────────────────

/**
 * Frame-cache root: `$DAVIDUP_CACHE/frames` when set, else
 * `~/.davidup/cache/frames` — sibling of the global library root.
 */
export function defaultFrameCacheRoot(): string {
  const override = process.env.DAVIDUP_CACHE;
  if (override && override.length > 0) return join(override, "frames");
  return join(nodeOs.homedir(), ".davidup", "cache", "frames");
}

// ───────────────────────────── small helpers ───────────────────────────────

function defaultStatFile(path: string): FileStat {
  const s = statSync(path);
  return { mtimeMs: s.mtimeMs, size: s.size };
}

function defaultExtractSpawn(
  cmd: string,
  args: ReadonlyArray<string>,
): ChildProcess {
  // stdin ignored (file input), stdout piped for `-progress`, stderr for errors.
  return nodeSpawn(cmd, args as string[], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function report(opts: PreExtractOptions, info: FrameExtractProgress): void {
  if (!opts.onProgress) return;
  try {
    opts.onProgress(info);
  } catch {
    // A throwing progress callback must not kill the extraction.
  }
}

/**
 * Format a seconds value for an ffmpeg argument: fixed-point (never
 * exponential, which ffmpeg rejects), trailing zeros trimmed.
 */
function fmtSeconds(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1e6) / 1e6;
  let s = rounded.toFixed(6).replace(/\.?0+$/, "");
  if (s === "" || s === "-0") s = "0";
  return s;
}

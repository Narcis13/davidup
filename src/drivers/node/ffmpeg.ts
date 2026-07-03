// Shared ffmpeg concerns for the node driver (v1 review R-6, R-12).
//
// Before this module, `videoExtract.ts` resolved the ffmpeg binary via
// ffmpeg-static-with-PATH-fallback, while `index.ts` (encode) and
// `audioMux.ts` (mux) both spawned a bare `"ffmpeg"` from PATH. On a machine
// with a broken system ffmpeg (proven live: a dyld-broken homebrew install)
// extraction would succeed and encode would then fail — the three pipelines
// disagreed about which binary "ffmpeg" means. `resolveFfmpeg()` is now the
// single resolution path all three call.
//
// This module also owns orphan-cleanup for the two kinds of ffmpeg temp
// artifacts the node driver leaves on disk mid-pipeline: `.tmp-*` extraction
// staging dirs (`videoExtract.ts`, published atomically via rename) and
// `.davidup-tmpvideo-*` silent-video files (`index.ts`'s two-stage audio
// mux). A killed process (crash, OOM, `kill -9`) skips the cleanup those
// pipelines do on their own error paths and leaves the artifact behind
// forever — the LRU prune in `videoExtract.ts` deliberately ignores `.tmp-*`
// dirs (they might be a concurrent render's in-flight work), so nothing else
// ever removes them. The sweep functions here do, but only once an entry is
// older than `maxAgeMs`, so a live render is never touched.

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Prefix of an in-flight video-extraction staging dir (see `videoExtract.ts`). */
export const EXTRACT_TMP_PREFIX = ".tmp-";
/** Prefix of the node driver's stage-1 silent-video temp file (see `index.ts`). */
export const TEMP_VIDEO_PREFIX = ".davidup-tmpvideo-";

/** Orphans younger than this are left alone — a live render may still own them. */
export const DEFAULT_ORPHAN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

let cachedFfmpegPath: string | undefined;

/**
 * Resolve the ffmpeg binary path shared by extraction, encode, and mux.
 * Prefers the bundled `ffmpeg-static` binary (present as a dependency,
 * independent of a possibly-broken system ffmpeg); falls back to `"ffmpeg"`
 * on PATH when the package is absent. Memoised after the first resolution.
 * Mirrors `resolveFfprobePath` (`ffprobe.ts`).
 */
export async function resolveFfmpeg(): Promise<string> {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  try {
    // Indirect specifier so bundlers don't eagerly resolve this node-only dep.
    const specifier = "ffmpeg-static";
    const mod = (await import(/* @vite-ignore */ specifier)) as
      | { default?: string | null }
      | string
      | null;
    const fromDefault =
      typeof mod === "string" ? mod : (mod?.default ?? null);
    if (typeof fromDefault === "string" && fromDefault.length > 0) {
      cachedFfmpegPath = fromDefault;
    }
  } catch {
    // ffmpeg-static not installed — fall through to PATH.
  }
  if (cachedFfmpegPath === undefined) cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

export interface SweepOptions {
  /** Entries younger than this are left alone. Default: {@link DEFAULT_ORPHAN_MAX_AGE_MS}. */
  maxAgeMs?: number;
  /** Injectable clock (tests). Default: `Date.now`. */
  now?: () => number;
}

export interface SweepResult {
  /** Absolute paths removed by this sweep. */
  removed: string[];
}

/**
 * Remove orphaned `.tmp-*` extraction staging dirs under `root` (the frame
 * cache root) that are older than `maxAgeMs` — residue of a crashed or
 * signal-killed extraction. A fresh in-flight dir from a concurrent render is
 * younger than the threshold and is left alone. Safe to call before `root`
 * exists. Best-effort: a per-entry stat/rm failure is skipped, never thrown.
 */
export async function sweepOrphanExtractDirs(
  root: string,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  return sweepByPrefix(root, EXTRACT_TMP_PREFIX, opts);
}

/**
 * Remove orphaned `.davidup-tmpvideo-*` files in `dir` (the node driver's
 * stage-1 silent-video temp file, written when a composition has audio)
 * older than `maxAgeMs`. Scoped to a single directory — typically
 * `dirname(outPath)` — since these files have no fixed cache root the way
 * extraction entries do. Safe to call when `dir` doesn't exist.
 */
export async function sweepOrphanTempVideos(
  dir: string,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  return sweepByPrefix(dir, TEMP_VIDEO_PREFIX, opts, { filesOnly: true });
}

async function sweepByPrefix(
  dir: string,
  prefix: string,
  opts: SweepOptions,
  entryOpts: { filesOnly?: boolean } = {},
): Promise<SweepResult> {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_ORPHAN_MAX_AGE_MS;
  const now = opts.now ?? Date.now;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { removed: [] }; // dir doesn't exist yet — nothing to sweep
  }

  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const full = join(dir, name);
    try {
      const info = await stat(full);
      if (entryOpts.filesOnly && !info.isFile()) continue;
      if (now() - info.mtimeMs < maxAgeMs) continue; // fresh — may be in-flight
      await rm(full, { recursive: true, force: true });
      removed.push(full);
    } catch {
      // Vanished between listing and stat/rm, or a permission error — a
      // sweep is best-effort cleanup, not a correctness requirement.
    }
  }
  return { removed };
}

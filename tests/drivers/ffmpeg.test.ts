// Unit tests for the shared ffmpeg resolver + orphan-sweep module (v1 review
// R-6, R-12). `resolveFfmpeg` is exercised via `vi.resetModules` + `vi.doMock`
// so each test gets a fresh memoization cache and can force the
// ffmpeg-static-present / ffmpeg-static-absent branches independently.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("resolveFfmpeg", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prefers the bundled ffmpeg-static binary when present", async () => {
    const { resolveFfmpeg } = await import("../../src/drivers/node/ffmpeg.js");
    const path = await resolveFfmpeg();
    const ffmpegStatic = (await import("ffmpeg-static")).default as unknown as string;
    expect(path).toBe(ffmpegStatic);
  });

  it("falls back to PATH ffmpeg when ffmpeg-static is unavailable", async () => {
    vi.doMock("ffmpeg-static", () => {
      throw new Error("module not found (simulated)");
    });
    const { resolveFfmpeg } = await import("../../src/drivers/node/ffmpeg.js");
    const path = await resolveFfmpeg();
    expect(path).toBe("ffmpeg");
  });

  it("memoizes the resolved path — a second call doesn't re-resolve", async () => {
    const { resolveFfmpeg } = await import("../../src/drivers/node/ffmpeg.js");
    const first = await resolveFfmpeg();
    // Even if ffmpeg-static were to become unavailable after the fact, the
    // memoized value must not change on a later call.
    vi.doMock("ffmpeg-static", () => {
      throw new Error("should never be reached — path is memoized");
    });
    const second = await resolveFfmpeg();
    expect(second).toBe(first);
  });
});

describe("sweepOrphanExtractDirs", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "davidup-ffmpeg-sweep-extract-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes .tmp-* dirs older than maxAgeMs, spares fresh ones", async () => {
    const { sweepOrphanExtractDirs } = await import("../../src/drivers/node/ffmpeg.js");

    const stale = join(root, ".tmp-stale");
    const fresh = join(root, ".tmp-fresh");
    const published = join(root, "abc123"); // a real (non-.tmp-) cache entry
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    mkdirSync(published, { recursive: true });

    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    utimesSync(stale, oldTime, oldTime);

    const result = await sweepOrphanExtractDirs(root, { maxAgeMs: 60 * 60 * 1000 });

    expect(result.removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true); // in-flight — untouched
    expect(existsSync(published)).toBe(true); // not a .tmp- dir — untouched
  });

  it("is a no-op when the root doesn't exist yet", async () => {
    const { sweepOrphanExtractDirs } = await import("../../src/drivers/node/ffmpeg.js");
    const missing = join(root, "does-not-exist");
    await expect(sweepOrphanExtractDirs(missing)).resolves.toEqual({ removed: [] });
  });

  it("honours an injected clock instead of the wall clock", async () => {
    const { sweepOrphanExtractDirs } = await import("../../src/drivers/node/ffmpeg.js");
    const dir = join(root, ".tmp-x");
    mkdirSync(dir, { recursive: true });
    const mtime = new Date(1_000_000);
    utimesSync(dir, mtime, mtime);

    // "Now" just 1 minute after mtime — well under the 1h default — spared.
    const justAfter = await sweepOrphanExtractDirs(root, {
      now: () => mtime.getTime() + 60_000,
    });
    expect(justAfter.removed).toEqual([]);
    expect(existsSync(dir)).toBe(true);

    // "Now" 2 hours after mtime — past the threshold — removed.
    const wayAfter = await sweepOrphanExtractDirs(root, {
      now: () => mtime.getTime() + 2 * 60 * 60 * 1000,
    });
    expect(wayAfter.removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("sweepOrphanTempVideos", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "davidup-ffmpeg-sweep-video-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes stale .davidup-tmpvideo-* files, spares fresh ones and other files", async () => {
    const { sweepOrphanTempVideos } = await import("../../src/drivers/node/ffmpeg.js");

    const stale = join(dir, ".davidup-tmpvideo-aaaa.mp4");
    const fresh = join(dir, ".davidup-tmpvideo-bbbb.mp4");
    const unrelated = join(dir, "out.mp4");
    writeFileSync(stale, "x");
    writeFileSync(fresh, "x");
    writeFileSync(unrelated, "x");

    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, oldTime, oldTime);

    const result = await sweepOrphanTempVideos(dir, { maxAgeMs: 60 * 60 * 1000 });

    expect(result.removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("is a no-op when the directory doesn't exist yet", async () => {
    const { sweepOrphanTempVideos } = await import("../../src/drivers/node/ffmpeg.js");
    const missing = join(dir, "does-not-exist");
    await expect(sweepOrphanTempVideos(missing)).resolves.toEqual({ removed: [] });
  });
});

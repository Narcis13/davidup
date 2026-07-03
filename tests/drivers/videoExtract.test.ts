// Unit tests for the video pre-extract pipeline (v0.2 §S7).
//
// The pure parts (spec collection, hashing, arg building) run without IO.
// The orchestration is exercised with a fake ffmpeg spawn that writes dummy
// PNG files into the output directory and emits `-progress` frame lines, so
// the cache hit/miss, atomic-publish, progress, and LRU paths are covered
// without the native binary. A separate real-ffmpeg test lives in
// videoExtract.integration.test.ts.

import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildExtractArgs,
  collectVideoExtractSpecs,
  compositionHasVideo,
  computeSpecHash,
  preExtractVideoFrames,
  pruneCache,
  type FileStat,
  type FrameExtractProgress,
  type VideoExtractSpec,
} from "../../src/drivers/node/videoExtract.js";
import type { FfmpegSpawn } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

// ── A composition with one or more video items, sharing a registered asset. ──

function transform() {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    opacity: 1,
  };
}

function videoComp(
  items: Record<
    string,
    {
      asset?: string;
      width?: number;
      height?: number;
      trimIn?: number;
      trimOut?: number;
    }
  >,
  opts: { fps?: number; assetDuration?: number; assetType?: "video" | "image" } = {},
): Composition {
  const assets =
    opts.assetType === "image"
      ? [{ id: "vid", type: "image" as const, src: "/abs/clip.mp4" }]
      : [
          {
            id: "vid",
            type: "video" as const,
            src: "/abs/clip.mp4",
            duration: opts.assetDuration ?? 4,
            width: 640,
            height: 360,
          },
        ];
  return {
    version: "0.1",
    composition: {
      width: 1280,
      height: 720,
      fps: opts.fps ?? 30,
      duration: 5,
      background: "#000000",
    },
    assets,
    layers: [
      { id: "l", z: 0, opacity: 1, blendMode: "normal", items: Object.keys(items) },
    ],
    items: Object.fromEntries(
      Object.entries(items).map(([id, cfg]) => [
        id,
        {
          type: "video" as const,
          asset: cfg.asset ?? "vid",
          width: cfg.width ?? 320,
          height: cfg.height ?? 240,
          start: 0,
          ...(cfg.trimIn !== undefined ? { trimIn: cfg.trimIn } : {}),
          ...(cfg.trimOut !== undefined ? { trimOut: cfg.trimOut } : {}),
          fit: "contain" as const,
          loop: false,
          transform: transform(),
        },
      ]),
    ),
    tweens: [],
  };
}

const fixedStat: (path: string) => FileStat = () => ({ mtimeMs: 1000, size: 500 });

// ── Fake ffmpeg: writes `frames` dummy PNGs into the output dir, then exits. ──

interface FakeHarness {
  spawn: FfmpegSpawn;
  calls: { cmd: string; args: ReadonlyArray<string>; outDir: string }[];
}

function makeExtractFake(
  opts: { frames?: number; exitCode?: number; signal?: NodeJS.Signals } = {},
): FakeHarness {
  const calls: FakeHarness["calls"] = [];
  const spawn: FfmpegSpawn = (cmd, args) => {
    const pattern = args[args.length - 1]!;
    const outDir = dirname(pattern);
    calls.push({ cmd, args, outDir });

    const proc = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & { end: () => void };
      stdout: EventEmitter & { setEncoding: () => void };
      stderr: EventEmitter & { setEncoding: () => void };
    };
    const stdin = new EventEmitter() as EventEmitter & { end: () => void };
    stdin.end = () => stdin.emit("finish");
    const stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    const stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    proc.stdin = stdin;
    proc.stdout = stdout;
    proc.stderr = stderr;

    stdin.on("finish", () => {
      setImmediate(async () => {
        if (opts.signal) {
          stderr.emit("data", "boom\n");
          proc.emit("close", null, opts.signal);
          return;
        }
        const code = opts.exitCode ?? 0;
        if (code === 0) {
          const n = opts.frames ?? 3;
          for (let i = 1; i <= n; i++) {
            await writeFile(
              join(outDir, `${String(i).padStart(5, "0")}.png`),
              Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            );
            stdout.emit("data", `frame=${i}\n`);
          }
        } else {
          stderr.emit("data", "boom\n");
        }
        proc.emit("close", code, null);
      });
    });

    return proc as unknown as ReturnType<FfmpegSpawn>;
  };
  return { spawn, calls };
}

// ─────────────────────────────────────────────────────────────────────────

describe("compositionHasVideo", () => {
  it("is true when a video item is present, false otherwise", () => {
    expect(compositionHasVideo(videoComp({ a: {} }))).toBe(true);
    const noVideo = videoComp({ a: {} });
    noVideo.items = {};
    expect(compositionHasVideo(noVideo)).toBe(false);
  });
});

describe("collectVideoExtractSpecs", () => {
  it("dedupes items that share asset + trim + resolution into one spec", () => {
    const comp = videoComp({
      a: { width: 320, height: 240, trimIn: 0, trimOut: 2 },
      b: { width: 320, height: 240, trimIn: 0, trimOut: 2 },
    });
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.itemIds).toEqual(["a", "b"]);
    expect(specs[0]!.width).toBe(320);
    expect(specs[0]!.trimOut).toBe(2);
    expect(specs[0]!.duration).toBe(2);
  });

  it("splits items with different trim windows into distinct specs", () => {
    const comp = videoComp({
      a: { trimIn: 0, trimOut: 2 },
      b: { trimIn: 1, trimOut: 3 },
    });
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs).toHaveLength(2);
    expect(new Set(specs.map((s) => s.hash)).size).toBe(2);
  });

  it("splits items at different resolutions into distinct specs", () => {
    const comp = videoComp({
      a: { width: 320, height: 240 },
      b: { width: 640, height: 480 },
    });
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs).toHaveLength(2);
  });

  it("defaults trimOut to the asset's duration when omitted", () => {
    const comp = videoComp({ a: {} }, { assetDuration: 4 });
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs[0]!.trimOut).toBe(4);
    expect(specs[0]!.duration).toBe(4);
  });

  it("ignores non-video items", () => {
    const comp = videoComp({ a: {} });
    comp.items["txt"] = {
      type: "text",
      text: "hi",
      font: "f",
      fontSize: 12,
      color: "#fff",
      transform: transform(),
    } as never;
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs).toHaveLength(1);
  });

  it("throws on a missing asset reference", () => {
    const comp = videoComp({ a: { asset: "ghost" } });
    expect(() =>
      collectVideoExtractSpecs(comp, { statFile: fixedStat }),
    ).toThrow(/unknown asset "ghost"/);
  });

  it("throws when a video item points at a non-video asset", () => {
    const comp = videoComp({ a: {} }, { assetType: "image" });
    expect(() =>
      collectVideoExtractSpecs(comp, { statFile: fixedStat }),
    ).toThrow(/not "video"/);
  });

  it("falls back to asset dimensions for a degenerate box", () => {
    const comp = videoComp({ a: { width: 0, height: 0 } });
    const specs = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(specs[0]!.width).toBe(640);
    expect(specs[0]!.height).toBe(360);
  });
});

describe("computeSpecHash", () => {
  const base = {
    src: "/a.mp4",
    mtimeMs: 1,
    size: 2,
    trimIn: 0,
    trimOut: 2 as number | null,
    fps: 30,
    width: 320,
    height: 240,
  };

  it("is stable for identical inputs", () => {
    expect(computeSpecHash(base)).toBe(computeSpecHash({ ...base }));
  });

  it("changes when the asset mtime changes", () => {
    expect(computeSpecHash(base)).not.toBe(
      computeSpecHash({ ...base, mtimeMs: 999 }),
    );
  });

  it("changes when any pixel-affecting param changes", () => {
    const seen = new Set<string>();
    for (const patch of [
      {},
      { fps: 24 },
      { width: 321 },
      { height: 241 },
      { trimIn: 0.5 },
      { trimOut: 3 },
      { size: 3 },
      { src: "/b.mp4" },
    ]) {
      seen.add(computeSpecHash({ ...base, ...patch }));
    }
    expect(seen.size).toBe(8);
  });
});

describe("buildExtractArgs", () => {
  const spec: VideoExtractSpec = {
    hash: "h",
    itemIds: ["a"],
    assetId: "vid",
    srcPath: "/abs/clip.mp4",
    trimIn: 1.5,
    trimOut: 3.5,
    duration: 2,
    fps: 30,
    width: 320,
    height: 240,
  };

  it("seeks, trims, and scales with the fps filter", () => {
    const args = buildExtractArgs(spec, "/cache/out/%05d.png");
    const joined = args.join(" ");
    expect(joined).toContain("-ss 1.5");
    expect(joined).toContain("-i /abs/clip.mp4");
    expect(joined).toContain("-t 2");
    expect(joined).toContain("-vf fps=30,scale=320:240");
    expect(args[args.length - 1]).toBe("/cache/out/%05d.png");
  });

  it("omits -t when the duration is unknown (extract to EOF)", () => {
    const args = buildExtractArgs({ ...spec, trimOut: undefined, duration: undefined }, "/c/%05d.png");
    expect(args).not.toContain("-t");
  });
});

describe("preExtractVideoFrames (fake ffmpeg)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "davidup-s7-unit-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts on a miss, then serves a hit without spawning ffmpeg again", async () => {
    const comp = videoComp({ a: { trimIn: 0, trimOut: 1 } });

    const first = makeExtractFake({ frames: 3 });
    const r1 = await preExtractVideoFrames(comp, {
      cacheRoot: root,
      statFile: fixedStat,
      spawn: first.spawn,
    });
    expect(first.calls).toHaveLength(1);
    const [hash] = [...r1.entries.keys()];
    const entry1 = r1.entries.get(hash!)!;
    expect(entry1.cached).toBe(false);
    expect(entry1.frameCount).toBe(3);
    // Frames + marker landed in the published cache dir.
    expect(existsSync(join(entry1.dir, "meta.json"))).toBe(true);
    expect(readdirSync(entry1.dir).filter((n) => n.endsWith(".png"))).toHaveLength(3);
    // No leftover temp dirs.
    expect(readdirSync(root).some((n) => n.startsWith(".tmp-"))).toBe(false);

    const second = makeExtractFake({ frames: 3 });
    const r2 = await preExtractVideoFrames(comp, {
      cacheRoot: root,
      statFile: fixedStat,
      spawn: second.spawn,
    });
    expect(second.calls).toHaveLength(0); // pure cache hit — ffmpeg never ran
    expect(r2.entries.get(hash!)!.cached).toBe(true);
    expect(r2.entries.get(hash!)!.frameCount).toBe(3);
  });

  it("emits progress events for the extraction", async () => {
    const comp = videoComp({ a: { trimIn: 0, trimOut: 1 } });
    const events: FrameExtractProgress[] = [];
    const fake = makeExtractFake({ frames: 4 });
    await preExtractVideoFrames(comp, {
      cacheRoot: root,
      statFile: fixedStat,
      spawn: fake.spawn,
      onProgress: (e) => events.push(e),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.totalSpecs === 1)).toBe(true);
    expect(events.some((e) => !e.cached && e.frame === 4)).toBe(true);
  });

  it("propagates an ffmpeg failure and leaves no temp dir behind", async () => {
    const comp = videoComp({ a: { trimIn: 0, trimOut: 1 } });
    const fake = makeExtractFake({ exitCode: 1 });
    await expect(
      preExtractVideoFrames(comp, {
        cacheRoot: root,
        statFile: fixedStat,
        spawn: fake.spawn,
      }),
    ).rejects.toThrow(/exited with code 1/);
    expect(readdirSync(root).some((n) => n.startsWith(".tmp-"))).toBe(false);
  });

  it("fails loudly (never a silent partial) when ffmpeg is killed by a signal (R-7)", async () => {
    const comp = videoComp({ a: { trimIn: 0, trimOut: 1 } });
    const fake = makeExtractFake({ signal: "SIGKILL" });
    await expect(
      preExtractVideoFrames(comp, {
        cacheRoot: root,
        statFile: fixedStat,
        spawn: fake.spawn,
      }),
    ).rejects.toThrow(/ffmpeg \(extract\) exited with signal SIGKILL/);
    // The failed extraction's staging dir must not survive as a silent orphan.
    expect(readdirSync(root).some((n) => n.startsWith(".tmp-"))).toBe(false);
  });

  it("returns an empty result for a composition with no video", async () => {
    const comp = videoComp({ a: {} });
    comp.items = {};
    const fake = makeExtractFake();
    const r = await preExtractVideoFrames(comp, {
      cacheRoot: root,
      statFile: fixedStat,
      spawn: fake.spawn,
    });
    expect(r.entries.size).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("pruneCache (LRU)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "davidup-s7-prune-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeEntry(hash: string, bytes: number, accessedAt: number): void {
    const dir = join(root, hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "00001.png"), Buffer.alloc(bytes));
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ hash, frameCount: 1, bytes, accessedAt, createdAt: accessedAt }),
    );
  }

  it("evicts least-recently-accessed entries until under budget", async () => {
    writeEntry("old", 100, 1_000); // oldest
    writeEntry("mid", 100, 2_000);
    writeEntry("new", 100, 3_000); // newest
    // Budget fits one entry → the two oldest get evicted.
    const usage = await pruneCache(root, 100);
    expect(usage.prunedHashes.sort()).toEqual(["mid", "old"]);
    expect(existsSync(join(root, "new"))).toBe(true);
    expect(existsSync(join(root, "old"))).toBe(false);
    expect(usage.bytes).toBe(100);
  });

  it("is a no-op when under budget", async () => {
    writeEntry("a", 50, 1);
    const usage = await pruneCache(root, 1_000);
    expect(usage.prunedHashes).toEqual([]);
    expect(usage.entries).toBe(1);
  });

  it("ignores incomplete dirs and in-flight temp dirs", async () => {
    mkdirSync(join(root, ".tmp-inflight"), { recursive: true });
    mkdirSync(join(root, "partial"), { recursive: true }); // no meta.json
    writeEntry("good", 10, 1);
    const usage = await pruneCache(root, 1_000);
    expect(usage.entries).toBe(1);
  });
});

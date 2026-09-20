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
  alphaDecoderFor,
  buildExtractArgs,
  collectVideoExtractSpecs,
  compositionHasVideo,
  computeSpecHash,
  preExtractVideoFrames,
  pruneCache,
  resolveExtractDimensions,
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
  opts: {
    fps?: number;
    assetDuration?: number;
    assetType?: "video" | "image";
    /** Merged into the video asset — `src`, `codec`, `hasAlpha` (B-7). */
    asset?: { src?: string; codec?: string; hasAlpha?: boolean };
  } = {},
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
            ...(opts.asset ?? {}),
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

describe("resolveExtractDimensions (B-1)", () => {
  function item(width: number, height: number, scaleX = 1, scaleY = 1) {
    return {
      type: "video" as const,
      asset: "vid",
      width,
      height,
      start: 0,
      fit: "contain" as const,
      loop: false,
      transform: { ...transform(), scaleX, scaleY },
    };
  }
  function asset(width?: number, height?: number) {
    return {
      id: "vid",
      type: "video" as const,
      src: "/abs/clip.mp4",
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };
  }

  it("extracts native size when the source is under the box cap (no upscale)", () => {
    expect(resolveExtractDimensions(item(640, 320), asset(320, 240), "v")).toEqual({
      width: 320,
      height: 240,
      scale: "",
    });
  });

  it("preserves source aspect when capping a landscape source (W:-2)", () => {
    const d = resolveExtractDimensions(item(320, 240), asset(3840, 2160), "v");
    expect(d).toEqual({ width: 320, height: 180, scale: "scale=320:-2" });
    expect(d.width / d.height).toBeCloseTo(3840 / 2160, 1);
  });

  it("caps a portrait source on its height (-2:H)", () => {
    expect(resolveExtractDimensions(item(400, 300), asset(1080, 1920), "v")).toEqual({
      width: 226,
      height: 400,
      scale: "scale=-2:400",
    });
  });

  it("caps against the box's longest side regardless of box aspect", () => {
    // A 4:3 source in a tall 100×500 box caps at 500 on the source's long side.
    expect(resolveExtractDimensions(item(100, 500), asset(1600, 1200), "v")).toEqual({
      width: 500,
      height: 376,
      scale: "scale=500:-2",
    });
  });

  it("scales the cap by max(|scaleX|, |scaleY|), rounded up", () => {
    const d = resolveExtractDimensions(item(320, 180, 1.5, -2.001), asset(3840, 2160), "v");
    expect(d.width).toBe(641);
    expect(d.scale).toBe("scale=641:-2");
  });

  it("uses an ffmpeg expression cap when the asset was never probed", () => {
    const d = resolveExtractDimensions(item(320, 240), asset(), "v");
    expect(d.scale).toBe(
      "scale=w='if(gte(iw,ih),min(iw,320),-2)':h='if(gte(iw,ih),-2,min(ih,320))'",
    );
    expect(d.scale).not.toMatch(/scale=\d+:\d+/);
  });

  it("extracts native for a degenerate box, and throws when dims are unknown too", () => {
    expect(resolveExtractDimensions(item(0, 0), asset(640, 360), "v").scale).toBe("");
    expect(() => resolveExtractDimensions(item(0, 0), asset(), "v")).toThrow(
      /degenerate box/,
    );
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
    scale: "scale=320:-2",
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
      { scale: "" },
    ]) {
      seen.add(computeSpecHash({ ...base, ...patch }));
    }
    expect(seen.size).toBe(9);
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
    height: 180,
    scale: "scale=320:-2",
    alpha: false,
    decoder: undefined,
  };

  it("seeks, trims, and scales (aspect-preserving) with the fps filter", () => {
    const args = buildExtractArgs(spec, "/cache/out/%05d.png");
    const joined = args.join(" ");
    expect(joined).toContain("-ss 1.5");
    expect(joined).toContain("-i /abs/clip.mp4");
    expect(joined).toContain("-t 2");
    expect(joined).toContain("-vf fps=30,scale=320:-2");
    expect(args[args.length - 1]).toBe("/cache/out/%05d.png");
  });

  it("writes RGBA PNGs for an alpha source so transparency survives (B-7)", () => {
    const args = buildExtractArgs({ ...spec, alpha: true }, "/cache/out/%05d.png");
    expect(args.slice(-3)).toEqual(["-pix_fmt", "rgba", "/cache/out/%05d.png"]);
  });

  it("leaves the PNG pixel format to ffmpeg for an opaque source", () => {
    const args = buildExtractArgs(spec, "/cache/out/%05d.png");
    expect(args).not.toContain("-pix_fmt");
    expect(args[args.length - 1]).toBe("/cache/out/%05d.png");
  });

  it("forces the alpha-capable decoder before -i when the spec names one (B-7)", () => {
    const args = buildExtractArgs(
      { ...spec, alpha: true, decoder: "libvpx-vp9" },
      "/c/%05d.png",
    );
    expect(args.indexOf("-c:v")).toBeGreaterThan(-1);
    expect(args[args.indexOf("-c:v") + 1]).toBe("libvpx-vp9");
    // Input option: it has to precede the input it applies to.
    expect(args.indexOf("-c:v")).toBeLessThan(args.indexOf("-i"));
  });

  it("leaves the decoder to ffmpeg when the spec names none", () => {
    expect(buildExtractArgs(spec, "/c/%05d.png")).not.toContain("-c:v");
  });

  it("emits only the fps filter when extracting at native size", () => {
    const args = buildExtractArgs({ ...spec, scale: "" }, "/c/%05d.png");
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=30");
  });

  it("emits an exact fps=N/D filter for a rational composition rate (v1.1 S7)", () => {
    const args = buildExtractArgs({ ...spec, fps: "30000/1001", scale: "" }, "/c/%05d.png");
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=30000/1001");
  });

  it("omits -t when the duration is unknown (extract to EOF)", () => {
    const args = buildExtractArgs({ ...spec, trimOut: undefined, duration: undefined }, "/c/%05d.png");
    expect(args).not.toContain("-t");
  });
});

// ── B-7: VP8/VP9 alpha lives in a side channel only libvpx decodes. ──

describe("alphaDecoderFor", () => {
  it("picks libvpx for VP8/VP9 sources that carry alpha", () => {
    expect(alphaDecoderFor("vp9", true)).toBe("libvpx-vp9");
    expect(alphaDecoderFor("vp8", true)).toBe("libvpx");
    expect(alphaDecoderFor("VP9", true)).toBe("libvpx-vp9");
  });

  it("leaves opaque VP9 on ffmpeg's faster native decoder", () => {
    expect(alphaDecoderFor("vp9", false)).toBeUndefined();
    expect(alphaDecoderFor("vp9", undefined)).toBeUndefined();
  });

  it("does not override for codecs whose alpha is in the pixel format", () => {
    // ProRes 4444 / QT RLE / AV1 all report yuva*/rgba and decode correctly.
    expect(alphaDecoderFor("prores", true)).toBeUndefined();
    expect(alphaDecoderFor("av1", true)).toBeUndefined();
    expect(alphaDecoderFor(undefined, true)).toBeUndefined();
  });
});

describe("collectVideoExtractSpecs — decoder (B-7)", () => {
  it("forces libvpx-vp9 for an alpha VP9 asset", () => {
    const comp = videoComp(
      { a: {} },
      { asset: { src: "/abs/overlay.webm", codec: "vp9", hasAlpha: true } },
    );
    const [spec] = collectVideoExtractSpecs(comp, { statFile: fixedStat });
    expect(spec!.decoder).toBe("libvpx-vp9");
    expect(spec!.alpha).toBe(true);
  });

  it("gives the alpha and non-alpha variants different cache hashes", () => {
    const withAlpha = collectVideoExtractSpecs(
      videoComp({ a: {} }, { asset: { src: "/abs/o.webm", codec: "vp9", hasAlpha: true } }),
      { statFile: fixedStat },
    )[0]!;
    const without = collectVideoExtractSpecs(
      videoComp({ a: {} }, { asset: { src: "/abs/o.webm", codec: "vp9", hasAlpha: false } }),
      { statFile: fixedStat },
    )[0]!;
    expect(without.decoder).toBeUndefined();
    expect(without.alpha).toBe(false);
    expect(withAlpha.hash).not.toBe(without.hash);
  });

  it("probes a .webm asset registered without codec/hasAlpha", () => {
    const seen: string[] = [];
    const comp = videoComp({ a: {} }, { asset: { src: "/abs/unprobed.webm" } });
    const [spec] = collectVideoExtractSpecs(comp, {
      statFile: fixedStat,
      probeVideoFile: (path) => {
        seen.push(path);
        return { codec: "vp9", hasAlpha: true };
      },
    });
    expect(seen).toEqual(["/abs/unprobed.webm"]);
    expect(spec!.decoder).toBe("libvpx-vp9");
    expect(spec!.alpha).toBe(true);
  });

  it("does not probe containers that cannot hide alpha, nor probed assets", () => {
    const seen: string[] = [];
    const probeVideoFile = (path: string) => {
      seen.push(path);
      return { codec: "vp9", hasAlpha: true };
    };
    // .mp4 states its alpha in the pixel format — nothing to ask ffprobe.
    collectVideoExtractSpecs(videoComp({ a: {} }, { asset: { src: "/abs/plain.mp4" } }), {
      statFile: fixedStat,
      probeVideoFile,
    });
    // Already-probed .webm: register_asset filled both fields.
    collectVideoExtractSpecs(
      videoComp(
        { a: {} },
        { asset: { src: "/abs/known.webm", codec: "vp9", hasAlpha: false } },
      ),
      { statFile: fixedStat, probeVideoFile },
    );
    expect(seen).toEqual([]);
  });

  it("survives a probe that fails, falling back to no override", () => {
    const comp = videoComp({ a: {} }, { asset: { src: "/abs/broken.webm" } });
    const [spec] = collectVideoExtractSpecs(comp, {
      statFile: fixedStat,
      probeVideoFile: () => {
        throw new Error("ffprobe missing");
      },
    });
    expect(spec!.decoder).toBeUndefined();
    expect(spec!.alpha).toBe(false);
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

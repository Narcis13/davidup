// register_asset video path through the dispatcher (v0.2 §S6).
//
// Two layers:
//   1. Injected-probe unit tests — deterministic, no subprocess. Cover the
//      happy path, each warning-policy trigger (>=4K, >60s, exotic codec),
//      the ffprobe-unavailable + generic-failure warnings, accepted
//      containers, and unsupported-extension rejection.
//   2. Real-files E2E — register the four committed fixtures (small, 4K, long,
//      webm-with-alpha) with the real ffprobe-static binary and confirm
//      list_assets surfaces the metadata and the right warnings fire.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { FfprobeUnavailableError } from "../../src/drivers/node/ffprobe.js";
import type { VideoMetadata } from "../../src/drivers/node/ffprobe.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drivers",
  "fixtures",
  "video",
);

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function freshDeps(extra: Partial<ToolDeps> = {}): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 100, height: 100, fps: 30, duration: 10 });
  return { store, ...extra };
}

describe("register_asset (video) — injected probe", () => {
  it("probes the src and stores all metadata; no warnings for a small clip", async () => {
    const meta: VideoMetadata = {
      duration: 5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAlpha: false,
      codec: "h264",
      pixelFormat: "yuv420p",
    };
    const deps = freshDeps({
      probeVideo: async (src) => {
        expect(src).toBe("clip.mp4");
        return meta;
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "v1", type: "video", src: "clip.mp4" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ ok: true });

    expect(deps.store.listAssets().find((a) => a.id === "v1")).toEqual({
      id: "v1",
      type: "video",
      src: "clip.mp4",
      duration: 5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAlpha: false,
      codec: "h264",
      pixelFormat: "yuv420p",
    });
  });

  it("warns when the resolution is 4K or larger (still registers)", async () => {
    const deps = freshDeps({
      probeVideo: async () => ({ width: 3840, height: 2160, codec: "h264" }),
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "uhd", type: "video", src: "uhd.mp4" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => /at or above 4K/i.test(w))).toBe(true);
    expect(deps.store.listAssets().find((a) => a.id === "uhd")?.width).toBe(3840);
  });

  it("warns when the duration exceeds 60s", async () => {
    const deps = freshDeps({
      probeVideo: async () => ({ duration: 75.4, width: 640, height: 360, codec: "h264" }),
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "long", type: "video", src: "long.mp4" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings!.some((w) => /exceeds 60s/i.test(w))).toBe(true);
  });

  it("warns for an exotic codec (av1) that may lack hardware decode", async () => {
    const deps = freshDeps({
      probeVideo: async () => ({ width: 1280, height: 720, codec: "av1" }),
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "a1", type: "video", src: "clip.mkv" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings!.some((w) => /hardware decode/i.test(w) && /av1/.test(w))).toBe(true);
  });

  it("accumulates every warning when a clip trips multiple limits", async () => {
    const deps = freshDeps({
      probeVideo: async () => ({ width: 4096, height: 2160, duration: 120, codec: "av1" }),
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "big", type: "video", src: "big.mov" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings).toHaveLength(3);
  });

  it("returns a warning and registers without metadata when ffprobe is unavailable", async () => {
    const deps = freshDeps({
      probeVideo: async () => {
        throw new FfprobeUnavailableError("no ffprobe");
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "v", type: "video", src: "clip.webm" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/ffprobe not found/i);

    expect(deps.store.listAssets().find((a) => a.id === "v")).toEqual({
      id: "v",
      type: "video",
      src: "clip.webm",
    });
  });

  it("warns (but still registers) when ffprobe runs and fails", async () => {
    const deps = freshDeps({
      probeVideo: async () => {
        throw new Error("Invalid data found when processing input");
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "bad", type: "video", src: "corrupt.mov" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings![0]).toMatch(/Invalid data found/);
    expect(deps.store.listAssets().find((a) => a.id === "bad")?.type).toBe("video");
  });

  it("accepts .mp4 / .mov / .webm / .mkv containers", async () => {
    const deps = freshDeps({
      probeVideo: async () => ({ width: 320, height: 240, codec: "h264" }),
    });
    const srcs = ["a.mp4", "b.mov", "c.webm", "d.mkv"];
    for (const [i, src] of srcs.entries()) {
      const out = await dispatchTool(
        getTool("register_asset"),
        { id: `c${i}`, type: "video", src },
        deps,
      );
      expect(out.ok, `${src} should register`).toBe(true);
    }
    expect(deps.store.listAssets()).toHaveLength(4);
  });

  it("rejects an unsupported extension without invoking ffprobe", async () => {
    let probed = false;
    const deps = freshDeps({
      probeVideo: async () => {
        probed = true;
        return {};
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "x", type: "video", src: "clip.avi" },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
    expect(probed).toBe(false);
  });
});

describe("register_asset (video) — real fixtures via ffprobe-static", () => {
  it("registers a small clip cleanly with full metadata", async () => {
    const deps = freshDeps();
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "small", type: "video", src: join(FIXTURES, "small.mp4") },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ ok: true });

    const asset = deps.store.listAssets().find((a) => a.id === "small")!;
    expect(asset).toMatchObject({
      type: "video",
      codec: "h264",
      width: 320,
      height: 240,
      hasAlpha: false,
      pixelFormat: "yuv420p",
    });
    expect((asset as { fps?: number }).fps).toBeCloseTo(30, 5);
  });

  it("warns on a 4K clip", async () => {
    const deps = freshDeps();
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "uhd", type: "video", src: join(FIXTURES, "uhd-4k.mp4") },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings!.some((w) => /at or above 4K/i.test(w))).toBe(true);

    const asset = deps.store.listAssets().find((a) => a.id === "uhd")!;
    expect(asset).toMatchObject({ width: 3840, height: 2160 });
  });

  it("warns on a >60s clip", async () => {
    const deps = freshDeps();
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "long", type: "video", src: join(FIXTURES, "long.mp4") },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings!.some((w) => /exceeds 60s/i.test(w))).toBe(true);

    const asset = deps.store.listAssets().find((a) => a.id === "long")!;
    expect((asset as { duration?: number }).duration!).toBeGreaterThan(60);
  });

  it("registers a webm with alpha (hasAlpha via alpha_mode tag), no warnings", async () => {
    const deps = freshDeps();
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "alpha", type: "video", src: join(FIXTURES, "alpha.webm") },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ ok: true });

    const asset = deps.store.listAssets().find((a) => a.id === "alpha")!;
    expect(asset).toMatchObject({
      type: "video",
      codec: "vp9",
      width: 160,
      height: 120,
      hasAlpha: true,
    });
  });
});

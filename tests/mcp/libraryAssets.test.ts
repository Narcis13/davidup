// Asset library D1 through the MCP tools: register_asset with an
// `asset:<id>[@sha12]` src takes its type check and its ffprobe facts from the
// record, validate warns (W_ASSET_FILE_MISSING) on a symbolic src with nothing
// behind it, and the render tools fail fast on a stale pin or a missing record.

import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { RED_PNG, makeShelves, put, putFont, type Shelves } from "../assets/libraryShelves.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "drivers", "fixtures");

function tool(name: string): ToolDef {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

const envBefore = { ...process.env };
let sh: Shelves;
let dot: string;

beforeEach(() => {
  sh = makeShelves();
  Object.assign(process.env, sh.env);
  delete process.env.DAVIDUP_PROJECT;
  const shelf = join(sh.project, "assets");
  dot = put(shelf, { id: "dot", kind: "image" }, RED_PNG);
  put(shelf, { id: "tone", kind: "audio", sec: 1.5, rate: 48000, channels: 1, codec: "pcm_s16le" }, readFileSync(join(FIXTURES, "audio", "tone-mono.wav")));
  put(sh.user, { id: "clip", kind: "video", sec: 2, w: 320, h: 240, fps: 30, alpha: false, codec: "h264", audio: false }, readFileSync(join(FIXTURES, "video", "small.mp4")));
  put(sh.house, { id: "fox", kind: "puppet", units: 1, box: [0, 0, 10, 10] }, JSON.stringify({ parts: [] }));
  putFont(sh.house, "inter", "LibInter");
});

afterEach(() => {
  sh.cleanup();
  process.env = { ...envBefore };
});

/** Deps as the editor hosts them: the open project is `sh.project`. */
function deps(extra: Partial<ToolDeps> = {}): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 64, height: 32, fps: 12, duration: 1 });
  const info = { root: sh.project, compositionPath: join(sh.project, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
  return {
    store,
    projectControls: { current: () => info, list: () => [], open: async () => info, create: async () => info },
    probeAudio: async () => {
      throw new Error("register_asset probed an asset: src");
    },
    probeVideo: async () => {
      throw new Error("register_asset probed an asset: src");
    },
    ...extra,
  };
}

describe("register_asset with an asset: src", () => {
  it("registers an image record, pinned", async () => {
    const d = deps();
    const out = await dispatchTool(tool("register_asset"), { id: "d", type: "image", src: `asset:dot@${dot.slice(0, 12)}` }, d);
    expect(out).toMatchObject({ ok: true });
    expect(d.store.listAssets()).toEqual([{ id: "d", type: "image", src: `asset:dot@${dot.slice(0, 12)}` }]);
  });

  it("fills audio and video facts from the record instead of probing", async () => {
    const d = deps();
    expect(await dispatchTool(tool("register_asset"), { id: "t", type: "audio", src: "asset:tone" }, d)).toMatchObject({ ok: true });
    expect(await dispatchTool(tool("register_asset"), { id: "v", type: "video", src: "asset:clip" }, d)).toMatchObject({ ok: true });
    const [t, v] = d.store.listAssets();
    expect(t).toEqual({ id: "t", type: "audio", src: "asset:tone", duration: 1.5, sampleRate: 48000, channels: 1, codec: "pcm_s16le" });
    expect(v).toEqual({ id: "v", type: "video", src: "asset:clip", duration: 2, width: 320, height: 240, fps: 30, hasAlpha: false, codec: "h264", hasAudio: false });
  });

  it("takes a font's family from the record when none is passed", async () => {
    const d = deps();
    expect(await dispatchTool(tool("register_asset"), { id: "f", type: "font", src: "asset:inter" }, d)).toMatchObject({ ok: true });
    expect(d.store.listAssets()[0]).toMatchObject({ family: "LibInter" });
  });

  it("refuses a record of another type (E_ASSET_TYPE_MISMATCH)", async () => {
    const d = deps();
    const wrong = await dispatchTool(tool("register_asset"), { id: "x", type: "video", src: "asset:dot" }, d);
    expect(wrong).toMatchObject({ ok: false, error: { code: "E_ASSET_TYPE_MISMATCH" } });
    const puppet = await dispatchTool(tool("register_asset"), { id: "p", type: "image", src: "asset:fox" }, d);
    expect(puppet).toMatchObject({ ok: false, error: { code: "E_ASSET_TYPE_MISMATCH", message: expect.stringContaining("no asset type") } });
  });

  it("E_ASSET_MISSING and E_ASSET_STALE come back as themselves", async () => {
    const d = deps();
    expect(await dispatchTool(tool("register_asset"), { id: "x", type: "image", src: "asset:teapot" }, d)).toMatchObject({
      ok: false,
      error: { code: "E_ASSET_MISSING", message: expect.stringContaining(`project (${join(sh.project, "assets")})`) },
    });
    expect(await dispatchTool(tool("register_asset"), { id: "x", type: "image", src: "asset:dot@0123456789ab" }, d)).toMatchObject({
      ok: false,
      error: { code: "E_ASSET_STALE" },
    });
    expect(await dispatchTool(tool("register_asset"), { id: "x", type: "image", src: "asset:Dot" }, d)).toMatchObject({
      ok: false,
      error: { code: "E_INVALID_VALUE" },
    });
  });

  it("searches $DAVIDUP_PROJECT's shelf on the standalone server", async () => {
    const d = deps({ projectControls: undefined });
    expect(await dispatchTool(tool("register_asset"), { id: "d", type: "image", src: "asset:dot" }, d)).toMatchObject({
      ok: false,
      error: { code: "E_ASSET_MISSING" },
    });
    process.env.DAVIDUP_PROJECT = sh.project;
    expect(await dispatchTool(tool("register_asset"), { id: "d", type: "image", src: "asset:dot" }, d)).toMatchObject({ ok: true });
  });
});

describe("validate: W_ASSET_FILE_MISSING", () => {
  it("warns on asset: and global: srcs with nothing behind them, not on the rest", async () => {
    const d = deps();
    const s = d.store;
    s.registerAsset({ id: "ok", type: "image", src: "asset:dot" });
    s.registerAsset({ id: "gone", type: "image", src: "asset:nothing" });
    s.registerAsset({ id: "stale", type: "image", src: "asset:dot@0123456789ab" });
    s.registerAsset({ id: "pool", type: "image", src: "global:assets/nothing.png" });
    s.registerAsset({ id: "local", type: "image", src: "./nothing.png" });
    const out = await dispatchTool(tool("validate"), {}, d);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { valid: boolean; warnings: Array<{ code: string; path?: string; message: string }> };
    expect(result.valid).toBe(true);
    const missing = result.warnings.filter((w) => w.code === "W_ASSET_FILE_MISSING");
    expect(missing.map((w) => w.path)).toEqual(["assets.1.src", "assets.2.src", "assets.3.src"]);
    expect(missing[0]!.message).toContain("E_ASSET_MISSING");
    expect(missing[1]!.message).toContain("E_ASSET_STALE");

    rmSync(join(sh.project, "assets", "blobs", `${dot}.png`));
    const again = await dispatchTool(tool("validate"), {}, d);
    if (!again.ok) throw new Error("validate failed");
    const paths = (again.result as { warnings: Array<{ code: string; path?: string }> }).warnings
      .filter((w) => w.code === "W_ASSET_FILE_MISSING")
      .map((w) => w.path);
    expect(paths).toContain("assets.0.src");
  });
});

describe("render tools resolve asset: srcs first", () => {
  it("render_preview_frame draws a record off the open project's shelf, and refuses a stale pin", async () => {
    const skiaCanvas = (await import("skia-canvas")) as never;
    const d = deps({ skiaCanvas });
    d.store.registerAsset({ id: "d", type: "image", src: "asset:dot" });
    d.store.addLayer({ id: "fg", z: 0 });
    d.store.addSprite({ id: "s", layerId: "fg", asset: "d", x: 0, y: 0, width: 64, height: 32 });
    const ok = await dispatchTool(tool("render_preview_frame"), { time: 0 }, d);
    expect(ok).toMatchObject({ ok: true, result: { width: 64, height: 32 } });

    const bad = deps();
    bad.store.registerAsset({ id: "d", type: "image", src: "asset:dot@0123456789ab" });
    expect(await dispatchTool(tool("render_preview_frame"), { time: 0 }, bad)).toMatchObject({
      ok: false,
      error: { code: "E_ASSET_STALE" },
    });
  }, 30_000);
});

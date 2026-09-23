// render_hdf_clip (hand-drawn film 4.0, D5): a declarative composition
// summons an imperative clip in one call. The tool shells out to `hdf`
// (node + skia-canvas + ffmpeg), so these tests render real, short clips.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CompositionStore, dispatchTool, TOOLS, type DispatchRouter, type ToolDeps } from "../../src/mcp/index.js";

const hdfRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "handdrawn");
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

function session(extra: Partial<ToolDeps> = {}, router?: DispatchRouter) {
  const store = new CompositionStore();
  const deps: ToolDeps = { store, ...extra };
  const call = (name: string, args: Record<string, unknown>) => dispatchTool(tool(name), args, deps, router);
  return { store, call };
}

async function ok(p: ReturnType<typeof dispatchTool>) {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result as Record<string, any>;
}

const tmps: string[] = [];
const envWas = process.env.DAVIDUP_HDF_ROOT;
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
  if (envWas === undefined) delete process.env.DAVIDUP_HDF_ROOT; else process.env.DAVIDUP_HDF_ROOT = envWas;
});

// Each test renders with hdf (node, skia-canvas, ffmpeg): seconds alone, more under a full run.
describe("render_hdf_clip", { timeout: 60_000 }, () => {
  it("renders a film, registers it and places it on the timeline in one call", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    await ok(call("add_layer", { id: "fg", z: 1 }));
    const r = await ok(call("render_hdf_clip", { film: "mini", frames: 6, width: 240, place: { layerId: "fg", x: 20, y: 30, width: 240, height: 240, start: 0.5 } }));

    expect(r.clip).toMatchObject({ assetId: "hdf-mini", width: 240, height: 240, duration: 0.5, hasAlpha: false });
    expect(isAbsolute(r.clip.src)).toBe(true); // standalone: no project to be relative to
    expect(existsSync(r.clip.src)).toBe(true);
    const doc = store.toJSON();
    expect(doc.assets.find((a) => a.id === "hdf-mini")).toMatchObject({ type: "video", src: r.clip.src, duration: 0.5 });
    expect(doc.items[r.itemId]).toMatchObject({
      type: "video", asset: "hdf-mini", name: "hdf:mini", start: 0.5, width: 240, height: 240, keepAudio: r.clip.hasAudio,
      transform: { x: 20, y: 30 },
    });
    expect(doc.layers.find((l) => l.id === "fg")!.items).toContain(r.itemId);
    expect((await ok(call("validate", {}))).valid).toBe(true);
  });

  it("with alpha, the clip keeps its transparency", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 2 }));
    const r = await ok(call("render_hdf_clip", { film: "fox-wave", frames: 4, width: 160, alpha: "webm", asset: "fox" }));
    expect(r.clip).toMatchObject({ assetId: "fox", hasAlpha: true });
    expect(r.clip.src).toMatch(/fox\.webm$/);
    expect(r.itemId).toBeUndefined();
    expect(store.toJSON().assets.find((a) => a.id === "fox")).toMatchObject({ type: "video", hasAlpha: true });
  });

  it("an existing item plays the clip instead, keeping its box and timing", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    await ok(call("add_layer", { id: "fg", z: 0 }));
    await ok(call("render_hdf_clip", { film: "mini", frames: 4, width: 160, asset: "old" }));
    const { itemId } = await ok(call("add_video", { asset: "old", x: 5, y: 6, width: 100, height: 100, start: 1 }));
    await ok(call("render_hdf_clip", { film: "mini", frames: 6, width: 160, item: itemId, asset: "new" }));
    expect(store.toJSON().items[itemId]).toMatchObject({ asset: "new", start: 1, width: 100, transform: { x: 5, y: 6 } });
  });

  it("cuts the film to the composition's marks and writes its chapters back as markers, replaced on a re-run", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 14 }));
    await ok(call("add_layer", { id: "fg", z: 0 }));
    const beats = Array.from({ length: 24 }, (_, i) => ({ t: 1 + i * 0.5, name: "beat" }));
    await ok(call("set_composition_property", { property: "markers", value: [...beats, { t: 0.25, name: "mine" }] }));
    const r = await ok(call("render_hdf_clip", { film: "on-beat", frames: 2, width: 160, place: { start: 1 } }));
    expect(r.marks).toBeGreaterThanOrEqual(24);
    expect(r.markers).toBeGreaterThan(0);
    const mine = () => (store.toJSON().composition.markers ?? []).filter((m) => m.source === `hdf:${r.itemId}`);
    const first = mine();
    expect(first).toHaveLength(r.markers);
    expect(first[0]!.t).toBeGreaterThanOrEqual(1);
    expect(store.toJSON().composition.markers!.some((m) => m.name === "mine" && m.source === undefined)).toBe(true);

    // Again on the same item: its markers are replaced, not doubled; others are kept.
    await ok(call("render_hdf_clip", { film: "on-beat", frames: 2, width: 160, item: r.itemId }));
    expect(mine()).toEqual(first);
    expect(store.toJSON().composition.markers!.filter((m) => m.name === "beat")).toHaveLength(24);

    // cues: false reads no marks and writes none.
    const q = await ok(call("render_hdf_clip", { film: "on-beat", frames: 2, width: 160, place: {}, cues: false }));
    expect(q.markers).toBeUndefined();
    expect((store.toJSON().composition.markers ?? []).filter((m) => m.source === `hdf:${q.itemId}`)).toHaveLength(0);
  });

  it("sprites: the film's cast as sheets, with no clip", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 2 }));
    const r = await ok(call("render_hdf_clip", { film: "walk-on", video: false, sprites: ["sam"], states: ["walk"], spriteHeight: 64 }));
    expect(r.clip).toBeUndefined();
    expect(r.sprites).toHaveLength(1);
    expect(r.sprites[0]).toMatchObject({ assetId: "hdf-sam-sprite", frameHeight: 64, cycles: { walk: { start: 0 } } });
    const asset = store.toJSON().assets.find((a) => a.id === "hdf-sam-sprite");
    expect(asset).toMatchObject({ type: "image", sheet: { frameHeight: 64 } });
    // RE-14: the store entry's credit and licence come with it.
    expect(asset).toMatchObject({ licence: "own", credit: expect.stringMatching(/^sam, drawn on the rig sheets/) });
    await ok(call("add_layer", { id: "fg", z: 0 }));
    await ok(call("add_sprite", { layerId: "fg", asset: "hdf-sam-sprite", x: 0, y: 0, width: 50, height: 64, cycle: "walk" }));
    expect((await ok(call("validate", {}))).valid).toBe(true);

    const bad = await call("render_hdf_clip", { film: "walk-on", video: false, sprites: ["nobody"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe("E_NOT_FOUND");
      expect(bad.error.hint).toMatch(/sam/);
    }
  });

  it("goes through the router for every change it makes, as the editor's CommandBus needs", async () => {
    const seen: string[] = [];
    const router: DispatchRouter = (t) => { seen.push(t.name); return null; };
    const { call } = session({}, router);
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    await ok(call("add_layer", { id: "fg", z: 0 }));
    seen.length = 0;
    await ok(call("render_hdf_clip", { film: "mini", frames: 2, width: 160, place: {}, cues: false }));
    expect(seen).toEqual(["render_hdf_clip", "register_asset", "add_video"]);
  });

  it("in a project, copies the clip into <project>/assets/hdf and registers it relative to the project", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdf-clip-proj-"));
    tmps.push(root);
    const project = { root, compositionPath: join(root, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
    const projectControls = { current: () => project, list: () => [], open: async () => project, create: async () => project };
    const { store, call } = session({ projectControls, probeVideo: (src: string) => import("../../src/drivers/node/ffprobe.js").then((m) => m.probeVideo(join(root, src))) });
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    const r = await ok(call("render_hdf_clip", { film: "mini", frames: 2, width: 160 }));
    expect(r.clip.src).toBe("assets/hdf/hdf-mini.mp4");
    expect(existsSync(join(root, "assets", "hdf", "hdf-mini.mp4"))).toBe(true);
    expect(store.toJSON().assets.find((a) => a.id === "hdf-mini")).toMatchObject({ src: "assets/hdf/hdf-mini.mp4" });
    expect(store.toJSON().assets.find((a) => a.id === "hdf-mini")!.duration).toBeCloseTo(2 / 12, 2);

    const inProject = await call("render_hdf_clip", { film: join(root, "nothing.js") });
    expect(inProject.ok ? "ok" : inProject.error.code).toBe("E_NOT_FOUND");
  });

  // RE-13: the item is named by the film's name, never its path, and that name finds the film again.
  it("names the item hdf:<film> for a path too, and a re-render with `item` alone finds its film", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdf-clip-name-"));
    tmps.push(root);
    const project = { root, compositionPath: join(root, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
    const projectControls = { current: () => project, list: () => [], open: async () => project, create: async () => project };
    const { store, call } = session({ projectControls, probeVideo: (src: string) => import("../../src/drivers/node/ffprobe.js").then((m) => m.probeVideo(join(root, src))) });
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    await ok(call("add_layer", { id: "fg", z: 0 }));

    const mini = join(hdfRootDir, "films", "mini.js");
    const a = await ok(call("render_hdf_clip", { film: mini, frames: 2, width: 160, place: {}, cues: false }));
    expect(a.film).toBe(mini);
    expect(store.toJSON().items[a.itemId]!.name).toBe("hdf:mini");
    expect(a.warnings ?? []).toEqual([]);
    const again = await ok(call("render_hdf_clip", { item: a.itemId, frames: 3, width: 160, cues: false }));
    expect(again.film).toBe(mini);

    // A film beside the composition is found by its name; one in a folder is not, and the tool says so.
    const reexport = `export * from ${JSON.stringify(pathToFileURL(mini).href)};\nexport { default } from ${JSON.stringify(pathToFileURL(mini).href)};\n`;
    writeFileSync(join(root, "near-mini.js"), reexport);
    mkdirSync(join(root, "films"));
    writeFileSync(join(root, "films", "far-mini.js"), reexport);
    const near = await ok(call("render_hdf_clip", { film: "near-mini.js", frames: 2, width: 160, asset: "near", place: {}, cues: false }));
    expect(near.film).toBe(join(root, "near-mini.js"));
    expect(store.toJSON().items[near.itemId]!.name).toBe("hdf:near-mini");
    expect((await ok(call("render_hdf_clip", { item: near.itemId, frames: 2, width: 160, cues: false }))).film).toBe(join(root, "near-mini.js"));
    const far = await ok(call("render_hdf_clip", { film: join(root, "films", "far-mini.js"), frames: 2, width: 160, asset: "far", place: {}, cues: false }));
    expect(store.toJSON().items[far.itemId]!.name).toBe("hdf:far-mini");
    expect(JSON.stringify(store.toJSON())).not.toContain(root);
    expect(far.warnings).toEqual([expect.stringMatching(/does not find .*far-mini\.js again; pass `film`/)]);
    const lost = await call("render_hdf_clip", { item: far.itemId, frames: 2, width: 160, cues: false });
    expect(lost.ok ? "ok" : lost.error.code).toBe("E_NOT_FOUND");
  });

  it("refuses what it cannot do, with a hint", async () => {
    const { call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    const code = async (args: Record<string, unknown>) => { const r = await call("render_hdf_clip", args); return r.ok ? "ok" : r.error.code; };

    const unknown = await call("render_hdf_clip", { film: "no-such-film" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.hint).toMatch(/fox-wave/);
    expect(await code({ film: "/etc/hosts" })).toBe("E_INVALID_VALUE"); // a path runs as code: sandboxed
    expect(await code({ film: "mini", item: "x", place: {} })).toBe("E_INVALID_VALUE");
    expect(await code({ film: "mini", video: false })).toBe("E_INVALID_VALUE");
    expect(await code({ film: "mini", item: "nope" })).toBe("E_NOT_FOUND");
    expect(await code({ film: "mini", ar: "4:3" })).toBe("E_INVALID_VALUE");
    expect(await code({})).toBe("E_INVALID_VALUE"); // no film, and no item to name one

    process.env.DAVIDUP_HDF_ROOT = mkdtempSync(join(tmpdir(), "no-hdf-"));
    tmps.push(process.env.DAVIDUP_HDF_ROOT);
    expect(await code({ film: "mini" })).toBe("E_FEATURE_UNAVAILABLE");
    const caps = await ok(call("list_engine_capabilities", {}));
    expect(caps.handdrawn).toEqual({ available: false });
  });

  it("list_engine_capabilities names the films it can render", async () => {
    const caps = await ok(session().call("list_engine_capabilities", {}));
    expect(caps.handdrawn).toMatchObject({ available: true, tool: "render_hdf_clip", aspects: ["1:1", "16:9", "9:16"] });
    expect(caps.handdrawn.films).toEqual(expect.arrayContaining(["mini", "fox-wave", "on-beat"]));
  });
});

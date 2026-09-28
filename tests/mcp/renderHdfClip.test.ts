// render_hdf_clip (hand-drawn film 4.0, D5): a declarative composition
// summons an imperative clip in one call. The tool shells out to `hdf`
// (node + skia-canvas + ffmpeg), so these tests render real, short clips.
// What it makes lands in the asset library (asset-library plan D4): a record
// on the project shelf, or the user's pool standalone (a temp dir here).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const ENV = ["DAVIDUP_HDF_ROOT", "DAVIDUP_ASSETS", "DAVIDUP_PROJECT"] as const;
const envWas = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let userShelf = "";
beforeEach(() => {
  // Standalone, a clip goes on the user's pool: a temp one, never ~/.davidup/assets.
  userShelf = mkdtempSync(join(tmpdir(), "hdf-clip-user-"));
  tmps.push(userShelf);
  process.env.DAVIDUP_ASSETS = userShelf;
  delete process.env.DAVIDUP_PROJECT;
});
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
  for (const k of ENV) if (envWas[k] === undefined) delete process.env[k]; else process.env[k] = envWas[k];
});

const catalogue = (shelf: string) => JSON.parse(readFileSync(join(shelf, "catalogue.json"), "utf8")) as Record<string, Record<string, any>>;
const PIN = /^asset:([a-z0-9-]+)@([0-9a-f]{12})$/;

// Each test renders with hdf (node, skia-canvas, ffmpeg): seconds alone, more under a full run.
describe("render_hdf_clip", { timeout: 60_000 }, () => {
  it("renders a film, registers it and places it on the timeline in one call", async () => {
    const { store, call } = session();
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    await ok(call("add_layer", { id: "fg", z: 1 }));
    const r = await ok(call("render_hdf_clip", { film: "mini", frames: 6, width: 240, place: { layerId: "fg", x: 20, y: 30, width: 240, height: 240, start: 0.5 } }));

    expect(r.clip).toMatchObject({ assetId: "hdf-mini", libraryId: "hdf-mini", shelf: "user", width: 240, height: 240, duration: 0.5, hasAlpha: false });
    // Standalone: a record on the user's pool, registered by its pinned asset: src.
    const [, id, pin] = PIN.exec(r.clip.src)!;
    expect(id).toBe("hdf-mini");
    const entry = catalogue(userShelf)["hdf-mini"]!;
    expect(entry.sha.startsWith(pin)).toBe(true);
    expect(existsSync(join(userShelf, "blobs", `${entry.sha}.mp4`))).toBe(true);
    expect(entry).toMatchObject({ kind: "video", licence: "own", sec: 0.5, w: 240, h: 240, made: { tool: "hdf render", args: { film: "films/mini.js", frames: 6, width: 240 } } });
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
    // The record is hdf-fox, never `fox`: that would shadow the house shelf's fox puppet.
    expect(r.clip).toMatchObject({ assetId: "fox", libraryId: "hdf-fox", hasAlpha: true });
    expect(r.clip.src).toMatch(/^asset:hdf-fox@/);
    expect(r.itemId).toBeUndefined();
    expect(store.toJSON().assets.find((a) => a.id === "fox")).toMatchObject({ type: "video", hasAlpha: true, licence: "own" });
    expect(catalogue(userShelf)["hdf-fox"]).toMatchObject({ ext: "webm", alpha: true, made: { from: expect.arrayContaining(["fox"]), args: { alpha: "webm" } } });
    expect(catalogue(userShelf).fox).toBeUndefined();

    // get_asset shows how it was made, and that the fox puppet was drawn into it.
    const got = await ok(call("get_asset", { id: "hdf-fox" }));
    expect(got).toMatchObject({ shelf: "user", record: { made: { tool: "hdf render", args: { film: "films/fox-wave.js", frames: 4 } } } });
    expect(got.made.from).toContainEqual({ id: "fox", kind: "puppet", shelf: "house" });
    expect((await ok(call("get_asset", { id: "fox" }))).made.into).toContainEqual(expect.objectContaining({ id: "hdf-fox", kind: "video", tool: "hdf render" }));
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
    expect(asset).toMatchObject({ type: "image", sheet: { frameHeight: 64 }, src: expect.stringMatching(/^asset:hdf-sam-sprite@/) });
    expect(catalogue(userShelf)["hdf-sam-sprite"]).toMatchObject({
      kind: "image", ext: "png", sheet: { frameHeight: 64 }, tags: expect.arrayContaining(["sprite", "sam", "walk"]),
      made: { tool: "hdf sprite", from: ["sam"], args: { name: "sam", film: "films/walk-on.js", states: "walk", h: 64 } },
    });
    // What search_assets offers for it is the same registration.
    const hit = (await ok(call("search_assets", { q: "sam sprite", kind: "image" }))).hits[0];
    expect(hit.use.davidup.args).toMatchObject({ id: "hdf-sam-sprite", type: "image", src: asset!.src, sheet: { frameHeight: 64 } });
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

  it("in a project, puts the clip on the project shelf, and a re-render replaces the record in place", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdf-clip-proj-"));
    tmps.push(root);
    const project = { root, compositionPath: join(root, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
    const projectControls = { current: () => project, list: () => [], open: async () => project, create: async () => project };
    const { store, call } = session({ projectControls });
    await ok(call("create_composition", { width: 640, height: 360, fps: 24, duration: 3 }));
    const r = await ok(call("render_hdf_clip", { film: "mini", frames: 2, width: 160 }));
    expect(r.clip).toMatchObject({ assetId: "hdf-mini", libraryId: "hdf-mini", shelf: "project", src: expect.stringMatching(PIN) });
    const shelf = join(root, "assets");
    const first = catalogue(shelf)["hdf-mini"]!;
    expect(first).toMatchObject({ kind: "video", made: { tool: "hdf render", args: { film: "films/mini.js", frames: 2, width: 160 } } });
    expect(first.sec).toBeCloseTo(2 / 12, 2);
    expect(existsSync(join(root, "assets", "hdf"))).toBe(false); // no loose copies any more
    expect(store.toJSON().assets.find((a) => a.id === "hdf-mini")).toMatchObject({ src: r.clip.src });
    expect(store.toJSON().assets.find((a) => a.id === "hdf-mini")!.duration).toBeCloseTo(2 / 12, 2);
    expect(readdirSync(join(shelf, "blobs")).filter((f) => !f.endsWith(".tmp"))).toEqual([`${first.sha}.mp4`]);

    // The same film again, one more drawing: the same record, new bytes, the old blob gone.
    const again = await ok(call("render_hdf_clip", { film: "mini", frames: 3, width: 160 }));
    const second = catalogue(shelf)["hdf-mini"]!;
    expect(Object.keys(catalogue(shelf))).toEqual(["hdf-mini"]);
    expect(second.sha).not.toBe(first.sha);
    expect(second.made.args.frames).toBe(3);
    expect(again.clip.src).toBe(`asset:hdf-mini@${second.sha.slice(0, 12)}`);
    expect(store.toJSON().assets.find((a) => a.id === "hdf-mini")!.src).toBe(again.clip.src);
    expect(readdirSync(join(shelf, "blobs"))).toEqual([`${second.sha}.mp4`]);
    expect((await ok(call("validate", {}))).valid).toBe(true);

    const inProject = await call("render_hdf_clip", { film: join(root, "nothing.js") });
    expect(inProject.ok ? "ok" : inProject.error.code).toBe("E_NOT_FOUND");
  });

  // RE-13: the item is named by the film's name, never its path, and that name finds the film again.
  it("names the item hdf:<film> for a path too, and a re-render with `item` alone finds its film", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdf-clip-name-"));
    tmps.push(root);
    const project = { root, compositionPath: join(root, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
    const projectControls = { current: () => project, list: () => [], open: async () => project, create: async () => project };
    const { store, call } = session({ projectControls });
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

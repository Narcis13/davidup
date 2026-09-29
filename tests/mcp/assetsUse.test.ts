// Asset library D3 through the MCP tools: add_asset (put a file, move a
// record), tag_asset (edit what search reads) and use_asset (register a record
// and place it in one call) over temp shelves.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodePng, readShelf, type EntryInput } from "../../assetlib/index.js";
import { CompositionStore, TOOLS, dispatchTool, type ToolDef, type ToolDeps } from "../../src/mcp/index.js";
import { BLUE_PNG, RED_PNG, makeShelves, put, putFont, repoRoot, solidPng, type Shelves } from "../assets/libraryShelves.js";

function tool(name: string): ToolDef {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

async function ok(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<any> {
  const out = await dispatchTool(tool(name), args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${out.error.code} ${out.error.message}`);
  return out.result;
}

async function fails(name: string, args: Record<string, unknown>, deps: ToolDeps, code: string) {
  const out = await dispatchTool(tool(name), args, deps);
  expect(out.ok, JSON.stringify(out)).toBe(false);
  if (out.ok) throw new Error("unreachable");
  expect(out.error.code).toBe(code);
  return out.error;
}

const HOUSE = join(repoRoot, "assets");
const LONG_MP4 = join(repoRoot, "tests", "drivers", "fixtures", "video", "long.mp4");
const TONE_WAV = join(repoRoot, "tests", "drivers", "fixtures", "audio", "tone-mono.wav");

// No ffprobe in these tests: the facts a probe would give.
const probeVideo = async () => ({ duration: 12, width: 320, height: 180, fps: 30, codec: "h264", hasAlpha: false, hasAudio: false });
const probeAudio = async () => ({ duration: 1, sampleRate: 44100, channels: 1, codec: "pcm_s16le" });

const envBefore = { ...process.env };
let sh: Shelves;
let teapot: string;

beforeEach(() => {
  sh = makeShelves();
  Object.assign(process.env, sh.env);
  delete process.env.DAVIDUP_PROJECT;
  const { sha: _sha, ...entry } = readShelf(HOUSE).entry("teapot");
  teapot = put(sh.house, { ...entry, id: "teapot" } as EntryInput, readShelf(HOUSE).payload("teapot"));
  put(sh.house, { id: "fox", kind: "puppet", name: "Fox", tags: ["animal"], units: 1, box: [0, 0, 10, 10] }, JSON.stringify({ parts: [] }));
  put(
    sh.house,
    {
      id: "fox-sheet",
      kind: "image",
      name: "Fox sprite sheet",
      w: 8,
      h: 4,
      sheet: { frameWidth: 4, frameHeight: 4, columns: 2, count: 2, fps: 12, anchor: { x: 0.5, y: 1 } },
      made: { tool: "hdf sprite", from: ["fox"], args: {} },
    },
    solidPng([0, 200, 0], 8, 4),
  );
  put(sh.house, { id: "walk", kind: "clip", name: "Walk", n: 1, fps: 12, box: [0, 0, 1, 1] }, JSON.stringify({ n: 1, frames: [] }));
  put(sh.user, { id: "tone", kind: "sample", name: "Tone line", licence: "CC-BY", credit: "A. Voice", sec: 1 }, readFileSync(TONE_WAV));
  putFont(sh.house, "inter", "LibInter");
});

afterEach(() => {
  sh.cleanup();
  process.env = { ...envBefore };
});

/** The standalone server: no editor, no project. */
const standalone = (extra: Partial<ToolDeps> = {}): ToolDeps => ({ store: new CompositionStore(), probeVideo, probeAudio, ...extra });

/** Editor-hosted: the open project is `sh.project`. */
function hosted(extra: Partial<ToolDeps> = {}): ToolDeps {
  const info = { root: sh.project, compositionPath: join(sh.project, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
  return {
    store: new CompositionStore(),
    probeVideo,
    probeAudio,
    projectControls: { current: () => info, list: () => [], open: async () => info, create: async () => info },
    ...extra,
  };
}

async function stage(deps: ToolDeps, layers = true): Promise<void> {
  await ok("create_composition", { width: 1280, height: 720, fps: 30, duration: 10 }, deps);
  if (layers) {
    await ok("add_layer", { z: 0, id: "bg" }, deps);
    await ok("add_layer", { z: 1, id: "fg" }, deps);
  }
}

describe("add_asset", () => {
  it("puts a file on the project shelf, hands back its use, and re-puts the same bytes in place", async () => {
    const file = join(sh.project, "red.png");
    writeFileSync(file, solidPng([255, 0, 0], 40, 20));
    const out = await ok("add_asset", { path: "red.png", kind: "image", name: "Red Card", licence: "own", tags: ["red"], desc: "A red card" }, hosted());
    expect(out).toMatchObject({ id: "red-card", shelf: "project", status: "new", warnings: [] });
    expect(out.record).toMatchObject({ kind: "image", media: "raster", w: 40, h: 20, licence: "own", file: "red.png", by: "add_asset", tags: ["red"] });
    expect(out.use.davidup.args).toEqual({ id: "red-card", type: "image", src: `asset:red-card@${out.record.sha.slice(0, 12)}`, licence: "own" });
    expect(existsSync(out.path)).toBe(true);
    expect(readShelf(join(sh.project, "assets")).has("red-card")).toBe(true);

    const again = await ok("add_asset", { path: file, kind: "image", name: "Red Card", licence: "own", tags: ["red", "card"] }, hosted());
    expect(again.status).toBe("unchanged bytes");
    expect(again.record.tags).toEqual(["red", "card"]);

    // Other bytes under the same id: refused unless replace.
    writeFileSync(file, BLUE_PNG);
    const err = await fails("add_asset", { path: file, kind: "image", name: "Red Card", licence: "own" }, hosted(), "E_DUPLICATE_ID");
    expect(err.hint).toMatch(/replace: true/);
    const replaced = await ok("add_asset", { path: file, kind: "image", name: "Red Card", licence: "own", replace: true }, hosted());
    expect(replaced.status).toBe("replaced");
    expect(replaced.replacedSha).toBe(out.record.sha);
  });

  it("writes to the user's pool with no project, and warns on an unknown licence and a CC-BY with no credit", async () => {
    const file = join(sh.project, "blue.png");
    writeFileSync(file, BLUE_PNG);
    const out = await ok("add_asset", { path: file, kind: "stock", name: "Blue paper" }, standalone());
    expect(out.shelf).toBe("user");
    expect(out.record.licence).toBe("unknown");
    expect(out.warnings.join(" ")).toMatch(/licence unknown/);
    const cc = await ok("add_asset", { path: file, id: "blue-cc", kind: "image", name: "Blue", licence: "CC-BY" }, standalone());
    expect(cc.warnings.join(" ")).toMatch(/CC-BY but has no credit/);
  });

  it("refuses a licence outside the enum, a bad id, a missing file and a payload of the wrong kind, writing nothing", async () => {
    const file = join(sh.project, "red.png");
    writeFileSync(file, RED_PNG);
    await fails("add_asset", { path: file, kind: "image", name: "Red", licence: "MIT" }, standalone(), "E_INVALID_VALUE");
    await fails("add_asset", { path: file, kind: "image", name: "Red", id: "Red Dot" }, standalone(), "E_INVALID_VALUE");
    await fails("add_asset", { path: join(sh.project, "nope.png"), kind: "image", name: "Nope" }, standalone(), "E_NOT_FOUND");
    const err = await fails("add_asset", { path: file, kind: "video", name: "Not a video", licence: "own" }, standalone(), "E_INVALID_VALUE");
    expect(err.hint).toMatch(/Nothing was written/);
    await fails("add_asset", { path: file, kind: "image", name: "Red", shelf: "project" }, standalone(), "E_INVALID_VALUE");
    await fails("add_asset", { path: file, name: "Red" }, standalone(), "E_INVALID_VALUE");
    expect(readShelf(sh.user).ids).toEqual(["tone"]);
  });

  it("puts a cutout with the silhouette hdf traces; with no host the missing silhouette is refused", async () => {
    const file = join(sh.project, "pot.webp");
    copyFileSync(readShelf(HOUSE).blobPath(readShelf(HOUSE).entry("teapot")), file);
    const traced = await ok("add_asset", { path: file, id: "pot", kind: "cutout", name: "Pot", licence: "CC0", credit: "The Met" }, hosted());
    expect(traced.record.sil.sub.length).toBeGreaterThan(0);
    expect(traced.record.w).toBe(1093);

    const err = await fails("add_asset", { path: file, id: "pot-2", kind: "cutout", name: "Pot", licence: "CC0" }, hosted({ assetAdds: {} }), "E_INVALID_VALUE");
    expect(err.message).toMatch(/sil/);
  }, 30_000);

  it("probes a video and an audio file through the injected probes", async () => {
    const v = await ok("add_asset", { path: LONG_MP4, kind: "video", name: "Long", licence: "own" }, standalone());
    expect(v.record).toMatchObject({ sec: 12, w: 320, h: 180, fps: 30, codec: "h264", audio: false });
    const a = await ok("add_asset", { path: TONE_WAV, kind: "audio", name: "Tone", licence: "own" }, standalone());
    expect(a.record).toMatchObject({ kind: "audio", sec: 1, rate: 44100, channels: 1 });
  });

  it("measures a video's frame and a raster's pixels, so search_assets { dark, room } finds the navy video (D6)", async () => {
    // long.mp4 is solid navy: its frame at 1 s through davidup's ffmpeg.
    const v = await ok("add_asset", { path: LONG_MP4, kind: "video", name: "Long", licence: "own" }, standalone());
    expect(v.warnings).toEqual([]);
    expect(v.record).toMatchObject({ dark: true, room: { tl: 0, t: 0, tr: 0, l: 0, c: 0, r: 0, bl: 0, b: 0, br: 0 } });
    expect(v.record.colours[0].hex).toMatch(/^#0000[78]/);
    // A dark still whose top-left third is a checkerboard: dark, but no room there.
    const data = new Uint8ClampedArray(90 * 90 * 4);
    for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) data.set(x < 30 && y < 30 && ((x >> 1) + (y >> 1)) % 2 ? [255, 255, 255, 255] : [10, 10, 30, 255], (y * 90 + x) * 4);
    writeFileSync(join(sh.project, "ink.png"), encodePng({ data, width: 90, height: 90 }));
    const ink = await ok("add_asset", { path: join(sh.project, "ink.png"), kind: "image", name: "Ink", licence: "own" }, standalone());
    expect(ink.record.dark).toBe(true);
    expect(ink.record.room.tl).toBeGreaterThan(0.5);

    const out = await ok("search_assets", { dark: true, room: "tl" }, standalone());
    expect(out.hits.map((h: { id: string }) => h.id)).toEqual(["long"]);
    expect(out.hits[0].why).toEqual(["dark: true", "room: tl 0"]);
    expect((await ok("search_assets", { dark: true }, standalone())).hits.map((h: { id: string }) => h.id)).toEqual(["ink", "long"]);
    await fails("search_assets", { room: "middle" }, standalone(), "E_INVALID_VALUE");
  }, 30_000);

  it("moves a record with id and shelf, keeping its sha so a pinned src still resolves", async () => {
    const file = join(sh.project, "red.png");
    writeFileSync(file, RED_PNG);
    const added = await ok("add_asset", { path: file, id: "dot", kind: "image", name: "Dot", licence: "own" }, hosted());
    const moved = await ok("add_asset", { id: "dot", shelf: "user" }, hosted());
    expect(moved).toMatchObject({ id: "dot", from: "project", to: "user", status: "moved" });
    expect(moved.record.sha).toBe(added.record.sha);
    expect(readShelf(join(sh.project, "assets")).has("dot")).toBe(false);
    expect(readShelf(sh.user).has("dot")).toBe(true);
    const deps = hosted();
    await stage(deps);
    await ok("register_asset", { id: "dot", type: "image", src: `asset:dot@${added.record.sha.slice(0, 12)}` }, deps);

    await fails("add_asset", { id: "dot", shelf: "user", tags: ["x"] }, hosted(), "E_INVALID_VALUE");
    await fails("add_asset", { id: "dot", shelf: "user" }, hosted(), "E_INVALID_VALUE");
    await fails("add_asset", { id: "nothing", shelf: "user" }, hosted(), "E_ASSET_MISSING");
  });
});

describe("tag_asset", () => {
  it("adds and removes tags, sets desc and licence in place, and search finds the new tag", async () => {
    const before = readShelf(sh.house).entry("teapot");
    const out = await ok("tag_asset", { id: "teapot", add: ["kettle", "met"], remove: ["object"], desc: "A silver teapot", licence: "PD" }, standalone());
    expect(out.shelf).toBe("house");
    expect(out.added).toEqual(["kettle"]);
    expect(out.removed).toEqual(before.tags.includes("object") ? ["object"] : []);
    expect(out.record).toMatchObject({ desc: "A silver teapot", licence: "PD", sha: before.sha });
    const hits = await ok("search_assets", { tags: "kettle" }, standalone());
    expect(hits.hits.map((h: { id: string }) => h.id)).toEqual(["teapot"]);

    const cleared = await ok("tag_asset", { id: "teapot", desc: "" }, standalone());
    expect(cleared.record.desc).toBeUndefined();
  });

  it("refuses an empty edit, a bad licence and an unknown id", async () => {
    await fails("tag_asset", { id: "teapot" }, standalone(), "E_INVALID_VALUE");
    await fails("tag_asset", { id: "teapot", licence: "GPL" }, standalone(), "E_INVALID_VALUE");
    await fails("tag_asset", { id: "nothing", add: ["x"] }, standalone(), "E_ASSET_MISSING");
  });
});

describe("use_asset", () => {
  it("composes a cutout, a video and a sample from three calls, and the composition validates", async () => {
    const deps = hosted();
    await stage(deps);
    const video = await ok("add_asset", { path: LONG_MP4, id: "long", kind: "video", name: "Long clip", licence: "own" }, deps);
    expect(video.shelf).toBe("project");

    const pot = await ok("use_asset", { id: "teapot" }, deps);
    expect(pot).toMatchObject({ as: "sprite", assetId: "teapot", src: `asset:teapot@${teapot.slice(0, 12)}`, registered: "new", record: { id: "teapot", kind: "cutout", shelf: "house" } });
    // 1093 x 627 shrunk into a quarter of 1280 x 720 (640 x 360): height-bound.
    expect(pot.height).toBe(360);
    expect(pot.width).toBeCloseTo((1093 * 360) / 627, 1);

    const clip = await ok("use_asset", { id: "long", place: { start: 1, end: 4 } }, deps);
    expect(clip).toMatchObject({ as: "video", assetId: "long", registered: "new" });
    const line = await ok("use_asset", { id: "tone", place: { start: 2, volume: 0.8 } }, deps);
    expect(line).toMatchObject({ as: "audio", assetId: "tone", record: { kind: "sample", shelf: "user" } });

    const doc = deps.store.toJSON();
    const sprite = doc.items[pot.itemId] as Record<string, any>;
    expect(sprite).toMatchObject({ type: "sprite", asset: "teapot", name: "teapot", width: pot.width, height: 360 });
    expect(sprite.transform).toMatchObject({ x: 640, y: 360, anchorX: 0.5, anchorY: 0.5 });
    expect(doc.layers.find((l) => l.id === "fg")!.items).toEqual([pot.itemId, clip.itemId]);
    expect(doc.items[clip.itemId]).toMatchObject({ type: "video", asset: "long", start: 1, end: 4, name: "Long clip" });
    expect(doc.audio?.find((t) => t.id === line.audioTrackId)).toMatchObject({ asset: "tone", start: 2, volume: 0.8 });
    // The record's credit and licence came with it.
    expect(doc.assets.find((a) => a.id === "teapot")).toMatchObject({ type: "image", licence: "CC0" });
    expect(doc.assets.find((a) => a.id === "tone")).toMatchObject({ type: "audio", licence: "CC-BY", credit: "A. Voice", duration: 1 });
    expect(doc.assets.find((a) => a.id === "long")).toMatchObject({ type: "video", duration: 12, width: 320 });

    const v = await ok("validate", {}, deps);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it("reuses a registration, refuses another src under a taken id, and repoints it with replace", async () => {
    const deps = standalone();
    await stage(deps);
    const a = await ok("use_asset", { id: "teapot", place: { x: 10, y: 20, width: 200 } }, deps);
    expect(a.height).toBeCloseTo((200 * 627) / 1093, 1);
    const b = await ok("use_asset", { id: "teapot", place: { layerId: "bg" } }, deps);
    expect(b.registered).toBe("already");
    expect(deps.store.toJSON().assets).toHaveLength(1);
    expect(deps.store.toJSON().layers.find((l) => l.id === "bg")!.items).toEqual([b.itemId]);

    await ok("register_asset", { id: "pot", type: "image", src: "somewhere/pot.png" }, deps);
    await fails("use_asset", { id: "teapot", assetId: "pot" }, deps, "E_DUPLICATE_ID");
    const r = await ok("use_asset", { id: "teapot", assetId: "pot", replace: true, place: false }, deps);
    expect(r).toMatchObject({ registered: "replaced", assetId: "pot" });
    expect(r.itemId).toBeUndefined();
    expect(deps.store.toJSON().assets.find((x) => x.id === "pot")!.src).toBe(`asset:teapot@${teapot.slice(0, 12)}`);
  });

  it("takes a puppet through its sprite sheet, sized to a frame and anchored as the sheet says", async () => {
    const deps = standalone();
    await stage(deps);
    const out = await ok("use_asset", { id: "fox", place: { cycle: "walk" } }, deps);
    expect(out).toMatchObject({ as: "sprite", assetId: "fox-sheet", record: { id: "fox", kind: "puppet", via: "fox-sheet" }, width: 4, height: 4 });
    const item = deps.store.toJSON().items[out.itemId] as Record<string, any>;
    expect(item.transform).toMatchObject({ anchorX: 0.5, anchorY: 1 });
    expect(deps.store.toJSON().assets[0]).toMatchObject({ id: "fox-sheet", sheet: { frameWidth: 4 } });
  });

  it("registers a font for add_text and places nothing", async () => {
    const deps = standalone();
    await stage(deps);
    const out = await ok("use_asset", { id: "inter" }, deps);
    expect(out).toMatchObject({ as: "font", assetId: "inter", family: "LibInter", registered: "new" });
    await ok("add_text", { layerId: "fg", text: "Hi", font: out.assetId, fontSize: 40, color: "#fff", x: 10, y: 10 }, deps);
    await fails("use_asset", { id: "inter", place: { x: 1 } }, deps, "E_INVALID_VALUE");
  });

  it("refuses what davidup cannot take, a wrong `as`, and a stage with no layer, registering nothing", async () => {
    const deps = standalone();
    await stage(deps, false);
    await fails("use_asset", { id: "walk" }, deps, "E_ASSET_TYPE_MISMATCH");
    await fails("use_asset", { id: "teapot", as: "video" }, deps, "E_ASSET_TYPE_MISMATCH");
    const err = await fails("use_asset", { id: "teapot" }, deps, "E_NOT_FOUND");
    expect(err.hint).toMatch(/add_layer/);
    await fails("use_asset", { id: "nothing" }, deps, "E_ASSET_MISSING");
    expect(deps.store.toJSON().assets).toEqual([]);
    // place: false needs no layer.
    await ok("use_asset", { id: "teapot", place: false }, deps);
    expect(deps.store.toJSON().assets).toHaveLength(1);
  });

  it("undoes its registration when placing fails", async () => {
    const deps = standalone();
    await stage(deps);
    const err = await fails("use_asset", { id: "teapot", place: { layerId: "nowhere" } }, deps, "E_NOT_FOUND");
    expect(err.message).toMatch(/^add_sprite:/);
    expect(deps.store.toJSON().assets).toEqual([]);
    await fails("use_asset", { id: "teapot", place: { asset: "x" } }, deps, "E_INVALID_VALUE");
  });
});

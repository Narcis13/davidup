// handdrawn ↔ davidup bridge scripts (hand-drawn film 3.0, S16). They run
// under bun and shell out to `hdf` (node + skia-canvas + ffmpeg), so these
// tests spawn them the way a user would.

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { scaffoldProject } from "../../src/cli/scaffold.js";
import * as skia from "skia-canvas";

import { CompositionStore, dispatchTool, TOOLS } from "../../src/mcp/index.js";

const REPO = resolve(__dirname, "..", "..");
const HDF_OUT = join(REPO, "handdrawn", "out");

function bun(script: string, ...args: string[]) {
  const r = spawnSync("bun", ["run", join(REPO, "scripts", script), ...args], { cwd: REPO, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hdf-bridge-"));
  tmps.push(dir);
  await scaffoldProject({ targetDir: join(dir, "proj") });
  return join(dir, "proj");
}

// The assets the project's composition.json holds, listed by the engine's own list_assets.
async function listAssets(root: string) {
  const store = new CompositionStore();
  store.replaceComposition(JSON.parse(readFileSync(join(root, "composition.json"), "utf8")));
  const r = await dispatchTool(TOOLS.find((t) => t.name === "list_assets")!, {}, { store });
  if (!r.ok) throw new Error(r.error.message);
  return (r.result as { assets: Array<Record<string, unknown>> }).assets;
}

describe("hdf-to-davidup", () => {
  it("--dry-run prints the asset list and renders nothing", () => {
    rmSync(join(HDF_OUT, "fox-and-teapot-7f.mp4"), { force: true });
    const { code, out, err } = bun("hdf-to-davidup.ts", "fox-and-teapot", "--dry-run", "--frames", "7");
    expect(code, err).toBe(0);
    expect(out).toMatch(/^fox-and-teapot: 7 frames$/m);
    expect(out).toMatch(/^hdf-fox-and-teapot {2}video {2}hdf render .*fox-and-teapot\.js --frames 7$/m);
    expect(out).toMatch(/^hdf-fox-model {2}image {2}hdf sheet store fox --poses$/m);
    expect(existsSync(join(HDF_OUT, "fox-and-teapot-7f.mp4"))).toBe(false);
  });

  it("names a project it cannot find", () => {
    const { code, err } = bun("hdf-to-davidup.ts", "mini", "--project", join(tmpdir(), "no-such-davidup-project"));
    expect(code).toBe(1);
    expect(err).toMatch(/no davidup project/);
  });

  it("registers a 6-frame mini render into a project, and list_assets lists it", async () => {
    const root = await project();
    const { code, out, err } = bun("hdf-to-davidup.ts", "mini", "--project", root, "--frames", "6");
    expect(code, err).toBe(0);
    expect(out).toMatch(/hdf-mini {2}video {2}assets\/hdf\/hdf-mini\.mp4/);
    expect(existsSync(join(root, "assets", "hdf", "hdf-mini.mp4"))).toBe(true);
    const video = (await listAssets(root)).find((a) => a.id === "hdf-mini");
    expect(video).toMatchObject({ type: "video", src: "assets/hdf/hdf-mini.mp4", width: 1080, height: 1080, duration: 0.5 });

    // A second run replaces the asset instead of failing on a duplicate id.
    expect(bun("hdf-to-davidup.ts", "mini", "--project", root, "--frames", "6").code).toBe(0);
    expect((await listAssets(root)).filter((a) => a.id === "hdf-mini")).toHaveLength(1);
  });
});

// 4.0 D2: sprite sheets. The film's cast (walk-on exports sam) drawn by `hdf sprite`, registered as an image
// with its `sheet`, and walked by an agent's add_sprite with `cycle: "walk"`: no video anywhere.
describe("hdf-to-davidup --sprites", () => {
  it("--dry-run names the cast it would draw, and refuses a name outside it", () => {
    const dry = bun("hdf-to-davidup.ts", "walk-on", "--dry-run", "--sprites", "--no-video", "--no-sheets");
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(/^hdf-fox-sprite {2}image {2}hdf sprite fox --film .*walk-on\.js --alpha$/m);
    expect(dry.out).toMatch(/^hdf-sam-sprite {2}image {2}hdf sprite sam --film .*walk-on\.js --alpha$/m);
    expect(dry.out).not.toMatch(/video/);
    expect(bun("hdf-to-davidup.ts", "walk-on", "--dry-run", "--sprites", "sam,bob").err).toMatch(/bob not in walk-on's cast \(has fox, sam\)/);
  });

  it("registers sam's sheet, and a sprite playing its walk changes frame as it crosses the stage", async () => {
    const root = await project();
    const { code, out, err } = bun("hdf-to-davidup.ts", "walk-on", "--project", root, "--sprites", "sam",
      "--no-video", "--no-sheets", "--states", "walk,happy", "--h", "120");
    expect(code, err).toBe(0);
    expect(out).toMatch(/hdf-sam-sprite {2}image {2}assets\/hdf\/hdf-sam-sprite\.png {2}\(9 frames of \d+x120, cycles walk, happy\)/);
    const asset = (await listAssets(root)).find((a) => a.id === "hdf-sam-sprite") as {
      sheet: { frameWidth: number; frameHeight: number; count: number; fps: number; cycles: Record<string, { start: number; count: number; speed?: number; loop?: boolean }>; anchor: { x: number; y: number } };
    };
    expect(asset.sheet).toMatchObject({ frameHeight: 120, count: 9, fps: 12, cycles: { walk: { start: 0, count: 8 }, happy: { start: 8, count: 1, loop: false } } });
    expect(asset.sheet.cycles.walk!.speed).toBeGreaterThan(0);

    // What an agent does next, on a stage of its own: the sheet registered as the bridge registered it, a
    // sprite on it walking at the sheet's own speed, feet on a line. (Rendered from this test's cwd, so the
    // src is absolute.)
    const store = new CompositionStore();
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await dispatchTool(TOOLS.find((t) => t.name === name)!, args, { store, skiaCanvas: skia as never });
      if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
      return r.result as Record<string, unknown>;
    };
    const { frameWidth: fw, frameHeight: fh, anchor } = asset.sheet;
    const speed = asset.sheet.cycles.walk!.speed!;
    await call("create_composition", { width: 640, height: 360, fps: 12, duration: 2, background: "#ffffff" });
    await call("register_asset", { id: "sam", type: "image", src: join(root, "assets/hdf/hdf-sam-sprite.png"), sheet: asset.sheet });
    await call("add_layer", { id: "cast", z: 10 });
    await call("add_sprite", { layerId: "cast", id: "sam", asset: "sam", x: 200, y: 330, width: fw, height: fh, anchorX: anchor.x, anchorY: anchor.y, cycle: "walk" });
    const png = async (time: number) => Buffer.from((await call("render_preview_frame", { time, format: "png" })).image as string, "base64");
    // Standing still, the cycle alone changes the picture: frame 1 of the walk a twelfth in, frame 0 again a loop on.
    const [a, b, loop] = [await png(0), await png(1 / 12), await png(8 / 12)];
    expect(a.equals(b)).toBe(false);
    expect(a.equals(loop)).toBe(true);
    // Held on happy it stops changing.
    await call("update_item", { id: "sam", props: { cycle: "happy" } });
    expect((await png(0.25)).equals(await png(1.5))).toBe(true);
    await call("update_item", { id: "sam", props: { cycle: "walk" } });
    await call("add_tween", { target: "sam", property: "transform.x", from: 200, to: 200 + speed, start: 0, duration: 1 });
    expect((await call("validate", {})).valid).toBe(true);
  });
});

// 4.0 D3: a hand as a font. `hdf hand --export-ttf` sweeps the hand's centre lines by its pen into a TrueType file,
// registered as a font asset, and davidup's own text path (FontLibrary + fillText) letters a title in it.
describe("hdf-to-davidup --fonts", () => {
  it("--dry-run names the film's hand, from --look too", () => {
    const plain = bun("hdf-to-davidup.ts", "walk-on", "--dry-run", "--fonts", "--no-video", "--no-sheets");
    expect(plain.code, plain.err).toBe(0);
    expect(plain.out).toMatch(/^hdf-house-font {2}font {2}hdf hand --export-ttf house {2}\(family hdf-house\)$/m);
    const looked = bun("hdf-to-davidup.ts", "walk-on", "--look", "paperInk~hand:test", "--dry-run", "--fonts", "--no-video", "--no-sheets");
    expect(looked.out).toMatch(/^hdf-test-font {2}font {2}hdf hand --export-ttf test/m);
  });

  it("registers the test hand as a font, and a text item set in it draws the hand, not the bundled face", async () => {
    const root = await project();
    const { code, out, err } = bun("hdf-to-davidup.ts", "walk-on", "--project", root, "--fonts", "test", "--no-video", "--no-sheets");
    expect(code, err).toBe(0);
    expect(out).toMatch(/hdf-test-font {2}font {2}assets\/hdf\/hdf-test-font\.ttf {2}\(family hdf-test\)/);
    const asset = (await listAssets(root)).find((a) => a.id === "hdf-test-font");
    expect(asset).toMatchObject({ type: "font", family: "hdf-test", src: "assets/hdf/hdf-test-font.ttf" });
    // RE-14: the store's credit and licence for the hand come with it.
    expect(asset).toMatchObject({ licence: "own", credit: expect.stringMatching(/^synthesised from the house hand/) });

    const store = new CompositionStore();
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await dispatchTool(TOOLS.find((t) => t.name === name)!, args, { store, skiaCanvas: skia as never });
      if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
      return r.result as Record<string, unknown>;
    };
    await call("create_composition", { width: 640, height: 200, fps: 12, duration: 1, background: "#ffffff" });
    await call("register_asset", { id: "hand", type: "font", src: join(root, "assets/hdf/hdf-test-font.ttf"), family: "hdf-test" });
    await call("add_layer", { id: "t", z: 0 });
    await call("add_text", { layerId: "t", id: "title", text: "Hamburgefonstiv", font: "hand", fontSize: 64, color: "#000000", x: 20, y: 60 });
    const ink = async () => {
      const png = Buffer.from((await call("render_preview_frame", { time: 0, format: "png" })).image as string, "base64");
      const img = await skia.loadImage(png), c = new skia.Canvas(img.width, img.height), g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 128) n++;
      return { png, n };
    };
    const inHand = await ink();
    expect(inHand.n).toBeGreaterThan(1500);
    await call("update_item", { id: "title", props: { font: "font:default" } });
    const bundled = await ink();
    expect(bundled.n).toBeGreaterThan(1500);
    expect(inHand.png.equals(bundled.png)).toBe(false);
  });
});

describe("davidup-hdf-clip", () => {
  it("renders the film a video item names and points its asset at the mp4", async () => {
    const root = await project();
    const file = join(root, "composition.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.items.clip = {
      type: "video", asset: "ball", name: "hdf:mini", width: 360, height: 360, start: 0, fit: "contain", loop: true,
      transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    };
    doc.layers[0].items.push("clip");
    writeFileSync(file, JSON.stringify(doc, null, 2));

    expect(bun("davidup-hdf-clip.ts", file, "badge").err).toMatch(/is a shape, not a video/);
    const { code, out, err } = bun("davidup-hdf-clip.ts", file, "clip", "--frames", "6");
    expect(code, err).toBe(0);
    expect(out).toMatch(/clip plays ball {2}video {2}assets\/hdf\/ball\.mp4/);
    expect((await listAssets(root)).find((a) => a.id === "ball")).toMatchObject({ type: "video", duration: 0.5 });
    // The item itself is untouched.
    expect(JSON.parse(readFileSync(file, "utf8")).items.clip).toEqual(doc.items.clip);

    // RE-13: a name the films folder does not hold is looked up beside composition.json.
    const mini = pathToFileURL(join(REPO, "handdrawn", "films", "mini.js")).href;
    writeFileSync(join(root, "my-mini.js"), `export * from ${JSON.stringify(mini)};\nexport { default } from ${JSON.stringify(mini)};\n`);
    const named = JSON.parse(readFileSync(file, "utf8"));
    named.items.clip.name = "hdf:my-mini";
    writeFileSync(file, JSON.stringify(named, null, 2));
    const dry = bun("davidup-hdf-clip.ts", file, "clip", "--dry-run");
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(/hdf render \S*my-mini\.js/);
  });

  // 4.0 D1: an overlay. The film is drawn on no stock and registered with its alpha, as ProRes 4444 or VP9.
  it("--alpha registers a clip with its transparency, as .mov or .webm", async () => {
    const root = await project();
    const file = join(root, "composition.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.items.fox = {
      type: "video", asset: "fox", name: "hdf:fox-wave", width: 360, height: 360, start: 0, fit: "contain", loop: true,
      transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    };
    doc.layers[0].items.push("fox");
    writeFileSync(file, JSON.stringify(doc, null, 2));

    expect(bun("davidup-hdf-clip.ts", file, "fox", "--alpha", "--dry-run").out).toMatch(/hdf render .*fox-wave\.js --alpha mov/);
    expect(bun("davidup-hdf-clip.ts", file, "fox", "--alpha", "gif").err).toMatch(/--alpha takes mov or webm/);
    for (const [codec, ext] of [["mov", "prores"], ["webm", "vp9"]] as const) {
      const { code, out, err } = bun("davidup-hdf-clip.ts", file, "fox", "--frames", "6", "--alpha", codec);
      expect(code, err).toBe(0);
      expect(out).toMatch(new RegExp(`fox plays fox {2}video {2}assets/hdf/fox\\.${codec} .*alpha`));
      expect((await listAssets(root)).find((a) => a.id === "fox")).toMatchObject({ type: "video", hasAlpha: true, codec: ext });
    }
  });
});

// 4.0 D4: cues both ways. The film is cut to the composition's beats (its audio track's markers, in the
// item's seconds), and its chapters come back as composition markers.
describe("cues both ways", () => {
  const BEAT = 60 / 128;
  const onGrid = (t: number) => Math.round(t * 12) / 12;

  it("handdrawn's marksOf places a composition's markers as davidup's timelineMarkers does", async () => {
    const { timelineMarkers } = await import("../../src/schema/index.js");
    // @ts-expect-error -- plain JS module
    const { marksOf } = await import("../../handdrawn/core/cuemarks.js");
    const doc = {
      version: "0.1",
      composition: { width: 320, height: 180, fps: 30, duration: 30, background: "#000", markers: [{ t: 2, name: "a" }, { t: 29, name: "z", source: "x" }] },
      assets: [{ id: "m", type: "audio", src: "m.wav", duration: 7 }, { id: "n", type: "audio", src: "n.wav" }],
      layers: [], items: {}, tweens: [],
      audio: [
        { id: "loop", asset: "m", start: 1, trimIn: 1.5, loop: true, end: 25, markers: [{ t: 1, name: "cut off" }, { t: 2, name: "beat" }, { t: 6.9, name: "late" }] },
        { id: "once", asset: "m", start: 3, markers: [{ t: 0, name: "down" }, { t: 6, name: "up" }] },
        { id: "free", asset: "n", start: 4, loop: true, markers: [{ t: 0.5, name: "once" }] },
      ],
    };
    const want = timelineMarkers(doc as never).map((m) => `${m.name}@${m.t.toFixed(6)}`);
    const names = new Set(want.map((w) => w.split("@")[0]));
    const got = (marksOf(doc) as Array<{ t: number; name: string }>).filter((m) => names.has(m.name)).map((m) => `${m.name}@${m.t.toFixed(6)}`);
    expect(got).toEqual(want);
    expect(want.filter((w) => w.startsWith("beat@"))).toHaveLength(5);
  });

  it("davidup-hdf-clip cuts on-beat to the track's bars and writes its chapters as markers", async () => {
    const root = await project();
    const file = join(root, "composition.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.composition.duration = 12;
    doc.composition.markers = [{ t: 0.25, name: "mine" }];
    doc.assets.push({ id: "music", type: "audio", src: "music.wav", duration: 20 });
    doc.audio = [{ id: "music", asset: "music", start: 0, markers: [...Array.from({ length: 25 }, (_, k) => ({ t: k * BEAT, name: "beat" })), { t: 12 * BEAT, name: "drop" }] }];
    doc.items.film = {
      type: "video", asset: "beat-clip", name: "hdf:on-beat", width: 360, height: 360, start: 2 * BEAT, fit: "contain", loop: false,
      transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    };
    doc.layers[0].items.push("film");
    writeFileSync(file, JSON.stringify(doc, null, 2));

    expect(bun("davidup-hdf-clip.ts", file, "film", "--dry-run").out).toMatch(/--cues-from .*composition\.json --at film\n {2}chapters -> composition markers \(source hdf:film\)/);
    expect(bun("davidup-hdf-clip.ts", file, "film", "--dry-run", "--no-cues").out).not.toMatch(/cues-from/);

    for (let run = 0; run < 2; run++) {   // a second run replaces its markers, it does not add to them
      const { code, out, err } = bun("davidup-hdf-clip.ts", file, "film");
      expect(code, err).toBe(0);
      expect(out).toMatch(/2 chapter markers \(source hdf:film\)/);
    }
    const after = JSON.parse(readFileSync(file, "utf8"));
    const start = 2 * BEAT;
    expect(after.composition.markers).toEqual([
      { t: 0.25, name: "mine" },
      { t: +start.toFixed(6), name: "count in", source: "hdf:film" },
      { t: +(start + onGrid(10 * BEAT)).toFixed(6), name: "the drop", source: "hdf:film" },
    ]);
    // The render's cuts, back on the composition timeline, each within half a drawn frame of a beat.
    const cues = JSON.parse(readFileSync(join(HDF_OUT, "on-beat-cues.json"), "utf8"));
    expect(cues.cuts.length).toBeGreaterThanOrEqual(2);
    for (const t of cues.cuts) {
      const off = Math.min(...Array.from({ length: 25 }, (_, k) => Math.abs(k * BEAT - (start + t))));
      expect(off).toBeLessThanOrEqual(1 / 24 + 1e-6);
    }
    // The registered clip is the cut render (101 drawn frames, not the fallback's 115).
    const clip = (await listAssets(root)).find((a) => a.id === "beat-clip") as { type: string; duration: number };
    expect(clip.type).toBe("video");
    expect(clip.duration).toBeCloseTo(cues.end, 2);
    expect(cues.end).toBeLessThan(115 / 12 - 0.5);
    const { validateComposition } = await import("../../src/schema/index.js");
    expect(validateComposition(after).warnings.filter((w) => w.code === "W_MARKER_OUTSIDE")).toEqual([]);
  });
});

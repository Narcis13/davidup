import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KINDS, LICENCES, PREVIEW_WIDTH, decodePng, encodePng, openLibrary, readShelf, useOf } from "../../assetlib/index.js";
import { TOOLS } from "../../src/mcp/tools.js";
import { probeVideo } from "../../src/drivers/node/ffprobe.js";
import { ASSET_LICENCES, AssetSchema } from "../../src/schema/zod.js";

// The asset library (docs/asset-library-plan.md) and the composition schema share one licence list, so a
// record's licence copies straight into a composition asset (RE-14's `licence`).
describe("assetlib from davidup", () => {
  it("has the same licences as ASSET_LICENCES", () => {
    expect([...LICENCES]).toEqual([...ASSET_LICENCES]);
  });

  it("has a kind for every davidup asset type", () => {
    const types = AssetSchema.options.map((o) => o.shape.type.value);
    expect(types.filter((t) => !KINDS.includes(t))).toEqual([]);
  });

  it("opens from TypeScript through index.d.ts", () => {
    const lib = openLibrary({ shelves: [{ name: "project", root: new URL("../../assetlib/test/fixtures/project", import.meta.url).pathname }] });
    expect(lib.get("fox")).toMatchObject({ id: "fox", kind: "image", media: "raster", shelf: "project", shadowed: [] });
    expect(readShelf(lib.shelves[0]!.root).ids).toEqual(["fox", "logo"]);
  });

  it("searches from TypeScript (A3)", () => {
    const root = new URL("../../assetlib/test/fixtures/search/", import.meta.url).pathname;
    const lib = openLibrary({ shelves: ["project", "user", "house"].map((name) => ({ name, root: root + name })) });
    const out = lib.search({ q: "paper", media: "raster", hue: "warm", limit: 2 });
    expect(out.hits.map((h) => [h.id, h.shelf, h.why])).toEqual([
      ["paper-warm", "project", ["id: paper", "colours: warm #eadcc0"]],
      ["paper-kraft", "house", ["id: paper", "colours: warm #c8a878"]],
    ]);
    expect(out.facets?.kind).toEqual({ stock: 2 });
    expect(out.hits[0]!.path.endsWith(`${out.hits[0]!.record.sha}.webp`)).toBe(true);
  });

  it("previews and sheets from TypeScript, with a host previewer (A4)", async () => {
    const root = mkdtempSync(join(tmpdir(), "assetlib-ts-"));
    try {
      const png = (w: number, h: number, rgb: number[]) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
        return encodePng({ data, width: w, height: h });
      };
      const drawn: string[] = [];
      const lib = openLibrary({ shelves: [{ name: "user", root }], previewers: {
        image: { name: "ts", version: 1, render: (_file, record, { width }) => { drawn.push(record.id); return png(width, 270, [200, 40, 40]); } },
      } });
      const own = { kind: "image" as const, tags: [], licence: "own" as const, credit: "", source: "" };
      await lib.put("user", { ...own, id: "red", name: "Red" }, png(4, 3, [200, 40, 40]));
      await lib.put("user", { ...own, id: "voice", kind: "audio", name: "Voice" }, Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00"));
      const pv = await lib.preview("red");
      expect([pv.by, pv.cached, pv.path]).toEqual(["ts@1", false, join(root, "thumbs", `${lib.get("red").sha}.png`)]);
      expect(decodePng(pv.png).width).toBe(PREVIEW_WIDTH);
      const sheet = await lib.sheet(["red", "voice"]);
      expect([sheet.cols, sheet.rows, sheet.cells.map((c) => c.id)]).toEqual([2, 1, ["red", "voice"]]);
      expect(drawn).toEqual(["red"]);
      expect((await lib.preview("voice")).by).toMatch(/^card:/);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("puts a video with davidup's own probeVideo as the probe (A2)", async () => {
    const root = mkdtempSync(join(tmpdir(), "assetlib-ts-"));
    try {
      const lib = openLibrary({ shelves: [{ name: "user", root }] });
      const bytes = readFileSync(new URL("../drivers/fixtures/video/small.mp4", import.meta.url));
      const out = await lib.put("user", { id: "small", kind: "video", name: "Small", tags: [], licence: "own", credit: "", source: "" }, bytes, { probes: { probeVideo } });
      expect(out.warnings).toEqual(["no pixels probe: colours left empty"]);
      expect(out.entry).toMatchObject({ kind: "video", media: "video", ext: "mp4", w: 320, h: 240, codec: "h264", alpha: false, bytes: bytes.length });
      expect(out.entry.fps).toBeCloseTo(30, 5);
      expect(lib.get("small").shelf).toBe("user");
    } finally {
      rmSync(root, { recursive: true });
    }
  }, 20_000);   // the first ffprobe spawn on a cold machine can take seconds

  it("gives register_asset args its own input schema takes (A5)", () => {
    const tool = TOOLS.find((t) => t.name === "register_asset")!;
    const input = z.object(tool.inputSchema).strict();
    const sha = "ab12cd34ef56".padEnd(64, "0");
    const own = { tags: [], licence: "CC-BY" as const, credit: "By someone", source: "", sha, ext: "x" };
    const sheet = { frameWidth: 64, frameHeight: 64, columns: 4, count: 8, fps: 12 };
    const records = [
      { ...own, id: "logo", kind: "image" as const, name: "Logo", sheet },
      { ...own, id: "teapot", kind: "cutout" as const, name: "Teapot" },
      { ...own, id: "paper", kind: "stock" as const, name: "Paper" },
      { ...own, id: "clouds", kind: "video" as const, name: "Clouds" },
      { ...own, id: "bed", kind: "audio" as const, name: "Bed" },
      { ...own, id: "moon-look", kind: "sample" as const, name: "Moon", credit: "" },
      { ...own, id: "caveat", kind: "font" as const, name: "Caveat", family: "Caveat", licence: "OFL" as const },
    ];
    for (const record of records) {
      const { davidup } = useOf(record);
      expect(davidup?.tool).toBe("register_asset");
      expect(input.parse(davidup!.args)).toEqual(davidup!.args);
      expect(davidup!.args.src).toBe(`asset:${record.id}@ab12cd34ef56`);
    }
    expect(useOf(records[5]!).davidup!.args).not.toHaveProperty("credit");
  });
});

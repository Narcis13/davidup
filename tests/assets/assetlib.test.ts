import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KINDS, LICENCES, openLibrary, readShelf } from "../../assetlib/index.js";
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
});

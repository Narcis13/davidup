import { describe, expect, it } from "vitest";
import { KINDS, LICENCES, openLibrary, readShelf } from "../../assetlib/index.js";
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
});

// Asset library I2: the first house pack. What our tools made (scripts/house-pack.mjs RECIPES) is on the house
// shelf with the recipe as its `made` block; every house record has a desc and at least three tags; `asset check
// --house` is clean and the blobs that ship stay under the 15 MB budget; and the searches of the acceptance piece
// (plan §11) find the pack from the house shelf alone.

import { describe, expect, it } from "vitest";
import { HOUSE_ROOT, HOUSE_BUDGET, check, houseFindings, openLibrary } from "../../assetlib/index.js";

type Recipe = { id: string; kind: string; made: { tool: string; from: string[]; args: Record<string, unknown> } };
const { RECIPES } = (await import("../../scripts/house-pack.mjs")) as { RECIPES: Recipe[] };

const lib = openLibrary({ shelves: [{ name: "house", root: HOUSE_ROOT }] });
const house = lib.shelf("house");
const first = (query: Parameters<typeof lib.search>[0]) => lib.search(query).hits[0];

describe("the first house pack (asset library I2)", () => {
  it("is on the house shelf, each record made by its recipe", () => {
    expect(RECIPES.length).toBe(28);
    for (const r of RECIPES) {
      const e = house.entry(r.id);
      expect(e.kind, r.id).toBe(r.kind);
      expect({ tool: e.made?.tool, from: e.made?.from, args: e.made?.args }, r.id).toEqual(r.made);
      expect(e.made?.version, r.id).toBe(1);
    }
    const kinds = (k: string) => RECIPES.filter((r) => r.kind === k).length;
    expect([kinds("stock"), kinds("sample"), kinds("audio"), kinds("font"), kinds("image")]).toEqual([6, 12, 2, 4, 4]);
  });

  it("gives every house record a desc and at least three tags", () => {
    const thin = house.ids.filter((id) => !String(house.entry(id).desc ?? "").trim() || (house.entry(id).tags ?? []).length < 3);
    expect(thin).toEqual([]);
    // The Met cutouts are findable by what they are.
    expect(house.entry("teapot").tags).toEqual(expect.arrayContaining(["met", "object", "kitchen"]));
    expect(house.entry("helmet").tags).toContain("armour");
    expect(house.entry("violin").tags).toContain("music");
  });

  it("passes asset check --house: no error, no warning, under the budget", () => {
    const found = check(lib, { house: true }).filter((f) => f.level !== "note");
    expect(found).toEqual([]);
    const { bytes, budget } = houseFindings(house);
    expect(budget).toBe(HOUSE_BUDGET);
    expect(bytes).toBeLessThan(HOUSE_BUDGET);
  });

  it("answers the acceptance piece's searches from the house shelf", () => {
    expect(first({ q: "warm paper", media: "raster" })?.id).toBe("paper-warm");

    const fox = first({ q: "fox walk", kind: ["image"] });
    expect(fox?.id).toBe("fox-sprite");
    const sprite = fox?.use.davidup?.args as { src: string; sheet: { cycles: Record<string, unknown> } };
    expect(sprite.src).toBe(`asset:fox-sprite@${house.entry("fox-sprite").sha.slice(0, 12)}`);
    expect(Object.keys(sprite.sheet.cycles)).toEqual(["idle", "walk", "wave"]);

    const font = first({ q: "handwritten", kind: ["font"] });
    expect(font?.id).toBe("hershey-script-font");
    expect(font?.use.davidup?.args).toMatchObject({ type: "font", family: "hdf-hershey-script", licence: "PD" });

    const pop = first({ q: "pop", media: "audio" });
    expect(pop?.id).toBe("sfx-pop");
    expect(pop?.use.davidup?.args).toMatchObject({ type: "audio", src: `asset:sfx-pop@${house.entry("sfx-pop").sha.slice(0, 12)}` });

    expect(lib.search({ q: "music bed" }).hits.slice(0, 2).map((h) => h.id).sort()).toEqual(["bed-bright", "bed-calm"]);
    expect(lib.search({ q: "kitchen" }).hits.map((h) => h.id)).toEqual(expect.arrayContaining(["cup", "teapot"]));
  });

  it("reaches davidup from a puppet or a hand through what was made from it", () => {
    expect(lib.use("fox").davidup?.args.id).toBe("fox-sprite");
    expect(lib.use("octopus").davidup?.args.id).toBe("octopus-sprite");
    expect(lib.use("hershey-script").davidup?.args.id).toBe("hershey-script-font");
  });
});

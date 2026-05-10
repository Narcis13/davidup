// v0.2 acceptance test from COMPOSITION_PRIMITIVES.md §13:
// "rewrite examples/comprehensive-composition.json into 6 split files using
// $ref + behaviors. Assert byte-for-byte canonical output matches the
// original."
//
// The rewrite lives in examples/comprehensive-split/. The 6 split fragments
// are the per-act tween files under acts/; meta.json factors out the shared
// composition / assets / layers / items spine so the root reads top-to-bottom
// as a table of contents.
//
// Behaviors are exercised in precompile.test.ts ($ref-importing $behavior
// blocks). They are deliberately NOT used in this rewrite: behaviors emit
// tween ids of the form `${parentId}__${suffix}` (double underscore), which
// can't reproduce the original's hand-authored single-underscore ids
// (`tw_4_title_transform_opacity`). Folding them in here would force a
// relaxed assertion and hide regressions in the resolver.
//
// We compare the *canonical* form (object structure, key order, value
// identity) — JSON.stringify with stable indentation makes the assertion
// literally byte-for-byte after re-serialization.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { precompile } from "../../src/compose/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../..");

const ORIGINAL = resolve(REPO, "examples/comprehensive-composition.json");
const SPLIT_ROOT = resolve(REPO, "examples/comprehensive-split/comprehensive.json");

describe("comprehensive composition — $ref split rewrite", () => {
  it("compiles byte-for-byte to the original v0.1 composition", async () => {
    const [originalRaw, splitRaw] = await Promise.all([
      readFile(ORIGINAL, "utf8"),
      readFile(SPLIT_ROOT, "utf8"),
    ]);

    const original = JSON.parse(originalRaw);
    const split = JSON.parse(splitRaw);

    const compiled = await precompile(split, { sourcePath: SPLIT_ROOT });

    // Canonical-form equality: same key order, same nested structure.
    // JSON.stringify with fixed indent gives a literal byte comparison.
    const expected = JSON.stringify(original, null, 2);
    const actual = JSON.stringify(compiled, null, 2);
    expect(actual).toBe(expected);
  });

  it("split root contains exactly the expected $ref fan-out (1 meta + 6 acts)", async () => {
    const splitRaw = await readFile(SPLIT_ROOT, "utf8");
    const split = JSON.parse(splitRaw) as {
      composition: { $ref: string };
      assets: { $ref: string };
      layers: { $ref: string };
      items: { $ref: string };
      tweens: Array<{ $ref: string }>;
    };

    // Spine pulled from meta.json via JSON-pointer slicing.
    expect(split.composition.$ref).toMatch(/meta\.json#\/composition$/);
    expect(split.assets.$ref).toMatch(/meta\.json#\/assets$/);
    expect(split.layers.$ref).toMatch(/meta\.json#\/layers$/);
    expect(split.items.$ref).toMatch(/meta\.json#\/items$/);

    // 6 act files spread into tweens via the array-spread $ref rule.
    expect(split.tweens).toHaveLength(6);
    const actRefs = split.tweens.map((t) => t.$ref);
    expect(actRefs).toEqual([
      "./acts/act-1-title.json",
      "./acts/act-2-shapes.json",
      "./acts/act-3-ball-bounce.json",
      "./acts/act-4-orbit.json",
      "./acts/act-5-glow.json",
      "./acts/act-6-outro.json",
    ]);
  });

  it("each act file is a flat tween array (so $ref array-spread applies)", async () => {
    const acts = [
      "act-1-title.json",
      "act-2-shapes.json",
      "act-3-ball-bounce.json",
      "act-4-orbit.json",
      "act-5-glow.json",
      "act-6-outro.json",
    ];
    let total = 0;
    for (const name of acts) {
      const raw = await readFile(
        resolve(REPO, "examples/comprehensive-split/acts", name),
        "utf8",
      );
      const parsed = JSON.parse(raw) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      total += (parsed as unknown[]).length;
    }
    // Sum across the 6 acts must equal the original tween count.
    const originalRaw = await readFile(ORIGINAL, "utf8");
    const original = JSON.parse(originalRaw) as { tweens: unknown[] };
    expect(total).toBe(original.tweens.length);
  });
});

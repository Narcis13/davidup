// Determinism harness — golden frame hashes (v1 plan Session 23 item 1, R-16).
//
// For each example in `support/examples.ts`, render raw RGBA frames at
// ~10%/50%/90% of the composition's duration through the real node driver
// path (skia-canvas + real ffmpeg for any video pre-extraction) and hash
// each frame with sha256. Hashes are committed in `goldenFrames.json`; a
// mismatch here means either:
//
//   - an unintended regression in the engine/renderer/skia-canvas pipeline
//     (the bug this test exists to catch), or
//   - an intentional pixel-changing change (a new behavior, a fixed bug —
//     see Sessions 6/8 in v1_implementation_plan.md for precedent), in which
//     case regenerate the fixture with:
//
//       bun run scripts/regenerate-goldens.ts
//
//     and say so in the commit message / CHANGELOG, per the repo's standing
//     rule for pixel-changing renders.
//
// Deliberately hashes the pre-encode raw canvas buffer, not a decoded video
// frame — this isolates the claim under test (the engine + skia-canvas are
// deterministic) from libx264/container reproducibility, which is a
// different claim covered by bitexact.integration.test.ts.
//
// Font-registration caveat (BUGS.md R-32): re-rendering a composition whose
// custom font family is already registered in this process (skia-canvas's
// `FontLibrary` is a process-global registry) can shift pixel output. Two of
// these examples ("comprehensive" and "video-bg-text") share the
// "DavidupDisplay" family, so this file's hashes are only stable because (a)
// each example renders exactly once per `vitest run`, and (b) `GOLDEN_EXAMPLES`
// is iterated in the same fixed order every time — first-registration order
// is therefore repeatable. Don't reorder `GOLDEN_EXAMPLES` or add a second
// render of a font-bearing example to this file without accounting for that.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GOLDEN_EXAMPLES } from "./support/examples.js";
import { GOLDEN_FRACTIONS, renderFractionalFrameHashes } from "./support/renderSingleFrame.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "goldenFrames.json");

interface GoldenFile {
  fractions: readonly number[];
  examples: Record<string, string[]>;
}

async function loadGolden(): Promise<GoldenFile> {
  const text = await readFile(GOLDEN_PATH, "utf8");
  return JSON.parse(text) as GoldenFile;
}

describe("determinism — golden frame hashes", () => {
  it("golden fixture covers exactly the registered examples at the expected fractions", async () => {
    const golden = await loadGolden();
    expect(golden.fractions).toEqual(GOLDEN_FRACTIONS as unknown as number[]);
    expect(Object.keys(golden.examples).sort()).toEqual(
      GOLDEN_EXAMPLES.map((e) => e.name).sort(),
    );
  });

  for (const example of GOLDEN_EXAMPLES) {
    it(`matches the stored golden hashes — ${example.name}`, async () => {
      const golden = await loadGolden();
      const expected = golden.examples[example.name];
      expect(expected, `no golden entry for "${example.name}"`).toBeDefined();

      const comp = await example.build();
      const hashes = await renderFractionalFrameHashes(comp, GOLDEN_FRACTIONS);

      expect(
        hashes,
        `frame hashes changed for "${example.name}" — if this is an intentional ` +
          `pixel change, run \`bun run scripts/regenerate-goldens.ts\` and say so ` +
          `in the commit message`,
      ).toEqual(expected);
    });
  }
});

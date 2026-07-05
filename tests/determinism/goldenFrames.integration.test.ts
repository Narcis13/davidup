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
// Font-registration note (BUGS.md R-32, fixed Session 28): re-rendering a
// composition whose custom font family was already registered in this process
// (skia-canvas's `FontLibrary` is a process-global registry) used to shift
// pixel output, because `NodeAssetLoader` called `FontLibrary.use()` again
// every time regardless. Two of these examples ("comprehensive" and
// "video-bg-text") share the "DavidupDisplay" family and exercise exactly that
// path. `src/assets/node.ts` now skips re-registering an already-claimed
// (family, path) pair, so `GOLDEN_EXAMPLES`'s order (and rendering a
// font-bearing example more than once per process) no longer matters for
// hash stability — see the R-13/R-32 tests in `tests/assets/node.test.ts` and
// the same-process reproducibility test in `bitexact.integration.test.ts`.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GOLDEN_EXAMPLES } from "./support/examples.js";
import { GOLDEN_FRACTIONS, renderFractionalFrameHashes } from "./support/renderSingleFrame.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "goldenFrames.json");

// skia-canvas ships a prebuilt native binary per platform, and rasterization
// details (antialiasing coverage, font hinting) legitimately differ between
// them — so goldens are keyed by `${platform}-${arch}`. Determinism is a
// *per-platform* claim: the same platform must always produce the same
// pixels. A platform with no committed entry skips the hash comparison
// (add one via `bun run scripts/regenerate-goldens.ts` on that platform).
const PLATFORM_KEY = `${process.platform}-${process.arch}`;

interface GoldenPlatform {
  examples: Record<string, string[]>;
}

interface GoldenFile {
  fractions: readonly number[];
  platforms: Record<string, GoldenPlatform>;
}

async function loadGolden(): Promise<GoldenFile> {
  const text = await readFile(GOLDEN_PATH, "utf8");
  return JSON.parse(text) as GoldenFile;
}

describe("determinism — golden frame hashes", () => {
  it("golden fixture covers exactly the registered examples at the expected fractions", async () => {
    const golden = await loadGolden();
    expect(golden.fractions).toEqual(GOLDEN_FRACTIONS as unknown as number[]);
    expect(Object.keys(golden.platforms).length).toBeGreaterThan(0);
    for (const [key, platform] of Object.entries(golden.platforms)) {
      expect(
        Object.keys(platform.examples).sort(),
        `platform "${key}" must cover exactly the registered examples`,
      ).toEqual(GOLDEN_EXAMPLES.map((e) => e.name).sort());
    }
  });

  for (const example of GOLDEN_EXAMPLES) {
    it(`matches the stored golden hashes — ${example.name}`, async (ctx) => {
      const golden = await loadGolden();
      const platform = golden.platforms[PLATFORM_KEY];
      if (!platform) {
        console.warn(
          `[goldenFrames] no goldens for platform "${PLATFORM_KEY}" — ` +
            `run \`bun run scripts/regenerate-goldens.ts\` here to add them`,
        );
        ctx.skip();
        return;
      }
      const expected = platform.examples[example.name];
      expect(
        expected,
        `no golden entry for "${example.name}" on ${PLATFORM_KEY}`,
      ).toBeDefined();

      const comp = await example.build();
      const hashes = await renderFractionalFrameHashes(comp, GOLDEN_FRACTIONS);

      expect(
        hashes,
        `frame hashes changed for "${example.name}" on ${PLATFORM_KEY} — if this ` +
          `is an intentional pixel change, run \`bun run scripts/regenerate-goldens.ts\` ` +
          `and say so in the commit message`,
      ).toEqual(expected);
    });
  }
});

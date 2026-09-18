// Determinism harness — MP4 container byte-reproducibility (v1 plan Session
// 23 item 2, R-16).
//
// The review measured a 255-byte container variance between two renders of
// identical input (first diff at byte 612) and flagged the "byte-identical
// MP4" claim as unverified. `buildFfmpegArgs`/`buildMuxArgs` now pass
// `-fflags +bitexact` (+ `-flags:v`/`-flags:a +bitexact`) so the muxer omits
// wall-clock-derived `creation_time`/`modification_time` fields and the
// encoder-version tag strings that vary between runs. This test renders the
// same composition twice — once through the single-stage (silent, no audio)
// pipeline and once through the two-stage (audio mux) pipeline — and asserts
// the output files are byte-for-byte identical.
//
// The base cases here are deliberately font-free and image-free: repeatedly
// registering the same custom font family into skia-canvas's process-global
// `FontLibrary` across renders in one process was itself a source of
// non-determinism (R-32 — a font-bearing example rendered twice in one
// process produced different-sized MP4s). That's now fixed alongside R-13
// (Session 28, `src/assets/node.ts`): `NodeAssetLoader` skips re-registering a
// (family, path) pair the process already has, instead of calling
// `FontLibrary.use()` again every time. The font-bearing case below exercises
// exactly the scenario that used to fail — see also the pixel-level
// golden-frame hashes (goldenFrames.integration.test.ts), which no longer need
// to avoid a second same-process render of a font-bearing example either.

import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const FIXTURES = join(__dirname, "..", "drivers", "fixtures", "audio");
const MUSIC = join(FIXTURES, "tone-stereo.mp3");
const FONT = resolve(__dirname, "..", "..", "examples", "fonts", "BebasNeue-Regular.ttf");

function shapesOnlyComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 96,
      height: 64,
      fps: 12,
      duration: 0.5,
      background: "#101828",
    },
    assets: [],
    layers: [
      { id: "back", z: 0, opacity: 1, blendMode: "normal", items: ["box"] },
      { id: "fore", z: 1, opacity: 1, blendMode: "normal", items: ["circle"] },
    ],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 24,
        fillColor: "#ff8800",
        cornerRadius: 4,
        transform: {
          x: 20,
          y: 16,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      circle: {
        type: "shape",
        kind: "circle",
        width: 30,
        height: 30,
        fillColor: "#40c8ff",
        transform: {
          x: 64,
          y: 32,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
    },
    tweens: [
      {
        id: "spin",
        target: "box",
        property: "transform.rotation",
        from: 0,
        to: 180,
        start: 0,
        duration: 0.5,
        easing: "easeInOutQuad",
      },
    ],
  };
}

function shapesWithAudioComposition(): Composition {
  return {
    ...shapesOnlyComposition(),
    assets: [
      { id: "music", type: "audio", src: MUSIC, duration: 1, sampleRate: 44100, channels: 2 },
    ],
    audio: [{ id: "music-bed", asset: "music", start: 0, volume: 0.6 }],
  };
}

// R-32 repro: a custom-font text item, rendered twice in one process via two
// independent `renderToFile` calls (each spins up its own fresh
// `NodeAssetLoader` — the exact scenario that used to re-register the family
// and perturb pixel output the second time).
function shapesWithFontComposition(): Composition {
  return {
    ...shapesOnlyComposition(),
    assets: [{ id: "display-font", type: "font", src: FONT, family: "BitexactDisplay" }],
    items: {
      ...shapesOnlyComposition().items,
      label: {
        type: "text",
        text: "davidup",
        font: "display-font",
        fontSize: 18,
        color: "#ffffff",
        transform: {
          x: 8,
          y: 40,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    layers: [
      ...shapesOnlyComposition().layers,
      { id: "text", z: 2, opacity: 1, blendMode: "normal", items: ["label"] },
    ],
  };
}

describe("determinism — MP4 container bitexact reproducibility", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("produces byte-identical output across two renders — single-stage (no audio)", async () => {
    dir = await mkdtemp(join(tmpdir(), "davidup-bitexact-"));
    const outA = join(dir, "a.mp4");
    const outB = join(dir, "b.mp4");

    await renderToFile(shapesOnlyComposition(), outA);
    await renderToFile(shapesOnlyComposition(), outB);

    const [a, b] = await Promise.all([readFile(outA), readFile(outB)]);
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });

  it("produces byte-identical output across two renders — two-stage (audio mux)", async () => {
    dir = await mkdtemp(join(tmpdir(), "davidup-bitexact-audio-"));
    const outA = join(dir, "a.mp4");
    const outB = join(dir, "b.mp4");

    await renderToFile(shapesWithAudioComposition(), outA);
    await renderToFile(shapesWithAudioComposition(), outB);

    const [a, b] = await Promise.all([readFile(outA), readFile(outB)]);
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });

  // R-13 / R-32 (Session 28): each `renderToFile` call below spins up its own
  // fresh `NodeAssetLoader`, so before the fix the second render re-registered
  // "BitexactDisplay" into skia's process-global `FontLibrary` and produced a
  // different-sized MP4 than the first. Skipping the redundant registration
  // makes this reproducible.
  it("produces byte-identical output across two renders — custom font, same process", async () => {
    dir = await mkdtemp(join(tmpdir(), "davidup-bitexact-font-"));
    const outA = join(dir, "a.mp4");
    const outB = join(dir, "b.mp4");

    await renderToFile(shapesWithFontComposition(), outA);
    await renderToFile(shapesWithFontComposition(), outB);

    const [a, b] = await Promise.all([readFile(outA), readFile(outB)]);
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });
});

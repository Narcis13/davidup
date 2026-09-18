// Sample composition — picture-in-picture (v0.2 S10).
//
// Two independent video items rendered simultaneously: a looping full-frame
// background clip and a smaller "inset" clip layered on top inside a white
// frame border. Exercises: multiple `video` items in one composition, `loop`,
// `fit: "cover"`, and z-ordered layering over video content.
//
// Reuses the committed real-ffmpeg fixtures under
// tests/drivers/fixtures/video/ so this example (and the integration test
// that renders it) needs no extra binary assets.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../../tests/drivers/fixtures/video");

// 320×240 testsrc2 pattern, 1s @ 30fps — colorful, good full-frame background.
export const BACKGROUND_CLIP = resolve(FIXTURES, "small.mp4");
// 128×72 solid navy, 61s @ 10fps — long enough to pick an arbitrary 2s window
// for the inset clip.
export const INSET_CLIP = resolve(FIXTURES, "long.mp4");

export function buildVideoPipComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 320,
      height: 240,
      fps: 10,
      duration: 2,
      background: "#000000",
    },
    assets: [
      {
        id: "bg-clip",
        type: "video",
        src: BACKGROUND_CLIP,
        duration: 1,
        width: 320,
        height: 240,
        fps: 30,
      },
      {
        id: "pip-clip",
        type: "video",
        src: INSET_CLIP,
        duration: 61,
        width: 128,
        height: 72,
        fps: 10,
      },
    ],
    layers: [
      { id: "background", z: 0, opacity: 1, blendMode: "normal", items: ["bg"] },
      { id: "frame", z: 1, opacity: 1, blendMode: "normal", items: ["pip-frame"] },
      { id: "pip", z: 2, opacity: 1, blendMode: "normal", items: ["pip"] },
    ],
    items: {
      // Full-frame background: `small.mp4` only has 1s of content but the
      // composition runs 2s, so `loop: true` wraps it seamlessly instead of
      // freezing — the "loop" side of picture-in-picture.
      bg: {
        type: "video",
        asset: "bg-clip",
        width: 320,
        height: 240,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: "cover",
        loop: true,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      // White frame border, 3px larger than the inset box on every side —
      // sits between the background and the inset clip in z-order.
      "pip-frame": {
        type: "shape",
        kind: "rect",
        width: 118,
        height: 69,
        fillColor: "#ffffff",
        cornerRadius: 4,
        transform: {
          x: 197,
          y: 9,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      // Inset clip: a 2s window trimmed from `long.mp4`, matching the
      // composition duration exactly — no freeze needed here.
      pip: {
        type: "video",
        asset: "pip-clip",
        width: 112,
        height: 63,
        start: 0,
        trimIn: 5,
        trimOut: 7,
        fit: "cover",
        loop: false,
        transform: {
          x: 200,
          y: 12,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

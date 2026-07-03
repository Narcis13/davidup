// Sample composition — trimmed clip with freeze frame (v0.2 S10).
//
// A video item trimmed to a 1s window (`trimIn`/`trimOut`) with no explicit
// `end`, placed inside a 3s composition. Once the trimmed content is
// exhausted (after 1s / 10 encoded frames), the engine freezes on the last
// extracted frame for the remaining 2s — the edge case called out in
// v0.2-plan.md S10 ("video cu freeze la final").

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIP = resolve(HERE, "../../tests/drivers/fixtures/video/long.mp4");

export function buildVideoFreezeTrimComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 200,
      height: 112,
      fps: 10,
      duration: 3,
      background: "#000000",
    },
    assets: [
      {
        id: "clip",
        type: "video",
        src: CLIP,
        duration: 61,
        width: 128,
        height: 72,
        fps: 10,
      },
    ],
    layers: [
      { id: "video-layer", z: 0, opacity: 1, blendMode: "normal", items: ["clip"] },
    ],
    items: {
      clip: {
        type: "video",
        asset: "clip",
        width: 200,
        height: 112,
        start: 0,
        trimIn: 20,
        trimOut: 21,
        fit: "cover",
        loop: false,
        // No `end`: the item stays visible for the whole composition, so the
        // trimmed 1s of content freezes on its last frame for the final 2s.
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
    },
    tweens: [],
  };
}

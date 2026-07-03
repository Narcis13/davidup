// Sample composition — video background + tweened text overlay (v0.2 S10).
//
// A full-frame video item plays underneath a text item that fades in and
// slides up shortly after the clip starts. Exercises: a `video` item as the
// bottom layer, a `text` item layered above it, and tweens on a non-video
// item coexisting with video playback.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKGROUND_CLIP = resolve(
  HERE,
  "../../tests/drivers/fixtures/video/long.mp4",
);
// Committed alongside the other font-using examples (ball-showcase-60s,
// comprehensive-composition.json) — no extra asset needed.
const CAPTION_FONT = resolve(HERE, "../fonts/BebasNeue-Regular.ttf");

export function buildVideoBgTextComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      // libx264 requires even dimensions for yuv420p — 224, not the exact
      // 16:9 225, keeps the encoder happy.
      width: 400,
      height: 224,
      fps: 10,
      duration: 2,
      background: "#000000",
    },
    assets: [
      {
        id: "bg-clip",
        type: "video",
        src: BACKGROUND_CLIP,
        duration: 61,
        width: 128,
        height: 72,
        fps: 10,
      },
      {
        id: "caption-font",
        type: "font",
        src: CAPTION_FONT,
        family: "DavidupDisplay",
      },
    ],
    layers: [
      { id: "background", z: 0, opacity: 1, blendMode: "normal", items: ["bg"] },
      { id: "caption-layer", z: 1, opacity: 1, blendMode: "normal", items: ["caption"] },
    ],
    items: {
      // A 2s window trimmed out of the 61s fixture, matching the composition
      // duration exactly — plays start-to-end with no freeze.
      bg: {
        type: "video",
        asset: "bg-clip",
        width: 400,
        height: 224,
        start: 0,
        trimIn: 10,
        trimOut: 12,
        fit: "cover",
        loop: false,
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
      caption: {
        type: "text",
        text: "Now Playing",
        font: "caption-font",
        fontSize: 32,
        color: "#ffffff",
        align: "center",
        transform: {
          x: 200,
          y: 210,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        id: "caption-fade-in",
        target: "caption",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0.3,
        duration: 0.6,
        easing: "easeOutQuad",
      },
      {
        id: "caption-slide-up",
        target: "caption",
        property: "transform.y",
        from: 210,
        to: 180,
        start: 0.3,
        duration: 0.6,
        easing: "easeOutBack",
      },
    ],
  };
}

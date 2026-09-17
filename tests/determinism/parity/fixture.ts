// Shared "shapes + text, no raster/video assets" composition for the
// node↔browser pixel-parity test (v1 plan Session 23 item 3). Kept
// deliberately simple and axis-aligned (no rotation) — the point is to catch
// cross-driver rendering divergence (paint order, blend math, transform
// math), not to chase anti-aliasing agreement on rotated/curved edges between
// two different Skia embeddings.

import type { Composition } from "../../../src/schema/types.js";

export const PARITY_FONT_FAMILY = "DavidupParityFont";

/**
 * @param fontSrc Filesystem path (node) or a `url()`-safe string — typically
 *   a `data:` URI (browser) — for the embedded font asset's `src`.
 */
export function buildParityComposition(fontSrc: string): Composition {
  return {
    version: "0.1",
    composition: {
      width: 240,
      height: 135,
      fps: 10,
      duration: 1,
      background: "#0c1220",
    },
    assets: [
      {
        id: "parity-font",
        type: "font",
        src: fontSrc,
        family: PARITY_FONT_FAMILY,
      },
    ],
    layers: [
      { id: "back", z: 0, opacity: 1, blendMode: "normal", items: ["panel"] },
      { id: "fore", z: 1, opacity: 1, blendMode: "normal", items: ["badge", "label", "wrapped"] },
    ],
    items: {
      panel: {
        type: "shape",
        kind: "rect",
        width: 240,
        height: 135,
        fillColor: "#0c1220",
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
      badge: {
        type: "shape",
        kind: "rect",
        width: 96,
        height: 40,
        fillColor: "#ff8800",
        cornerRadius: 8,
        transform: {
          x: 20,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 0.85,
        },
      },
      label: {
        type: "text",
        text: "DAVIDUP",
        font: PARITY_FONT_FAMILY,
        fontSize: 32,
        color: "#ffffff",
        align: "left",
        transform: {
          x: 20,
          y: 90,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      // Text v2 (v1.1 S13): box mode — word-wrapped, centred, anchored on
      // its measured block, with stroke and shadow. The wrap width leaves
      // slack on both lines so small metric differences between the two
      // Skia embeddings don't move a break.
      wrapped: {
        type: "text",
        text: "SHIP FAST BREAK NOTHING",
        font: PARITY_FONT_FAMILY,
        fontSize: 20,
        color: "#ffd166",
        align: "center",
        maxWidth: 110,
        lineHeight: 1.1,
        strokeColor: "#1b2a4a",
        strokeWidth: 2,
        shadow: { color: "rgba(0, 0, 0, 0.6)", blur: 3, offsetX: 1, offsetY: 2 },
        transform: {
          x: 180,
          y: 70,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

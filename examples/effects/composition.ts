// Sample composition — per-item effects (v1.1 S21).
//
// A focus pull, a floating card and a glowing title on one dark frame:
//   - `lens`   — a circle whose `blur` radius tweens 10 → 0 (focus pull)
//   - `card`   — a group (rect + label) casting one soft drop shadow, whose
//                offset tweens so the card appears to lift; being a group,
//                it flattens first, so the shadow is the card's silhouette
//   - `title`  — text with two stacked glows (they compound) and a pulsing
//                inner glow radius
//   - `badge`  — blur then shadow in one stack: the shadow is cast by the
//                already-blurred shape
// Every effect parameter here is tweened through `effects.<index>.<field>`.
//
// Used by the golden-frame test (tests/determinism/support/examples.ts), so a
// change to any effect's pixels shows up as a golden diff.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT = resolve(HERE, "../fonts/BebasNeue-Regular.ttf");

const t = (x: number, y: number, anchorX = 0, anchorY = 0, opacity = 1) => ({
  x,
  y,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX,
  anchorY,
  opacity,
});

export function buildEffectsComposition(): Composition {
  return {
    version: "0.1",
    composition: { width: 480, height: 270, fps: 24, duration: 2, background: "#0e1220" },
    assets: [{ id: "font-display", type: "font", src: FONT, family: "Bebas Neue" }],
    layers: [
      { id: "back", z: 0, opacity: 1, blendMode: "normal", items: ["lens"] },
      { id: "fore", z: 1, opacity: 1, blendMode: "normal", items: ["card", "badge", "title"] },
    ],
    items: {
      lens: {
        type: "shape",
        kind: "circle",
        width: 110,
        fillColor: "#ff5a5f",
        effects: [{ type: "blur", radius: 10 }],
        transform: t(80, 135, 0.5, 0.5),
      },
      card: {
        type: "group",
        items: ["card__panel", "card__label"],
        effects: [{ type: "shadow", color: "rgba(0, 0, 0, 0.6)", blur: 18, offsetX: 0, offsetY: 2 }],
        transform: t(170, 60),
      },
      card__panel: {
        type: "shape",
        kind: "rect",
        width: 150,
        height: 90,
        cornerRadius: 12,
        fillColor: "#f4f1ea",
        transform: t(0, 0),
      },
      card__label: {
        type: "text",
        text: "LIFTED",
        font: "font-display",
        fontSize: 34,
        color: "#1b2a4a",
        align: "center",
        transform: t(75, 58),
      },
      badge: {
        type: "shape",
        kind: "rect",
        width: 70,
        height: 70,
        cornerRadius: 8,
        fillColor: "#ffd166",
        effects: [
          { type: "blur", radius: 2 },
          { type: "shadow", color: "#40c8ff", blur: 6, offsetX: 6, offsetY: 6 },
        ],
        transform: t(375, 60),
      },
      title: {
        type: "text",
        text: "GLOW UP",
        font: "font-display",
        fontSize: 56,
        color: "#ffffff",
        align: "center",
        effects: [
          { type: "glow", color: "#40c8ff", radius: 4 },
          { type: "glow", color: "#5b7cfa", radius: 12 },
        ],
        transform: t(300, 235),
      },
    },
    tweens: [
      {
        id: "lens-focus",
        target: "lens",
        property: "effects.0.radius",
        from: 10,
        to: 0,
        start: 0,
        duration: 1.5,
        easing: "easeInOutQuad",
      },
      {
        id: "card-lift",
        target: "card",
        property: "effects.0.offsetY",
        from: 2,
        to: 14,
        start: 0,
        duration: 2,
        easing: "easeOutCubic",
      },
      {
        id: "card-lift-y",
        target: "card",
        property: "transform.y",
        from: 60,
        to: 50,
        start: 0,
        duration: 2,
        easing: "easeOutCubic",
      },
      {
        id: "title-pulse",
        target: "title",
        property: "effects.0.radius",
        from: 2,
        to: 8,
        start: 0,
        duration: 2,
        easing: "easeInOutSine",
      },
      {
        id: "title-glow-color",
        target: "title",
        property: "effects.1.color",
        from: "#5b7cfa",
        to: "#ff5a5f",
        start: 0.5,
        duration: 1.5,
        easing: "linear",
      },
    ],
  };
}

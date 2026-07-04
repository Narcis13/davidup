// Example registry for the golden-frame determinism tests (Session 23).
// Each entry builds a real `Composition` — same builders/fixtures the S10
// video sample integration tests and the flagship `comprehensive` render
// script already use — so a golden-hash regression always points at a
// composition someone can `bun run` and eyeball.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "../../../src/schema/types.js";
import { buildVideoBgTextComposition } from "../../../examples/video-bg-text/composition.js";
import { buildVideoFreezeTrimComposition } from "../../../examples/video-freeze-trim/composition.js";
import { buildVideoPipComposition } from "../../../examples/video-pip/composition.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_ROOT = resolve(HERE, "../../../examples");

function shapesAndTweensComposition(): Composition {
  // Asset-free: shapes + color/number tweens + easings + a group, so the
  // resolver/engine/color paths are exercised without touching fonts or
  // images (keeps this example maximally deterministic across machines).
  return {
    version: "0.1",
    composition: {
      width: 320,
      height: 180,
      fps: 24,
      duration: 4,
      background: "#0a0a12",
    },
    assets: [],
    layers: [
      { id: "back", z: 0, opacity: 1, blendMode: "normal", items: ["panel"] },
      { id: "fore", z: 1, opacity: 1, blendMode: "normal", items: ["cluster"] },
    ],
    items: {
      panel: {
        type: "shape",
        kind: "rect",
        width: 320,
        height: 180,
        fillColor: "#141428",
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
      cluster: {
        type: "group",
        items: ["cluster__ball", "cluster__ring", "cluster__tri"],
        transform: {
          x: 160,
          y: 90,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
      cluster__ball: {
        type: "shape",
        kind: "circle",
        width: 60,
        height: 60,
        fillColor: "#ff5040",
        transform: {
          x: -60,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
      cluster__ring: {
        type: "shape",
        kind: "circle",
        width: 50,
        height: 50,
        strokeColor: "#40c8ff",
        strokeWidth: 6,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
      cluster__tri: {
        type: "shape",
        kind: "polygon",
        points: [
          [0, -30],
          [26, 15],
          [-26, 15],
        ],
        fillColor: "#ffd400",
        cornerRadius: 2,
        transform: {
          x: 60,
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
    tweens: [
      {
        id: "ball-x",
        target: "cluster__ball",
        property: "transform.x",
        from: -140,
        to: -60,
        start: 0,
        duration: 2,
        easing: "easeOutBack",
      },
      {
        id: "ball-color",
        target: "cluster__ball",
        property: "fillColor",
        from: "#ff5040",
        to: "#40ff90",
        start: 0.5,
        duration: 1.5,
        easing: "easeInOutQuad",
      },
      {
        id: "ring-rotation",
        target: "cluster__ring",
        property: "transform.rotation",
        from: 0,
        to: 720,
        start: 0,
        duration: 4,
        easing: "linear",
      },
      {
        id: "tri-opacity",
        target: "cluster__tri",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0.2,
        duration: 0.8,
        easing: "easeOutQuad",
      },
      {
        id: "cluster-scale",
        target: "cluster",
        property: "transform.scaleX",
        from: 0.6,
        to: 1,
        start: 1,
        duration: 2,
        easing: "easeInOutBack",
      },
    ],
  };
}

async function comprehensiveComposition(): Promise<Composition> {
  const jsonPath = resolve(EXAMPLES_ROOT, "comprehensive-composition.json");
  const text = await readFile(jsonPath, "utf8");
  const json = JSON.parse(text) as Composition;
  const assetPaths: Record<string, string> = {
    ball: resolve(EXAMPLES_ROOT, "ball.png"),
    "font-display": resolve(EXAMPLES_ROOT, "fonts", "BebasNeue-Regular.ttf"),
    "font-mono": resolve(EXAMPLES_ROOT, "fonts", "JetBrainsMono-Bold.ttf"),
  };
  for (const asset of json.assets) {
    const abs = assetPaths[asset.id];
    if (abs) asset.src = abs;
  }
  return json;
}

export interface GoldenExample {
  name: string;
  build: () => Composition | Promise<Composition>;
}

export const GOLDEN_EXAMPLES: readonly GoldenExample[] = [
  { name: "shapes-tweens", build: shapesAndTweensComposition },
  { name: "comprehensive", build: comprehensiveComposition },
  { name: "video-pip", build: buildVideoPipComposition },
  { name: "video-bg-text", build: buildVideoBgTextComposition },
  { name: "video-freeze-trim", build: buildVideoFreezeTrimComposition },
];

/**
 * Shared composition builder for the comprehensive 20s demo.
 *
 * The same Composition runs on both hosts — node renders to MP4 via
 * skia-canvas + ffmpeg, browser previews via Canvas2D + RAF — so the only
 * thing that varies between environments is *where the asset bytes live*:
 *
 *   - Node:    file system paths (skia-canvas's loadImage / FontLibrary.use
 *              both want local paths).
 *   - Browser: URLs the dev server can serve (Image() + FontFace API both
 *              want URLs).
 *
 * `buildCompositionAndCoverage` takes those three strings and returns the
 * fully-assembled Composition plus the easing-coverage set so the caller
 * can self-verify it touched every named easing in the v0.1 table.
 */

import type {
  Asset,
  Composition,
  Item,
  Layer,
  Tween,
} from "../src/schema/types.js";
import type { EasingName } from "../src/easings/names.js";

export interface AssetSources {
  /** URL or filesystem path for the ball.png sprite. */
  ball: string;
  /** URL or filesystem path for the display TTF (Bebas Neue). */
  fontDisplay: string;
  /** URL or filesystem path for the mono TTF (JetBrains Mono Bold). */
  fontMono: string;
}

export interface BuiltComposition {
  composition: Composition;
  /** Set of easing names actually referenced in the tween list. */
  usedEasings: ReadonlySet<EasingName>;
}

const W = 1280;
const H = 720;
const FPS = 60;
const DURATION = 20.0;

export function buildCompositionAndCoverage(srcs: AssetSources): BuiltComposition {
  const items: Record<string, Item> = {};
  const layers: Layer[] = [];
  const tweens: Tween[] = [];

  let tweenSeq = 0;
  const usedEasings = new Set<EasingName>();
  const tw = (t: {
    target: string;
    property: string;
    from: number | string;
    to: number | string;
    start: number;
    duration: number;
    easing: EasingName;
  }): void => {
    usedEasings.add(t.easing);
    tweens.push({
      id: `tw_${tweenSeq++}_${t.target}_${t.property.replace(/\./g, "_")}`,
      ...t,
    });
  };

  // ── Assets ──────────────────────────────────────────────────────────────
  const assets: Asset[] = [
    { id: "ball", type: "image", src: srcs.ball },
    { id: "font-display", type: "font", src: srcs.fontDisplay, family: "MotionForgeDisplay" },
    { id: "font-mono", type: "font", src: srcs.fontMono, family: "MotionForgeMono" },
  ];

  // ── Items ───────────────────────────────────────────────────────────────
  items["bg"] = {
    type: "shape",
    kind: "rect",
    width: W,
    height: H,
    fillColor: "#05060e",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
  };

  items["card"] = {
    type: "shape",
    kind: "rect",
    width: 0,
    height: 360,
    cornerRadius: 0,
    fillColor: "rgba(255,255,255,0.06)",
    strokeColor: "#ffd166",
    strokeWidth: 0,
    transform: { x: W / 2, y: H / 2 + 40, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["title"] = {
    type: "text",
    text: "MotionForge",
    font: "font-display",
    fontSize: 110,
    color: "#ff6b35",
    align: "center",
    transform: { x: W / 2, y: H / 2 - 20, scaleX: 0.2, scaleY: 0.2, rotation: 0, anchorX: 0, anchorY: 0, opacity: 0 },
  };

  items["subtitle"] = {
    type: "text",
    text: "Comprehensive Feature Demo",
    font: "font-mono",
    fontSize: 32,
    color: "#9aa5d6",
    align: "center",
    transform: { x: W / 2, y: H / 2 + 60, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 0 },
  };

  items["circle"] = {
    type: "shape",
    kind: "circle",
    width: 220,
    fillColor: "#118ab2",
    strokeColor: "#ffffff",
    strokeWidth: 0,
    transform: { x: 320, y: H / 2 + 40, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["triangle"] = {
    type: "shape",
    kind: "polygon",
    points: [
      [0, -110],
      [95, 60],
      [-95, 60],
    ],
    fillColor: "#06d6a0",
    strokeColor: "#0a0e27",
    strokeWidth: 6,
    transform: { x: W / 2, y: H / 2 + 40, scaleX: 0.5, scaleY: 0.5, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["star"] = {
    type: "shape",
    kind: "polygon",
    points: starPoints(110, 50, 5),
    fillColor: "#ffd166",
    strokeColor: "#ef476f",
    strokeWidth: 4,
    transform: { x: W - 320, y: H / 2 + 40, scaleX: 0.6, scaleY: 0.6, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["ball"] = {
    type: "sprite",
    asset: "ball",
    width: 200,
    height: 200,
    transform: { x: -150, y: 260, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["orbit-a"] = {
    type: "shape",
    kind: "circle",
    width: 80,
    fillColor: "#ef476f",
    transform: { x: -200, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
  };
  items["orbit-b"] = {
    type: "shape",
    kind: "circle",
    width: 80,
    fillColor: "#06d6a0",
    transform: { x: 100, y: 173, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
  };
  items["orbit-c"] = {
    type: "shape",
    kind: "circle",
    width: 80,
    fillColor: "#ffd166",
    transform: { x: 100, y: -173, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
  };
  items["orbit"] = {
    type: "group",
    items: ["orbit-a", "orbit-b", "orbit-c"],
    transform: { x: W / 2, y: H / 2, scaleX: 0.7, scaleY: 0.7, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["glow"] = {
    type: "shape",
    kind: "circle",
    width: 360,
    fillColor: "#ff6b35",
    transform: { x: W / 2, y: H / 2, scaleX: 0.5, scaleY: 0.5, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0 },
  };

  items["footer"] = {
    type: "text",
    text: "20s · 1280x720 · 60fps · 19 easings · 4 item types",
    font: "font-mono",
    fontSize: 22,
    color: "#888888",
    align: "center",
    transform: { x: W / 2, y: H - 48, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 0 },
  };

  // ── Layers (z order: bg → card → shapes → ball → orbit → glow(screen) → text) ──
  layers.push(
    { id: "bg-layer", z: 0, opacity: 1, blendMode: "normal", items: ["bg"] },
    { id: "card-layer", z: 5, opacity: 1, blendMode: "normal", items: ["card"] },
    { id: "shapes-layer", z: 10, opacity: 1, blendMode: "normal", items: ["circle", "triangle", "star"] },
    { id: "ball-layer", z: 15, opacity: 1, blendMode: "normal", items: ["ball"] },
    { id: "orbit-layer", z: 20, opacity: 1, blendMode: "normal", items: ["orbit"] },
    { id: "glow-layer", z: 25, opacity: 0.9, blendMode: "screen", items: ["glow"] },
    { id: "text-layer", z: 30, opacity: 1, blendMode: "normal", items: ["title", "subtitle", "footer"] },
  );

  // ── Tweens ──────────────────────────────────────────────────────────────
  // Background colour breathes across the whole clip.
  tw({ target: "bg", property: "fillColor", from: "#05060e", to: "#0a0e27", start: 0.0, duration: 1.5, easing: "easeOutCubic" });
  tw({ target: "bg", property: "fillColor", from: "#0a0e27", to: "#1a1244", start: 6.0, duration: 4.0, easing: "easeInOutSine" });
  tw({ target: "bg", property: "fillColor", from: "#1a1244", to: "#0a0e27", start: 12.0, duration: 4.0, easing: "easeInOutQuart" });
  tw({ target: "bg", property: "fillColor", from: "#0a0e27", to: "#000000", start: 18.5, duration: 1.5, easing: "easeInQuad" });

  // Act 1 — title intro.
  tw({ target: "title", property: "transform.opacity", from: 0, to: 1, start: 0.2, duration: 1.0, easing: "easeOutQuad" });
  tw({ target: "title", property: "transform.scaleX", from: 0.2, to: 1.0, start: 0.2, duration: 1.4, easing: "easeOutBack" });
  tw({ target: "title", property: "transform.scaleY", from: 0.2, to: 1.0, start: 0.2, duration: 1.4, easing: "easeInOutBack" });
  tw({ target: "title", property: "color", from: "#ff6b35", to: "#ffd166", start: 1.6, duration: 1.8, easing: "linear" });
  tw({ target: "title", property: "fontSize", from: 110, to: 128, start: 1.6, duration: 1.8, easing: "easeInOutCubic" });

  tw({ target: "subtitle", property: "transform.opacity", from: 0, to: 1, start: 1.4, duration: 0.9, easing: "easeOutSine" });
  tw({ target: "subtitle", property: "transform.y", from: H / 2 + 100, to: H / 2 + 60, start: 1.4, duration: 0.9, easing: "easeOutCubic" });

  tw({ target: "card", property: "transform.opacity", from: 0, to: 1, start: 0.6, duration: 1.4, easing: "easeOutQuart" });
  tw({ target: "card", property: "width", from: 0, to: 1080, start: 0.6, duration: 1.4, easing: "easeOutBack" });
  tw({ target: "card", property: "cornerRadius", from: 0, to: 36, start: 0.6, duration: 1.4, easing: "easeOutQuad" });
  tw({ target: "card", property: "strokeWidth", from: 0, to: 4, start: 1.2, duration: 1.0, easing: "easeOutQuad" });

  // Act 2 transition — title shrinks up, card/subtitle exit.
  tw({ target: "title", property: "transform.y", from: H / 2 - 20, to: 90, start: 4.0, duration: 0.8, easing: "easeInOutQuart" });
  tw({ target: "title", property: "transform.scaleX", from: 1.0, to: 0.55, start: 4.0, duration: 0.8, easing: "easeInOutCubic" });
  tw({ target: "title", property: "transform.scaleY", from: 1.0, to: 0.55, start: 4.0, duration: 0.8, easing: "easeInOutCubic" });
  tw({ target: "subtitle", property: "transform.opacity", from: 1, to: 0, start: 4.0, duration: 0.5, easing: "easeInQuad" });
  tw({ target: "card", property: "transform.opacity", from: 1, to: 0, start: 4.0, duration: 0.7, easing: "easeInOutQuad" });
  tw({ target: "card", property: "cornerRadius", from: 36, to: 180, start: 4.0, duration: 0.7, easing: "easeInOutSine" });

  // Act 2 — circle / triangle / star.
  tw({ target: "circle", property: "transform.opacity", from: 0, to: 1, start: 4.5, duration: 0.6, easing: "easeOutQuad" });
  tw({ target: "circle", property: "strokeWidth", from: 0, to: 14, start: 4.5, duration: 1.5, easing: "easeOutCubic" });
  tw({ target: "circle", property: "fillColor", from: "#118ab2", to: "#ef476f", start: 5.0, duration: 2.5, easing: "linear" });
  tw({ target: "circle", property: "strokeColor", from: "#ffffff", to: "#06d6a0", start: 5.0, duration: 2.5, easing: "easeInOutQuad" });
  tw({ target: "circle", property: "transform.rotation", from: 0, to: Math.PI, start: 5.0, duration: 2.5, easing: "easeInOutQuad" });
  tw({ target: "circle", property: "transform.anchorX", from: 0.5, to: 0.4, start: 5.5, duration: 0.7, easing: "easeInOutSine" });
  tw({ target: "circle", property: "transform.anchorX", from: 0.4, to: 0.5, start: 6.5, duration: 0.7, easing: "easeInOutSine" });

  tw({ target: "triangle", property: "transform.opacity", from: 0, to: 1, start: 4.7, duration: 0.6, easing: "easeOutQuad" });
  tw({ target: "triangle", property: "transform.scaleX", from: 0.5, to: 1.2, start: 4.7, duration: 1.2, easing: "easeOutBack" });
  tw({ target: "triangle", property: "transform.scaleY", from: 0.5, to: 1.2, start: 4.7, duration: 1.2, easing: "easeOutBack" });
  tw({ target: "triangle", property: "transform.rotation", from: 0, to: Math.PI * 2, start: 5.0, duration: 2.5, easing: "easeInOutCubic" });
  tw({ target: "triangle", property: "fillColor", from: "#06d6a0", to: "#ffd166", start: 5.5, duration: 2.0, easing: "linear" });

  tw({ target: "star", property: "transform.opacity", from: 0, to: 1, start: 4.9, duration: 0.6, easing: "easeOutQuad" });
  tw({ target: "star", property: "transform.scaleX", from: 0.6, to: 1.3, start: 5.2, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "star", property: "transform.scaleX", from: 1.3, to: 0.95, start: 6.2, duration: 0.7, easing: "easeInOutQuad" });
  tw({ target: "star", property: "transform.scaleY", from: 0.6, to: 1.3, start: 5.2, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "star", property: "transform.scaleY", from: 1.3, to: 0.95, start: 6.2, duration: 0.7, easing: "easeInOutQuad" });
  tw({ target: "star", property: "transform.rotation", from: 0, to: -Math.PI, start: 5.2, duration: 2.6, easing: "easeInOutSine" });
  tw({ target: "star", property: "fillColor", from: "#ffd166", to: "#ef476f", start: 5.8, duration: 1.7, easing: "linear" });

  tw({ target: "circle", property: "transform.opacity", from: 1, to: 0, start: 7.6, duration: 0.4, easing: "easeInQuad" });
  tw({ target: "triangle", property: "transform.opacity", from: 1, to: 0, start: 7.6, duration: 0.4, easing: "easeInExpo" });
  tw({ target: "star", property: "transform.opacity", from: 1, to: 0, start: 7.6, duration: 0.4, easing: "easeInQuart" });

  // Act 3 — bouncing ball sprite.
  tw({ target: "ball", property: "transform.opacity", from: 0, to: 1, start: 8.0, duration: 0.4, easing: "easeOutExpo" });
  tw({ target: "ball", property: "transform.x", from: -150, to: W + 150, start: 8.0, duration: 4.0, easing: "easeInOutExpo" });
  tw({ target: "ball", property: "transform.rotation", from: 0, to: Math.PI * 6, start: 8.0, duration: 4.0, easing: "linear" });
  tw({ target: "ball", property: "transform.y", from: 260, to: 540, start: 8.0, duration: 0.5, easing: "easeInQuad" });
  tw({ target: "ball", property: "transform.y", from: 540, to: 320, start: 8.5, duration: 0.5, easing: "easeOutQuad" });
  tw({ target: "ball", property: "transform.y", from: 320, to: 540, start: 9.0, duration: 0.5, easing: "easeInCubic" });
  tw({ target: "ball", property: "transform.y", from: 540, to: 360, start: 9.5, duration: 0.5, easing: "easeOutCubic" });
  tw({ target: "ball", property: "transform.y", from: 360, to: 540, start: 10.0, duration: 0.5, easing: "easeInQuart" });
  tw({ target: "ball", property: "transform.y", from: 540, to: 410, start: 10.5, duration: 0.5, easing: "easeOutQuart" });
  tw({ target: "ball", property: "transform.y", from: 410, to: 540, start: 11.0, duration: 0.5, easing: "easeInSine" });
  tw({ target: "ball", property: "width", from: 200, to: 240, start: 9.0, duration: 0.5, easing: "easeOutBack" });
  tw({ target: "ball", property: "width", from: 240, to: 200, start: 9.5, duration: 0.5, easing: "easeInBack" });
  tw({ target: "ball", property: "height", from: 200, to: 170, start: 9.0, duration: 0.5, easing: "easeOutBack" });
  tw({ target: "ball", property: "height", from: 170, to: 200, start: 9.5, duration: 0.5, easing: "easeInBack" });
  tw({ target: "ball", property: "transform.anchorY", from: 0.5, to: 0.4, start: 10.0, duration: 0.5, easing: "easeOutSine" });
  tw({ target: "ball", property: "transform.anchorY", from: 0.4, to: 0.5, start: 10.5, duration: 0.5, easing: "easeInOutSine" });
  tw({ target: "ball", property: "transform.opacity", from: 1, to: 0, start: 11.5, duration: 0.5, easing: "easeInOutExpo" });

  // Act 4 — group + additive glow.
  tw({ target: "orbit", property: "transform.opacity", from: 0, to: 1, start: 12.0, duration: 0.7, easing: "easeOutQuad" });
  tw({ target: "orbit", property: "transform.scaleX", from: 0.7, to: 1.0, start: 12.0, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "orbit", property: "transform.scaleY", from: 0.7, to: 1.0, start: 12.0, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "orbit", property: "transform.rotation", from: 0, to: Math.PI * 2, start: 12.2, duration: 3.4, easing: "easeInOutSine" });
  tw({ target: "orbit-a", property: "fillColor", from: "#ef476f", to: "#ffd166", start: 12.5, duration: 2.5, easing: "linear" });
  tw({ target: "orbit-b", property: "fillColor", from: "#06d6a0", to: "#118ab2", start: 12.5, duration: 2.5, easing: "linear" });
  tw({ target: "orbit-c", property: "fillColor", from: "#ffd166", to: "#ef476f", start: 12.5, duration: 2.5, easing: "linear" });
  tw({ target: "orbit-a", property: "width", from: 80, to: 110, start: 13.0, duration: 0.6, easing: "easeOutBack" });
  tw({ target: "orbit-a", property: "width", from: 110, to: 80, start: 13.6, duration: 0.6, easing: "easeInOutQuad" });

  tw({ target: "glow", property: "transform.opacity", from: 0, to: 0.85, start: 13.0, duration: 0.8, easing: "easeOutQuad" });
  tw({ target: "glow", property: "transform.scaleX", from: 0.5, to: 1.6, start: 13.0, duration: 1.5, easing: "easeOutQuart" });
  tw({ target: "glow", property: "transform.scaleY", from: 0.5, to: 1.6, start: 13.0, duration: 1.5, easing: "easeOutQuart" });
  tw({ target: "glow", property: "fillColor", from: "#ff6b35", to: "#06d6a0", start: 13.5, duration: 2.0, easing: "linear" });
  tw({ target: "glow", property: "transform.opacity", from: 0.85, to: 0, start: 15.6, duration: 0.5, easing: "easeInOutQuad" });

  tw({ target: "orbit", property: "transform.opacity", from: 1, to: 0, start: 15.6, duration: 0.5, easing: "easeInOutQuad" });
  tw({ target: "orbit", property: "transform.scaleX", from: 1.0, to: 0.3, start: 15.6, duration: 0.5, easing: "easeInBack" });
  tw({ target: "orbit", property: "transform.scaleY", from: 1.0, to: 0.3, start: 15.6, duration: 0.5, easing: "easeInBack" });

  // Act 5 — finale.
  tw({ target: "title", property: "transform.y", from: 90, to: H / 2 - 20, start: 16.2, duration: 1.0, easing: "easeInOutBack" });
  tw({ target: "title", property: "transform.scaleX", from: 0.55, to: 1.4, start: 16.2, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "title", property: "transform.scaleY", from: 0.55, to: 1.4, start: 16.2, duration: 1.0, easing: "easeOutBack" });
  tw({ target: "title", property: "color", from: "#ffd166", to: "#06d6a0", start: 16.5, duration: 1.5, easing: "linear" });

  tw({ target: "footer", property: "transform.opacity", from: 0, to: 1, start: 18.0, duration: 0.7, easing: "easeOutQuad" });
  tw({ target: "footer", property: "transform.anchorY", from: 0, to: -0.4, start: 18.0, duration: 0.7, easing: "easeOutCubic" });
  tw({ target: "footer", property: "color", from: "#888888", to: "#ef476f", start: 18.5, duration: 1.0, easing: "linear" });

  tw({ target: "title", property: "transform.opacity", from: 1, to: 0, start: 19.0, duration: 1.0, easing: "easeInOutQuad" });
  tw({ target: "footer", property: "transform.opacity", from: 1, to: 0, start: 19.2, duration: 0.8, easing: "easeInOutQuad" });

  const composition: Composition = {
    version: "0.1",
    composition: { width: W, height: H, fps: FPS, duration: DURATION, background: "#000000" },
    assets,
    layers,
    items,
    tweens,
  };

  return { composition, usedEasings };
}

function starPoints(outerR: number, innerR: number, points: number): [number, number][] {
  const out: [number, number][] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = i * step - Math.PI / 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

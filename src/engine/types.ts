// Minimal Canvas2D-shaped context. Both the browser's CanvasRenderingContext2D
// and skia-canvas's CanvasRenderingContext2D satisfy this structurally.
// We list only the methods/properties the renderer actually uses so we are
// not coupled to DOM lib types or to skia-canvas-specific extensions.

export interface Canvas2DContext {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;

  globalAlpha: number;
  globalCompositeOperation: string;

  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;

  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    anticlockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;

  font: string;
  textAlign: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;

  // Both Canvas2D overloads. The 5-arg form scales the whole image into the
  // destination box (sprites); the 9-arg form crops a source rect first, which
  // the video `fit` math uses for cover/none without overflowing the box.
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

// Lookup of preloaded assets by id. The engine never owns asset state — drivers
// (browser/node) implement this and pass it in. Image type is opaque so the
// same engine works with browser HTMLImageElement and skia-canvas Image alike.
export interface AssetRegistry {
  getImage(id: string): unknown | undefined;
  getFontFamily(id: string): string | undefined;
}

// A video clip's pre-extracted frame sequence (v0.2 §S8). Video items render
// as textures: the driver pre-extracts a PNG per composition frame (§S7) and
// exposes them here so the renderer can pick one per frame. The renderer owns
// the temporal math (which frame index at time t, freeze/loop) and the spatial
// `fit` math; the provider only resolves a clip for an item id and hands back
// a decoded frame by its 1-based index.
export interface VideoClip {
  /** Number of frames available in the sequence (≥ 1). */
  frameCount: number;
  /** Intrinsic pixel width of each extracted frame (drives `fit`). */
  width: number;
  /** Intrinsic pixel height of each extracted frame (drives `fit`). */
  height: number;
  /**
   * Decoded frame image for a 1-based index (matching ffmpeg's `%05d.png`),
   * or undefined when out of range / not loaded. The opaque image type is
   * whatever the host's `drawImage` accepts (skia Image, HTMLImageElement).
   */
  getFrame(frameIndex: number): unknown | undefined;
}

// Resolves the backing {@link VideoClip} for a video item by its composition
// id. Supplied by the driver (the node driver builds it from the §S7 frame
// cache); absent for callers that never render video (e.g. the browser preview
// until a frame source is wired), in which case video items draw nothing.
export interface VideoFrameProvider {
  getClip(itemId: string): VideoClip | undefined;
}

import type { TweenIndex } from "./resolver.js";

// A scratch surface the renderer can paint into, then drawImage onto the main
// context. `source` is whatever the host's `drawImage` accepts as its first
// argument: HTMLCanvasElement in browsers, skia-canvas's Canvas in node.
export interface OffscreenSurface {
  context: Canvas2DContext;
  source: unknown;
}

export interface RenderOptions {
  assets?: AssetRegistry;
  index?: TweenIndex;
  // Optional factory drivers supply so the engine can multiply-tint sprites
  // without polluting the main canvas. When absent, sprite tint falls back to
  // drawing the untinted image (texture preserved, no colorization).
  createOffscreen?: (width: number, height: number) => OffscreenSurface;
  // Resolves pre-extracted frames for video items (v0.2 §S8). When absent,
  // video items draw nothing — every other item type renders unchanged.
  video?: VideoFrameProvider;
}

// ──────────────── Source-map authoring trail (editor v1.0) ────────────────
//
// The compose pre-compile pipeline can emit an authorship trail alongside the
// resolved (canonical v0.1) composition so a visual editor can "reveal in
// source" the authored JSON that produced a given resolved item / tween.
//
// COMPOSITION_PRIMITIVES.md §10.1 documents the broader ItemSource union; the
// editor PRD step 15 narrows that to a single uniform shape with an
// `originKind` discriminator. That shape lives here so engine-side consumers
// (e.g. the browser pickItemAt API in step 16) can import it without a
// circular dependency through `src/compose`.

/**
 * Why a resolved item / tween exists in the canonical output:
 *
 *   - `literal`    — authored directly in the source composition.
 *   - `ref`        — inlined from a `$ref` import.
 *   - `template`   — emitted by a `$template` instance expansion.
 *   - `behavior`   — emitted by a `$behavior` tween block expansion.
 *   - `scene`      — emitted by a `type: "scene"` instance expansion (wrapper
 *                    group AND its prefixed inner items).
 *   - `background` — the synthetic background rect that scene expansion
 *                    inserts when the scene declares a non-transparent
 *                    `background` color.
 */
export type OriginKind =
  | "literal"
  | "ref"
  | "template"
  | "behavior"
  | "scene"
  | "background";

/**
 * Single source-map entry: where in the *authored* JSON this resolved entry
 * came from. `file` is the absolute path of the file that holds the authored
 * declaration (or `"<root>"` when the caller did not pass `sourcePath`).
 * `jsonPointer` is an RFC 6901 pointer into that file's parsed JSON.
 */
export interface SourceLocation {
  file: string;
  jsonPointer: string;
  originKind: OriginKind;
}

/**
 * The full source map for a precompiled composition. Keyed by the resolved
 * item / tween id (i.e. the id the validator and engine see). Items with no
 * source attribution (e.g. anonymous nested sub-entries the editor doesn't
 * surface) are simply absent from the map.
 */
export interface SourceMap {
  items: Record<string, SourceLocation>;
  tweens: Record<string, SourceLocation>;
}

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

  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

// Lookup of preloaded assets by id. The engine never owns asset state — drivers
// (browser/node) implement this and pass it in. Image type is opaque so the
// same engine works with browser HTMLImageElement and skia-canvas Image alike.
export interface AssetRegistry {
  getImage(id: string): unknown | undefined;
  getFontFamily(id: string): string | undefined;
}

import type { TweenIndex } from "./resolver.js";

export interface RenderOptions {
  assets?: AssetRegistry;
  index?: TweenIndex;
}

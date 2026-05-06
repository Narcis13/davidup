// Canvas2D-only renderer. Platform-agnostic: receives a Canvas2DContext that
// both browsers and skia-canvas implement. No DOM-specific calls.
//
// Pipeline (per design-doc §5.2):
//   1. Resolve scene state at time t.
//   2. Paint background.
//   3. For each layer (sorted by z): save → set alpha & blend → draw items → restore.
//
// drawItem performs the per-item Canvas2D dance: translate to (x,y), rotate,
// scale, multiply opacity, then translate by anchor offset before delegating
// to the type-specific draw function. Groups recurse — Canvas2D's save/restore
// stack handles transform matrix composition for free (per §5.4).

import type {
  GroupItem,
  Item,
  Layer,
  ShapeItem,
  SpriteItem,
  TextItem,
} from "../schema/types.js";
import type { Composition } from "../schema/types.js";
import {
  computeStateAt,
  type ResolvedScene,
  type TweenIndex,
} from "./resolver.js";
import type { AssetRegistry, Canvas2DContext, RenderOptions } from "./types.js";

const COMPOSITE_NORMAL = "source-over";

export function renderFrame(
  comp: Composition,
  t: number,
  ctx: Canvas2DContext,
  options: RenderOptions = {},
): void {
  const scene = computeStateAt(comp, t, options.index);
  drawScene(scene, ctx, options.assets);
}

export function drawScene(
  scene: ResolvedScene,
  ctx: Canvas2DContext,
  assets: AssetRegistry | undefined,
): void {
  drawBackground(
    ctx,
    scene.composition.background,
    scene.composition.width,
    scene.composition.height,
  );

  const sorted = sortLayersByZ(scene.layers);
  for (const layer of sorted) {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * layer.opacity;
    applyBlendMode(ctx, layer.blendMode);
    for (const itemId of layer.items) {
      const item = scene.items[itemId];
      if (!item) continue;
      drawItem(ctx, item, scene, assets);
    }
    ctx.restore();
  }
}

export function drawItem(
  ctx: Canvas2DContext,
  item: Item,
  scene: ResolvedScene,
  assets: AssetRegistry | undefined,
): void {
  const tr = item.transform;
  ctx.save();

  ctx.translate(tr.x, tr.y);
  if (tr.rotation !== 0) ctx.rotate(tr.rotation);
  if (tr.scaleX !== 1 || tr.scaleY !== 1) ctx.scale(tr.scaleX, tr.scaleY);
  ctx.globalAlpha = ctx.globalAlpha * tr.opacity;

  const w = anchorWidth(item);
  const h = anchorHeight(item);
  if (w !== 0 || h !== 0) {
    ctx.translate(-tr.anchorX * w, -tr.anchorY * h);
  }

  switch (item.type) {
    case "sprite":
      drawSprite(ctx, item, assets);
      break;
    case "text":
      drawText(ctx, item, assets);
      break;
    case "shape":
      drawShape(ctx, item);
      break;
    case "group":
      drawGroupChildren(ctx, item, scene, assets);
      break;
  }

  ctx.restore();
}

function sortLayersByZ(layers: ReadonlyArray<Layer>): ReadonlyArray<Layer> {
  // Stable sort by z; layers tied at the same z keep their declaration order.
  const indexed = layers.map((layer, idx) => ({ layer, idx }));
  indexed.sort((a, b) => {
    if (a.layer.z !== b.layer.z) return a.layer.z - b.layer.z;
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.layer);
}

function drawBackground(
  ctx: Canvas2DContext,
  color: string,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = COMPOSITE_NORMAL;
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyBlendMode(ctx: Canvas2DContext, mode: string): void {
  // CSS-style "normal" maps to Canvas2D's default "source-over"; everything
  // else passes through (Canvas2D accepts most CSS blend mode names directly).
  ctx.globalCompositeOperation = mode === "normal" ? COMPOSITE_NORMAL : mode;
}

function anchorWidth(item: Item): number {
  if (item.type === "sprite") return item.width;
  if (item.type === "shape") return item.width ?? 0;
  return 0;
}

function anchorHeight(item: Item): number {
  if (item.type === "sprite") return item.height;
  if (item.type === "shape") return item.height ?? 0;
  return 0;
}

function drawSprite(
  ctx: Canvas2DContext,
  item: SpriteItem,
  assets: AssetRegistry | undefined,
): void {
  const image = assets?.getImage(item.asset);
  if (image === undefined) return;
  ctx.drawImage(image, 0, 0, item.width, item.height);
}

function drawText(
  ctx: Canvas2DContext,
  item: TextItem,
  assets: AssetRegistry | undefined,
): void {
  const family = assets?.getFontFamily(item.font) ?? item.font;
  ctx.font = `${item.fontSize}px "${family}"`;
  ctx.textAlign = item.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = item.color;
  ctx.fillText(item.text, 0, 0);
}

function drawShape(ctx: Canvas2DContext, item: ShapeItem): void {
  switch (item.kind) {
    case "rect": {
      const w = item.width ?? 0;
      const h = item.height ?? 0;
      const r = item.cornerRadius ?? 0;
      if (r > 0) {
        roundRectPath(ctx, 0, 0, w, h, r);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
      }
      paintShape(ctx, item);
      break;
    }
    case "circle": {
      // §3.2: width is the diameter for circles.
      const d = item.width ?? 0;
      const r = d / 2;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      paintShape(ctx, item);
      break;
    }
    case "polygon": {
      const pts = item.points ?? [];
      if (pts.length === 0) break;
      ctx.beginPath();
      const head = pts[0]!;
      ctx.moveTo(head[0], head[1]);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      paintShape(ctx, item);
      break;
    }
  }
}

function paintShape(ctx: Canvas2DContext, item: ShapeItem): void {
  if (item.fillColor !== undefined) {
    ctx.fillStyle = item.fillColor;
    ctx.fill();
  }
  const sw = item.strokeWidth ?? 0;
  if (item.strokeColor !== undefined && sw > 0) {
    ctx.strokeStyle = item.strokeColor;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

function drawGroupChildren(
  ctx: Canvas2DContext,
  item: GroupItem,
  scene: ResolvedScene,
  assets: AssetRegistry | undefined,
): void {
  for (const childId of item.items) {
    const child = scene.items[childId];
    if (!child) continue;
    drawItem(ctx, child, scene, assets);
  }
}

function roundRectPath(
  ctx: Canvas2DContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x + radius, y + h);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + radius);
  ctx.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

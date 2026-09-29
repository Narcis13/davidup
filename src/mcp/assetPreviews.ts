// davidup's previewers for the asset library (docs/asset-library-plan.md §2:
// "each host registers `previewers[kind]`... davidup its render path").
// hdf draws its seven kinds (handdrawn/cli/host.mjs); these draw the two of
// davidup's that an agent wants to see before it places one, so a contact
// sheet from `get_asset_preview` shows pixels and letters, not a card:
//
//   image   the pixels fitted over a checker (alpha) or a dark ground; a
//           sprite sheet shows the first frame of each cycle, named
//   font    the face itself: "Aa", a pangram, and its family
//
// video and audio keep assetlib's card (a video's frame needs ffmpeg, a
// sample's waveform is hdf's). skia-canvas is imported on the first thumb.
// Bump PREVIEW_VERSION when a picture changes: every thumb drawn by an older
// davidup previewer is redrawn, and no other host's is.

import type { AssetRecord, Previewers } from "../../assetlib/index.js";

export const PREVIEW_VERSION = 1;

const W = 480;
const H = 320;
const M = 12;
const INK = "#f4efe4";
const GROUND = "#23262d";

interface Ctx {
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}
interface Skia {
  Canvas: new (w: number, h: number) => { getContext(kind: "2d"): Ctx; toBuffer(format: "png"): Promise<Uint8Array> | Uint8Array };
  loadImage(src: string): Promise<{ width: number; height: number }>;
  FontLibrary: { use(family: string, paths: string[]): unknown };
}

let skia: Promise<Skia> | null = null;
function loadSkia(): Promise<Skia> {
  const specifier = "skia-canvas";
  skia ??= import(/* @vite-ignore */ specifier) as Promise<Skia>;
  return skia;
}

type Box = [number, number, number, number];

/** The largest box of aspect w:h inside `into`, centred. */
function fit(w: number, h: number, [x, y, bw, bh]: Box): Box {
  const k = Math.min(bw / w, bh / h);
  return [x + (bw - w * k) / 2, y + (bh - h * k) / 2, w * k, h * k];
}

function checker(ctx: Ctx, [x, y, w, h]: Box): void {
  const s = 12;
  for (let j = 0; j * s < h; j++) {
    for (let i = 0; i * s < w; i++) {
      ctx.fillStyle = (i + j) % 2 ? "#cfcfcf" : "#f2f2f2";
      ctx.fillRect(x + i * s, y + j * s, Math.min(s, w - i * s), Math.min(s, h - j * s));
    }
  }
}

async function png(canvas: { toBuffer(format: "png"): Promise<Uint8Array> | Uint8Array }): Promise<Uint8Array> {
  return await Promise.resolve(canvas.toBuffer("png"));
}

interface SheetSpec {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  count: number;
  cycles?: Record<string, { start: number }>;
}

async function imagePreview(file: string, record: AssetRecord): Promise<Uint8Array> {
  const { Canvas, loadImage } = await loadSkia();
  const img = await loadImage(file);
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);
  const sheet = (record as { sheet?: SheetSpec }).sheet;
  const alpha = (record as { alpha?: boolean }).alpha === true;

  // What to show: [source rect, caption] — the whole image, or a sheet's cycles.
  const cells: Array<{ src: Box; caption: string | null }> = [];
  if (sheet && sheet.frameWidth > 0 && sheet.columns > 0) {
    const cycles = Object.entries(sheet.cycles ?? {});
    const starts = cycles.length > 0 ? cycles.slice(0, 4).map(([name, c]) => ({ name, start: c.start })) : [{ name: "frame 0", start: 0 }];
    for (const { name, start } of starts) {
      const col = start % sheet.columns;
      const row = Math.floor(start / sheet.columns);
      cells.push({ src: [col * sheet.frameWidth, row * sheet.frameHeight, sheet.frameWidth, sheet.frameHeight], caption: name });
    }
  } else {
    cells.push({ src: [0, 0, img.width, img.height], caption: null });
  }

  const captions = cells.some((c) => c.caption !== null);
  const lane = (W - M * (cells.length + 1)) / cells.length;
  const bh = H - 2 * M - (captions ? 26 : 0);
  cells.forEach(({ src, caption }, i) => {
    const slot: Box = [M + i * (lane + M), M, lane, bh];
    const at = fit(src[2], src[3], slot);
    if (alpha) checker(ctx, at);
    ctx.drawImage(img, src[0], src[1], src[2], src[3], at[0], at[1], at[2], at[3]);
    if (caption !== null) {
      ctx.fillStyle = INK;
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(caption, slot[0] + lane / 2, H - M - 4, lane);
    }
  });
  return png(canvas);
}

async function fontPreview(file: string, record: AssetRecord): Promise<Uint8Array> {
  const { Canvas, FontLibrary } = await loadSkia();
  // A family of its own per blob, so a preview never re-points a family a
  // render in the same process registered (FontLibrary is process-global).
  const face = `davidup-preview-${String(record.sha ?? record.id).slice(0, 12)}`;
  FontLibrary.use(face, [file]);
  const family = String((record as { family?: string }).family ?? record.id);
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2622";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `120px "${face}"`;
  ctx.fillText("Aa", M + 8, 138);
  ctx.font = `34px "${face}"`;
  ctx.fillText("The quick brown fox", M + 8, 206, W - 2 * M - 16);
  ctx.fillText("jumps over 1234", M + 8, 250, W - 2 * M - 16);
  ctx.fillStyle = "#7a6f66";
  ctx.font = "15px sans-serif";
  ctx.fillText(family, M + 8, H - M - 4, W - 2 * M - 16);
  return png(canvas);
}

export const previewers: Previewers = {
  image: { name: "davidup", version: PREVIEW_VERSION, render: (file, record) => imagePreview(file, record) },
  font: { name: "davidup", version: PREVIEW_VERSION, render: (file, record) => fontPreview(file, record) },
};

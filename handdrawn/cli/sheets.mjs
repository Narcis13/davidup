// Stills through skia: `hdf only` writes PNGs of chosen frames, `hdf grid` a JPEG grid of evenly spaced
// frames, and contactSheet() the sheet `hdf render` writes alongside the video.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ImageData } from 'skia-canvas';
import { FPS } from '../core/curves.js';
import { format } from '../core/fit.js';
import { skiaCanvas } from './skia.mjs';
import { createRenderer, outputSize } from '../core/raster.js';
import { norm } from '../core/list.js';
import { seedList } from '../core/tree.js';
import { voiceSpans } from '../core/synth.js';
import { imagesOf } from './load.mjs';

// A canvas sized for the film at an output width, and a function drawing frame i on it.
export function frameCanvas(film, { ar, width } = {}) {
  const size = outputSize(ar ? format(ar) : film.format, width);
  const canvas = skiaCanvas(size.outW, size.outH), ctx = canvas.getContext('2d');
  const r = createRenderer({ makeCanvas: skiaCanvas, dedup: false, images: imagesOf(film) });
  return { canvas, size, draw: (i) => r.renderFrame(ctx, film, i, { ar, width }) };
}

// A display list painted on a fresh canvas: logical W x H at `width` output pixels, seeded from `seed`
// the way frame() seeds a shot, in `look`. For cards and sheets drawn in the house style.
const painters = new Map();
export function paint(list, { look, W, H, width = W, seed = 1, onto, images = null }) {
  const S = width / W, canvas = onto ?? skiaCanvas(Math.round(W * S), Math.round(H * S));
  let painter = painters.get(images);
  if (!painter) painters.set(images, (painter = createRenderer({ makeCanvas: skiaCanvas, dedup: false, images })));
  painter.draw(canvas.getContext('2d'), seedList(norm(list), seed), { look, S, W, H });
  return canvas;
}

// Tiles in rows on a dark ground: tiles [{ canvas, label? }], all drawn at their own size in a cell of
// the largest tile's size. Returns the sheet canvas.
export function tileSheet(tiles, { cols = 4, gap = 16, label = 0 } = {}) {
  const cw = Math.max(...tiles.map((t) => t.canvas.width)), ch = Math.max(...tiles.map((t) => t.canvas.height)) + label;
  cols = Math.min(cols, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const sheet = skiaCanvas(cols * (cw + gap) + gap, rows * (ch + gap) + gap), g = sheet.getContext('2d');
  g.fillStyle = '#141414';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '12px Menlo, monospace';
  g.textBaseline = 'top';
  tiles.forEach((t, j) => {
    const x = gap + (j % cols) * (cw + gap), y = gap + Math.floor(j / cols) * (ch + gap);
    g.drawImage(t.canvas, x, y);
    if (t.label) { g.fillStyle = '#b8b8b8'; g.fillText(t.label, x, y + t.canvas.height + 4); }
  });
  return sheet;
}

// Output name for a film rendered with --look / --ar, so variants never overwrite each other: gallop-risoPop-16x9.
export const variant = (film, flags) => `${film.name}${flags.look ? '-' + flags.look : ''}${flags.ar ? '-' + flags.ar.replace(':', 'x') : ''}`;

export const outDir = (flags) => { const d = resolve(flags.out ?? 'out'); mkdirSync(d, { recursive: true }); return d; };

function parseFrames(spec, n) {
  if (spec === undefined) throw new Error('only: missing frame list, e.g. 0,12,35');
  return String(spec).split(',').filter(Boolean).map((s) => {
    const i = Number(s);
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`only: frame '${s}' outside 0..${n - 1}`);
    return i;
  });
}

export async function only([path, list], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const { canvas, draw } = frameCanvas(film, { ar: flags.ar, width: flags.width });
  const dir = outDir(flags);
  for (const i of parseFrames(list, film.n)) {
    draw(i);
    const file = join(dir, `${variant(film, flags)}-${String(i).padStart(3, '0')}.png`);
    await canvas.toFile(file);
    process.stdout.write(`${file}\n`);
  }
  return 0;
}

// n frames spread evenly over the film (first and last included), six to a row, each with a label bar.
export async function grid([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const n = Math.min(flags.n ?? 24, film.n), tileW = flags.width ?? 480, bar = Math.round(tileW * 0.075);
  const { canvas: tile, size, draw } = frameCanvas(film, { ar: flags.ar, width: tileW });
  const cols = Math.min(6, n), rows = Math.ceil(n / cols), th = size.outH + bar;
  const sheet = skiaCanvas(cols * size.outW, rows * th), g = sheet.getContext('2d');
  g.fillStyle = '#141414';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = `${Math.round(bar * 0.62)}px Menlo, monospace`;
  g.textBaseline = 'middle';
  for (let j = 0; j < n; j++) {
    const i = n === 1 ? 0 : Math.round(j * (film.n - 1) / (n - 1));
    const f = draw(i), x = (j % cols) * size.outW, y = Math.floor(j / cols) * th;
    g.drawImage(tile, x, y);
    g.fillStyle = '#f0f0f0';
    g.fillText(`${String(i).padStart(3, '0')}  ${(i / FPS).toFixed(2)}s  ${f.shot}`, x + 5, y + size.outH + bar / 2);
  }
  const file = join(outDir(flags), `${variant(film, flags)}-grid.jpg`);
  await sheet.toFile(file, { quality: 0.9 });
  process.stdout.write(`${file}\n`);
  return 0;
}

// The render's contact sheet: two tiles per second (every sixth drawn frame), twelve to a row, with a strip
// under each row showing cuts (red lines through tile and strip) and score onsets (dots, higher = higher
// pitch; noise as a cross) and, when the score speaks, a band of voice bars (4.0 V1: the whole sound faint,
// its voiced part solid, the sample id on it). add(i, rawRGBA) as frames go by, then write(file, { cues, events }).
export function contactSheet(film, { ar, width, tileW = 160, every = FPS / 2, cols = 12 } = {}) {
  const size = outputSize(ar ? format(ar) : film.format, width);
  const tileH = Math.round(tileW * size.outH / size.outW);
  const full = skiaCanvas(size.outW, size.outH), fctx = full.getContext('2d');
  const tiles = [];
  return {
    outW: size.outW, outH: size.outH,
    add(i, buf) {
      if (i % every) return;
      fctx.clearRect(0, 0, size.outW, size.outH);   // skia records commands: without a full clear every putImageData is replayed
      fctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), size.outW, size.outH), 0, 0);
      const t = skiaCanvas(tileW, tileH);
      t.getContext('2d').drawImage(full, 0, 0, tileW, tileH);
      tiles[i / every] = t;
    },
    async write(file, { cues = { cuts: [] }, events = [] } = {}) {
      const voices = voiceSpans(events), strip = voices.length ? 44 : 30;
      const n = Math.ceil(film.n / every), rows = Math.ceil(n / cols), rowH = tileH + strip;
      const sheet = skiaCanvas(cols * tileW, rows * rowH), g = sheet.getContext('2d');
      const perTile = every / FPS;   // seconds per tile
      const xAt = (t) => ({ row: Math.floor(t / perTile / cols), x: (t / perTile % cols) * tileW });
      g.fillStyle = '#141414';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '10px Menlo, monospace';
      g.textBaseline = 'top';
      for (let j = 0; j < n; j++) {
        const x = (j % cols) * tileW, y = Math.floor(j / cols) * rowH;
        if (tiles[j]) g.drawImage(tiles[j], x, y);
        g.fillStyle = '#8a8a8a';
        g.fillText(`${(j * perTile).toFixed(1)}s`, x + 3, y + tileH + 2);
      }
      const lo = Math.log2(40), hi = Math.log2(2000);
      for (const e of events) {
        if (e.type === 'voice') continue;
        const { row, x } = xAt(e.t);
        if (row >= rows) continue;
        const y0 = row * rowH + tileH + 14, y = y0 + 13 - 12 * Math.min(1, Math.max(0, (Math.log2(e.hz ?? 440) - lo) / (hi - lo)));
        g.fillStyle = g.strokeStyle = e.type === 'noise' ? '#f0f0f0' : { sine: '#7fe7ff', triangle: '#ffe22b', square: '#ff6fd8', saw: '#5fe08a', sawtooth: '#5fe08a' }[e.type] ?? '#ccc';
        if (e.type === 'noise') { g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - 3, y0 + 4); g.lineTo(x + 3, y0 + 10); g.moveTo(x + 3, y0 + 4); g.lineTo(x - 3, y0 + 10); g.stroke(); }
        else { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
      }
      // A bar crossing a row's end carries on at the start of the next row.
      const bar = (t0, t1, draw) => {
        for (let t = t0; t < t1 - 1e-9;) {
          const { row, x } = xAt(t), end = Math.min(t1, (row + 1) * cols * perTile);
          if (row >= rows) break;
          draw(x, row * rowH + tileH + 31, xAt(end - 1e-9).x - x, t === t0);
          t = end;
        }
      };
      for (const v of voices) {
        g.fillStyle = 'rgba(255, 159, 67, 0.3)';
        bar(v.t, v.t1, (x, y, w) => g.fillRect(x, y, w, 12));
        g.fillStyle = '#ff9f43';
        bar(v.v0, v.v1, (x, y, w) => g.fillRect(x, y + 1, w, 10));
        g.fillStyle = '#141414';
        bar(v.v0, v.v1, (x, y, w, first) => { if (first) g.fillText(v.id, x + 2, y + 1); });
      }
      g.strokeStyle = '#ff3b30';
      g.lineWidth = 2;
      for (const t of cues.cuts) {
        const { row, x } = xAt(t);
        g.beginPath(); g.moveTo(x, row * rowH); g.lineTo(x, row * rowH + rowH); g.stroke();
      }
      await sheet.toFile(file, { quality: 0.9 });
    },
  };
}

// hdf changed <film.js>: which drawn frames moved since the last render (or the last `hdf changed`),
// decided by list hash alone, and a before/after grid of just those frames.
// State lives next to the renders: out/<film>.hashes.json holds each frame's list hash (with the look's),
// out/<film>.thumbs/<hash>.png a 320 px thumbnail per distinct hash, so "before" needs no old code.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageData, loadImage } from 'skia-canvas';
import { FPS } from '../core/curves.js';
import { hashList } from '../core/list.js';
import { hashLook } from '../core/looks.js';
import { frame } from '../core/tree.js';
import { skiaCanvas } from './skia.mjs';
import { frameCanvas, outDir, tileSheet, variant } from './sheets.mjs';

const THUMB = 320;

// Same name as `hdf render`'s outputs (look and aspect included), so changed compares against that render.
export const stateBase = (flags, film) => join(outDir(flags), variant(film, flags));

// Every frame's hash: list + look, so a look change moves every frame even if no list does.
export function frameHashes(film, { ar } = {}) {
  const look = hashLook(film.look);
  return Array.from({ length: film.n }, (_, i) => { const f = frame(film, i, { ar }); return { h: `${hashList(f.list)}${look}`, shot: f.shot }; });
}

function readState(base) {
  try { return JSON.parse(readFileSync(`${base}.hashes.json`, 'utf8')); } catch { return null; }
}

// Writes the hash file and prunes thumbnails no frame points at any more.
function writeState(base, film, ar, hashes) {
  writeFileSync(`${base}.hashes.json`, JSON.stringify({ film: film.name, ar: ar ?? film.format.ar, frames: hashes.map((x) => x.h) }) + '\n');
  const dir = `${base}.thumbs`, keep = new Set(hashes.map((x) => `${x.h}.png`));
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f));
}

// For `hdf render`: thumbnails from the raw frames it already has, then the state. add(i, buf) per frame.
export function tracker(film, base, { ar, outW, outH }) {
  const hashes = frameHashes(film, { ar }), dir = `${base}.thumbs`, done = new Set();
  const full = skiaCanvas(outW, outH), fctx = full.getContext('2d'), th = Math.round(THUMB * outH / outW);
  mkdirSync(dir, { recursive: true });
  return {
    add(i, buf) {
      const { h } = hashes[i];
      if (done.has(h)) return;
      done.add(h);
      fctx.clearRect(0, 0, outW, outH);   // skia records commands: without a full clear every putImageData is replayed
      fctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), outW, outH), 0, 0);
      const t = skiaCanvas(THUMB, th);
      t.getContext('2d').drawImage(full, 0, 0, THUMB, th);
      writeFileSync(join(dir, `${h}.png`), t.toBufferSync('png'));
    },
    write() { writeState(base, film, ar, hashes); },
  };
}

const ranges = (xs) => {
  const out = [];
  for (const x of xs) { const r = out.at(-1); if (r && r[1] === x - 1) r[1] = x; else out.push([x, x]); }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
};

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const base = stateBase(flags, film), dir = `${base}.thumbs`;
  const now = frameHashes(film, { ar: flags.ar }), before = readState(base);
  mkdirSync(dir, { recursive: true });
  const thumbs = frameCanvas(film, { ar: flags.ar, width: THUMB });
  const shoot = (i) => {
    const file = join(dir, `${now[i].h}.png`);
    if (existsSync(file)) return;
    thumbs.draw(i);
    writeFileSync(file, thumbs.canvas.toBufferSync('png'));
  };
  if (!before) {
    now.forEach((_, i) => shoot(i));
    writeState(base, film, flags.ar, now);
    process.stdout.write(`${film.name}: no earlier render; recorded ${film.n} frames as the baseline\n`);
    return 0;
  }
  const changed = now.flatMap((x, i) => (before.frames[i] === x.h ? [] : [i]));
  const removed = Math.max(0, before.frames.length - now.length);
  if (!changed.length && !removed) {
    process.stdout.write(`${film.name}: no frames changed\n`);
    return 0;
  }
  changed.forEach(shoot);
  // At most 30 pairs, spread over the changed frames.
  const show = changed.length <= 30 ? changed : Array.from({ length: 30 }, (_, j) => changed[Math.round(j * (changed.length - 1) / 29)]);
  const tw = thumbs.size.outW, th = thumbs.size.outH, gap = 6;
  const tiles = [];
  for (const i of show) {
    const pair = skiaCanvas(2 * tw + gap, th), g = pair.getContext('2d');
    g.fillStyle = '#2a2a2a';
    g.fillRect(0, 0, pair.width, th);
    const old = before.frames[i] && join(dir, `${before.frames[i]}.png`);
    if (old && existsSync(old)) g.drawImage(await loadImage(old), 0, 0);
    else { g.fillStyle = '#8a8a8a'; g.font = '14px Menlo, monospace'; g.fillText(old ? 'no thumbnail' : 'new frame', 12, 24); }
    g.drawImage(await loadImage(join(dir, `${now[i].h}.png`)), tw + gap, 0);
    tiles.push({ canvas: pair, label: `${String(i).padStart(3, '0')}  ${(i / FPS).toFixed(2)}s  ${now[i].shot}   before | after` });
  }
  const file = `${base}-changed.jpg`;
  if (tiles.length) await tileSheet(tiles, { cols: 3, label: 18 }).toFile(file, { quality: 0.9 });
  writeState(base, film, flags.ar, now);
  const lines = [`${film.name}: ${changed.length} of ${film.n} frames changed${changed.length ? `: ${ranges(changed)}` : ''}${removed ? `; ${removed} frames removed from the end` : ''}`];
  if (tiles.length) lines.push(file);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

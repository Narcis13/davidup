// Pictures for the agent to look at: contact sheets, strips, onion skins, a rhythm chart, a palette card.
// Everything is drawn with skia-canvas and written as a JPEG (or PNG when the path says so); every picture
// carries a title line that says what it is, so a sheet read out of context still explains itself.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const INTER = join(REPO, 'fonts', 'Inter-Regular.ttf');
if (existsSync(INTER) && !FontLibrary.has?.('Inter')) {
  try { FontLibrary.use('Inter', [INTER]); } catch { /* fall back to the system sans */ }
}
const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

const INK = '#e8eaf0', DIM = '#8a90a0', BG = '#121418', PANEL = '#1b1e25', RED = '#ff4d5e', AMBER = '#ffc23d', CYAN = '#3de8ff';

export async function img(src) {
  if (!src) return null;
  if (typeof src === 'string' || Buffer.isBuffer(src)) return loadImage(src);
  return src;   // an Image or a Canvas
}

export async function save(canvas, out) {
  mkdirSync(dirname(out), { recursive: true });
  await canvas.toFile(out, out.endsWith('.png') ? {} : { quality: 0.86 });
  return out;
}

function fitText(ctx, s, max) {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function header(ctx, W, title, sub) {
  ctx.fillStyle = INK;
  ctx.font = `600 22px ${SANS}`;
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, title ?? '', W - 32), 16, 12);
  if (sub) {
    ctx.fillStyle = DIM;
    ctx.font = `15px ${SANS}`;
    ctx.fillText(fitText(ctx, sub, W - 32), 16, 42);
  }
  return sub ? 70 : 46;
}

// A grid of tiles, each an image with a label under it.
//   tiles: [{ img, label, sub, swatches: ['#hex'], boxes: [{ x, y, w, h, color, label }] (source pixels),
//             badge: 'text' (top-left, red), dim: true (greyed) }]
export async function sheet(tiles, { cols = 4, tileW = 420, title, sub, out, checker = false } = {}) {
  const imgs = await Promise.all(tiles.map((t) => img(t.img)));
  const first = imgs.find(Boolean);
  const aspect = first ? first.height / first.width : 9 / 16;
  const tileH = Math.round(tileW * aspect), labelH = tiles.some((t) => t.sub || t.swatches) ? 44 : 26, gap = 10;
  cols = Math.max(1, Math.min(cols, tiles.length || 1));
  const rows = Math.ceil(tiles.length / cols), W = cols * tileW + (cols + 1) * gap;
  const top = sub ? 70 : 46, H = top + rows * (tileH + labelH + gap) + gap;
  const c = new Canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  header(ctx, W, title, sub);
  tiles.forEach((t, k) => {
    const im = imgs[k], x = gap + (k % cols) * (tileW + gap), y = top + Math.floor(k / cols) * (tileH + labelH + gap);
    if (checker) {
      for (let yy = 0; yy < tileH; yy += 16) for (let xx = 0; xx < tileW; xx += 16) {
        ctx.fillStyle = ((xx + yy) / 16) % 2 ? '#3a3d45' : '#2a2d34';
        ctx.fillRect(x + xx, y + yy, Math.min(16, tileW - xx), Math.min(16, tileH - yy));
      }
    } else { ctx.fillStyle = PANEL; ctx.fillRect(x, y, tileW, tileH); }
    if (im) ctx.drawImage(im, x, y, tileW, tileH);
    if (t.dim) { ctx.fillStyle = 'rgba(18,20,24,0.55)'; ctx.fillRect(x, y, tileW, tileH); }
    const s = im ? tileW / im.width : 1;
    for (const b of t.boxes ?? []) {
      ctx.strokeStyle = b.color ?? RED; ctx.lineWidth = 3;
      ctx.strokeRect(x + b.x * s, y + b.y * s, Math.max(2, b.w * s), Math.max(2, b.h * s));
      if (b.label) {
        ctx.font = `600 13px ${SANS}`;
        const lw = ctx.measureText(b.label).width + 8, lx = Math.min(x + tileW - lw, Math.max(x, x + b.x * s)), ly = Math.max(y, y + b.y * s - 18);
        ctx.fillStyle = b.color ?? RED; ctx.fillRect(lx, ly, lw, 18);
        ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.fillText(b.label, lx + 4, ly + 2);
      }
    }
    if (t.badge) {
      ctx.font = `700 13px ${SANS}`;
      const bw = ctx.measureText(t.badge).width + 10;
      ctx.fillStyle = t.badgeColor ?? RED; ctx.fillRect(x + 6, y + 6, bw, 20);
      ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.fillText(t.badge, x + 11, y + 9);
    }
    ctx.textBaseline = 'top';
    ctx.fillStyle = INK; ctx.font = `600 15px ${SANS}`;
    ctx.fillText(fitText(ctx, t.label ?? '', tileW - 4), x + 2, y + tileH + 5);
    if (t.sub) {
      ctx.fillStyle = DIM; ctx.font = `13px ${SANS}`;
      const sw = (t.swatches?.length ?? 0) * 20;
      ctx.fillText(fitText(ctx, t.sub, tileW - sw - 8), x + 2, y + tileH + 25);
    }
    (t.swatches ?? []).forEach((hex, j, all) => {
      ctx.fillStyle = hex; ctx.fillRect(x + tileW - (all.length - j) * 20, y + tileH + 24, 18, 16);
    });
  });
  if (out) await save(c, out);
  return c;
}

// Frames of a moment side by side: what the eye sees across it.
export async function strip(images, labels, { cols, tileW = 300, title, sub, out } = {}) {
  return sheet(images.map((im, k) => ({ img: im, label: labels[k] })), { cols: cols ?? Math.min(images.length, 6), tileW, title, sub, out });
}

// An onion skin: the frames' per-pixel median is the still background; each frame's pixels that differ
// from it are laid over in order, faint to solid, so one picture shows where things travel.
export async function onion(images, { width = 960, title, sub, out } = {}) {
  const ims = (await Promise.all(images.map(img))).filter(Boolean);
  if (!ims.length) throw new Error('onion: no frames');
  const w = width, h = Math.round((w * ims[0].height) / ims[0].width), N = ims.length;
  const datas = ims.map((im) => {
    const c = new Canvas(w, h), x = c.getContext('2d');
    x.drawImage(im, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  });
  const n = w * h, outPx = new Uint8ClampedArray(n * 4), col = new Array(N);
  for (let p = 0; p < n; p++) {
    for (let ch = 0; ch < 3; ch++) {
      for (let k = 0; k < N; k++) col[k] = datas[k][p * 4 + ch];
      col.sort((a, b) => a - b);
      outPx[p * 4 + ch] = col[N >> 1];
    }
    outPx[p * 4 + 3] = 255;
  }
  for (let k = 0; k < N; k++) {
    const d = datas[k], a = N === 1 ? 1 : 0.22 + 0.78 * (k / (N - 1));
    for (let p = 0; p < n; p++) {
      const o = p * 4, diff = Math.abs(d[o] - outPx[o]) + Math.abs(d[o + 1] - outPx[o + 1]) + Math.abs(d[o + 2] - outPx[o + 2]);
      if (diff < 36) continue;
      for (let ch = 0; ch < 3; ch++) outPx[o + ch] = outPx[o + ch] + (d[o + ch] - outPx[o + ch]) * a;
    }
  }
  const top = sub ? 70 : 46, c = new Canvas(w + 32, h + top + 16), ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, c.width, c.height);
  header(ctx, c.width, title, sub);
  const tmp = new Canvas(w, h), tctx = tmp.getContext('2d'), id = tctx.createImageData(w, h);
  id.data.set(outPx);
  tctx.putImageData(id, 0, 0);
  ctx.drawImage(tmp, 16, top);
  if (out) await save(c, out);
  return c;
}

// The rhythm chart: thumbnails along the time axis, motion energy (filled), brightness, loudness, cuts,
// beats and markers; with `ref`, a reference's energy and cuts in grey, stretched to this duration.
export async function rhythm({
  duration, fps, energy, brightness, loudness, cuts = [], changes = [], beats = [], markers = [], thumbs = [], ref, holds = [],
  title, sub, out, width = 1800,
}) {
  const W = width, padL = 56, padR = 20, plotW = W - padL - padR, top0 = sub ? 70 : 46;
  const thumbH = thumbs.length ? Math.round((plotW / Math.max(1, thumbs.length)) * 9 / 16) : 0;
  const plotTop = top0 + (thumbH ? thumbH + 22 : 8) + 22, plotH = 250, H = plotTop + plotH + 70;
  const c = new Canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  header(ctx, W, title, sub);
  const X = (t) => padL + (t / duration) * plotW;
  // thumbnails
  if (thumbs.length) {
    const tw = plotW / thumbs.length, ims = await Promise.all(thumbs.map((t) => img(t.img)));
    thumbs.forEach((t, k) => {
      const im = ims[k];
      if (im) {
        const h = thumbH, w = Math.min(tw - 2, (im.width / im.height) * h);
        ctx.drawImage(im, padL + k * tw + (tw - w) / 2, top0 + 4, w, h);
      }
      ctx.fillStyle = DIM; ctx.font = `12px ${SANS}`; ctx.textBaseline = 'top';
      ctx.fillText(`${t.t.toFixed(1)}s`, padL + k * tw + 2, top0 + thumbH + 6);
    });
  }
  // plot panel
  ctx.fillStyle = PANEL; ctx.fillRect(padL, plotTop, plotW, plotH);
  const holdFill = 'rgba(255,194,61,0.10)';
  for (const hd of holds) { ctx.fillStyle = holdFill; ctx.fillRect(X(hd.t0), plotTop, (hd.dur / duration) * plotW, plotH); }
  // scale: the square root of the moving share, against the larger of this and the reference, so a flash
  // does not flatten everything else
  const maxOf = (arr) => { let m = 0; for (const v of arr ?? []) m = Math.max(m, v); return m; };
  const eMax = Math.sqrt(Math.max(maxOf(energy), ref ? maxOf(ref.energy) : 0, 1e-6));
  const Y = (v) => plotTop + plotH - (Math.min(1, Math.sqrt(Math.max(0, v)) / eMax)) * (plotH - 12);
  const series = (arr, f, dur, color, lw, fillIt) => {
    if (!arr?.length) return;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const t = (i / f) * (duration / dur), x = X(t), y = Y(arr[i]);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    if (fillIt) {
      ctx.lineTo(X(((arr.length - 1) / f) * (duration / dur)), plotTop + plotH); ctx.lineTo(X(0), plotTop + plotH); ctx.closePath();
      ctx.fillStyle = fillIt; ctx.fill();
    } else { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); }
  };
  if (ref) {
    series(ref.energy, ref.fps, ref.duration, '#9aa0ad', 2, null);
    ctx.strokeStyle = 'rgba(154,160,173,0.55)'; ctx.lineWidth = 1;
    for (const t of ref.cuts ?? []) { const x = X(t * (duration / ref.duration)); ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotTop + 26); ctx.stroke(); }
  }
  series(energy, fps, duration, null, 0, 'rgba(61,232,255,0.35)');
  series(energy, fps, duration, CYAN, 1.5, null);
  if (brightness?.length) {
    ctx.beginPath();
    for (let i = 0; i < brightness.length; i++) {
      const x = X(i / fps), y = plotTop + plotH - brightness[i] * (plotH - 12);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,194,61,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  if (loudness?.rms?.length) {
    ctx.beginPath();
    const { rms, hopRate } = loudness, half = Math.max(1, Math.round(hopRate * Math.max(0.1, duration / 400)));
    const step = Math.max(1, Math.round(half / 2));
    for (let i = 0; i < rms.length; i += step) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(rms.length - 1, i + half); j++) { s += rms[j]; c++; }
      const x = X(i / hopRate), v = Math.max(0, Math.min(1, (s / c + 60) / 60)), y = plotTop + plotH - v * (plotH - 12);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(160,120,255,0.75)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.strokeStyle = RED; ctx.lineWidth = 2;
  for (const t of cuts) { const x = X(t); ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotTop + plotH); ctx.stroke(); }
  ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,77,94,0.8)';
  for (const t of changes) {
    if (cuts.some((c) => Math.abs(c - t) < 0.05)) continue;
    const x = X(t); ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotTop + plotH); ctx.stroke();
  }
  ctx.setLineDash([]);
  // beats along the bottom, every fourth taller
  beats.forEach((b, k) => {
    const x = X(b), tall = k % 4 === 0;
    ctx.strokeStyle = tall ? '#c9ccd6' : '#6b7080'; ctx.lineWidth = tall ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, plotTop + plotH); ctx.lineTo(x, plotTop + plotH + (tall ? 14 : 8)); ctx.stroke();
  });
  // markers as flags above the plot
  ctx.font = `12px ${SANS}`; ctx.textBaseline = 'bottom';
  let lastX = -1e9, row = 0;
  for (const m of [...markers].sort((a, b) => a.t - b.t)) {
    const x = X(m.t);
    row = x - lastX < 90 ? (row + 1) % 2 : 0; lastX = x;
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plotTop - 2 - row * 12); ctx.lineTo(x, plotTop + plotH); ctx.stroke();
    ctx.fillStyle = AMBER; ctx.fillText(fitText(ctx, m.name, 120), x + 3, plotTop - 2 - row * 12);
  }
  // axis
  ctx.fillStyle = DIM; ctx.textBaseline = 'top'; ctx.font = `12px ${SANS}`;
  const step = duration <= 12 ? 1 : duration <= 40 ? 2 : duration <= 90 ? 5 : 10;
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const x = X(t);
    ctx.fillRect(x, plotTop + plotH + 16, 1, 5);
    ctx.fillText(`${t}s`, x - 8, plotTop + plotH + 22);
  }
  // legend
  const leg = [[CYAN, 'share of frame moving (sqrt)'], [RED, 'hard cuts'], ...(changes.length ? [['rgba(255,77,94,0.6)', 'transitions (dashed)']] : []), ['rgba(255,194,61,0.9)', 'brightness'], ...(loudness ? [['rgba(160,120,255,0.9)', 'loudness']] : []),
    ...(ref ? [['#9aa0ad', `reference: ${ref.label ?? 'energy'}`]] : []), ...(beats.length ? [['#c9ccd6', 'beats']] : []), ...(markers.length ? [[AMBER, 'markers']] : []),
    ...(holds.length ? [['rgba(255,194,61,0.4)', 'nothing moves']] : [])];
  let lx = padL;
  ctx.font = `13px ${SANS}`; ctx.textBaseline = 'middle';
  for (const [col, name] of leg) {
    ctx.fillStyle = col; ctx.fillRect(lx, H - 18, 14, 4);
    ctx.fillStyle = INK; ctx.fillText(name, lx + 20, H - 16);
    lx += ctx.measureText(name).width + 44;
  }
  if (out) await save(c, out);
  return c;
}

// Swatches with their hex and share.
// Swatches with their hex and share; `accents` (the saturated colours) as a second row.
export async function paletteCard(pal, { title, out, width = 900, accents } = {}) {
  const top = 46, rowH = 150, rows = accents?.length ? 2 : 1, H = top + rows * rowH + (rows > 1 ? 20 : 0), c = new Canvas(width, H), ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, width, H);
  header(ctx, width, title);
  const row = (list, y0, label) => {
    if (label) { ctx.fillStyle = DIM; ctx.font = `13px ${SANS}`; ctx.textBaseline = 'top'; ctx.fillText(label, 16, y0 - 16); }
    let x = 16;
    const total = list.reduce((s, p) => s + p.area, 0) || 1, avail = width - 32;
    for (const p of list) {
      const w = Math.max(70, (p.area / total) * avail);
      if (x + w > width - 8) break;
      ctx.fillStyle = p.hex; ctx.fillRect(x, y0 + 8, w - 4, 90);
      ctx.fillStyle = INK; ctx.font = `600 14px ${SANS}`; ctx.textBaseline = 'top';
      ctx.fillText(p.hex, x, y0 + 104);
      ctx.fillStyle = DIM; ctx.font = `13px ${SANS}`;
      ctx.fillText(`${Math.round(p.area * 100)}%`, x, y0 + 124);
      x += w;
    }
  };
  row(pal, top);
  if (accents?.length) row(accents, top + rowH + 20, 'accents: the saturated colours, by their share of saturated pixels');
  if (out) await save(c, out);
  return c;
}

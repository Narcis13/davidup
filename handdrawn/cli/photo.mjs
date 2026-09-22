// hdf photo: prepare a found photo for the doodle look. Cut the object out of its plain background, crop it,
// trace its alpha into a silhouette path, and write the cutout (plan 1.6) into a photos module as a data URL,
// plus a check sheet out/photo-<name>.jpg: the cutout on magenta (halos and holes show) with the traced
// silhouette in blue, and on paper with a u,v grid every 0.1.
//
//   hdf photo teapot.jpg --name teapot --credit "Teapot, ca. 1755, The Met, CC0" --source https://...
//   hdf photo cup.jpg --name cup --punch 0.87,0.35       also clear an enclosed hole; u,v read off the check sheet
//   hdf photo cut.png --name boot --keep                 the file already has alpha: only crop, trace, register
//   hdf photo flat.jpg --name card --flood --tol 34 --local 10 --shadow 60   flood the plain background by colour
//   hdf photo --v1 held-once-photos.js [--js photos.js]  convert a v1 photos.js (registerPhoto lines): trace each
//   hdf photo --refresh held-once-photos.js              re-read a module and add `colours` to every cutout (no re-matting)
//
// The cut: `rembg` (on PATH, or REMBG=/path/to/rembg) does the matting unless --flood or --keep; without it
// the background is flooded from the borders by colour, which only holds on flat, evenly lit backgrounds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadImage } from 'skia-canvas';
import { css } from '../core/looks.js';
import { skiaCanvas } from './skia.mjs';
import { traceAlpha } from '../core/trace.js';
import { UsageError } from './load.mjs';

const HEAD = [
  '// Cutouts for the doodle look, written by hdf photo. One line per photo.',
  'export const PHOTOS = {};',
  'export default PHOTOS;',
];

export async function run(args, flags) {
  const outDir = resolve(String(flags.out ?? 'out'));
  const jsFile = resolve(String(flags.js ?? 'photos.js'));
  mkdirSync(outDir, { recursive: true });
  if (flags.v1) return convertV1(String(flags.v1 === true ? args[0] : flags.v1), jsFile, outDir);
  if (flags.refresh) return refresh(String(flags.refresh === true ? args[0] : flags.refresh));

  const file = args[0], name = flags.name;
  if (!file || !name || name === true) throw usage('photo: need <img> and --name <id>');
  if (!existsSync(file)) throw usage(`photo: no such file '${file}'`);
  const opt = {
    tol: num(flags.tol, 34), local: num(flags.local, 10), shadow: num(flags.shadow, 0),
    keep: flags.keep === true, max: num(flags.max, 1300), punchTol: num(flags.punchTol, 42),
    punch: String(flags.punch ?? '').split(';').filter(Boolean).map((p) => p.split(',').map(Number)),
  };

  let input = file;
  if (!opt.keep && flags.flood !== true) {       // matting model first, colour flood as the fallback
    const cut = join(outDir, `photo-${name}-cut.png`);
    try {
      execFileSync(process.env.REMBG || 'rembg', ['i', '-m', String(flags.model ?? 'isnet-general-use'), file, cut], { stdio: 'ignore' });
      input = cut; opt.keep = true;
      process.stdout.write('cut by rembg\n');
    } catch {
      process.stderr.write('rembg not found or failed: flooding the background by colour instead (fine for flat backgrounds only)\n');
    }
  }

  const res = cutout(await loadImage(input), opt);
  if (res.error) { process.stderr.write(`photo: ${res.error}\n`); return 1; }
  const { canvas, kept } = res;
  const sil = silhouette(canvas);
  const src = await dataURL(canvas);
  const rec = { name: String(name), credit: str(flags.credit), source: str(flags.source), src, w: canvas.width, h: canvas.height, sil, colours: colours(canvas, sil) };
  writeRecords(jsFile, [rec]);
  const sheet = join(outDir, `photo-${name}.jpg`);
  await checkSheet(canvas, sil).toFile(sheet, { quality: 0.9 });
  process.stdout.write(`${name}: ${rec.w}x${rec.h}, object covers ${(kept * 100).toFixed(0)}% of the source, `
    + `${sil.sub.length} subs / ${sil.sub.reduce((n, s) => n + s.pts.length / 2, 0)} pts, ${(src.length / 1024).toFixed(0)} KB -> ${jsFile}\n`
    + `colours: ${swatches(rec.colours)}\n`
    + `check sheet: ${sheet}\n`);
  if (kept > 0.85) process.stderr.write('warning: almost nothing was removed. Raise --tol, or the background is not plain.\n');
  if (kept < 0.03) process.stderr.write('warning: almost everything was removed. Lower --tol or --local.\n');
  return 0;
}

const num = (v, d) => (v === undefined || v === true ? d : +v);
const str = (v) => (v === undefined || v === true ? '' : String(v));
const usage = (msg) => new UsageError(msg);

// The v1 cut (scripts/photo.mjs), on skia instead of a browser page.
function cutout(img, opt) {
  const k = Math.min(1, opt.max / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
  const cv = skiaCanvas(w, h), g = cv.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, bg = new Uint8Array(w * h);
  if (!opt.keep) {
    // background model: the colour of each row at the left and right borders (studio backdrops grade vertically)
    const m = Math.max(2, Math.round(w * 0.02)), rowL = [], rowR = [];
    for (let y = 0; y < h; y++) {
      const a = [0, 0, 0], b = [0, 0, 0];
      for (let x = 0; x < m; x++) for (let c = 0; c < 3; c++) { a[c] += d[(y * w + x) * 4 + c] / m; b[c] += d[(y * w + w - 1 - x) * 4 + c] / m; }
      rowL.push(a); rowR.push(b);
    }
    const dist = (i, r, gg, b) => Math.hypot(d[i] - r, d[i + 1] - gg, d[i + 2] - b);
    const isBg = (x, y, from) => {
      const i = (y * w + x) * 4, t = x / Math.max(1, w - 1), L = rowL[y], R = rowR[y];
      const r0 = L[0] + (R[0] - L[0]) * t, g0 = L[1] + (R[1] - L[1]) * t, b0 = L[2] + (R[2] - L[2]) * t;
      if (from >= 0 && dist(i, d[from], d[from + 1], d[from + 2]) > opt.local) return false;
      if (dist(i, r0, g0, b0) <= opt.tol) return true;
      if (opt.shadow) {   // a shadow is the backdrop, darker, same hue
        const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11, l0 = r0 * 0.3 + g0 * 0.59 + b0 * 0.11, s = lum / Math.max(1, l0);
        if (l0 - lum > 0 && l0 - lum <= opt.shadow && Math.hypot(d[i] - r0 * s, d[i + 1] - g0 * s, d[i + 2] - b0 * s) < 14) return true;
      }
      return false;
    };
    const stack = [];
    const push = (x, y, from) => { const p = y * w + x; if (bg[p] || !isBg(x, y, from)) return; bg[p] = 1; stack.push(p); };
    for (let x = 0; x < w; x++) { push(x, 0, -1); push(x, h - 1, -1); }
    for (let y = 0; y < h; y++) { push(0, y, -1); push(w - 1, y, -1); }
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0, from = p * 4;
      if (x > 0) push(x - 1, y, from); if (x < w - 1) push(x + 1, y, from);
      if (y > 0) push(x, y - 1, from); if (y < h - 1) push(x, y + 1, from);
    }
  } else for (let p = 0; p < w * h; p++) bg[p] = d[p * 4 + 3] < 8 ? 1 : 0;

  let grow = false;
  if (opt.punch.length) {   // enclosed holes: flood from a seed given in cutout units, by likeness to the seed colour
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!bg[y * w + x]) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const pad = 3; bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);
    for (const [u, v] of opt.punch) {
      const sx = Math.round(bx0 + u * (bx1 - bx0)), sy = Math.round(by0 + v * (by1 - by0));
      if (!(sx >= 0 && sy >= 0 && sx < w && sy < h)) continue;
      const si = (sy * w + sx) * 4, sr = d[si], sg = d[si + 1], sb = d[si + 2], st = [sy * w + sx];
      bg[sy * w + sx] = 1;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p / w) | 0;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx, i = np * 4;
          if (bg[np]) continue;
          if (Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb) > opt.punchTol
            || Math.hypot(d[i] - d[p * 4], d[i + 1] - d[p * 4 + 1], d[i + 2] - d[p * 4 + 2]) > 12) continue;
          bg[np] = 1; st.push(np);
        }
      }
    }
    grow = true;
  }

  // mask -> grow the background by 1 px (eats the fringe), then feather
  const mk = skiaCanvas(w, h), mg = mk.getContext('2d'), mi = mg.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    let b = bg[p];
    if (!b && (!opt.keep || grow)) {
      const x = p % w, y = (p / w) | 0;
      if ((x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w])) b = 1;
    }
    mi.data[p * 4 + 3] = b ? 0 : 255;
  }
  mg.putImageData(mi, 0, 0);
  const soft = skiaCanvas(w, h), sg = soft.getContext('2d');
  sg.filter = 'blur(0.8px)'; sg.drawImage(mk, 0, 0); sg.filter = 'none';
  sg.globalCompositeOperation = 'source-in'; sg.drawImage(cv, 0, 0);   // the image keeps its own alpha under the mask

  // bounding box of what is left
  const a = sg.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0, kept = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 24) {
    kept++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!kept) return { error: 'nothing left after the cut: lower --tol' };
  const pad = 3; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = skiaCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(soft, -x0, -y0);
  return { canvas: out, kept: kept / (w * h) };
}

// The cutout's alpha traced at alpha > 96 (v1 _profile's threshold), in the cutout's own pixels.
export function silhouette(canvas) {
  const { width: w, height: h } = canvas;
  return traceAlpha(canvas.getContext('2d').getImageData(0, 0, w, h).data, w, h, { threshold: 96, size: 256, eps: 0.6 });
}

// The cutout's own palette (plan S1): opaque pixels posterised to 5 bits per channel, bins within MERGE of a
// kept colour folded into it, the biggest 8 by area. `area` is the share of the cutout's opaque pixels, so a
// few large flat colours come first -- which is the order derive({ from }) hands to `fills`.
const MERGE = 40, KEEP = 8, MAX_BINS = 64;
export function colours(canvas, sil) {
  const { width: w, height: h } = canvas, cv = skiaCanvas(w, h), g = cv.getContext('2d');
  if (sil?.sub?.length) {     // only what the traced silhouette encloses counts, holes included
    g.beginPath();
    for (const sub of sil.sub) {
      const p = sub.pts;
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
    }
    g.clip('evenodd');
  }
  g.drawImage(canvas, 0, 0);
  const d = g.getImageData(0, 0, w, h).data, bins = new Map();
  let tot = 0;
  for (let p = 0; p < w * h; p++) {
    if (d[p * 4 + 3] < 200) continue;
    const r = d[p * 4], gg = d[p * 4 + 1], b = d[p * 4 + 2], k = ((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3);
    let e = bins.get(k);
    if (!e) bins.set(k, e = [0, 0, 0, 0]);
    e[0] += r; e[1] += gg; e[2] += b; e[3]++; tot++;
  }
  if (!tot) return [];
  const kept = [];
  for (const [, e] of [...bins].sort((a, b) => b[1][3] - a[1][3] || a[0] - b[0])) {
    const r = e[0] / e[3], gg = e[1] / e[3], b = e[2] / e[3];
    let near = null, best = MERGE;
    for (const c of kept) {
      const dd = Math.hypot(c[0] / c[3] - r, c[1] / c[3] - gg, c[2] / c[3] - b);
      if (dd < best) { best = dd; near = c; }
    }
    if (near) for (let i = 0; i < 4; i++) near[i] += e[i];
    else if (kept.length < MAX_BINS) kept.push([...e]);
  }
  return kept.sort((a, b) => b[3] - a[3]).slice(0, KEEP)
    .map((c) => ({ hex: css([c[0] / c[3], c[1] / c[3], c[2] / c[3]]), area: +(c[3] / tot).toFixed(4) }));
}

const swatches = (cols) => cols.map((c) => `${c.hex} ${(c.area * 100).toFixed(0)}%`).join('  ');

// --refresh: re-read a written module and give every cutout its `colours`, without touching the matte.
async function refresh(file) {
  const abs = resolve(file);
  if (!existsSync(abs)) throw usage(`photo: no such file '${file}'`);
  const mod = await import(`${pathToFileURL(abs).href}?t=${Date.now()}`);
  const recs = Object.values(mod.default ?? mod.PHOTOS ?? {});
  if (!recs.length) { process.stderr.write(`photo: no cutouts in ${file}\n`); return 1; }
  const out = [];
  for (const rec of recs) {
    const img = await loadImage(rec.src), cv = skiaCanvas(rec.w, rec.h);
    cv.getContext('2d').drawImage(img, 0, 0, rec.w, rec.h);
    const cols = colours(cv, rec.sil);
    out.push({ ...rec, colours: cols });
    process.stdout.write(`${rec.name}: ${swatches(cols)}\n`);
  }
  writeRecords(abs, out);
  process.stdout.write(`${out.length} cutouts refreshed -> ${abs}\n`);
  return 0;
}

async function dataURL(canvas) {
  try {
    const buf = await canvas.toBuffer('webp', { quality: 0.92 });
    if (buf.subarray(0, 4).toString() === 'RIFF') return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch { /* no webp encoder: png below */ }
  return `data:image/png;base64,${(await canvas.toBuffer('png')).toString('base64')}`;
}

// Left: the cutout on magenta with the silhouette in blue. Right: on paper with the u,v grid every 0.1.
function checkSheet(img, sil) {
  const cw = img.width, chh = img.height, s = 760 / Math.max(cw, chh), sw = Math.round(cw * s), sh = Math.round(chh * s);
  const sheet = skiaCanvas(2 * (sw + 80), sh + 80), q = sheet.getContext('2d');
  q.fillStyle = '#ff00c8'; q.fillRect(0, 0, sw + 80, sh + 80); q.drawImage(img, 40, 40, sw, sh);
  q.fillStyle = '#f3ead8'; q.fillRect(sw + 80, 0, sw + 80, sh + 80); q.drawImage(img, sw + 120, 40, sw, sh);
  const outline = (ox, colour, lw) => {
    q.beginPath();
    for (const sub of sil.sub) {
      const p = sub.pts;
      q.moveTo(ox + p[0] * s, 40 + p[1] * s);
      for (let i = 2; i < p.length; i += 2) q.lineTo(ox + p[i] * s, 40 + p[i + 1] * s);
      q.closePath();
    }
    q.strokeStyle = colour; q.lineWidth = lw; q.lineJoin = 'round'; q.stroke();
  };
  outline(40, '#0040ff', 2);
  outline(sw + 120, 'rgba(0,64,255,.45)', 1);
  q.font = '13px Menlo, monospace'; q.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const u = i / 10, x = sw + 120 + u * sw, y = 40 + u * sh;
    q.strokeStyle = i % 5 ? 'rgba(0,80,255,.35)' : 'rgba(0,80,255,.8)';
    q.beginPath(); q.moveTo(x, 40); q.lineTo(x, 40 + sh); q.moveTo(sw + 120, y); q.lineTo(sw + 120 + sw, y); q.stroke();
    q.fillStyle = '#0038b8'; q.fillText(u.toFixed(1), x - 9, 30); q.fillText(u.toFixed(1), sw + 88, y + 4);
  }
  q.fillStyle = '#ffffff';
  q.fillText(`${cw}x${chh}  ${sil.sub.length} subs  ${sil.sub.reduce((n, t) => n + t.pts.length / 2, 0)} pts`, 40, sh + 64);
  return sheet;
}

// One line per photo: replace the line of an existing name, keep the others, append new ones.
function writeRecords(jsFile, recs) {
  const prefix = (n) => `PHOTOS[${JSON.stringify(n)}] = `;
  let lines = existsSync(jsFile) ? readFileSync(jsFile, 'utf8').split('\n').filter((l) => l.startsWith('PHOTOS[')) : [];
  for (const r of recs) {
    const line = `${prefix(r.name)}${JSON.stringify(r)};`;
    const at = lines.findIndex((l) => l.startsWith(prefix(r.name)));
    if (at >= 0) lines[at] = line; else lines.push(line);
  }
  writeFileSync(jsFile, [...HEAD, ...lines, ''].join('\n'));
}

// v1 photos.js: `registerPhoto("name", {...json...});` lines. The images are already cut out: keep them, trace.
async function convertV1(v1File, jsFile, outDir) {
  if (!existsSync(v1File)) throw usage(`photo: no such file '${v1File}'`);
  const recs = [];
  for (const l of readFileSync(v1File, 'utf8').split('\n')) {
    const m = l.match(/^registerPhoto\(("(?:[^"\\]|\\.)*"),\s*(\{.*\})\);?\s*$/);
    if (!m) continue;
    const name = JSON.parse(m[1]), meta = JSON.parse(m[2]);
    const img = await loadImage(meta.src);
    const w = meta.w ?? img.width, h = meta.h ?? img.height;
    const cv = skiaCanvas(w, h);
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const sil = silhouette(cv);
    recs.push({ name, credit: meta.credit ?? '', source: meta.source ?? '', src: meta.src, w, h, sil, colours: colours(cv, sil) });
    const sheet = join(outDir, `photo-${name}.jpg`);
    await checkSheet(cv, sil).toFile(sheet, { quality: 0.9 });
    process.stdout.write(`${name}: ${w}x${h}, ${sil.sub.length} subs / ${sil.sub.reduce((n, s) => n + s.pts.length / 2, 0)} pts `
      + `[${sil.sub.map((s) => s.pts.length / 2).join(' ')}], ${(meta.src.length / 1024).toFixed(0)} KB, sheet ${sheet}\n`);
  }
  if (!recs.length) { process.stderr.write(`photo: no registerPhoto lines in ${v1File}\n`); return 1; }
  writeRecords(jsFile, recs);
  process.stdout.write(`${recs.length} cutouts -> ${jsFile}\n`);
  return 0;
}

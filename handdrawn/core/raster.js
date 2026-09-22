// The rasteriser: draws a display list on any Canvas 2D context, browser or skia-canvas. Ops that need
// expanding (paper, night, text, finished fills) are expanded as they are reached, memoised by content.
//
// Layer cache (plan 1.5). A group whose device transform is a translation with an optional x-flip (and a
// uniform scale) is cacheable. Its translation snaps to whole output pixels, and it is always composited
// as one isolated layer: drawn into a transparent canvas, then blitted. Compositing a translucent layer
// rounds differently (8-bit premultiplied) from drawing its strokes straight onto the paper, so isolating
// every time is what makes a cached frame, an uncached one, and any split across workers the same pixels.
// The key is the group's content (kids' hashes, not its position) + the look + the device scale + the
// frame size. First sighting of a key draws through a reused scratch canvas; the second rasterises to a
// layer that is kept in an LRU bounded by bytes. Groups marked cache: 'never' (place() with rot or scale)
// draw direct, as do groups containing stock (paper, night draw in screen space; the stock group itself is
// cached) and groups whose layer would exceed a few viewports.
import { bounds, hashData, hashList, hashOp, norm, walk } from './list.js';
import { alpha as withAlpha, hashLook, innerLook, resolveLook, resolveRole } from './looks.js';
import { covAt, expand, expandOp, needsExpand } from './finish.js';
import { drawFx } from './fx.js';
import { drawStroke, tracePath } from './tools.js';
import { rng } from './rand.js';
import { frame } from './tree.js';
import { format } from './fit.js';
import { sourceFor } from './sources.js';

const TAU = Math.PI * 2;
const EPS = 1e-6;
const LAYER_PAD = 8;       // logical units around a layer's bounds: pen wobble and chalk dashes overshoot boxes
const MAX_LAYER = 4;       // a layer larger than this many viewports draws direct instead

// blend 'wash' (watercolour) multiplies, except on a chalk pass (nightShot) where it lies on top, dimmer.
export function applyBlend(ctx, blend, look) {
  if (!blend) return;
  if (blend === 'wash') {
    if (look.chalkPass) ctx.globalAlpha *= 0.6;
    else ctx.globalCompositeOperation = 'multiply';
    return;
  }
  ctx.globalCompositeOperation = blend;
}

// A gradient for a cov descriptor: the role's colour at alpha c0 fading to c1 (plan 1.2 cov on a flat fill).
function covStyle(ctx, cov, colour) {
  let g;
  if (cov.kind === 'radial') g = ctx.createRadialGradient(cov.x, cov.y, cov.r0 ?? 0, cov.x, cov.y, cov.r1);
  else if (cov.kind === 'linear') g = ctx.createLinearGradient(cov.x0, cov.y0, cov.x1, cov.y1);
  else throw new Error(`fill: cov '${cov.kind}' only works on dots and plates; flat fills take a number, radial or linear`);
  const stops = cov.stops ?? [[0, cov.c0 ?? 1], [1, cov.c1 ?? 0]];
  for (const [at, a] of stops) g.addColorStop(at, withAlpha(colour, Math.max(0, Math.min(1, a))));
  return g;
}

function drawFill(ctx, op, look) {
  const colour = resolveRole(op.role, look);
  ctx.save();
  // On no stock (~alpha) a wash brings its paper: the sheet's colour goes in behind what is already drawn,
  // inside the wash's own path, so the wash multiplies onto paper as it would on the page and a body stays a
  // body over a photograph. Outside every wash the frame stays transparent; a plain translucent fill (a
  // shadow) stays translucent.
  if (look.alpha && op.blend === 'wash' && !look.chalkPass) {
    ctx.save();
    ctx.fillStyle = resolveRole('paper', look);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.beginPath();
    tracePath(ctx, op.path);
    ctx.fill(op.rule === 'nonzero' ? 'nonzero' : 'evenodd');
    ctx.restore();
  }
  if (op.cov !== undefined && typeof op.cov === 'object') ctx.fillStyle = covStyle(ctx, op.cov, colour);
  else { ctx.fillStyle = colour; if (typeof op.cov === 'number') ctx.globalAlpha *= op.cov; }
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  applyBlend(ctx, op.blend, look);
  ctx.beginPath();
  tracePath(ctx, op.path);
  ctx.fill(op.rule === 'nonzero' ? 'nonzero' : 'evenodd');
  ctx.restore();
}

// Halftone dots clipped to the path; coverage (cov: number or descriptor, see finish.js covAt) sets the
// dot area per cell, capped at maxCov (v1 dotScreen and printPlate). Cells under 0.03 are skipped.
function drawDots(ctx, op, look) {
  const { cell = 8, angle = 0, jitter = 0, maxCov = 1 } = op, cov = op.cov ?? op.density ?? 0.5;
  if (typeof cov === 'number' && cov <= 0) return;
  const r = rng(op.seed ?? 1), [bx, by, bw, bh] = op.path.box, cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle), flat = typeof cov === 'number', min = cov.kind === 'plate' ? 0.03 : 0;
  ctx.save();
  ctx.beginPath(); tracePath(ctx, op.path); ctx.clip('evenodd');
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  applyBlend(ctx, op.blend, look);
  ctx.beginPath();
  for (let v = -R; v <= R; v += cell) for (let u = -R; u <= R; u += cell) {
    const x = cx + ca * u - sa * v + (r() - 0.5) * jitter * cell, y = cy + sa * u + ca * v + (r() - 0.5) * jitter * cell;
    if (x < bx - cell || y < by - cell || x > bx + bw + cell || y > by + bh + cell) continue;
    const d = Math.min(maxCov, flat ? cov : covAt(cov, x, y));
    if (d <= min) continue;
    const rad = cell * 0.62 * Math.sqrt(d);
    ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

// A registered asset (film.assets[src], decoded by the driver into `images`). The chalk pass of nightShot
// draws images as erasers, so chalk lines never cross a photo.
// A src with a registered prefix (core/sources.js) is computed by its engine at the op's device size.
function drawImage(ctx, op, look, env) {
  let img = env.images?.get?.(op.src) ?? env.images?.[op.src];
  if (!img) {
    const source = sourceFor(op.src);
    if (source) {
      const D = ctx.getTransform(), k = Math.hypot(D.a, D.b);
      img = source(op.src, { w: Math.max(1, Math.round(op.w * k)), h: Math.max(1, Math.round(op.h * Math.hypot(D.c, D.d))), makeCanvas: env.makeCanvas });
    }
  }
  if (!img) throw new Error(`image '${op.src}' is not loaded (register it in film({ assets }) and let the driver decode it)`);
  ctx.save();
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  applyBlend(ctx, op.blend, look);
  if (look.chalkPass) ctx.globalCompositeOperation = 'destination-out';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, op.x, op.y, op.w, op.h);
  ctx.restore();
}

// An image on a projected grid (engines/stage3d.js): { op: 'mesh', src, n, grid: [x, y, ...] ((n+1)^2 points,
// NaN for a point behind the camera), alpha, dark }. Each cell is two triangles, each an affine map of the
// image, clipped to itself grown by 0.9 units so the seams close (v1 paper3d quad3). dark (0..1) shades the
// image towards a violet black, the way the lamp shades a sheet turned away from it.
const MESH_DARK = '24,14,30';
function meshTri(c, img, u0, v0, u1, v1, u2, v2, x0, y0, x1, y1, x2, y2) {
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(det) < 1e-9) return;
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det, b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
  const cc = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  const e = x0 - a * u0 - cc * v0, f = y0 - b * u0 - d * v0, mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;
  const g = (x, y) => { const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy) || 1, k = (l + 0.9) / l; return [mx + dx * k, my + dy * k]; };
  const A = g(x0, y0), B = g(x1, y1), C = g(x2, y2);
  c.save();
  c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.closePath(); c.clip();
  c.transform(a, b, cc, d, e, f);
  c.drawImage(img, 0, 0);
  c.restore();
}
function drawMesh(ctx, op, look, env) {
  const q = op.grid, n = op.n, P = (i, j) => 2 * (j * (n + 1) + i);
  let img = env.images?.get?.(op.src) ?? env.images?.[op.src];
  if (!img) {
    const source = sourceFor(op.src);
    if (source) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < q.length; k += 2) if (q[k] === q[k]) { x0 = Math.min(x0, q[k]); x1 = Math.max(x1, q[k]); y0 = Math.min(y0, q[k + 1]); y1 = Math.max(y1, q[k + 1]); }
      const D = ctx.getTransform(), k = Math.hypot(D.a, D.b);
      img = source(op.src, { w: Math.max(1, Math.round((x1 - x0) * k)), h: Math.max(1, Math.round((y1 - y0) * k)), makeCanvas: env.makeCanvas });
    }
  }
  if (!img) throw new Error(`mesh: image '${op.src}' is not loaded`);
  const dark = op.dark ?? 0, target = dark > 0.01 && env.temp ? env.temp(`mesh:${env.depth ?? 0}`, ctx.canvas.width, ctx.canvas.height) : null;
  const g = target ? target.getContext('2d') : ctx;
  if (target) { const m = ctx.getTransform(); g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); }
  g.save();
  if (!target && op.alpha !== undefined) g.globalAlpha *= op.alpha;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const tw = img.width, th = img.height;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
    if (q[a] !== q[a] || q[b] !== q[b] || q[c] !== q[c] || q[d] !== q[d]) continue;   // a cell behind the camera
    const u0 = i / n * tw, u1 = (i + 1) / n * tw, v0 = j / n * th, v1 = (j + 1) / n * th;
    meshTri(g, img, u0, v0, u1, v0, u0, v1, q[a], q[a + 1], q[b], q[b + 1], q[c], q[c + 1]);
    meshTri(g, img, u1, v0, u1, v1, u0, v1, q[b], q[b + 1], q[d], q[d + 1], q[c], q[c + 1]);
  }
  g.restore();
  if (!target) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(${MESH_DARK},${Math.min(0.85, dark)})`;
  g.fillRect(0, 0, target.width, target.height);
  g.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.drawImage(target, 0, 0);
  ctx.restore();
}

function drawSpecks(ctx, op, look) {
  const q = op.rects;
  ctx.save();
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.beginPath();
  for (let i = 0; i < q.length; i += 4) ctx.rect(q[i], q[i + 1], q[i + 2], q[i + 3]);
  ctx.fill();
  ctx.restore();
}

// ---------- the cache ----------

function clampBox(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x1 <= x0 || y1 <= y0 ? null : [x0, y0, x1 - x0, y1 - y0];
}

// Ops whose pixels depend on what is already under them (multiply, screen, the fx that composite against
// the canvas). In an isolated layer that backdrop is transparent, so a group holding one draws direct.
const BACKDROP_FX = new Set(['nightShot', 'bleed', 'glow', 'flash']);
// And the fx that paint past their kids' bounds (the iris's outside fill, the blot's fringe, the scribble's
// offset copies, mosaic edge cells, the eraser): a layer sized from bounds() would crop them, so they draw direct too.
const OVERFLOW_FX = new Set(['iris', 'blot', 'scribble', 'mosaic', 'erase']);
const blendsWithBackdrop = (o) => (!!o.blend && o.blend !== 'source-over') || (o.op === 'stroke' && o.tool === 'marker') || (o.op === 'fx' && (BACKDROP_FX.has(o.kind) || OVERFLOW_FX.has(o.kind)));

// Content key of a group: its kids' hashes (seeds are in the kids), independent of where it is placed.
// null when the group holds stock, which draws in screen space and so depends on its position.
const contentMemo = new WeakMap();
function contentKey(op) {
  let k = contentMemo.get(op);
  if (k !== undefined) return k;
  let pinned = false;
  walk(op.kids, (o) => {
    if (o.op === 'paper' || o.op === 'night' || (o.op === 'group' && o.screen) || blendsWithBackdrop(o)) { pinned = true; return false; }
  });
  k = pinned ? null : hashData(op.kids.map(hashOp));
  contentMemo.set(op, k);
  return k;
}

// Least recently used layers, bounded by bytes (w * h * 4 each).
function lru(limit) {
  const map = new Map();
  let bytes = 0;
  const stats = { evictions: 0 };
  return {
    stats,
    get bytes() { return bytes; },
    get size() { return map.size; },
    get(key) {
      const v = map.get(key);
      if (v) { map.delete(key); map.set(key, v); }
      return v;
    },
    put(key, v) {
      if (v.bytes > limit) return;
      map.set(key, v);
      bytes += v.bytes;
      while (bytes > limit) {
        const [k0, v0] = map.entries().next().value;
        map.delete(k0);
        bytes -= v0.bytes;
        stats.evictions++;
      }
    },
    clear() { map.clear(); bytes = 0; },
  };
}

function defaultMakeCanvas() {
  if (typeof OffscreenCanvas === 'function') return (w, h) => new OffscreenCanvas(w, h);
  if (typeof document === 'object') return (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  return null;
}

// createRenderer({ cacheMb = 512, makeCanvas, store, dedup = true })
//   makeCanvas(w, h)  a canvas for layers (Node: skia Canvas; browser default: OffscreenCanvas). Without
//                     one, groups draw direct (not isolated, so pixels can differ from a renderer that has one).
//   cacheMb           LRU budget for kept layers; 0 keeps none (groups still composite through scratch).
//   store             optional disk tier: { get(key) => { canvas, lx, ly } | null, put(key, layer) }.
//   dedup             frame(): a frame whose list hash equals the previous one's returns { dup: true }
//                     without drawing (the canvas still holds it); the driver repeats the last buffer.
//   images            Map (or object) asset id -> decoded image, for image ops (loadImages in the drivers).
//   bake(canvas, w, h) turns a kept layer into pixels (Node: skia canvases record commands, so blitting an
//                     unbaked layer replays every stroke in it; a browser canvas is pixels already).
export function createRenderer({ cacheMb = 512, makeCanvas = defaultMakeCanvas(), store = null, dedup = true, images = null, bake = null } = {}) {
  const isolate = !!makeCanvas, keep = cacheMb > 0;
  const layers = lru(cacheMb * 1024 * 1024);
  let seen = new Set();
  const stats = { direct: 0, blits: 0, layers: 0, scratch: 0, disk: 0, dups: 0, frames: 0 };
  let last = null;
  const scratch = [];   // one canvas per nesting depth, reused while the size holds

  // Full-size canvases for fx that composite their kids off screen (mosaic, nightShot, bleed), one per slot
  // and nesting depth, cleared on handout.
  const temps = new Map();
  function temp(slot, w, h) {
    if (!makeCanvas) throw new Error(`fx needs an offscreen canvas; createRenderer({ makeCanvas }) was not given one`);
    let c = temps.get(slot);
    if (!c || c.width !== w || c.height !== h) { c = makeCanvas(w, h); temps.set(slot, c); }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return c;
  }

  // Exactly w x h: a canvas's size reaches the pixels of what is drawn in it (fx size their offscreen canvases
  // from it), so a scratch canvas that kept the largest size seen would make a frame depend on render history.
  function scratchAt(depth, w, h) {
    let c = scratch[depth];
    if (!c || c.width !== w || c.height !== h) {
      c = makeCanvas(w, h);
      scratch[depth] = c;
    }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);   // all of it: a recording canvas (skia) only drops its history on a full clear
    return c;
  }

  // The group's kids drawn into a canvas whose pixel (0, 0) sits at device (e + lx, f + ly).
  // null: too large to isolate (draw direct). { empty }: nothing to draw.
  function rasterise(op, look, env, a, d, temp) {
    const kids = expand(op.kids, look, env);
    let b = bounds(kids);
    // A screen-space group never moves, so its layer only needs the part inside the frame.
    if (b && op.screen) b = clampBox(b, [0, 0, env.W, env.H]);
    if (!b) return { empty: true, bytes: 0 };
    const X0 = a * (b[0] - LAYER_PAD), X1 = a * (b[0] + b[2] + LAYER_PAD);
    const lx = Math.floor(Math.min(X0, X1)) - 1, ly = Math.floor(d * (b[1] - LAYER_PAD)) - 1;
    const w = Math.ceil(Math.max(X0, X1)) + 1 - lx, h = Math.ceil(d * (b[1] + b[3] + LAYER_PAD)) + 1 - ly;
    if (w * h > env.maxArea) return null;
    const canvas = temp ? scratchAt(env.depth, w, h) : makeCanvas(w, h), g = canvas.getContext('2d');
    g.save();
    g.setTransform(a, 0, 0, d, -lx, -ly);
    drawList(g, kids, look, { ...env, depth: env.depth + 1 });
    g.restore();
    stats[temp ? 'scratch' : 'layers']++;
    return { canvas: !temp && bake ? bake(canvas, w, h) : canvas, lx, ly, w, h, bytes: w * h * 4 };
  }

  // Composites an isolated group; false means "draw it direct" (and the caller does).
  // The context's transform is already the snapped device transform [a, 0, 0, d, e, f].
  function isolated(ctx, op, look, env, a, d, e, f) {
    const content = contentKey(op);
    if (content === null) return false;
    const key = `${content}.${hashLook(look)}.${a.toFixed(6)}.${d.toFixed(6)}.${env.W}x${env.H}`;
    let layer = keep ? layers.get(key) : null;
    if (!layer && keep && store) {
      layer = store.get(key);
      if (layer) {
        layer.w ??= layer.canvas.width; layer.h ??= layer.canvas.height; layer.bytes ??= layer.w * layer.h * 4;
        layers.put(key, layer);
        stats.disk++;
      }
    }
    if (layer) stats.blits++;
    else if (keep && seen.has(key)) {
      layer = rasterise(op, look, env, a, d, false);
      if (!layer) return false;
      layers.put(key, layer);
      if (store && !layer.empty) store.put(key, layer);
    } else {
      if (keep) { if (seen.size > 100000) seen = new Set(); seen.add(key); }
      layer = rasterise(op, look, env, a, d, true);
      if (!layer) return false;
    }
    if (!layer.empty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.canvas, 0, 0, layer.w, layer.h, e + layer.lx, f + layer.ly, layer.w, layer.h);
    }
    return true;
  }

  function drawGroup(ctx, op, look, env) {
    ctx.save();
    if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;   // applied to the composited layer when isolated
    if (op.screen) ctx.setTransform(env.S, 0, 0, env.S, 0, 0);
    else ctx.transform(...op.xf);
    const D = ctx.getTransform();
    if (op.cache !== 'never' && Math.abs(D.b) < EPS && Math.abs(D.c) < EPS && D.d > 0 && Math.abs(Math.abs(D.a) - D.d) < EPS) {
      const e = Math.round(D.e), f = Math.round(D.f);
      ctx.setTransform(D.a, 0, 0, D.d, e, f);
      if (isolate && isolated(ctx, op, look, env, D.a, D.d, e, f)) { ctx.restore(); return; }
    }
    stats.direct++;
    drawList(ctx, op.kids, look, env);
    ctx.restore();
  }

  function drawList(ctx, ops, look, env) {
    for (const op of ops) {
      // nightShot's chalk pass redraws only the drawing: no stock, no day-only fills (shadows, backdrop light),
      // no glows (they are lights, screened once over the finished shot).
      if (look.chalkPass && (op.op === 'paper' || op.op === 'night' || op.day || (op.op === 'fx' && op.kind === 'glow'))) continue;
      if (needsExpand(op, look)) { drawList(ctx, expandOp(op, look, env), look, env); continue; }
      switch (op.op) {
        case 'fill': drawFill(ctx, op, look); break;
        case 'stroke': drawStroke(ctx, op, look, env.S); break;
        case 'dots': drawDots(ctx, op, look); break;
        case 'specks': drawSpecks(ctx, op, look); break;
        case 'group': drawGroup(ctx, op, look, env); break;
        case 'clip': {
          ctx.save();
          ctx.beginPath(); tracePath(ctx, op.path); ctx.clip('evenodd');
          drawList(ctx, op.kids, look, env);
          ctx.restore();
          break;
        }
        case 'fx': drawFx(ctx, op, (g = ctx, lk = look) => drawList(g, op.kids, lk, env), look, env); break;
        case 'look': drawList(ctx, op.kids, innerLook(op.look, look), env); break;
        case 'meta': break;
        case 'image': drawImage(ctx, op, look, env); break;
        case 'mesh': drawMesh(ctx, op, look, env); break;
        default: throw new Error(`raster: unknown op '${op.op}'`);
      }
    }
  }

  // Draws a list (expanded or not). S maps logical units to output pixels; W, H are the logical frame.
  function draw(ctx, list, { look, S = 1, W = 1080, H = 1080 } = {}) {
    const area = (ctx.canvas?.width ?? W * S) * (ctx.canvas?.height ?? H * S);
    ctx.save();
    ctx.setTransform(S, 0, 0, S, 0, 0);
    drawList(ctx, norm(list), resolveLook(look), { S, W, H, maxArea: MAX_LAYER * area, depth: 0, images, makeCanvas, temp, bake });
    ctx.restore();
  }

  // Draws drawn frame i of a film onto ctx (sized outW x outH). Returns frame()'s result, plus dup: true
  // when the frame repeats the one drawn just before on the same context (nothing is drawn then).
  function renderFrame(ctx, film, i, { ar, width } = {}) {
    const f = frame(film, i, { ar });
    const fmt = ar ? format(ar) : film.format;
    const { S, W, H, outW, outH } = outputSize(fmt, width);
    stats.frames++;
    if (dedup) {
      const h = `${film.name}:${hashLook(film.look)}:${outW}x${outH}:${hashList(f.list)}`;
      const dup = last && last.ctx === ctx && last.h === h;
      last = { ctx, h };
      if (dup) { stats.dups++; return { ...f, dup: true }; }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    ctx.restore();
    draw(ctx, f.list, { look: film.look, S, W, H });
    return { ...f, dup: false };
  }

  return {
    draw, render: draw, renderFrame, stats,
    cache: { get bytes() { return layers.bytes; }, get size() { return layers.size; }, get evictions() { return layers.stats.evictions; } },
    forget() { last = null; },   // the next frame is drawn even if it repeats the last one
    reset() { layers.clear(); seen = new Set(); last = null; },
  };
}

// Output size for a format at an output width (v1 setFormat): even pixel sizes, S from the height.
export function outputSize(fmt, width = fmt.W) {
  let S = width / fmt.W;
  const outH = 2 * Math.round(fmt.H * S / 2);
  S = outH / fmt.H;
  return { W: fmt.W, H: fmt.H, S, outW: 2 * Math.round(fmt.W * S / 2), outH };
}

// Uncached, undeduplicated conveniences (tests, one-off stills). Same pixels as a cached renderer given
// the same kind of canvas.
const plain = createRenderer({ cacheMb: 0, dedup: false });
export const draw = plain.draw;
export const render = plain.draw;
export const renderFrame = plain.renderFrame;

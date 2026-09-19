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
import { hashLook, resolveLook, resolveRole } from './looks.js';
import { expand, expandOp, needsExpand } from './finish.js';
import { drawFx } from './fx.js';
import { drawStroke, tracePath } from './tools.js';
import { rng } from './rand.js';
import { frame } from './tree.js';
import { format } from './fit.js';

const TAU = Math.PI * 2;
const EPS = 1e-6;
const LAYER_PAD = 8;       // logical units around a layer's bounds: pen wobble and chalk dashes overshoot boxes
const MAX_LAYER = 4;       // a layer larger than this many viewports draws direct instead

function drawFill(ctx, op, look) {
  ctx.save();
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.beginPath();
  tracePath(ctx, op.path);
  ctx.fill('evenodd');
  ctx.restore();
}

// Halftone dots clipped to the path; density (0..1) sets the dot area per cell (v1 dotScreen).
function drawDots(ctx, op, look) {
  const { cell = 8, angle = 0, jitter = 0 } = op, dens = op.cov ?? op.density ?? 0.5;
  if (typeof dens !== 'number') throw new Error("dots: coverage descriptors (radial, linear) land in P5; pass a number");
  if (dens <= 0) return;
  const r = rng(op.seed ?? 1), [bx, by, bw, bh] = op.path.box, cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle), rad = cell * 0.62 * Math.sqrt(Math.min(1, dens));
  ctx.save();
  ctx.beginPath(); tracePath(ctx, op.path); ctx.clip('evenodd');
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  if (op.blend) ctx.globalCompositeOperation = op.blend;
  ctx.beginPath();
  for (let v = -R; v <= R; v += cell) for (let u = -R; u <= R; u += cell) {
    const x = cx + ca * u - sa * v + (r() - 0.5) * jitter * cell, y = cy + sa * u + ca * v + (r() - 0.5) * jitter * cell;
    ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU);
  }
  ctx.fill();
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

// Content key of a group: its kids' hashes (seeds are in the kids), independent of where it is placed.
// null when the group holds stock, which draws in screen space and so depends on its position.
const contentMemo = new WeakMap();
function contentKey(op) {
  let k = contentMemo.get(op);
  if (k !== undefined) return k;
  let pinned = false;
  walk(op.kids, (o) => {
    if (o.op === 'paper' || o.op === 'night' || (o.op === 'group' && o.screen)) { pinned = true; return false; }
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
export function createRenderer({ cacheMb = 512, makeCanvas = defaultMakeCanvas(), store = null, dedup = true } = {}) {
  const isolate = !!makeCanvas, keep = cacheMb > 0;
  const layers = lru(cacheMb * 1024 * 1024);
  let seen = new Set();
  const stats = { direct: 0, blits: 0, layers: 0, scratch: 0, disk: 0, dups: 0, frames: 0 };
  let last = null;
  const scratch = [];   // one reusable canvas per nesting depth

  function scratchAt(depth, w, h) {
    let c = scratch[depth];
    if (!c || c.width < w || c.height < h) {
      c = makeCanvas(Math.max(w, c?.width ?? 0), Math.max(h, c?.height ?? 0));
      scratch[depth] = c;
    }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
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
    return { canvas, lx, ly, w, h, bytes: w * h * 4 };
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
      if (needsExpand(op)) { drawList(ctx, expandOp(op, look, env), look, env); continue; }
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
        case 'fx': drawFx(ctx, op, () => drawList(ctx, op.kids, look, env), env.S, env); break;
        case 'look': drawList(ctx, op.kids, resolveLook(op.look), env); break;
        case 'meta': break;
        case 'image': throw new Error('raster: image ops are not implemented yet (P5)');
        default: throw new Error(`raster: unknown op '${op.op}'`);
      }
    }
  }

  // Draws a list (expanded or not). S maps logical units to output pixels; W, H are the logical frame.
  function draw(ctx, list, { look, S = 1, W = 1080, H = 1080 } = {}) {
    const area = (ctx.canvas?.width ?? W * S) * (ctx.canvas?.height ?? H * S);
    ctx.save();
    ctx.setTransform(S, 0, 0, S, 0, 0);
    drawList(ctx, norm(list), resolveLook(look), { S, W, H, maxArea: MAX_LAYER * area, depth: 0 });
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

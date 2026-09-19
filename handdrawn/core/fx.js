// Raster effects: an fx op draws its kids through one of these. Each is
// (ctx, args, renderKids, seed, env) where renderKids(target = ctx, look = current) draws the kids on any
// context, and env = { W, H, S, look, temp(slot, w, h) } (temp: a cleared full-size offscreen canvas).
// The context is in the op's logical coordinates. All randomness comes from `seed`. cut(kind, ...) reveals
// its `b` side with fx(kind, { p }), so every transition is one of these; p runs inside (0, 1).
//
// Offscreen fx (mosaic, nightShot, bleed) draw their kids on a canvas the size of the one being drawn on,
// under the same transform, then composite in device pixels; inside a cached group that canvas is the
// group's layer, so they work there too.
import { mix, withLook, resolveRole } from './looks.js';
import { rect, walk, xf as xfPath, bounds } from './list.js';
import { rng } from './rand.js';
import { tracePath } from './tools.js';
import { ease } from './curves.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// The same transform on another context.
const copyTransform = (from, to) => { const m = from.getTransform(); to.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); };

// A canvas like ctx's, with the kids drawn on it under ctx's transform.
function offscreen(ctx, env, slot, renderKids, look) {
  const c = env.temp(`${slot}:${env.depth ?? 0}`, ctx.canvas.width, ctx.canvas.height), g = c.getContext('2d');
  copyTransform(ctx, g);
  renderKids(g, look);
  return c;
}

// Draws a canvas over ctx pixel for pixel.
function blitDevice(ctx, c, { alpha = 1, op = 'source-over', dx = 0, dy = 0 } = {}) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(c, dx, dy);
  ctx.restore();
}

// A frame-sized rectangle in the current coordinates of ctx (so it covers the canvas whatever the transform).
function fillCanvas(ctx, style, alpha = 1, op = 'source-over') {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// A wobbly closed ring for iris edges.
function wobRing(ctx, x, y, r, n, amp, seed) {
  const q = rng(seed);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, px = x + r * Math.cos(a) + (q() - 0.5) * amp, py = y + r * Math.sin(a) + (q() - 0.5) * amp;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

// Hex cell centres covering box (v1 hexCells).
export function hexCentres(box, s) {
  const w = Math.sqrt(3) * s, h = 1.5 * s, [bx, by, bw, bh] = box, out = [];
  let row = 0;
  for (let y = by - s; y < by + bh + s; y += h, row++) {
    const o = row % 2 ? w / 2 : 0;
    for (let x = bx - w + o; x < bx + bw + w; x += w) out.push([x, y]);
  }
  return out;
}
function hexTrace(ctx, x, y, s) {
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6, px = x + s * Math.cos(a), py = y + s * Math.sin(a);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// The palette after nightfall: lines go chalk, bodies go dark, washes stop multiplying (v1 chalkPalette).
const chalkMemo = new WeakMap();
export function chalkLook(look) {
  let l = chalkMemo.get(look);
  if (!l) {
    const p = look.palette;
    l = withLook(look, { name: `${look.name}~chalk`, chalkPass: true, palette: { ink: p.chalk, light: mix(p.night, p.chalk, 0.2) } });
    chalkMemo.set(look, l);
  }
  return l;
}

function radialGlow(ctx, x, y, r, colour, k, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) g.addColorStop(at, withA(colour, a * k));
  return g;
}
const withA = (c, a) => { const m = c.match(/^#([0-9a-f]{6})/i); if (!m) return c; const n = parseInt(m[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`; };

function glowAt(ctx, x, y, r, colour, k) {
  if (k <= 0 || r <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = radialGlow(ctx, x, y, r, colour, k, [[0, 0.9], [0.35, 0.35], [1, 0]]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

// Paths a scribble outlines: every fill (and closed stroke) of the kids, through their groups.
function outlines(kids, only) {
  const out = [];
  walk(kids, (op, m) => {
    if (only && (op.op === 'fill' || op.op === 'stroke') && !only.includes(op.name)) return;
    if (op.op === 'fill' || (op.op === 'stroke' && op.path.sub.some((s) => s.closed))) out.push(xfPath(op.path, m));
    if (op.op === 'fx' && op.kind === 'scribble') return false;
  });
  return out;
}

export const FX = {
  // Kids faded in by p.
  dissolve(ctx, { p = 1 }, renderKids) {
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, p);
    renderKids();
    ctx.restore();
  },

  // Kids revealed left to right (dir: 'left' | 'right' | 'up' | 'down') by p.
  wipe(ctx, { p = 1, dir = 'right' }, renderKids, seed, { W, H }) {
    if (p <= 0) return;
    const q = Math.min(1, p);
    const box = { right: [0, 0, W * q, H], left: [W * (1 - q), 0, W * q, H], down: [0, 0, W, H * q], up: [0, H * (1 - q), W, H * q] }[dir];
    if (!box) throw new Error(`fx wipe: unknown dir '${dir}'`);
    ctx.save();
    ctx.beginPath(); tracePath(ctx, rect(...box)); ctx.clip();
    renderKids();
    ctx.restore();
  },

  // Kids revealed inside a growing ink blot with a bristly fringe (v1 blot). R = r ?? eased p x reach.
  blot(ctx, { p = 1, x, y, r, reach, role = 'night', fringe = 420 }, renderKids, seed, env) {
    const cx = x ?? env.W / 2, cy = y ?? env.H / 2;
    const R = r ?? ease.out(clamp01(p)) * (reach ?? Math.hypot(env.W, env.H) * 0.75);
    if (R <= 0) return;
    const q = rng(seed);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * TAU, rr = R * (1 + (q() - 0.5) * 0.16);
      if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.clip();
    renderKids();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = resolveRole(role, env.look);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha *= 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < fringe; i++) {
      const a = q() * TAU, rad = R * (1 + (q() - 0.5) * 0.14), L = 10 + q() * 38, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
      ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
    }
    ctx.stroke();
    ctx.restore();
  },

  // Kids inside a circle (v1 iris): radius r, or p of the reach; `outside` fills the rest, `ring` draws a
  // wobbly edge.
  iris(ctx, { p = 1, x, y, r, reach, outside, ring, w = 3 }, renderKids, seed, env) {
    const cx = x ?? env.W / 2, cy = y ?? env.H / 2, R = r ?? clamp01(p) * (reach ?? Math.hypot(env.W, env.H) / 2);
    if (outside) {
      ctx.save();
      ctx.fillStyle = resolveRole(outside, env.look);
      ctx.beginPath(); tracePath(ctx, rect(-env.W, -env.H, env.W * 3, env.H * 3)); ctx.fill();
      ctx.restore();
    }
    if (R <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    renderKids();
    ctx.restore();
    if (ring) {
      ctx.save();
      ctx.strokeStyle = resolveRole(ring, env.look);
      ctx.lineWidth = w;
      wobRing(ctx, cx, cy, R, 100, 2, seed);
      ctx.restore();
    }
  },

  // The kids retiled as flat hex cells of size s (at least 12 units), each the colour under its centre,
  // darkened a touch, with thin dark edges and an optional tint over the box (v1 mosaic, compound eye).
  mosaic(ctx, { s = 16, box, edge = { base: 'night', alpha: 0.55 }, tint = { base: 'chalk', alpha: 0.1 } }, renderKids, seed, env) {
    const c = offscreen(ctx, env, 'mosaic', renderKids, env.look), g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height).data, m = ctx.getTransform(), size = Math.max(12, s);
    const b = box ?? [0, 0, env.W, env.H];
    ctx.save();
    ctx.beginPath(); tracePath(ctx, rect(...b)); ctx.clip();
    ctx.lineWidth = 1;
    const edgeCol = edge ? resolveRole(edge, env.look) : null;
    for (const [x, y] of hexCentres(b, size)) {
      const dx = Math.round(m.a * x + m.c * y + m.e), dy = Math.round(m.b * x + m.d * y + m.f);
      const xi = Math.min(c.width - 1, Math.max(0, dx)), yi = Math.min(c.height - 1, Math.max(0, dy)), k = (yi * c.width + xi) * 4;
      if (img[k + 3] < 8) continue;   // nothing drawn under this cell
      ctx.fillStyle = `rgb(${img[k] * 0.92 | 0},${img[k + 1] * 0.92 | 0},${img[k + 2] * 0.95 | 0})`;
      ctx.beginPath(); hexTrace(ctx, x, y, size); ctx.fill();
      if (edgeCol) { ctx.strokeStyle = edgeCol; ctx.stroke(); }
    }
    if (tint) { ctx.fillStyle = resolveRole(tint, env.look); ctx.fillRect(b[0], b[1], b[2], b[3]); }
    ctx.restore();
  },

  // The kids, then a near-white frame over them at k (one drawn frame of flash; as a cut it is all flash).
  flash(ctx, { k = 1, role = { base: 'paper', tint: 0.6 } }, renderKids, seed, env) {
    if (k < 1) renderKids();
    fillCanvas(ctx, resolveRole(role, env.look), clamp01(k));
  },

  // The kids on alternate drawn frames: pass i (and period, v1 flicker); as a cut, from p.
  flicker(ctx, { i, period = 2, p = 0.5, rate = 8 }, renderKids) {
    const on = i !== undefined ? Math.floor(i / period) % 2 === 0 : Math.floor(p * rate) % 2 === 1 || p > 0.85;
    if (on) renderKids();
  },

  // A shot in the dark with moving pools of light (v1 nightShot). The kids are drawn as they are; outside
  // the pools everything is multiplied to night and the kids are drawn again in chalk (chalkLook), masked
  // to the dark, so a line is ink where the light falls and chalk where it does not. Images erase the chalk.
  //   lights: [{ x, y, r, k = 1, glow = .16, role }]
  nightShot(ctx, { k = 0.86, lights = [], role = 'night', glowRole = { base: 'light', mix: ['accents.2', 0.5] } }, renderKids, seed, env) {
    renderKids();
    if (k <= 0) return;
    const w = ctx.canvas.width, h = ctx.canvas.height, M = env.temp(`night:m:${env.depth ?? 0}`, w, h), g = M.getContext('2d');
    g.globalAlpha = clamp01(k);
    g.fillStyle = resolveRole(role, env.look);
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out';
    copyTransform(ctx, g);
    for (const l of lights) {
      if (!(l.r > 0)) continue;
      const lk = l.k ?? 1, gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      [[0, 1], [0.3, 0.92], [0.62, 0.45], [0.85, 0.1], [1, 0]].forEach(([at, a]) => gr.addColorStop(at, `rgba(0,0,0,${a * lk})`));
      g.fillStyle = gr;
      g.beginPath(); g.arc(l.x, l.y, l.r, 0, TAU); g.fill();
    }
    blitDevice(ctx, M, { op: 'multiply' });
    const L = offscreen(ctx, env, 'night:l', renderKids, chalkLook(env.look)), lc = L.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(M, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    blitDevice(ctx, L);
    for (const l of lights) {
      if (l.glow === 0 || !(l.r > 0)) continue;
      const col = resolveRole(l.role ?? glowRole, env.look), gk = (l.glow ?? 0.16) * k;
      glowAt(ctx, l.x, l.y, l.r * 0.55, col, gk);
      glowAt(ctx, l.x, l.y, Math.min(90, l.r * 0.22), col, Math.min(1, gk * 4));
    }
  },

  // Ink bleeding into the paper: the kids smeared a little in n seeded directions at low alpha, then drawn
  // clean on top, so every line and edge widens by about `amt` units.
  bleed(ctx, { amt = 1.5, n = 6, alpha = 0.22 }, renderKids, seed, env) {
    const c = offscreen(ctx, env, 'bleed', renderKids, env.look), q = rng(seed), m = ctx.getTransform(), s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    for (let j = 0; j < n; j++) {
      const a = (j + q() * 0.6) / n * TAU, d = amt * s * (0.6 + q() * 0.5);
      blitDevice(ctx, c, { alpha, op: 'multiply', dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d) });
    }
    blitDevice(ctx, c);
  },

  // The kids, then a soft light screened over them at (x, y) (v1 glow).
  glow(ctx, { x, y, r = 120, role = { base: 'light', mix: ['accents.2', 0.5] }, k = 1 }, renderKids, seed, env) {
    renderKids();
    glowAt(ctx, x ?? env.W / 2, y ?? env.H / 2, r, resolveRole(role, env.look), k);
  },

  // The kids, then their outlines again in accent inks, each copy shifted, turned and scaled a little
  // (riso misregistration, v1 scribble). One or two parts per frame; lint counts them. only: names of the
  // fills (or closed strokes) to outline, when the kids hold more than the part.
  scribble(ctx, { amp = 5, alpha = 0.55, w = 1.1, roles = ['accents.0', 'accents.1', 'accents.2', 'accents.3'], x, y, only }, renderKids, seed, env, kids) {
    renderKids();
    const paths = outlines(kids, only);
    if (!paths.length) return;
    const b = bounds(kids) ?? [0, 0, 0, 0], cx = x ?? b[0] + b[2] / 2, cy = y ?? b[1] + b[3] / 2, q = rng(seed);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    for (const role of roles) {
      ctx.strokeStyle = resolveRole(role, env.look);
      ctx.save();
      ctx.translate(cx + (q() - 0.5) * amp * 2, cy + (q() - 0.5) * amp * 2);
      ctx.rotate((q() - 0.5) * 0.08);
      ctx.scale(1 + (q() - 0.5) * 0.08, 1 + (q() - 0.5) * 0.08);
      ctx.translate(-cx, -cy);
      ctx.beginPath();
      for (const p of paths) tracePath(ctx, p);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },

  // The kids clipped to a cutout's silhouette (a path in the op's coordinates; see photo.js mask()).
  photoMask(ctx, { sil }, renderKids) {
    if (!sil) throw new Error('fx photoMask: needs args.sil (a path)');
    ctx.save();
    ctx.beginPath(); tracePath(ctx, sil); ctx.clip('evenodd');
    renderKids();
    ctx.restore();
  },
};

export function drawFx(ctx, op, renderKids, look, env) {
  const f = FX[op.kind];
  if (!f) throw new Error(`fx '${op.kind}' is unknown (have ${Object.keys(FX).join(', ')})`);
  f(ctx, op.args ?? {}, renderKids, op.seed ?? 1, { ...env, look }, op.kids);
}


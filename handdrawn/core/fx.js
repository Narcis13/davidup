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
import { mkPath, rect, walk, xf as xfPath, bounds } from './list.js';
import { rng } from './rand.js';
import { tracePath, trim } from './tools.js';
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

const chalkMemo = new WeakMap();
// The palette after nightfall: lines go chalk, bodies go dark, washes stop multiplying (v1 chalkPalette).
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

// The eraser's track over box: rows band apart (overlapping a little), left to right then back, each row
// wavering a seeded touch, as { path, len }. One open sub, so trim(path, p x len) is where it has been by p.
export function eraseTrack(box, band, seed) {
  const [bx, by, bw, bh] = box, r = rng(seed), rows = Math.max(1, Math.ceil(bh / (band * 0.85)));
  const step = rows > 1 ? (bh - band) / (rows - 1) : 0, pts = [];
  for (let k = 0; k < rows; k++) {
    const y = by + (rows > 1 ? band / 2 + k * step : bh / 2);
    for (let j = 0; j <= 6; j++) {
      const u = k % 2 ? 6 - j : j;
      pts.push(bx - band * 0.3 + ((bw + band * 0.6) * u) / 6, y + (r() - 0.5) * band * 0.16);
    }
  }
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return { path: mkPath([{ pts, closed: false }]), len };
}

// A board eraser seen from above at (x, y), moving along angle a, broadside to its motion: its shadow, the
// felt, the handle (inks.1) and a highlight.
function drawEraser(ctx, x, y, a, band, look) {
  const L = band * 1.04, D = band * 0.5, box = (dx, dy, w, h, role, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = resolveRole(role, look); ctx.fillRect(dx - w / 2, dy - h / 2, w, h);
  };
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  box(D * 0.12, D * 0.2, D, L, 'ink', 0.18);
  box(0, 0, D, L, { base: 'paper', shade: 0.55 });
  box(D * 0.06, 0, D * 0.8, L * 0.94, 'inks.1');
  box(-D * 0.22, 0, D * 0.14, L * 0.86, 'light', 0.35);
  ctx.restore();
}

// The raster effects by kind, for fx(kind, args, kids) and cut(kind, dur, a, b); each is (ctx, args, ...).
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

  // A board eraser (4.0 L1) swept across box (default the frame) row under row by p. mode 'reveal', what a cut
  // asks for, shows the kids where it has been; 'clear' wipes them away there and leaves a ghost of them at
  // `ghost` alpha, the way a board is never quite clean. band: the eraser's width.
  erase(ctx, { p = 1, mode = 'reveal', box, band, ghost, eraser = true }, renderKids, seed, env) {
    if (mode !== 'reveal' && mode !== 'clear') throw new Error(`fx erase: unknown mode '${mode}' (expected reveal or clear)`);
    const q = clamp01(p), b = box ?? [0, 0, env.W, env.H], bw = band ?? Math.min(env.W, env.H) * 0.14;
    const g0 = ghost ?? (mode === 'clear' ? 0.06 : 0);
    if (q <= 0) { if (mode === 'clear') renderKids(); return; }
    const { path, len } = eraseTrack(b, bw, seed), done = trim(path, len * q);
    const c = offscreen(ctx, env, 'erase', renderKids), k = c.getContext('2d');
    const m = env.temp(`erase-mask:${env.depth ?? 0}`, c.width, c.height), g = m.getContext('2d');
    copyTransform(ctx, g);
    g.lineWidth = bw; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000';
    g.beginPath(); tracePath(g, done); g.stroke();
    k.save();
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.globalCompositeOperation = mode === 'clear' ? 'destination-out' : 'destination-in';
    k.globalAlpha = mode === 'clear' ? 1 - g0 : 1;
    k.drawImage(m, 0, 0);
    k.restore();
    blitDevice(ctx, c, { alpha: mode === 'clear' ? 1 : 1 - g0 });
    if (eraser && q < 1) {
      const pts = done.sub.at(-1).pts, n = pts.length;
      const x = pts[n - 2], y = pts[n - 1], a = n >= 4 ? Math.atan2(y - pts[n - 3], x - pts[n - 4]) : 0;
      drawEraser(ctx, x, y, a, bw, env.look);
    }
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
    if (env.look.alpha) {   // no stock: the night darkens what is drawn, not the transparency around it
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(ctx.canvas, 0, 0);
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

// Kids drawn at 1/q of the resolution (q in logical units) and laid down once at alpha: soft edges (the
// shadows of engines/stage3d.js), and overlapping kids at full strength in the layer do not add up.
FX.soft = function soft(ctx, { q = 10, alpha = 1 }, renderKids, seed, env) {
  if (alpha <= 0) return;
  const D = ctx.getTransform(), qd = Math.max(1, q * Math.hypot(D.a, D.b));
  const cw = Math.max(1, Math.ceil(ctx.canvas.width / qd)), ch = Math.max(1, Math.ceil(ctx.canvas.height / qd));
  const c = env.temp(`soft:${env.depth ?? 0}`, cw, ch), g = c.getContext('2d');
  g.setTransform(D.a / qd, D.b / qd, D.c / qd, D.d / qd, D.e / qd, D.f / qd);
  renderKids(g);
  const src = env.bake ? env.bake(c, cw, ch) : c;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw * qd, ch * qd);
  ctx.restore();
};

export function drawFx(ctx, op, renderKids, look, env) {
  const f = FX[op.kind];
  if (!f) throw new Error(`fx '${op.kind}' is unknown (have ${Object.keys(FX).join(', ')})`);
  f(ctx, op.args ?? {}, renderKids, op.seed ?? 1, { ...env, look }, op.kids);
}


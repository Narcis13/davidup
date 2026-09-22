// Drawing tools: how a stroke op becomes marks on a canvas. Browser and skia contexts are driven the
// same way. All jitter comes from the op's seed, so a stroke boils only when its seed or inputs change.
// Tools: pen (v1 wob), chalk, brush (v1 brush pen), pencil, crayon (v1 crayon), marker, gouache, bullet.
import { hash32, rng } from './rand.js';
import { handOf, resolveLook, resolveRole } from './looks.js';
import { I, mapply, mkPath, mmul, norm, spline, withProps } from './list.js';
import { handText } from './text.js';

const TAU = Math.PI * 2;

// Adds every sub of a path to the context's current path.
export function tracePath(ctx, path) {
  for (const s of path.sub) {
    const p = s.pts;
    if (p.length < 2) continue;
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (s.closed) ctx.closePath();
  }
}

// Each point pushed by up to amp/2 in x and y, one generator across all subs (v1 wob).
function jittered(path, amp, r) {
  return path.sub.map((s) => {
    const pts = new Array(s.pts.length);
    for (let i = 0; i < s.pts.length; i += 2) { pts[i] = s.pts[i] + (r() - 0.5) * amp; pts[i + 1] = s.pts[i + 1] + (r() - 0.5) * amp; }
    return { pts, closed: s.closed };
  });
}

// ---------- the hand's pen (plan 1.4) ----------

const CORNER = Math.cos(50 * Math.PI / 180);   // a turn sharper than 50 degrees is a corner

// Each corner run past its vertex: the line in goes on by ratio x its length (at most 24 pen widths' worth)
// and the line out starts as far back, so the two cross the way a quick hand's do. A sub with a corner comes
// back open; one without comes back as it was.
export function overshoot(sub, ratio, w) {
  if (!(ratio > 0)) return sub;
  const cap = 24 * w, out = [];
  for (const s of sub) {
    const p = s.closed ? [...s.pts, s.pts[0], s.pts[1]] : s.pts, n = p.length / 2;
    let cur = [p[0], p[1]], cut = false;
    for (let i = 1; i < n - 1; i++) {
      const x = p[2 * i], y = p[2 * i + 1], ix = x - p[2 * i - 2], iy = y - p[2 * i - 1], ox = p[2 * i + 2] - x, oy = p[2 * i + 3] - y;
      const li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
      if (li > 0 && lo > 0 && (ix * ox + iy * oy) / (li * lo) < CORNER) {
        const ei = ratio * Math.min(li, cap) / li, eo = ratio * Math.min(lo, cap) / lo;
        cur.push(x + ix * ei, y + iy * ei);
        out.push({ pts: cur, closed: false });
        cur = [x - ox * eo, y - oy * eo, x, y];
        cut = true;
      } else cur.push(x, y);
    }
    if (!cut) { out.push(s); continue; }
    cur.push(p[2 * n - 2], p[2 * n - 1]);
    out.push({ pts: cur, closed: false });
  }
  return out;
}

// A short entry flick before each open line long enough to carry one: an arc of radius hook x 1.5 pen widths,
// 60 to 120 degrees, that leaves tangent to the line's first step, curling to a seeded side.
export function hook(sub, amount, w, r) {
  if (!(amount > 0)) return sub;
  const R = amount * 1.5 * w;
  return sub.map((s) => {
    const p = s.pts;
    if (s.closed || p.length < 4) return s;
    let L = 0;
    for (let i = 2; i < p.length && L < 8 * R; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    const side = r() < 0.5 ? -1 : 1, sweep = (1 + r()) * Math.PI / 3;
    if (L < 8 * R) return s;
    let j = 2;
    while (j < p.length - 2 && p[j] === p[0] && p[j + 1] === p[1]) j += 2;
    const dl = Math.hypot(p[j] - p[0], p[j + 1] - p[1]);
    if (!dl) return s;
    const dx = (p[j] - p[0]) / dl, dy = (p[j + 1] - p[1]) / dl, nx = -dy * side, ny = dx * side;
    const cx = p[0] + nx * R, cy = p[1] + ny * R, curl = [];
    for (let k = 4; k >= 1; k--) {
      const f = sweep * k / 4;
      curl.push(cx + R * (-nx * Math.cos(f) - dx * Math.sin(f)), cy + R * (-ny * Math.cos(f) - dy * Math.sin(f)));
    }
    return { pts: [...curl, ...p], closed: false };
  });
}

// Width along a stroke from the hand's pressure, given at 0.1, 0.5 and 0.9 of its length.
export function pressureAt([a, b, c], u) {
  if (u <= 0.1) return a;
  if (u >= 0.9) return c;
  return u < 0.5 ? a + (b - a) * (u - 0.1) / 0.4 : b + (c - b) * (u - 0.5) / 0.4;
}
const flatPressure = (p) => !p || (p[0] === 1 && p[1] === 1 && p[2] === 1);

// Each sub drawn a segment at a time, as wide as the pressure at the middle of the segment.
function pressed(ctx, sub, w, pressure) {
  for (const s of sub) {
    const p = s.closed ? [...s.pts, s.pts[0], s.pts[1]] : s.pts, n = p.length / 2;
    let L = 0;
    for (let i = 1; i < n; i++) L += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    if (!L) continue;
    let at = 0;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
      ctx.lineWidth = w * pressureAt(pressure, (at + d / 2) / L);
      ctx.beginPath(); ctx.moveTo(p[2 * i - 2], p[2 * i - 1]); ctx.lineTo(p[2 * i], p[2 * i + 1]); ctx.stroke();
      at += d;
    }
  }
}

// dash: [on, off] in logical units, offset from the seed (v1 dashedRing).
// Under a look with a hand, the op's own wobble still wins, the hand's comes before the look's; the hand
// overshoots corners, hooks entries and presses along the line (seeded apart from the jitter) -- except on a
// stroke with wobble 0, which is a ruled line (hatching, guides) the hand does not touch.
function pen(ctx, op, t, S, look) {
  const r = rng(op.seed ?? 1), w = op.w ?? t.w;
  ctx.lineWidth = w;
  if (op.dash) { ctx.setLineDash(op.dash); ctx.lineDashOffset = r() * 40; }
  const { path, hand } = handed(op, look, w);
  const sub = jittered(path, op.wobble ?? hand?.wobble ?? t.wobble, r);
  if (hand && op.wobble !== 0 && !op.dash && !flatPressure(hand.pressure)) { pressed(ctx, sub, w, hand.pressure); return; }
  ctx.beginPath();
  tracePath(ctx, { sub });
  ctx.stroke();
}

// The op's path as the look's hand would pen it (corners overshot, entries hooked), and the hand's stroke
// profile; the path unchanged and no hand without one, or on a ruled line (wobble 0).
function handed(op, look, w) {
  const hand = look?.hand ? handOf(look)?.stroke : null;
  if (!hand || op.wobble === 0) return { path: op.path, hand: null };
  const hr = rng(hash32('hand', op.seed ?? 1));
  return { path: { sub: hook(overshoot(op.path.sub, hand.overshoot, w), hand.hook, w, hr) }, hand };
}

// Bullet: a round-tip whiteboard marker (4.0 L1). Nearly opaque and laid over what is under it (so, unlike the
// chisel marker, it caches like the pen), with a paler streak down a broad line where the felt runs dry. A look
// with penTool: 'bullet' draws every pen stroke with it, in the look's hand when it has one.
function bullet(ctx, op, t, S, look) {
  const r = rng(op.seed ?? 1), w = op.w ?? t.w ?? 3.4, a0 = ctx.globalAlpha;
  if (op.dash) { ctx.setLineDash(op.dash); ctx.lineDashOffset = r() * 40; }
  const { path, hand } = handed(op, look, w), sub = jittered(path, op.wobble ?? hand?.wobble ?? t.wobble ?? 0.7, r);
  ctx.globalAlpha = a0 * 0.92; ctx.lineWidth = w;
  ctx.beginPath(); tracePath(ctx, { sub }); ctx.stroke();
  if (w >= 2.5 && !op.dash) {
    const dx = w * 0.14, dy = -w * 0.1;
    ctx.globalAlpha = a0 * 0.18; ctx.lineWidth = w * 0.22; ctx.strokeStyle = resolveRole('paper', look);
    ctx.beginPath();
    tracePath(ctx, { sub: sub.map((s) => ({ pts: s.pts.map((v, i) => v + (i & 1 ? dy : dx)), closed: s.closed })) });
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
}

// Crayon: three wobbly passes with a grainy edge (the flipbook's ripple line).
function crayon(ctx, op, t) {
  const w = op.w ?? t.w ?? 4, base = op.seed ?? 1, a0 = ctx.globalAlpha;
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = a0 * (k ? 0.35 : 0.85);
    ctx.lineWidth = w * (k ? 0.7 : 1);
    ctx.beginPath();
    tracePath(ctx, { sub: jittered(op.path, (op.wobble ?? 2.5) + k * 1.5, rng(base + k * 7)) });
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
}

// Pencil: a thin graphite line and a lighter, looser second pass.
function pencil(ctx, op, t) {
  const w = op.w ?? t.w ?? 0.9, amp = op.wobble ?? t.wobble ?? 1.2, r = rng(op.seed ?? 1), a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * 0.85; ctx.lineWidth = w;
  ctx.beginPath(); tracePath(ctx, { sub: jittered(op.path, amp, r) }); ctx.stroke();
  ctx.globalAlpha = a0 * 0.35; ctx.lineWidth = w * 0.6;
  ctx.beginPath(); tracePath(ctx, { sub: jittered(op.path, amp * 1.8, r) }); ctx.stroke();
  ctx.globalAlpha = a0;
}

// Marker: broad, flat, a little translucent and multiplied where strokes cross.
function marker(ctx, op, t) {
  ctx.lineWidth = op.w ?? t.w ?? 10;
  ctx.lineCap = 'butt';
  ctx.globalAlpha *= 0.82;
  if (!op.blend) ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  tracePath(ctx, { sub: jittered(op.path, op.wobble ?? 0.8, rng(op.seed ?? 1)) });
  ctx.stroke();
}

// Gouache: opaque body colour laid with a brush, dry and broken at the edge.
function gouache(ctx, op, t) {
  const w = op.w ?? t.w ?? 12, a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * 0.97; ctx.lineWidth = w * 0.82;
  ctx.beginPath(); tracePath(ctx, { sub: jittered(op.path, 0.8, rng(op.seed ?? 1)) }); ctx.stroke();
  ctx.globalAlpha = a0 * 0.7;
  chalk(ctx, { ...op, w, wobble: 1.6, dash: w * 1.4, gap: w * 0.35 }, { w, wobble: 1.6, dash: w, gap: w * 0.3 });
  ctx.globalAlpha = a0;
}

// Brush pen (v1 brush): pressure swells and tapers towards both ends, the hand wanders slowly along the
// line (not per point), and op.p (0..1) draws it on with the taper of the whole line. Each sub is a line.
function brushSub(ctx, pts, closed, op, t, r) {
  const w = op.w ?? t.w ?? 4, amp = op.amp ?? t.amp ?? 1.6, taper = op.taper ?? t.taper ?? 1, p = Math.min(1, Math.max(0, op.p ?? 1));
  const q = op.smooth === false ? pts : spline(pts, { closed, tension: 0, n: 6 }).sub[0].pts;
  const n = q.length / 2, s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(q[2 * i] - q[2 * i - 2], q[2 * i + 1] - q[2 * i - 1]));
  const L = s[n - 1], end = L * p, tl = Math.max(1, Math.min(L * 0.42, w * 10)) * taper;
  const ph = [r() * TAU, r() * TAU, r() * TAU], f1 = 0.011 + r() * 0.008, f2 = 0.037 + r() * 0.02;
  const pt = (i) => [
    q[2 * i] + amp * (Math.sin(s[i] * f1 + ph[0]) + 0.5 * Math.sin(s[i] * f2 + ph[1])),
    q[2 * i + 1] + amp * (Math.cos(s[i] * f1 * 1.3 + ph[1]) + 0.5 * Math.sin(s[i] * f2 * 0.8 + ph[2])),
  ];
  if (p <= 0 || n < 2) return;
  let a = pt(0);
  for (let i = 1; i < n && s[i - 1] < end; i++) {
    let b = pt(i);
    if (s[i] > end) { const u = (end - s[i - 1]) / (s[i] - s[i - 1]); b = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
    const m = (s[i - 1] + Math.min(s[i], end)) / 2, e = taper ? Math.min(1, m / tl, (L - m) / tl) : 1;
    ctx.lineWidth = Math.max(0.6, w * (0.3 + 0.7 * Math.sin(e * Math.PI / 2)) * (1 + 0.2 * Math.sin(m * f2 * 1.7 + ph[2])));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    a = b;
  }
}
function brush(ctx, op, t) {
  const r = rng(op.seed ?? 1);
  for (const sub of op.path.sub) {
    const pts = sub.closed ? [...sub.pts, sub.pts[0], sub.pts[1]] : sub.pts;
    if (pts.length >= 4) brushSub(ctx, pts, false, op, t, r);
  }
}

// Chalk: a wobbly line broken into dashes of uneven length and alpha, stroked in three alpha buckets.
const CHALK_ALPHA = [0.55, 0.78, 1];
function chalk(ctx, op, t) {
  const r = rng(op.seed ?? 1), dash = op.dash ?? t.dash, gap = op.gap ?? t.gap;
  const buckets = CHALK_ALPHA.map(() => []);
  for (const s of jittered(op.path, op.wobble ?? t.wobble, r)) {
    const p = s.closed ? [...s.pts, s.pts[0], s.pts[1]] : s.pts;
    let on = true, left = dash * (0.6 + r() * 0.8), cur = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      let x0 = p[i - 2], y0 = p[i - 1];
      const x1 = p[i], y1 = p[i + 1];
      let L = Math.hypot(x1 - x0, y1 - y0);
      while (L > left) {
        const u = left / L, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u;
        if (on) { cur.push(x, y); buckets[(r() * 3) | 0].push(cur); }
        on = !on; cur = [x, y];
        x0 = x; y0 = y; L -= left;
        left = on ? dash * (0.6 + r() * 0.8) : gap * (0.5 + r());
      }
      left -= L;
      if (on) cur.push(x1, y1);
    }
    if (on && cur.length >= 4) buckets[(r() * 3) | 0].push(cur);
  }
  ctx.lineWidth = op.w ?? t.w;
  const a0 = ctx.globalAlpha;
  buckets.forEach((subs, j) => {
    if (!subs.length) return;
    ctx.globalAlpha = a0 * CHALK_ALPHA[j];
    ctx.beginPath();
    tracePath(ctx, { sub: subs.map((pts) => ({ pts, closed: false })) });
    ctx.stroke();
  });
  ctx.globalAlpha = a0;
}

const TOOLS = { pen, chalk, brush, pencil, crayon, marker, gouache, bullet };

// The width a stroke is drawn at: its own w, else the look's setting for its tool, else the tool's default.
const TOOL_W = { pen: 2, chalk: 2, brush: 4, pencil: 0.9, crayon: 4, marker: 10, gouache: 12, bullet: 3.4 };
export const strokeWidth = (op, look) => op.w ?? resolveLook(look).tools[op.tool ?? 'pen']?.w ?? TOOL_W[op.tool ?? 'pen'] ?? 2;

// A pen stroke is drawn by the look's penTool when it names one (the whiteboard's bullet marker), still with
// the pen's settings; any other tool is its own.
export function drawStroke(ctx, op, look, S = 1) {
  const kind = op.tool ?? 'pen', draw = TOOLS[kind === 'pen' && look.penTool ? look.penTool : kind];
  if (!draw) throw new Error(`stroke: tool '${op.tool}' is not implemented yet (have ${Object.keys(TOOLS).join(', ')})`);
  ctx.save();
  ctx.strokeStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  if (op.blend === 'wash') { if (look.chalkPass) ctx.globalAlpha *= 0.6; else ctx.globalCompositeOperation = 'multiply'; }
  else if (op.blend) ctx.globalCompositeOperation = op.blend;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, op, look.tools[op.tool ?? 'pen'] ?? {}, S, look);
  ctx.restore();
}

// ---------- partial reveal ----------

// The first L units of a path, in sub order.
export function trim(path, L) {
  const sub = [];
  for (const s of path.sub) {
    if (L <= 0) break;
    const p = s.closed ? [...s.pts, s.pts[0], s.pts[1]] : s.pts, out = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if (d >= L) { const u = d ? L / d : 0; out.push(p[i - 2] + (p[i] - p[i - 2]) * u, p[i - 1] + (p[i + 1] - p[i - 1]) * u); L = 0; break; }
      out.push(p[i], p[i + 1]);
      L -= d;
    }
    sub.push({ pts: out, closed: false });
  }
  return mkPath(sub);
}

const pathLen = (path) => {
  let L = 0;
  for (const s of path.sub) {
    const p = s.pts;
    for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (s.closed && p.length >= 4) L += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  }
  return L;
};

// Total pen length of a text op's lettering.
const textLen = (op) => handText(op).kids.reduce((a, k) => a + pathLen(k.path), 0);

// reveal(p, node): the node (op or list) with its strokes and text drawn up to p of their total length, in
// `order` (ties keep list order). Lengths are measured on screen through each group's scale. Other ops pass through.
// Brush strokes get p instead of a trimmed path, so their taper stays that of the whole line.
export function reveal(p, node) {
  if (p >= 1) return node;
  const isOp = !Array.isArray(node);
  const list = isOp ? [node] : norm(node);
  const found = [];
  const collect = (ops, s) => {
    for (const op of ops) {
      if (op.op === 'stroke') found.push({ op, len: pathLen(op.path) * s, order: op.order ?? 0, n: found.length });
      else if (op.op === 'text') found.push({ op, len: textLen(op) * s, order: op.order ?? 0, n: found.length });
      else if (op.kids) collect(op.kids, op.op === 'group' ? s * Math.sqrt(Math.abs(op.xf[0] * op.xf[3] - op.xf[1] * op.xf[2])) : s);
    }
  };
  collect(list, 1);
  const total = found.reduce((a, f) => a + f.len, 0);
  let budget = Math.max(0, p) * total;
  const keep = new Array(found.length);
  for (const f of [...found].sort((a, b) => a.order - b.order || a.n - b.n)) {
    keep[f.n] = budget >= f.len ? 1 : budget <= 0 ? 0 : budget / f.len;
    budget -= f.len;
  }
  let n = 0;
  const rebuild = (ops) => ops.flatMap((op) => {
    if (op.op === 'text') {
      // Text becomes strokes only when expanded (after frame() has seeded it), so it carries its share as p.
      const k = keep[n++];
      return k === 1 ? [op] : k === 0 ? [] : [withProps(op, { p: k * (op.p ?? 1) })];
    }
    if (op.op === 'stroke') {
      const k = keep[n++];
      if (k === 1) return [op];
      if (k === 0) return [];
      if (op.tool === 'brush') return [withProps(op, { p: k * (op.p ?? 1) })];
      return [withProps(op, { path: trim(op.path, pathLen(op.path) * k) })];
    }
    return op.kids ? [withProps(op, { kids: rebuild(op.kids) })] : [op];
  });
  const out = rebuild(list);
  return isOp ? out[0] : out;
}

// ---------- the pen tip (4.0 T6) ----------

// The pen's path through a node, in the order reveal() spends its length: [{ op, src, gi, text, len, at, subs,
// m }] with op the stroke or text op it comes from, src its place in that order (a text op's strokes share
// one), gi the glyph a lettered stroke draws (from its name g<gi>.<si>), text what it letters: the text op, or
// the handText group (named text:<copy>) an already lettered stroke is in; len its length on screen, at where
// it starts in the node's total, subs its lines in the node's coordinates (a lift between each).
const GLYPH = /^g(\d+)\.\d+b?$/;
export function penStrokes(node) {
  const list = Array.isArray(node) ? norm(node) : [node], found = [];
  const collect = (ops, s, m, txt) => {
    for (const op of ops) {
      if (op.op === 'stroke') found.push({ op, len: pathLen(op.path) * s, m, order: op.order ?? 0, n: found.length, txt: GLYPH.test(op.name ?? '') ? txt : null });
      else if (op.op === 'text') found.push({ op, len: textLen(op) * s, m, order: op.order ?? 0, n: found.length, txt: op });
      else if (op.kids) {
        const g = op.op === 'group', t = g && typeof op.name === 'string' && op.name.startsWith('text:') ? op : txt;
        collect(op.kids, g ? s * Math.sqrt(Math.abs(op.xf[0] * op.xf[3] - op.xf[1] * op.xf[2])) : s, g ? mmul(m, op.xf) : m, t);
      }
    }
  };
  collect(list, 1, I, null);
  const byOrder = (a, b) => a.order - b.order || a.n - b.n, items = [];
  let at = 0;
  const push = (op, src, gi, len, path, m, text) => {
    const subs = path.sub.filter((s) => s.pts.length >= 2).map((s) => {
      const p = s.closed ? [...s.pts, s.pts[0], s.pts[1]] : s.pts, out = new Array(p.length);
      for (let i = 0; i < p.length; i += 2) { const q = mapply(m, p[i], p[i + 1]); out[i] = q[0]; out[i + 1] = q[1]; }
      return out;
    });
    items.push({ op, src, gi, text, len, at, subs, m });
    at += len;
  };
  [...found].sort(byOrder).forEach((f, src) => {
    if (f.op.op === 'stroke') return push(f.op, src, f.txt ? +GLYPH.exec(f.op.name)[1] : null, f.len, f.op.path, f.m, f.txt);
    // A text op reveals its lettering by stroke order inside (see finish.js), at its share of the whole.
    const kids = handText(f.op).kids.map((k, n) => ({ k, n, order: k.order ?? 0 })).sort((a, b) => a.order - b.order || a.n - b.n);
    const L = kids.reduce((a, { k }) => a + pathLen(k.path), 0) || 1;
    for (const { k } of kids) push(f.op, src, +(GLYPH.exec(k.name ?? '')?.[1] ?? -1), f.len * pathLen(k.path) / L, k.path, f.m, f.op);
  });
  return { items, total: at };
}

// Where along a polyline (flat pts) length d falls: [x, y, dx, dy] (the direction of the segment it is on).
function alongPts(p, d) {
  let dx = 0, dy = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ex = p[i] - p[i - 2], ey = p[i + 1] - p[i - 1], L = Math.hypot(ex, ey);
    if (!L) continue;
    dx = ex; dy = ey;
    if (d <= L) return [p[i - 2] + ex * d / L, p[i - 1] + ey * d / L, dx, dy];
    d -= L;
  }
  return [p[p.length - 2], p[p.length - 1], dx, dy];
}
const ptsLen = (p) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };

// penAt(p, node) => { x, y, a, down, item } | null: where the pen is when reveal(p, node) has drawn p of it,
// in the node's coordinates (through its groups), from trim's arithmetic. a is the direction the pen moves
// (radians), item the index into penStrokes(node).items it is on. down is false before the first stroke and
// after the last (p 0 and 1): the pen is up. Between two strokes it is at the end of one, then the start of
// the next; writeOn's schedule puts the lifts in (writing(...).pen). A node with nothing to pen is null.
export function penAt(p, node, strokes = penStrokes(node)) {
  const { items, total } = strokes;
  const inked = items.filter((it) => it.subs.length);
  if (!inked.length) return null;
  const tip = (it, d, down) => {
    // d along the item on screen; its subs are in node units, so go by its share of their length.
    const lens = it.subs.map(ptsLen), sum = lens.reduce((a, b) => a + b, 0);
    let rest = it.len ? d / it.len * sum : 0, j = 0;
    while (j < lens.length - 1 && rest > lens[j]) rest -= lens[j++];
    const [x, y, dx, dy] = alongPts(it.subs[j], Math.min(rest, lens[j]));
    return { x, y, a: Math.atan2(dy, dx), down, item: items.indexOf(it) };
  };
  const first = inked[0], last = inked[inked.length - 1];
  if (!(p > 0)) return tip(first, 0, false);
  if (p >= 1) return tip(last, last.len, false);
  const budget = p * total;
  const it = inked.find((q) => budget < q.at + q.len) ?? last;
  return tip(it, Math.max(0, budget - it.at), true);
}

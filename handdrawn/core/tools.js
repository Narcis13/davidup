// Drawing tools: how a stroke op becomes marks on a canvas. Browser and skia contexts are driven the
// same way. All jitter comes from the op's seed, so a stroke boils only when its seed or inputs change.
// This phase: pen (v1 wob) and chalk. brush, pencil, crayon and marker land in P5.
import { rng } from './rand.js';
import { resolveRole } from './looks.js';
import { mkPath, norm, withProps } from './list.js';

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

function pen(ctx, op, t) {
  const r = rng(op.seed ?? 1);
  ctx.lineWidth = op.w ?? t.w;
  ctx.beginPath();
  tracePath(ctx, { sub: jittered(op.path, op.wobble ?? t.wobble, r) });
  ctx.stroke();
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

const TOOLS = { pen, chalk };

export function drawStroke(ctx, op, look, S = 1) {
  const draw = TOOLS[op.tool ?? 'pen'];
  if (!draw) throw new Error(`stroke: tool '${op.tool}' is not implemented yet (have ${Object.keys(TOOLS).join(', ')})`);
  ctx.save();
  ctx.strokeStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, op, look.tools[op.tool ?? 'pen'] ?? look.tools.pen, S);
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

// reveal(p, node): the node (op or list) with its strokes drawn up to p of their total length, in `order`
// (ties keep list order). Lengths are measured on screen through each group's scale. Other ops pass through.
export function reveal(p, node) {
  if (p >= 1) return node;
  const isOp = !Array.isArray(node);
  const list = isOp ? [node] : norm(node);
  const found = [];
  const collect = (ops, s) => {
    for (const op of ops) {
      if (op.op === 'stroke') found.push({ op, len: pathLen(op.path) * s, order: op.order ?? 0, n: found.length });
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
    if (op.op === 'stroke') {
      const k = keep[n++];
      if (k === 1) return [op];
      if (k === 0) return [];
      return [withProps(op, { path: trim(op.path, pathLen(op.path) * k) })];
    }
    return op.kids ? [withProps(op, { kids: rebuild(op.kids) })] : [op];
  });
  const out = rebuild(list);
  return isOp ? out[0] : out;
}

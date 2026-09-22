// Legibility (4.0 T10): the lettering in one evaluated frame, as lint's text rules read it. No pixels: what
// the list says, through the groups' transforms, in the shot's coordinates.
//
//   textUnits(list, look) => [{ str, box, x, fg, bg, on, sign, voiced, captions }]
//
// A unit is a text op or an already lettered group ('text:<str>', what handText makes); lint does not look
// inside either. box is its ink in shot units; x its x-height in shot units (a text op: 0.48 of its size
// through the transform; a lettered group: the median height of its x-height letters, measured on their
// strokes); fg the colour it is drawn in and bg the colour under its centre (the last fill drawn before it
// whose box holds that point, else the stock), both resolved in the look, or null when what is under it is
// a picture (an image, a mesh, no stock under ~alpha) and has no colour to measure; on names it (the fill's
// role and name, 'paper', 'night', 'image'). sign: inside the
// sign-off; captions: inside a captions strip, voiced when it follows a recording (not copy read at the
// audience's pace).
import { bounds, mmul } from './list.js';
import { parse, resolveLook, resolveRole } from './looks.js';
import { glyphUnits } from './text.js';

const XH = 0.48;                               // x-height in sizes (core/glyphs.js: -48 in a 100-unit em)
const CAP = 0.72;                              // cap height and figures
const SHORT = new Set('acemnorsuvwxz');        // letters that stand exactly on the x-height
const TALL = /[A-Z0-9]/;
const GLYPH = /^g(\d+)\.\d+$/;                 // a lettered stroke: g<glyph>.<stroke> (its ink2 twin ends in b)

const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// A lettered group's x-height in its own units (memoised: lettered groups are frozen and reused).
const xMemo = new WeakMap();
function letteredX(g) {
  if (xMemo.has(g)) return xMemo.get(g);
  const units = glyphUnits(g.name.slice(5)), per = new Map();
  const visit = (ops, m) => {
    for (const op of ops) {
      const hit = op.op === 'stroke' && typeof op.name === 'string' && op.name.match(GLYPH);
      if (hit) {
        const b = bounds([{ ...op, w: 0 }], m), gi = +hit[1], u = per.get(gi);
        if (b) per.set(gi, u ? [Math.min(u[0], b[1]), Math.max(u[1], b[1] + b[3])] : [b[1], b[1] + b[3]]);
      } else if (op.kids) visit(op.kids, op.op === 'group' ? mmul(m, op.xf) : m);
    }
  };
  visit(g.kids, [1, 0, 0, 1, 0, 0]);
  const median = (v) => { v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
  const of = (test) => [...per].filter(([gi]) => test(units[gi]?.ch ?? '')).map(([, [y0, y1]]) => y1 - y0);
  const short = median(of((c) => SHORT.has(c))), tall = median(of((c) => TALL.test(c)));
  const x = short ?? (tall === null ? null : tall * XH / CAP);
  xMemo.set(g, x);
  return x;
}

// The colour a unit is drawn in: a text op's role; a lettered group's glyph strokes (its first ink, not the
// misregistered second, whose strokes end in b), or null while none of them is drawn yet.
function inkOf(op) {
  if (op.op === 'text') return op.role ?? 'ink';
  let role = null;
  const visit = (ops) => { for (const o of ops) { if (role !== null) return; if (o.op === 'stroke' && GLYPH.test(o.name ?? '')) role = o.role; else if (o.kids) visit(o.kids); } };
  visit(op.kids);
  return role;
}

// '#rrggbb' or rgba(...) over an opaque colour: [r, g, b] 0..255.
const over = (c, under) => {
  const [r, g, b, a] = parse(c);
  return a >= 1 || !under ? [r, g, b] : [r, g, b].map((v, i) => v * a + under[i] * (1 - a));
};

// WCAG relative luminance and contrast ratio of two [r, g, b].
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastOf = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The stock a paper() or night() op lays down in a look, or null (~alpha: none).
function stockOf(op, lk) {
  if (lk.alpha) return null;
  const p = lk.palette;
  return over(op.op === 'night' || lk.paper === 'night' ? p.night : p.paper);
}

// Is shot point (x, y) inside a fill op drawn through m (its rule: evenodd unless nonzero)?
function inside(op, m, x, y) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return false;
  const dx = x - m[4], dy = y - m[5], px = (m[3] * dx - m[2] * dy) / det, py = (m[0] * dy - m[1] * dx) / det;
  let wind = 0, odd = false;
  for (const s of op.path.sub) {
    const p = s.pts, n = p.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, [x0, y0, x1, y1] = [p[i], p[i + 1], p[j], p[j + 1]];
      if ((y0 > py) === (y1 > py)) continue;
      if (px < x0 + (py - y0) / (y1 - y0) * (x1 - x0)) { odd = !odd; wind += y1 > y0 ? 1 : -1; }
    }
  }
  return op.rule === 'nonzero' ? wind !== 0 : odd;
}

export function textUnits(list, look) {
  const out = [], under = [];   // what has been painted so far, in order: { op?, m?, box, rgb | null, a, blend, on }
  const visit = (ops, m, lk, ctx) => {
    for (const op of ops) {
      switch (op.op) {
        case 'paper': case 'night': under.push({ box: null, rgb: stockOf(op, lk), on: op.op }); continue;
        case 'image': case 'mesh': under.push({ box: bounds([op], m), rgb: null, on: op.op }); continue;
        case 'fill': {
          // A coverage descriptor (a vignette, a shading ramp) tints what is there; it is not a ground.
          if (op.cov) continue;
          let c = null;
          try { c = parse(resolveRole(op.role, lk)); } catch { continue; /* role: its own rule */ }
          const a = c[3] * (op.alpha ?? 1);
          if (a > 0) under.push({ op, m, rgb: c.slice(0, 3), a, blend: op.blend, on: `${typeof op.role === 'string' ? op.role : op.role?.base ?? 'fill'}${op.name ? ` (${op.name})` : ''}` });
          continue;
        }
        case 'text': unit(op, op.str, m, lk, ctx, (op.size ?? 48) * XH * scaleOf(m)); continue;
        case 'look': visit(op.kids ?? [], m, op.inset ? resolveLook(op.look) : lk, ctx); continue;
        case 'group': {
          if (typeof op.name === 'string' && op.name.startsWith('text:')) {
            const x = letteredX(op);
            unit(op, op.name.slice(5), m, lk, ctx, x === null ? null : x * scaleOf(mmul(m, op.xf)));
            continue;
          }
          let c = ctx;
          if (op.name === 'signOff') c = { ...ctx, sign: true };
          else if (typeof op.name === 'string' && op.name.startsWith('captions:')) {
            const by = op.kids.find((k) => k.op === 'meta' && k.tag === 'captions')?.data?.by;
            c = { ...ctx, captions: true, voiced: by !== 'reading' };
          }
          visit(op.kids, mmul(m, op.xf), lk, c);
          continue;
        }
        default: if (op.kids) visit(op.kids, m, lk, ctx);
      }
    }
  };
  const unit = (op, str, m, lk, ctx, x) => {
    const box = bounds([op], m);
    if (!box || !str.trim()) return;
    const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
    // Down to the first opaque thing under the centre, then its colour with every translucent fill over it
    // laid on in order (a multiply multiplies).
    const layers = [];
    for (let j = under.length - 1; j >= 0; j--) {
      const u = under[j];
      if (u.op) { u.box ??= bounds([u.op], u.m); if (!u.box) continue; }
      if (u.box && !(cx >= u.box[0] && cx <= u.box[0] + u.box[2] && cy >= u.box[1] && cy <= u.box[1] + u.box[3])) continue;
      if (u.op && !inside(u.op, u.m, cx, cy)) continue;
      layers.push(u);
      if (!u.op || u.a >= 1) break;
    }
    let bg = null, on = null;
    for (const u of layers.reverse()) {
      on = u.on;
      if (!u.op) { bg = u.rgb; continue; }
      if (u.a >= 1) { bg = u.rgb; continue; }
      if (!bg) continue;
      const top = u.blend === 'multiply' ? bg.map((v, i) => v * u.rgb[i] / 255) : u.rgb;
      bg = bg.map((v, i) => v + (top[i] - v) * u.a);
    }
    let fg = null;
    try { const role = inkOf(op); if (role !== null && bg) fg = over(resolveRole(role, lk), bg); } catch { /* role: its own rule */ }
    out.push({ str, box, x, fg, bg, on, sign: !!ctx.sign, captions: !!ctx.captions, voiced: !!ctx.voiced });
  };
  visit(list, [1, 0, 0, 1, 0, 0], resolveLook(look), {});
  return out;
}

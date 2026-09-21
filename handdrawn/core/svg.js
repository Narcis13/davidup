// SVG import (plan 1.5): a drawing made in Figma, Illustrator or by hand becomes a puppet (or a motif) in the
// store. Pure on purpose -- no node imports -- so the player can one day read an SVG dropped on it.
//
//   svgPuppet(src, { name: 'fox', roles })   => { payload, table }   payload is a puppet (plan 1.2)
//   svgMotif(src, { name: 'star' })          => { payload, table }   payload is one serialised op list
//   svgColours(src)                          => table                every colour with its area and auto role
//
// Geometry: path, rect, circle, ellipse, line, polyline, polygon and g, each with its transform. Every
// shape is a path first; curves (cubic and quadratic beziers, arcs, the corners of a rounded rect, circles
// and ellipses) become cubics and are sampled with list.js `cubic` at `flatten` (the largest distance from
// the curve, in logical units), so nothing curved survives import. Anything else that draws -- use, text,
// gradients, patterns, filters, masks, clip paths, embedded images, CSS -- is refused by element name.
//
// Rig from ids: a `<g id="arm-l">` is a part and document order is painter order (and reveal order: draw the
// outline last and it reveals last). Inside a part, `<circle id="pivot">` (or `data-pivot="x,y"` on the g)
// is the pivot and is not drawn; `data-parent="body"`, or nesting inside another part's g, gives the parent.
// `<g id="eye" data-variants>` takes its child g ids as variants; sibling ids `mouth-0`, `mouth-1`, ...
// collapse into one stepped variant part `mouth` (inputs [0, n, 1]). `<g id="pose:wave"
// data-joints="arm-l:-70,head:8,eye:happy">` declares a pose and `<g id="cycle:walk" data-fps="12">` a cycle,
// one child `<g data-joints="...">` per frame; neither draws. A top-level `<circle id="ground">` is the
// ground point. Turnarounds: top-level `<g id="view:side">`, `<g id="view:front">`, ... each wrap a whole
// view, with the same part ids inside every one; the payload gets `views` in document order and a part drawn
// in more than one view has its ops, variants (and pivot, where it moves) keyed by view. A part drawn only in
// the first view is the same in all of them. Poses, cycles and the ground stay outside the views. The first
// view's document order is painter order; a part a later view adds goes after. On the root: viewBox is the box, `data-units` the logical units the file is drawn in
// (default: the viewBox height), `data-desc` the description; `units` rescales the file to that many units.
//
// Colour to role: every fill and stroke colour is listed with its area. By default the darkest is ink, the
// lightest paper, and the rest go by area to the nearest unused fills.n / accents.n of the house palette
// (paperInk) by hue, saturation and lightness; `roles` ({ '#e8734a': 'fills.0', ... }) overrides any of
// them. Fills in fills.n or accents.n get `finish: true` so the look hatches or halftones them
// (`data-finish="false"` on the element or a g turns that off, `data-finish="true"` on). Strokes get the
// look's pen; `stroke-width`, when the file sets one, becomes `w` in logical units.
import { cubic, fill, mkPath, serialise, stroke } from './list.js';
import { LOOKS, hsl, resolveRole } from './looks.js';

// Elements that would draw something the importer cannot keep, and what to do instead.
const REFUSED = {
  use: 'a <use> clone: ungroup or detach the instance so the shape is in the file',
  symbol: 'a <symbol>: detach the instance so the shape is in the file',
  text: 'live <text>: outline it, or write it as a text op in the film',
  tspan: 'live <text>: outline it, or write it as a text op in the film',
  textPath: 'live <text>: outline it, or write it as a text op in the film',
  linearGradient: 'a gradient: use a flat colour; the look finishes fills',
  radialGradient: 'a gradient: use a flat colour; the look finishes fills',
  pattern: 'a pattern fill: use a flat colour; the look finishes fills',
  filter: 'a filter: blurs and shadows are not drawn in the house style',
  mask: 'a mask: flatten it into plain shapes',
  clipPath: 'a clip path: flatten it into plain shapes (in Figma: turn off "clip content")',
  image: 'an embedded raster: import it as a cutout (hdf photo / hdf import --kind cutout)',
  foreignObject: 'a foreignObject: only vector shapes import',
  style: 'a CSS <style> sheet: export with presentation attributes instead',
  marker: 'a marker: expand it into shapes',
  switch: 'a <switch>: keep one branch',
  svg: 'a nested <svg>: flatten it into groups',
  a: 'a link: ungroup it',
};
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SILENT = new Set(['title', 'desc', 'metadata', 'defs']);   // no drawing; defs are checked for refusals

// A refusal or a malformed file; the message names the element and its line.
export class SvgError extends Error {}
const fail = (el, msg) => { throw new SvgError(el ? `<${el.name}>${el.attrs.id ? ` id="${el.attrs.id}"` : ''} on line ${el.line}: ${msg}` : msg); };

// ---------- XML (the subset SVG exporters write) ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));

// src => the root element { name, attrs, kids, line }. Comments, processing instructions, doctypes and
// text are dropped; a text run inside an element is kept as { name: '#text' } so `text` can be refused.
export function parseXml(src) {
  const doc = { name: '#doc', attrs: {}, kids: [], line: 1 }, stack = [doc];
  let i = 0, line = 1, seen = 0;
  const lineAt = (at) => { for (; seen < at; seen++) if (src.charCodeAt(seen) === 10) line++; return line; };
  const ATTR = /\s*([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/y;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const txt = src.slice(i, lt < 0 ? src.length : lt);
    if (txt.trim() && stack.length > 1) stack.at(-1).kids.push({ name: '#text', attrs: {}, kids: [], line: lineAt(i), text: decode(txt) });
    if (lt < 0) break;
    const skip = (open, close) => {
      if (!src.startsWith(open, lt)) return false;
      const end = src.indexOf(close, lt + open.length);
      if (end < 0) throw new SvgError(`line ${lineAt(lt)}: ${open} is never closed`);
      i = end + close.length;
      return true;
    };
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end < 0) throw new SvgError(`line ${lineAt(lt)}: <![CDATA[ is never closed`);
      if (stack.length > 1) stack.at(-1).kids.push({ name: '#text', attrs: {}, kids: [], line: lineAt(lt), text: src.slice(lt + 9, end) });
      i = end + 3;
      continue;
    }
    if (skip('<!--', '-->') || skip('<?', '?>')) continue;
    if (src.startsWith('<!', lt)) {   // a doctype, maybe with an internal subset
      const br = src.indexOf('[', lt), gt = src.indexOf('>', lt);
      if (br >= 0 && br < gt) skip('<!', ']>'); else skip('<!', '>');
      continue;
    }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt), name = src.slice(lt + 2, gt).trim(), top = stack.at(-1);
      if (top === doc || top.name !== name) throw new SvgError(`line ${lineAt(lt)}: </${name}> closes ${top === doc ? 'nothing' : `<${top.name}> from line ${top.line}`}`);
      stack.pop();
      i = gt + 1;
      continue;
    }
    const m = /^<([^\s/>]+)/.exec(src.slice(lt, lt + 256));
    if (!m) throw new SvgError(`line ${lineAt(lt)}: a '<' that opens no tag`);
    const el = { name: m[1], attrs: {}, kids: [], line: lineAt(lt) };
    ATTR.lastIndex = lt + m[0].length;
    for (;;) {
      const save = ATTR.lastIndex, a = ATTR.exec(src);
      if (!a || !a[1]) { ATTR.lastIndex = save; break; }
      el.attrs[a[1]] = a[2] === undefined ? '' : decode(a[2].slice(1, -1));
    }
    let j = ATTR.lastIndex;
    while (/\s/.test(src[j] ?? '')) j++;
    const selfClosing = src[j] === '/';
    if (selfClosing) j++;
    if (src[j] !== '>') throw new SvgError(`line ${el.line}: <${el.name}> is not closed with '>'`);
    stack.at(-1).kids.push(el);
    if (!selfClosing) stack.push(el);
    i = j + 1;
  }
  if (stack.length > 1) throw new SvgError(`line ${stack.at(-1).line}: <${stack.at(-1).name}> is never closed`);
  const root = doc.kids.find((k) => k.name === 'svg');
  if (!root) throw new SvgError('not an SVG: no <svg> element');
  return root;
}

// ---------- numbers, transforms, colours, style ----------

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const nums = (s) => (String(s ?? '').match(NUM) ?? []).map(Number);
const num = (el, key, dflt = 0) => {
  const v = el.attrs[key];
  if (v === undefined || v === '') return dflt;
  if (/%$/.test(v)) fail(el, `${key}="${v}": percentages are not supported, use user units`);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) fail(el, `${key}="${v}" is not a number`);
  return n;
};

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const DEG = Math.PI / 180;

// transform="..." => [a, b, c, d, e, f], the list applied left to right as SVG composes it.
export function parseTransform(s, el) {
  let m = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let rest = String(s ?? '');
  for (const [all, fn, args] of rest.matchAll(re)) {
    const a = nums(args);
    let t;
    if (fn === 'matrix' && a.length === 6) t = a;
    else if (fn === 'translate' && a.length >= 1) t = [1, 0, 0, 1, a[0], a[1] ?? 0];
    else if (fn === 'scale' && a.length >= 1) t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (fn === 'rotate' && a.length >= 1) {
      const c = Math.cos(a[0] * DEG), sn = Math.sin(a[0] * DEG), r = [c, sn, -sn, c, 0, 0];
      t = a.length >= 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], r), [1, 0, 0, 1, -a[1], -a[2]]) : r;
    } else if (fn === 'skewX' && a.length === 1) t = [1, 0, Math.tan(a[0] * DEG), 1, 0, 0];
    else if (fn === 'skewY' && a.length === 1) t = [1, Math.tan(a[0] * DEG), 0, 1, 0, 0];
    else fail(el, `transform ${all}: wrong number of arguments`);
    m = mul(m, t);
    rest = rest.replace(all, '');
  }
  if (rest.replace(/[\s,]/g, '')) fail(el, `transform="${s}": cannot read '${rest.trim()}'`);
  return m;
}

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080',
  grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080',
  teal: '#008080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a',
};
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

// A paint value => { hex, a } or null for none. Gradients and patterns (url(...)) are refused.
function paint(v, el, prop, color) {
  const s = String(v).trim();
  if (s === 'none' || s === 'transparent') return null;
  if (/^url\(/.test(s)) fail(el, `${prop}="${s}" paints with a gradient or pattern; use a flat colour`);
  if (s === 'currentColor') return color ? paint(color, el, prop) : { hex: '#000000', a: 1 };
  if (s[0] === '#') {
    let h = s.slice(1).toLowerCase();
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) fail(el, `${prop}="${s}" is not a colour`);
    return { hex: `#${h.slice(0, 6)}`, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
    if (ch.length < 3 || ch.some((c) => !Number.isFinite(c))) fail(el, `${prop}="${s}" is not a colour`);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return { hex: `#${ch.map(hex2).join('')}`, a };
  }
  const named = NAMED[s.toLowerCase()];
  if (!named) fail(el, `${prop}="${s}": not a colour this importer knows; use #rrggbb`);
  return { hex: named, a: 1 };
}

// Presentation attributes, overridden by style="...". Only what drawing needs is read.
const PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'color'];
function ownStyle(el) {
  const out = {};
  for (const k of PROPS) if (el.attrs[k] !== undefined) out[k] = el.attrs[k];
  for (const decl of String(el.attrs.style ?? '').split(';')) {
    const c = decl.indexOf(':');
    if (c < 0) continue;
    const k = decl.slice(0, c).trim(), v = decl.slice(c + 1).trim();
    if (PROPS.includes(k)) out[k] = v;
  }
  if (el.attrs['data-finish'] !== undefined) out.finish = el.attrs['data-finish'];
  return out;
}
// The inherited style of a child: fill, stroke and the rest pass down; opacity multiplies.
function inherit(parent, el) {
  const own = ownStyle(el);
  return { ...parent, ...own, opacity: parent.opacity * (own.opacity === undefined ? 1 : parseFloat(own.opacity)) };
}
const ROOT_STYLE = { fill: 'black', stroke: 'none', opacity: 1, visibility: 'visible' };

// ---------- geometry: every shape as a path, every curve as a cubic ----------

// The shape's path data, so one parser draws everything.
function shapeD(el) {
  const n = (k) => num(el, k);
  switch (el.name) {
    case 'path': return el.attrs.d ?? '';
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return '';
      let rx = el.attrs.rx !== undefined ? n('rx') : undefined, ry = el.attrs.ry !== undefined ? n('ry') : undefined;
      rx = Math.min(rx ?? ry ?? 0, w / 2); ry = Math.min(ry ?? rx, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`
        + `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.name === 'circle' ? n('r') : n('rx'), ry = el.name === 'circle' ? rx : n('ry');
      if (rx <= 0 || ry <= 0) return '';
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`
        + `A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;
    }
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline': case 'polygon': {
      const p = nums(el.attrs.points);
      if (p.length % 2) fail(el, `points has an odd count of numbers (${p.length})`);
      if (p.length < 4) return '';
      return `M${p[0]} ${p[1]}L${p.slice(2).join(' ')}${el.name === 'polygon' ? 'Z' : ''}`;
    }
    default: return '';
  }
}

// The cubics of an elliptical arc (SVG 1.1 F.6.5), at most a quarter turn each: [[c0, c1, p1], ...].
function arcCubics(x0, y0, rx, ry, phi, large, sweep, x1, y1) {
  if (x0 === x1 && y0 === y1) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[[x0, y0], [x1, y1], [x1, y1]]];
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2, xp = c * dx + s * dy, yp = -s * dx + c * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num2 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  const cx = c * cxp - s * cyp + (x0 + x1) / 2, cy = s * cxp + c * cyp + (y0 + y1) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), h = dt / n, k = 4 / 3 * Math.tan(h / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c];
  const d = (t) => [-rx * Math.sin(t) * c - ry * Math.cos(t) * s, -rx * Math.sin(t) * s + ry * Math.cos(t) * c];
  const out = [];
  for (let j = 0; j < n; j++) {
    const a = t0 + j * h, b = a + h, pa = pt(a), pb = j === n - 1 ? [x1, y1] : pt(b), da = d(a), db = d(b);
    out.push([[pa[0] + k * da[0], pa[1] + k * da[1]], [pb[0] - k * db[0], pb[1] - k * db[1]], pb]);
  }
  return out;
}

// Path data through matrix m => subs [{ pts: [x, y, ...], closed }], curves sampled so no point of the
// polyline is further than tol from the curve. Relative commands, implicit repeats, H/V, S/T reflections,
// quadratics (raised to cubics) and arcs are all read.
export function flattenD(d, m = I, tol = 0.6, el = { name: 'path', attrs: {}, line: 0 }) {
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null, i = 0, cmd = '';
  const src = String(d);
  const skipWs = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
  const NUM1 = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const number = () => {
    skipWs(); NUM1.lastIndex = i;
    const r = NUM1.exec(src);
    if (!r) fail(el, `d="${src.slice(0, 40)}...": expected a number at '${src.slice(i, i + 12)}'`);
    i = NUM1.lastIndex;
    return +r[0];
  };
  const flag = () => {
    skipWs();
    if (src[i] !== '0' && src[i] !== '1') fail(el, `d: an arc flag must be 0 or 1 at '${src.slice(i, i + 12)}'`);
    return +src[i++];
  };
  const start = (px, py) => { cur = { pts: [...ap(m, px, py)], closed: false }; subs.push(cur); };
  const lineTo = (px, py) => { if (!cur) start(x, y); cur.pts.push(...ap(m, px, py)); };
  const cubicTo = (c0, c1, p1) => {
    if (!cur) start(x, y);
    const P0 = ap(m, x, y), C0 = ap(m, ...c0), C1 = ap(m, ...c1), P1 = ap(m, ...p1);
    const dd = Math.max(Math.hypot(P0[0] - 2 * C0[0] + C1[0], P0[1] - 2 * C0[1] + C1[1]), Math.hypot(C0[0] - 2 * C1[0] + P1[0], C0[1] - 2 * C1[1] + P1[1]));
    const n = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(6 * dd / (8 * tol)))));
    const pts = cubic(P0, C0, C1, P1, n).sub[0].pts;
    cur.pts.push(...pts.slice(2));
  };
  for (;;) {
    skipWs();
    if (i >= src.length) break;
    if (/[a-zA-Z]/.test(src[i])) cmd = src[i++];
    else if (!cmd) fail(el, `d must start with a command, not '${src.slice(i, i + 12)}'`);
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';   // extra pairs after a move are lines
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0, C = cmd.toUpperCase();
    let nc = null, nq = null;
    switch (C) {
      case 'M': { x = ox + number(); y = oy + number(); sx = x; sy = y; start(x, y); break; }
      case 'L': { x = ox + number(); y = oy + number(); lineTo(x, y); break; }
      case 'H': { x = ox + number(); lineTo(x, y); break; }
      case 'V': { y = oy + number(); lineTo(x, y); break; }
      case 'C': {
        const c0 = [ox + number(), oy + number()], c1 = [ox + number(), oy + number()], p = [ox + number(), oy + number()];
        cubicTo(c0, c1, p); [x, y] = p; nc = c1; break;
      }
      case 'S': {
        const c0 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y], c1 = [ox + number(), oy + number()], p = [ox + number(), oy + number()];
        cubicTo(c0, c1, p); [x, y] = p; nc = c1; break;
      }
      case 'Q': case 'T': {
        const q = C === 'Q' ? [ox + number(), oy + number()] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p = [ox + number(), oy + number()];
        cubicTo([x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)], [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])], p);
        [x, y] = p; nq = q; break;
      }
      case 'A': {
        const rx = number(), ry = number(), rot = number(), large = flag(), sweep = flag(), p = [ox + number(), oy + number()];
        for (const [c0, c1, q] of arcCubics(x, y, rx, ry, rot * DEG, large, sweep, p[0], p[1])) { cubicTo(c0, c1, q); [x, y] = q; }
        [x, y] = p; break;
      }
      case 'Z': { if (cur) cur.closed = true; cur = null; x = sx; y = sy; cmd = ''; break; }
      default: fail(el, `d: unknown command '${cmd}'`);
    }
    lastC = nc; lastQ = nq;
  }
  return subs;
}

// Points rounded to 1/1000 of a unit (so a file drawn on round numbers imports as round numbers), repeated
// points dropped, a closing point that repeats the first dropped, and subs of one point gone.
const q3 = (v) => Math.round(v * 1000) / 1000 || 0;
function tidy(subs, dx = 0, dy = 0) {
  const out = [];
  for (const s of subs) {
    const pts = [];
    for (let j = 0; j < s.pts.length; j += 2) {
      const px = q3(s.pts[j] - dx), py = q3(s.pts[j + 1] - dy);
      if (pts.length && pts[pts.length - 2] === px && pts[pts.length - 1] === py) continue;
      pts.push(px, py);
    }
    if (s.closed && pts.length > 2 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts.length -= 2;
    if (pts.length >= 4) out.push({ pts, closed: s.closed });
  }
  return out;
}

const shoelace = (pts) => { let a = 0; for (let j = 0; j < pts.length; j += 2) { const k = (j + 2) % pts.length; a += pts[j] * pts[k + 1] - pts[k] * pts[j + 1]; } return Math.abs(a) / 2; };
const length = (s) => { let L = 0; const p = s.pts; for (let j = 2; j < p.length; j += 2) L += Math.hypot(p[j] - p[j - 2], p[j + 1] - p[j - 1]); return L; };
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// ---------- the drawing: every shape in document order, in logical units ----------

// src => { root, box, units, ground, desc, k, shapes, groups }. A shape is { el, subs, fill, stroke, w, alpha,
// finish, chain } in logical units; chain is the list of <g> elements it sits inside, outermost first.
function drawing(src, { flatten = 0.6, units } = {}) {
  if (!(flatten > 0)) throw new SvgError(`flatten ${flatten}: a distance in logical units, > 0`);
  const root = parseXml(src);
  const vb = nums(root.attrs.viewBox);
  const box0 = vb.length === 4 ? vb : [0, 0, num(root, 'width', 0), num(root, 'height', 0)];
  if (!(box0[2] > 0 && box0[3] > 0)) throw new SvgError('<svg> needs a viewBox (or width and height): it is the box of the drawing');
  const own = root.attrs['data-units'] !== undefined ? num(root, 'data-units') : box0[3];
  const k = units ? units / own : 1, M0 = [k, 0, 0, k, 0, 0];
  const shapes = [];

  const visit = (el, m, style, chain) => {
    if (el.name === '#text') return;
    if (REFUSED[el.name]) fail(el, `refused: ${REFUSED[el.name]}`);
    if (el.name.includes(':')) return;   // editor metadata (sodipodi:namedview, ...)
    if (SILENT.has(el.name)) { for (const kid of el.kids) if (kid.name !== '#text') checkRefused(kid); return; }
    const st = inherit(style, el);
    if (st.display === 'none') return;
    const mm = el.attrs.transform ? mul(m, parseTransform(el.attrs.transform, el)) : m;
    if (el.name === 'g') { for (const kid of el.kids) visit(kid, mm, st, [...chain, el]); return; }
    if (!SHAPES.has(el.name)) fail(el, `refused: <${el.name}> is not a shape this importer reads (path rect circle ellipse line polyline polygon g)`);
    if (st.visibility === 'hidden' || st.visibility === 'collapse') return;
    const subs = flattenD(shapeD(el), mm, flatten, el);
    const f = paint(st.fill, el, 'fill', st.color), s = paint(st.stroke, el, 'stroke', st.color);
    const fo = st['fill-opacity'] === undefined ? 1 : parseFloat(st['fill-opacity']);
    const so = st['stroke-opacity'] === undefined ? 1 : parseFloat(st['stroke-opacity']);
    shapes.push({
      el, subs, chain,
      fill: f && { hex: f.hex, alpha: f.a * fo * st.opacity },
      stroke: s && { hex: s.hex, alpha: s.a * so * st.opacity },
      w: st['stroke-width'] === undefined ? undefined : parseFloat(st['stroke-width']) * scaleOf(mm),
      finish: st.finish,
    });
  };
  const checkRefused = (el) => { if (REFUSED[el.name]) fail(el, `refused: ${REFUSED[el.name]}`); el.kids.forEach((kid) => kid.name !== '#text' && checkRefused(kid)); };
  const rootStyle = inherit(ROOT_STYLE, root);
  for (const kid of root.kids) visit(kid, mul(M0, root.attrs.transform ? parseTransform(root.attrs.transform, root) : I), rootStyle, []);

  const box = box0.map((v) => q3(v * k));
  return { root, box, units: q3(units ?? own), k, shapes, desc: root.attrs['data-desc'] };
}

// ---------- colours and roles ----------

const HOUSE = LOOKS.paperInk.palette;
const CANDIDATES = [...HOUSE.fills.map((c, i) => [`fills.${i}`, c]), ...HOUSE.accents.map((c, i) => [`accents.${i}`, c])];

// How far apart two colours read: hue (weighted by how saturated both are), saturation and lightness.
function distance(a, b) {
  const [h0, s0, l0] = hsl(a), [h1, s1, l1] = hsl(b);
  const dh = Math.min(Math.abs(h0 - h1), 360 - Math.abs(h0 - h1)) / 180;
  return dh * Math.min(s0, s1) * 2 + Math.abs(s0 - s1) + Math.abs(l0 - l1);
}

// { hex: role } for every colour: the darkest ink, the lightest paper, the rest by area to the nearest unused
// house fill or accent (reused, nearest first, once all eight are taken).
export function autoRoles(rows) {
  const out = {}, byL = [...rows].sort((a, b) => hsl(a.hex)[2] - hsl(b.hex)[2]);
  if (byL.length && hsl(byL[0].hex)[2] <= 0.35) out[byL[0].hex] = 'ink';
  const lightest = byL.at(-1);
  if (lightest && !out[lightest.hex] && hsl(lightest.hex)[2] >= 0.85) out[lightest.hex] = 'paper';
  const used = new Set();
  for (const r of [...rows].sort((a, b) => b.area - a.area || (a.hex < b.hex ? -1 : 1))) {
    if (out[r.hex]) continue;
    const pool = CANDIDATES.filter(([role]) => !used.has(role));
    const [role] = (pool.length ? pool : CANDIDATES).reduce((best, c) => (distance(r.hex, c[1]) < distance(r.hex, best[1]) ? c : best));
    used.add(role);
    out[r.hex] = role;
  }
  return out;
}

// Every colour the drawing paints with its area (a fill's area, a stroke's length times its width), largest
// first; `roles` overrides the automatic role of any of them.
function colourTable(shapes, roles = {}) {
  const area = new Map();
  const add = (hex, a) => area.set(hex, (area.get(hex) ?? 0) + a);
  for (const s of shapes) {
    if (s.fill && s.el.name !== 'line') add(s.fill.hex, s.subs.reduce((a, sub) => a + (sub.pts.length >= 6 ? shoelace(sub.pts) : 0), 0));
    if (s.stroke) add(s.stroke.hex, s.subs.reduce((a, sub) => a + length(sub), 0) * (s.w ?? 2));
  }
  const rows = [...area].map(([hex, a]) => ({ hex, area: Math.round(a) })).sort((a, b) => b.area - a.area || (a.hex < b.hex ? -1 : 1));
  const auto = autoRoles(rows), given = normRoles(roles);
  for (const [hex, role] of Object.entries(given)) {
    try { resolveRole(role, LOOKS.paperInk); } catch (e) { throw new SvgError(`roles: ${hex} -> ${JSON.stringify(role)}: ${e.message}`); }
  }
  return rows.map((r) => ({ ...r, role: given[r.hex] ?? auto[r.hex], how: given[r.hex] ? 'map' : 'auto' }));
}
const normRoles = (roles) => Object.fromEntries(Object.entries(roles ?? {}).map(([hex, role]) => [paint(hex, null, 'roles', null)?.hex ?? hex, role]));

// The table of a file's colours without importing it (`hdf svg --roles ask`).
export function svgColours(src, opts = {}) {
  return colourTable(drawing(src, opts).shapes.filter((s) => !isMarker(s)), opts.roles);
}

// A shape's ops: its fill, then its stroke, as SVG paints them.
function opsOf(shape, subs, roleOf) {
  const out = [];
  const finishFor = (role) => (shape.finish === undefined ? /^(fills|accents)\./.test(role)
    : shape.finish === 'false' ? false : shape.finish === 'true' || shape.finish === '' ? true : shape.finish);
  // A line has no inside, and neither has a sub of two points: SVG fills neither.
  const areas = shape.el.name === 'line' ? [] : subs.filter((s) => s.pts.length >= 6);
  if (shape.fill && areas.length) {
    const role = roleOf(shape.fill.hex), fin = finishFor(role);
    out.push(fill(mkPath(areas.map((s) => ({ pts: s.pts, closed: true }))), role, {
      ...(fin ? { finish: fin } : {}), ...(shape.fill.alpha < 1 ? { alpha: +shape.fill.alpha.toFixed(3) } : {}),
    }));
  }
  if (shape.stroke && subs.length) {
    out.push(stroke(mkPath(subs), roleOf(shape.stroke.hex), {
      ...(shape.w !== undefined ? { w: q3(shape.w) } : {}), ...(shape.stroke.alpha < 1 ? { alpha: +shape.stroke.alpha.toFixed(3) } : {}),
    }));
  }
  return out;
}
const asData = (ops) => JSON.parse(serialise(ops));

// ---------- motif: the whole drawing as one list ----------

// src => { payload: serialised op list, table }. Ids are ignored; pose:, cycle:, pivot and ground are not drawn.
export function svgMotif(src, opts = {}) {
  const d = drawing(src, opts);
  const shapes = d.shapes.filter((s) => !isMarker(s) && !s.chain.some((g) => /^(pose|cycle):/.test(g.attrs.id ?? '')));
  const table = colourTable(shapes, opts.roles), role = roleLookup(table);
  const payload = asData(shapes.flatMap((s) => opsOf(s, tidy(s.subs), role)));
  if (!payload.length) throw new SvgError('the file draws nothing');
  return { payload, table };
}
const roleLookup = (table) => { const m = new Map(table.map((r) => [r.hex, r.role])); return (hex) => m.get(hex); };
const isMarker = (s) => /^(pivot|ground)([_-]\d+)?$/.test(s.el.attrs.id ?? '');

// ---------- puppet: rig from ids ----------

// 'arm-l:-70, head:8, eye:happy' => { 'arm-l': -70, head: 8, eye: 'happy' }
function joints(el) {
  const out = {};
  for (const item of String(el.attrs['data-joints'] ?? '').split(/[,;]/)) {
    if (!item.trim()) continue;
    const c = item.indexOf(':');
    if (c < 0) fail(el, `data-joints: '${item.trim()}' is not part:value`);
    const key = item.slice(0, c).trim(), raw = item.slice(c + 1).trim();
    out[key] = raw !== '' && !Number.isNaN(+raw) ? +raw : raw;
  }
  return out;
}
const pt2 = (el, v) => { const p = nums(v); if (p.length !== 2) fail(el, `data-pivot="${v}": expected "x,y"`); return p; };

// src => { payload, table }: the puppet (plan 1.2) the file's ids describe. See the header for the rules.
export function svgPuppet(src, opts = {}) {
  const d = drawing(src, opts);
  const table = colourTable(d.shapes.filter((s) => !isMarker(s)), opts.roles), role = roleLookup(table);
  const viewGs = d.root.kids.filter((el) => el.name === 'g' && /^view:/.test(el.attrs.id ?? ''));
  const head = {
    kind: 'puppet', name: opts.name ?? d.root.attrs.id ?? 'puppet', units: d.units, box: d.box,
    ...(d.desc ? { desc: d.desc } : {}),
  };
  const tail = (r) => ({
    ...(Object.keys(r.inputs).length ? { inputs: r.inputs } : {}),
    ...(Object.keys(r.poses).length ? { poses: r.poses } : {}),
    ...(Object.keys(r.cycles).length ? { cycles: r.cycles } : {}),
    roles: Object.fromEntries(table.map((row) => [row.hex, row.role])),
  });
  if (!viewGs.length) {
    const r = rigOf(d.root, d.shapes, d.k, role);
    return { payload: { ...head, ground: r.ground, parts: r.parts, ...tail(r) }, table };
  }

  // One rig per view, over the view's own groups and the shared poses, cycles and ground.
  const shared = d.root.kids.filter((el) => !viewGs.includes(el));
  const views = [], rigs = [];
  for (const g of viewGs) {
    const v = g.attrs.id.slice(5);
    if (!v) fail(g, 'a view needs a name: view:side, view:three-quarter, view:front');
    if (views.includes(v)) fail(g, `view '${v}' appears twice`);
    views.push(v);
    const root = { ...d.root, kids: [...g.kids, ...shared] };
    const shapes = d.shapes.filter((s) => s.chain[0] === g || !viewGs.includes(s.chain[0])).map((s) => (s.chain[0] === g ? { ...s, chain: s.chain.slice(1) } : s));
    rigs.push(rigOf(root, shapes, d.k, role, g));
  }
  const first = rigs[0], names = [...new Set(rigs.flatMap((r) => Object.keys(r.parts)))];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const parts = {}, inputs = { ...first.inputs };
  for (const n of names) {
    const has = rigs.map((r, j) => [views[j], r.parts[n], r]).filter(([, p]) => p);
    const [v0, p0, r0] = has[0];
    for (const [v, p, r] of has.slice(1)) {
      if (p.parent !== p0.parent) fail(r.els[n], `'${n}' has parent '${p.parent ?? 'none'}' in view ${v} and '${p0.parent ?? 'none'}' in view ${v0}`);
      const k0 = Object.keys(p0.variants ?? {}), k = Object.keys(p.variants ?? {});
      if (!same(k, k0)) fail(r.els[n], `'${n}' has variants ${k.join(', ') || 'none'} in view ${v} and ${k0.join(', ') || 'none'} in view ${v0}`);
    }
    for (const [, p] of has) if (!p0.variants && p.variants) fail(r0.els[n], `'${n}' has variants in one view only`);
    if (!inputs[n] && has.some(([, , r]) => r.inputs[n])) inputs[n] = has.find(([, , r]) => r.inputs[n])[2].inputs[n];
    const entry = {};
    if (p0.parent !== undefined) entry.parent = p0.parent;
    // Drawn in the first view only: the same in every view, as a part without views is.
    if (has.length === 1 && v0 === views[0]) {
      Object.assign(entry, p0);
    } else {
      const pivots = has.map(([v, p]) => [v, p.pivot]);
      if (pivots.every(([, pv]) => pv && same(pv, pivots[0][1])) && has.length === views.length) entry.pivot = pivots[0][1];
      else if (pivots.some(([, pv]) => pv)) entry.pivot = Object.fromEntries(pivots.filter(([, pv]) => pv));
      if (has.some(([, p]) => p.ops)) entry.ops = Object.fromEntries(has.map(([v, p]) => [v, p.ops ?? []]));
      if (p0.variants) entry.variants = Object.fromEntries(Object.keys(p0.variants).map((k) => [k, Object.fromEntries(has.map(([v, p]) => [v, p.variants[k]]))]));
    }
    parts[n] = entry;
  }
  return { payload: { ...head, views, ground: first.ground, parts, ...tail({ ...first, inputs }) }, table };
}

// One rig (a view, or the whole file): the parts the ids under `root` describe, from `shapes` (chains
// relative to root). k is the drawing's scale, role the colour lookup; `where` names the view in errors.
function rigOf(rootEl, shapes, k, role, where = null) {
  const d = { root: rootEl, shapes, k };
  // Stepped variants: sibling ids base-0, base-1, ... (a base-0 and at least one more).
  const ids = [];
  const collect = (el) => { if (el.attrs.id) ids.push(el.attrs.id); el.kids.forEach(collect); };
  rootEl.kids.forEach(collect);
  const stepped = new Set();
  for (const id of ids) {
    const m = /^(.+)-0$/.exec(id);
    if (m && ids.some((o) => o !== id && new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(o))) stepped.add(m[1]);
  }
  const stepOf = (id) => { const m = /^(.+)-(\d+)$/.exec(id ?? ''); return m && stepped.has(m[1]) ? [m[1], m[2]] : null; };

  const parts = new Map(), poses = {}, cycles = {};
  const part = (name, el) => {
    if (!parts.has(name)) parts.set(name, { name, el, parent: undefined, pivot: undefined, ops: [], variants: null, steps: false, shapes: [] });
    return parts.get(name);
  };
  // The role a <g> plays: [kind, part, variant].
  const roleOfG = new Map();
  let ground = [0, 0];
  // owner: the enclosing part, or null; inside a variant every g is plain drawing.
  const walkG = (el, owner, inVariant = false) => {
    for (const kid of el.kids) {
      if (kid.name !== 'g') continue;
      const id = kid.attrs.id;
      if (inVariant) { roleOfG.set(kid, ['plain']); walkG(kid, owner, true); continue; }
      if (!owner && /^pose:/.test(id ?? '')) { poses[id.slice(5)] = joints(kid); roleOfG.set(kid, ['skip']); continue; }
      if (!owner && /^cycle:/.test(id ?? '')) {
        const frames = kid.kids.filter((f) => f.name === 'g').map(joints);
        if (!frames.length) fail(kid, 'a cycle needs one <g data-joints="..."> per frame');
        cycles[id.slice(6)] = { fps: kid.attrs['data-fps'] !== undefined ? num(kid, 'data-fps') : 12, n: frames.length, frames };
        roleOfG.set(kid, ['skip']);
        continue;
      }
      const step = stepOf(id);
      if (step) {
        const p = part(step[0], kid);
        if (p.variants && !p.steps) fail(kid, `'${step[0]}' is already a part; ${id} cannot also be one of its steps`);
        p.variants ??= new Map(); p.steps = true;
        if (p.variants.has(step[1])) fail(kid, `step ${id} appears twice`);
        p.variants.set(step[1], []);
        rigAttrs(p, kid, owner);
        roleOfG.set(kid, ['variant', p, step[1]]);
        walkG(kid, p, true);
        continue;
      }
      if (id && owner?.variants && !owner.steps && roleOfG.get(el)?.[0] === 'part' && el.attrs['data-variants'] !== undefined) {
        if (owner.variants.has(id)) fail(kid, `variant '${id}' of '${owner.name}' appears twice`);
        owner.variants.set(id, []);
        roleOfG.set(kid, ['variant', owner, id]);
        walkG(kid, owner, true);
        continue;
      }
      if (id && !/^pivot([_-]\d+)?$/.test(id)) {
        if (parts.has(id)) fail(kid, `part '${id}' appears twice (ids must be unique)`);
        const p = part(id, kid);
        if (kid.attrs['data-variants'] !== undefined) p.variants = new Map();
        rigAttrs(p, kid, owner);
        roleOfG.set(kid, ['part', p]);
        walkG(kid, p);
        continue;
      }
      roleOfG.set(kid, ['plain']);
      walkG(kid, owner);
    }
  };
  const rigAttrs = (p, g, owner) => {
    const parent = g.attrs['data-parent'] ?? owner?.name;
    if (parent !== undefined && parent !== p.name) {
      if (p.parent !== undefined && p.parent !== parent) fail(g, `'${p.name}' has two parents, '${p.parent}' and '${parent}'`);
      p.parent = parent;
    }
    if (g.attrs['data-pivot'] !== undefined) p.pivot = pt2(g, g.attrs['data-pivot']).map((v) => v * d.k);
  };
  walkG(d.root, null);

  // Each shape goes to the innermost part or variant around it; pivots and the ground are read, not drawn.
  for (const s of d.shapes) {
    let target = null;
    for (const g of s.chain) {
      const r = roleOfG.get(g);
      if (!r) continue;
      if (r[0] === 'skip') { target = 'skip'; break; }
      if (r[0] === 'part') target = { p: r[1], v: null };
      if (r[0] === 'variant') target = { p: r[1], v: r[2] };
    }
    if (target === 'skip') continue;
    const id = s.el.attrs.id ?? '';
    if (/^ground([_-]\d+)?$/.test(id) && !s.chain.length) { ground = centre(s); continue; }
    if (/^pivot([_-]\d+)?$/.test(id)) {
      if (!target) fail(s.el, 'a pivot outside any part');
      target.p.pivot = centre(s);
      continue;
    }
    if (!target) fail(s.el, 'drawn outside any part: put it inside a <g id="..."> (the part it belongs to)');
    target.p.shapes.push({ s, v: target.v });
  }
  if (!parts.size) {
    if (where) fail(where, 'draws no parts: a view holds the <g id="..."> parts of the puppet as seen from there');
    throw new SvgError('no parts: a puppet is made of <g id="..."> groups (see hdf svg in the usage)');
  }
  for (const p of parts.values()) {
    if (p.parent !== undefined && !parts.has(p.parent)) fail(p.el, `data-parent="${p.parent}" names no part`);
    if (p.variants && !p.variants.size) fail(p.el, 'data-variants, but no child <g id="..."> to be the variants');
  }

  const pivotOf = (n) => { for (let c = n; c !== undefined; c = parts.get(c).parent) if (parts.get(c).pivot) return parts.get(c).pivot; return [0, 0]; };
  const out = {}, inputs = {};
  for (const p of parts.values()) {
    const [px, py] = pivotOf(p.name);
    const own = [], vars = p.variants ? new Map([...p.variants.keys()].map((k) => [k, []])) : null;
    for (const { s, v } of p.shapes) (v === null ? own : vars.get(v)).push(...opsOf(s, tidy(s.subs, px, py), role));
    const entry = {};
    if (p.parent !== undefined) entry.parent = p.parent;
    if (p.pivot) entry.pivot = p.pivot.map(q3);
    if (own.length || !vars) entry.ops = asData(own);
    if (vars) {
      const keys = p.steps ? [...vars.keys()].sort((a, b) => a - b) : [...vars.keys()];
      entry.variants = Object.fromEntries(keys.map((k) => [k, asData(vars.get(k))]));
      if (p.steps) {
        const n = keys.map(Number);
        if (n.some((v, j) => v !== j)) fail(p.el, `steps of '${p.name}' must run 0, 1, 2, ... without gaps (have ${keys.join(', ')})`);
        inputs[p.name] = [0, n.length - 1, 1];
      } else inputs[p.name] = keys;
    }
    out[p.name] = entry;
  }
  return { parts: out, inputs, poses, cycles, ground: ground.map(q3), els: Object.fromEntries([...parts.values()].map((p) => [p.name, p.el])) };
}

// The centre of a marker shape (a pivot or ground circle), in logical units.
function centre(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sub of s.subs) for (let j = 0; j < sub.pts.length; j += 2) {
    x0 = Math.min(x0, sub.pts[j]); x1 = Math.max(x1, sub.pts[j]); y0 = Math.min(y0, sub.pts[j + 1]); y1 = Math.max(y1, sub.pts[j + 1]);
  }
  if (x0 === Infinity) fail(s.el, 'a marker with no extent');
  return [q3((x0 + x1) / 2), q3((y0 + y1) / 2)];
}

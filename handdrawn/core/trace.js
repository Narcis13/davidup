// Alpha -> silhouette path. Marching squares on a downsampled alpha grid, loops joined through the cell
// edges they cross, specks dropped, Douglas–Peucker simplified, coordinates in the image's own pixels.
// Pure: no canvas, so it is unit-testable. Output is core/list.js's path shape:
//   { sub: [{ pts: [x0,y0,x1,y1,...], closed: true }, ...], box: [x, y, w, h] }
// Outer contours and holes are separate closed subs; core/list.js `inside` is even-odd, so holes read as holes.

const r1 = (v) => Math.round(v * 10) / 10;

// data: RGBA (length 4*w*h, alpha read from every fourth byte) or a bare alpha plane (length w*h).
// threshold: alpha (0..255) a grid cell must exceed to count as inside.
// size: long side of the grid (the image is averaged down to it; never up). step overrides it (image px per cell).
// eps: Douglas–Peucker tolerance in grid cells. minArea: specks below this many grid cells² are dropped.
export function traceAlpha(data, w, h, { threshold = 96, size = 256, step, eps = 0.6, minArea = 16 } = {}) {
  const ch = data.length === w * h ? 1 : 4, off = ch - 1;
  if (data.length !== w * h * ch) throw new Error(`traceAlpha: ${data.length} values for ${w}x${h}`);
  step = step ?? Math.max(1, Math.max(w, h) / size);
  const gw = Math.ceil(w / step), gh = Math.ceil(h / step);

  // Grid padded by one empty cell all round, so every contour closes. Cell value = mean alpha of its pixels.
  const GW = gw + 2, GH = gh + 2, g = new Float32Array(GW * GH);
  const xs = new Int32Array(gw + 1), ys = new Int32Array(gh + 1);
  for (let i = 0; i <= gw; i++) xs[i] = Math.min(w, Math.round(i * step));
  for (let j = 0; j <= gh; j++) ys[j] = Math.min(h, Math.round(j * step));
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let s = 0, n = 0;
    for (let y = ys[j]; y < ys[j + 1]; y++) for (let x = xs[i]; x < xs[i + 1]; x++) { s += data[(y * w + x) * ch + off]; n++; }
    g[(j + 1) * GW + i + 1] = n ? s / n : 0;
  }

  // Crossing points live on grid edges: id 2k is the edge (k)->(k+1), 2k+1 the edge (k)->(k+GW), k = j*GW+i.
  const pos = new Map();                       // id -> [x, y] in grid units (padded)
  const link = new Map();                      // id -> [neighbour ids]
  const at = (i, j) => g[j * GW + i];
  const point = (id) => {
    if (pos.has(id)) return id;
    const k = id >> 1, i = k % GW, j = (k - i) / GW, vert = id & 1;
    const a = at(i, j), b = vert ? at(i, j + 1) : at(i + 1, j), t = (threshold - a) / (b - a);
    pos.set(id, vert ? [i, j + t] : [i + t, j]);
    return id;
  };
  const seg = (p, q) => {
    point(p); point(q);
    (link.get(p) ?? link.set(p, []).get(p)).push(q);
    (link.get(q) ?? link.set(q, []).get(q)).push(p);
  };
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const k = j * GW + i;
    const tl = at(i, j) > threshold, tr = at(i + 1, j) > threshold, br = at(i + 1, j + 1) > threshold, bl = at(i, j + 1) > threshold;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = 2 * k, B = 2 * (k + GW), L = 2 * k + 1, R = 2 * (k + 1) + 1;
    switch (c) {
      case 1: case 14: seg(L, B); break;
      case 2: case 13: seg(B, R); break;
      case 3: case 12: seg(L, R); break;
      case 4: case 11: seg(T, R); break;
      case 6: case 9: seg(T, B); break;
      case 7: case 8: seg(L, T); break;
      case 5: case 10: {                       // saddle: the cell centre decides whether the diagonals join
        const mid = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > threshold;
        if ((c === 5) === mid) { seg(L, T); seg(B, R); } else { seg(L, B); seg(T, R); }
      }
    }
  }

  // Walk the loops. Every crossing point has exactly two neighbours.
  const seen = new Set(), sub = [];
  const px = (v) => Math.min(w, Math.max(0, (v - 0.5) * step));   // padded grid unit -> image px (cell centres)
  const py = (v) => Math.min(h, Math.max(0, (v - 0.5) * step));
  for (const start of link.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(pos.get(cur));
      const [a, b] = link.get(cur);
      const next = a !== prev && !seen.has(a) ? a : b;
      prev = cur; cur = next;
    }
    if (loop.length < 3 || Math.abs(area(loop)) < minArea) continue;
    const simple = simplifyClosed(loop, eps);
    if (simple.length < 3) continue;
    const pts = [];
    for (const [x, y] of simple) pts.push(r1(px(x)), r1(py(y)));
    sub.push({ pts, closed: true });
  }
  // Largest first: the body before its holes and specks.
  sub.sort((a, b) => Math.abs(areaFlat(b.pts)) - Math.abs(areaFlat(a.pts)));
  return { sub, box: boxOf(sub) };
}

function area(loop) {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return s / 2;
}
function areaFlat(p) {
  let s = 0;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) s += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
  return s / 2;
}

export function boxOf(sub) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sub) for (let i = 0; i < s.pts.length; i += 2) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? [0, 0, 0, 0] : [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)];
}

// Douglas–Peucker on a closed ring: split at the first point and the point farthest from it.
export function simplifyClosed(loop, eps) {
  const n = loop.length;
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > best) { best = d; far = i; } }
  const a = dp([...loop.slice(0, far + 1)], eps), b = dp([...loop.slice(far), loop[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let idx = -1, max = eps;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      const d = len ? Math.abs(dy * (x - ax) - dx * (y - ay)) / len : Math.hypot(x - ax, y - ay);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

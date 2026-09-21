// Ink masks -> strokes: the pure-JS half of what cli/roto.py does with scikit-image, for `hdf hand` (plan 1.4).
// A mask is a Uint8Array of w x h, 1 where there is ink. zhangSuen() thins it to a one-pixel skeleton,
// distanceTransform() gives the pen's half-width at every ink pixel, prune() drops the whiskers thinning
// leaves at corners, and traceSkeleton() walks the skeleton into polylines with a width each (roto.py's
// trace(), plus joining the branches that run straight through a crossing). Pure: no canvas, no images.

const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];   // N, NE, E, SE, S, SW, W, NW

// The 8 neighbours of pixel i, clockwise from north, as 0/1 (outside the image reads 0).
function ring(m, w, h, i) {
  const x = i % w, y = (i - x) / w, p = new Array(8);
  for (let k = 0; k < 8; k++) {
    const nx = x + N8[k][0], ny = y + N8[k][1];
    p[k] = nx >= 0 && ny >= 0 && nx < w && ny < h ? m[ny * w + nx] : 0;
  }
  return p;
}

// Zhang-Suen thinning, then the staircase corners it leaves removed so every line is 8-connected and one
// pixel wide (a pixel whose two set 4-neighbours turn a corner, when removing it disconnects nothing).
export function zhangSuen(mask, w, h) {
  const m = Uint8Array.from(mask, (v) => (v ? 1 : 0)), del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const [n, ne, e, se, s, sw, W, nw] = ring(m, w, h, i), p = [n, ne, e, se, s, sw, W, nw];
        const b = n + ne + e + se + s + sw + W + nw;
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        if (pass === 0 ? (n * e * s || e * s * W) : (n * e * W || n * s * W)) continue;
        del.push(i);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const p = ring(m, w, h, i), b = p.reduce((s, v) => s + v, 0);
    if (b < 2) continue;
    const corner = (p[0] && p[2]) || (p[2] && p[4]) || (p[4] && p[6]) || (p[6] && p[0]);
    if (corner && simple(p)) m[i] = 0;
  }
  return m;
}

// Yokoi's connectivity number for 8-connectivity is 1: removing the pixel joins or splits nothing.
function simple(p) {
  const q = p.map((v) => 1 - v);
  let c = 0;
  for (const k of [0, 2, 4, 6]) c += q[k] - q[k] * q[(k + 1) % 8] * q[(k + 2) % 8];
  return c === 1;
}

// Euclidean distance from each ink pixel to the nearest paper pixel (Felzenszwalb and Huttenlocher, two 1-D
// passes); 0 on paper. A pixel beside the paper is 1, so a band n pixels wide peaks near (n + 1) / 2.
export function distanceTransform(mask, w, h) {
  const INF = 1e20, f = new Float64Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? INF : 0;
  const n = Math.max(w, h), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), line = new Float64Array(n);
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) line[q] = get(q);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        s = ((line[q] + q * q) - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k] || k === 0) break;
        k--;
      }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + line[v[k]];
    }
    for (let q = 0; q < len; q++) set(q, d[q]);
  };
  for (let x = 0; x < w; x++) pass(h, (y) => f[y * w + x], (y, val) => { f[y * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, (x) => f[y * w + x], (x, val) => { f[y * w + x] = val; });
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(f[i]);
  return out;
}

// Neighbour counts of a skeleton (the pixel itself not counted).
export function degrees(sk, w, h) {
  const nb = new Uint8Array(w * h);
  for (let i = 0; i < sk.length; i++) if (sk[i]) nb[i] = ring(sk, w, h, i).reduce((s, v) => s + v, 0);
  return nb;
}

const neighbours = (sk, w, h, i) => {
  const x = i % w, y = (i - x) / w, out = [];
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) out.push(ny * w + nx);
  }
  const four = (q) => (Math.abs(q - i) === 1 || Math.abs(q - i) === w ? 0 : 1);
  return out.sort((a, b) => four(a) - four(b));                 // 4-neighbours first, as roto.py's walk prefers them
};

// The whiskers of a skeleton: a branch from an end point to a junction shorter than len pixels is removed
// (a real stroke end is kept: only branches that hang off a junction go). Two rounds, since removing a
// whisker can leave another one bare. Returns a new skeleton.
export function prune(skel, w, h, len) {
  const sk = Uint8Array.from(skel);
  for (let round = 0; round < 2; round++) {
    const nb = degrees(sk, w, h), kill = [];
    for (let i = 0; i < sk.length; i++) {
      if (!sk[i] || nb[i] !== 1) continue;
      const path = [i];
      let prev = -1, cur = i;
      for (;;) {
        const next = neighbours(sk, w, h, cur).filter((q) => q !== prev && !path.includes(q));
        if (!next.length) { path.length = 0; break; }          // an isolated line: not a whisker
        const q = next[0];
        if (nb[q] >= 3) break;                                  // reached the junction
        if (nb[q] === 1) { path.length = 0; break; }            // end to end: a stroke of its own
        path.push(q); prev = cur; cur = q;
        if (path.length > len) { path.length = 0; break; }
      }
      if (path.length && path.length <= len) kill.push(...path);
    }
    if (!kill.length) break;
    for (const i of kill) sk[i] = 0;
  }
  return sk;
}

// Skeleton -> strokes: [{ pts: [[x, y], ...], w, len, closed }] in pixels, longest first. Walks from every end
// point and junction (roto.py's trace), picks up the loops that have neither, then joins the branches that meet
// at a junction and carry on straight through it (the two bars of an x, the stem of a t through its cross bar).
// dt: distanceTransform() of the ink, for each stroke's pen width (2 x mean distance - 1); minLen: shorter
// strokes are dropped.
export function traceSkeleton(sk, w, h, { dt = null, minLen = 3 } = {}) {
  const nb = degrees(sk, w, h), visited = new Uint8Array(w * h), paths = [];
  const walk = (a, b) => {
    const path = [a];
    let prev = a, cur = b;
    for (;;) {
      path.push(cur);
      if (nb[cur] !== 2) break;
      visited[cur] = 1;
      const next = neighbours(sk, w, h, cur).filter((q) => q !== prev && !(visited[q] && nb[q] === 2));
      if (!next.length) break;
      prev = cur; cur = next[0];
    }
    return path;
  };
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || nb[i] === 2) continue;
    for (const q of neighbours(sk, w, h, i)) {
      if (visited[q] && nb[q] === 2) continue;
      const p = walk(i, q);
      if (p.length > 2) paths.push({ px: p, closed: false });
    }
  }
  for (let i = 0; i < sk.length; i++) {                        // loops with no end point
    if (!sk[i] || nb[i] !== 2 || visited[i]) continue;
    visited[i] = 1;
    const n0 = neighbours(sk, w, h, i);
    if (n0.length) { const p = walk(i, n0[0]); if (p[p.length - 1] === i) p.pop(); paths.push({ px: p, closed: true }); }
  }
  // Two walks can cover one branch from its two ends when both ends are junctions: keep one.
  const seen = new Set(), uniq = [];
  for (const p of paths) {
    const a = p.px[0], b = p.px[p.px.length - 1], key = p.closed ? `L${Math.min(...p.px)}` : `${Math.min(a, b)}:${Math.max(a, b)}:${p.px.length}`;
    if (seen.has(key)) continue;
    seen.add(key); uniq.push(p);
  }
  const merged = joinThrough(uniq, nb, w, h);
  const xy = (i) => [i % w, (i - (i % w)) / w];
  const out = [];
  for (const p of merged) {
    const pts = p.px.map(xy);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (p.closed) len += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
    if (len < minLen) continue;
    const width = dt ? Math.max(1, 2 * p.px.reduce((s, i) => s + dt[i], 0) / p.px.length - 1) : 2;
    out.push({ pts, w: width, len, closed: p.closed });
  }
  return out.sort((a, b) => b.len - a.len);
}

// Branches meeting at a junction (a clump of pixels with 3+ neighbours) joined in pairs when they carry on in
// a straight line: the most nearly opposite pair first, and only when they turn by less than 45 degrees.
function joinThrough(paths, nb, w, h) {
  const junction = (i) => nb[i] >= 3;
  // Label junction clumps.
  const clump = new Map();
  let id = 0;
  for (const p of paths) for (const end of [p.px[0], p.px.at(-1)]) {
    if (!junction(end) || clump.has(end)) continue;
    const stack = [end], c = id++;
    clump.set(end, c);
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy, q = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !junction(q) || clump.has(q)) continue;
        clump.set(q, c); stack.push(q);
      }
    }
  }
  const live = paths.map((p) => ({ ...p, px: [...p.px] }));
  const xy = (i) => [i % w, (i - (i % w)) / w];
  // The direction a path leaves through its end (0: start, 1: end), measured over up to 8 pixels.
  const dir = (p, end) => {
    const px = end ? p.px : [...p.px].reverse(), n = px.length, a = xy(px[Math.max(0, n - 9)]), b = xy(px[n - 1]);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  for (let guard = 0; guard < 1000; guard++) {
    let best = null;
    const ends = [];
    live.forEach((p, k) => {
      if (p.gone || p.closed) return;
      for (const e of [0, 1]) {
        const i = e ? p.px.at(-1) : p.px[0];
        if (clump.has(i)) ends.push({ k, e, c: clump.get(i), d: dir(p, e) });
      }
    });
    for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
      const A = ends[a], B = ends[b];
      if (A.c !== B.c || A.k === B.k) continue;
      const cos = A.d[0] * B.d[0] + A.d[1] * B.d[1];         // leaving in opposite directions: cos -> -1
      if (cos < -0.7 && (!best || cos < best.cos)) best = { A, B, cos };
    }
    if (!best) break;
    const P = live[best.A.k], Q = live[best.B.k];
    const pa = best.A.e ? P.px : [...P.px].reverse();         // P ending at the junction
    const qb = best.B.e ? [...Q.px].reverse() : Q.px;         // Q starting at the junction
    P.px = [...pa, ...qb];
    Q.gone = true;
  }
  return live.filter((p) => !p.gone);
}

// Douglas-Peucker on an open polyline of [x, y] points.
export function simplify(pts, eps) {
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

// Connected pieces of a mask (8-connected): [{ px: [indices], area, box: [x0, y0, x1, y1] }].
export function components(mask, w, h) {
  const lab = new Int32Array(w * h), out = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i]) continue;
    const c = { px: [], area: 0, box: [Infinity, Infinity, -Infinity, -Infinity] }, stack = [i];
    lab[i] = out.length + 1;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      c.px.push(j);
      if (x < c.box[0]) c.box[0] = x; if (y < c.box[1]) c.box[1] = y; if (x > c.box[2]) c.box[2] = x; if (y > c.box[3]) c.box[3] = y;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy, q = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[q] || lab[q]) continue;
        lab[q] = out.length + 1; stack.push(q);
      }
    }
    c.area = c.px.length;
    out.push(c);
  }
  return out;
}

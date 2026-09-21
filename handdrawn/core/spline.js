// The cardinal spline's arithmetic on its own, so the glyph table (built at load) needs nothing from list.js
// and list.js can measure lettering without an import cycle.

// Flat points of a cardinal spline through points ([[x, y], ...] or flat); tension 0 is Catmull-Rom, 1 is
// straight segments. Under three points, the points themselves.
export function splinePts(points, { tension = 0.5, closed = false, n = 8 } = {}) {
  const f = points.length && Array.isArray(points[0]) ? points.flat() : [...points], P = [];
  for (let i = 0; i < f.length; i += 2) P.push([f[i], f[i + 1]]);
  const m = P.length;
  if (m < 3) return P.flat();
  const get = (i) => (closed ? P[(i + m) % m] : P[Math.max(0, Math.min(m - 1, i))]);
  const k = (1 - tension) / 2, pts = [], segs = closed ? m : m - 1;
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    const m1 = [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k], m2 = [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    for (let i = 0; i < n; i++) {
      const t = i / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      pts.push(h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0], h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]);
    }
  }
  if (!closed) pts.push(P[m - 1][0], P[m - 1][1]);
  return pts;
}

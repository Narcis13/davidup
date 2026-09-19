// Found photos for the doodle look. A cutout (plan 1.6, written by `hdf photo`) is
// { name, credit, src, w, h, sil } with sil its silhouette path in the cutout's own pixels. Register cutouts
// in film({ assets }) under their name; image ops refer to them by that id.
//   const pl = pin(PHOTOS.teapot, { x: 540, y: 600, h: 420, rot: -0.1 });
//   [backdrop(), photo(pl), stroke(poly([on(pl, .9, .2), ...]), 'ink', { tool: 'brush' })]
// Everything here returns ops, so a placed photo hashes, caches and lints like any drawing.
import { circle, clip, fill, fx, group, image, mmul, paper, rect, rotate, scale, translate, xf } from './list.js';
import { radial } from './finish.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Where a photo sits (v1 place): its pivot (the centre unless pivot = [u, v]) at (x, y), h (or w) tall
// in logical units (default half the frame), turned by rot, mirrored by flip.
export function pin(ph, { x = 540, y = 540, h, w, rot = 0, flip = false, pivot = null, H = 1080 } = {}) {
  if (!ph || !ph.w || !ph.h) throw new TypeError('pin: expected a cutout { name, w, h, src, sil } (see hdf photo)');
  const ar = ph.w / ph.h;
  if (h === undefined) h = w !== undefined ? w / ar : H * 0.5;
  const pl = { ph, x, y, w: h * ar, h, rot, flip };
  if (pivot) {
    const dx = (pivot[0] - 0.5) * pl.w * (flip ? -1 : 1), dy = (pivot[1] - 0.5) * h, ca = Math.cos(rot), sa = Math.sin(rot);
    pl.x = x - (dx * ca - dy * sa);
    pl.y = y - (dx * sa + dy * ca);
  }
  return Object.freeze(pl);
}

// Photo units (u, v in 0..1 from the cutout's top left) to frame coordinates (v1 on / onAll).
export function on(pl, u, v) {
  const dx = (u - 0.5) * pl.w * (pl.flip ? -1 : 1), dy = (v - 0.5) * pl.h, ca = Math.cos(pl.rot), sa = Math.sin(pl.rot);
  return [pl.x + dx * ca - dy * sa, pl.y + dx * sa + dy * ca];
}
// on() for several [u, v] points.
export const onAll = (pl, uv) => uv.map(([u, v]) => on(pl, u, v));

// Frame <- cutout pixels.
const centreXf = (pl) => mmul(mmul(translate(pl.x, pl.y), rotate(pl.rot)), scale(pl.flip ? -1 : 1, 1));
const pixelXf = (pl) => mmul(mmul(centreXf(pl), translate(-pl.w / 2, -pl.h / 2)), scale(pl.w / pl.ph.w, pl.h / pl.ph.h));

// The cutout's silhouette in frame coordinates.
export const silhouette = (pl) => xf(pl.ph.sil, pixelXf(pl));

// The image itself, placed (no shadow).
function picture(pl, alpha) {
  const { ph } = pl, o = { name: `photo:${ph.name}`, xf: centreXf(pl) };
  if (pl.rot) o.cache = 'never';
  const sil = ph.sil ? xf(ph.sil, mmul(translate(-pl.w / 2, -pl.h / 2), scale(pl.w / ph.w, pl.h / ph.h))) : undefined;
  return group(o, [image(ph.name, -pl.w / 2, -pl.h / 2, pl.w, pl.h, { sil, ...(alpha === 1 ? {} : { alpha }) })]);
}

// A soft contact shadow under the photo on the paper (v1), day only. ground: the floor's y when the
// object lifts off it.
export function shadow(pl, { k = 0.3, width = 0.92, ground } = {}) {
  if (k <= 0) return null;
  const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => on(pl, u, v)), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const by = ground ?? Math.max(...ys), mx = (Math.min(...xs) + Math.max(...xs)) / 2, rx = (Math.max(...xs) - Math.min(...xs)) / 2 * width, ry = Math.max(10, rx * 0.13);
  return group({ name: 'shadow', xf: mmul(translate(mx, by - ry * 0.35), scale(1, ry / rx)), cache: 'never' }, [
    fill(circle(0, 0, rx, 48), 'ink', { cov: radial(0, 0, rx * 0.25, rx, k, 0), day: true }),
  ]);
}

// The photo with its shadow (v1 photo). shadow: 0 for an object that floats or flies.
export const photo = (pl, { shadow: k = 0.3, alpha = 1, ground } = {}) => group(`photo:${pl.ph.name}:with`, [shadow(pl, { k, ground }), picture(pl, alpha)]);

// The part of the photo inside `path`, over the doodles, so a drawing can sit inside or behind it.
export const photoFront = (pl, path) => clip(path, [picture(pl, 1)]);

// kids clipped to the photo's silhouette: drawings that live on the object's surface.
export const mask = (pl, kids) => fx('photoMask', { sil: silhouette(pl) }, kids);

// Silhouette profiles: for 240 steps across (top, bottom) or down (left, right), the first and last
// v (or u) inside the silhouette, gaps filled from the neighbour (v1 _profile, from the path not pixels).
const profiles = new WeakMap();
function profile(ph) {
  let p = profiles.get(ph);
  if (p) return p;
  const n = 240, top = [], bottom = [], left = [], right = [];
  const hits = (along, at) => {   // along = 'x': crossings of the vertical line x = at, as y values
    const out = [];
    for (const s of ph.sil.sub) {
      const q = s.pts, m = q.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        if (!s.closed && j === 0) break;
        const [a0, b0, a1, b1] = along === 'x' ? [q[2 * i], q[2 * i + 1], q[2 * j], q[2 * j + 1]] : [q[2 * i + 1], q[2 * i], q[2 * j + 1], q[2 * j]];
        if ((a0 <= at) !== (a1 <= at)) out.push(b0 + (b1 - b0) * (at - a0) / (a1 - a0));
      }
    }
    return out;
  };
  for (let i = 0; i < n; i++) {
    const vx = hits('x', (i + 0.5) / n * ph.w), hy = hits('y', (i + 0.5) / n * ph.h);
    top.push(vx.length ? Math.min(...vx) / ph.h : null); bottom.push(vx.length ? Math.max(...vx) / ph.h : null);
    left.push(hy.length ? Math.min(...hy) / ph.w : null); right.push(hy.length ? Math.max(...hy) / ph.w : null);
  }
  const fillGaps = (arr) => { let last = arr.find((v) => v !== null) ?? 0.5; return arr.map((v) => (v === null ? last : (last = v))); };
  p = { n, top: fillGaps(top), bottom: fillGaps(bottom), left: fillGaps(left), right: fillGaps(right) };
  profiles.set(ph, p);
  return p;
}

// A point on the real silhouette: 'top' | 'bottom' walk across (t = u), 'left' | 'right' walk down (t = v).
// Characters run along it; water and snow sit on it.
export function rim(pl, side, t) {
  if (!pl.ph.sil) throw new Error(`rim: cutout '${pl.ph.name}' has no sil (regenerate it with hdf photo)`);
  const p = profile(pl.ph), f = clamp01(t) * (p.n - 1), i = Math.floor(f), j = Math.min(p.n - 1, i + 1), arr = p[side];
  if (!arr) throw new Error(`rim: side '${side}' (expected top, bottom, left, right)`);
  const v = arr[i] + (arr[j] - arr[i]) * (f - i);
  return side === 'top' || side === 'bottom' ? on(pl, t, v) : on(pl, v, t);
}

// Pastel paper the way a product shot sees it: lighter in the middle, darker at the corners (v1 backdrop).
export function backdrop({ vignette = 0.16, spot = 0.3, W = 1080, H = 1080, seed } = {}) {
  const R = Math.hypot(W, H) / 2, frame = rect(-2, -2, W + 4, H + 4), CX = W / 2, CY = H / 2;
  return [
    paper(seed === undefined ? {} : { seed }),
    fill(frame, { base: 'paper', tint: 0.7 }, { cov: radial(CX, CY * 0.9, 0, R * 0.8, spot, 0), day: true, name: 'spot' }),
    fill(frame, { base: 'paper', shade: 0.55 }, { cov: radial(CX, CY, R * 0.55, R * 1.05, 0, vignette), day: true, name: 'vignette' }),
  ];
}

// The whole frame goes to night, photo included (multiply). Put it after the photo; lights come after it.
export const nightfall = (k = 1, { W = 1080, H = 1080 } = {}) => (k <= 0 ? null : fill(rect(-2, -2, W + 4, H + 4), 'night', { alpha: clamp01(k), blend: 'multiply', day: true, name: 'nightfall' }));

// A light screened over what is drawn before it (v1 glow). role defaults to a warm light.
export const glow = (x, y, r, { role, k = 1 } = {}) => fx('glow', { x, y, r, k, ...(role ? { role } : {}) }, []);


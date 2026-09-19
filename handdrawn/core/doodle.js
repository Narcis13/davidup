// A drawing that draws itself in stroke order (v1 doodle / pen). Lines take their time from their length,
// fills and washes arrive when the pen gets to them and sit under the lines of their layer. Build it from
// the pose, then take the list at time tau:
//   const d = doodle({ start: .3 }).fill(body).line(outline, { close: true }).wash(scarf, 'accents.0').text('ahh', x, y);
//   d.draw(tau)   // => list
// d.at(t) moves the pen clock, d.wait(s) pauses, d.layer() starts a layer on top, d.mark(k => list, dur)
// adds a custom mark revealed by k = 0..1, d.end is when it is finished.
import { ease } from './curves.js';
import { gouache, wash } from './finish.js';
import { group, isPath, len, poly, spline, stroke } from './list.js';
import { handText } from './text.js';
import { reveal } from './tools.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const asPath = (pts, close) => (isPath(pts) ? pts : poly(pts, !!close));

export function doodle({ start = 0, speed = 1000, gap = 0.03, seed = 1, w = 4, role = 'ink' } = {}) {
  const ops = [];
  let t = start, z = 0, n = 0;
  const api = {
    at(time) { t = time; return api; },
    wait(d) { t += d; return api; },
    layer() { z++; return api; },
    get end() { return t; },
    get ops() { return ops; },
    // pts: [[x, y], ...] or a path. The brush smooths through the points unless q.smooth === false.
    line(pts, q = {}) {
      const path = asPath(pts, q.close), L = len(q.smooth === false ? path : spline(path.sub[0]?.pts ?? [], { closed: !!q.close, tension: 0, n: 6 }));
      const dur = q.dur ?? Math.max(0.07, L / (q.speed || speed));
      ops.push({ kind: 'line', path, q, t0: t, dur, z, n: n++ });
      t += dur + gap;
      return api;
    },
    // stagger: start them this far apart instead of one after another.
    lines(list, q = {}) { const t0 = t; list.forEach((pts, k) => { if (q.stagger !== undefined) t = t0 + k * q.stagger; api.line(pts, q); }); return api; },
    fill(path, r = 'light', q = {}) { ops.push({ kind: 'fill', path: asPath(path, true), role: r, q, t0: q.at ?? t, dur: q.dur ?? 0.1, z, n: n++ }); return api; },
    wash(path, r, q = {}) { ops.push({ kind: 'wash', path: asPath(path, true), role: r, q, t0: q.at ?? t, dur: q.dur ?? 0.3, z, n: n++ }); return api; },
    text(str, x, y, q = {}) { const dur = q.dur ?? str.length * 0.05; ops.push({ kind: 'text', str, x, y, q, t0: t, dur, z, n: n++ }); t += dur + gap; return api; },
    mark(fn, dur = 0.15) { ops.push({ kind: 'mark', fn, t0: t, dur, z, n: n++ }); t += dur + gap; return api; },
    // The list at time tau. extra is added to line seeds (boil).
    draw(tau, extra = 0) {
      const out = [];
      for (let zz = 0; zz <= z; zz++) for (const pass of [0, 1, 2]) for (const op of ops) {
        if (op.z !== zz) continue;
        const k = clamp01((tau - op.t0) / op.dur);
        if (k <= 0) continue;
        if (pass === 0 && op.kind === 'fill') out.push(gouache(op.path, op.role, (op.q.al ?? 0.97) * k));
        else if (pass === 1 && op.kind === 'wash') out.push(wash(op.path, op.role, { ...op.q, al: (op.q.al ?? 0.5) * ease.out(k), seed: op.q.seed ?? seed + op.n }));
        else if (pass === 2 && op.kind === 'line') {
          const { close, smooth, speed: _s, dur: _d, seed: s, role: r, ...rest } = op.q;
          out.push(stroke(op.path, r ?? role, { tool: 'brush', w, ...rest, smooth: smooth !== false, p: k, seed: (s ?? seed + op.n * 13) + extra, name: `d${op.n}` }));
        } else if (pass === 2 && op.kind === 'text') {
          out.push(reveal(k, handText(op.str, op.x, op.y, { role, ink2: null, size: 40, ...op.q, name: `text:${op.str}` })));
        } else if (pass === 2 && op.kind === 'mark') out.push(op.fn(k));
      }
      return group({ name: 'doodle', seed }, out);
    },
  };
  return api;
}

// One hand drawing one thing (v1 pen): several pens with different starts fill the frame from many sides.
// Lines boil every 4 drawn frames unless o.still.
export function pen(tau, i, start, seed, build, o = {}) {
  const d = doodle({ start, seed, speed: 1500, gap: 0.02, ...o });
  build(d);
  return d.draw(tau, o.still ? 0 : Math.floor(i / 4) * 17);
}

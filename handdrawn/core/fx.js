// Raster effects: an fx op draws its kids through one of these. Each is
// (ctx, args, renderKids, seed, S, env) with env = { W, H } in logical units; the context is already in
// logical coordinates. All randomness comes from `seed`. cut(kind, ...) reveals its `b` side with
// fx(kind, { p }), so every transition is one of these.
// This phase: the dispatch plus the two plain transitions. blot, iris, mosaic, flash, flicker,
// nightShot, bleed, glow, scribble and photoMask land in P5.
import { rect } from './list.js';
import { tracePath } from './tools.js';

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
  wipe(ctx, { p = 1, dir = 'right' }, renderKids, seed, S, { W, H }) {
    if (p <= 0) return;
    const q = Math.min(1, p);
    const box = { right: [0, 0, W * q, H], left: [W * (1 - q), 0, W * q, H], down: [0, 0, W, H * q], up: [0, H * (1 - q), W, H * q] }[dir];
    if (!box) throw new Error(`fx wipe: unknown dir '${dir}'`);
    ctx.save();
    ctx.beginPath(); tracePath(ctx, rect(...box)); ctx.clip();
    renderKids();
    ctx.restore();
  },
};

export function drawFx(ctx, op, renderKids, S, env) {
  const f = FX[op.kind];
  if (!f) throw new Error(`fx '${op.kind}' is not implemented yet (have ${Object.keys(FX).join(', ')})`);
  f(ctx, op.args ?? {}, renderKids, op.seed ?? 1, S, env);
}

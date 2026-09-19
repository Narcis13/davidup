// The rasteriser (v0, no caching): draws an expanded display list on any Canvas 2D context, browser or
// skia-canvas. render() is the usual entry: expand (finishes, stock, text) then draw.
import { norm } from './list.js';
import { resolveLook, resolveRole } from './looks.js';
import { expand } from './finish.js';
import { drawStroke, tracePath } from './tools.js';
import { rng } from './rand.js';
import { frame } from './tree.js';
import { format } from './fit.js';

const TAU = Math.PI * 2;

function drawFill(ctx, op, look) {
  if (op.finish) throw new Error('raster: fill with finish reached draw(); call render() or expand() first');
  ctx.save();
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.beginPath();
  tracePath(ctx, op.path);
  ctx.fill('evenodd');
  ctx.restore();
}

// Halftone dots clipped to the path; density (0..1) sets the dot area per cell (v1 dotScreen).
function drawDots(ctx, op, look) {
  const { cell = 8, angle = 0, jitter = 0 } = op, dens = op.cov ?? op.density ?? 0.5;
  if (typeof dens !== 'number') throw new Error("dots: coverage descriptors (radial, linear) land in P5; pass a number");
  if (dens <= 0) return;
  const r = rng(op.seed ?? 1), [bx, by, bw, bh] = op.path.box, cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle), rad = cell * 0.62 * Math.sqrt(Math.min(1, dens));
  ctx.save();
  ctx.beginPath(); tracePath(ctx, op.path); ctx.clip('evenodd');
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  if (op.blend) ctx.globalCompositeOperation = op.blend;
  ctx.beginPath();
  for (let v = -R; v <= R; v += cell) for (let u = -R; u <= R; u += cell) {
    const x = cx + ca * u - sa * v + (r() - 0.5) * jitter * cell, y = cy + sa * u + ca * v + (r() - 0.5) * jitter * cell;
    ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

function drawSpecks(ctx, op, look) {
  const q = op.rects;
  ctx.save();
  ctx.fillStyle = resolveRole(op.role, look);
  if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
  ctx.beginPath();
  for (let i = 0; i < q.length; i += 4) ctx.rect(q[i], q[i + 1], q[i + 2], q[i + 3]);
  ctx.fill();
  ctx.restore();
}

function drawList(ctx, ops, look, env) {
  for (const op of ops) {
    switch (op.op) {
      case 'fill': drawFill(ctx, op, look); break;
      case 'stroke': drawStroke(ctx, op, look, env.S); break;
      case 'dots': drawDots(ctx, op, look); break;
      case 'specks': drawSpecks(ctx, op, look); break;
      case 'group': {
        ctx.save();
        if (op.screen) ctx.setTransform(env.S, 0, 0, env.S, 0, 0);
        else ctx.transform(...op.xf);
        drawList(ctx, op.kids, look, env);
        ctx.restore();
        break;
      }
      case 'clip': {
        ctx.save();
        ctx.beginPath(); tracePath(ctx, op.path); ctx.clip('evenodd');
        drawList(ctx, op.kids, look, env);
        ctx.restore();
        break;
      }
      case 'look': drawList(ctx, op.kids, resolveLook(op.look), env); break;
      case 'meta': break;
      case 'paper': case 'night': case 'text':
        throw new Error(`raster: '${op.op}' reached draw(); call render() or expand() first`);
      case 'fx': throw new Error(`raster: fx '${op.kind}' is not implemented yet (P5)`);
      case 'image': throw new Error('raster: image ops are not implemented yet (P5)');
      default: throw new Error(`raster: unknown op '${op.op}'`);
    }
  }
}

// Draws an expanded list. S maps logical units to output pixels; W, H are the logical frame.
export function draw(ctx, list, { look, S = 1, W = 1080, H = 1080 } = {}) {
  ctx.save();
  ctx.setTransform(S, 0, 0, S, 0, 0);
  drawList(ctx, norm(list), resolveLook(look), { S, W, H });
  ctx.restore();
}

export function render(ctx, list, opts = {}) {
  const { W = 1080, H = 1080 } = opts;
  draw(ctx, expand(list, opts.look, { W, H }), opts);
}

// Output size for a format at an output width (v1 setFormat): even pixel sizes, S from the height.
export function outputSize(fmt, width = fmt.W) {
  let S = width / fmt.W;
  const outH = 2 * Math.round(fmt.H * S / 2);
  S = outH / fmt.H;
  return { W: fmt.W, H: fmt.H, S, outW: 2 * Math.round(fmt.W * S / 2), outH };
}

// Draws drawn frame i of a film onto ctx (sized outW x outH). Returns frame()'s result.
export function renderFrame(ctx, film, i, { ar, width } = {}) {
  const f = frame(film, i, { ar });
  const fmt = ar ? format(ar) : film.format;
  const { S, W, H, outW, outH } = outputSize(fmt, width);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, outW, outH);
  ctx.restore();
  render(ctx, f.list, { look: film.look, S, W, H });
  return f;
}

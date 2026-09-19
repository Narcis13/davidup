// Format policy. Logical units put the short side at 1080; a shot's `fit` says what happens on the long side
// when the film renders at another aspect: anchor (default), reframe or letterbox.
import { group, clip, paper, rect, translate } from './list.js';

// Aspect ratio -> [W, H] in logical units.
export const FORMATS = Object.freeze({ '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920] });

// { ar, W, H, CX, CY } for an aspect ratio; shots get these in their context.
export function format(ar = '1:1') {
  const wh = FORMATS[ar];
  if (!wh) throw new Error(`unknown format '${ar}' (expected ${Object.keys(FORMATS).join(', ')})`);
  const [W, H] = wh;
  return Object.freeze({ ar, W, H, CX: W / 2, CY: H / 2 });
}

const env = (f) => ({ W: f.W, H: f.H, CX: f.CX, CY: f.CY });
const same = (list) => list;

// native: the film's own format; target: the one being rendered.
// Returns the W/H/CX/CY to hand the shot's draw, and a wrap applied to its (already seeded) list.
export function fitFor(mode = 'anchor', native, target) {
  switch (mode) {
    // Content is laid out around CX, CY, so drawing straight into the target keeps it centred.
    case 'anchor': return { env: env(target), wrap: same };
    // Draw in the native format, scale to cover the target, centre.
    case 'reframe': {
      if (native.W === target.W && native.H === target.H) return { env: env(target), wrap: same };
      const s = Math.max(target.W / native.W, target.H / native.H);
      const xf = [s, 0, 0, s, (target.W - native.W * s) / 2, (target.H - native.H * s) / 2];
      return { env: env(native), wrap: (list, seed) => [group({ name: 'fit', xf, seed }, list)] };
    }
    // Draw in 1080 square, centre it, pad the rest with paper.
    case 'letterbox': {
      const sq = format('1:1');
      if (target.W === sq.W && target.H === sq.H) return { env: env(sq), wrap: same };
      const ox = (target.W - sq.W) / 2, oy = (target.H - sq.H) / 2;
      return {
        env: env(sq),
        wrap: (list, seed) => [paper({ seed }), clip(rect(ox, oy, sq.W, sq.H), [group({ name: 'fit', xf: translate(ox, oy), seed }, list)])],
      };
    }
    default: throw new Error(`unknown fit '${mode}' (expected anchor, reframe, letterbox)`);
  }
}

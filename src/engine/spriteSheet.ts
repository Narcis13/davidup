// Sprite sheets (hand-drawn film 4.0 D2): which frame of an image asset's
// `sheet` a sprite item shows at composition time t, and where that frame
// sits in the image. Pure, so the renderer, the editor and tests agree.

import type { SpriteItem, SpriteSheet } from "../schema/types.js";

// Same float guard as video frames: `t = i / fps` round-tripped through
// `* fps` can land a hair under the integer it came from.
const FRAME_EPSILON = 1e-6;

/**
 * The sheet frame (0-based, into the whole sheet) a sprite shows at time `t`.
 *
 * - `frame` set: that frame of the cycle (or of the sheet when no cycle is
 *   named), floored; wrapped in a looping cycle, held at the ends otherwise.
 * - `cycle` set, no `frame`: the cycle plays from the item's `enter` (0 when
 *   unset) at the sheet's fps, looping unless the cycle says `loop: false`,
 *   in which case it holds its last frame.
 * - neither: frame 0.
 *
 * An unknown cycle name reads as no cycle (the validator reports it).
 */
export function spriteFrameIndex(sheet: SpriteSheet, item: SpriteItem, t: number): number {
  const cycle = item.cycle !== undefined ? sheet.cycles?.[item.cycle] : undefined;
  const start = cycle?.start ?? 0;
  const count = cycle?.count ?? sheet.count;
  const loop = cycle ? cycle.loop !== false : false;
  let k: number;
  if (item.frame !== undefined) k = Math.floor(item.frame + FRAME_EPSILON);
  else if (cycle !== undefined) k = Math.floor((t - (item.enter ?? 0)) * sheet.fps + FRAME_EPSILON);
  else k = 0;
  k = loop ? ((k % count) + count) % count : Math.min(Math.max(k, 0), count - 1);
  return Math.min(start + k, sheet.count - 1);
}

/** The source rectangle `[sx, sy, sw, sh]` of sheet frame `index` in the image. */
export function spriteFrameRect(sheet: SpriteSheet, index: number): [number, number, number, number] {
  const col = index % sheet.columns;
  const row = Math.floor(index / sheet.columns);
  return [col * sheet.frameWidth, row * sheet.frameHeight, sheet.frameWidth, sheet.frameHeight];
}

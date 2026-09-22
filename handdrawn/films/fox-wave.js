// THE FOX WAVES. The overlay clip (4.0 D1): the fox from the store stands on a soft shadow, says nothing and
// waves, three seconds on a loop point. Drawn on paper like any film; `hdf render films/fox-wave.js --alpha`
// draws it on no stock, so a davidup composition can put it over a photograph with the photo showing through
// (scripts/davidup-hdf-clip.ts --alpha).
//
// Anchor: the fox. Format 1:1, drawn 12 fps; 3 s = 36 drawn frames, the last pose the first, so it loops. A
// clip (meta('intent', 'clip')): no sign-off, the composition it plays in has its own.
// t      dur   shot   what changes
// 0.00   3.00  wave   the arm comes up (0.4 s), waves three times, comes down in the last 0.4 s
import { film, shot, paper, fill, ellipse, meta, ramp, ease, plucks } from '../core/index.js';
import { CAST } from '../recipes/doodle.js';
import { fromStore } from '../core/assets.js';

fromStore(['fox']);
const FOX = CAST.FOX;
const CX = 540, GROUND = 930, S = 290;   // the fox's feet, its stage size (it stands 2.6 of these tall)

export const wave = shot('wave', 3, ({ t }) => {
  const up = ramp(0, 0.4, t, ease.out) * (1 - ramp(2.6, 3, t, ease.io));
  const beat = Math.floor(t * 6) % 2;   // the hand back and forth on every other drawing
  const state = { ...FOX.idle(t), ...FOX.emote('happy'), ...FOX.pose('wave', up * (beat ? 1 : 0.8)) };
  return [
    paper(),
    fill(ellipse(CX, GROUND + 6, 150, 20), 'shade', { alpha: 0.3, name: 'shadow' }),
    meta('anchor', { cel: 'fox' }), meta('intent', 'clip'),   // an overlay: the composition it goes in signs off
    FOX.place(CX, GROUND - 0.86 * S, S, state),
  ];
}, { recipe: 'wave' });

// A pluck on each wave of the hand.
export const score = ({ shots: [w] }) => ({ master: 0.5, events: [plucks(w.t0 + 0.5, 2, { steps: 'rise', len: 0.3 })] });

export default film({ name: 'fox-wave', look: 'doodlePastel', timeline: wave, score });

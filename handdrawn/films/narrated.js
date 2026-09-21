// A narrated paragraph that captions itself (4.0 V2): "The moon does not make its own light..." (moon-para,
// macOS `say`, 18.4 s) under a drawn moon that waxes to full, wanes to new and grows again as the voice says
// so. The captions letter each word as it is spoken, from the word timing `hdf align moon-para` stored on the
// sample (faster-whisper, laid onto the copy), and underline the word being said. They are the voice's words,
// so the look's word allowance does not count them.
// t      dur    shot   what changes
// 0.00   19.75  moon   the voice from 0.5 s, the moon's phase, the captions two lines at a time
// 19.75  2.50   sign   the sign-off
import { film, seq, shot, paper, fill, stroke, circle, poly, meta, group, curve, ease, ramp, signOff, voice, dyad, captions } from '../core/index.js';

export const VOICE_AT = 0.5;
export const CAPS = captions('moon-para', { t0: VOICE_AT });

// The dark part of a moon of radius R at phase ph (0 new, PI full, 2 PI new again): the limb on the dark side
// and the terminator, an ellipse of half-width R cos(ph).
function dark(cx, cy, R, ph) {
  const n = 24, pts = [], side = ph <= Math.PI ? -1 : 1, k = Math.cos(ph);
  for (let j = 0; j <= n; j++) { const a = (j / n) * Math.PI; pts.push([cx + side * R * Math.sin(a), cy - R * Math.cos(a)]); }
  for (let j = n; j >= 0; j--) { const a = (j / n) * Math.PI; pts.push([cx - side * R * k * Math.sin(a), cy - R * Math.cos(a)]); }
  return poly(pts, true);
}

// Waxing to full as "full moon" is said, waning to new by "new moon", then growing a little.
const phase = curve([[0, 0.9], [11.6, Math.PI], [14.9, 2 * Math.PI - 0.05], [15.1, 0.05], [19.75, 1.6]], ease.io);

const moon = shot('moon', 19.75, ({ t, W, H, CX }) => {
  const R = 230, cy = 400, ph = phase(t);
  return [
    paper(),
    meta('anchor', { name: 'moon' }),
    group('moon', [
      fill(circle(CX, cy, R, 64), 'light', { finish: true }),
      ph > 0.02 && ph < 2 * Math.PI - 0.02 ? fill(dark(CX, cy, R, ph), 'shade', { alpha: 0.82, name: 'dark' }) : fill(circle(CX, cy, R, 64), 'shade', { alpha: 0.82, name: 'dark' }),
      stroke(circle(CX, cy, R, 64), 'ink', { w: 3.2, wobble: 1.6 }),
    ]),
    CAPS.draw(t, { W, H }),
  ];
});

const sign = shot('sign', 2.5, ({ t, CX, CY }) => [
  paper(),
  meta('anchor', { name: 'signOff' }),
  signOff('the', 'moon', { x: CX, y: CY, pA: ramp(0, 0.5, t), pB: ramp(0.5, 1, t) }),
]);

const score = ({ shots: [, s] }) => ({ master: 0.5, events: [voice('moon-para', VOICE_AT), dyad(s.t0, s.dur, { gain: 0.3 })] });

export default film({ name: 'narrated', look: 'paperInk', timeline: seq(moon, sign), score, assets: ['moon-para'] });

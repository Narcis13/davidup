// mini with one narrated line (4.0 V1): the same ball and sign-off, and "Here comes the ball." from the store's
// sample `mini-line` (macOS `say`) as the ball rolls in. The plucks duck 9 dB under the voice.
import { film, seq, voice } from '../core/index.js';
import { roll, sign, score } from './mini.js';

const narrated = (c) => {
  const s = score(c);
  return { ...s, events: [...s.events, voice('mini-line', c.shots[0].t0 + 0.5)] };
};

export default film({ name: 'mini-voice', look: 'paperInk', timeline: seq(roll, sign), score: narrated, assets: ['mini-line'] });

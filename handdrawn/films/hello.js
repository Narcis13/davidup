// HELLO THERE (4.0 V3): lip sync from a recording. The fox waves and says "Hello there!" (the store's sample
// `hello-there`, macOS `say`), its mouth the recording's own: the Rhubarb track `hdf align hello-there
// --mouth` stored on the entry (without one, the voice band's energy frame by frame), shut on the "th". sam
// says it back with no bubble, the same recording through actor.mouth, on sam's six mouths.
//
// Anchor: the fox, then sam. Format 1:1, 12 fps, doodle pastel.
// t      dur   shot    what changes
// 0.00   4.00  hello   the fox waves (0.25), says the line in a bubble (0.75); sam answers it (2.5), no bubble
// 4.00   2.50  sign    the sign-off (6.5 s in all)
import { film, seq, shot, paper, fill, ellipse, stroke, line, meta, ramp, ease, puppet, actorOf, stickSource, voice, dyad } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { CAST } from '../recipes/doodle.js';
import { signOffShot } from '../recipes/shots.js';

fromStore(['fox']);
const FOX = CAST.FOX;
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));

export const LINE_AT = 0.75, ECHO_AT = 2.5;
export const HELLO = FOX.say('Hello there!', LINE_AT, { voice: 'hello-there' });

const GROUND = 900, FS = 200, FX = 330, SS = 300, SX = 790;
export const helloShot = shot('hello', 4, ({ t }) => {
  const up = ramp(0.25, 0.6, t, ease.out) * (1 - ramp(2.2, 2.6, t, ease.io));
  const beat = Math.floor(t * 6) % 2;
  const fox = { ...FOX.idle(t), ...FOX.look(1), ...FOX.emote('happy'), ...FOX.pose('wave', up * (beat ? 1 : 0.8)), ...HELLO.state(t) };
  const sam = { ...SAM.idle(t, 2), ...SAM.look(-0.5), ...SAM.emote('happy'), ...SAM.mouth('hello-there', t, ECHO_AT) };
  return [
    paper(),
    stroke(line(60, GROUND + 4, 1020, GROUND + 4), 'ink', { w: 3, wobble: 1.5, seed: 11, name: 'ground' }),
    fill(ellipse(FX, GROUND + 4, 110, 14), 'shade', { alpha: 0.3, name: 'shadow' }),
    meta('anchor', { cel: 'fox' }),
    FOX.place(FX, GROUND - 0.86 * FS, FS, fox),
    SAM.place(SX, GROUND - 0.86 * SS, SS, sam),
    HELLO.draw(t, FX, GROUND - 0.86 * FS, FS, { dir: 1 }),
  ];
}, { recipe: 'hello' });

const sign = signOffShot({ name: 'sign', a: 'hello', b: 'there', rings: null });

const score = ({ shots: [h, s] }) => ({
  master: 0.5,
  events: [...HELLO.events(h.t0), voice('hello-there', h.t0 + ECHO_AT), ...dyad(s.t0, s.dur, { gain: 0.3 })],
});

export default film({ name: 'hello', look: 'doodlePastel', timeline: seq(helloShot, sign), score, assets: ['fox', 'hello-there'] });

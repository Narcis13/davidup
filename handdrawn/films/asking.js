// The third lesson (4.0 E4): a question, a quiz, a map and a dialogue on the whiteboard, with sam (a stick
// puppet built from its source, no store) as the teacher and kit (a child's stick) asking, for a kids-9
// audience (lint checks that profile).
// t      dur    shot     recipe  what
// 0.00   7.42   ask      AV      a big ? drawn, "why does the moon change shape?" written; sam shrugs
// 7.42   13.58  quiz     AW      which moon is round? new, half, full; a pause, new and half crossed (a tick
//                                each), full ringed (a ding); sam thinks, points, cheers
// 21.00  10.33  route    AX      home to school over a drawn map, the pin travelling, the label along the way
// 31.33  7.00   talk     AY      kit asks why it changes, sam answers; each looks at the other
// 38.33  2.50   sign     S       the sign-off (40.83 s in all)
import { film, seq, puppet, actorOf, stickSource, plucks, dyad, note, burst, pentHz } from '../core/index.js';
import { questionCard, quiz, quizTimes, mapRoute, dialogueShot, dialogueOf, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const KIT = actorOf(puppet(stickSource({ name: 'kit', build: 'kid' })));
const audience = 'kids-9';

const ask = questionCard({ name: 'ask', actor: SAM, audience });
const Q = { question: 'which moon is round?', options: ['new', 'half', 'full'], answer: 2, audience };
const test = quiz({ name: 'quiz', actor: SAM, ...Q });
const beats = quizTimes(Q);
const route = mapRoute({ name: 'route', actor: SAM, audience });
const T = { actor: SAM, other: KIT, audience };
const talk = dialogueShot({ name: 'talk', ...T });
const lines = dialogueOf(T);
const sign = signOffShot({ name: 'sign', a: 'sam', b: 'asks you', rings: null });

// A tick: a short high noise and a click; a ding: a bright sine and its fifth, ringing.
const tick = (t) => [burst(t, 0.04, 0.18, 91), note(t, 1760, 0.06, 'square', 0.05)];
const ding = (t) => [note(t, pentHz(2, 2), 1.4, 'sine', 0.3), note(t + 0.02, pentHz(3, 2), 1.1, 'sine', 0.12)];

const score = ({ shots: [a, q, r, k, s] }) => ({
  master: 0.45,
  events: [
    ...plucks(a.t0, a.dur), ...plucks(q.t0, beats.pause[0], { steps: 'rise' }),
    ...beats.ticks.flatMap((t) => tick(q.t0 + t)), ...ding(q.t0 + beats.ding),
    ...plucks(r.t0, r.dur, { every: 0.75 }), ...lines.events(k.t0), ...dyad(s.t0, s.dur),
  ],
});

export default film({ name: 'asking', look: 'whiteboard', audience, timeline: seq(ask, test, route, talk, sign), score });

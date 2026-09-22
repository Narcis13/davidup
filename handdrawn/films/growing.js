// The second lesson (4.0 E3): process, cycle, number line and growth on the whiteboard, with sam (a stick
// puppet built from its source, no store) as the teacher, for a kids-9 audience (lint checks that profile).
// t      dur    shot     recipe  what
// 0.00   7.42   steps    AR      seed -> sprout -> flower, a card a beat, curved arrows; sam points, then cheers
// 7.42   12.92  water    AS      rain, river, sea, cloud round a ring, the marker goes round once
// 20.33  8.92   hops     AT      3 hops on to 7 a unit at a time, +4, 7 ringed
// 29.25  7.17   tall     AU      a bar rising 0 to 6, counting on; "days" under it
// 36.42  2.50   sign     S       the sign-off (38.92 s in all)
import { film, seq, puppet, actorOf, stickSource, plucks, dyad, cueNotes } from '../core/index.js';
import { process as steps, cycleDiagram, numberLine, hopTimes, growth, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const audience = 'kids-9';

const grow = steps({ name: 'steps', actor: SAM, audience });
const water = cycleDiagram({ name: 'water', actor: SAM, audience });
const hops = numberLine({ name: 'hops', actor: SAM, audience });
const hopAt = hopTimes({ audience });
const tall = growth({ name: 'tall', actor: SAM, audience, to: 6, label: 'days' });
const sign = signOffShot({ name: 'sign', a: 'sam', b: 'says hi', rings: null });

const score = ({ shots: [g, w, h, t, s] }) => ({
  master: 0.45,
  events: [
    ...plucks(g.t0, g.dur), ...plucks(w.t0, w.dur),
    ...cueNotes(hopAt.map((t) => h.t0 + t)),
    ...plucks(t.t0, t.dur), ...dyad(s.t0, s.dur),
  ],
});

export default film({ name: 'growing', look: 'whiteboard', audience, timeline: seq(grow, water, hops, tall, sign), score });

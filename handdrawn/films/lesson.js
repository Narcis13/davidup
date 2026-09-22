// The first lesson (4.0 E2): the four teaching recipes on the whiteboard, with sam (a stick puppet built from
// its source, no store) as the teacher. Every shot times itself from its copy for a kids-9 audience.
// t      dur    shot       recipe  what
// 0.00   6.25   title      AN      "parts of a flower" written on, sam presents it
// 6.25   7.67   parts      AO      the flower labelled: petal, stem, leaf, roots; sam points
// 13.92  5.00   count      AP      five apples counted with digits and a tally; sam cheers
// 18.92  5.83   more       AQ      3 < 5; sam thinks, then is pleased
// 24.75  2.50   sign       S       the sign-off (27.25 s in all)
import { film, seq, puppet, actorOf, stickSource, plucks, dyad, cueNotes } from '../core/index.js';
import { titleCard, labelled, counting, compare, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const audience = 'kids-9';

const title = titleCard({ name: 'title', title: 'parts of a flower', sub: 'a first lesson', actor: SAM, audience });
const parts = labelled({ name: 'parts', actor: SAM, audience });
const count = counting({ name: 'count', n: 5, actor: SAM, audience });
const more = compare({ name: 'more', actor: SAM, audience });
const sign = signOffShot({ name: 'sign', a: 'sam', b: 'says hi', rings: null });

const score = ({ shots: [t, p, c, m, s] }) => ({
  master: 0.45,
  events: [
    ...plucks(t.t0, t.dur), ...plucks(p.t0, p.dur),
    ...cueNotes(Array.from({ length: 5 }, (_, j) => c.t0 + 0.4 + j * 0.7)),
    ...plucks(m.t0, m.dur), ...dyad(s.t0, s.dur),
  ],
});

export default film({ name: 'lesson', look: 'whiteboard', timeline: seq(title, parts, count, more, sign), score });

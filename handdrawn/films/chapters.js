// CHAPTERS (4.0 E1): a lesson in three chapters on the whiteboard, for a beginner audience. Each chapter()
// opens on its title card (AN, sam presenting it), plays its recipe and holds a beat; the score rings a note
// at every chapter's start (cues.chapters). `hdf board` gives one card per chapter, `hdf render --chapter 2`
// renders the counting alone, with the stretch of the score under it.
//
// Anchor: each shot's own (the title, the flower, the apples, the pair). Format 1:1, 12 fps, whiteboard.
// t      dur    chapter           shots
// 0.00   9.42   1 a flower        card (1.92), parts AO (6.50), hold 1.00
// 9.42   6.50   2 counting        card (1.83), count AP (3.67), hold 1.00
// 15.92  8.50   3 more or less    card (2.50), more AQ (5.00), hold 1.00
// 24.42  2.50   sign              the sign-off (26.92 s in all)
// The chapters are short for a lesson (20 to 40 s each is the norm) so the example renders in seconds.
import { film, seq, puppet, actorOf, stickSource, plucks, cueNotes, dyad } from '../core/index.js';
import { chapter, labelled, counting, compare, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const audience = 'beginner';
const card = { actor: SAM, audience };

const timeline = seq(
  chapter({ title: 'a flower', ...card }, labelled({ name: 'parts', audience })),
  chapter({ title: 'counting', ...card }, counting({ name: 'count', n: 4, audience })),
  chapter({ title: 'more or less', ...card }, compare({ name: 'more', audience })),
  signOffShot({ name: 'sign', a: 'three', b: 'chapters', rings: null }),
);

const score = ({ chapters, shots, end }) => ({
  master: 0.45,
  events: [
    ...cueNotes(chapters.map((c) => c.t0 + 0.25)),
    ...chapters.flatMap((c) => plucks(c.t0 + 1, c.dur - 1.5)),
    ...dyad(shots.at(-1).t0, end - shots.at(-1).t0),
  ],
});

export default film({ name: 'chapters', look: 'whiteboard', audience, timeline, score });

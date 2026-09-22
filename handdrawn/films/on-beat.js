// ON THE BEAT (4.0 D4): a film cut to marks it is given, not to numbers it holds. Each cut lands on a bar of the
// music (every fourth `beat`) and the film turns on the `drop`. The marks come from a davidup composition, from
// its audio track's beat markers, in the seconds of the item the film plays in:
//
//   hdf render films/on-beat.js --cues-from composition.json --at film
//   bun run scripts/davidup-hdf-clip.ts composition.json film   (passes both, then writes the chapters back
//                                                                 as the composition's markers)
//
// With no marks (the player, lint, the golden) it plays to 100 bpm with the drop on beat 8: `or`.
// sam nods on every beat and cheers on the drop, wound up before it (perform with atMark's time); a pad fills
// on each beat of a bar; after the drop a burst goes off on every beat. The score reads the marks too: a tick
// on each beat before the drop, a tada on it (from cues.marks when there are marks, else the fallback times).
//
// Anchor: the pads (count in), the burst (the drop). Format 1:1, 12 fps, whiteboard. A clip (meta intent):
// the composition it plays in signs off. With the fallback marks:
// t      dur    chapter     shots
// 0.00   2.42   1 count in  bar1 (4 pads, one a beat)
// 2.42   2.42               bar2
// 4.83   4.75   2 the drop  drop (sam cheers, a burst a beat), 9.58 s in all (115 drawn frames)
// Each time is a mark snapped to the grid (the drop, 4.8 s, is drawn at 4.83), so each cut is within 1/24 s of
// its beat.
import { film, shot, seq, chapterSeq, paper, fill, stroke, circle, meta, group, ramp, ease, puppet, actorOf, stickSource, perform, atMark, marksNamed, starburst } from '../core/index.js';
import { tick, tada } from '../recipes/sfx.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const X = 250, FEET = 960, S = 260;          // sam's place: centre x, feet, size
const BPM = 100, BEAT = 60 / BPM;            // the fallback: a beat every 0.6 s from 0, the drop on beat 8

// The marks, on the drawing grid. A beat past the last one given is extrapolated at the last interval.
export const beats = marksNamed('beat', { or: Array.from({ length: 24 }, (_, k) => k * BEAT) });
export const drop = atMark('drop', { or: 8 * BEAT });
const step = beats.length > 1 ? beats.at(-1) - beats.at(-2) : BEAT;
const beatAt = (k) => (k < beats.length ? beats[k] : Math.round((beats.at(-1) + (k - beats.length + 1) * step) * 12) / 12);
const first = beats.findIndex((b) => b >= drop - 1e-9);
const dropBeat = first < 0 ? beats.length : first;   // the drop's beat (or the first after it)

// Bars before the drop: a cut on every fourth beat, none within half a second of the drop.
const bars = [0];
for (let k = 4; beatAt(k) < drop - 0.5; k += 4) bars.push(beatAt(k));
const end = beatAt(dropBeat + 8) > drop + 1 ? beatAt(dropBeat + 8) : drop + 8 * step;

// sam: idle, a nod on every beat before the drop, the cheer landing on it (wound up the other way first).
const nods = beats.filter((b) => b > 0.2 && b < drop - 0.4).flatMap((b) => [
  [b - 0.1, { head: 7 }, { dur: 0.1, sound: false }],
  [b + 0.15, { head: 0 }, { dur: 0.15, sound: false }],
]);
export const act = perform(SAM, [
  [0, ['idle', { dir: 0 }]],
  ...nods,
  [drop - 0.25, ['cheer', 'happy'], { dur: 0.25, anticipate: 0.25, overshoot: 0.15 }],
]);

const PADS = [0, 1, 2, 3].map((j) => [560 + j * 130, 520]);

// A bar: sam, four pads, the pad for each beat of the bar filling as it lands.
const barShot = (n, t0, t1) => shot(`bar${n}`, t1 - t0, ({ t }) => {
  const now = t0 + t, k0 = beats.findIndex((b) => b >= t0 - 1e-9);
  const pads = PADS.map(([x, y], j) => {
    const hit = beatAt(k0 + j), on = now >= hit - 1e-9 && hit < t1 - 1e-9;
    const kids = [stroke(circle(x, y, 50, 36), 'ink', { w: 6, wobble: 1.2, seed: 40 + j })];
    if (on) kids.unshift(fill(circle(x, y, 44, 36), n % 2 ? 'accents.0' : 'accents.1', { seed: 50 + j }));
    if (on && now - hit < 0.25) kids.push(starburst([x, y], 1, { r: 62, len: 26, n: 8, seed: 60 + j }));
    return group(`pad${j}`, kids);
  });
  return [
    paper(),
    meta('anchor', { name: 'pads' }), meta('intent', 'clip'),
    group({ name: 'pads', box: [490, 450, 540, 140] }, pads),
    SAM.place(X, FEET - 0.86 * S, S, act.state(now)),
  ];
}, { recipe: 'bar' });

// The drop: sam cheering, a burst on every beat, its size falling off over the beat.
const dropShot = shot('drop', end - drop, ({ t }) => {
  const now = drop + t, last = [...beats, beatAt(beats.length)].filter((b) => b <= now + 1e-9 && b >= drop - 1e-9).at(-1) ?? drop;
  const k = 1 - ramp(last, last + step, now, ease.out);
  return [
    paper(),
    meta('anchor', { name: 'burst' }), meta('intent', 'clip'),
    group({ name: 'burst', box: [560, 300, 400, 400] }, [
      stroke(circle(760, 500, 70, 40), 'accents.0', { w: 8, wobble: 1.5, seed: 70 }),
      starburst([760, 500], 1, { r: 90 + 30 * k, len: 40 + 60 * k, n: 12, w: 6, seed: 71 }),
    ]),
    SAM.place(X, FEET - 0.86 * S, S, act.state(now)),
  ];
}, { recipe: 'drop' });

const timeline = seq(
  chapterSeq('count in', bars.map((b, j) => barShot(j + 1, b, bars[j + 1] ?? drop))),
  chapterSeq('the drop', [dropShot]),
);

// A tick on every beat before the drop and a tada on it, at the marks' own times (not snapped to the grid).
const score = ({ marks }) => {
  const given = marks.filter((m) => m.name === 'beat').map((m) => m.t);
  const at = marks.find((m) => m.name === 'drop')?.t ?? drop;
  return { master: 0.4, events: [...(given.length ? given : beats).filter((b) => b < at - 1e-9).map((b) => tick(b)), tada(at)] };
};

export default film({ name: 'on-beat', look: 'whiteboard', timeline, score });

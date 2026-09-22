// QUIZ TIME (4.0 V4): sound effects and a music bed. A bright bed runs under the whole lesson and ducks 9 dB
// under the narration (V1); the hand's marker squeaks on each word it writes, each option's box pops in, the
// wrong answers tick as they are crossed and the right one dings; an eraser scrubs the board clear, a row a
// stroke, and the bed stops on a sting under the sign-off. sam (a stick puppet built from its source) teaches,
// for a kids-9 audience.
//
// Anchor: the caption, then the quiz. Format 1:1, 12 fps.
// t      dur    shot     what changes                                        sound
// 0.00   3.25   caption  the hand writes "quiz time!" and leaves             the bed; the marker a word at a time
// 3.25   14.42  quiz     which one can fly? fish, bird, cat; a pause; fish   a whoosh on the cut, the narration
//                        and cat crossed, bird ringed; sam cheers            (quiz-ask), a pop a box, a tick each
//                                                                            wrong one, a ding, "yes! the bird..."
// 17.67  1.00   erase    the eraser wipes the quiz off, row under row        a scrub a row
// 18.67  2.50   sign     the sign-off (21.17 s in all)                       the bed stops on a sting
import {
  film, seq, cut, shot, paper, group, meta, textBox, writeOn, writer, puppet, actorOf, stickSource, voice,
  bed, pop, tick, ding, hits, writerSounds, eraserSounds,
} from '../core/index.js';
import { bounds } from '../core/list.js';
import { quiz, quizTimes, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const audience = 'kids-9';

// The caption, written a word a second (two words, and the hand's lead in and way out).
const WRITE = { at: 0.25, per: 'word', wps: 1 };
const card = () => {
  const words = textBox('quiz time!', [190, 380, 700, 300], { size: 150, align: 'center', ink2: null, role: 'ink', seed: 17 });
  return group({ name: 'caption', box: bounds([words]) }, [words]);
};
const CARD = card();
export const caption = shot('caption', 3.25, ({ t, look }) => [
  paper(),
  meta('anchor', { name: 'caption' }),
  writeOn(CARD, { t, ...WRITE }),
  writer(CARD, t, { ...WRITE, look }),
]);

const Q = { question: 'which one can fly?', options: ['fish', 'bird', 'cat'], answer: 1, audience };
const beats = quizTimes(Q);
// Held on past its own end so the "yes" after the ding is heard over the ringed answer.
const test = quiz({ name: 'quiz', actor: SAM, ...Q, dur: Math.ceil((beats.end + 1) * 12) / 12 });
const ERASE = 1;
const sign = signOffShot({ name: 'sign', a: 'quiz', b: 'time', rings: null });
const wipe = cut('erase', ERASE, test, sign);

const score = ({ shots: [c, q, e, s], cuts: [first], end }) => {
  const music = bed({ mood: 'bright', key: 'G', from: 0, to: end });
  return {
    master: 0.45,
    events: [
      music.stop(s.t0), music.sting(s.t0),
      writerSounds(CARD, { ...WRITE, t0: c.t0, tool: 'marker' }),
      hits([first]),
      voice('quiz-ask', q.t0 + 0.4),
      beats.options.map((t) => pop(q.t0 + t)),
      beats.ticks.map((t) => tick(q.t0 + t)),
      ding(q.t0 + beats.ding),
      voice('quiz-yes', q.t0 + beats.ding + 0.7),
      eraserSounds({ t: e.t0, dur: e.dur }),
    ],
  };
};

export default film({ name: 'quiz-time', look: 'whiteboard', audience, timeline: seq(caption, test, wipe, sign), score, assets: ['quiz-ask', 'quiz-yes'] });

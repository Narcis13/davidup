// BRIEF
// Subject: how does AI learn? Machine learning and chatbots for teenagers and people who do not work in tech.
// Audience: beginner (lint's profile: 16 words a shot, 3.5 px x-height at 240 px, 4.5:1 text contrast)
// Format: 16:9, 1920 wide, drawn 12 fps, output 24 fps, about 170 s in seven pages (chapters)
// Look: notebook (a school notebook page, felt tip); chapter 3 "inside Bit" in blueprintNight (chalk on navy:
//       blueprint means "look inside"), grown out of an ink blot on Bit's screen
// Hand: house (the sign-off in hershey-script)
// Anchor: Bit, the little computer (every page but the opening mind map, where the lettered "AI" is it)
// Cast: sam (the store's puppet: the one who teaches), bit (a new store puppet: hdf svg assets/src/bit.svg),
//       fox (the store's puppet, its fur recoloured orange for the notebook: the running gag, called a cat
//       three times and finally seen for what it is)
// Voices: edge-tts, imported as samples and aligned with faster-whisper (how-ai-learns/lines.tsv,
//       make-voices.sh): the narrator en-US-AvaNeural, the fox en-GB-RyanNeural, Bit en-US-AnaNeural through a
//       small tinny speaker
// Story: Sam wants to teach Bit, a computer that knows nothing, to spot a cat. Rules fail (the fox passes them
//       all). Examples work: Bit guesses, turns its dials when wrong, and after a million goes finds the
//       pattern itself: machine learning. It still calls the fox a cat: it only knows what it has been shown.
//       Inside, it is numbers: switches in layers, a dial on every line, billions of them. Chatbots do the same
//       with words: they read a gigantic library and play one game, guess the next word. But they guess what
//       sounds right, not what is true (foxes are in the dog family). Treat AI like a clever friend who is
//       sometimes confidently wrong. Bit sees the fox at last. Stay curious.
//
// Beat sheet (169.2 s, 16:9, beginner; hdf cues films/how-ai-learns.js). Each page is one continuous
// drawing on one notebook page and its shots are windows onto it (the cuts inside a page do not jump); the pages
// turn with cut('flip'), and the dark page grows out of Bit's screen as an ink blot.
// t       dur    shot         page / chapter                what happens                                      voice
// 0.00    7.08   open         A                             a hand writes "AI", a mind map: face unlock, next  ai-open
//                                                           song, answers; little things pop in "everywhere"
// 7.08    0.50   flip
// 7.58    4.33   title        B  how does AI learn?         the title written; Bit falls onto the page          ai-title
// 11.92   11.42  meet         B                             Sam walks on and waves; Bit waves; an empty         ai-meet
//                                                           thought with a tumbleweed; Sam holds up a cat photo
// 23.33   0.50   flip
// 23.83   8.17   rules        C  1. rules                   "cat rules" written, a picture a rule; Sam: easy!   ai-rules
// 32.00   5.00   cat test     C                             a cat hops in, Bit scans it, three ticks            bit-cat
// 37.00   6.08   fox          C                             the fox bounds in: three ticks, "It's a cat!"       ai-until, bit-cat, fox-im
// 43.08   6.50   messy        C                             exceptions on sticky notes, the rules crossed out   ai-messy
// 49.58   0.50   flip
// 50.08   11.33  examples     D  2. examples                photos dealt onto a deck, labelled as each is said  ai-examples
// 61.42   3.83   guess        D                             Bit guesses cat for a dog: a red cross              ai-guess, bit-cat-q
// 65.25   7.33   dials        D                             a magnifier on Bit's dials turning; "A dog!", tick  ai-dials, bit-dog
// 72.58   3.67   again        D                             practice cards flying, a chart of right answers     ai-again
// 76.25   7.08   pattern      D  machine learning           Bit's star eyes; "machine learning" written         ai-pattern
// 83.33   9.42   fox again    D                             the fox pops up, knocks the cards flying: 91% cat   bit-cat91, fox-comeon, ai-shown
// 92.75   4.83   inside       E  3. inside Bit              a blot from Bit's screen; not a brain: numbers      ai-inside
// 97.58   9.25   signals      E                             a pixel cat into a network: pulses, a dial a line   ai-signals
// 106.83  7.25   billions     E                             out to a galaxy of switches: billions               ai-billions
// 114.08  0.50   flip
// 114.58  9.92   library      F1 4. words                   towers of books, pages flying into Bit              ai-library
// 124.50  0.50   flip
// 125.00  6.33   next word    F2                            the cat sat on the ___: a pad of guesses, mat 64%   ai-game
// 131.33  5.17   answer       F2                            and fell asleep: a word at a time, Bit's answer     ai-answer
// 136.50  0.50   flip
// 137.00  12.83  catch        G  5. check it                "is a fox a cat?" "Yes! Foxes are small wild cats." ai-catch, bit-wrong, fox-family
//                                                           the fox peeks over: dog family; struck out
// 149.83  10.00  friend       G                             ask good questions, check the answers, keep your    ai-friend
//                                                           brain on: a tick each, a bulb over Sam
// 159.83  4.83   finally      G                             fox photos for Bit; "It's a fox!" "Finally."        bit-fox, fox-finally
// 164.67  0.50   flip
// 165.17  4.00   sign         sign-off                      stay curious, the three of them waving
import {
  film, shot, seq, cut, chapterSeq, paper, night, meta, group, place, fill, stroke, clip, circle, ellipse, rect,
  roundRect, poly, line, arc, translate, scale, mmul, ease, ramp, rng, pulse, puppet, actorOf, perform, walkTo,
  stand, attach, partAt, handText, reveal, writeOn, writer, arrowTo, circleAround, underline, tickMark, crossMark,
  strike, question, starburst, bubble, coffeeRing, paperClip, marginDoodle, stickyNote, voice, note, burst, pentHz,
  pop, boing, whoosh, ding, tada, tick, squeak, flip, hits, writerSounds, bed, dyad, alignOf, bounds, fx, hold,
  measure, signOff,
} from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { cat, dog, polaroid, smooth, curve, sym, tube } from './how-ai-learns/cels.js';

export { cat, dog };

// ---------- the store ----------

export const HAND = 'hershey-script';
const VOICES = [
  'ai-open', 'ai-title', 'ai-meet', 'ai-rules', 'ai-until', 'ai-messy', 'ai-examples', 'ai-guess', 'ai-dials', 'ai-again',
  'ai-pattern', 'ai-shown', 'ai-inside', 'ai-signals', 'ai-billions', 'ai-library', 'ai-game', 'ai-answer', 'ai-catch',
  'ai-friend', 'bit-cat', 'bit-cat-q', 'bit-dog', 'bit-cat91', 'bit-wrong', 'bit-fox', 'fox-im', 'fox-comeon',
  'fox-family', 'fox-finally',
];
const IDS = ['bit', 'sam', 'fox', HAND, ...VOICES];
const STORE = fromStore(IDS);

// ---------- time ----------

const FPS = 12;
const g = (t) => Math.round(t * FPS) / FPS;                       // on the drawing grid
const twos = (t) => Math.floor(t * 6 + 1e-9) / 6;                   // held for two drawn frames
const said = (id) => alignOf(id).words.at(-1).t1;                    // when a recording's last word ends
// When a word of a recording starts (its nth appearance), in recording seconds; `end` for when it ends.
function word(id, w, nth = 0, end = false) {
  const hits = alignOf(id).words.filter((x) => x.text.toLowerCase().replace(/[^a-z0-9]/g, '') === w);
  if (!hits[nth]) throw new Error(`how-ai-learns: no word '${w}' (#${nth}) in ${id}`);
  return end ? hits[nth].t1 : hits[nth].t0;
}
// A springy scale in: 0 before t0, overshoots to 1.12 and settles on 1.
const spring = (T, t0, d = 0.4) => {
  if (T < t0) return 0;
  const u = Math.min(1, (T - t0) / d);
  return u >= 1 ? 1 : 1 + Math.sin(u * Math.PI * 1.25) * (1 - u) * 0.35 - (1 - ease.out(u)) * 1;
};
const popIn = (u, x, y, node) => (u <= 0 ? null : u >= 1 ? node : place(x, y, { scale: Math.max(0.01, u) }, place(-x, -y, node)));

// ---------- the page ----------

const RED = { base: 'inks.1', shade: 0.15 }, GREEN = { base: 'inks.3', shade: 0.3 };   // lettering dark enough to read
const RULE = (k) => 148 + 38 * k;         // the notebook's k-th blue rule (16:9: the short side is 1080)
const FLOOR = RULE(22);                   // where everyone stands: on a rule
const W = 1920, H = 1080, CX = 960;

// The chapter heading, top left in red above the rules, written by the pen as the page opens.
function heading(str, T, { at = 0.15, x = 200, y = 112, size = 62 } = {}) {
  const node = group({ name: 'heading', box: [x - 10, y - size, 520, size + 20] }, [
    handText(str, x, y, { size, role: RED, ink2: null, w: 3.4, seed: 900 }),
  ]);
  const p = ramp(at, at + 0.35 + str.length * 0.05, T, (u) => u);
  const u = underline(node.kids[0], ramp(at + 0.35 + str.length * 0.05, at + 0.7 + str.length * 0.05, T), { role: RED, w: 3, seed: 901 });
  return [p > 0 && reveal(p, node), u];
}

// What is always on a page: the stock, then a few things a pupil leaves in the margin and on the page.
const FURNITURE = {
  a: () => [marginDoodle('star', 75, 300, 56, 11, { role: 'inks.2' }), marginDoodle('spiral', 75, 720, 60, 12), coffeeRing(330, 250, 105, 13)],
  b: () => [marginDoodle('heart', 75, 420, 50, 21, { role: 'inks.1' }), marginDoodle('cube', 75, 820, 56, 22), paperClip(1650, 22, 150, 1.45, 23)],
  c: () => [marginDoodle('flower', 75, 360, 58, 31, { role: 'inks.3' }), marginDoodle('zigzag', 75, 760, 56, 32)],
  d: () => [marginDoodle('spiral', 75, 330, 56, 41, { role: 'inks.2' }), marginDoodle('star', 75, 780, 52, 42), coffeeRing(265, 1010, 88, 43)],
  f: () => [marginDoodle('cube', 75, 380, 56, 61, { role: 'inks.2' }), marginDoodle('heart', 75, 800, 50, 62, { role: 'inks.1' })],
  g: () => [marginDoodle('flower', 75, 330, 58, 71), marginDoodle('star', 75, 760, 56, 72, { role: 'inks.1' }), paperClip(1700, 22, 140, 1.6, 73)],
};

// A page is one continuous drawing, T its own seconds; its shots are windows onto it, so a cut inside a page
// does not jump. shots: [[name, T0, T1]] on the grid.
function page(key, shots, draw, o = {}) {
  return shots.map(([name, T0, T1]) => shot(name, g(T1 - T0), (ctx) => draw({ ...ctx, T: ctx.t + T0 }), { recipe: o.recipe ?? `page ${key}`, look: o.look }));
}

// ---------- the cast ----------

// The fox's fur is the palette's first fill; on the notebook that is yellow, so it wears the orange one.
function recolour(v, map) {
  if (Array.isArray(v)) return v.map((x) => recolour(x, map));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'role' && typeof x === 'string' && map[x]) out[k] = map[x];
    else if (k === 'role' && x && typeof x === 'object' && map[x.base]) out[k] = { ...x, base: map[x.base] };
    else out[k] = recolour(x, map);
  }
  return out;
}
export const BIT = actorOf(puppet('bit'));
export const SAM = actorOf(puppet('sam'));
export const FOX = actorOf(puppet({ ...STORE.fox, parts: recolour(STORE.fox.parts, { 'fills.0': 'fills.4' }) }));
export const cast = { bit: BIT, sam: SAM, fox: FOX };

const SS = 262, BS = 208, FS = 236;                    // sam's, Bit's and the fox's stage sizes
const at = (s) => FLOOR - 0.86 * s;                     // the stage y that puts feet on the floor
// An actor on the floor at x, a soft shadow under it.
const onFloor = (A, x, s, state, o = {}) => [
  fill(ellipse(x, FLOOR + 4, s * 0.36 * (o.shadow ?? 1), s * 0.05, 32), 'shade', { alpha: 0.16, name: 'shadow' }),
  A.place(x, at(s) - (o.lift ?? 0), s, state),
];
// A squash for a landing: sx, sy about the feet.
const squash = (x, y, sx, sy, kids) => group({ xf: mmul(translate(x, y), mmul(scale(sx, sy), translate(-x, -y))) }, [kids].flat());

// ---------- page A: the opening mind map ----------

const A0 = 0.35;                                         // ai-open starts
const AW = (w, n = 0) => A0 + word('ai-open', w, n);
function phoneDoodle() {
  const body = roundRect(-78, -140, 156, 280, 26), screen = roundRect(-64, -112, 128, 214, 10);
  const br = (sx, sy) => [[sx * 38, sy * 20], [sx * 38, sy * 38], [sx * 20, sy * 38]];
  return group({ name: 'phone', box: [-80, -142, 160, 284] }, [
    fill(body, 'paper'), fill(body, 'fills.5', { finish: true }), fill(screen, { base: 'fills.1', tint: 0.55 }),
    stroke(body, 'ink', { w: 3.2, seed: 101 }), stroke(screen, 'ink', { w: 2.4, seed: 102 }),
    stroke(line(-18, -126, 18, -126), 'ink', { w: 3, seed: 103 }),
    stroke({ sub: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ pts: br(sx, sy).map(([x, y]) => [x, y - 20]).flat(), closed: false })), box: [-40, -60, 80, 80] }, 'inks.2', { w: 3.4, seed: 104 }),
    stroke(circle(0, -20, 22, 24), 'ink', { w: 2.4, seed: 105 }),
    fill(circle(-8, -25, 3, 8), 'ink'), fill(circle(8, -25, 3, 8), 'ink'),
    stroke(curve([[-10, -12], [0, -7], [10, -12]]), 'ink', { w: 2.4, seed: 106 }),
    // an open padlock under the face: unlocked
    fill(roundRect(-20, 48, 40, 32, 5), 'fills.0', { finish: true }), stroke(roundRect(-20, 48, 40, 32, 5), 'ink', { w: 2.6, seed: 107 }),
    stroke(curve([[-12, 48], [-12, 30], [0, 22], [12, 28], [14, 36]]), 'ink', { w: 3, seed: 108 }),
    fill(circle(0, 62, 4, 10), 'ink'),
  ]);
}
function headphonesDoodle() {
  const band = { sub: [{ pts: arc(0, 10, 96, Math.PI * 1.08, Math.PI * 1.92).sub[0].pts, closed: false }], box: [-96, -86, 192, 96] };
  const cup = (s) => roundRect(s * 96 - 26, -10, 52, 88, 20);
  const noteAt = (x, y, k, seed) => group('note', [
    fill(ellipse(x, y, 14 * k, 10 * k, 16), 'inks.3'),
    stroke(line(x + 12 * k, y - 2, x + 12 * k, y - 62 * k), 'inks.3', { w: 3.2, seed }),
    stroke(curve([[x + 12 * k, y - 62 * k], [x + 30 * k, y - 50 * k], [x + 34 * k, y - 34 * k]]), 'inks.3', { w: 3.2, seed: seed + 1 }),
  ]);
  return group({ name: 'headphones', box: [-130, -150, 300, 240] }, [
    stroke(band, 'ink', { w: 9, wobble: 0.6, seed: 111 }), stroke(band, 'fills.2', { w: 4, wobble: 0.6, seed: 111 }),
    ...[-1, 1].map((s) => group('cup', [fill(cup(s), 'paper'), fill(cup(s), 'fills.2', { finish: true }), stroke(cup(s), 'ink', { w: 3, seed: 112 + s })])),
    noteAt(40, -60, 1, 115), noteAt(110, -110, 0.8, 117),
  ]);
}
function chatDoodle() {
  const a = bubble([-150, -120, 200, 110], [-120, 20], { seed: 121, w: 3 });
  const b = bubble([-20, 10, 190, 100], [150, 140], { seed: 122, w: 3 });
  return group({ name: 'chat', box: [-170, -130, 360, 280] }, [
    a, question([-50, -65], 80, 1, { role: 'inks.1', seed: 123 }),
    b, ...[0, 1, 2].map((j) => fill(circle(35 + j * 40, 60, 9, 14), 'inks.2')),
  ]);
}
function pinDoodle() {
  const p = smooth([[0, 40], [-26, 0], [-30, -26], [-16, -46], [0, -52], [16, -46], [30, -26], [26, 0]]);
  return group('pin', [fill(p, 'paper'), fill(p, 'accents.0', { finish: true }), stroke(p, 'ink', { w: 2.6, seed: 131 }), fill(circle(0, -24, 10, 14), 'paper'), stroke(circle(0, -24, 10, 14), 'ink', { w: 2.2, seed: 132 })]);
}
function cameraDoodle() {
  return group('camera', [
    fill(roundRect(-48, -30, 96, 64, 10), 'paper'), fill(roundRect(-48, -30, 96, 64, 10), 'fills.1', { finish: true }),
    stroke(roundRect(-48, -30, 96, 64, 10), 'ink', { w: 2.6, seed: 141 }), stroke(roundRect(-20, -42, 36, 14, 4), 'ink', { w: 2.2, seed: 142 }),
    fill(circle(0, 2, 20, 20), 'paper'), stroke(circle(0, 2, 20, 20), 'ink', { w: 2.6, seed: 143 }), stroke(circle(0, 2, 10, 16), 'ink', { w: 2, seed: 144 }),
  ]);
}
function gameDoodle() {
  const b = smooth([[-50, -18], [0, -24], [50, -18], [62, 10], [52, 30], [30, 22], [0, 16], [-30, 22], [-52, 30], [-62, 10]]);
  return group('game', [
    fill(b, 'paper'), fill(b, 'fills.3', { finish: true }), stroke(b, 'ink', { w: 2.6, seed: 151 }),
    stroke({ sub: [{ pts: [-40, 0, -24, 0], closed: false }, { pts: [-32, -8, -32, 8], closed: false }], box: [-40, -8, 16, 16] }, 'ink', { w: 3, seed: 152 }),
    fill(circle(26, -4, 5, 10), 'accents.0'), fill(circle(38, 6, 5, 10), 'inks.2'),
  ]);
}
const AI_WORD = handText('AI', CX, 640, { size: 300, align: 'center', role: 'ink', ink2: 'fills.0', offset: 9, w: 9, seed: 160 });
const AI_BOX = bounds([AI_WORD]);
const HUB = [AI_BOX[0] - 30, AI_BOX[1] - 30, AI_BOX[2] + 60, AI_BOX[3] + 60];
const MAP = [
  { node: phoneDoodle(), x: 440, y: 590, rot: -0.06, s: 1.3, t: AW('unlocks') - 0.1, label: 'face unlock', lx: 440, ly: 880 },
  { node: headphonesDoodle(), x: 1450, y: 330, rot: 0.05, s: 1.3, t: AW('picks') - 0.1, label: 'next song', lx: 1730, ly: 480 },
  { node: chatDoodle(), x: 1470, y: 790, rot: -0.03, s: 1.25, t: AW('answers') - 0.1, label: 'answers', lx: 1490, ly: 1010 },
];
const SATS = [[pinDoodle(), 780, 240, -0.1], [cameraDoodle(), 760, 900, 0.08], [gameDoodle(), 1120, 930, -0.06], [marginDoodle('heart', 1170, 215, 76, 170, { role: 'accents.0' }), 1170, 215, 0]];
const AI_WRITE = { at: A0 - 0.2, per: 'glyph', wps: 3.2, lead: 0.3 };
function drawA({ T, look }) {
  return [
    paper(),
    meta('anchor', { name: 'text:AI' }), meta('anchor', { name: 'coffeeRing' }),
    ...FURNITURE.a(),
    writeOn(AI_WORD, { t: T, ...AI_WRITE }),
    circleAround(HUB, ramp(1.0, 1.5, T), { role: 'accents.0', w: 4, pad: 4, seed: 161 }),
    writer(AI_WORD, T, { ...AI_WRITE, look }),
    // "everywhere": little things all over the page
    ...SATS.map(([node, x, y, rot], j) => popIn(spring(T, AW('everywhere') + 0.1 + j * 0.16, 0.35), x, y, place(x, y, { rot, scale: 1.25 }, node))),
    // a branch to each thing it does, then the thing drawn on
    ...MAP.map((m, j) => {
      const placed = place(m.x, m.y, { rot: m.rot, scale: m.s }, m.node), box = bounds([placed]);
      const label = handText(m.label, m.lx, m.ly, { size: 46, align: 'center', role: 'inks.2', ink2: null, seed: 180 + j });
      return [
        arrowTo(HUB, box, { p: ramp(m.t, m.t + 0.35, T), curve: j === 1 ? -0.18 : 0.18, role: 'inks.2', w: 3.4, gap: 14, seed: 170 + j }),
        T > m.t + 0.2 && reveal(ramp(m.t + 0.2, m.t + 1.0, T, ease.out), placed),
        T > m.t + 0.7 && reveal(ramp(m.t + 0.7, m.t + 1.2, T, (u) => u), label),
      ];
    }),
  ];
}
const PAGE_A = { dur: g(A0 + said('ai-open') + 0.9) };

// ---------- page B: the title, Bit, Sam ----------

const B0 = 0.25;                                          // ai-title starts
const BM = g(B0 + said('ai-title') + 0.55);               // ai-meet starts (the cut to the meet shot)
const BW = (w, n = 0) => BM + word('ai-meet', w, n);
const TITLE = handText('how does AI learn?', CX, 250, { size: 124, align: 'center', role: 'ink', ink2: 'fills.0', offset: 5, w: 5, seed: 200 });
const TITLE_WRITE = { at: B0, per: 'word', wps: 2.6, lead: 0.35 };
const BIT_X = 1290, SAM_X = 700;
const BIT_DROP = B0 + word('ai-title', 'computer') - 0.1;
const SAM_WALK = walkTo(SAM, -180, SAM_X, BM - 1.6, null, { s: SS });
const SAM_FRONT = stand(SAM, { ...SAM.rest, ...SAM.look(0) }), SAM_RIGHT = stand(SAM, { ...SAM.rest, ...SAM.look(1) });
const SAM_B = perform(SAM, [
  [0, SAM_FRONT],
  [BW('sam') + 0.2, ['wave', 'happy'], { dur: 0.3, anticipate: 0.1 }],
  [BW('and') + 0.2, SAM_FRONT, { dur: 0.3 }],
  [BW('sam', 1) - 0.1, SAM_RIGHT, { dur: 0.25 }],
  [BW('how') - 0.3, ['present', 'happy'], { dur: 0.35, anticipate: 0.12, overshoot: 0.1 }],
]);
const CAT_PHOTO = polaroid(0, 0, { s: 0.66, kids: [place(0, 95, { scale: 0.72 }, cat({ coat: 0 }))], bg: 'fills.1', seed: 210 });
const SAM_CAT = attach(SAM, 'hand-r', place(0, -64, CAT_PHOTO), { level: true, s: SS });
const BIT_B = perform(BIT, [
  [0, { ...BIT.rest, eye: 'wide' }],
  [BIT_DROP + 0.7, { eye: 'open' }, { dur: 0.2 }],
  [B0 + word('ai-title', 'learn') + 0.1, 'confused', { dur: 0.3, anticipate: 0.1 }],
  [BW('and') + 0.1, 'wave', { dur: 0.35, anticipate: 0.12, overshoot: 0.12 }],
  [BW('brandnew') + 0.2, { ...BIT.rest, eye: 'open', bulb: 'on' }, { dur: 0.3 }],
  [BW('knows') + 0.1, { ...BIT.rest, eye: 'half', bulb: 'off', mouth: 0 }, { dur: 0.3 }],
  [BW('how') + 0.1, { ...BIT.rest, eye: 'wide', head: -6 }, { dur: 0.3 }],
]);
// The empty thought: a bubble with nothing in it but a tumbleweed rolling through.
function tumbleweed(x, y, r, a, seed) {
  const q = rng(seed), pts = [];
  for (let j = 0; j < 46; j++) { const t = j * 0.62, rr = r * (0.45 + 0.55 * q()); pts.push([x + Math.cos(t + a) * rr, y + Math.sin(t + a) * rr * 0.92]); }
  return stroke(curve(pts, 3), { base: 'fills.4', shade: 0.35 }, { w: 2.2, wobble: 0.6, seed, name: 'tumbleweed' });
}
const THINK = [BIT_X + 40, 440, 380, 200];                  // Bit's thought bubble
function drawB({ T, look }) {
  const walking = T < SAM_WALK.end + 0.05, sx = walking ? SAM_WALK.x(T) : SAM_X;
  let sam = walking ? SAM_WALK.state(T) : SAM_B.state(T);
  const holding = T >= BW('how') - 0.3;
  if (holding) sam = { ...sam, props: [SAM_CAT] };
  // Bit falls in on "computer", squashes on landing and settles.
  const fall = ramp(BIT_DROP, BIT_DROP + 0.32, T, ease.in), land = T - (BIT_DROP + 0.32);
  const sq = land > 0 && land < 0.4 ? Math.sin(land / 0.4 * Math.PI) * (land < 0.2 ? 0.16 : 0.07) : 0;
  const bit = { ...BIT.idle(T, 3), ...BIT_B.state(T), ...(T > BIT_DROP + 0.3 && T < BIT_DROP + 0.6 ? { eye: 'wide' } : {}) };
  const think = ramp(BW('knows') - 0.1, BW('knows') + 0.25, T, ease.out) * (1 - ramp(BW('sam', 1) - 0.1, BW('sam', 1) + 0.2, T));
  const [tx, ty, tw, th] = THINK, roll = ramp(BW('knows') + 0.2, BW('nothing') + 0.9, T, (u) => u);
  const q = T >= BW('how') + 0.25;
  return [
    paper(),
    meta('anchor', { cel: 'bit' }), meta('anchor', { name: 'text:how does AI learn?' }), meta('anchor', { name: 'paperClip' }),
    T < BIT_DROP + 0.4 && meta('intent', 'crop'),
    ...FURNITURE.b(),
    writeOn(TITLE, { t: T, ...TITLE_WRITE }),
    underline(TITLE, ramp(B0 + 2.1, B0 + 2.6, T), { role: 'accents.0', w: 4, wavy: true, seed: 201 }),
    writer(TITLE, T, { ...TITLE_WRITE, look }),
    stroke(line(260, FLOOR + 2, 1780, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 202, name: 'floor' }),
    T >= BIT_DROP && squash(BIT_X, FLOOR, 1 + sq, 1 - sq, onFloor(BIT, BIT_X, BS, bit, { lift: (1 - fall) * 900 })),
    think > 0 && popIn(think, tx + tw / 2, ty + th / 2, group('thought', [
      bubble(THINK, [BIT_X + 40, FLOOR - 2 * BS * 0.96 - 30], { kind: 'thought', seed: 203, w: 3 }),
      roll > 0 && roll < 1 && tumbleweed(tx + 50 + roll * (tw - 100), ty + th * 0.6 - Math.abs(Math.sin(roll * Math.PI * 3)) * 30, 40, roll * 14, 204),
      stroke(line(tx + 40, ty + th * 0.6 + 40, tx + tw - 40, ty + th * 0.6 + 40), { base: 'ink', alpha: 0.3 }, { w: 2, seed: 205 }),
    ])),
    q && popIn(spring(T, BW('how') + 0.25, 0.4), BIT_X + 150, 560, question([BIT_X + 150, 560], 120, 1, { role: 'inks.1', seed: 206 })),
    onFloor(SAM, sx, SS, sam),
  ];
}
const PAGE_B = { dur: g(BM + said('ai-meet') + 1.1) };

// ---------- Bit's geometry on the stage ----------

// Where Bit's head and screen are when it stands at (x, floor) at size s with its head level: the puppet's
// neck pivot is 114 of its units above its hips, so the stage scale is measured, not guessed.
const BIT_K = (() => {
  const st = stand(BIT, { ...BIT.rest });
  const hip = partAt(BIT, 'body', [0, 0, 100], st), neck = partAt(BIT, 'head', [0, 0, 100], st);
  return (hip[1] - neck[1]) / 114 / 100;                       // stage units per puppet unit, per unit of s
})();
function bitScreen(x, s = BS, lift = 0) {
  const k = BIT_K * s, neck = partAt(BIT, 'head', [x, at(s) - lift, s], stand(BIT, { ...BIT.rest }));
  return { k, cx: neck[0], cy: neck[1] - 66 * k, w: 148 * k, h: 104 * k, top: neck[1] - 134 * k };
}

// A green beam from Bit's screen over a subject standing at sx (its box sb: [x, y, w, h]), and the scan line
// going down it as u runs 0..1.
function scanBeam(from, [x, y, w, h], u, a = 1) {
  const near = from[0] < x + w / 2 ? x : x + w, far = near === x ? x + w : x, yy = y + h * u;
  return group({ name: 'scan', cache: 'never' }, [
    fill(poly([[from[0], from[1] - 12], [near, y], [far, y], [far, y + h], [near, y + h], [from[0], from[1] + 12]], true), 'fills.3', { alpha: 0.2 * a, name: 'beam' }),
    stroke(line(x - 16, yy, x + w + 16, yy), 'accents.2', { w: 5, wobble: 0.4, alpha: 0.9 * a, seed: 300, name: 'scanline' }),
    stroke(line(from[0], from[1], near, yy), 'accents.2', { w: 1.8, wobble: 0.3, alpha: 0.6 * a, dash: [8, 8], seed: 301, name: 'ray' }),
  ]);
}

// ---------- page C: 1. rules ----------

const C0 = 0.9;                                           // ai-rules starts
const CW = (w, n = 0) => C0 + word('ai-rules', w, n);
const LX = 420, TICK = [1010, 1118];
const ROWS = [RULE(5), RULE(7), RULE(9)];
const LIST_TITLE = handText('cat rules', LX, RULE(3) - 4, { size: 84, role: 'ink', ink2: null, w: 4.2, seed: 310 });
const ITEMS = [
  { text: 'pointy ears', t: CW('pointy') - 0.15 },
  { text: 'fur', t: CW('fur') - 0.15 },
  { text: 'a long tail', t: CW('long') - 0.25 },
].map((it, j) => ({ ...it, node: handText(it.text, LX + 104, ROWS[j], { size: 68, role: 'ink', ink2: null, w: 3.4, seed: 320 + j }) }));
const ITEM_WRITE = (t) => ({ at: t, per: 'glyph', wps: 5, lead: 0.28, exit: 0.3 });
// The little pictures beside the rules, drawn as they are said.
const ICONS = [
  (x, y) => stroke({ sub: [{ pts: [x - 30, y + 14, x - 20, y - 22, x - 6, y + 4], closed: false }, { pts: [x + 6, y + 4, x + 20, y - 22, x + 30, y + 14], closed: false }], box: [x - 30, y - 22, 60, 36] }, 'inks.1', { w: 3.6, seed: 330 }),
  (x, y) => stroke(curve([[x - 32, y + 8], [x - 24, y - 12], [x - 14, y + 8], [x - 4, y - 14], [x + 6, y + 8], [x + 16, y - 12], [x + 28, y + 8]], 3), 'inks.1', { w: 3.6, seed: 331 }),
  (x, y) => stroke(curve([[x - 30, y + 14], [x - 6, y + 12], [x + 16, y - 2], [x + 20, y - 22], [x + 8, y - 26]], 4), 'inks.1', { w: 4.4, seed: 332 }),
];
const box44 = (x, y) => roundRect(x - 25, y - 25, 50, 50, 6);
// Mini faces over the tick columns: whose ticks they are.
const catFace = (x, y) => group('catFace', [
  fill(poly([[x - 26, y - 6], [x - 22, y - 34], [x - 6, y - 20]], true), 'fills.4'), fill(poly([[x + 26, y - 6], [x + 22, y - 34], [x + 6, y - 20]], true), 'fills.4'),
  stroke(poly([[x - 26, y - 6], [x - 22, y - 34], [x - 6, y - 20]], true), 'ink', { w: 2.2, seed: 340 }), stroke(poly([[x + 26, y - 6], [x + 22, y - 34], [x + 6, y - 20]], true), 'ink', { w: 2.2, seed: 341 }),
  fill(ellipse(x, y, 28, 22, 24), 'fills.4'), stroke(ellipse(x, y, 28, 22, 24), 'ink', { w: 2.4, seed: 342 }),
  fill(circle(x - 9, y - 3, 3, 8), 'ink'), fill(circle(x + 9, y - 3, 3, 8), 'ink'),
  stroke({ sub: [{ pts: [x - 14, y + 5, x - 40, y + 1], closed: false }, { pts: [x + 14, y + 5, x + 40, y + 1], closed: false }, { pts: [x - 14, y + 9, x - 38, y + 12], closed: false }, { pts: [x + 14, y + 9, x + 38, y + 12], closed: false }], box: [x - 40, y, 80, 12] }, 'ink', { w: 1.4, seed: 343 }),
]);
const foxFace = (x, y) => group('foxFace', [
  fill(poly([[x - 28, y - 4], [x - 26, y - 40], [x - 6, y - 20]], true), 'fills.4'), fill(poly([[x + 28, y - 4], [x + 26, y - 40], [x + 6, y - 20]], true), 'fills.4'),
  stroke(poly([[x - 28, y - 4], [x - 26, y - 40], [x - 6, y - 20]], true), 'ink', { w: 2.2, seed: 350 }), stroke(poly([[x + 28, y - 4], [x + 26, y - 40], [x + 6, y - 20]], true), 'ink', { w: 2.2, seed: 351 }),
  fill(poly([[x - 32, y - 8], [x, y - 22], [x + 32, y - 8], [x + 12, y + 16], [x, y + 22], [x - 12, y + 16]], true), 'fills.4'),
  fill(poly([[x - 32, y - 8], [x - 10, y + 2], [x, y + 22], [x - 12, y + 16]], true), 'light'), fill(poly([[x + 32, y - 8], [x + 10, y + 2], [x, y + 22], [x + 12, y + 16]], true), 'light'),
  stroke(poly([[x - 32, y - 8], [x, y - 22], [x + 32, y - 8], [x + 12, y + 16], [x, y + 22], [x - 12, y + 16]], true), 'ink', { w: 2.4, seed: 352 }),
  fill(circle(x - 10, y - 6, 3, 8), 'ink'), fill(circle(x + 10, y - 6, 3, 8), 'ink'), fill(circle(x, y + 18, 4, 8), 'ink'),
]);

// The test: a cat hops in from the right, Bit scans it, three ticks, "It's a cat!"; it hops off. Then the fox.
const SPOT = 1420, BIT_C = 900, SAM_C = 380;
const CAT_IN = g(C0 + said('ai-rules') + 0.35);
const CAT_S = 1.3, CAT_BOX = [SPOT - 120, FLOOR - 320, 250, 320];
const SCAN = CAT_IN + 1.0, SCAN_D = 0.8;
const TICKS_A = [0, 1, 2].map((j) => SCAN + SCAN_D + 0.1 + j * 0.24);
const SAY_CAT = g(TICKS_A[2] + 0.35);
const CAT_OUT = SAY_CAT + 1.5;
const UNTIL = g(CAT_OUT + 0.55);                           // ai-until
// The fox bounds in: three leaps from off the page to the spot, tucked in the air, a crouch at each landing.
const LEAP_T0 = UNTIL + 0.2, LEAP = 0.42, LEAPS = 3;
const FOX_ARR = LEAP_T0 + LEAP * LEAPS + 0.1;
function foxLeap(T) {
  const u = (T - LEAP_T0) / LEAP, k = Math.min(LEAPS - 1, Math.max(0, Math.floor(u))), f = Math.min(1, Math.max(0, u - k));
  const x0 = 2060, step = (x0 - SPOT) / LEAPS, x = x0 - step * (k + ease.io(f));
  const air = Math.sin(f * Math.PI), lift = air * (140 - k * 30);
  const tuck = f > 0.1 && f < 0.9;
  const st = tuck ? { ...FOX.look(-1), 'leg-l': 36, 'leg-r': -30, 'arm-l': 40, 'arm-r': -30, head: -8, eye: 'wide' } : { ...FOX.look(-1), 'leg-l': 0, 'leg-r': 0, 'arm-l': 10, 'arm-r': -10, head: 6 };
  return { x, lift, state: stand(FOX, { ...FOX.rest, ...st }) };
}
const SCAN2 = FOX_ARR + 0.25;
const FOX_BOX = [SPOT - 95, FLOOR - 2 * FS * 0.9, 190, 2 * FS * 0.9];
const TICKS_B = [0, 1, 2].map((j) => SCAN2 + SCAN_D + 0.1 + j * 0.24);
const SAY_CAT2 = g(TICKS_B[2] + 0.35);
const FOX_IM = g(SAY_CAT2 + said('bit-cat') + 0.45);
const MESSY = g(FOX_IM + said('fox-im') + 0.9);           // ai-messy
const MW = (w, n = 0) => MESSY + word('ai-messy', w, n);
const PAGE_C = { dur: g(MESSY + said('ai-messy') + 0.8) };

const FOX_C = perform(FOX, [
  [0, stand(FOX, { ...FOX.rest, ...FOX.look(-0.5) })],
  [FOX_IM - 0.25, ['angry'], { dur: 0.2, anticipate: 0.1 }],
  [FOX_IM, { ...FOX.look(0), 'arm-l': 44, 'arm-r': -44, head: -4 }, { dur: 0.25 }],
  [MW('so') + 0.2, { ...FOX.look(-0.5), 'arm-l': 0, 'arm-r': 0, eye: 'open' }, { dur: 0.3 }],
]);
const SAM_C_ACT = perform(SAM, [
  [0, SAM_RIGHT],
  [CW('write') - 0.1, ['present', 'happy'], { dur: 0.35, anticipate: 0.12 }],
  [CW('easy') - 0.05, ['cheer', 'happy'], { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
  [CW('easy') + 0.8, { ...SAM_RIGHT, eye: 'open', mouth: 0 }, { dur: 0.35 }],
  [FOX_IM + 0.7, ['facepalm'], { dur: 0.3, anticipate: 0.1 }],
  [MW('so') - 0.2, ['shrug', 'confused'], { dur: 0.3, anticipate: 0.1 }],
]);
const BIT_C_ACT = perform(BIT, [
  [0, { ...BIT.rest, eye: 'open' }],
  [SCAN - 0.1, { eye: 'wide', bulb: 'on' }, { dur: 0.15 }],
  [SAY_CAT - 0.1, { eye: 'happy', bulb: 'on', head: -6 }, { dur: 0.2 }],
  [SAY_CAT + 1.2, { eye: 'open', bulb: 'off', head: 0 }, { dur: 0.3 }],
  [SCAN2 - 0.1, { eye: 'wide', bulb: 'on' }, { dur: 0.15 }],
  [SAY_CAT2 - 0.1, { eye: 'happy', bulb: 'on', head: -6 }, { dur: 0.2 }],
  [FOX_IM + 0.2, { eye: 'wide', bulb: 'off', head: 4 }, { dur: 0.2 }],
  [MW('messy'), { eye: 'x', 'brow-l': -12, 'brow-r': 12 }, { dur: 0.2 }],
  [MW('so') + 0.1, { eye: 'half', 'brow-l': 0, 'brow-r': 0, head: 8 }, { dur: 0.3 }],
]);
// A hop from x0 to x1 on the floor over [t0, t0 + d], n bounces of height h.
function hopX(T, t0, d, x0, x1, n = 2, h = 90) {
  const u = ramp(t0, t0 + d, T, (v) => v);
  return { x: x0 + (x1 - x0) * u, lift: Math.abs(Math.sin(u * Math.PI * n)) * h, u };
}
// The messy world: things the rules did not see coming, each a sticky note with a red "?".
const EXCEPTIONS = [
  { x: 1240, y: 150, s: 210, rot: -0.07, t: MW('real') - 0.1, kid: (s) => place(s / 2, s - 12, { scale: 0.62 }, cat({ coat: 4 })) },
  { x: 1480, y: 250, s: 210, rot: 0.06, t: MW('way'), kid: (s) => place(s / 2, s - 12, { scale: 0.62 }, cat({ coat: 1, tail: 0 })) },
  { x: 1700, y: 140, s: 210, rot: -0.04, t: MW('too'), kid: (s) => place(s / 2 + 18, s - 12, { scale: 0.62 }, dog({ coat: 3, ears: 1 })) },
  { x: 1690, y: 400, s: 190, rot: 0.08, t: MW('messy') - 0.05, kid: (s) => [
    fill(roundRect(22, s * 0.5, s - 44, s * 0.42, 6), { base: 'fills.4', shade: 0.25 }, { finish: true }), stroke(roundRect(22, s * 0.5, s - 44, s * 0.42, 6), 'ink', { w: 2.4, seed: 361 }),
    fill(poly([[s * 0.32, s * 0.5], [s * 0.36, s * 0.3], [s * 0.46, s * 0.5]], true), 'fills.4'), stroke(poly([[s * 0.32, s * 0.5], [s * 0.36, s * 0.3], [s * 0.46, s * 0.5]], true), 'ink', { w: 2.2, seed: 362 }),
    fill(poly([[s * 0.54, s * 0.5], [s * 0.64, s * 0.3], [s * 0.68, s * 0.5]], true), 'fills.4'), stroke(poly([[s * 0.54, s * 0.5], [s * 0.64, s * 0.3], [s * 0.68, s * 0.5]], true), 'ink', { w: 2.2, seed: 363 }),
  ] },
];
function drawC({ T, look }) {
  const bitSt = { ...BIT.idle(T, 5), ...BIT_C_ACT.state(T), ...BIT.mouth('bit-cat', T, SAY_CAT), ...BIT.mouth('bit-cat', T, SAY_CAT2) };
  const bs = bitScreen(BIT_C);
  const eye = [bs.cx + bs.w / 2, bs.cy];
  // the cat: in, tested, out
  const inHop = hopX(T, CAT_IN, 0.8, 2100, SPOT), outHop = hopX(T, CAT_OUT, 0.7, SPOT, 2150);
  const catX = T < CAT_OUT ? inHop.x : outHop.x, catLift = T < CAT_OUT ? inHop.lift : outHop.lift;
  const catOn = T >= CAT_IN && T < CAT_OUT + 0.7;
  // the fox
  const leaping = T < FOX_ARR, leap = leaping ? foxLeap(T) : null;
  const foxSt = leaping ? leap.state : { ...FOX.idle(T, 6), ...FOX_C.state(T), ...FOX.mouth('fox-im', T, FOX_IM) };
  const foxX = leaping ? leap.x : SPOT, foxLift = leaping ? leap.lift : 0;
  const scanU = (t0) => ramp(t0, t0 + SCAN_D, T, ease.io);
  const scanOn = (t0) => T >= t0 && T < t0 + SCAN_D + 0.2;
  const crossP = ramp(MW('so') - 0.1, MW('so') + 0.5, T);
  const listBox = [LX - 20, RULE(3) - 90, TICK[1] + 60 - LX, ROWS[2] + 40 - RULE(3) + 90];
  return [
    paper(),
    meta('anchor', { cel: 'bit' }),
    ...FURNITURE.c(),
    ...heading('1. rules', T),
    // the rules, written as they are said
    writeOn(LIST_TITLE, { t: T, ...ITEM_WRITE(CW('write') - 0.2) }),
    underline(LIST_TITLE, ramp(CW('rules') + 0.3, CW('rules') + 0.6, T), { role: 'ink', w: 3, seed: 311 }),
    writer(LIST_TITLE, T, { ...ITEM_WRITE(CW('write') - 0.2), look }),
    ...ITEMS.flatMap((it, j) => [
      T > it.t && reveal(ramp(it.t, it.t + 0.5, T, ease.out), place(LX + 40, ROWS[j] - 22, { scale: 1.25 }, ICONS[j](0, 0))),
      writeOn(it.node, { t: T, ...ITEM_WRITE(it.t + 0.1) }),
      writer(it.node, T, { ...ITEM_WRITE(it.t + 0.1), look }),
      T > it.t + 0.3 && reveal(ramp(it.t + 0.3, it.t + 0.6, T), stroke(box44(TICK[0], ROWS[j] - 22), 'ink', { w: 2.8, seed: 312 + j })),
      T > it.t + 0.3 && reveal(ramp(it.t + 0.3, it.t + 0.6, T), stroke(box44(TICK[1], ROWS[j] - 22), 'ink', { w: 2.8, seed: 315 + j })),
      tickMark([TICK[0], ROWS[j] - 24], ramp(TICKS_A[j], TICKS_A[j] + 0.2, T), { size: 56, role: 'inks.3', w: 5, seed: 370 + j }),
      tickMark([TICK[1], ROWS[j] - 24], ramp(TICKS_B[j], TICKS_B[j] + 0.2, T), { size: 56, role: 'inks.3', w: 5, seed: 373 + j }),
    ]),
    T > CAT_IN && popIn(spring(T, CAT_IN, 0.35), TICK[0], RULE(3) - 34, place(TICK[0], RULE(3) - 34, { scale: 1.25 }, catFace(0, 0))),
    T > UNTIL + 0.5 && popIn(spring(T, UNTIL + 0.5, 0.35), TICK[1], RULE(3) - 34, place(TICK[1], RULE(3) - 34, { scale: 1.25 }, foxFace(0, 0))),
    // the floor
    stroke(line(200, FLOOR + 2, 1860, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 302, name: 'floor' }),
    // the messy world, then the rules crossed out
    ...EXCEPTIONS.map((e, j) => T > e.t && popIn(spring(T, e.t, 0.35), e.x + e.s / 2, e.y + e.s / 2, group('exception', [
      stickyNote(e.x, e.y, e.s, 380 + j, [[e.kid(e.s)].flat(), question([e.s - 30, 42], 70, 1, { role: 'inks.1', w: 4, seed: 390 + j })].flat()),
    ]))),
    crossP > 0 && crossMark(listBox, crossP, { size: 440, role: 'inks.1', w: 10, seed: 395 }),
    // the stage: sam, the one tested, Bit
    onFloor(SAM, SAM_C, SS, SAM_C_ACT.state(T)),
    catOn && onFloor({ place: (x, y, s) => place(x, FLOOR - catLift, { scale: CAT_S }, cat({ coat: 0, blink: +(T > SAY_CAT && T < SAY_CAT + 1.2) })) }, catX, 200, {}, { shadow: 1 - catLift / 120 }),
    T >= LEAP_T0 && onFloor(FOX, foxX, FS, foxSt, { lift: foxLift, shadow: 1 - foxLift / 200 }),
    scanOn(SCAN) && scanBeam(eye, CAT_BOX, scanU(SCAN)),
    scanOn(SCAN2) && scanBeam(eye, FOX_BOX, scanU(SCAN2)),
    onFloor(BIT, BIT_C, BS, bitSt),
    // a stamp of what Bit decided, over the one it decided it about
    T > SAY_CAT + 0.3 && T < CAT_OUT && popIn(spring(T, SAY_CAT + 0.3, 0.3), SPOT, 600, handText('cat!', SPOT, 620, { size: 64, align: 'center', role: GREEN, ink2: null, w: 4, seed: 396 })),
    T > SAY_CAT2 + 0.3 && T < MESSY && popIn(spring(T, SAY_CAT2 + 0.3, 0.3), SPOT, 500, handText('cat!', SPOT, 520, { size: 64, align: 'center', role: GREEN, ink2: null, w: 4, seed: 397 })),
  ];
}

// ---------- page D: 2. examples ----------

const D_EX = 0.7;                                          // ai-examples
const DW = (w, n = 0) => D_EX + word('ai-examples', w, n);
const BIT_D = 560, DECK = [1080, 560], SAM_D = 1620, DECK_S = 1.45;
const D_GUESS = g(D_EX + said('ai-examples') + 0.25);      // ai-guess
const GUESS_CARD = D_GUESS + word('ai-guess', 'guesses') - 0.1;
const SAY_Q = g(D_GUESS + said('ai-guess') + 0.25);        // bit-cat-q
const WRONG = SAY_Q + said('bit-cat-q') + 0.15;
const D_DIALS = g(WRONG + 0.65);                            // ai-dials
const DD = (w, n = 0) => D_DIALS + word('ai-dials', w, n);
const LENS_IN = DD('turns') - 0.2;
const CLICKS = [DD('tiny'), DD('dials'), DD('little')];
const DOG_CARD = DD('so');
const SAY_DOG = g(D_DIALS + said('ai-dials') + 0.2);      // bit-dog
const RIGHT = SAY_DOG + said('bit-dog') + 0.1;
const D_AGAIN = g(RIGHT + 0.55);                            // ai-again
const PRACTICE = Array.from({ length: 9 }, (_, j) => D_AGAIN + 0.15 + j * 0.36);
const PRACTICE_OK = [0, 0, 1, 0, 1, 1, 1, 1, 1];
const D_PAT = g(D_AGAIN + said('ai-again') + 0.3);        // ai-pattern
const DP = (w, n = 0) => D_PAT + word('ai-pattern', w, n);
const ML = DP('machine') - 0.1;
const FOX_UP = g(D_PAT + said('ai-pattern') + 0.15);        // the fox pops up from behind the deck
const FOX_HOP = FOX_UP + 0.6, FOX_LAND = FOX_HOP + 0.42;
const SCAN_D2 = FOX_LAND + 0.15;
const SAY_91 = g(SCAN_D2 + 0.65);                          // bit-cat91
const COMEON = g(SAY_91 + said('bit-cat91') + 0.2);       // fox-comeon
const SHOWN = g(COMEON + said('fox-comeon') + 0.25);        // ai-shown
const PAGE_D = { dur: g(SHOWN + said('ai-shown') + 0.7) };

// The cards dealt onto the deck: what is in each, its label, when it lands, and a tick or a cross.
const pet = (kind, o) => (kind === 'cat' ? place(0, 95, { scale: 0.72 }, cat(o)) : place(0, 95, { scale: 0.7 }, dog(o)));
const BGS = ['fills.1', 'fills.3', 'fills.5', 'fills.0', 'fills.2'];
const DEAL = [
  { kind: 'cat', o: { coat: 0 }, t: DW('examples') + 0.05, label: 'cat', lt: DW('right') },
  { kind: 'cat', o: { coat: 1, look: 1 }, t: DW('cat') - 0.12, label: 'cat', lt: DW('cat') },
  { kind: 'dog', o: { coat: 0 }, t: DW('dog') - 0.12, label: 'dog', lt: DW('dog') },
  { kind: 'cat', o: { coat: 2 }, t: DW('cat', 1) - 0.12, label: 'cat', lt: DW('cat', 1) },
  { kind: 'cat', o: { coat: 3, look: -1 }, t: DW('cat', 2) - 0.12, label: 'cat', lt: DW('cat', 2) },
  { kind: 'dog', o: { coat: 2, ears: 0 }, t: DW('dog', 1) - 0.12, label: 'dog', lt: DW('dog', 1) },
  { kind: 'dog', o: { coat: 1, ears: 1 }, t: GUESS_CARD, label: 'dog', lt: WRONG + 0.1, labelRole: RED, mark: 'x', mt: WRONG },
  { kind: 'dog', o: { coat: 3, ears: 0 }, t: DOG_CARD, label: 'dog', lt: RIGHT + 0.05, labelRole: GREEN, mark: 'ok', mt: RIGHT },
  ...PRACTICE.map((t, j) => ({ kind: j % 3 === 1 ? 'dog' : 'cat', o: j % 3 === 1 ? { coat: j % 4, ears: j % 2 } : { coat: (j * 3) % 4, look: (j % 3) - 1 }, t, label: j % 3 === 1 ? 'dog' : 'cat', lt: t + 0.1, labelRole: PRACTICE_OK[j] ? GREEN : RED, mark: PRACTICE_OK[j] ? 'ok' : 'x', mt: t + 0.18, fast: true })),
].map((c, j) => ({ ...c, j, rot: [-0.06, 0.05, -0.02, 0.07, -0.05, 0.03, -0.04, 0.06][j % 8], bg: BGS[j % BGS.length] }));

// A dealt card: it slides in from Sam's side over 0.3 s (0.18 when practising), lands with a little bounce.
function dealt(c, T, k = 0, next = null) {
  if (T < c.t) return null;
  const d = c.fast ? 0.18 : 0.3, u = ramp(c.t, c.t + d, T, ease.out), [x1, y1] = DECK;
  // knocked off the deck by the fox's landing: each flies its own way, turning, off the page
  const off = ramp(FOX_LAND - 0.05, FOX_LAND + 0.5, T, (v) => v), dir = [[-1.3, -0.9], [1.4, -1.1], [-0.6, -1.6], [1.0, -1.5]][k % 4];
  if (off >= 1) return null;
  const x = x1 + (1 - u) * 520 + dir[0] * off * 1300, y = y1 - Math.sin(u * Math.PI) * 60 - (1 - u) * 80 + dir[1] * off * 700 + off * off * 900;
  const rot = c.rot + (1 - u) * 0.5 + off * dir[0] * 3;
  const covered = next && T > next.t + (next.fast ? 0.1 : 0.18);
  const labelP = covered || off > 0 ? 0 : c.lt === undefined ? 1 : ramp(c.lt, c.lt + 0.3, T, (v) => v);
  return group({ name: 'card', cache: 'never' }, [
    polaroid(x, y, { s: DECK_S, rot, bg: c.bg, kids: [pet(c.kind, c.o)], label: c.label, labelP, labelRole: c.labelRole ?? 'ink', seed: 400 + c.j * 7, lift: 1 - u }),
    c.mark && T > c.mt && place(x + 110 * DECK_S, y - 120 * DECK_S, { rot: 0 }, c.mark === 'ok'
      ? tickMark([0, 0], ramp(c.mt, c.mt + 0.18, T), { size: 90, role: 'inks.3', w: 7, seed: 460 + c.j })
      : crossMark([0, 0], ramp(c.mt, c.mt + 0.18, T), { size: 84, role: 'inks.1', w: 7, seed: 460 + c.j })),
  ]);
}
// The dials: where each points at T (degrees), turned a notch at each click and jostled while practising.
function dialsAt(T) {
  const base = [30, -50, 80], notch = [26, -32, 22];
  return base.map((b, j) => {
    let a = b;
    CLICKS.forEach((t, k) => { if (k === j) a += notch[j] * ease.out(ramp(t, t + 0.15, T, (v) => v)); });
    PRACTICE.forEach((t, k) => { a += (k % 3 === j ? 12 : -8) * ease.out(ramp(t + 0.1, t + 0.2, T, (v) => v)); });
    return Math.round(a / 2) * 2;
  });
}
// The magnifier over Bit's chest: its three dials, big.
const LENS = [300, 330, 150];
function lens(T, u) {
  const [lx, ly, r] = LENS, [a1, a2, a3] = dialsAt(T), rad = Math.PI / 180;
  const dial = (x, a, j) => group('bigDial', [
    ...Array.from({ length: 9 }, (_, k) => { const q = (-135 + k * 33.75) * rad; return stroke(line(x + Math.sin(q) * 54, ly + 10 - Math.cos(q) * 54, x + Math.sin(q) * 64, ly + 10 - Math.cos(q) * 64), 'ink', { w: 2.2, seed: 470 + j * 10 + k }); }),
    fill(circle(x, ly + 10, 42, 36), 'fills.0', { finish: true }), stroke(circle(x, ly + 10, 42, 36), 'ink', { w: 3.4, seed: 480 + j }),
    stroke(line(x, ly + 10, x + Math.sin(a * rad) * 34, ly + 10 - Math.cos(a * rad) * 34), 'ink', { w: 6, wobble: 0.3, seed: 485 + j }),
    fill(circle(x, ly + 10, 6, 12), 'ink'),
  ]);
  const body = [
    fill(circle(lx, ly, r, 64), 'light'),
    clip(circle(lx, ly, r - 4, 64), [
      fill(rect(lx - r, ly - r, 2 * r, 2 * r), { base: 'fills.1', tint: 0.3 }),
      fill(roundRect(lx - 160, ly - 64, 320, 150, 18), 'light'), stroke(roundRect(lx - 160, ly - 64, 320, 150, 18), 'ink', { w: 3, seed: 490 }),
      dial(lx - 100, a1, 0), dial(lx, a2, 1), dial(lx + 100, a3, 2),
    ]),
    stroke(arc(lx, ly, r - 22, Math.PI * 1.1, Math.PI * 1.4), 'light', { w: 6, wobble: 0.3, seed: 491 }),
    stroke(circle(lx, ly, r, 64), 'ink', { w: 7, wobble: 0.5, seed: 492 }),
    fill(poly([[lx + r * 0.66, ly + r * 0.72], [lx + r * 0.78, ly + r * 0.6], [lx + r * 1.28, ly + r * 1.1], [lx + r * 1.16, ly + r * 1.22]], true), 'fills.4', { finish: true }),
    stroke(poly([[lx + r * 0.66, ly + r * 0.72], [lx + r * 0.78, ly + r * 0.6], [lx + r * 1.28, ly + r * 1.1], [lx + r * 1.16, ly + r * 1.22]], true), 'ink', { w: 3, seed: 493 }),
  ];
  return popIn(u, lx, ly, group({ name: 'lens', cache: 'never' }, body));
}
// The practice chart: right answers climbing as the cards go by.
const CHART = [1530, 160, 320];
function chart(T, u) {
  const [cx, cy, s] = CHART, k = ramp(PRACTICE[0], PRACTICE.at(-1) + 0.3, T, (v) => v), pts = [];
  for (let j = 0; j <= 24 * k; j++) { const v = j / 24, acc = 0.5 + 0.47 * (1 - Math.exp(-4 * v)) + Math.sin(j * 1.7) * 0.03 * (1 - v); pts.push([cx + 44 + v * (s - 70), cy + s - 50 - acc * (s - 100)]); }
  return popIn(u, cx + s / 2, cy + s / 2, stickyNote(cx, cy, s, 495, [
    stroke(line(38, 30, 38, s - 44), 'ink', { w: 2.6, seed: 496 }), stroke(line(38, s - 44, s - 20, s - 44), 'ink', { w: 2.6, seed: 497 }),
    stroke(line(38, 50, s - 20, 50), { base: 'inks.3', alpha: 0.5 }, { w: 1.6, dash: [8, 8], seed: 498 }),
    pts.length > 1 && stroke(poly(pts.map(([x, y]) => [x - cx, y - cy]), false), 'inks.3', { w: 5, wobble: 0.5, seed: 499 }),
    handText('right answers', s / 2 + 10, s - 10, { size: 38, align: 'center', role: 'ink', ink2: null, seed: 500 }),
  ]));
}
const MLW = handText('machine learning', 860, 262, { size: 104, align: 'center', role: 'inks.2', ink2: 'fills.0', offset: 5, w: 5, seed: 510 });
const ML_WRITE = { at: ML, per: 'glyph', wps: 7.5, lead: 0.3 };

const SAM_D_ACT = perform(SAM, [
  [0, stand(SAM, { ...SAM.rest, ...SAM.look(-1) })],
  [DW('examples') - 0.3, ['present', 'happy'], { dur: 0.3, anticipate: 0.1 }],
  [D_GUESS, stand(SAM, { ...SAM.rest, ...SAM.look(-1) }), { dur: 0.3 }],
  [WRONG + 0.1, ['think'], { dur: 0.3 }],
  [D_AGAIN, ['present', 'happy'], { dur: 0.25 }],
  [DP('machine') - 0.1, ['cheer', 'happy'], { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
  [FOX_UP, stand(SAM, { ...SAM.rest, ...SAM.look(-1), eye: 'wide' }), { dur: 0.25 }],
  [COMEON + 0.3, ['hands-on-hips'], { dur: 0.3 }],
]);
const BIT_D_ACT = perform(BIT, [
  [0, { ...BIT.rest, eye: 'open' }],
  [DEAL[0].t, { eye: 'wide', bulb: 'on' }, { dur: 0.15 }],
  [DW('dog', 1) + 0.6, { eye: 'open', bulb: 'off' }, { dur: 0.2 }],
  [GUESS_CARD + 0.3, { eye: 'half', head: 8, 'brow-l': -10, 'brow-r': 8 }, { dur: 0.3 }],
  [WRONG, { eye: 'x', head: -4, 'brow-l': 0, 'brow-r': 0 }, { dur: 0.15, anticipate: 0.08 }],
  [LENS_IN, { eye: 'open', head: 0, bulb: 'on' }, { dur: 0.3 }],
  [RIGHT, { eye: 'happy', bulb: 'on', head: -6 }, { dur: 0.2 }],
  [D_AGAIN, { eye: 'wide', head: 0 }, { dur: 0.2 }],
  [DP('pattern') - 0.1, { eye: 'star', bulb: 'on' }, { dur: 0.2, overshoot: 0.1 }],
  [DP('machine'), 'wave', { dur: 0.3 }],
  [FOX_UP + 0.1, { ...BIT.rest, eye: 'wide', bulb: 'on' }, { dur: 0.25 }],
  [SAY_91, { eye: 'star', bulb: 'on', head: -4 }, { dur: 0.2 }],
  [COMEON + 0.2, { eye: 'wide', head: 0, bulb: 'off' }, { dur: 0.2 }],
  [SHOWN + 0.6, { eye: 'half', 'brow-l': -12, 'brow-r': 12, head: 10 }, { dur: 0.35 }],
]);
const FOX_D = perform(FOX, [
  [0, stand(FOX, { ...FOX.rest, ...FOX.look(-0.5), eye: 'happy' })],
  [FOX_LAND, stand(FOX, { ...FOX.rest, ...FOX.look(-0.5), eye: 'open' }), { dur: 0.2 }],
  [COMEON - 0.2, ['angry'], { dur: 0.2 }],
  [COMEON, { ...FOX.look(0), 'arm-l': 44, 'arm-r': -44, head: -6 }, { dur: 0.25 }],
  [SHOWN + 0.5, { ...FOX.look(-0.5), eye: 'sleep', head: 10 }, { dur: 0.4 }],
]);
function drawD({ T, look }) {
  const dials = dialsAt(T), dialState = { 'dial-1': dials[0], 'dial-2': dials[1], 'dial-3': dials[2] };
  const bitSt = { ...BIT.idle(T, 7), ...BIT_D_ACT.state(T), ...dialState, ...BIT.mouth('bit-cat-q', T, SAY_Q), ...BIT.mouth('bit-dog', T, SAY_DOG), ...BIT.mouth('bit-cat91', T, SAY_91) };
  const bs = bitScreen(BIT_D), eye = [bs.cx + bs.w / 2, bs.cy];
  const shown = DEAL.filter((c) => T >= c.t), top = shown.slice(-4);
  // the fox: rises behind the deck, hops over it and lands in front
  const foxOn = T >= FOX_UP;
  const rise = ramp(FOX_UP, FOX_UP + 0.5, T, ease.out), hop = ramp(FOX_HOP, FOX_LAND, T, (v) => v);
  const foxX = DECK[0] + 40, foxLift = T < FOX_HOP ? -(1 - rise) * 260 + 60 * rise - 60 : Math.sin(hop * Math.PI) * 140;
  const foxSt = { ...FOX.idle(T, 9), ...FOX_D.state(T), ...FOX.mouth('fox-comeon', T, COMEON) };
  const foxInFront = T >= FOX_HOP + 0.22;
  const lensU = spring(T, LENS_IN, 0.4) * (1 - ramp(D_PAT, D_PAT + 0.3, T));
  const chartU = spring(T, D_AGAIN - 0.1, 0.4);
  const fox = foxOn && onFloor(FOX, foxX, FS, foxSt, { lift: foxLift, shadow: T >= FOX_LAND ? 1 : 0 });
  return [
    paper(),
    meta('anchor', { cel: 'bit' }),
    ...FURNITURE.d(),
    ...heading('2. examples', T),
    stroke(line(200, FLOOR + 2, 1860, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 402, name: 'floor' }),
    chartU > 0 && chart(T, chartU),
    writeOn(MLW, { t: T, ...ML_WRITE }),
    T > ML + 1.2 && underline(MLW, ramp(ML + 1.2, ML + 1.5, T), { role: 'inks.1', w: 4, double: true, seed: 511 }),
    writer(MLW, T, { ...ML_WRITE, look }),
    // "Lots of them": the deck's thickness, a few edges under the top cards
    T > DW('lots') && T < FOX_LAND && Array.from({ length: Math.min(10, 2 + shown.length) }, (_, j) => fill(roundRect(DECK[0] - 160 + j * 1.5, DECK[1] - 190 + j * 2.6, 319, 380, 8), j % 2 ? 'light' : { base: 'paper', shade: 0.06 }, { name: 'edge' })),
    foxOn && !foxInFront && clip(rect(0, 0, W, DECK[1] + 60), [fox]),
    ...top.map((c, k) => dealt(c, T, top.length - 1 - k, top[k + 1] ?? null)),
    foxInFront && fox,
    T >= SCAN_D2 && T < SCAN_D2 + 0.8 && scanBeam(eye, [foxX - 95, FLOOR - 2 * FS * 0.9, 190, 2 * FS * 0.9], ramp(SCAN_D2, SCAN_D2 + 0.6, T, ease.io)),
    lensU > 0 && group('lensLink', [stroke(line(LENS[0] + 110, LENS[1] + 100, BIT_D - 20, FLOOR - 120), { base: 'ink', alpha: 0.35 }, { w: 2, dash: [10, 8], seed: 503 })]),
    lensU > 0 && lens(T, lensU),
    onFloor(BIT, BIT_D, BS, bitSt),
    onFloor(SAM, SAM_D, SS, SAM_D_ACT.state(T)),
    T > SAY_91 + 0.3 && T < SHOWN + 1.5 && popIn(spring(T, SAY_91 + 0.3, 0.3), foxX, 470, group('verdict', [
      handText('cat!', foxX - 20, 480, { size: 70, align: 'center', role: GREEN, ink2: null, w: 4.4, seed: 520 }),
      handText('91%', foxX + 110, 440, { size: 48, align: 'center', role: GREEN, ink2: null, w: 3.4, seed: 521 }),
    ])),
  ];
}

// ---------- page E: 3. inside Bit (the same notebook, a dark page: chalk on navy, "look inside") ----------

const E_IN = 0.35;                                          // ai-inside
const EI = (w, n = 0) => E_IN + word('ai-inside', w, n);
const E_SIG = g(E_IN + said('ai-inside') + 0.45);           // ai-signals
const ES = (w, n = 0) => E_SIG + word('ai-signals', w, n);
const E_BIL = g(E_SIG + said('ai-signals') + 0.4);          // ai-billions
const EB = (w, n = 0) => E_BIL + word('ai-billions', w, n);
const PAGE_E = { dur: g(E_BIL + said('ai-billions') + 1.1) };
const BLOT_AT = (() => { const b = bitScreen(BIT_D); return [b.cx, b.cy]; })();

// The network: four layers of switches, a line (and a dial) between every pair in neighbouring layers.
const LAYERS = [[640, 6], [900, 5], [1160, 5], [1420, 2]].map(([x, n]) => Array.from({ length: n }, (_, j) => [x, 560 + (j - (n - 1) / 2) * (n === 2 ? 200 : 118)]));
const LINKS = (() => {
  const r = rng(601), out = [];
  for (let l = 0; l < 3; l++) LAYERS[l].forEach((a, i) => LAYERS[l + 1].forEach((b, j) => out.push({ l, i, j, a, b, w: r() * 2 - 1, ph: r() })));
  return out;
})();
const DIALED = [3, 11, 22, 34, 41, 50, 58, 62].map((k) => k % LINKS.length);
// The picture going in: a cat face 8 x 8, 0 dark to 3 bright.
const PIX = ['01000010', '01100110', '01111110', '13122131', '11111111', '11122111', '01111110', '00111100'];
const PIC = [270, 440, 26];                                  // its top left and cell size
const NUMBERS = [['0.93', 520, 300], ['0.12', 1500, 260], ['0.57', 1320, 820], ['0.08', 700, 860], ['0.71', 1680, 560], ['0.36', 980, 230]];
function brainDoodle(x, y, s) {
  const P = (pts) => pts.map(([u, v]) => [x + u * s, y + v * s]);
  const out = smooth(P([[-78, 8], [-82, -26], [-60, -56], [-24, -72], [14, -72], [50, -58], [76, -30], [80, 4], [66, 22], [40, 26], [34, 44], [12, 48], [-10, 36], [-44, 36], [-68, 28]]));
  const cereb = smooth(P([[30, 26], [62, 22], [72, 36], [60, 52], [36, 52], [26, 40]]));
  const folds = [
    [[-66, -20], [-48, -34], [-50, -50], [-30, -58]], [[-20, -64], [-14, -46], [4, -52], [10, -66]], [[22, -60], [26, -40], [46, -44], [52, -54]],
    [[60, -34], [52, -16], [68, -6]], [[-70, 0], [-50, -8], [-40, 8], [-22, -2]], [[-34, -30], [-16, -24], [-6, -36], [12, -30], [22, -18]],
    [[30, -24], [44, -14], [38, 0], [54, 6]], [[-8, -12], [2, 2], [18, -4], [24, 10]], [[-56, 22], [-40, 16], [-24, 26], [-8, 18], [6, 28]],
  ];
  return group('brain', [
    fill(cereb, 'fills.2', { finish: true }), stroke(cereb, 'chalk', { w: 3, seed: 614 }),
    stroke(curve(P([[4, 30], [14, 58], [8, 84]])), 'chalk', { w: 7, seed: 612 }),
    fill(out, 'fills.2', { finish: true }), stroke(out, 'chalk', { w: 3.6, seed: 610 }),
    stroke({ sub: folds.map((f) => ({ pts: splineFlat(P(f)), closed: false })), box: [x - 80 * s, y - 72 * s, 160 * s, 110 * s] }, 'chalk', { w: 2.6, seed: 611 }),
    stroke({ sub: [{ pts: splineFlat(P([[34, 44], [44, 36], [58, 40]])), closed: false }], box: [x, y, 1, 1] }, 'chalk', { w: 2, seed: 615 }),
  ]);
}
const splineFlat = (pts) => curve(pts, 5).sub[0].pts;
// Bit, small, in the corner of the dark page: the one we are inside, with a dashed cone out to the network.
const BIT_E = [240, FLOOR - 12, 110];
function drawE({ T, look }) {
  const bl = ramp(0.2, 1.3, T, ease.in);
  const inside = [
    night(),
    meta('anchor', { name: 'net' }), meta('anchor', { name: 'brain' }), meta('anchor', { cel: 'bit' }),
    // a faint blueprint grid on the dark page
    stroke({ sub: [...Array.from({ length: 26 }, (_, j) => ({ pts: [0, 40 + j * 40, W, 40 + j * 40], closed: false })), ...Array.from({ length: 48 }, (_, j) => ({ pts: [40 + j * 40, 0, 40 + j * 40, H], closed: false }))], box: [0, 0, W, H] }, 'chalkDim', { w: 1, wobble: 0, alpha: 0.13, seed: 600, name: 'grid' }),
    ...heading('3. inside Bit', T - 1.3, { at: 0.15 }).map((op) => op && recolourOp(op)),
    // "Not a tiny brain."
    T > EI('not') - 0.1 && T < E_SIG + 0.3 && popIn(spring(T, EI('not') - 0.1, 0.35) * (1 - ramp(E_SIG, E_SIG + 0.3, T)), 960, 560, group('brainBox', [
      brainDoodle(960, 560, 2.1),
      crossMark([960, 540], ramp(EI('brain') + 0.15, EI('brain') + 0.45, T), { size: 300, role: 'accents.0', w: 10, seed: 613 }),
    ])),
    // "Just numbers."
    ...NUMBERS.map(([n, x, y], j) => {
      const t0 = EI('just') + j * 0.1, u = spring(T, t0, 0.3), fly = ramp(ES('numbers') - 0.2, ES('numbers') + 0.4, T, ease.in);
      if (T < t0 || fly >= 1) return null;
      const tx = LAYERS[0][j % 6][0], ty = LAYERS[0][j % 6][1], px = x + (tx - x) * fly, py = y + (ty - y) * fly + Math.sin(T * 2 + j) * 6 * (1 - fly);
      return popIn(u, px, py, handText(n, px, py + 18, { size: 50, align: 'center', role: j % 2 ? 'fills.0' : 'chalk', ink2: null, w: 3, seed: 620 + j }));
    }),
    // the picture, as pixels, as numbers
    zoomed(T, [T > ES('picture') - 0.1 && popIn(spring(T, ES('picture') - 0.1, 0.35), PIC[0] + 104, PIC[1] + 104, group('picture', [
      fill(rect(PIC[0] - 10, PIC[1] - 10, PIC[2] * 8 + 20, PIC[2] * 8 + 20), 'night'),
      ...PIX.flatMap((row, r) => [...row].map((v, c) => fill(rect(PIC[0] + c * PIC[2] + 1, PIC[1] + r * PIC[2] + 1, PIC[2] - 2, PIC[2] - 2), +v === 3 ? 'fills.0' : +v === 2 ? 'fills.2' : 'chalk', { alpha: [0.08, 0.75, 0.9, 1][+v] * ramp(ES('goes') + r * 0.05, ES('goes') + 0.3 + r * 0.05, T, (u) => u) }))),
      stroke(rect(PIC[0] - 10, PIC[1] - 10, PIC[2] * 8 + 20, PIC[2] * 8 + 20), 'chalk', { w: 2.6, seed: 630 }),
    ])),
    T > ES('numbers') && arrowTo([PIC[0] + PIC[2] * 8 + 14, PIC[1] + PIC[2] * 4, 1, 1], [LAYERS[0][0][0] - 30, 560, 1, 1], { p: ramp(ES('numbers'), ES('numbers') + 0.35, T), role: 'fills.0', w: 3.4, curve: 0, seed: 631 }),
    network(T)]),
    galaxy(T),
    // Bit in the corner and the cone out of its screen
    T > 1.3 && group('bitCorner', [
      stroke({ sub: [{ pts: [BIT_E[0] + 20, BIT_E[1] - 150, 560, 260], closed: false }, { pts: [BIT_E[0] + 20, BIT_E[1] - 120, 560, 880], closed: false }], box: [BIT_E[0], 260, 560 - BIT_E[0], 620] }, 'chalkDim', { w: 1.8, dash: [10, 10], alpha: 0.6 * ramp(1.3, 1.8, T), seed: 632, name: 'cone' }),
      onFloor(BIT, BIT_E[0], BIT_E[2], { ...BIT.idle(T, 8), eye: T < E_SIG ? 'wide' : 'open', bulb: T > ES('listens') ? 'on' : 'off' }, { shadow: 0 }),
    ]),
  ];
  if (bl >= 1) return inside;
  // the page before, with the dark growing out of Bit's screen
  return [
    ...drawD({ ...arguments[0], T: PAGE_D.dur - 1 / FPS }),
    fx('blot', { p: bl, x: BLOT_AT[0], y: BLOT_AT[1], reach: 2300 }, [fill(rect(0, 0, W, H), 'night', { name: 'dark' }), ...inside.slice(1)], { seed: 640 }),
  ];
}
// The heading on the dark page is written in yellow chalk, not red ink.
function recolourOp(op) {
  if (!op || typeof op !== 'object') return op;
  if (Array.isArray(op)) return op.map(recolourOp);
  const o = { ...op };
  if (o.role === RED) o.role = 'fills.0';
  if (o.kids) o.kids = o.kids.map(recolourOp);
  return o;
}
function network(T) {
  const on = ramp(ES('flow') - 0.1, ES('flow') + 1.4, T, (u) => u);             // the lines drawn on
  if (on <= 0) return null;
  const strong = ramp(ES('strongly') - 0.2, ES('strongly') + 0.6, T);            // the lines show their weights
  const tune = ramp(EB('every') - 0.4, EB('dial') + 0.3, T);                     // every dial turned
  const out = ramp(ES('listens'), ES('listens') + 0.5, T);                        // the answer
  const wAt = (k) => LINKS[k].w + Math.sin(k * 3.1) * 0.35 * tune;
  const lines = LINKS.map((L, k) => {
    const shown = ramp(L.l * 0.35 + (L.i / 6) * 0.2, L.l * 0.35 + 0.5, on * 1.4, (u) => u);
    if (shown <= 0) return null;
    const wv = wAt(k), wide = 1.2 + strong * Math.abs(wv) * 4.2;
    return stroke(line(L.a[0], L.a[1], L.a[0] + (L.b[0] - L.a[0]) * shown, L.a[1] + (L.b[1] - L.a[1]) * shown), wv > 0 || strong < 0.5 ? 'chalk' : 'fills.2', { w: wide, wobble: 0.4, alpha: 0.35 + 0.45 * strong * Math.abs(wv), seed: 650 + k, name: 'link' });
  });
  // pulses: bright dots running along the lines, a wave a layer at a time
  const pulses = on >= 1 ? LINKS.filter((L, k) => k % 3 === 0).map((L, k) => {
    const u = ((twos(T) * 0.9 + L.ph + L.l * 0.33) % 1);
    return fill(circle(L.a[0] + (L.b[0] - L.a[0]) * u, L.a[1] + (L.b[1] - L.a[1]) * u, 6, 10), 'fills.0', { alpha: 0.9, name: 'pulse' });
  }) : [];
  const dials = DIALED.map((k, j) => {
    const L = LINKS[k], t0 = ES('dial') - 0.1 + j * 0.07, u = spring(T, t0, 0.3);
    if (u <= 0) return null;
    const mx = (L.a[0] + L.b[0]) / 2, my = (L.a[1] + L.b[1]) / 2, a = wAt(k) * 2.2;
    return popIn(u, mx, my, group('dial', [
      fill(circle(mx, my, 15, 20), 'fills.0'), stroke(circle(mx, my, 15, 20), 'ink', { w: 2.4, seed: 700 + j }),
      stroke(line(mx, my, mx + Math.sin(a) * 12, my - Math.cos(a) * 12), 'ink', { w: 3.4, wobble: 0, seed: 710 + j }),
    ]));
  });
  const nodes = LAYERS.flatMap((layer, l) => layer.map(([x, y], i) => {
    const t0 = ES('flow') - 0.1 + l * 0.35 + i * 0.04, u = spring(T, t0, 0.3);
    if (u <= 0) return null;
    const lit = l === 3 ? (i === 0 ? out : 0) : on >= 1 ? +(Math.sin(twos(T) * 5 + i * 1.7 + l * 2.3) > 0.2) * 0.9 : 0;
    const R = l === 3 ? 30 : 22;
    return popIn(u, x, y, group('switch', [
      fill(circle(x, y, R, 28), 'night'),
      lit > 0 && fill(circle(x, y, R, 28), 'fills.0', { alpha: 0.85 * lit }),
      stroke(circle(x, y, R, 28), 'chalk', { w: 3, seed: 720 + l * 10 + i }),
    ]));
  }));
  const [ox, oy] = LAYERS[3][0], [dx, dy] = LAYERS[3][1];
  const labels = on >= 1 ? [
    handText('cat', ox + 60, oy + 16, { size: 56, role: out > 0 ? 'fills.0' : 'chalk', ink2: null, w: 3.4, seed: 730 }),
    handText('dog', dx + 60, dy + 16, { size: 56, role: 'chalk', ink2: null, w: 3.4, seed: 731 }),
    out > 0 && popIn(spring(T, ES('listens') + 0.2, 0.3), ox + 250, oy - 8, handText('97%', ox + 250, oy + 12, { size: 48, align: 'center', role: 'fills.0', ink2: null, w: 3.4, seed: 732 })),
  ] : [];
  return group({ name: 'net', box: [540, 300, 1300, 520], cache: 'never' }, [...lines, ...pulses, ...dials, ...nodes, ...labels]);
}
// Out to billions: the picture and the network shrink into the middle of the page...
const ZC = [1000, 560];
const zoomOf = (T) => ramp(EB('todays') - 0.1, EB('billions') + 0.3, T, ease.io);
function zoomed(T, kids) {
  const z = zoomOf(T);
  return z <= 0 ? kids : place(ZC[0], ZC[1], { scale: 1 - 0.86 * z }, place(-ZC[0], -ZC[1], kids));
}
// ...and a field of switches opens out round it, each wired to its nearest neighbours, twinkling.
const GALAXY = (() => {
  const r = rng(770), pts = [];
  while (pts.length < 420) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 1050, x = ZC[0] + Math.cos(a) * d * 1.05, y = ZC[1] + Math.sin(a) * d * 0.56;
    if (x < 175 || x > W - 25 || y < 150 || y > H - 25 || d < 150) continue;
    pts.push({ x, y, d, big: r() < 0.12, tw: r() });
  }
  const links = [];
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => [j, (q.x - p.x) ** 2 + (q.y - p.y) ** 2]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2);
    near.forEach(([j]) => { if (j > i) links.push([i, j]); else if (!near.some(([k]) => k === i)) links.push([j, i]); });
  });
  return { pts, links };
})();
function galaxy(T) {
  const z = zoomOf(T);
  if (z <= 0) return null;
  const R = 150 + z * 1100, seen = (p) => p.d < R;
  const lines = GALAXY.links.filter(([i, j]) => seen(GALAXY.pts[i]) && seen(GALAXY.pts[j]));
  const blink = Math.floor(T * 6);
  return group({ name: 'galaxy', cache: 'never' }, [
    stroke({ sub: lines.map(([i, j]) => ({ pts: [GALAXY.pts[i].x, GALAXY.pts[i].y, GALAXY.pts[j].x, GALAXY.pts[j].y], closed: false })), box: [0, 0, W, H] }, 'chalk', { w: 1.3, wobble: 0.2, alpha: 0.4, seed: 771, name: 'wires' }),
    ...GALAXY.pts.filter(seen).map((p, k) => fill(circle(p.x, p.y, p.big ? 5.5 : 3.2, 10), p.big || (k + blink) % 9 === 0 ? 'fills.0' : 'chalk', { alpha: p.big ? 0.95 : 0.8, name: 'switch' })),
    T > EB('billions') + 0.1 && popIn(spring(T, EB('billions') + 0.1, 0.4), 1000, 950, group('billionsWord', [
      fill(roundRect(800, 880, 400, 100, 20), 'night'),
      handText('billions', 1000, 955, { size: 92, align: 'center', role: 'fills.0', ink2: null, w: 5, seed: 790 }),
    ])),
  ]);
}

// ---------- page F: 4. words (the library, then a page turned to the game) ----------

const F_LIB = 0.7;                                           // ai-library
const FL = (w, n = 0) => F_LIB + word('ai-library', w, n);
const PAGE_F1 = { dur: g(F_LIB + said('ai-library') + 0.7) };
const BIT_F = 380, SAM_F = 640;
// The library: towers of books, stacked from the floor, shooting up past the top of the page on "gigantic".
const TOWERS = (() => {
  const r = rng(900), roles = ['fills.0', 'fills.1', 'fills.2', 'fills.3', 'fills.4', 'fills.5', 'accents.1', 'accents.2', 'accents.3', 'accents.0'];
  return [880, 1060, 1235, 1410, 1585, 1760].map((x, k) => {
    const books = [];
    let y = FLOOR;
    while (y > -40) {
      const h = 20 + Math.floor(r() * 16), w = 150 + Math.floor(r() * 60), dx = (r() - 0.5) * 18;
      books.push({ x: x + dx, y: y - h, w, h, role: roles[Math.floor(r() * roles.length)], band: r() < 0.6, seed: 910 + k * 100 + books.length });
      y -= h;
    }
    return { x, books, t0: FL('read') - 0.3 + k * 0.08 };
  });
})();
function book(b, alpha = 1) {
  const p = roundRect(b.x - b.w / 2, b.y, b.w, b.h, 3);
  return group('book', [
    fill(p, 'paper'), fill(p, b.role, { alpha }),
    b.band && fill(rect(b.x - b.w / 2 + 14, b.y + 3, 10, b.h - 6), 'light', { alpha: 0.8 }),
    b.band && fill(rect(b.x + b.w / 2 - 24, b.y + 3, 10, b.h - 6), 'light', { alpha: 0.8 }),
    stroke(line(b.x - b.w / 2 + 40, b.y + b.h / 2, b.x + b.w / 2 - 44, b.y + b.h / 2), { base: 'ink', alpha: 0.4 }, { w: 1.6, wobble: 0.3, seed: b.seed }),
    stroke(p, 'ink', { w: 2, wobble: 0.3, seed: b.seed + 1 }),
  ]);
}
// How far up each tower has been stacked at T: the first few books on "library", all of them by "more".
function towerAt(tw, T) {
  const u = ramp(tw.t0, FL('gigantic') + 0.9, T, (v) => v), n = Math.floor(tw.books.length * (0.12 + 0.88 * Math.pow(u, 1.6)));
  return T < tw.t0 ? 0 : Math.max(1, n);
}
// Pages flying off the towers into Bit's screen while it reads.
const SHEETS = (() => {
  const r = rng(950), out = [];
  for (let j = 0; j < 18; j++) out.push({ t: FL('read') + 0.2 + j * 0.28, x: 820 + r() * 1000, y: 250 + r() * 500, rot: r() * 6, seed: 951 + j });
  return out;
})();
function sheetFlying(sh, T, to) {
  const u = ramp(sh.t, sh.t + 0.9, T, ease.io);
  if (u <= 0 || u >= 1) return null;
  const x = sh.x + (to[0] - sh.x) * u, y = sh.y + (to[1] - sh.y) * u - Math.sin(u * Math.PI) * 140, s = 1.5 - 1.1 * u;
  return place(x, y, { rot: sh.rot * (1 - u) + (u - 0.5), scale: s }, group('sheet', [
    fill(rect(-24, -30, 48, 60), 'light'), stroke(rect(-24, -30, 48, 60), { base: 'ink', alpha: 0.6 }, { w: 1.4, seed: sh.seed }),
    stroke({ sub: [0, 1, 2, 3].map((k) => ({ pts: [-14, -16 + k * 10, 14 - (k === 3) * 12, -16 + k * 10], closed: false })), box: [-14, -16, 28, 30] }, { base: 'ink', alpha: 0.5 }, { w: 1.4, seed: sh.seed + 1 }),
  ]));
}
// Sam's one book, open, held in the right hand.
const OPEN_BOOK = group('openBook', [
  fill(poly([[0, 0], [-56, -10], [-58, 44], [0, 52]], true), 'light'), fill(poly([[0, 0], [56, -10], [58, 44], [0, 52]], true), 'light'),
  fill(poly([[0, 4], [-60, -8], [-62, 48], [0, 58], [62, 48], [60, -8]], true), 'fills.1', { alpha: 0.9 }),
  fill(poly([[0, 0], [-56, -10], [-58, 44], [0, 52]], true), 'light'), fill(poly([[0, 0], [56, -10], [58, 44], [0, 52]], true), 'light'),
  stroke(poly([[0, 0], [-56, -10], [-58, 44], [0, 52], [58, 44], [56, -10]], true), 'ink', { w: 2.2, seed: 960 }),
  stroke(line(0, 0, 0, 52), 'ink', { w: 2, seed: 961 }),
  stroke({ sub: [0, 1, 2].flatMap((k) => [{ pts: [-46, 6 + k * 11, -10, 10 + k * 11], closed: false }, { pts: [10, 10 + k * 11, 46, 6 + k * 11], closed: false }]), box: [-46, 6, 92, 34] }, { base: 'ink', alpha: 0.5 }, { w: 1.4, seed: 962 }),
]);
const SAM_BOOK = attach(SAM, 'hand-r', place(0, -26, { scale: 0.8 }, OPEN_BOOK), { level: true, s: SS });
const SAM_F1 = perform(SAM, [
  [0, stand(SAM, { ...SAM.rest, ...SAM.look(0), 'arm-r': -40, 'fore-r': -70, 'arm-l': 10, head: 10, eye: 'half' })],
  [FL('you') - 0.2, { ...SAM.look(0), head: -12, eye: 'wide', 'pupil.y': -3, 'pupil.x': 3, mouth: 1 }, { dur: 0.35, anticipate: 0.1 }],
]);
function drawF1({ T, look }) {
  const bs = bitScreen(BIT_F), to = [bs.cx, bs.cy];
  const reading = T > FL('read') && T < SHEETS.at(-1).t + 0.9;
  const bit = { ...BIT.idle(T, 11), eye: T < FL('chatbots') + 0.4 ? 'open' : reading ? (Math.floor(T * 6) % 4 === 0 ? 'half' : 'wide') : 'happy', bulb: reading ? 'on' : 'off', 'dial-1': Math.round(T * 60) % 360 - 180, 'dial-2': -(Math.round(T * 44) % 360) + 180, 'dial-3': Math.round(T * 80) % 360 - 180 };
  return [
    paper(),
    meta('anchor', { cel: 'bit' }),
    ...FURNITURE.f(),
    ...heading('4. words', T),
    stroke(line(200, FLOOR + 2, 1860, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 902, name: 'floor' }),
    // "but with words": the air fills with lines of writing, before the books arrive
    T > FL('with') - 0.1 && T < FL('read') + 0.6 && group('scribbles', [0, 1, 2, 3].map((k) => {
      const u = spring(T, FL('with') - 0.1 + k * 0.12, 0.3) * (1 - ramp(FL('read'), FL('read') + 0.5, T));
      const [x, y] = [[760, 330], [1250, 250], [1500, 470], [1000, 560]][k];
      return u > 0 && popIn(u, x + 110, y + 40, squiggleWords([x, y, 230, 80], 970 + k));
    })),
    ...TOWERS.flatMap((tw) => tw.books.slice(0, towerAt(tw, T)).map((b) => book(b))),
    ...SHEETS.map((sh) => sheetFlying(sh, T, to)),
    onFloor(SAM, SAM_F, SS, { ...SAM_F1.state(T), props: [SAM_BOOK] }),
    onFloor(BIT, BIT_F, BS, bit),
    T > FL('chatbots') + 0.3 && popIn(spring(T, FL('chatbots') + 0.3, 0.35), BIT_F, 520, group('typing', [
      bubble([BIT_F - 85, 470, 170, 90], [BIT_F + 10, 590], { seed: 980, w: 3 }),
      ...[0, 1, 2].map((j) => fill(circle(BIT_F - 40 + j * 40, 516, 9, 12), 'inks.2', { alpha: 0.35 + 0.65 * +(Math.floor(T * 6) % 3 === j) })),
    ])),
  ];
}
// Illegible handwriting in a box: rows of little loops, like lines of a book seen from far off.
function squiggleWords([x, y, w, h], seed) {
  const r = rng(seed), rows = [];
  for (let k = 0; k < 3; k++) {
    const pts = [], yy = y + 16 + k * 26;
    let xx = x;
    while (xx < x + w - (k === 2 ? 80 : 0)) {
      const len = 20 + r() * 40;
      for (let s = 0; s < len; s += 5) pts.push([xx + s, yy + Math.sin((xx + s) * 0.45) * 6 * (0.6 + r() * 0.4)]);
      xx += len + 14;
      pts.push(null);
    }
    let cur = [];
    for (const p of pts) { if (p) cur.push(p); else { if (cur.length > 1) rows.push({ pts: cur.flat(), closed: false }); cur = []; } }
  }
  return stroke({ sub: rows, box: [x, y, w, h] }, 'inks.2', { w: 2.4, wobble: 0.4, seed, name: 'squiggle' });
}

// The game, on the next page: guess the next word.
const F_GAME = 0.6;                                          // ai-game
const FG = (w, n = 0) => F_GAME + word('ai-game', w, n);
const PAD_IN = FG('guess') - 0.1;
const CANDS = [['mat', 64, 'inks.3'], ['sofa', 21, 'inks.2'], ['moon', 1, 'inks.1']];
const BARS = CANDS.map((_, j) => PAD_IN + 0.5 + j * 0.3);
const CHOSEN = BARS.at(-1) + 0.9;
const F_ANS = g(CHOSEN + 1.0);                               // ai-answer
const FA = (w, n = 0) => F_ANS + word('ai-answer', w, n);
const NEXT = [FA('and') - 0.35, FA('write') + 0.1, FA('answer') - 0.05];   // each next word guessed and written
const SAY_BUBBLE = FA('one') - 0.1;
const PAGE_F2 = { dur: g(F_ANS + said('ai-answer') + 1.0) };
const SENT = { x: 270, y: 330, size: 104, gap: 30 };
const SENT_WORDS = ['the', 'cat', 'sat', 'on', 'the'];
const MORE = [{ w: 'mat', t: CHOSEN + 0.35 }, { w: 'and', t: NEXT[0] + 0.3, line: 1 }, { w: 'fell', t: NEXT[1] + 0.3 }, { w: 'asleep.', t: NEXT[2] + 0.3 }];
// Where each word of the sentence sits: line 0 across the top, line 1 under it.
const SLOTS = (() => {
  const out = [];
  let x = SENT.x, y = SENT.y;
  [...SENT_WORDS, ...MORE.map((m) => m.w)].forEach((wd, j) => {
    if (MORE[j - SENT_WORDS.length]?.line) { x = SENT.x + 60; y = SENT.y + 150; }
    out.push({ w: wd, x, y, width: measure(wd, SENT.size) });
    x += measure(wd, SENT.size) + SENT.gap;
  });
  return out;
})();
const BLANK = SLOTS[SENT_WORDS.length];
const PAD = [620, 470, 520];                                  // the guess pad: a sticky note of bars
function guessPad(T) {
  const u = spring(T, PAD_IN, 0.35), off = ramp(CHOSEN + 0.5, CHOSEN + 1.0, T, ease.in);
  if (u <= 0 || off >= 1) return null;
  const [px, py, s] = PAD;
  const kids = [
    ...CANDS.flatMap(([wd, pct, role], j) => {
      const y = 110 + j * 130, grow = ramp(BARS[j], BARS[j] + 0.45, T, ease.out), bw = Math.max(8, (s - 250) * pct / 64) * grow;
      return [
        (j > 0 || T < CHOSEN) && handText(wd, 30, y + 16, { size: 58, role: 'ink', ink2: null, w: 3.2, seed: 990 + j }),
        grow > 0 && fill(roundRect(180, y - 30, bw, 52, 6), role, { finish: true }),
        grow > 0 && stroke(roundRect(180, y - 30, bw, 52, 6), 'ink', { w: 2.4, seed: 993 + j }),
        grow > 0.6 && (j > 0 || T < CHOSEN) && handText(`${pct}%`, 180 + bw + 16, y + 12, { size: 40, role: 'ink', ink2: null, seed: 996 + j }),
      ];
    }),
    T > CHOSEN - 0.1 && circleAround([20, 60, 130, 80], ramp(CHOSEN - 0.1, CHOSEN + 0.2, T), { role: 'inks.1', w: 4, seed: 999 }),
  ];
  return place(px - off * 200, py + off * 900, { rot: 0 }, popIn(u, s / 2, s / 2, stickyNote(0, 0, s, 1000, kids)));
}
// A little guess pad for each next word: three bars, the tallest taken, gone in a moment.
function miniPad(T, t0, j) {
  const u = spring(T, t0, 0.2), off = ramp(t0 + 0.3, t0 + 0.55, T, ease.in);
  if (u <= 0 || off >= 1) return null;
  const x = 1080 + j * 230, y = 560, r = rng(1010 + j), hs = [0.9, 0.3 + r() * 0.3, 0.1 + r() * 0.2];
  return place(x, y + off * 700, {}, popIn(u, 130, 130, stickyNote(0, 0, 260, 1020 + j, [
    ...hs.map((h, k) => fill(rect(44 + k * 64, 214 - h * 160, 46, h * 160), k ? 'inks.2' : 'inks.3', { finish: true })),
    ...hs.map((h, k) => stroke(rect(44 + k * 64, 214 - h * 160, 46, h * 160), 'ink', { w: 2, seed: 1035 + j * 3 + k })),
    stroke(line(30, 214, 232, 214), 'ink', { w: 2.4, seed: 1030 + j }),
  ])));
}
function drawF2({ T, look }) {
  const talking = T > SAY_BUBBLE;
  const bit = { ...BIT.idle(T, 12), eye: T < PAD_IN ? 'open' : T < CHOSEN + 0.2 ? 'half' : 'happy', 'brow-l': T > PAD_IN && T < CHOSEN ? -8 : 0, bulb: T > CHOSEN ? 'on' : 'off', head: T > PAD_IN && T < CHOSEN ? 8 : 0 };
  const sentence = [
    ...SENT_WORDS.map((wd, j) => handText(wd, SLOTS[j].x, SLOTS[j].y, { size: SENT.size, role: 'ink', ink2: null, w: 4, seed: 1040 + j })),
    ...MORE.map((m, j) => T > m.t && reveal(ramp(m.t, m.t + 0.3, T, (v) => v), handText(m.w, SLOTS[SENT_WORDS.length + j].x, SLOTS[SENT_WORDS.length + j].y, { size: SENT.size, role: j ? 'ink' : 'inks.3', ink2: null, w: 4, seed: 1050 + j }))),
  ];
  const sw = reveal(ramp(0.2, 0.9, T, (v) => v), group('sentenceStart', sentence.slice(0, SENT_WORDS.length)));
  const blankOn = T < MORE[0].t + 0.2;
  const b = bounds([group('sentence', sentence)]) ?? [SENT.x, SENT.y - 80, 1000, 120];
  return [
    paper(),
    meta('anchor', { cel: 'bit' }),
    ...FURNITURE.f(),
    ...heading('4. words', 0.2 + T, { at: 0 }),
    stroke(line(200, FLOOR + 2, 1860, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 1060, name: 'floor' }),
    talking && reveal(ramp(SAY_BUBBLE, SAY_BUBBLE + 0.6, T, (v) => v), bubble([SENT.x - 60, SENT.y - 130, 1520, 330], [BIT_F + 70, FLOOR - 390], { seed: 1061, w: 3.4 })),
    sw, ...sentence.slice(SENT_WORDS.length),
    blankOn && stroke(line(BLANK.x, BLANK.y + 12, BLANK.x + 230, BLANK.y + 12), 'inks.1', { w: 4, dash: [18, 12], seed: 1062, name: 'blank' }),
    blankOn && T > FG('guess') && T < CHOSEN && question([BLANK.x + 115, BLANK.y - 40], 90, ramp(FG('guess'), FG('guess') + 0.3, T), { role: 'inks.1', seed: 1063 }),
    guessPad(T),
    // the chosen word flies up out of the pad into the blank
    T > CHOSEN && T < MORE[0].t && (() => { const u = ramp(CHOSEN, MORE[0].t, T, (v) => v), x0 = PAD[0] + 30 + measure('mat', 58) / 2, x1 = BLANK.x + BLANK.width / 2, x = x0 + (x1 - x0) * ease.out(u), y = PAD[1] + 126 + (BLANK.y - PAD[1] - 126) * ease.in(u); return handText('mat', x, y, { size: 58 + 46 * u, align: 'center', role: 'inks.3', ink2: null, w: 3.4, seed: 1064 }); })(),
    ...NEXT.map((t, j) => miniPad(T, t, j)),
    onFloor(BIT, BIT_F, BS, { ...bit, ...BIT.mouth('bit-dog', -1, 0) }),
    T > PAD_IN && T < CHOSEN + 0.3 && popIn(spring(T, PAD_IN, 0.3), BIT_F + 100, 540, group('thinking', [0, 1, 2].map((j) => fill(circle(BIT_F + 70 + j * 34, 560 - j * 26, 7 + j * 4, 14), 'light')).concat([0, 1, 2].map((j) => stroke(circle(BIT_F + 70 + j * 34, 560 - j * 26, 7 + j * 4, 14), 'ink', { w: 2, seed: 1065 + j }))))),
  ];
}

// ---------- page G: 5. check it ----------

const G_CATCH = 0.6;                                         // ai-catch
const GC = (w, n = 0) => G_CATCH + word('ai-catch', w, n);
const Q_TYPE = [GC('heres') + 0.1, GC('chatbot') - 0.1];     // Sam's question typed
const BIT_ANS = g(G_CATCH + said('ai-catch') + 0.3);        // bit-wrong
const BA = (w, n = 0) => BIT_ANS + word('bit-wrong', w, n);
const FOX_PEEK = g(BIT_ANS + said('bit-wrong') + 0.15);
const FOX_FAM = g(FOX_PEEK + 0.45);                         // fox-family
const FF = (w, n = 0) => FOX_FAM + word('fox-family', w, n);
const CHAT_OUT = g(FOX_FAM + said('fox-family') + 0.45);
const G_FRIEND = g(CHAT_OUT + 0.7);                          // ai-friend
const GF = (w, n = 0) => G_FRIEND + word('ai-friend', w, n);
const G_FIN = g(G_FRIEND + said('ai-friend') + 0.3);
const FOX_CARDS = [0, 1, 2].map((j) => G_FIN + j * 0.3);
const SCAN_G = G_FIN + 1.15;
const SAY_FOX = g(SCAN_G + 0.7);                             // bit-fox
const FINALLY = g(SAY_FOX + said('bit-fox') + 0.3);         // fox-finally
const PAGE_G = { dur: g(FINALLY + said('fox-finally') + 1.5) };
const SAM_G = 380, FOX_G = 1110, BIT_G = 1650;
const CHAT = [560, 190, 880, 600];
const Q_TEXT = handText('is a fox a cat?', CHAT[0] + CHAT[2] - 70, CHAT[1] + 200, { size: 56, align: 'right', role: 'ink', ink2: null, w: 3.2, seed: 1100 });
const A_WORDS = ['Yes!', 'Foxes', 'are', 'small', 'wild', 'cats.'];
const A_AT = [BA('yes'), BA('foxes'), BA('are'), BA('small'), BA('wild'), BA('cats')];
const A_TEXT = handText(A_WORDS.join(' '), CHAT[0] + 70, CHAT[1] + 390, { size: 56, role: 'ink', ink2: null, w: 3.2, seed: 1101 });
const A_X = (() => { let x = CHAT[0] + 70; return A_WORDS.map((wd) => { const at = x; x += measure(wd, 56) + measure(' ', 56); return at; }); })();
const A_EACH = A_WORDS.map((wd, j) => handText(wd, A_X[j], CHAT[1] + 390, { size: 56, role: 'ink', ink2: null, w: 3.2, seed: 1111 + j }));
const Q_BOX = bounds([Q_TEXT]), A_BOX = bounds([A_TEXT]);
// the chat window: a header with Bit's little face, Sam's question on the right, Bit's answer on the left
function chatWindow(T) {
  const [x, y, w, h] = CHAT;
  const qP = ramp(Q_TYPE[0], Q_TYPE[1], T, (v) => v);
  const shown = A_AT.filter((t) => T >= t).length;
  const aText = shown && group('answer', A_EACH.slice(0, shown));
  const struck = ramp(FF('dog'), FF('dog') + 0.35, T);
  const pad = 22, qb = [Q_BOX[0] - pad, Q_BOX[1] - pad, Q_BOX[2] + 2 * pad, Q_BOX[3] + 2 * pad];
  const AB = shown ? bounds([aText]) : A_BOX, ab = [AB[0] - pad, A_BOX[1] - pad, AB[2] + 2 * pad, A_BOX[3] + 2 * pad];
  return group({ name: 'chat', cache: 'never' }, [
    fill(roundRect(x + 10, y + 14, w, h, 30), 'ink', { alpha: 0.12 }),
    fill(roundRect(x, y, w, h, 30), 'light'),
    fill(roundRect(x, y, w, 96, 30), { base: 'fills.1', tint: 0.25 }), fill(rect(x, y + 60, w, 36), { base: 'fills.1', tint: 0.25 }),
    stroke(line(x, y + 96, x + w, y + 96), 'ink', { w: 2.4, seed: 1102 }),
    // Bit's face as the chat's icon
    fill(roundRect(x + 30, y + 22, 64, 52, 10), 'fills.1'), fill(roundRect(x + 38, y + 30, 48, 36, 6), 'night'),
    fill(rect(x + 48, y + 38, 7, 12), 'fills.3'), fill(rect(x + 68, y + 38, 7, 12), 'fills.3'), stroke(roundRect(x + 30, y + 22, 64, 52, 10), 'ink', { w: 2, seed: 1103 }),
    ...[0, 1, 2].map((j) => fill(circle(x + w - 60 + j * 18, y + 48, 5, 10), 'ink', { alpha: 0.5 })),
    // the question, typed, in its bubble
    qP > 0 && fill(roundRect(...qb, 26), { base: 'fills.1', tint: 0.45 }),
    qP > 0 && stroke(roundRect(...qb, 26), 'ink', { w: 2.4, seed: 1104 }),
    qP > 0 && reveal(qP, Q_TEXT),
    qP > 0 && qP < 1 && Math.floor(T * 4) % 2 === 0 && fill(rect(Q_BOX[0] + Q_BOX[2] * qP + 6, Q_BOX[1] - 4, 4, Q_BOX[3] + 8), 'ink'),
    // Bit's answer, a word as each is said, sure of itself
    shown && fill(roundRect(...ab, 26), { base: 'fills.3', tint: 0.45 }),
    shown && stroke(roundRect(...ab, 26), 'ink', { w: 2.4, seed: 1105 }),
    aText,
    shown && T < FF('dog') && starburst([ab[0] - 8, ab[1] + 6], ramp(BA('yes'), BA('yes') + 0.3, T), { n: 7, r: 26, len: 20, role: 'fills.0', w: 3.4, seed: 1106 }),
    struck > 0 && strike(A_BOX, struck, { role: 'inks.1', w: 5, seed: 1107 }),
    struck > 0 && crossMark([ab[0] + ab[2] + 30, ab[1] + ab[3] / 2], ramp(FF('family') - 0.1, FF('family') + 0.2, T), { size: 70, role: 'inks.1', w: 7, seed: 1108 }),
    stroke(roundRect(x, y, w, h, 30), 'ink', { w: 4, seed: 1109 }),
  ]);
}
// The advice, written as it is said, a tick each; a lightbulb over Sam's head for the last.
const ADVICE = [
  { text: 'ask good questions', t: GF('ask') - 0.1 },
  { text: 'check the answers', t: GF('check') - 0.1 },
  { text: 'keep your brain on', t: GF('keep') - 0.1 },
].map((a, j) => ({ ...a, node: handText(a.text, 640, RULE(3 + j * 2), { size: 66, role: 'ink', ink2: null, w: 3.4, seed: 1120 + j }) }));
const ADV_WRITE = (t) => ({ at: t, per: 'word', wps: 4.5, lead: 0.25, exit: 0.3 });
function bulb(x, y, on) {
  const glass = smooth([[0, -58], [34, -46], [42, -14], [26, 14], [18, 34], [-18, 34], [-26, 14], [-42, -14], [-34, -46]]);
  return place(x, y, group('bulb', [
    on > 0 && stroke({ sub: Array.from({ length: 8 }, (_, k) => { const a = -Math.PI + (k / 7) * Math.PI; return { pts: [Math.cos(a) * 58, -14 + Math.sin(a) * 58, Math.cos(a) * (58 + 26 * on), -14 + Math.sin(a) * (58 + 26 * on)], closed: false }; }), box: [-90, -100, 180, 90] }, 'fills.0', { w: 4.4, seed: 1130 }),
    fill(glass, 'paper'), fill(glass, on > 0 ? 'fills.0' : 'light', { finish: on > 0 }),
    stroke(glass, 'ink', { w: 3, seed: 1131 }),
    fill(roundRect(-18, 34, 36, 24, 5), 'shade'), stroke(roundRect(-18, 34, 36, 24, 5), 'ink', { w: 2.4, seed: 1132 }),
    stroke(curve([[-9, 30], [-9, 8], [-4, -4], [0, 6], [4, -4], [9, 8], [9, 30]], 4), 'ink', { w: 2, seed: 1133 }),
  ]));
}
const FOX_PHOTOS = [0, 1, 2].map((j) => polaroid(0, 0, { s: 0.74, labelSize: 60, rot: [-0.14, 0.02, 0.15][j], bg: ['fills.3', 'fills.1', 'fills.0'][j], kids: [FOX.place(0, 88 - 0.86 * 84, 84, stand(FOX, { ...FOX.rest, ...FOX.look([-0.5, 0, 0.5][j]), eye: j === 1 ? 'happy' : 'open' }))], label: 'fox', seed: 1140 + j * 5 }));
const SAM_G_ACT = perform(SAM, [
  [0, SAM_RIGHT],
  [Q_TYPE[0] - 0.2, ['think'], { dur: 0.3 }],
  [FF('dog'), ['facepalm'], { dur: 0.3, anticipate: 0.1 }],
  [G_FRIEND, stand(SAM, { ...SAM.rest, ...SAM.look(1) }), { dur: 0.3 }],
  [GF('friend') - 0.2, ['wave', 'happy'], { dur: 0.3 }],
  [GF('ask') - 0.2, ['present', 'happy'], { dur: 0.3 }],
  [GF('keep') - 0.1, ['point-r'], { dur: 0.25 }],
  [GF('switched'), ['cheer', 'happy'], { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
  [G_FIN - 0.3, ['present', 'happy'], { dur: 0.3 }],
  [FINALLY + 0.2, ['cheer', 'happy'], { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
]);
const BIT_G_ACT = perform(BIT, [
  [0, { ...BIT.rest, eye: 'open', ...BIT.look?.(0) }],
  [BA('yes') - 0.1, { eye: 'star', bulb: 'on', 'arm-l': 150, 'arm-r': -150, head: -6 }, { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
  [BA('cats') + 0.4, { 'arm-l': 0, 'arm-r': 0, head: 0 }, { dur: 0.3 }],
  [FF('dog') + 0.1, { eye: 'wide', bulb: 'off', 'brow-l': -12, 'brow-r': 12 }, { dur: 0.2 }],
  [FF('family') + 0.3, { eye: 'half', head: 10 }, { dur: 0.35 }],
  [GF('clever') - 0.1, { eye: 'happy', head: 0, 'brow-l': 0, 'brow-r': 0 }, { dur: 0.3 }],
  [GF('confidently') - 0.1, { eye: 'star', bulb: 'on', 'arm-l': 90, head: -4 }, { dur: 0.25, overshoot: 0.1 }],
  [GF('ask') - 0.2, { eye: 'open', bulb: 'off', 'arm-l': 0, head: 0 }, { dur: 0.3 }],
  [G_FIN, { eye: 'wide', bulb: 'on' }, { dur: 0.2 }],
  [SAY_FOX, { eye: 'happy', bulb: 'on', 'arm-l': 150, 'arm-r': -150, head: -6 }, { dur: 0.25, anticipate: 0.1, overshoot: 0.12 }],
]);
const FOX_G_ACT = perform(FOX, [
  [0, stand(FOX, { ...FOX.rest, ...FOX.look(-0.5), eye: 'open' })],
  [FF('actually') - 0.1, { ...FOX.look(0), eye: 'sleep', 'brow-l': 8, 'brow-r': -8, head: 6 }, { dur: 0.2 }],
  [FF('dog'), { eye: 'open' }, { dur: 0.15 }],
  [GF('confidently'), ['angry'], { dur: 0.2 }],
  [GF('ask') - 0.2, stand(FOX, { ...FOX.rest, ...FOX.look(-0.5), eye: 'open' }), { dur: 0.3 }],
  [FINALLY - 0.1, ['happy'], { dur: 0.25, anticipate: 0.1 }],
  [FINALLY + 0.4, 'wave', { dur: 0.3 }],
]);
function drawG({ T, look }) {
  const out = ramp(CHAT_OUT, CHAT_OUT + 0.45, T, ease.in);
  // the fox: up behind the window, then down to the floor once it has gone
  const peek = ramp(FOX_PEEK, FOX_PEEK + 0.4, T, ease.out), drop = ramp(CHAT_OUT + 0.2, CHAT_OUT + 0.7, T, (v) => v);
  const behind = [1240, CHAT[1] + 250 + (1 - peek) * 460];
  const fx0 = behind[0] + (FOX_G - behind[0]) * drop, fy = behind[1] + (FLOOR - behind[1]) * drop - Math.sin(drop * Math.PI) * 120;
  const foxSt = { ...FOX.idle(T, 13), ...FOX_G_ACT.state(T), ...FOX.mouth('fox-family', T, FOX_FAM), ...FOX.mouth('fox-finally', T, FINALLY) };
  const fox = T >= FOX_PEEK && [
    drop >= 1 && fill(ellipse(fx0, FLOOR + 4, FS * 0.36, FS * 0.05, 32), 'shade', { alpha: 0.16 }),
    FOX.place(fx0, fy - 0.86 * FS, FS, foxSt),
  ];
  const bitSt = { ...BIT.idle(T, 14), ...BIT_G_ACT.state(T), ...BIT.mouth('bit-wrong', T, BIT_ANS), ...BIT.mouth('bit-fox', T, SAY_FOX) };
  const bs = bitScreen(BIT_G), eye = [bs.cx - bs.w / 2, bs.cy];
  const samSt = { ...SAM_G_ACT.state(T) };
  const lit = ramp(GF('switched'), GF('switched') + 0.25, T);
  return [
    paper(),
    meta('anchor', { cel: 'bit' }),
    ...FURNITURE.g(),
    ...heading('5. check it', T),
    stroke(line(200, FLOOR + 2, 1860, FLOOR + 2), { base: 'ink', alpha: 0.18 }, { w: 2, wobble: 0.8, seed: 1150, name: 'floor' }),
    // the advice
    ...ADVICE.flatMap((a, j) => [
      T > a.t && reveal(ramp(a.t, a.t + 0.3, T), stroke(roundRect(540, RULE(3 + j * 2) - 50, 54, 54, 6), 'ink', { w: 2.8, seed: 1160 + j })),
      T > a.t && writeOn(a.node, { t: T, ...ADV_WRITE(a.t + 0.1) }),
      T > a.t && writer(a.node, T, { ...ADV_WRITE(a.t + 0.1), look }),
      tickMark([567, RULE(3 + j * 2) - 26], ramp(a.t + 0.9, a.t + 1.1, T), { size: 60, role: 'inks.3', w: 5.4, seed: 1165 + j }),
    ]),
    fox && !(drop > 0) && fox,
    out < 1 && T > 0.2 && place(CHAT[0] + CHAT[2] / 2 + out * 900, CHAT[1] + CHAT[3] / 2 - out * 700, { scale: Math.max(0.05, spring(T, 0.2, 0.4) * (1 - 0.7 * out)) }, place(-(CHAT[0] + CHAT[2] / 2), -(CHAT[1] + CHAT[3] / 2), chatWindow(T))),
    fox && drop > 0 && fox,
    T > GF('switched') - 0.3 && popIn(spring(T, GF('switched') - 0.3, 0.35), SAM_G, 420, bulb(SAM_G, 430, lit)),
    // "who's sometimes confidently wrong": Bit, sure it has spotted a cat again
    T > GF('confidently') && T < GF('ask') - 0.2 && popIn(spring(T, GF('confidently'), 0.3), BIT_G - 210, 460, group('sure', [
      bubble([BIT_G - 340, 360, 260, 190], [BIT_G - 90, 600], { kind: 'thought', seed: 1170, w: 3 }),
      place(BIT_G - 210, 540, { scale: 0.62 }, cat({ coat: 0 })),
    ])),
    // the finale: fox photos for Bit to learn from, then the fox itself
    ...FOX_CARDS.map((t, j) => T > t && T < SCAN_G + 1.2 && popIn(spring(T, t, 0.3) * (1 - ramp(SCAN_G + 0.8, SCAN_G + 1.2, T, ease.in)), BIT_G - 220 + j * 170, 360, place(BIT_G - 220 + j * 170, 360 + Math.abs(j - 1) * 24, FOX_PHOTOS[j]))),
    T > SCAN_G && T < SCAN_G + 0.8 && scanBeam(eye, [fx0 - 95, FLOOR - 2 * FS * 0.9, 190, 2 * FS * 0.9], ramp(SCAN_G, SCAN_G + 0.6, T, ease.io)),
    onFloor(SAM, SAM_G, SS, samSt),
    onFloor(BIT, BIT_G, BS, bitSt),
    T > SAY_FOX + 0.4 && popIn(spring(T, SAY_FOX + 0.4, 0.3), fx0 + 230, 620, handText('fox!', fx0 + 230, 640, { size: 84, align: 'center', role: GREEN, ink2: null, w: 5, seed: 1180 })),
    T > FINALLY + 0.2 && starburst([fx0 - 110, 440, 220, 560], ramp(FINALLY + 0.2, FINALLY + 0.6, T), { n: 12, r: 40, len: 36, role: 'fills.0', w: 4, seed: 1181 }),
  ];
}

// ---------- the sign-off, on a fresh page, the three of them waving ----------

const SIGN_LOOK = `notebook~hand:${HAND}`;
const sign = shot('sign', 4, (ctx) => {
  const t = ctx.t;
  return [
    paper(),
    meta('anchor', { name: 'signOff' }),
    marginDoodle('heart', 75, 400, 50, 1201, { role: 'inks.1' }), marginDoodle('star', 75, 800, 52, 1202, { role: 'inks.2' }),
    signOff('stay', 'curious', { x: 960, y: 300, size: 190, pA: ramp(0.15, 1.0, t, (u) => u), pB: ramp(1.0, 1.8, t, (u) => u), ink: 'ink', ink2: 'accents.0' }),
    ...[[SAM, 650, SS * 0.74, 'wave'], [FOX, 960, FS * 0.74, 'wave'], [BIT, 1270, BS * 0.74, 'wave']].map(([A, x, s, p], j) => {
      const u = spring(t, 0.4 + j * 0.15, 0.35), waving = t > 1.2 + j * 0.12 && Math.floor((t - 1.2) * 3 + j) % 2 === 0;
      const face = A === BIT ? { bulb: 'on', eye: 'happy' } : A.emote('happy');
      return u > 0 && popIn(u, x, FLOOR - 150, onFloor(A, x, s, { ...A.idle(t, 20 + j), ...(t > 1.1 + j * 0.12 ? A.pose(p, waving ? 1 : 0.75) : {}), ...face }));
    }),
  ];
}, { recipe: 'S', look: SIGN_LOOK });

// ---------- the timeline ----------

const shotsA = page('a', [['open', 0, PAGE_A.dur]], drawA);
const shotsB = page('b', [['title', 0, BM], ['meet', BM, PAGE_B.dur]], drawB);
const shotsD = page('d', [['examples', 0, D_GUESS], ['guess', D_GUESS, D_DIALS], ['dials', D_DIALS, D_AGAIN], ['again', D_AGAIN, D_PAT], ['pattern', D_PAT, FOX_UP], ['fox again', FOX_UP, PAGE_D.dur]].map(([n, a, b]) => [n, g(a), g(b)]), drawD);
const shotsE = page('e', [['inside', 0, E_SIG], ['signals', E_SIG, E_BIL], ['billions', E_BIL, PAGE_E.dur]].map(([n, a, b]) => [n, g(a), g(b)]), drawE);
const shotsF1 = page('f1', [['library', 0, PAGE_F1.dur]], drawF1);
const shotsF2 = page('f2', [['next word', 0, F_ANS], ['answer', F_ANS, PAGE_F2.dur]].map(([n, a, b]) => [n, g(a), g(b)]), drawF2);
const shotsG = page('g', [['catch', 0, CHAT_OUT + 0.5], ['friend', CHAT_OUT + 0.5, G_FIN - 0.1], ['finally', G_FIN - 0.1, PAGE_G.dur]].map(([n, a, b]) => [n, g(a), g(b)]), drawG);
const shotsC = page('c', [['rules', 0, CAT_IN - 0.2], ['cat test', CAT_IN - 0.2, UNTIL], ['fox', UNTIL, MESSY], ['messy', MESSY, PAGE_C.dur]].map(([n, a, b]) => [n, g(a), g(b)]), drawC);

const timeline = seq(
  ...shotsA,
  cut('flip', 0.5, shotsA.at(-1), shotsB[0]),
  chapterSeq('how does AI learn?', shotsB),
  cut('flip', 0.5, shotsB.at(-1), shotsC[0]),
  chapterSeq('1. rules', shotsC),
  cut('flip', 0.5, shotsC.at(-1), shotsD[0]),
  chapterSeq('2. examples', shotsD.slice(0, 4)),
  chapterSeq('machine learning', shotsD.slice(4)),
  chapterSeq('3. inside Bit', shotsE),
  cut('flip', 0.5, shotsE.at(-1), shotsF1[0]),
  chapterSeq('4. words', [...shotsF1, cut('flip', 0.5, shotsF1.at(-1), shotsF2[0]), ...shotsF2]),
  cut('flip', 0.5, shotsF2.at(-1), shotsG[0]),
  chapterSeq('5. check it', shotsG),
  cut('flip', 0.5, shotsG.at(-1), sign),
  sign,
);

// ---------- score ----------

function score({ shots, cuts, end }) {
  const t0 = (name) => shots.find((s) => s.name === name && !s.cut && !s.hold).t0;
  const PA = t0('open'), PB = t0('title'), PC = t0('rules'), PD = t0('examples'), PE = t0('inside'), PF1 = t0('library'), PF2 = t0('next word'), PG = t0('catch');
  const flips = shots.filter((s) => s.cut).map((s) => s.t0 + s.dur / 2);
  const PE0 = t0('inside'), PF0 = t0('library'), SIGN = t0('sign');
  // a bright bed under the notebook, a mysterious one inside Bit, the bright one back for words and the end
  const b1 = bed({ mood: 'bright', key: 'G', from: 0, to: PE0 + 0.3, gain: 0.05 });
  const b2 = bed({ mood: 'mystery', key: 'E', from: PE0 + 0.3, to: PF0, gain: 0.05, seed: 9 });
  const b3 = bed({ mood: 'bright', key: 'G', from: PF0, to: end, gain: 0.05, seed: 11 });
  return {
    master: 0.6,
    events: [
      b1, b1.stop(PE0 + 0.3), b2, b2.stop(PF0 - 0.25), b3, b3.stop(SIGN), b3.sting(SIGN + 0.1),
      hits(flips, { kind: 'flip' }),
      // page A
      voice('ai-open', PA + A0),
      writerSounds(AI_WORD, { t0: PA, tool: 'pen', ...AI_WRITE }),
      SATS.map((_, j) => pop(PA + AW('everywhere') + 0.1 + j * 0.16, { gain: 0.12 })),
      MAP.map((m) => whoosh(PA + m.t, { dur: 0.35, gain: 0.08 })),
      // page B
      voice('ai-title', PB + B0),
      writerSounds(TITLE, { t0: PB, tool: 'pen', ...TITLE_WRITE }),
      boing(PB + BIT_DROP + 0.32, { gain: 0.12 }),
      SAM_WALK.steps.map((t, j) => note(PB + t, pentHz(0, j % 2 ? 2 : 0), 0.1, 'triangle', 0.05)),
      voice('ai-meet', PB + BM),
      [0, 0.35, 0.7, 1.4, 1.75].map((d) => [0, 0.05, 0.1].map((e) => note(PB + BW('knows') + 0.5 + d + e, 4300, 0.025, 'sine', 0.035))),
      pop(PB + BW('how') - 0.2, { gain: 0.14 }),
      pop(PB + BW('how') + 0.25, { gain: 0.12, hz: 520 }),
      // page C
      voice('ai-rules', PC + C0),
      writerSounds(LIST_TITLE, { t0: PC, tool: 'pen', ...ITEM_WRITE(CW('write') - 0.2) }),
      ITEMS.map((it) => writerSounds(it.node, { t0: PC, tool: 'pen', ...ITEM_WRITE(it.t + 0.1) })),
      [CAT_IN, CAT_IN + 0.4].map((t) => note(PC + t + 0.38, pentHz(1, 3), 0.1, 'triangle', 0.06)),
      [SCAN, SCAN2].map((t) => ({ ...note(PC + t, 700, SCAN_D, 'sine', 0.05), hz1: 1400, glide: 'linear' })),
      [...TICKS_A, ...TICKS_B].map((t) => tick(PC + t, { gain: 0.12 })),
      voice('bit-cat', PC + SAY_CAT), ding(PC + SAY_CAT + 0.5, { gain: 0.16 }),
      voice('ai-until', PC + UNTIL),
      Array.from({ length: LEAPS }, (_, j) => [({ ...note(PC + LEAP_T0 + j * LEAP, pentHz(0, 2 + j), 0.3, 'triangle', 0.06), hz1: pentHz(1, 2 + j), glide: 'exp' }), burst(PC + LEAP_T0 + (j + 1) * LEAP - 0.02, 0.05, 0.05, 870 + j)]),
      voice('bit-cat', PC + SAY_CAT2), ding(PC + SAY_CAT2 + 0.5, { gain: 0.16 }),
      voice('fox-im', PC + FOX_IM),
      voice('ai-messy', PC + MESSY),
      EXCEPTIONS.map((e) => pop(PC + e.t, { gain: 0.12 })),
      squeak(PC + MW('so') - 0.1, { tool: 'pen', dur: 0.5, gain: 0.12 }),
      // page D
      voice('ai-examples', PD + D_EX),
      DEAL.map((c) => [burst(PD + c.t, 0.07, 0.05, 530 + c.j), note(PD + c.t + (c.fast ? 0.18 : 0.3), pentHz(1, c.j % 5), 0.12, 'triangle', 0.05)]),
      voice('ai-guess', PD + D_GUESS),
      voice('bit-cat-q', PD + SAY_Q),
      note(PD + WRONG, 110, 0.35, 'square', 0.05), note(PD + WRONG, 104, 0.35, 'saw', 0.03),
      voice('ai-dials', PD + D_DIALS),
      pop(PD + LENS_IN, { gain: 0.12 }),
      CLICKS.map((t) => [tick(PD + t, { gain: 0.1 }), tick(PD + t + 0.08, { gain: 0.06 })]),
      voice('bit-dog', PD + SAY_DOG), ding(PD + RIGHT, { gain: 0.18 }),
      voice('ai-again', PD + D_AGAIN),
      PRACTICE.map((t, j) => (PRACTICE_OK[j] ? note(PD + t + 0.2, pentHz(2, j % 5), 0.15, 'sine', 0.06) : note(PD + t + 0.2, 130, 0.12, 'square', 0.03))),
      voice('ai-pattern', PD + D_PAT),
      writerSounds(MLW, { t0: PD, tool: 'pen', ...ML_WRITE }),
      tada(PD + DP('learning') + 0.5, { key: 'G', gain: 0.07 }),
      boing(PD + FOX_UP, { gain: 0.1 }), whoosh(PD + FOX_HOP, { dur: 0.35, gain: 0.08 }),
      ({ ...note(PD + SCAN_D2, 700, 0.6, 'sine', 0.05), hz1: 1400, glide: 'linear' }),
      voice('bit-cat91', PD + SAY_91),
      voice('fox-comeon', PD + COMEON),
      voice('ai-shown', PD + SHOWN),
      // page E
      ({ ...note(PE + 0.2, 90, 1.2, 'sine', 0.12), hz1: 45, glide: 'exp' }), burst(PE + 0.2, 1.1, 0.04, 841),
      voice('ai-inside', PE + E_IN),
      pop(PE + EI('not') - 0.1, { gain: 0.12 }), tick(PE + EI('brain') + 0.15, { gain: 0.12 }),
      NUMBERS.map((_, j) => note(PE + EI('just') + j * 0.1, pentHz(2, j % 5), 0.1, 'sine', 0.05)),
      voice('ai-signals', PE + E_SIG),
      LAYERS.map((_, l) => note(PE + ES('flow') - 0.1 + l * 0.35, pentHz(1, l), 0.4, 'sine', 0.06)),
      DIALED.map((_, j) => tick(PE + ES('dial') - 0.1 + j * 0.07, { gain: 0.05 })),
      ding(PE + ES('listens') + 0.1, { gain: 0.14 }),
      voice('ai-billions', PE + E_BIL),
      ({ ...note(PE + EB('todays'), 220, 2.4, 'sine', 0.05), hz1: 880, glide: 'exp' }),
      dyad(PE + EB('billions'), 1.6, { gain: 0.08 }),
      // page F
      voice('ai-library', PF1 + F_LIB),
      TOWERS.map((tw, k) => whoosh(PF1 + tw.t0 + 0.4, { dur: 0.6, gain: 0.04, seed: 850 + k })),
      SHEETS.map((sh, j) => burst(PF1 + sh.t + 0.85, 0.05, 0.03, 860 + j)),
      voice('ai-game', PF2 + F_GAME),
      pop(PF2 + PAD_IN, { gain: 0.12 }),
      BARS.map((t, j) => ({ ...note(PF2 + t, pentHz(1, 0), 0.45, 'triangle', 0.05), hz1: pentHz(1, 4 - j * 2), glide: 'linear' })),
      squeak(PF2 + CHOSEN - 0.1, { tool: 'pen', dur: 0.3, gain: 0.1 }), whoosh(PF2 + CHOSEN, { dur: 0.35, gain: 0.07 }),
      ding(PF2 + MORE[0].t, { gain: 0.14 }),
      voice('ai-answer', PF2 + F_ANS),
      NEXT.map((t, j) => [pop(PF2 + t, { gain: 0.08 }), note(PF2 + t + 0.3, pentHz(2, j + 1), 0.12, 'sine', 0.06)]),
      // page G
      voice('ai-catch', PG + G_CATCH),
      pop(PG + 0.2, { gain: 0.1 }),
      Array.from({ length: 10 }, (_, j) => burst(PG + Q_TYPE[0] + j * (Q_TYPE[1] - Q_TYPE[0]) / 10, 0.03, 0.05, 1190 + j)),
      voice('bit-wrong', PG + BIT_ANS), tada(PG + BA('yes') + 0.05, { key: 'G', gain: 0.05 }),
      boing(PG + FOX_PEEK, { gain: 0.08 }),
      voice('fox-family', PG + FOX_FAM),
      squeak(PG + FF('dog'), { tool: 'pen', dur: 0.35, gain: 0.1 }), note(PG + FF('family'), 110, 0.3, 'square', 0.04),
      whoosh(PG + CHAT_OUT, { dur: 0.4, gain: 0.08 }), boing(PG + CHAT_OUT + 0.7, { gain: 0.08, hz: 120 }),
      voice('ai-friend', PG + G_FRIEND),
      ADVICE.map((a) => [writerSounds(a.node, { t0: PG, tool: 'pen', ...ADV_WRITE(a.t + 0.1) }), tick(PG + a.t + 0.9, { gain: 0.1 })]),
      ding(PG + GF('switched'), { gain: 0.16, hz: pentHz(2, 4) }),
      FOX_CARDS.map((t) => pop(PG + t, { gain: 0.1 })),
      ({ ...note(PG + SCAN_G, 700, 0.6, 'sine', 0.05), hz1: 1400, glide: 'linear' }),
      voice('bit-fox', PG + SAY_FOX), ding(PG + SAY_FOX + 0.5, { gain: 0.16 }),
      voice('fox-finally', PG + FINALLY), tada(PG + FINALLY + 0.7, { key: 'G', gain: 0.08 }),
      // the sign-off
      dyad(t0('sign'), 3.5, { gain: 0.14 }),
    ],
  };
}

export default film({ name: 'how-ai-learns', look: 'notebook', format: '16:9', audience: 'beginner', timeline, score, assets: IDS });

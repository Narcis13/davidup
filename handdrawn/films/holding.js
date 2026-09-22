// HOLDING (4.0 K8): props in sockets. The fox holds the teapot by its handle (its paw's socket), lifts it
// with the pot kept level, tips it and pours into a cup; the stream runs from the spout wherever the paw puts
// it. Then sam writes a sum on a chalkboard with the chalk in its hand: T6's writer schedule moves the pen,
// and held() puts the chalk's end on it, so the arm follows the strokes and lifts between them; sam walks on
// (K5) to write the rest.
//
// Anchor: the fox, then the board. Format 1:1, 12 fps; rose paper, then chalk on navy, the sign-off on the
// whiteboard.
// t      dur   shot    what changes
// 0.00   6.00  pour    the fox lifts the pot (0.5), tips it (1.6), tea pours (2.2 to 4.0), sets it level (4.2), happy
// 6.00   9.00  board   sam writes "1 + 2" (0.4 to 2.6), walks on (2.9 to 4.2), writes "= 3" (4.5), walks off the
//                      sum (6.2 to 7.5) and turns to us, happy (7.9)
// 15.00  2.50  sign    the sign-off (17.5 s in all)
import { film, seq, shot, paper, stroke, fill, line, spline, poly, group, meta, ease, ramp, pin, on, photo, puppet, actorOf, stickSource, perform, walkTo, stand, lookAt, attach, propAt, heldTool, textBox, writeOn, writer, note, pentHz, dyad, plucks, LOOKS, pastel, withLook } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { bounds } from '../core/list.js';
import { CAST } from '../recipes/doodle.js';
import { signOffShot } from '../recipes/shots.js';

const IDS = ['teapot', 'fox'];
const PHOTOS = fromStore(IDS);
const FOX = CAST.FOX;
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const twos = (t) => Math.floor(t * 6 + 1e-9) / 6;

// ---------- pour: the fox pours the teapot it holds ----------
const GROUND = 800, FS = 150, FX = 720, FY = GROUND - 0.86 * FS;
// The pot in stage units, its handle at the origin, the spout forward (+x: the fox's unmirrored front).
const POT = pin(PHOTOS.teapot, { x: 0, y: 0, h: 110, pivot: [0.95, 0.32], flip: true });
const SPOUT = on(POT, 0.005, 0.27);
const face = FOX.look(-1);
const LIFT = [0.5, 1.2], TIP = [1.6, 2.2], BACK = [4.2, 4.8];
// The arm raised forward, the pot kept level in the paw, then tipped about the handle.
const armAt = (t) => Math.round(-84 * ease.io(ramp(LIFT[0], LIFT[1], twos(t))) / 2) * 2;
const tipAt = (t) => 32 * ease.io(ramp(TIP[0], TIP[1], twos(t))) * (1 - ease.io(ramp(BACK[0], BACK[1], twos(t))));
const potIn = (t) => attach(FOX, 'hand-r', photo(POT, { shadow: 0 }), { s: FS, tip: SPOUT, level: true, rot: tipAt(t), name: 'teapot' });
const foxState = (t) => ({ ...face, 'arm-r': armAt(t) });
// Where the spout is with the pot fully tipped: the cup goes under it.
const POURING = propAt(FOX, potIn(3), [FX, FY, FS], foxState(3));
const CUP = [POURING[0] - 18, GROUND - 4], CW = 46;
const peek = lookAt(FOX, [CUP[0], CUP[1] - 60], { at: [FX, FY, FS], state: face, turn: false });
const fox = perform(FOX, [[0, face], [TIP[0], peek, { dur: 0.25 }], [BACK[1], 'happy', { dur: 0.25 }]]);
const POUR = [TIP[1], 4.0];

const cup = (level) => {
  const B = [[-1, -0.9], [1, -0.9], [0.8, -0.2], [0.45, 0], [-0.45, 0], [-0.8, -0.2]].map(([u, v]) => [CUP[0] + u * CW, CUP[1] + v * CW]);
  const tea = level > 0 && [[-0.97, -0.9 * level + 0.02], [0.97, -0.9 * level + 0.02], [0.8, -0.2], [0.45, 0], [-0.45, 0], [-0.8, -0.2]].map(([u, v]) => [CUP[0] + u * CW * (v < -0.2 ? 0.8 + 0.2 * level : 1), CUP[1] + v * CW]);
  return group('cup', [
    fill(poly(B), 'paper', { name: 'china' }),
    tea && fill(poly(tea), 'fills.0', { alpha: 0.85, name: 'tea' }),
    stroke(poly(B), 'ink', { w: 3.2, wobble: 1, seed: 21, name: 'rim' }),
    stroke(spline([[CUP[0] + 0.85 * CW, CUP[1] - 0.72 * CW], [CUP[0] + 1.35 * CW, CUP[1] - 0.6 * CW], [CUP[0] + 0.7 * CW, CUP[1] - 0.25 * CW]], { n: 6 }), 'ink', { w: 3, wobble: 1, seed: 22, name: 'handle' }),
  ]);
};
// The stream: from the spout, falling into the cup, drawn in over two twos and gone after the pour.
const streamOf = (t, spout) => {
  if (t < POUR[0] || t >= POUR[1] + 1 / 6) return null;
  const k = Math.min(1, (twos(t) - POUR[0]) * 3 + 1 / 3), end = [CUP[0], CUP[1] - 0.85 * CW];
  const mid = [spout[0] - 8, spout[1] + (end[1] - spout[1]) * 0.4];
  const fall = [spout, mid, [mid[0] + (end[0] - mid[0]) * k, mid[1] + (end[1] - mid[1]) * k]];
  const wob = Math.round(Math.sin(twos(t) * 17) * 2);
  return stroke(spline(fall.map(([x, y], j) => [x + (j ? wob : 0), y]), { n: 8 }), 'fills.0', { w: 7, wobble: 0.6, seed: 23, name: 'stream' });
};

export const pourShot = shot('pour', 6, ({ t }) => {
  const state = { ...fox.state(t), 'arm-r': armAt(t), tail: FOX.idle(t).tail };
  const pot = potIn(t), spout = propAt(FOX, pot, [FX, FY, FS], state);
  const level = ramp(POUR[0] + 0.25, POUR[1] + 0.1, twos(t)) * 0.8;
  return [
    paper(),
    stroke(line(60, GROUND + 4, 1020, GROUND + 4), 'ink', { w: 3, wobble: 1.5, seed: 11, name: 'ground' }),
    meta('anchor', { cel: 'fox' }),
    cup(level),
    streamOf(t, spout),
    FOX.place(FX, FY, FS, { ...state, props: [pot] }),
  ];
}, { recipe: 'pour', look: pastel(LOOKS.doodlePastel, 'rose') });

// ---------- board: sam writes the sum with the chalk in its hand ----------
const S = 420, FEET = 1010, Y = FEET - 0.86 * S, X1 = 300, X2 = 560, X3 = 820;   // half a stride apart: each walk lands on a contact
const CHALK = attach(SAM, 'hand-r', heldTool({ tool: 'chalk' }), { scale: 0.45 });
const SIZE = 72, ROW = [470, 560];
const partA = textBox('1 + 2', [X1 + 92, ROW[0], 160, ROW[1] - ROW[0]], { size: SIZE, align: 'left', ink2: null, role: 'ink', seed: 31 });
const partB = textBox('= 3', [X2 + 84, ROW[0], 110, ROW[1] - ROW[0]], { size: SIZE, align: 'left', ink2: null, role: 'ink', seed: 32 });
const WRITE_A = { at: 0.4, per: 'word', wps: 1.5 }, WRITE_B = { at: 4.5, per: 'word', wps: 1.5 };
const walk = walkTo(SAM, X1, X2, 2.9, 4.2, { s: S }), away = walkTo(SAM, X2, X3, 6.2, 7.5, { s: S });
const still = stand(SAM, SAM.look(1));
const readA = lookAt(SAM, [X1 + 150, ROW[0] + 50], { at: [X1, Y, S], state: still });
const readB = lookAt(SAM, [X2 + 120, ROW[0] + 50], { at: [X2, Y, S], state: still });
const samA = perform(SAM, [[0, still], [0.2, readA, { dur: 0.25 }]]);
const samB = perform(SAM, [[0, readB]]);
const samC = perform(SAM, [[0, still], [7.9, { ...stand(SAM, SAM.look(-0.5)), ...SAM.emote('happy') }, { dur: 0.25 }]]);
// Where sam is and what it does at t: writing at X1, walking on, writing at X2, walking off the sum, turning.
const walks = [walk, away];
const placeAt = (t) => {
  const w = walks.find((v) => t >= v.t0 && t < v.end + 0.25);
  if (w) return { x: w.x(t), state: w.state(t), walking: true };
  if (t < walk.t0) return { x: X1, state: samA.state(t) };
  return t < away.t0 ? { x: X2, state: samB.state(t) } : { x: X3, state: samC.state(t) };
};

export const boardShot = shot('board', 9, ({ t, look }) => {
  const { x, state, walking } = placeAt(t);
  const nodeOf = t < walk.t0 ? partA : partB, WRITE = t < walk.t0 ? WRITE_A : WRITE_B;
  const board = group({ name: 'board', box: bounds([partA, partB]) }, [writeOn(partA, { t, ...WRITE_A }), writeOn(partB, { t, ...WRITE_B })]);
  return [
    paper(),
    meta('anchor', { name: 'board' }),
    stroke(line(0, FEET + 6, 1080, FEET + 6), 'ink', { w: 3, wobble: 1, seed: 33, name: 'chalk-ledge' }),
    board,
    walking || t >= away.t0
      ? SAM.place(x, Y, S, { ...state, props: [CHALK] })
      : writer(nodeOf, t, { ...WRITE, look, by: { actor: SAM, at: [x, Y, S], state, prop: CHALK } }),
  ];
}, { recipe: 'board', look: withLook(LOOKS.blueprintNight, { words: 8 }) });

const sign = signOffShot({ name: 'sign', a: 'held', b: 'in hand', rings: null });

// A pluck as the pot tips, a run of notes under the pour, taps for the chalk's words and sam's steps.
const score = ({ shots: [p, b, s] }) => ({
  master: 0.45,
  events: [
    note(p.t0 + TIP[0], pentHz(1, 2), 0.3, 'triangle', 0.1),
    ...[0, 1, 2, 3, 4].map((j) => note(p.t0 + POUR[0] + j * 0.35, pentHz(1, 4 - j % 3), 0.2, 'sine', 0.06)),
    note(p.t0 + BACK[1], pentHz(1, 4), 0.35, 'triangle', 0.12),
    ...plucks(b.t0 + WRITE_A.at + 0.3, 2, { every: 1 / WRITE_A.wps }),
    ...[...walk.steps, ...away.steps].map((t, j) => note(b.t0 + t, pentHz(0, j % 2 ? 2 : 0), 0.12, 'triangle', 0.08)),
    ...plucks(b.t0 + WRITE_B.at + 0.3, 1.3, { every: 1 / WRITE_B.wps }),
    ...dyad(s.t0, s.dur),
  ],
});

export default film({ name: 'holding', look: 'whiteboard', timeline: seq(pourShot, boardShot, sign), score, assets: IDS });

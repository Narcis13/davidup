// THE FOX AND THE TEAPOT. The doodle look with a new cast member: the fox from the asset store (a puppet,
// plan 1.2) goes through the recipes the hedgehog was drawn for, through the actor contract (plan 1.3), with
// nothing in the recipes changed but `actor: FOX`. Tea for two, a helmet that is not as empty as it looks,
// the teapot bolts with the light on its back and the fox gives chase on a hobby horse.
// Photos: The Metropolitan Museum of Art, Open Access (CC0); the fox is drawn for handdrawn 3.0 (`hdf find fox`).
//
// Anchor: the photo in each scene, the prints at the end. Format 1:1, drawn 12 fps; the end holds its
// sign-off 1.6 s (lint). The fox has a run cycle, so no fallback bob is ever on screen (lint actor-cycle).
// t      dur   scene  paper  recipe             what changes
// 0.00   3.50  tea    rose   AC doesItsJob      the fox says hello there to the pot, it pours, the fox is happy
// 3.50   3.00  look   rose   AJ looksBack       the helmet's eyes light, it roars, the fox jumps and runs
// 6.50   2.50  away   cream  AK getaway         the teapot gallops with the light aboard, the fox rides behind
// 9.00   2.50  chase  cream  gallop             the fox gallops across the frame after the pot, on four feet:
//                                              Muybridge's horse, retargeted (hdf retarget, plan S14)
// 11.50  3.50  turn   table  book3              a pop-up book: the fox stands on a page, the leaf turns and the
//                                              fox turns with it (front, three-quarter, side), then back to us
// 15.00  9.17  talk   mint   dialogue           the fox asks a stick teacher where the teapot went: four lines,
//                                              speech, thought, shout and whisper bubbles facing each other
// 24.17  4.50  end    sand   AF printsOnALine   three prints on a line, sign-off, two foxes
// The chase is a retargeted cycle (plan S14): `fox.cycle('gallop')` is the horse of films/gallop.js, its skeleton
// read off the traced silhouettes and turned into the fox's joints; each frame's lift carries the moment in
// the air. The turn shot is the turnaround (plan S7): the fox puppet has three views and book3 picks one from the angle
// of the page it stands on. The greeting is actor.say (plan S9): the fox's mouth, the letters in the bubble and
// a pluck per syllable in the score all come from one timing, so they stay in sync; it takes the place of the
// shot's caption ('for two' is in the sign-off), which keeps the shot inside the look's three words.
// The talk is dialogue (4.0 T9): four turns scheduled at a reader's pace, each bubble held through the
// reply, the listener turned to the speaker. Its shot carries fourteen words (withLook), not the look's three.
import { film, seq, shot, paper, note, burst, pentHz, fill, stroke, rect, poly, ellipse, meta, ramp, ease, wash, spline, handText, camera3, card3, project, book3, LOOKS, pastel, withLook, puppet, actorOf, stickSource, dialogue, FPS } from '../core/index.js';
import { CAST, doesItsJob, looksBack, getaway, printsOnALine, lastFrame } from '../recipes/doodle.js';
import { fromStore } from '../core/assets.js';

const IDS = ['teapot', 'helmet', 'fox'];
const PHOTOS = fromStore(IDS);
const FOX = CAST.FOX;

const hello = FOX.say('hello there', 1.25);
const tea = doesItsJob({ name: 'tea', photo: PHOTOS.teapot, spout: [0.005, 0.27], handle: [0.86, 0.1], actor: FOX, say: hello, word: null });
const look = looksBack({ name: 'look', photo: PHOTOS.helmet, h: 720, eye: [0.55, 0.3], jaw: [0.62, 0.52], crown: [0.45, 0.02], actor: FOX, roar: 'grr', laugh: 'hee' });
const away = getaway({ name: 'away', photo: PHOTOS.teapot, h: 300, seat: [0.45, 0.02], actor: FOX });
const SCENES = [tea, look, away];

// ---------- the chase: the fox on the horse's gallop, left to right ----------
const CG = 870, CS = 170;   // the ground line, the fox's stage size
const chase = shot('chase', 2.5, ({ t }) => {
  const x = -220 + ramp(0, 2.5, t) * 1520, state = { ...FOX.idle(t), ...FOX.emote('wide'), ...FOX.cycle('gallop', t) };
  const up = (state.lift ?? 0) * 0.04 * 2.6 * CS;   // the stage's lift, back in pixels, for the shadow
  return [
    paper(), fill(rect(-2, -2, 1084, 1084), { base: 'fills.1', tint: 0.55 }),
    fill(rect(-2, CG, 1084, 232), { base: 'fills.3', tint: 0.3 }),
    stroke(poly([[-10, CG], [1090, CG]], false), 'ink', { w: 4 }),
    ...[0, 1, 2].map((k) => stroke(poly([[x - 260 - k * 70, CG - 230 + k * 80], [x - 420 - k * 70, CG - 230 + k * 80]], false), 'ink', { w: 3, alpha: 0.6, name: `speed${k}` })),
    fill(ellipse(x, CG + 8, 100 - up * 0.3, 14), 'shade', { alpha: 0.35, name: 'shadow' }),
    meta('anchor', { cel: 'fox' }), meta('intent', 'crop'),
    FOX.place(x, CG - 0.86 * CS, CS, state),
  ];
}, { recipe: 'gallop', look: pastel(LOOKS.doodlePastel, 'cream') });

// ---------- the turn: a pop-up book, the fox on the leaf that turns ----------
const PW = 460, PD = 620;
const blob = (pts) => spline(pts, { closed: true, tension: 0, n: 6 });
// A page: light paper, a wash of ground, a line or two in hand lettering.
const page = (name, lines, ground) => card3(PW, PD, [
  fill(rect(0, 0, PW, PD), 'light'),
  wash(blob([[30, 330], [200, 300], [PW - 20, 340], [PW - 30, 590], [210, 600], [24, 585]]), ground, { al: 0.55, off: 3, seed: name.length }),
  ...lines.map((words, k) => handText(words, PW / 2, 130 + k * 64, { size: 54, role: 'ink', ink2: null, align: 'center' })),
], { name });
const PAGES = [page('turnL0', ['the fox'], 'fills.3'), page('turnR0', [], 'fills.3'), page('turnL1', [], 'fills.1'), page('turnR1', ['turns', 'around.'], 'fills.1')];
const cover = card3(PW + 16, PD + 16, [fill(rect(0, 0, PW + 16, PD + 16), 'accents.1')], { name: 'cover' });
const cam = camera3({ eye: [0, 1050, 1150], target: [0, 150, -10], f: 1350 });

const turnShot = shot('turn', 3.5, ({ t, look }) => {
  const turn = 1 + ramp(0.3, 2.9, t, ease.io), happy = t < 0.3 || t > 3.0;
  const state = { ...FOX.idle(t), ...FOX.emote(happy ? 'happy' : 'wide') };
  const book = book3({
    PW, PD, cover,
    spreads: [
      { left: PAGES[0], right: PAGES[1], pieces: [{ base: [[70, 40], [430, 40]], h: 470, actor: FOX, state, name: 'fox' }] },
      { left: PAGES[2], right: PAGES[3], pieces: [{ base: [[-430, 40], [-70, 40]], h: 470, actor: FOX, state, name: 'fox' }] },
    ],
  });
  return [
    paper(), fill(rect(-2, -2, 1084, 1084), { base: 'fills.4', tint: 0.35 }),
    meta('anchor', { name: 'book' }), meta('intent', 'crop'),
    project(cam, card3(8, 8, [fill(rect(0, 0, 8, 8), { base: 'shade', alpha: 0.5 })]), [[-PW - 30, 0, -PD / 2 - 30], [PW + 30, 0, -PD / 2 - 30], [PW + 30, 0, PD / 2 + 30], [-PW - 30, 0, PD / 2 + 30]], { look }),
    book.draw({ turn, cam, look }),
  ];
}, { recipe: 'book3' });
// ---------- the talk: the fox asks the stick teacher (4.0 T9) ----------
const SAM = actorOf(puppet(stickSource({ name: 'sam' })), { height: 2.9 });
const TG = 880, FS = 104, SS = 104;   // the ground line, the fox's and sam's stage sizes
const WHERE = { fox: [290, TG - 0.86 * FS, FS], sam: [790, TG - 0.86 * SS, SS] };
const talk = dialogue([
  [FOX, 'have you seen a teapot?', { emote: 'worried' }],
  [SAM, 'a teapot?', { kind: 'thought', emote: 'thinking' }],
  [FOX, 'it ran away!', { kind: 'shout', emote: 'wide' }],
  [SAM, 'it went that way.', { kind: 'whisper', emote: 'wink' }],
], { t0: 0.5, where: WHERE });
const TALK = Math.ceil((talk.until + 0.25) * FPS - 1e-6) / FPS;
const talkShot = shot('talk', TALK, ({ t }) => {
  const last = talk.turns[3], point = ramp(last.t0, last.t0 + 0.4, t, ease.out);
  const fox = { ...FOX.idle(t), ...talk.state(FOX, t) };
  const sam = { ...SAM.idle(t, 2), ...(point > 0 ? SAM.pose('point-l', point) : {}), ...talk.state(SAM, t) };
  return [
    paper(), fill(rect(-2, -2, 1084, 1084), { base: 'fills.2', tint: 0.6 }),
    fill(rect(-2, TG, 1084, 212), { base: 'fills.3', tint: 0.3 }),
    stroke(poly([[-10, TG], [1090, TG]], false), 'ink', { w: 4 }),
    fill(ellipse(WHERE.fox[0], TG + 6, 80, 11), 'shade', { alpha: 0.3, name: 'shadow' }),
    fill(ellipse(WHERE.sam[0], TG + 6, 60, 9), 'shade', { alpha: 0.3, name: 'shadow' }),
    meta('anchor', { cel: 'fox' }),
    FOX.place(...WHERE.fox, fox),
    SAM.place(...WHERE.sam, sam),
    talk.draw(t),
  ];
}, { recipe: 'dialogue', look: withLook(pastel(LOOKS.doodlePastel, 'mint'), { words: 14 }) });

const end = printsOnALine({ name: 'end', prints: SCENES.map((s) => ({ draw: lastFrame(s), look: s.look })), a: 'tea for two', b: 'next time', actor: FOX });

// ---------- score: a music box for tea, a low growl, hooves, the gallop, the box again ----------
const score = ({ shots }) => {
  const [t0, t1, t2, tc, t3, tt, t4] = shots.map((s) => s.t0), ev = [];
  const box = (t, o, s, g = 0.2, d = 0.9) => ev.push(note(t, pentHz(o, s, 261.6), d, 'sine', g), note(t, pentHz(o + 1, s, 261.6), d * 0.5, 'triangle', g * 0.25));
  [[0.25, 1, 0], [0.75, 1, 2], [2.5, 1, 3], [2.75, 1, 4], [3.0, 2, 1]].forEach(([t, o, s]) => box(t0 + t, o, s));
  ev.push(...hello.events(t0));
  ev.push(note(t1 + 1.15, pentHz(-2, 0, 261.6), 0.8, 'saw', 0.12), note(t1 + 1.2, pentHz(-2, 1, 261.6), 0.7, 'saw', 0.08));
  [[2.1, 1, 2], [2.3, 1, 4], [2.5, 2, 0]].forEach(([t, o, s]) => box(t1 + t, o, s, 0.16, 0.4));
  for (let k = 0; k < 10; k++) ev.push(burst(t2 + 0.1 + k * 0.24, 0.03, 0.14, k + 3));
  // the gallop's four beats a stride (one stride a second, the cycle's 12 frames), for the chase
  for (let k = 0; k < 2; k++) for (const b of [0, 0.1, 0.25, 0.35]) ev.push(burst(tc + 0.2 + k + b, 0.03, 0.16, 60 + k * 4 + b * 10));
  for (let k = 0; k < 6; k++) ev.push(burst(t3 + 0.6 + k * 0.32, 0.6, 0.1 * (0.5 + 0.5 * Math.sin(k / 5 * Math.PI)), 40 + k));
  [[0.1, 1, 4], [2.9, 1, 0], [3.1, 1, 2]].forEach(([t, o, s]) => box(t3 + t, o, s, 0.18, 0.8));
  ev.push(...talk.events(tt));
  [[0, 1, 0], [0.6, 1, 2], [1.2, 1, 4], [2.5, 0, 0], [2.5, 1, 2], [2.5, 2, 0]].forEach(([t, o, s]) => box(t4 + t, o, s, 0.22, 2));
  return { master: 0.5, events: ev };
};

export default film({ name: 'fox-and-teapot', look: 'doodlePastel', timeline: seq(...SCENES, chase, turnShot, talkShot, end), score, assets: IDS });

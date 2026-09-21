// THE FOX AND THE TEAPOT. The doodle look with a new cast member: the fox from the asset store (a puppet,
// plan 1.2) goes through the recipes the hedgehog was drawn for, through the actor contract (plan 1.3), with
// nothing in the recipes changed but `actor: FOX`. Tea for two, a helmet that is not as empty as it looks,
// the teapot bolts with the light on its back and the fox gives chase on a hobby horse.
// Photos: The Metropolitan Museum of Art, Open Access (CC0); the fox is drawn for handdrawn 3.0 (`hdf find fox`).
//
// Anchor: the photo in each scene, the prints at the end. Format 1:1, drawn 12 fps; the end holds its
// sign-off 1.6 s (lint). The fox has a run cycle, so no fallback bob is ever on screen (lint actor-cycle).
// t      dur   scene  paper  recipe             what changes
// 0.00   3.50  tea    rose   AC doesItsJob      the pot pours, the fox waits by the cups and is happy at last
// 3.50   3.00  look   rose   AJ looksBack       the helmet's eyes light, it roars, the fox jumps and runs
// 6.50   2.50  away   cream  AK getaway         the teapot gallops with the light aboard, the fox rides behind
// 9.00   4.50  end    sand   AF printsOnALine   three prints on a line, sign-off, two foxes
import { film, seq, note, burst, pentHz } from '../core/index.js';
import { CAST, doesItsJob, looksBack, getaway, printsOnALine, lastFrame } from '../recipes/doodle.js';
import { fromStore } from '../core/assets.js';

const IDS = ['teapot', 'helmet', 'fox'];
const PHOTOS = fromStore(IDS);
const FOX = CAST.FOX;

const tea = doesItsJob({ name: 'tea', photo: PHOTOS.teapot, spout: [0.005, 0.27], handle: [0.86, 0.1], actor: FOX });
const look = looksBack({ name: 'look', photo: PHOTOS.helmet, h: 720, eye: [0.55, 0.3], jaw: [0.62, 0.52], crown: [0.45, 0.02], actor: FOX, roar: 'grr', laugh: 'hee' });
const away = getaway({ name: 'away', photo: PHOTOS.teapot, h: 300, seat: [0.45, 0.02], actor: FOX });
const SCENES = [tea, look, away];
const end = printsOnALine({ name: 'end', prints: SCENES.map((s) => ({ draw: lastFrame(s), look: s.look })), a: 'tea for two', b: 'next time', actor: FOX });

// ---------- score: a music box for tea, a low growl, hooves, the box again ----------
const score = ({ shots }) => {
  const [t0, t1, t2, t3] = shots.map((s) => s.t0), ev = [];
  const box = (t, o, s, g = 0.2, d = 0.9) => ev.push(note(t, pentHz(o, s, 261.6), d, 'sine', g), note(t, pentHz(o + 1, s, 261.6), d * 0.5, 'triangle', g * 0.25));
  [[0.25, 1, 0], [0.75, 1, 2], [1.25, 1, 4], [1.75, 2, 0], [2.5, 1, 3], [2.75, 1, 4], [3.0, 2, 1]].forEach(([t, o, s]) => box(t0 + t, o, s));
  ev.push(note(t1 + 1.15, pentHz(-2, 0, 261.6), 0.8, 'saw', 0.12), note(t1 + 1.2, pentHz(-2, 1, 261.6), 0.7, 'saw', 0.08));
  [[2.1, 1, 2], [2.3, 1, 4], [2.5, 2, 0]].forEach(([t, o, s]) => box(t1 + t, o, s, 0.16, 0.4));
  for (let k = 0; k < 10; k++) ev.push(burst(t2 + 0.1 + k * 0.24, 0.03, 0.14, k + 3));
  [[0, 1, 0], [0.6, 1, 2], [1.2, 1, 4], [2.5, 0, 0], [2.5, 1, 2], [2.5, 2, 0]].forEach(([t, o, s]) => box(t3 + t, o, s, 0.22, 2));
  return { master: 0.5, events: ev };
};

export default film({ name: 'fox-and-teapot', look: 'doodlePastel', timeline: seq(...SCENES, end), score, assets: IDS });

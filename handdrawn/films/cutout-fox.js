// THE FOX IN CARD. Fox-and-teapot's three scenes under the cut-out look (3.0 S10): the same recipes, the same
// fox puppet, nothing changed in either but `look: LOOKS.cutout`. The look does the rest: the fox is cut card
// on a table, each piece dropping a soft shadow on what lies under it, a light paper edge up-left, a brass
// fastener at each joint, the whole puppet a touch squashed with the camera above the table. Gilliam, by way
// of stage3d's soft shadows. Fills stay flat (finish 'flat'), the stock is card.
// Photos: The Metropolitan Museum of Art, Open Access (CC0); the fox is drawn for handdrawn 3.0 (`hdf find fox`).
//
// Anchor: the photo in each scene, the prints at the end. Format 1:1, drawn 12 fps; the end holds its
// sign-off 1.6 s (lint).
// t      dur   scene  recipe             what changes
// 0.00   3.50  tea    AC doesItsJob      the fox says hello there to the pot, it pours, the fox is happy
// 3.50   3.00  look   AJ looksBack       the helmet's eyes light, it roars, the fox jumps and runs
// 6.50   2.50  away   AK getaway         the teapot gallops with the light aboard, the fox rides behind
// 9.00   4.50  end    AF printsOnALine   three prints on a line, sign-off, two foxes
import { film, seq, note, burst, pentHz, LOOKS } from '../core/index.js';
import { CAST, doesItsJob, looksBack, getaway, printsOnALine, lastFrame } from '../recipes/doodle.js';
import { fromStore } from '../core/assets.js';

const IDS = ['teapot', 'helmet', 'fox'];
const PHOTOS = fromStore(IDS);
const FOX = CAST.FOX;
const CARD = { look: LOOKS.cutout, paper: null };

const hello = FOX.say('hello there', 1.25);
const tea = doesItsJob({ name: 'tea', photo: PHOTOS.teapot, spout: [0.005, 0.27], handle: [0.86, 0.1], actor: FOX, say: hello, word: null, ...CARD });
const look = looksBack({ name: 'look', photo: PHOTOS.helmet, h: 720, eye: [0.55, 0.3], jaw: [0.62, 0.52], crown: [0.45, 0.02], actor: FOX, roar: 'grr', laugh: 'hee', ...CARD });
const away = getaway({ name: 'away', photo: PHOTOS.teapot, h: 300, seat: [0.45, 0.02], actor: FOX, ...CARD });
const SCENES = [tea, look, away];
const end = printsOnALine({ name: 'end', prints: SCENES.map((s) => ({ draw: lastFrame(s), look: s.look })), a: 'cut from card', b: 'pinned in brass', actor: FOX, ...CARD });

// ---------- score: a music box for tea, a low growl, hooves, the box again ----------
const score = ({ shots }) => {
  const [t0, t1, t2, t3] = shots.map((s) => s.t0), ev = [];
  const box = (t, o, s, g = 0.2, d = 0.9) => ev.push(note(t, pentHz(o, s, 261.6), d, 'sine', g), note(t, pentHz(o + 1, s, 261.6), d * 0.5, 'triangle', g * 0.25));
  [[0.25, 1, 0], [0.75, 1, 2], [2.5, 1, 3], [2.75, 1, 4], [3.0, 2, 1]].forEach(([t, o, s]) => box(t0 + t, o, s));
  ev.push(...hello.events(t0));
  ev.push(note(t1 + 1.15, pentHz(-2, 0, 261.6), 0.8, 'saw', 0.12), note(t1 + 1.2, pentHz(-2, 1, 261.6), 0.7, 'saw', 0.08));
  [[2.1, 1, 2], [2.3, 1, 4], [2.5, 2, 0]].forEach(([t, o, s]) => box(t1 + t, o, s, 0.16, 0.4));
  for (let k = 0; k < 10; k++) ev.push(burst(t2 + 0.1 + k * 0.24, 0.03, 0.14, k + 3));
  [[0, 1, 0], [0.6, 1, 2], [1.2, 1, 4], [2.5, 0, 0], [2.5, 1, 2], [2.5, 2, 0]].forEach(([t, o, s]) => box(t3 + t, o, s, 0.22, 2));
  return { master: 0.5, events: ev };
};

export default film({ name: 'cutout-fox', look: 'cutout', timeline: seq(...SCENES, end), score, assets: IDS });

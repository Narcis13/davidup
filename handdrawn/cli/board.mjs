// hdf board <film.js>: the tree as text, and a storyboard: one card per shot (name, a thumbnail of its
// middle frame, duration, look, camera, anchor, recipe, lint), drawn with the list API in the film's look.
import { join } from 'node:path';
import { FPS } from '../core/curves.js';
import { handText } from '../core/text.js';
import { paper, rect, stroke } from '../core/list.js';
import { hash32 } from '../core/rand.js';
import { describe } from '../core/tree.js';
import { inspect } from '../core/lint.js';
import { frameCanvas, outDir, paint, tileSheet } from './sheets.mjs';

const CW = 400, PAD = 20, TOP = 62, LINE = 30;

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  process.stdout.write(describe(film) + '\n');
  const { findings, shots } = inspect(film);
  const fmt = film.format, tw = Math.round(Math.min(CW - 2 * PAD, (CW - 2 * PAD) * fmt.W / fmt.H));
  const thumb = frameCanvas(film, { width: tw }), th = thumb.size.outH, tx = (CW - tw) / 2;
  const CH = TOP + th + 16 + 5 * LINE + 14;
  const cards = shots.map((s) => {
    const errors = findings.filter((f) => f.shot === s.name).length;
    const line = (str, j, o = {}) => handText(str, PAD, TOP + th + 16 + LINE * (j + 0.8), { size: 20, ink2: null, ...o });
    const list = [
      paper(),
      handText(s.name, PAD, 44, { size: 34 }),
      line(`${(s.n / FPS).toFixed(2)}s  ${s.n === 1 ? 'hold' : `${s.n} frames`}  at ${(s.f0 / FPS).toFixed(2)}s`, 0),
      line(`look: ${s.look ?? '-'}`, 1),
      line(`camera: ${s.camera ?? 'static'}`, 2),
      line(`anchor: ${s.anchor ? 'yes' : 'missing'}   recipe: ${s.recipe ?? '-'}`, 3, s.anchor ? {} : { role: 'blush' }),
      line(errors ? `lint: ${errors} finding${errors > 1 ? 's' : ''}` : 'lint: clean', 4, errors ? { role: 'blush' } : {}),
    ];
    const card = paint(list, { look: film.look, W: CW, H: CH, seed: hash32('board', s.name) });
    try {
      thumb.draw(s.f0 + Math.floor(s.n / 2));
      card.getContext('2d').drawImage(thumb.canvas, tx, TOP);
    } catch (e) {
      paint([handText('draw failed', tx + 12, TOP + 40, { size: 24, role: 'blush', ink2: null })], { look: film.look, W: CW, H: CH, onto: card });
    }
    paint([stroke(rect(tx - 2, TOP - 2, tw + 4, th + 4), 'ink', { w: 2, wobble: 1.2 })], { look: film.look, W: CW, H: CH, seed: hash32('frame', s.name), onto: card });
    return { canvas: card };
  });
  const file = join(outDir(flags), `${film.name}-board.jpg`);
  await tileSheet(cards, { cols: flags.cols ?? 4 }).toFile(file, { quality: 0.9 });
  process.stdout.write(`${file}\n`);
  return 0;
}

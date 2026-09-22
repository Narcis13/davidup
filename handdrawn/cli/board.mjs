// hdf board <film.js>: the tree as text, and a storyboard: one card per shot (name, a thumbnail of its
// middle frame, duration, look, camera, anchor, recipe, lint), drawn with the list API in the film's look.
// A film in chapters (4.0 E1) boards one card per chapter instead (its title, a thumbnail of its title card
// written, span, shots and cuts, recipes, lint); --chapter N boards that chapter's shots, --shots every shot.
import { join } from 'node:path';
import { FPS } from '../core/curves.js';
import { handText } from '../core/text.js';
import { paper, rect, stroke } from '../core/list.js';
import { hash32 } from '../core/rand.js';
import { chapters, describe } from '../core/tree.js';
import { chapterReport, formatChapter, inspect } from '../core/lint.js';
import { UsageError } from './load.mjs';
import { frameCanvas, outDir, paint, tileSheet } from './sheets.mjs';

const CW = 400, PAD = 20, TOP = 62, LINE = 30, TITLE_MAX = 20;

const clipTitle = (s) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 3)}...` : s);

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  process.stdout.write(describe(film) + '\n');
  const { findings, shots } = inspect(film);
  const chs = chapters(film), k = flags.chapter;
  if (k !== undefined && !chs[k - 1]) throw new UsageError(`board: --chapter ${k}: film ${film.name} has ${chs.length ? `chapters 1..${chs.length}` : 'no chapters'}`);
  const fmt = film.format, tw = Math.round(Math.min(CW - 2 * PAD, (CW - 2 * PAD) * fmt.W / fmt.H));
  const thumb = frameCanvas(film, { width: tw }), th = thumb.size.outH, tx = (CW - tw) / 2;
  const CH = TOP + th + 16 + 5 * LINE + 14;

  // A card: a heading, a thumbnail of frame i, five lines under it ([text, bad]).
  const card = (key, heading, i, lines) => {
    const line = ([str, bad], j) => handText(str, PAD, TOP + th + 16 + LINE * (j + 0.8), { size: 20, ink2: null, ...(bad ? { role: 'blush' } : {}) });
    const c = paint([paper(), handText(heading, PAD, 44, { size: 34 }), ...lines.map(line)], { look: film.look, W: CW, H: CH, seed: hash32('board', key) });
    try {
      thumb.draw(i);
      c.getContext('2d').drawImage(thumb.canvas, tx, TOP);
    } catch (e) {
      paint([handText('draw failed', tx + 12, TOP + 40, { size: 24, role: 'blush', ink2: null })], { look: film.look, W: CW, H: CH, onto: c });
    }
    paint([stroke(rect(tx - 2, TOP - 2, tw + 4, th + 4), 'ink', { w: 2, wobble: 1.2 })], { look: film.look, W: CW, H: CH, seed: hash32('frame', key), onto: c });
    return { canvas: c };
  };
  const lintLine = (n) => [n ? `lint: ${n} finding${n > 1 ? 's' : ''}` : 'lint: clean', n > 0];

  let cards, name = `${film.name}-board`;
  if (chs.length && k === undefined && !flags.shots) {
    const report = chapterReport(film, findings);
    for (const r of report) process.stdout.write(formatChapter(r) + '\n');
    cards = report.map((r, j) => {
      const ch = chs[j], card0 = r.card && shots.find((s) => s.name === r.card && s.f0 === ch.f0);
      // The title card's last frame (the title written), else the chapter's middle frame.
      const i = card0 ? card0.f0 + card0.n - 1 : ch.f0 + Math.floor(ch.frames / 2);
      return card(`chapter ${r.n}`, `${r.n}. ${clipTitle(r.title)}`, i, [
        [`${r.dur.toFixed(2)}s  at ${r.t0.toFixed(2)}s`],
        [`${r.shots} shot${r.shots === 1 ? '' : 's'}  ${r.cuts} cut${r.cuts === 1 ? '' : 's'}`],
        [`recipes: ${r.recipes.length ? r.recipes.join(' ') : '-'}`],
        [`card: ${r.card ? 'yes' : 'none'}`],
        lintLine(r.findings),
      ]);
    });
  } else {
    const ch = k !== undefined ? chs[k - 1] : null;
    if (ch) name += `-ch${k}`;
    const mine = ch ? shots.filter((s) => s.f0 >= ch.f0 && s.f0 < ch.f0 + ch.frames) : shots;
    cards = mine.map((s) => card(s.name, s.name, s.f0 + Math.floor(s.n / 2), [
      [`${(s.n / FPS).toFixed(2)}s  ${s.n === 1 ? 'hold' : `${s.n} frames`}  at ${(s.f0 / FPS).toFixed(2)}s`],
      [`look: ${s.look ?? '-'}`],
      [`camera: ${s.camera ?? 'static'}`],
      [`anchor: ${s.anchor ? 'yes' : 'missing'}   recipe: ${s.recipe ?? '-'}`, !s.anchor],
      lintLine(findings.filter((f) => f.shot === s.name).length),
    ]));
  }
  const file = join(outDir(flags), `${name}.jpg`);
  await tileSheet(cards, { cols: flags.cols ?? 4 }).toFile(file, { quality: 0.9 });
  process.stdout.write(`${file}\n`);
  return 0;
}

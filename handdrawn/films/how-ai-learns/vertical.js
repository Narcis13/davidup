// The vertical page for how-ai-learns (9:16, for phones and social feeds). The film is drawn for 16:9 in fixed
// coordinates, so `--ar 9:16` would crop Bit and the network; instead the finished 16:9 master sits whole in a
// window on a notebook page, the title lettered above it, the chapter under the title, and every voice line
// lettered below it as it is spoken (captions: most feeds play with the sound off).
//
// This module draws the page with an empty window; ffmpeg lays the master into the window and takes its sound:
//   hdf render films/how-ai-learns/vertical.js --no-sound
//   ./films/how-ai-learns/make-vertical.sh
// It is a layer, not a film: lint's film rules (chapters, a word budget over the whole shot, a sign-off) are
// for the master, which carries them.
import { film, shot, paper, fill, rect, handText, meta, marginDoodle, coffeeRing, cues, captions } from '../../core/index.js';
import { scoreEvents } from '../../core/synth.js';
import HOW from '../how-ai-learns.js';

// The window the master is laid into (make-vertical.sh reads these): 16:9, even sizes for the encoder.
export const WINDOW = { x: 44, y: 580, w: 992, h: 558 };
const BORDER = 14;

const RED = { base: 'inks.1', shade: 0.15 };
const WHO = {
  ai: { role: 'ink' },
  bit: { role: { base: 'inks.2', shade: 0.2 }, name: 'Bit' },
  fox: { role: { base: 'accents.3', shade: 0.4 }, name: 'Fox' },
};

const TITLE = handText('how does AI learn?', 560, 300, { size: 94, align: 'center', role: 'ink', ink2: 'fills.0', offset: 5, w: 5, seed: 200 });
// the chapter under the title (the first chapter is the title itself)
const CHAPTERS = cues(HOW).chapters.filter((c) => c.title !== 'how does AI learn?').map((c) => ({ ...c, node: handText(c.title, 560, 440, { size: 64, align: 'center', role: RED, ink2: null, w: 3.4, seed: 40 + c.n }) }));

// Every voice line in the film, lettered in its speaker's ink; a speaker other than the narrator is named.
const CAP_BOX = [70, 1262, 940, 230];   // two rows of 70 (lineH 91) and the underline
const LINES = scoreEvents(HOW).events.filter((e) => e.type === 'voice').map((e) => {
  const who = WHO[e.id.split('-')[0]] ?? WHO.ai;
  const c = captions(e.id, { t0: e.t, size: 70, lines: 2, box: CAP_BOX, sheet: null, role: who.role, mark: 'fills.0', hold: 0.6 });
  return { t: e.t, c, who, name: who.name && handText(`${who.name}:`, CAP_BOX[0] + 30, CAP_BOX[1] - 4, { size: 50, role: who.role, ink2: null, w: 3, seed: 7 }) };
});

const page = shot('page', HOW.dur, ({ t }) => {
  const chapter = CHAPTERS.findLast((c) => t >= c.t0);   // none before '1. rules'
  const line = LINES.findLast((l) => t >= l.t + (l.c.words[0]?.t0 ?? 0) - 1e-6 && t < l.c.until);
  const { x, y, w, h } = WINDOW;
  return [
    paper(),
    meta('anchor', { name: 'window' }),
    marginDoodle('star', 75, 150, 50, 11, { role: 'inks.2' }), marginDoodle('heart', 75, 1680, 48, 21, { role: 'inks.1' }),
    coffeeRing(930, 1780, 90, 13),
    TITLE,
    chapter && chapter.node,
    // the window: a soft shadow and a white border round the space the master fills
    fill(rect(x - BORDER + 8, y - BORDER + 12, w + 2 * BORDER, h + 2 * BORDER), 'ink', { alpha: 0.12, name: 'window-shadow' }),
    fill(rect(x - BORDER, y - BORDER, w + 2 * BORDER, h + 2 * BORDER), 'light', { name: 'window' }),
    line && line.name,
    line && line.c.draw(t, { W: 1080, H: 1920 }),
  ];
}, { recipe: 'vertical page' });

export default film({ name: 'how-ai-learns-vertical', look: 'notebook', format: '9:16', audience: 'beginner', timeline: page, assets: HOW.assets });

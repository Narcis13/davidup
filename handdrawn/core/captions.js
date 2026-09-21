// Captions that follow a voice (4.0 V2): the copy of a recorded line lettered in a strip at the bottom of the
// frame as it is spoken, the word being said underlined.
//
//   captions(id | alignment, { t0, text, size, lines, box, hold, reveal, role, mark, sheet, hand })
//     => { kind: 'captions', id, t0, words, end, until, current(t), draw(t, { W, H }) }
//
// id is a sample in the store (its word timing is core/align.js alignOf, `text` the copy when the entry has
// none), or an alignment itself ({ text, words: [{ text, t0, t1 }] }). t0 is when the recording starts, in the
// clock draw(t) is called with: shot seconds when the voice starts in this shot, film seconds when a film-wide
// strip is drawn from `i / FPS`. The copy wraps into pages of `lines` lines in the shot's hand; a page shows
// from its first word until the next page's (the last holds `hold` s after its last word). reveal 'word' (the
// default) letters each word as it is spoken, 'page' letters the whole page at once; the word being spoken
// (from its start to a beat after its end) is underlined in `mark`, the underline drawing on as it starts.
// Lettered in `hand` (a hand record), else the shot's hand. The strip sits on a band of `sheet` (null for
// none) across the bottom of the W x H frame unless `box` ([x, y, w, h]) puts it elsewhere. Its group is `captions:<id>` with meta('captions', { id, by, span }):
// lint does not count its words against the look (they are the voice's) and warns (caption-sync) when a
// long line is timed by the estimate.
import { alignOf, alignSpan } from './align.js';
import { asHand, currentHand, houseHand } from './glyphs.js';
import { advance } from './layout.js';
import { fill, group, line, meta, rect, stroke } from './list.js';
import { handText } from './text.js';

const GRACE = 0.15;   // s the underline stays on a word after it ends (so a quick word is seen underlined)
const CAP = 0.72;     // cap height in sizes (core/layout.js)

// captions(id | alignment, { t0, text, size, lines, box, hold, reveal, role, mark, sheet, hand }) => a strip
// that letters a recorded line as it is spoken, the spoken word underlined; draw(t, { W, H }) in the clock of t0.
export function captions(src, o = {}) {
  const {
    t0 = 0, text, size = 44, lines = 2, box = null, hold = 0.8, reveal = 'word',
    role = 'ink', mark = 'accents.0', sheet = 'paper', lineH = size * 1.3, hand,
  } = o;
  if (!['word', 'page'].includes(reveal)) throw new TypeError(`captions: reveal '${reveal}' (word or page)`);
  if (!(Number.isInteger(lines) && lines > 0)) throw new TypeError(`captions: lines must be an integer > 0, got ${lines}`);
  if (!Number.isFinite(t0)) throw new TypeError(`captions: t0 must be a number, got ${t0}`);
  const id = typeof src === 'string' ? src : src?.id ?? 'line';
  // The timing, read on first use (the player fetches a voice's wav after the film module is imported).
  let A = null;
  const align = () => A ??= typeof src === 'string' ? alignOf(src, text === undefined ? {} : { text }) : src;
  const words = () => align().words;
  const until = () => { const w = words(); return w.length ? w[w.length - 1].t1 + hold : 0; };

  // The index of the last word started by u (recording seconds), or -1.
  const startedBy = (u) => {
    const w = words();
    let k = -1;
    while (k + 1 < w.length && w[k + 1].t0 <= u + 1e-9) k++;
    return k;
  };

  // The strip's frame box and the pages for a hand and a frame, made once for each.
  const made = new Map();
  const pagesFor = (H, W, Hh) => {
    const key = `${W}x${Hh}`;
    let byHand = made.get(H);
    if (!byHand) made.set(H, byHand = new Map());
    if (byHand.has(key)) return byHand.get(key);
    const h = lines * lineH + size * 0.6, bx = box ?? [Math.round(W * 0.07), Math.round(Hh - h - Hh * 0.04), Math.round(W * 0.86), Math.round(h)];
    const w = words(), fits = (s) => advance(s, size, H) <= bx[2] - size * 0.6 + 1e-6;
    const said = (a, b) => w.slice(a, b + 1).map((x) => x.text).join(' ');
    const stops = (k, re) => re.test(w[k].text);
    const STOP = /[.!?]["')\]]*$/, PAUSE = /[,;:.!?]["')\]]*$/;
    // Rows ([first word, last word]) greedily, breaking after any word in `after`. The last row of a page also
    // ends at a sentence's end once it is 40% full, so a page opens on a new sentence.
    const flow = (after) => {
      const rows = [];
      let cur = null;
      w.forEach((word, k) => {
        const stop = cur && rows.length % lines === lines - 1 && stops(k - 1, STOP) && advance(said(cur[0], k - 1), size, H) > 0.4 * bx[2];
        if (cur && !stop && !after.has(k - 1) && fits(said(cur[0], k))) { cur[1] = k; return; }
        if (cur) rows.push(cur);
        cur = [k, k];
      });
      if (cur) rows.push(cur);
      return rows;
    };
    // A page must not leave one or two words of its last sentence for the next: its last row breaks at its
    // last pause instead (a comma), and the copy flows again.
    const after = new Set();
    let rows = flow(after);
    for (let pass = 0; pass < 8; pass++) {
      const widow = rows.findIndex(([a, b], r) => {
        if (r % lines !== lines - 1 || r === rows.length - 1 || stops(b, STOP)) return false;
        let e = b + 1;
        while (e < w.length - 1 && !stops(e, STOP)) e++;
        return e - b <= 2;
      });
      if (widow < 0) break;
      const [a, b] = rows[widow];
      let c = b - 1;
      while (c > a && !stops(c, PAUSE)) c--;
      if (c <= a || after.has(c)) break;
      after.add(c);
      rows = flow(after);
    }
    const pages = [];
    for (let r = 0; r < rows.length; r += lines) {
      const mine = rows.slice(r, r + lines), top = bx[1] + (bx[3] - mine.length * lineH) / 2;
      pages.push({
        from: mine[0][0], to: mine[mine.length - 1][1],
        rows: mine.map(([a, b], q) => {
          const str = w.slice(a, b + 1).map((x) => x.text).join(' '), y = top + q * lineH + (lineH - size) / 2 + CAP * size;
          const cx = bx[0] + bx[2] / 2, gx = cx - advance(str, size, H) / 2, k100 = size / 100;
          // Each word's pen span on the line and the chars it ends at (the lettering's glyph index).
          let at = 0;
          const spans = [];
          for (let j = a; j <= b; j++) {
            const x0 = gx + (at ? advance(str.slice(0, at), size, H) + H.track * k100 : 0);
            spans.push({ k: j, x0, x1: x0 + advance(w[j].text, size, H), end: at + w[j].text.length });
            at += w[j].text.length + 1;
          }
          return { str, y, spans, letters: handText(str, cx, y, { size, align: 'center', role, ink2: null, hand: H }) };
        }),
      });
    }
    const out = { box: bx, pages };
    byHand.set(key, out);
    return out;
  };

  const handNow = () => (hand ? asHand(hand) : currentHand() ?? houseHand());

  return Object.freeze({
    kind: 'captions', id, t0,
    get words() { return words(); },
    get end() { const w = words(); return t0 + (w.length ? w[w.length - 1].t1 : 0); },
    get until() { return t0 + until(); },
    // The word being spoken at t (its index), or -1: from its start to GRACE s after its end.
    current(t) {
      const u = t - t0, k = startedBy(u);
      return k >= 0 && u < words()[k].t1 + GRACE - 1e-9 ? k : -1;
    },
    draw(t, { W = 1080, H = 1080 } = {}) {
      const u = t - t0, w = words();
      if (!w.length || u < w[0].t0 - 1e-9 || u >= until() - 1e-9) return null;
      const A0 = align(), { box: bx, pages } = pagesFor(handNow(), W, H), k = startedBy(u);
      const page = pages.findLast((p) => p.from <= k) ?? pages[0];
      const now = k >= 0 && u < w[k].t1 + GRACE - 1e-9 ? k : -1;
      const kids = [meta('captions', { id, by: A0.by ?? 'json', span: alignSpan(A0) })];
      if (sheet) kids.push(fill(rect(...bx), sheet, { alpha: 0.88, name: 'strip' }));
      for (const row of page.rows) {
        const said = row.spans.filter((s) => s.k <= k);
        const shown = reveal === 'page' ? Infinity : said.length ? said[said.length - 1].end : 0;
        if (!shown) continue;
        const g = row.letters, gi = (op) => parseInt(op.name.slice(1), 10);
        kids.push(shown === Infinity ? g : group({ name: g.name }, g.kids.filter((op) => gi(op) < shown)));
        const s = row.spans.find((x) => x.k === now);
        if (s) {
          const p = Math.min(1, Math.max(0.2, (u - w[now].t0) / Math.max(1 / 12, Math.min(0.2, w[now].t1 - w[now].t0)))), y = row.y + size * 0.16;
          kids.push(stroke(line(s.x0, y, s.x0 + (s.x1 - s.x0) * p, y), mark, { w: Math.max(2, size * 0.08), wobble: 1, name: `underline${now}` }));
        }
      }
      return group({ name: `captions:${id}`, cache: 'never' }, kids);
    },
  });
}

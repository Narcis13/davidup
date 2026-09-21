// Hand lettering as strokes: text ops become groups of pen strokes from glyphs.js, so text wobbles,
// reveals in stroke order and hashes like any other drawing. No host fonts anywhere.
import { FPS } from './curves.js';
import { glyph, TRACK } from './glyphs.js';
import { circle, fill, group, meta, mkPath, text, stroke } from './list.js';
import { hash32, rng } from './rand.js';
import { reveal } from './tools.js';

const TAU = Math.PI * 2;

// Advance width of a string at a size, in logical units.
export function measure(str, size) {
  const k = size / 100;
  let w = 0;
  for (const ch of str) w += (glyph(ch).w * glyph(ch).k + TRACK) * k;
  return Math.max(0, w - TRACK * k);
}

// handText(op) or handText(str, x, y, { size, role, tool, align, w, ink2, offset, seed })
// => group of stroke ops. Glyph placement (baseline drift, small turns) comes from the string's own
// seed, so the letters only move when the words change; the pen wobble comes from each stroke's seed.
// ink2 (default accents.0, null for none) is a misregistered second ink drawn under the first.
export function handText(a, x, y, o = {}) {
  const op = typeof a === 'string' ? text(a, x, y, o) : a;
  const { str, size } = op;
  const k = size / 100, w = op.w ?? Math.max(1.2, size * 0.045);
  const r = rng(op.glyphSeed ?? hash32('text', str));
  const width = measure(str, size);
  let gx = op.align === 'center' ? op.x - width / 2 : op.align === 'right' ? op.x - width : op.x;
  const phase = r() * TAU, amp = size * 0.03, main = [], under = [];
  const ink2 = op.ink2 === undefined ? 'accents.0' : op.ink2, off = op.offset ?? Math.max(1, size * 0.035);
  let order = op.order ?? 0, gi = 0;
  for (const ch of str) {
    const g = glyph(ch), s = k * g.k;
    const rot = (r() - 0.5) * 0.08, dy = Math.sin(phase + (gx - op.x) / size * 1.3) * amp + (r() - 0.5) * size * 0.015;
    const ca = Math.cos(rot) * s, sa = Math.sin(rot) * s, ox = gx, oy = op.y + dy;
    g.s.forEach((pts, si) => {
      const out = new Array(pts.length);
      for (let i = 0; i < pts.length; i += 2) { out[i] = ox + ca * pts[i] - sa * pts[i + 1]; out[i + 1] = oy + sa * pts[i] + ca * pts[i + 1]; }
      const path = mkPath([{ pts: out, closed: false }]), name = `g${gi}.${si}`;
      const common = { tool: op.tool ?? 'pen', w, wobble: w * 0.3, order };
      main.push(stroke(path, op.role ?? 'ink', { ...common, name }));
      if (ink2) {
        const shifted = mkPath([{ pts: out.map((v, i) => v + (i % 2 ? off * 0.6 : off)), closed: false }]);
        under.push(stroke(shifted, ink2, { ...common, name: `${name}b`, alpha: 0.85 }));
      }
      order++;
    });
    gx += (g.w * g.k + TRACK) * k;
    gi++;
  }
  const props = { name: op.name ?? `text:${str}` };
  if (op.seed !== undefined) props.seed = op.seed;
  return group(props, [...under, ...main]);
}

// The film's signature: two dots, then word a, then word b (smaller, below), each revealed in stroke
// order by pA and pB. Carries meta{tag:'signOff'} so lint can check it completes in time.
export function signOff(a, b, { x = 540, y = 540, size = 60, pA = 1, pB = 1, ink = 'ink', ink2 = 'accents.0' } = {}) {
  const A = handText(a, x, y - 12, { size, align: 'center', role: ink, ink2 });
  const B = handText(b, x, y + size * 1.1, { size: size * 0.75, align: 'center', role: ink, ink2 });
  return group('signOff', [
    meta('signOff', { a, b, pA, pB }),
    fill(circle(x - 10, y + size * 0.35, 6, 16), ink, { name: 'dotA' }),
    fill(circle(x + 10, y + size * 0.35, 6, 16), ink2, { name: 'dotB' }),
    pA > 0 && reveal(pA, A),
    pB > 0 && reveal(pB, B),
  ]);
}

// Illegible handwriting: rows of little arches filling box [x, y, w, h?] (v1 squiggleText).
export function squiggleText(box, lines, seed = 1, { role = 'ink', lineH, amp = 4, w = 1.3, gap = 0.4 } = {}) {
  const [x, y, bw, bh] = box, r = rng(seed), lh = lineH ?? (bh ? bh / lines : 16), sub = [];
  for (let l = 0; l < lines; l++) {
    let px = x;
    const py = y + l * lh, end = x + bw * (l === lines - 1 ? 0.35 + r() * 0.5 : 0.9 + r() * 0.1);
    while (px < end) {
      const wl = 14 + r() * 40, f = 0.6 + r() * 0.6, pts = [px, py];
      for (let u = 2; u <= wl; u += 2) pts.push(px + u, py - Math.abs(Math.sin(u * f + r() * 0.3)) * amp * (0.5 + r() * 0.8));
      sub.push({ pts, closed: false });
      px += wl + amp * 2 * gap + r() * 8;
    }
  }
  return stroke(mkPath(sub), role, { w, wobble: 0, name: 'squiggle' });
}

// ---------- speech (actor.say, plan S9) ----------

const VOWELS = /[aeiouy]+/g;

// A word's syllables as vowel groups: each ends where its vowel group does, the last takes the tail. A final
// silent 'e' (not '-le') joins the group before it; a word with no vowel is one syllable.
//   syllablesOf('hello') => ['he', 'llo']      syllablesOf('there') => ['there']
export function syllablesOf(word) {
  const low = word.toLowerCase(), ends = [...low.matchAll(VOWELS)].map((m) => m.index + m[0].length);
  if (ends.length > 1 && /[^aeiouy]e$/.test(low) && !/[^aeiouy]le$/.test(low)) ends.pop();
  if (!ends.length) return [word];
  ends[ends.length - 1] = word.length;
  return ends.map((e, k) => word.slice(k ? ends[k - 1] : 0, e));
}

// The mouth over one syllable, a step (1/12 s) each: shut, wide, smiling, a little open (a puppet's mouth
// variants 0..3).
export const VISEMES = Object.freeze([0, 2, 3, 1]);

// A line of speech on the 1/12 s grid from t0: each syllable is one viseme cycle (VISEMES, a step each), a
// space rests the mouth a step, a comma or a full stop two. The letters of a syllable arrive over its steps.
//   => { syllables: [{ text, from, to, t, dur }], steps: [viseme per step], letters: [time per char], dur, end }
// from / to index str; letters[j] is when character j appears (spaces and stops at their own rest).
export function speech(str, t0 = 0) {
  str = String(str);
  const syllables = [], steps = [], letters = new Array(str.length).fill(0);
  let step = 0, j = 0;
  const at = () => t0 + step / FPS;
  while (j < str.length) {
    const word = /^[^\s,.;:!?]+/.exec(str.slice(j));
    if (!word) {
      const ch = str[j];
      letters[j] = at();
      const rest = /[,.;:!?]/.test(ch) ? 2 : /\s/.test(ch) ? 1 : 0;
      for (let r = 0; r < rest; r++) steps.push(0);
      step += rest;
      j++;
      continue;
    }
    for (const syl of syllablesOf(word[0])) {
      const from = j, to = j + syl.length, t = at(), n = VISEMES.length;
      syllables.push({ text: syl, from, to, t, dur: n / FPS });
      for (let c = from; c < to; c++) letters[c] = t0 + (step + Math.floor((c - from) * n / syl.length)) / FPS;
      steps.push(...VISEMES);
      step += n;
      j = to;
    }
  }
  return { syllables, steps, letters, dur: step / FPS, end: t0 + step / FPS };
}

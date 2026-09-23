// Word timing for a recorded line (4.0 V2): when each word of a sample is spoken, so captions letter the words
// as they are said and actor.say speaks a recording. Browser-safe: the player aligns the same bytes.
//
//   alignOf(id, { text })        { text, by, words: [{ text, t0, t1 }] } in the sample's own seconds
//   estimateAlign(text, x, sr)   the estimate: speech()'s grid stretched over the voiced part, its pauses
//                                snapped to the recording's silences
//   fitWords(text, words, by)    another tool's words (whisper, a json) laid onto the copy's own words
//   wordsOf(text)                the copy's words: [{ text, from, to }] (punctuation stays on its word)
//
// The alignment `hdf align` stores on the sample's catalogue entry (`align`, words as [text, t0, t1]) wins
// when its copy matches; without one the estimate is made from the wav at render time, the same in Node and
// in the player, so a render needs nothing installed. by is 'estimate', 'whisper' or 'json'.
import { speech, syllablesOf, VISEMES } from './text.js';
import { peek } from './store.js';
import { pcmOf, SR } from './synth.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

// The copy's words, split on white space; punctuation stays on the word it touches ("light." is one word).
export function wordsOf(text) {
  return [...String(text).matchAll(/\S+/g)].map((m) => ({ text: m[0], from: m.index, to: m.index + m[0].length }));
}

// A word as compared across tools: lower case, accents off, letters and digits only.
export const normWord = (w) => String(w).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const normText = (s) => wordsOf(s).map((w) => normWord(w.text)).filter(Boolean).join(' ');

// ---------- the estimate ----------

// 20 ms windows' RMS, the floor between speech and silence (relative to the loud part, so a phone's room
// noise reads as silence and a quiet take still speaks), and the silences inside the voiced part.
const WIN = 0.02, GAP_MIN = 0.14;
function silences(x, sr) {
  const w = Math.max(1, Math.round(WIN * sr)), n = Math.ceil(x.length / w), rms = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const end = Math.min(x.length, (k + 1) * w);
    for (let i = k * w; i < end; i++) s += x[i] * x[i];
    rms[k] = Math.sqrt(s / Math.max(1, end - k * w));
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(n * 0.9)] ?? 0, floor = Math.max(0.006, loud * 0.08);
  const on = (k) => rms[k] > floor;
  let first = 0, last = n - 1;
  while (first < n && !on(first)) first++;
  while (last > first && !on(last)) last--;
  if (first >= n) return { span: null, gaps: [] };
  const gaps = [];
  for (let k = first; k <= last;) {
    if (on(k)) { k++; continue; }
    const a = k;
    while (k <= last && !on(k)) k++;
    if ((k - a) * WIN >= GAP_MIN - 1e-9) gaps.push([a * w / sr, k * w / sr]);
  }
  return { span: [first * w / sr, Math.min(x.length, (last + 1) * w) / sr], gaps };
}

// Pauses in the copy: after a word ending in , ; : . ! ? (a stop costs more to leave unmatched).
const pauseAfter = (w) => (/[.!?]["')\]]*$/.test(w) ? 2 : /[,;:]["')\]]*$/.test(w) ? 1 : 0);

// Each word's [t0, t1] on speech()'s grid (a syllable a viseme cycle, rests for spaces and stops).
function gridOf(text, words) {
  const sp = speech(text, 0), out = words.map(() => [Infinity, -Infinity]);
  for (const s of sp.syllables) {
    const k = words.findIndex((w) => s.from >= w.from && s.from < w.to);
    if (k < 0) continue;
    out[k][0] = Math.min(out[k][0], s.t); out[k][1] = Math.max(out[k][1], s.t + s.dur);
  }
  // A word with no syllable (a lone dash) sits at the end of the one before.
  out.forEach((g, k) => { if (g[0] === Infinity) { const p = k ? out[k - 1][1] : 0; g[0] = p; g[1] = p; } });
  return out;
}

// estimateAlign(text, samples, sr) => { text, by: 'estimate', words }: the grid stretched linearly over the
// voiced part, then each pause in the copy that lands near a silence in the recording pinned to it (a
// monotone match, cheapest total distance, so a take that pauses where the commas are reads right and one
// that runs on is left linear), and the words between two pins stretched over the speech between them.
export function estimateAlign(text, x, sr = SR) {
  text = String(text);
  const words = wordsOf(text);
  if (!words.length) return { text, by: 'estimate', words: [] };
  const { span, gaps } = silences(x, sr), grid = gridOf(text, words);
  const [v0, v1] = span ?? [0, x.length / sr], G = grid[grid.length - 1][1] || 1;
  const lin = (g) => v0 + (g / G) * (v1 - v0);
  // The copy's pauses (between word k and k + 1) against the recording's silences.
  const P = [];
  words.forEach((w, k) => { const s = pauseAfter(w.text); if (s && k < words.length - 1) P.push({ k, s, at: lin((grid[k][1] + grid[k + 1][0]) / 2) }); });
  const tol = Math.max(0.6, 0.15 * (v1 - v0));
  const n = P.length, m = gaps.length, cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)), how = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  const skipP = (i) => (P[i].s === 2 ? 1.2 : 0.6) * tol, skipG = (j) => 0.3 * tol + (gaps[j][1] - gaps[j][0]);
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (!i && !j) continue;
    let best = Infinity, h = 0;
    if (i && cost[i - 1][j] + skipP(i - 1) < best) { best = cost[i - 1][j] + skipP(i - 1); h = 1; }
    if (j && cost[i][j - 1] + skipG(j - 1) < best) { best = cost[i][j - 1] + skipG(j - 1); h = 2; }
    if (i && j) {
      const d = Math.abs(P[i - 1].at - (gaps[j - 1][0] + gaps[j - 1][1]) / 2);
      if (d < tol && cost[i - 1][j - 1] + d < best) { best = cost[i - 1][j - 1] + d; h = 3; }
    }
    cost[i][j] = best; how[i][j] = h;
  }
  // Pins: grid time -> recording time, from the ends and every matched pause.
  const pins = [[0, v0], [G, v1]];
  for (let i = n, j = m; i || j;) {
    const h = how[i][j];
    if (h === 3) { const { k } = P[i - 1], [a, b] = gaps[j - 1]; pins.push([grid[k][1], a], [grid[k + 1][0], b]); i--; j--; } else if (h === 1) i--; else j--;
  }
  pins.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const map = (g) => {
    let k = 0;
    while (k < pins.length - 2 && g > pins[k + 1][0]) k++;
    const [ga, ta] = pins[k], [gb, tb] = pins[k + 1];
    return gb > ga ? ta + ((g - ga) / (gb - ga)) * (tb - ta) : ta;
  };
  return { text, by: 'estimate', words: words.map((w, k) => ({ text: w.text, t0: r3(map(grid[k][0])), t1: r3(Math.max(map(grid[k][0]), map(grid[k][1]))) })) };
}

// ---------- another tool's words ----------

// fitWords(text, [{ text, t0, t1 }], by) => { text, by, words }: a transcriber's words (its own spelling,
// punctuation and splits) laid onto the copy's words by a word-level edit distance: a word both have (or one
// spelt differently in the same place) takes the tool's times, a copy word the tool missed shares the time
// between its neighbours, a word the tool heard that the copy lacks is dropped. With no text, the tool's
// words are the copy.
export function fitWords(text, got, by = 'json') {
  const heard = (got ?? []).map((w) => ({ text: String(w.text ?? w.word ?? '').trim(), t0: +(w.t0 ?? w.start), t1: +(w.t1 ?? w.end) }))
    .filter((w) => w.text && Number.isFinite(w.t0) && Number.isFinite(w.t1));
  if (text === undefined || text === null || !String(text).trim()) text = heard.map((w) => w.text).join(' ');
  text = String(text);
  const words = wordsOf(text), a = words.map((w) => normWord(w.text)), b = heard.map((w) => normWord(w.text));
  const n = a.length, m = b.length, D = Array.from({ length: n + 1 }, (_, i) => Float64Array.from({ length: m + 1 }, (__, j) => i + j));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : a[i - 1] && b[j - 1] ? 1.5 : 2));
  }
  const at = new Array(n).fill(null);
  for (let i = n, j = m; i && j;) {
    const sub = D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : a[i - 1] && b[j - 1] ? 1.5 : 2);
    if (D[i][j] === sub) { at[i - 1] = heard[j - 1]; i--; j--; } else if (D[i][j] === D[i - 1][j] + 1) i--; else j--;
  }
  // Runs of copy words the tool missed share [end of the one before, start of the one after].
  const out = words.map((w, k) => (at[k] ? { text: w.text, t0: at[k].t0, t1: Math.max(at[k].t0, at[k].t1) } : null));
  for (let k = 0; k < n;) {
    if (out[k]) { k++; continue; }
    let e = k;
    while (e < n && !out[e]) e++;
    const lo = k ? out[k - 1].t1 : (out[e]?.t0 ?? 0), hi = e < n ? out[e].t0 : lo + 0.3 * (e - k), step = Math.max(0, hi - lo) / (e - k);
    for (let q = k; q < e; q++) out[q] = { text: words[q].text, t0: lo + step * (q - k), t1: lo + step * (q - k + 1) };
    k = e;
  }
  for (let k = 1; k < n; k++) if (out[k].t0 < out[k - 1].t0) out[k].t0 = out[k].t1 = Math.max(out[k].t1, out[k - 1].t0);
  return { text, by, words: out.map((w) => ({ text: w.text, t0: r3(w.t0), t1: r3(w.t1) })) };
}

// trimGhosts(heard, { dur, voiced }) => the words minus the ones the audio never spoke: the trailing run that
// is zero-length or starts within 0.05 s of the file's end (whisper, given a prompt, repeats it there), and any
// word starting after the voiced span's end plus 0.3 s. `voiced` is wav.js voicedSpan's [t0, t1], or null.
export function trimGhosts(heard, { dur, voiced } = {}) {
  let out = [...(heard ?? [])];
  const t0 = (w) => +(w.t0 ?? w.start), t1 = (w) => +(w.t1 ?? w.end);
  while (out.length) {
    const w = out[out.length - 1];
    if (t1(w) - t0(w) <= 1e-9 || (Number.isFinite(dur) && t0(w) >= dur - 0.05)) out.pop(); else break;
  }
  if (voiced) out = out.filter((w) => !(t0(w) > voiced[1] + 0.3));
  return out;
}

// checkFitted(A, voiced): throws when the fitted words (first t0 to last t1) cover under half the voiced span,
// which is a tool's timing gone wrong (ghost words piled at one instant), not a take.
export function checkFitted(A, voiced) {
  if (!voiced || !A.words.length) return;
  const span = alignSpan(A), v = voiced[1] - voiced[0];
  if (span < 0.5 * v) {
    throw new Error(`align: the transcriber's timing covers only ${span.toFixed(2)} s of ${v.toFixed(2)} s voiced ` +
      '(a --json whose times are off, or whisper repeating a --prompt as ghost words); check the words, or store --estimate');
  }
}

// ---------- by id ----------

// The catalogue's stored form ([text, t0, t1] per word) and back.
export const packAlign = (A) => ({ text: A.text, by: A.by, words: A.words.map((w) => [w.text, w.t0, w.t1]) });
export const unpackAlign = (s) => ({ text: s.text, by: s.by, words: s.words.map((w) => (Array.isArray(w) ? { text: w[0], t0: w[1], t1: w[2] } : w)) });

// Everything wrong with a stored alignment, as sentences (core/assets.js validates the entry with it).
export function checkAlign(s) {
  if (!s || typeof s !== 'object') return ['align: { text, by, words: [[text, t0, t1], ...] }'];
  const bad = [];
  if (typeof s.text !== 'string') bad.push('align.text: the copy, a string');
  if (!['estimate', 'whisper', 'json'].includes(s.by)) bad.push("align.by: 'estimate', 'whisper' or 'json'");
  if (!Array.isArray(s.words) || !s.words.every((w) => Array.isArray(w) && w.length === 3 && typeof w[0] === 'string' && Number.isFinite(w[1]) && Number.isFinite(w[2]) && w[2] >= w[1])) bad.push('align.words: [text, t0, t1] each, t1 >= t0');
  else if (typeof s.text === 'string' && s.words.length !== wordsOf(s.text).length) bad.push(`align.words: ${s.words.length} of them, the copy has ${wordsOf(s.text).length}`);
  return bad;
}

const MEMO = new Map();

// alignOf(id, { text }) => { text, by, words: [{ text, t0, t1 }] } for the store's sample `id`, in the
// sample's seconds. The copy is `text`, else the stored alignment's, else the entry's desc. A stored
// alignment is used when its copy is this copy (compared as words, so punctuation and case may differ;
// the copy's own spelling is what comes back); otherwise the estimate, made once per process.
export function alignOf(id, { text } = {}) {
  const r = peek(id), stored = r?.align ? unpackAlign(r.align) : null;
  const copy = text ?? stored?.text ?? r?.desc;
  if (copy === undefined || copy === null || !String(copy).trim()) throw new Error(`align: sample '${id}' has no copy to align (hdf align ${id} --text "...", or say(text, t0, { voice }))`);
  const key = `${id}\u0000${copy}`;
  if (MEMO.has(key)) return MEMO.get(key);
  let A;
  if (stored && normText(stored.text) === normText(copy)) {
    const own = wordsOf(copy);
    A = own.length === stored.words.length ? { ...stored, text: String(copy), words: stored.words.map((w, k) => ({ ...w, text: own[k].text })) } : fitWords(copy, stored.words, stored.by);
  } else A = estimateAlign(copy, pcmOf(id).samples, SR);
  A = Object.freeze({ ...A, id, words: Object.freeze(A.words.map(Object.freeze)) });
  MEMO.set(key, A);
  return A;
}

// Forget the memo (a test that re-aligns a sample it changed, `hdf align` after it stores a new one).
export const clearAligns = () => MEMO.clear();

// How long the words run, first start to last end (s): what lint's caption-sync weighs an estimate by.
export const alignSpan = (A) => (A.words.length ? A.words[A.words.length - 1].t1 - A.words[0].t0 : 0);

// ---------- a line spoken from an alignment ----------

// spokenOf(A, t0) => text.js speech()'s shape for a recorded line starting at t0: { syllables: [{ text, from,
// to, t, dur }], letters (a time per char), dur, end } and mouth(t), the viseme at shot time t (null outside
// the line). A word's syllables share its spoken span and its letters arrive across it; a space or a stop
// appears as the word before it ends. The mouth cycles VISEMES over each syllable and rests shut between
// words. A voiced actor.say draws the recording's own mouth instead (4.0 V3, core/mouth.js).
export function spokenOf(A, t0 = 0) {
  const text = A.text, words = wordsOf(text), syllables = [], letters = new Array(text.length).fill(t0 + (A.words[0]?.t0 ?? 0));
  words.forEach((w, k) => {
    const { t0: a, t1: b } = A.words[k], len = w.to - w.from;
    const core = /[\p{L}\p{N}'’-]+/u.exec(w.text), start = w.from + (core?.index ?? 0);
    const parts = core ? syllablesOf(core[0]) : [w.text];
    let from = start;
    parts.forEach((p, q) => {
      const dur = (b - a) / parts.length;
      syllables.push({ text: p, from, to: from + p.length, t: t0 + a + q * dur, dur });
      from += p.length;
    });
    for (let c = w.from; c < w.to; c++) letters[c] = t0 + a + ((c - w.from) / len) * (b - a);
    for (let c = w.to; c < (words[k + 1]?.from ?? text.length); c++) letters[c] = t0 + b;
  });
  const last = A.words[A.words.length - 1], end = t0 + (last?.t1 ?? 0);
  const mouth = (t) => {
    if (t < t0 - 1e-9 || t >= end - 1e-9) return null;
    const s = syllables.find((y) => t >= y.t - 1e-9 && t < y.t + y.dur - 1e-9);
    return s ? VISEMES[Math.min(VISEMES.length - 1, Math.floor(((t - s.t) / s.dur) * VISEMES.length + 1e-9))] : 0;
  };
  return { syllables, letters, dur: end - t0, end, mouth };
}

// Reveal schedules (4.0 T6): a node written on at a reading speed, a unit at a time (glyph, word, line or
// stroke), with the pen lifted between units, so a drawn hand (packs/hands.js writer) can follow the tip.
//   writing(node, { at, per, wps, lead, lift, exit, wordLen }) => { p(t), pen(t), start, end, units }
//   writeOn(node, { t, ...the same })   what reveal(p, node) returns at shot time t
//   revealed(node, t, o)                how much of it is drawn at t (0..1), for lint's dwell rule
// The order is reveal's: stroke `order`, then list order. Lettering numbers its strokes from 0, so a stroke
// to be drawn after it (an underline) needs an order past the lettering's (order: 1e6).
// Times are shot seconds. A word of lettering takes 1 / wps seconds, its glyphs and strokes sharing it; a
// stroke that is not lettering (a diagram's line) counts as a word per `wordLen` units of its length.
import { currentHand } from './glyphs.js';
import { glyphUnits } from './text.js';
import { penAt, penStrokes, reveal } from './tools.js';
import { ease } from './curves.js';

const PER = ['glyph', 'word', 'line', 'stroke'];
const DEFAULTS = Object.freeze({ at: 0, per: 'word', wps: 2, lead: 0.4, lift: 0.15, exit: 0.4, wordLen: 240 });

// Each pen item's unit key and weight in words: a word of lettering weighs 1, shared equally by its glyphs
// and, within a glyph, by its strokes; a line's weight is its words. Other strokes weigh len / wordLen.
function unitsOf(strokes, o) {
  const glyphs = new Map(), word = new Map(), ids = new Map();
  const info = strokes.items.map((it) => {
    const T = it.text;
    if (!T) return null;
    if (!glyphs.has(T)) { glyphs.set(T, glyphUnits(T.op === 'text' ? T : T.name.slice(5))); ids.set(T, ids.size); }
    const g = glyphs.get(T)[it.gi] ?? { word: 0, line: 0 }, id = ids.get(T), w = `${id}:${g.word}`;
    if (!word.has(w)) word.set(w, new Map());
    const inWord = word.get(w);
    inWord.set(it.gi, (inWord.get(it.gi) ?? 0) + 1);
    return { ...g, w, id };
  });
  const units = [];
  strokes.items.forEach((it, i) => {
    const g = info[i];
    let key, weight;
    if (!g) { key = `s${i}`; weight = Math.max(0.25, it.len / o.wordLen); }
    else {
      const inWord = word.get(g.w);
      weight = 1 / inWord.size / inWord.get(it.gi);
      key = o.per === 'stroke' ? `s${i}` : o.per === 'glyph' ? `${g.id}:g${it.gi}` : o.per === 'word' ? g.w : `${g.id}:l${g.line}`;
    }
    const last = units[units.length - 1];
    if (last && last.key === key) { last.weight += weight; last.len += it.len; }
    else units.push({ key, weight, at: it.at, len: it.len });
  });
  return units.filter((u) => u.len > 0);
}

const memo = new WeakMap();

// The schedule of a node written on from `at`: `lead` seconds for the hand to come in, then each unit in
// turn, each after a lift of `lift` seconds (at most 0.4 of its time) from the last. p(t) is the reveal
// progress; pen(t) the pen: null before `at` and once it has gone, else { x, y, a, down, lift, enter, leave }
// in the node's coordinates, with lift 0..1 off the surface, enter 0..1 over the lead, leave 0..1 over `exit`
// after the last unit. per: 'glyph' | 'word' | 'line' | 'stroke'; wps: words a second.
export function writing(node, opts = {}) {
  const { t: _t, ...rest } = opts, o = { ...DEFAULTS, ...rest };
  if (!PER.includes(o.per)) throw new TypeError(`writeOn: per '${o.per}' is not one of ${PER.join(', ')}`);
  if (!(o.wps > 0)) throw new TypeError(`writeOn: wps must be a positive number of words a second, got ${o.wps}`);
  const key = JSON.stringify(o), hand = currentHand();
  let byNode = node && typeof node === 'object' ? memo.get(node) : null;
  const hit = byNode?.get(key);
  if (hit && hit.hand === hand) return hit.plan;
  const strokes = penStrokes(node), total = strokes.total || 1, start = o.at + o.lead;
  let t = start;
  const units = unitsOf(strokes, o).map((u, j) => {
    const slot = u.weight / o.wps, gap = j ? Math.min(o.lift, slot * 0.4) : 0;
    const out = { t0: t, t1: t + gap, t2: t + slot, p0: u.at / total, p1: (u.at + u.len) / total };
    t += slot;
    return out;
  });
  const end = t, tipAt = (p) => penAt(p, node, strokes);
  const p = (t) => {
    if (!units.length || t < start) return 0;
    if (t >= end) return 1;
    const u = units.find((q) => t < q.t2);
    return t < u.t1 ? u.p0 : u.p0 + (u.p1 - u.p0) * (t - u.t1) / (u.t2 - u.t1);
  };
  const pen = (t) => {
    if (!units.length || t < o.at || t >= end + o.exit) return null;
    if (t < start) return { ...tipAt(units[0].p0), down: false, lift: 1, enter: o.lead ? ease.io((t - o.at) / o.lead) : 1, leave: 0 };
    if (t >= end) return { ...tipAt(1), down: false, lift: 1, enter: 1, leave: ease.io((t - end) / o.exit) };
    const j = units.findIndex((q) => t < q.t2), u = units[j];
    if (t < u.t1) {
      // The lift: from the end of the last unit to the start of this one, off the surface in an arc.
      const k = (t - u.t0) / (u.t1 - u.t0), a = tipAt(units[j - 1].p1 - 1e-9), b = tipAt(u.p0 + 1e-9), e = ease.io(k);
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, a: b.a, down: false, lift: Math.sin(Math.PI * (0.15 + 0.7 * k)), enter: 1, leave: 0, item: b.item };
    }
    return { ...tipAt(Math.min(p(t), 1 - 1e-9)), down: true, lift: 0, enter: 1, leave: 0 };
  };
  const plan = { p, pen, start, end, units, dur: end - o.at };
  if (node && typeof node === 'object') {
    if (!byNode) memo.set(node, (byNode = new Map()));
    byNode.set(key, { hand, plan });
  }
  return plan;
}

// writeOn(node, { t, at, per, wps, lead, lift }) => reveal(p, node) at shot time t: the node written on a
// unit at a time at a reading speed (words a second; 2 by default, the audience's `read` in the recipes).
export const writeOn = (node, o = {}) => reveal(writing(node, o).p(o.t ?? 0), node);

// revealed(node, t, o) => 0..1: how much of the node writeOn has drawn at shot time t with the same options.
export const revealed = (node, t, o = {}) => writing(node, o).p(t);

// Marks: named moments a film is cut to (4.0 D4). They come from outside the film: a davidup composition's
// markers, its audio tracks' beats and its items' starts and ends (`hdf render --cues-from composition.json`),
// or another film's cue file (`hdf cues`). The CLI reads the file and sets them before it imports the film,
// so a film reads them while it builds its timeline:
//
//   const drop = atMark('drop', { or: 4.75 });                       // seconds, on the 1/12 s grid
//   const beats = marksNamed('beat', { or: [0, 0.5, 1, 1.5] });      // every one, in order
//   perform(SAM, [[0, 'idle'], [drop, 'cheer', { anticipate: 0.25 }]])
//   score: ({ marks }) => marks.filter((m) => m.name === 'beat').map((m) => tick(m.t))
//
// A mark is { t, name, from }: t in film seconds (0 is the film's first frame), `from` where it came from
// ('marker', 'audio:<track>', 'item:<id>', 'composition', 'cues:<film>'). `or` is what a film gets with no
// marks (the player, lint, a golden, a render with no --cues-from), so every film still renders on its own.
// Times are snapped to the drawing grid unless { snap: false }: a cut can only land on a drawn frame, so a
// cut on a beat is within half a frame (1/24 s) of it.
//
// This module holds no file access: the CLI and the player hand it the marks (marksOf reads the JSON).
import { FPS } from './curves.js';

let MARKS = Object.freeze([]);

const clean = (t) => +(+t).toFixed(6);
const byTime = (list) => list.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i).map(({ m }) => m);

// setMarks(list) sets the marks every film loaded after it reads; returns the ones it replaced.
export function setMarks(list = []) {
  if (!Array.isArray(list)) throw new TypeError('setMarks: expected a list of { t, name }');
  const prev = MARKS;
  MARKS = Object.freeze(byTime(list.map((m, i) => {
    if (!m || typeof m.name !== 'string' || !m.name || !Number.isFinite(m.t)) throw new TypeError(`setMarks: mark ${i} is not { t, name } (got ${JSON.stringify(m)})`);
    return Object.freeze({ t: clean(m.t), name: m.name, from: m.from ?? 'given' });
  })));
  return prev;
}

// The marks set now, sorted by time (frozen; [] when none were given).
export const marks = () => MARKS;

// A time on the drawing grid.
export const onGrid = (t) => Math.round(t * FPS) / FPS;

const pick = (name, from) => MARKS.filter((m) => m.name === name && m.t >= 0 && (from === undefined || m.from === from));
const summary = () => {
  const n = new Map();
  for (const m of MARKS) n.set(m.name, (n.get(m.name) ?? 0) + 1);
  return n.size ? [...n].map(([k, c]) => (c > 1 ? `${k} x${c}` : k)).join(', ') : 'none';
};

// atMark(name, { nth, or, snap, from }) => the time of the nth (from 0) mark with that name at or after the
// film's start. With none, `or` (a number); with no `or`, an error that lists the marks there are.
export function atMark(name, { nth = 0, or, snap = true, from } = {}) {
  const got = pick(name, from)[nth]?.t ?? or;
  if (got === undefined) throw new RangeError(`atMark: no mark '${name}'${nth ? ` #${nth}` : ''} (have: ${summary()}); pass { or: <seconds> } so the film renders without one`);
  if (!Number.isFinite(got)) throw new TypeError(`atMark '${name}': or must be seconds, got ${JSON.stringify(or)}`);
  return snap ? onGrid(got) : got;
}

// marksNamed(name, { or, snap, from }) => the times of every mark with that name at or after the film's start,
// in order; `or` (a list, default []) when there is none.
export function marksNamed(name, { or = [], snap = true, from } = {}) {
  const got = pick(name, from);
  const ts = got.length ? got.map((m) => m.t) : or;
  return snap ? ts.map(onGrid) : [...ts];
}

// ---------- reading marks from a file ----------

// Where each of an audio track's markers plays on the composition timeline, per marker a list of seconds. The
// same rules as davidup's src/schema/markers.ts (a marker is in source seconds: shifted by start - trimIn,
// dropped before trimIn or past the source, repeated every loop, cut at the track's end); a bridge test checks
// the two agree.
export function trackMarkerTimes(track, { assetDuration, compositionDuration } = {}) {
  const trimIn = track.trimIn ?? 0, dur = assetDuration;
  const period = dur !== undefined && dur - trimIn > 0 ? dur - trimIn : undefined;
  const end = track.end ?? (track.loop ? compositionDuration ?? Infinity : period !== undefined ? track.start + period : Infinity);
  return (track.markers ?? []).map((m) => {
    if (m.t < trimIn || (dur !== undefined && m.t > dur)) return [];
    const first = track.start + (m.t - trimIn);
    if (!track.loop || period === undefined) return first < end ? [first] : [];
    const out = [];
    for (let k = 0; k < 10000; k++) { const t = first + k * period; if (t >= end) break; out.push(t); }
    return out;
  });
}

const isComposition = (d) => !!d && typeof d === 'object' && !!d.composition && typeof d.items === 'object';
const isCueFile = (d) => !!d && typeof d === 'object' && d.kind === 'hdf-cues';

// When an item starts and ends on the composition timeline, and where the film's first frame falls: a video
// plays from `start` (its source from trimIn), anything else lives from `enter` to `exit`.
function span(item) {
  if (item.type === 'video') return { start: item.start ?? 0, end: item.end, zero: (item.start ?? 0) - (item.trimIn ?? 0) };
  return { start: item.enter, end: item.exit, zero: item.enter ?? 0 };
}

// marksOf(doc, { at }) => marks in film seconds, sorted, from
//   a davidup composition   its markers (by name; `from` their `source`, else 'marker'), each audio track's
//                           markers (by name, `from` 'audio:<id>') and its `<id>.start` / `<id>.end`, each
//                           video's `<id>.start` / `<id>.end` and any item's lifespan (`enter` / `exit`) as
//                           `<id>.start` / `<id>.end`, and `composition.end`;
//   a cue file (hdf cues)   'cut' at each cut, 'shot:<name>' and 'chapter' / 'chapter:<title>' at each
//                           start, 'note' at each note, 'word' at each spoken word, 'end';
//   { marks: [...] } or [...]   the marks as given.
// at: the composition item the film plays in (its id), so 0 is its first frame; or a number of composition
// seconds; 0 when absent. Marks before the film's start are dropped.
export function marksOf(doc, { at } = {}) {
  let out = [], zero = 0;
  if (isComposition(doc)) {
    const items = doc.items ?? {};
    if (typeof at === 'string') {
      const item = items[at];
      if (!item || typeof item !== 'object') throw new Error(`marksOf: the composition has no item '${at}' (items: ${Object.keys(items).join(', ') || 'none'})`);
      zero = span(item).zero;
    } else if (at !== undefined) zero = +at;
    const meta = doc.composition, dur = meta.duration;
    for (const m of meta.markers ?? []) out.push({ t: m.t, name: m.name, from: m.source ?? 'marker' });
    const durations = new Map((doc.assets ?? []).filter((a) => a?.type === 'audio').map((a) => [a.id, a.duration]));
    (doc.audio ?? []).forEach((track, i) => {
      const id = track.id ?? `audio[${i}]`, from = `audio:${id}`, adur = durations.get(track.asset);
      const times = trackMarkerTimes(track, { assetDuration: adur, compositionDuration: dur });
      (track.markers ?? []).forEach((m, j) => { for (const t of times[j]) out.push({ t, name: m.name, from }); });
      out.push({ t: track.start, name: `${id}.start`, from });
      const end = track.end ?? (!track.loop && adur !== undefined ? track.start + adur - (track.trimIn ?? 0) : undefined);
      if (end !== undefined) out.push({ t: end, name: `${id}.end`, from });
    });
    for (const [id, item] of Object.entries(items)) {
      if (!item || typeof item !== 'object') continue;
      const s = span(item);
      if (s.start !== undefined) out.push({ t: s.start, name: `${id}.start`, from: `item:${id}` });
      if (s.end !== undefined) out.push({ t: s.end, name: `${id}.end`, from: `item:${id}` });
    }
    if (Number.isFinite(dur)) out.push({ t: dur, name: 'composition.end', from: 'composition' });
  } else if (isCueFile(doc)) {
    if (at !== undefined) zero = typeof at === 'number' ? at : NaN;
    if (Number.isNaN(zero)) throw new Error(`marksOf: --at takes seconds for a cue file (got '${at}')`);
    const from = `cues:${doc.film ?? '?'}`;
    for (const t of doc.cuts ?? []) out.push({ t, name: 'cut', from });
    for (const s of doc.shots ?? []) out.push({ t: s.t0, name: `shot:${s.name}`, from });
    for (const c of doc.chapters ?? []) out.push({ t: c.t0, name: 'chapter', from }, { t: c.t0, name: `chapter:${c.title}`, from });
    for (const n of doc.notes ?? []) out.push({ t: n.t, name: 'note', from });
    for (const w of doc.words ?? []) out.push({ t: w.t0, name: 'word', from });
    if (Number.isFinite(doc.end)) out.push({ t: doc.end, name: 'end', from });
  } else if (Array.isArray(doc) || Array.isArray(doc?.marks)) {
    if (at !== undefined) zero = +at;
    out = (Array.isArray(doc) ? doc : doc.marks).map((m) => ({ t: m.t, name: m.name, from: m.from ?? 'given' }));
  } else {
    throw new TypeError('marksOf: expected a davidup composition, a cue file (hdf cues) or { marks: [{ t, name }] }');
  }
  const bad = out.find((m) => !Number.isFinite(m.t) || typeof m.name !== 'string' || !m.name);
  if (bad) throw new TypeError(`marksOf: a mark is not { t, name } (got ${JSON.stringify(bad)})`);
  return byTime(out.map((m) => ({ ...m, t: clean(m.t - zero) })).filter((m) => m.t >= -1e-9).map((m) => ({ ...m, t: Math.max(0, m.t) })));
}

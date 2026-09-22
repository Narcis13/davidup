// Performance (4.0 K4): direct an actor with a script of timed poses, not a state per frame.
//
//   const act = perform(SAM, [
//     [0, 'idle'],
//     [0.5, 'point-r', { ease: ease.out, dur: 0.25 }],
//     [1.5, { head: 10 }],
//     [2, ['cheer', 'happy'], { anticipate: 0.15, overshoot: 0.1 }],
//   ]);
//   SAM.place(x, y, s, act.state(t))            // or a recipe's `perform: act` (A, G, M, U, W, X, Z)
//   score: act.events(shot.t0)                  // a soft pluck as each named pose lands
//
// perform(actor, script, { dur, ease, on }) => { state(t), beats, end, events(t, e), actor, rest }
//   script   [t, target, opts?] in time order (shot seconds). target is
//              a name     a pose, an expression or a cycle of the actor's (its own, then the vocabulary's);
//                         'pose:sleep', 'emote:sleep', 'cycle:walk' say which when a name is more than one
//              an object  joints, moves and variants to set ({ head: 10, 'pupil.x': 4, eye: 'happy' })
//              a list     of those, taken in order ([ 'cheer', 'happy', { head: 4 } ])
//   opts     dur        seconds to blend into the target (default o.dur, 0.25)
//            ease       the blend's ease (a function or an ease name; default o.ease, 'io')
//            anticipate seconds before t spent moving a tenth of the change the other way first
//            overshoot  a fraction of the change to pass the target by, settled back over half the blend
//                       (at least a drawn two)
//            sound      false: no pluck for this entry in events() (the first entry, where it starts, has none)
//   o.on     the drawing rate in drawn frames (2: on the twos, the default; 1 on ones; 3 on threes)
//
// A named pose is the whole body: a key the last pose (or cycle) set that this one lacks goes back to rest.
// An expression is the whole face in the same way, and an object only changes the keys it names, until a
// later entry sets them. The first entry is where the performance starts (held from before its time, no
// blend); a key first touched later blends in from the actor's rest. A blend begins from wherever the key is
// at its start, so an entry that interrupts another's blend picks it up mid-move. A cycle is a moving target:
// it runs from its entry's time and is blended into like a pose. Variants (eye, mouth) switch half-way
// through the blend. state(t) is pure in t: evaluated on the drawing grid and quantised on each input's own
// step (the puppet's 2 degree joints), so where the pose holds the state is the same object's worth of
// numbers and the frames dedup.
//
// beats: [{ t, from, land, settle, names }] per entry: when it starts (from, anticipation included), lands and
// has settled. end: the last settle.
//
// layer(base, extra, { parts, weight, rest }) => a state, or t => state when either is a function or a
// performance: extra added to base on the named joints (parts, or every key of extra), as its change from rest
// times weight (default 1), so a walk carries a wave. dir and variants are not added: extra's win when weight
// is at least a half. rest is o.rest, else the performance's actor's (a performance knows it), else 0.
import { FPS, ease as EASE } from './curves.js';
import { VOCABULARY } from './actor.js';
import { note, pentHz } from '../recipes/score.js';

const REST = Symbol('rest');
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeFn = (e) => (typeof e === 'function' ? e : EASE[e] ?? (() => { throw new TypeError(`perform: unknown ease '${e}'`); })());
const isState = (v) => v && typeof v === 'object' && !Array.isArray(v);
const partOf = (k) => k.split('.')[0];
const NOT_ADDED = new Set(['dir', 'fallback']);

// perform(actor, script, o) => a performance (see the top of this file).
export function perform(actor, script, o = {}) {
  if (typeof actor !== 'function' || typeof actor.pose !== 'function') throw new TypeError('perform: expected an actor (actorOf(...)) and a script');
  if (!Array.isArray(script) || !script.length) throw new TypeError(`perform ${actor.name}: expected a script of [t, target, opts?] entries`);
  const { dur: DUR = 0.25, ease: EASE0 = 'io', on = 2 } = o;
  if (!(Number.isInteger(on) && on >= 1)) throw new TypeError(`perform ${actor.name}: on is a whole number of drawn frames, got ${on}`);
  const rest = actor.rest ?? {}, inputs = actor.inputs ?? {}, switches = new Set(actor.variantKeys ?? []);
  const restOf = (k) => (rest[k] !== undefined ? rest[k] : k === 'lift' ? 0 : REST);

  // ---------- targets ----------
  const vocab = () => actor.vocabulary;
  const cycleKeys = (name) => {
    const ks = new Set();
    for (let j = 0; j < 2 * FPS; j++) for (const k of Object.keys(actor.cycle(name, j / FPS) ?? {})) ks.add(k);
    return [...ks];
  };
  const asPose = (name) => ({ channel: 'body', names: [name], q: actor.pose(name) });
  const asEmote = (name) => ({ channel: 'face', names: [name], q: actor.emote(name) });
  // A cycle: its keys, each a function of the time since its entry; a key a frame lacks is at rest.
  const asCycle = (name, t0) => {
    const keys = cycleKeys(name), fn = {};
    for (const k of keys) fn[k] = (t) => { const v = actor.cycle(name, t - t0)?.[k]; return v === undefined ? restOf(k) : v; };
    return { channel: 'body', names: [name], fn };
  };
  const resolve = (target, t0, k) => {
    if (isState(target)) return [{ channel: 'patch', names: [], q: target }];
    if (Array.isArray(target)) return target.flatMap((x) => resolve(x, t0, k));
    if (typeof target !== 'string' || !target) throw new TypeError(`perform ${actor.name}: entry ${k} target must be a name, a state or a list of them, got ${JSON.stringify(target)}`);
    const [how, name] = target.includes(':') ? target.split(/:(.*)/s) : [null, target];
    if (how === 'pose') return [asPose(name)];
    if (how === 'emote') return [asEmote(name)];
    if (how === 'cycle') return [asCycle(name, t0)];
    if (how !== null) throw new TypeError(`perform ${actor.name}: '${target}' (pose:, emote: or cycle:)`);
    const v = vocab();
    if (v.poses.includes(name) || VOCABULARY.poses[name]) return [asPose(name)];
    if (v.expressions.includes(name) || VOCABULARY.expressions[name]) return [asEmote(name)];
    if (v.cycles.includes(name) || VOCABULARY.cycles[name]) return [asCycle(name, t0)];
    // A code cel or a doodle builder: whatever its own emote makes of the name, else its pose (which throws for
    // a puppet that has no such pose).
    const e = actor.emote(name);
    if (isState(e) && Object.keys(e).length) return [{ channel: 'face', names: [name], q: e }];
    return [asPose(name)];
  };

  // ---------- tracks ----------
  // key -> segments in time order: { s (start, anticipation included), t (entry), dur, settle, from, to(t),
  // e, ant, over, num }. A segment runs until the next begins.
  // owner: which channel last set a key, so a pose sends back to rest only what a pose put there (a cheer's
  // eye stays happy when an expression has made it so since).
  const tracks = new Map(), chans = { body: new Set(), face: new Set() }, owner = new Map(), beats = [];
  const valueAt = (key, t) => {
    const segs = tracks.get(key);
    if (!segs) return restOf(key);
    let j = segs.length - 1;
    while (j > 0 && segs[j].s > t + 1e-9) j--;
    return segs[j].s > t + 1e-9 ? restOf(key) : segAt(segs[j], t);
  };
  let last = -Infinity;
  script.forEach((entry, k) => {
    if (!Array.isArray(entry) || !Number.isFinite(entry[0])) throw new TypeError(`perform ${actor.name}: entry ${k} must be [t, target, opts?]`);
    const [t, target, q = {}] = entry;
    if (t < last - 1e-9) throw new TypeError(`perform ${actor.name}: entry ${k} at ${t} s is before the one before it (${last} s)`);
    last = t;
    const dur = Math.max(0, q.dur ?? DUR), e = easeFn(q.ease ?? EASE0), ant = k ? Math.max(0, q.anticipate ?? 0) : 0, over = k ? q.overshoot ?? 0 : 0;
    const settle = over ? Math.max(on / FPS, dur / 2) : 0;
    // key -> its target, a function of t; a key set by name in this entry is not sent back to rest by another.
    const to = new Map(), set = new Set(), names = [];
    for (const r of resolve(target, t, k)) {
      names.push(...r.names);
      const keys = r.fn ? Object.keys(r.fn) : Object.keys(r.q);
      if (r.channel !== 'patch') {
        for (const key of chans[r.channel]) if (!keys.includes(key) && !set.has(key) && owner.get(key) === r.channel) to.set(key, () => restOf(key));
        chans[r.channel] = new Set(keys);
      }
      for (const key of keys) {
        const v = r.fn ? r.fn[key] : r.q[key];
        to.set(key, typeof v === 'function' ? v : () => v);
        set.add(key);
        owner.set(key, r.channel);
      }
    }
    for (const [key, fn] of to) {
      const segs = tracks.get(key) ?? [];
      const num = typeof fn(t) === 'number' && !switches.has(key) && key !== 'dir';
      const s = k === 0 ? -Infinity : Math.max(num ? t - ant : t, segs.length ? segs[segs.length - 1].s : -Infinity);
      let from = k === 0 ? fn(t) : valueAt(key, s);
      if (num && from === REST) from = 0;
      segs.push({ s, t, dur: k === 0 ? 0 : dur, settle, from, to: fn, e, ant: num ? t - s : 0, over, num });
      tracks.set(key, segs);
    }
    const d0 = k ? dur : 0;
    beats.push(Object.freeze({ t, from: t - ant, land: t + d0, settle: t + d0 + settle, names: Object.freeze(names), sound: k > 0 && q.sound !== false && names.length > 0 }));
  });

  // ---------- evaluation ----------
  const step = (key) => (Array.isArray(inputs[key]) ? inputs[key][2] : null);
  const quantise = (key, v) => {
    const st = step(key) || (key === 'lift' ? 0.01 : 1e-4);
    return +(Math.round(v / st) * st).toFixed(6) || 0;   // never -0: it hashes apart from 0
  };
  const grid = (t) => Math.floor(t * FPS / on + 1e-9) * on / FPS;
  const state = (t) => {
    const u = grid(t), out = {};
    for (const key of tracks.keys()) {
      const v = valueAt(key, u);
      if (v === REST || v === undefined) continue;
      out[key] = typeof v === 'number' ? quantise(key, v) : v;
    }
    return out;
  };

  return Object.freeze({
    kind: 'perform', actor: actor.name, rest, state,
    beats: Object.freeze(beats),
    end: Math.max(...beats.map((b) => b.settle)),
    // A soft pluck as each named entry lands, rising through the pentatonic; placed with the shot at t.
    events: (t = 0, { gain = 0.12, oct = 1, type = 'triangle', len = 0.35 } = {}) => beats.filter((b) => b.sound)
      .map((b, j) => note(t + b.land, pentHz(oct + Math.floor(j / 5), j % 5), len, type, gain)),
  });
}

// One key's segment at t (not quantised).
function segAt(g, t) {
  const target = g.to(t);
  if (!g.num || typeof target !== 'number') {
    if (!g.dur) return t >= g.t - 1e-9 ? target : g.from;
    return t >= g.t + g.dur / 2 - 1e-9 ? target : g.from;
  }
  const change = g.to(g.t) - g.from;
  // Anticipation: a tenth of the change the other way, eased in over the seconds before t.
  const back = g.from - 0.1 * change * (g.ant ? 1 : 0);
  if (t < g.t - 1e-9) return g.from + (back - g.from) * EASE.io(clamp01((t - g.s) / (g.ant || 1)));
  const k = g.dur ? clamp01((t - g.t) / g.dur) : 1, main = back + (target - back) * g.e(k);
  if (!g.over) return main;
  // Overshoot: past the target by a fraction of the change as it lands, eased back over the settle.
  const bump = k < 1 ? g.e(k) : 1 - EASE.io(clamp01((t - g.t - g.dur) / (g.settle || 1)));
  return main + g.over * change * bump;
}

// layer(base, extra, { parts, weight, rest }) => a state or t => state (see the top of this file).
export function layer(base, extra, o = {}) {
  const { parts = null, weight = 1 } = o;
  const rest = o.rest ?? extra?.rest ?? base?.rest ?? {};
  const fnOf = (x) => (typeof x === 'function' ? x : x && typeof x.state === 'function' ? x.state : null);
  const fb = fnOf(base), fe = fnOf(extra);
  if (!fb && !isState(base)) throw new TypeError('layer: base is a state, t => state or a performance');
  if (!fe && !isState(extra)) throw new TypeError('layer: extra is a state, t => state or a performance');
  const want = parts && new Set(parts);
  const add = (b, x) => {
    const out = { ...b };
    for (const [k, v] of Object.entries(x)) {
      if (want && !want.has(partOf(k)) && !want.has(k)) continue;
      const r = typeof rest[k] === 'number' ? rest[k] : 0;
      if (typeof v === 'number' && !NOT_ADDED.has(k)) out[k] = +((typeof b[k] === 'number' ? b[k] : r) + weight * (v - r)).toFixed(6);
      else if (weight >= 0.5) out[k] = v;
    }
    return out;
  };
  if (!fb && !fe) return add(base, extra);
  return (t) => add(fb ? fb(t) : base, fe ? fe(t) : extra);
}

// The actor contract (plan 1.3): a cast member any recipe can direct, whether its drawing is data (a
// puppet), a cel written in code, or a doodle builder who(d, x, y, s, o) of the v1 cast. The recipe asks
// for states and merges them; the actor turns the merged state into a drawing.
//
//   const FOX = actorOf(puppet('fox'));
//   FOX.put(d, x, y, 70, { ...FOX.idle(tau), ...FOX.look(-1), ...FOX.emote('happy'), ...FOX.cycle('run', tau) })
//
//   actor.name, actor.box, actor.ground, actor.inputs     as a cel
//   actor.rest                      its inputs at rest (a puppet's rest pose; {} for a code cel, spec.rest)
//   actor.variantKeys               the inputs that switch between drawings rather than turn (eye, mouth)
//   actor(inputs)                   the cel call (keys that are not inputs are dropped)
//   actor.idle(t, seed)             breathing, a blink, a tail, on the twos grid        -> state
//   actor.look(dir)                 -1 .. 1: facing, the view, the head turn             -> state
//   actor.emote(name)               'happy' | 'sad' | 'confused' ... | 'dot' (none)       -> state
//   actor.pose(name, k)             a named pose, rest -> pose by k (0..1)              -> state
//   actor.cycle(name, t)            any declared cycle, else a two-pose bob, recorded   -> state
//   actor.vocabulary                { poses, cycles, expressions }: the names that apply to it
//   actor.reveal(tau, state)        itself in stroke order, 0..1                        -> list
//   actor.place(x, y, s, o)         the state drawn on the doodle stage                 -> group
//                                   (o.shadow: true or a strength: a contact shadow on its own floor, so an
//                                   actor further back stands on something; paint the far one first)
//   actor.place(x, y, s, fn, t)     the same for the state fn(t); a puppet's follow parts (4.0 K6: a tail, a
//                                   scarf) are settled from fn's history before t, so they lag and swing
//   actor.put(d, x, y, s, o, t)     the same, added to a doodle d as a mark the pen reveals
//   actor.follow(fn, t)             fn(t) with the follow parts settled from fn's history  -> state
//   actor.say(text, t0, o)          a line of speech from t0 (shot seconds)               -> fragment
//   actor.mouth(id, t, t0)          the mouth of the recording `id` at t (4.0 V3), started at t0 -> state
//   actor.face(id, t, t0, o)        a face track (4.0 K7: your face, filmed) at t: mouth, eyes, brows, pupils -> state
//   actor.hands(id, t, t0, o)       a hands track at t: each hand part with variants its nearest pose -> state
//
// A state is a plain object of inputs, so states merge with spread and the later one wins: a recipe writes
// idle first and a cycle last. Stage conventions are the v1 cast's (recipes/doodle.js): centred at (x, y),
// feet at y + .86 s, about 2 s tall; o also takes rot (about x, y) and hand ([x, y] in stage units: an arm
// reaches for it), and a code builder reads whatever else it knows (scarf, fright, w).
// 4.0 K5 (core/ik.js): o.reach ({ 'hand-r': [x, y] }, bent by o.elbow) puts a hand or foot on a stage point
// with two-bone IK, and `hand` reaches the same way on an arm with a forearm and a hand; a state carrying
// `walking` (walkTo's) draws meta('feet') for lint's foot-slide. actor.puppet, actor.stage and
// actor.cycleOf(name) are what reach, lookAt and walkTo read.
//
// A puppet derives everything from its payload: poses named like an emote win over the house table, cycles
// are its own, and the conventional parts (head, eye, mouth, tail, body, arm-l / arm-r) are what idle,
// look, emote and hand move; unknown parts stay still.
//
// The vocabulary (4.0 K3, packs/poses/biped.json): poses, cycles and expressions keyed on the standard biped
// part names. pose(), emote() and cycle() look in the puppet's own first and the vocabulary after, through
// known(), which drops what the puppet lacks: a stick has every name, the fox takes its arms, legs and face,
// the octopus its arms and eyes. A vocabulary entry applies to a puppet that has every part its `needs` names
// and keeps at least one key (so the octopus does not sit with its arms); one that does not apply is {} from
// pose() and a bob from cycle(). A variant may be a list, the first the puppet has winning (wink, else happy).
// A code cel or a doodle builder has no vocabulary: pose() is {} and its emote and cycle are as before.
// A cycle neither has falls back to a bob between rest and
// a lifted rest; a puppet with views (a turnaround) turns with look: -1 and 1 its side view, +-0.5 its
// three-quarter view and 0 its front when it has them (the side, or facing us chin up, when not), and it
// mirrors itself, so the stage does not. The drawing of a missing cycle carries meta('actor-cycle') so lint can say when it is on screen too long,
// and actor.fallbacks lists the cycles asked for and missing.
//
// Speech (plan S9): say(text, t0, { at, size, bubble, hold, seed }) times the line on the 1/12 s grid (a
// viseme cycle 0 -> 2 -> 3 -> 1 per syllable, core/text.js speech) and returns a fragment the recipe spreads
// into its shot: state(t) is the mouth variant ({} when silent), draw(t, x, y, s, o) the bubble with the words
// arriving letter by letter, drawn at the actor's own stage place (above the head, facing its way, kept on the
// 1080 stage; `at` puts the bubble's centre at a stage point instead), and events(t) the plucks, one per
// syllable, for a score that places the shot at t. An actor without a mouth part gets a three-stroke mouth
// drawn over it at spec.mouthAt ([x, y] in s units from its centre, as it faces right) while it speaks.
// With { voice: <sample id> } (4.0 V2) the line is that recording from t0: its letters, syllables and mouth
// follow the sample's word timing (core/align.js alignOf, the copy `text` or, when text is empty, the
// alignment's own), and events(t) is the voice itself, not plucks. The timing is read on first use, so a
// line built at a film's top level waits for the player to fetch its wav.
// 4.0 V3: a voiced line's mouth is the recording's own (core/mouth.js mouthFrom: the voice band's energy a
// frame, or the Rhubarb track `hdf align <id> --mouth` stored), a letter A to H or X a frame; the fragment's
// shape(t) is that letter, mouth(t) it as one of the four drawn mouths, state(t) it as the puppet's own
// mouth variant (a variant named by the letter, else by how many mouths the puppet has: mouthIndex).
// actor.mouth(id, t, t0 = 0) is the same mouth for a line with no bubble and no captions: { mouth } from the
// first voiced frame to the last, {} outside them or for an actor with no mouth part (the score places the
// voice itself, voice(id, t0)).
// 4.0 T9: the copy may run to several lines ('\n', or wrapped at `width`, 11 sizes by default), the bubble
// sized from the lines; `kind` is the bubble's (speech, thought, shout, whisper, caption: core/marks.js);
// `audience` sets the letter size (48 by its text scale) and the hold (its dwell, and at least the line's
// reading time on screen). draw's o.lane ([x0, x1]) keeps the bubble between two stage xs (dialogue's lanes).
import { FPS } from './curves.js';
import { pen } from './doodle.js';
import { celOverflow } from './lint.js';
import { bounds, ellipse, fill, group, meta, mmul, poly, rotate, scale, stroke, translate } from './list.js';
import { bubble as bubbleMark, BUBBLE_KINDS } from './marks.js';
import { hash32 } from './rand.js';
import { audienceOf, wordCount } from './audience.js';
import { LINE_H } from './layout.js';
import { handText, layout, measure, speech } from './text.js';
import { reveal as revealList } from './tools.js';
import { VIEW_DIRS } from './puppet.js';
import { cel } from './tree.js';
import BIPED from '../packs/poses/biped.json' with { type: 'json' };
import { pluckPerSyllable, voice as voiceEvent } from '../recipes/score.js';
import { alignOf, alignSpan, spokenOf } from './align.js';
import { mouthAt, mouthFrom, mouthIndex } from './mouth.js';
import { feetMeta, reach, reachIn } from './ik.js';
import { faceState, frameAt, handsState, trackOf } from './face.js';

const RAD = Math.PI / 180;
const TWOS = FPS / 2;                     // drawn twos: 6 states a second
const sign = (v) => (v < 0 ? -1 : 1);
const wrap180 = (a) => ((a + 540) % 360) - 180;

const deepFreeze = (o) => { if (o && typeof o === 'object') { for (const v of Object.values(o)) deepFreeze(v); Object.freeze(o); } return o; };
// The vocabulary: every biped knows how to point, shrug and cheer (see the top of this file and the file's
// `about`). Frozen through, so a film cannot edit the house's poses by accident.
export const VOCABULARY = deepFreeze(BIPED);

// Emotes as joint and variant changes, for a puppet with no pose of that name: the vocabulary's expressions.
// Variant picks that the puppet lacks are dropped; 'top' and 'mid' mean its last and middle mouth. Brows (4.0
// K1) are the standard biped names: brow-l on the left of the drawing, so a negative brow-l and a positive
// brow-r lift the inner ends (worried); `.y` slides them, up negative. A puppet without brows or a pupil
// takes the rest.
export const EMOTES = VOCABULARY.expressions;
const NO_VOCABULARY = Object.freeze({ poses: Object.freeze([]), cycles: Object.freeze([]), expressions: Object.freeze([]) });

// actorOf(src, spec) => actor. src is a puppet (puppet(id)), a cel (cel(...)), or a doodle builder.
// spec overrides any method and sets the stage fit: { name, height: 2, feet: .86 } for a puppet or a cel;
// { name, box, inputs, desc, size: 60, defaults } for a builder (they make its cel, drawn complete).
export function actorOf(src, spec = {}) {
  if (typeof src !== 'function') throw new TypeError('actorOf: expected a puppet, a cel or a doodle builder who(d, x, y, s, o)');
  const base = src.puppet ? fromPuppet(src, spec) : src.cel ? fromCel(src, spec) : fromBuilder(src, spec);
  const call = (inputs = {}) => base.make(inputs);
  const fallbacks = new Set();
  // 4.0 K6: a state function and a time. The state is fn(t); a puppet's follow parts are worked out from fn's
  // history (core/follow.js), so they lag behind their parents. A plain state draws them as it says.
  const follow = (fn, t) => {
    if (typeof fn !== 'function') throw new TypeError(`actor ${spec.name ?? base.name}: follow(stateAt, t) takes a state function of time`);
    if (!Number.isFinite(t)) throw new TypeError(`actor ${spec.name ?? base.name}: follow(stateAt, t) needs the time to read stateAt at`);
    const q = fn(t) ?? {};
    return base.settle ? { ...q, ...base.settle(fn, t) } : q;
  };
  const place0 = spec.place ?? base.place;
  const place = place0 && ((x, y, s, o = {}, t) => place0(x, y, s, typeof o === 'function' ? follow(o, t) : o));
  const bob = (name, t) => {
    fallbacks.add(name);
    const up = Math.floor(t * FPS / 3 + 1e-9) % 2;
    return { lift: up, fallback: name, ...(base.has('head') ? { head: up ? 4 : 0 } : {}) };
  };
  const captured = (src, kind, t, t0, o) => {
    const d = trackOf(src, kind), k = frameAt(d, t, t0);
    if (k < 0 || !base.pup) return {};
    const who = { rest: actor.rest, inputs: base.inputs, variantKeys: actor.variantKeys, emote: actor.emote, mouthFor: base.mouthFor };
    return kind === 'face' ? faceState(who, d, k, o) : handsState(who, d, k, o);
  };
  Object.defineProperty(call, 'name', { value: spec.name ?? base.name });   // a function's name is read-only
  const actor = Object.assign(call, {
    box: base.box,
    ground: base.ground,
    inputs: base.inputs,
    rest: spec.rest ?? base.rest ?? Object.freeze({}),
    variantKeys: base.variantKeys ?? Object.freeze([]),
    fallbacks,
    idle: spec.idle ?? base.idle ?? (() => ({})),
    look: spec.look ?? base.look ?? ((dir) => ({ dir: sign(dir) })),
    emote: spec.emote ?? base.emote ?? (() => ({})),
    pose: spec.pose ?? base.pose ?? (() => ({})),
    cycle: spec.cycle ?? ((name, t) => base.cycle?.(name, t) ?? bob(name, t)),
    reveal: spec.reveal ?? ((tau, state = {}) => revealList(tau, call(state))),
    place,
    follow,
    put: spec.put ?? base.put ?? ((d, x, y, s, o = {}, t) => d.mark((k) => revealList(k, actor.place(x, y, s, o, t)), spec.dur ?? 0.5)),
    say: spec.say ?? ((text, t0, o) => speak(actor, base, spec, text, t0, o)),
    mouth: spec.mouth ?? ((id, t, t0 = 0) => {
      if (!base.has('mouth') || !base.mouthFor) return {};
      const M = mouthFrom(id), k = Math.floor((t - t0) * FPS + 1e-9);
      if (k < M.from || k >= M.to) return {};
      const m = base.mouthFor(M.shapes[k]);
      return m === undefined ? {} : { mouth: m };
    }),
    // 4.0 K7: a face or hands track (hdf clip --kind face | hands; an id in the store or the track itself) at
    // t, started at t0, as this puppet's inputs (core/face.js); {} outside the track, or for a cel or a builder.
    face: spec.face ?? ((src, t, t0 = 0, o = {}) => captured(src, 'face', t, t0, o)),
    hands: spec.hands ?? ((src, t, t0 = 0, o = {}) => captured(src, 'hands', t, t0, o)),
    // 4.0 K5: the puppet (null for a code cel or a builder), the stage fit ({ xf, local, k }: the drawing's
    // matrix on the stage, a stage point in the drawing, the stage units per drawing unit at a size) and a
    // cycle's frame count and rate ({ n, fps, advance? }, or null), for core/ik.js.
    puppet: base.pup ?? null,
    stage: base.stage ?? null,
    cycleOf: base.cycleOf ?? (() => null),
  });
  // A puppet's vocabulary is worked out when first asked for; a code cel or a builder has none.
  Object.defineProperty(actor, 'vocabulary', { get: () => base.vocabulary?.() ?? NO_VOCABULARY, enumerable: true });
  if (!actor.place) actor.place = () => { throw new Error(`actor ${actor.name}: a doodle builder has put(), not place()`); };
  return actor;
}

// ---------- the stage fit shared by puppets and cels ----------

// A drawing with a box and a ground point, fitted to the v1 stage: height s units tall, feet at y + feet s,
// mirrored for dir -1, turned by rot about (x, y), lifted a little for a bob.
// selfFlip: the drawing mirrors itself for a negative dir (a puppet with views), so the stage does not.
function stager(name, box, ground, spec, selfFlip = false) {
  const H = spec.height ?? 2, FEET = spec.feet ?? 0.86, units = box[3] || 1;
  const xfOf = (x, y, s, { dir = 1, rot = 0, lift = 0 } = {}) => {
    const k = H * s / units;
    let m = translate(x, y);
    if (rot) m = mmul(m, rotate(rot));
    return mmul(mmul(mmul(m, translate(0, FEET * s - lift * 0.04 * H * s)), scale(selfFlip ? k : k * sign(dir), k)), translate(-ground[0], -ground[1]));
  };
  // A stage point in the drawing's own units (to aim an arm at it).
  const local = (x, y, s, o, [px, py]) => {
    const [a, b, c, d, e, f] = xfOf(x, y, s, o), det = a * d - b * c;
    return [(d * (px - e) - c * (py - f)) / det, (-b * (px - e) + a * (py - f)) / det];
  };
  const k = (s) => H * s / units;
  const placed = (x, y, s, o, kids) => group({ name: `actor:${name}`, xf: xfOf(x, y, s, o), cache: 'never' }, [
    ...kids,
    o.fallback ? meta('actor-cycle', { actor: name, cycle: o.fallback }) : null,
  ]);
  // A flat ink ellipse on the floor under the feet (y + feet s), sized by the figure's height (a rig box can be
  // far wider than the figure); it stays on the floor and shrinks as the actor lifts.
  const floorShadow = (x, y, s, { shadow, lift = 0 }) => {
    const k = shadow === true ? 0.22 : +shadow, rx = 0.28 * H * s / (1 + 0.1 * Math.max(0, lift));
    return fill(ellipse(x, y + FEET * s, rx, Math.max(2, rx * 0.14)), 'ink', { alpha: k, name: 'shadow' });
  };
  const wrapPlaced = (x, y, s, o, kids) => (o.shadow
    ? group({ name: `actor:${name}:grounded` }, [floorShadow(x, y, s, o), placed(x, y, s, o, kids)])
    : placed(x, y, s, o, kids));
  return { xfOf, local, k, wrapPlaced, top: FEET - H };
}

const pick = (inputs, o) => {
  const q = {};
  for (const k of Object.keys(o)) if (inputs[k] !== undefined) q[k] = o[k];
  return q;
};

// ---------- puppets ----------

function fromPuppet(p, spec) {
  const d = p.puppet, name = p.cel.name, inputs = p.cel.inputs, parts = new Set(p.parts);
  const has = (n) => parts.has(n);
  const variants = (n) => Object.keys(d.parts[n]?.variants ?? {});
  const make = (o) => p(pick(inputs, o));
  const views = p.views, st = stager(name, p.cel.box, p.ground, spec, !!views);

  // A variant key the puppet has, or nothing; 'top' / 'mid' index its keys.
  const variant = (n, want) => {
    const ks = variants(n);
    const key = want === 'top' ? ks[ks.length - 1] : want === 'mid' ? ks[Math.floor(ks.length / 2)] : String(want);
    if (!ks.includes(key)) return undefined;
    return typeof p.rest[n] === 'number' ? +key : key;   // a numbered variant (mouth 0..3) stays a number
  };
  const known = (state) => {
    const out = {};
    for (const [k, v] of Object.entries(state)) {
      if (!has(k) && p.moves?.[k] === undefined) continue;   // a part, or a part's slide or scale (pupil.x)
      if (variants(k).length) {
        // A list is an order of preference: the first variant the puppet has.
        const got = (Array.isArray(v) ? v : [v]).map((w) => variant(k, w)).find((w) => w !== undefined);
        if (got !== undefined) out[k] = got;
      } else if (!Array.isArray(v)) out[k] = v;
    }
    return out;
  };
  // A vocabulary entry for this puppet: its known keys, or null when it does not apply.
  // The vocabulary's body is a trunk above the hips: on a puppet whose body is its root (the fox, the
  // octopus) a turn of it would tip the whole figure off its feet, so it is dropped.
  const rootBody = has('body') && d.parts.body.parent === undefined;
  // Tempering: a vocabulary entry is scaled towards rest (turns and slides by 0.9, 0.8, ... on their grid)
  // until the figure stays in its box in every view whose rest does, so the octopus cheers as high as its
  // box allows and lint's cel-box holds for whatever the vocabulary asks. One factor for all of an entry's
  // states (a cycle keeps its shape); memoised per name.
  const fitDirs = views ? [...new Set(p.views.map((V) => VIEW_DIRS[V] ?? 1))].filter((dir) => !celOverflow(p({ ...p.rest, dir }))) : [undefined];
  const scaled = (q, f) => {
    if (f === 1) return q;
    const out = {};
    for (const [k, v] of Object.entries(q)) out[k] = typeof v === 'number' && k !== 'lift' ? Math.round(v * f / 2) * 2 : v;
    return out;
  };
  const inBox = (q) => fitDirs.every((dir) => !celOverflow(p({ ...p.rest, ...(dir === undefined ? {} : { dir }), ...q })));
  const tempers = new Map();
  const temper = (name, states) => {
    if (!tempers.has(name)) {
      let f = 1;
      while (f > 0.05 && !states.every((q) => inBox(scaled(q, f)))) f = Math.round((f - 0.1) * 10) / 10;
      tempers.set(name, f);
    }
    return tempers.get(name);
  };
  const fits = (name, state) => {
    if (!(VOCABULARY.needs[name] ?? []).every(has)) return null;
    const q = known(state);
    if (rootBody) delete q.body;
    return Object.keys(q).length ? scaled(q, temper(name, [q])) : null;
  };
  const vcycle = new Map();   // name -> its frames through known(), with the stage lift kept (or null)
  const vocabCycle = (name) => {
    if (!vcycle.has(name)) {
      const c = VOCABULARY.cycles[name];
      let frames = c && (VOCABULARY.needs[name] ?? []).every(has) ? c.frames.map(({ lift, ...q }) => {
        const f = known(q);
        if (rootBody) delete f.body;
        return { ...f, ...(lift ? { lift } : {}) };
      }) : null;
      if (frames && !frames.some((f) => Object.keys(f).some((k) => k !== 'lift'))) frames = null;
      if (frames) { const k = temper(name, frames); frames = frames.map((f) => scaled(f, k)); }
      vcycle.set(name, frames && { fps: c.fps ?? FPS, frames });
    }
    return vcycle.get(name);
  };
  // What applies, worked out the first time it is asked for (it draws every entry to temper it).
  let listed = null;
  const vocabulary = () => (listed ??= Object.freeze({
    poses: Object.freeze([...new Set([...Object.keys(d.poses ?? {}).filter((n) => n !== 'rest'), ...Object.keys(VOCABULARY.poses).filter((n) => fits(n, VOCABULARY.poses[n]))])]),
    cycles: Object.freeze([...new Set([...p.cycles, ...Object.keys(VOCABULARY.cycles).filter((n) => vocabCycle(n))])]),
    expressions: Object.freeze(Object.keys(VOCABULARY.expressions).filter((n) => d.poses?.[n] || fits(n, VOCABULARY.expressions[n]))),
  }));
  const blinkKey = ['sleep', 'shut', 'closed'].find((k) => variants('eye').includes(k));
  // What core/ik.js needs of this actor inside place() (the actor itself is made from what this returns).
  const STAGE = Object.freeze({ xf: st.xfOf, local: st.local, k: st.k }), me = { name, puppet: p, stage: STAGE };

  return {
    name, box: p.cel.box, ground: p.ground, inputs, make, has, top: st.top, rest: p.rest,
    pup: p, stage: STAGE,
    // 4.0 K6: the follow parts from a state function's history; a stage lift (4% of the height a unit) is
    // that many drawing units, so a jump swings a scarf.
    settle: p.follows?.length ? (fn, t) => p.settle(fn, t, { lift: 0.04 * (p.cel.box[3] || 1) }) : null,
    // A cycle's frame count and rate, its own before the vocabulary's; its `advance` (4.0 K7: a retargeted
    // cycle's stride, a box height a unit, one a frame) when it carries one.
    cycleOf(what) {
      const own = d.cycles?.[what], c = own?.frames?.length ? own : vocabCycle(what);
      if (!c) return null;
      const adv = own?.advance;
      return { n: c.frames.length, fps: c.fps ?? FPS, ...(Array.isArray(adv) && adv.length === c.frames.length && adv.every(Number.isFinite) ? { advance: adv } : {}) };
    },
    variantKeys: Object.freeze(p.parts.filter((n) => variants(n).length)),
    // Viseme v as the puppet's mouth: its v-th variant, or its last when it has fewer.
    mouthOf(v) {
      const ks = variants('mouth');
      return ks.length ? variant('mouth', ks[Math.min(v, ks.length - 1)]) : undefined;
    },
    // A mouth shape (A to H, X: core/mouth.js) as the puppet's mouth: a variant named by the letter (X falling
    // back to A), else the index mouthIndex gives for its count.
    mouthFor(shape) {
      const ks = variants('mouth');
      if (!ks.length) return undefined;
      const named = [shape, shape === 'X' ? 'A' : null].find((k) => k && ks.includes(k));
      return variant('mouth', named ?? ks[mouthIndex(shape, ks.length)]);
    },
    idle(t, seed = 0) {
      const j = Math.floor(t * TWOS + 1e-9), u = j / TWOS, ph = seed * 1.7;
      const out = {};
      if (has('body')) out.body = Math.round(Math.sin(u * 2.4 + ph) * 1) * 2;
      if (has('head')) out.head = Math.round(Math.sin(u * 1.3 + ph) * 1.5) * 2;
      if (has('tail')) out.tail = Math.round(Math.sin(u * 3.1 + ph) * 3) * 2;
      if (blinkKey && (j + seed * 7) % 17 === 0) out.eye = blinkKey;
      return out;
    },
    look(dir) {
      if (views) {
        // Snapped to the views on a half step; a view the puppet lacks gives way to the side.
        const want = Math.round(Math.max(-1, Math.min(1, dir)) * 2) / 2, s = sign(want);
        if (want === 0 && p.viewOf(0) === 'front') return { dir: 0, ...(has('head') ? { head: 0 } : {}) };
        if (Math.abs(want) === 0.5 && p.viewOf(0.5) === 'three-quarter') return { dir: want, ...(has('head') ? { head: 0 } : {}) };
        if (want !== 0) return { dir: s, ...(has('head') ? { head: 0 } : {}) };
      }
      const out = { dir: dir === 0 ? 1 : sign(dir) };
      if (has('head')) out.head = dir === 0 ? -6 : 0;   // 0: facing us, chin up
      return out;
    },
    vocabulary,
    emote(what) {
      if (d.poses?.[what]) return known(d.poses[what]);
      return EMOTES[what] ? known(EMOTES[what]) : {};
    },
    // Rest -> the pose by k: joints and moves lerp from the puppet's rest, variants switch at k >= 0.5. Its own
    // pose first, then the vocabulary's (only when it applies); a name in neither is an error.
    pose(what, k = 1) {
      const target = d.poses?.[what] ? known(d.poses[what]) : VOCABULARY.poses[what] ? fits(what, VOCABULARY.poses[what]) ?? {} : null;
      if (!target) throw new Error(`actor ${name}: no pose '${what}' (has ${vocabulary().poses.join(', ') || 'none'})`);
      if (k >= 1) return target;
      const out = {};
      for (const [key, v] of Object.entries(target)) {
        const r = p.rest[key] ?? 0;
        if (typeof v === 'number' && typeof r === 'number' && !variants(key).length) out[key] = r + (v - r) * k;
        else if (k >= 0.5) out[key] = v;
      }
      return out;
    },
    cycle(what, t) {
      const own = d.cycles?.[what];
      const c = own?.frames?.length ? own : vocabCycle(what);
      if (!c) return undefined;
      const n = c.frames.length, j = ((Math.floor(t * (c.fps ?? FPS) + 1e-9) % n) + n) % n;
      const { lift, ...q } = c.frames[j];
      // A frame's lift (a retargeted gallop, 3.0 S14) is in puppet units; the stage's lift is in 4% of its
      // height, which is what the vocabulary's frames already carry.
      if (!own) return lift ? { ...q, lift } : q;
      return lift ? { ...q, lift: lift / (0.04 * (p.cel.box[3] || 1)) } : q;
    },
    place(x, y, s, o = {}) {
      const { shadow: _s, ...q } = o;
      if (o.fright && (has('arm-l') || has('arm-r'))) {
        if (has('arm-l')) q['arm-l'] = (q['arm-l'] ?? p.rest['arm-l'] ?? 0) + 40 * o.fright;
        if (has('arm-r')) q['arm-r'] = (q['arm-r'] ?? p.rest['arm-r'] ?? 0) - 40 * o.fright;
      }
      if (o.hand) {
        // The arm on the hand's side turns so it points at it (arms hang down, +y, at 0 degrees), or, with a
        // forearm, reaches it (4.0 K5). A puppet that mirrors itself is aimed in its own, unmirrored, drawing.
        let [hx, hy] = st.local(x, y, s, o, o.hand);
        if (views && (o.dir ?? p.rest.dir) < 0) hx = 2 * p.ground[0] - hx;
        const side = hx >= 0 ? 'r' : 'l', arm = `arm-${side}`;
        if (has(arm) && has(`fore-${side}`) && has(`hand-${side}`)) Object.assign(q, reachIn(me, `hand-${side}`, [hx, hy], { ...o, ...q }));
        else {
          const piv = has(arm) && (views ? p.pivotAt(arm, p.viewOf(o.dir ?? p.rest.dir)) : d.parts[arm].pivot);
          if (piv) q[arm] = wrap180(Math.atan2(-(hx - piv[0]), hy - piv[1]) / RAD);
        }
      }
      // 4.0 K5: reach: { 'hand-r': [x, y], ... } (stage points; elbow: o.elbow) and a walk's feet for lint.
      if (o.reach) for (const [part, at] of Object.entries(o.reach)) Object.assign(q, reach(me, part, at, { at: [x, y, s], state: { ...o, ...q }, elbow: o.elbow }));
      const feet = o.walking ? feetMeta(me, [x, y, s], { ...o, ...q }) : null;
      return st.wrapPlaced(x, y, s, o, feet ? [make(q), feet] : [make(q)]);
    },
  };
}

// ---------- cels written in code ----------

// A code cel: the film supplies idle / look / emote / cycle in spec (the cel knows nothing of them); dir,
// rot and lift are the stage's, the rest go to the cel as inputs it declares.
function fromCel(c, spec) {
  const { name, box, inputs } = c.cel, st = stager(name, box ?? [-50, -100, 100, 100], spec.ground ?? [0, 0], spec);
  return {
    name, box, ground: spec.ground ?? [0, 0], inputs, has: () => false, top: st.top,
    stage: Object.freeze({ xf: st.xfOf, local: st.local, k: st.k }),
    make: (o) => c(pick(inputs, o)),
    place: (x, y, s, o = {}) => st.wrapPlaced(x, y, s, o, [c(pick(inputs, o))]),
  };
}

// ---------- doodle builders (the v1 cast: hog, spark, bird) ----------

// A builder draws itself into the recipe's doodle, so put() is the builder, and the states are its own
// options: dir, eye (the emote's name) and a run phase. Its cel is the builder drawn complete by one pen.
function fromBuilder(fn, spec) {
  const name = spec.name ?? fn.name ?? 'cast', size = spec.size ?? 60, defaults = spec.defaults ?? {};
  const box = spec.box ?? [-2.4 * size / 2, -1.3 * size, 2.4 * size, 2.2 * size], inputs = spec.inputs ?? {};
  let made = null;
  const theCel = () => (made ??= cel(name, (q) => [
    pen(99, 0, -9, 3, (d) => fn(d, 0, 0, size, { ...defaults, ...q }), { still: true }),
  ], { box, inputs, desc: spec.desc }));
  return {
    name, box, ground: [0, 0.86 * size], inputs, has: () => false, top: box[1] / size, rest: Object.freeze({ ...defaults }),
    make: (o) => theCel()(o),
    emote: (what) => ({ eye: what === 'sad' ? 'sleep' : what }),
    // A run is its run phase; a walk is the recipe's own bob and sway (v1), so it asks nothing of the builder.
    cycle: (what, t) => (what === 'run' ? { run: t * 15 } : what === 'walk' ? {} : undefined),
    put: fn,
  };
}

// ---------- speech ----------

// The three strokes of a drawn mouth for each viseme, in mouth widths (facing right, y down): upper lip,
// lower lip, and a tongue, tooth line or dimple. 0 shut, 1 a little open, 2 wide, 3 a smile (the fox's four).
const MOUTHS = [
  [[[-0.5, 0], [0, 0.04], [0.5, 0]], [[-0.5, 0], [0, 0.06], [0.5, 0]], [[-0.12, 0.03], [0.12, 0.03]]],
  [[[-0.32, 0], [0, -0.1], [0.32, 0]], [[-0.32, 0], [0, 0.24], [0.32, 0]], [[-0.1, 0.12], [0.1, 0.12]]],
  [[[-0.45, 0], [0, -0.16], [0.45, 0]], [[-0.45, 0], [0, 0.48], [0.45, 0]], [[-0.18, 0.3], [0, 0.22], [0.18, 0.3]]],
  [[[-0.5, -0.1], [0, 0.08], [0.5, -0.1]], [[-0.5, -0.1], [0, 0.22], [0.5, -0.1]], [[-0.6, -0.16], [-0.48, -0.04]]],
];
function mouthMark(x, y, s, v, dir) {
  const W = 0.22 * s, w = Math.max(1.4, s * 0.055);
  return group({ name: 'mouth' }, MOUTHS[v].map((pts, k) => stroke(poly(pts.map(([u, q]) => [x + u * W * dir, y + q * W]), false), 'ink', { w, wobble: 0, name: `m${k}` })));
}

const MARGIN = 24, STAGE = 1080;
const clampTo = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

function speak(actor, base, spec, text, t0, o = {}) {
  const vid = o.voice ?? null;
  text = vid && (text === null || text === undefined || text === '') ? null : String(text);
  if (!Number.isFinite(t0)) throw new TypeError(`actor ${actor.name}: say('${text}', t0) needs a start time`);
  if (vid !== null && (typeof vid !== 'string' || !vid)) throw new TypeError(`actor ${actor.name}: say voice must be a sample id, got ${JSON.stringify(vid)}`);
  // Everything that reads the timing, made once: at once for a synth line (as it always was), on first use
  // for a voiced one (its alignment may need a wav the player has not fetched yet).
  let L = null;
  const line = () => L ??= lineOf(actor, base, spec, text, t0, o, vid);
  if (!vid) line();
  const talks = base.has('mouth');
  return Object.freeze({
    kind: 'say', actor: actor.name, t0, ...(vid ? { voice: vid } : {}),
    get text() { return line().text; },
    get end() { return line().sp.end; },
    get until() { return line().until; },
    get syllables() { return line().sp.syllables; },
    mouth: (t) => line().mouth(t),
    shape: (t) => line().shape(t),
    state(t) {
      const v = line().mouth(t);
      if (v === null || !talks) return {};
      const m = vid ? base.mouthFor?.(line().shape(t)) : base.mouthOf?.(v);
      return m === undefined ? {} : { mouth: m };
    },
    draw: (t, x, y, s, q) => line().draw(t, x, y, s, q),
    events: (t = 0, e = {}) => line().events(t, e),
  });
}

function lineOf(actor, base, spec, text, t0, o, vid) {
  const A = vid ? alignOf(vid, text === null ? {} : { text }) : null;
  if (A) text = A.text;
  const aud = o.audience === undefined ? null : audienceOf(o.audience);
  const { at = null, size = aud ? Math.round(48 * aud.text) : 48, bubble = true, kind = 'speech', seed = hash32('say', actor.name, text) } = o;
  if (!BUBBLE_KINDS.includes(kind)) throw new TypeError(`actor ${actor.name}: say kind '${kind}' (${BUBBLE_KINDS.join(', ')})`);
  const sp = A ? spokenOf(A, t0) : speech(text, t0);
  // Held after the last word: 0.75 s, or with an audience its dwell, and long enough that the whole line has
  // been up for its reading time.
  const hold = o.hold ?? (aud ? Math.max(aud.dwell, t0 + wordCount(text) / aud.read - sp.end) : 0.75);
  const until = sp.end + hold, talks = base.has('mouth');
  // A recorded line's mouth is the recording's (4.0 V3): its letter a frame, shut before the track starts or
  // after it ends; as one of the four drawn mouths for mouth(t). A synth line cycles its visemes.
  const M = A ? mouthFrom(vid) : null;
  const shape = (t) => (t < t0 - 1e-9 || t >= sp.end - 1e-9 ? null : M ? mouthAt(M, t - t0) ?? 'X' : null);
  const mouth = A ? (t) => { const s = shape(t); return s === null ? null : mouthIndex(s, 4); }
    : (t) => (t < t0 - 1e-9 || t >= sp.end - 1e-9 ? null : sp.steps[Math.floor((t - t0) * FPS + 1e-9)] ?? 0);
  // The copy in lines: '\n' breaks, and a line wider than `width` wraps (4.0 T9). One line letters as it always
  // has; several are one lettering, centred, the bubble sized from the widest.
  const L = layout(text, { size, w: o.width ?? size * 11, align: 'center' }).lines;
  const one = L.length === 1 && L[0].str === text, lineH = size * LINE_H;
  const tw = one ? measure(text, size) : Math.max(...L.map((l) => l.w)), bw = tw + size * 1.2, bh = size * 1.9 + (L.length - 1) * lineH;
  const words = handText(one ? text : L.map((l) => l.str).join('\n'), 0, 0, { size, align: 'center', role: 'ink', ink2: null, w: size * 0.07, seed, ...(one ? {} : { lineH }) });
  // Each glyph's character in the copy (the lines drop the spaces and breaks they wrap at).
  const charOf = [];
  let pos = 0;
  for (const l of L) {
    const at0 = text.indexOf(l.str, pos), from = at0 < 0 ? pos : at0;
    for (let c = 0; c < l.str.length; c++) charOf.push(Math.min(text.length - 1, from + c));
    pos = from + l.str.length;
  }
  const glyphOf = (op) => parseInt(op.name.slice(1), 10);
  // How far the bubble's outline reaches past its box (left, top, right, bottom): a shout's spikes and a
  // thought's lobes do, so the stage keeps them on it; a speech bubble's wobble is not counted.
  const reach = [0, 0, 0, 0];
  if (bubble && (kind === 'shout' || kind === 'thought')) {
    const b = bounds(bubbleMark([0, 0, bw, bh], null, { kind, seed, w: Math.max(2, size * 0.07) }).kids);
    reach.splice(0, 4, Math.max(0, -b[0]), Math.max(0, -b[1]), Math.max(0, b[0] + b[2] - bw), Math.max(0, b[1] + b[3] - bh));
  }
  return {
    text, sp, until, mouth, shape,
    draw(t, x, y, s, q = {}) {
      if (t < t0 - 1e-9 || t >= until - 1e-9) return null;
      const dir = (q.dir ?? 1) < 0 ? -1 : 1, head = [x + dir * 0.15 * s, y + base.top * s], tip = [head[0], head[1] - 0.14 * s];
      const [lo, hi] = q.lane ?? [MARGIN, STAGE - MARGIN], [ol, ot, or, ob] = reach;
      const [cx, cy] = at ?? [
        clampTo(head[0] + dir * bw * 0.3, lo + ol + bw / 2, hi - or - bw / 2),
        clampTo(tip[1] - 0.5 * s - ob - bh / 2, MARGIN + ot + bh / 2, STAGE - MARGIN - ob - bh / 2),
      ];
      const box = [cx - bw / 2, cy - bh / 2, bw, bh];
      const inBox = tip[0] > box[0] && tip[0] < box[0] + bw && tip[1] > box[1] && tip[1] < box[1] + bh;
      const shown = (gi) => sp.letters[charOf[gi]] <= t + 1e-9;
      const letters = group({ name: `text:${text}`, xf: translate(cx, cy + size * 0.36 - (L.length - 1) * lineH / 2) }, words.kids.filter((op) => shown(glyphOf(op))));
      const v = mouth(t), mx = spec.mouthAt;
      return group({ name: `say:${actor.name}`, cache: 'never' }, [
        A && meta('captions', { id: vid, by: A.by, span: alignSpan(A) }),
        bubble && bubbleMark(box, inBox || kind === 'caption' ? null : tip, { kind, seed, w: Math.max(2, size * 0.07) }),
        letters,
        !talks && mx && v !== null ? mouthMark(x + mx[0] * s * dir, y + mx[1] * s, s, v, dir) : null,
      ]);
    },
    events: (t, e) => (A ? [voiceEvent(vid, t + t0, e.gain === undefined ? {} : { gain: e.gain })] : pluckPerSyllable(text, t + t0, { seed, ...e })),
  };
}

// Dialogue (4.0 T9): two or more actors taking turns, each turn an actor.say, scheduled so each line has
// been read before the reply starts, the listener facing the speaker, the speaker facing whom it talks to.
//
//   const talk = dialogue([[FOX, 'is that tea?'], [SAM, 'it was.', { kind: 'thought' }], ...], { t0: 0.5 })
//   const where = { fox: [300, 700, 110], sam: [780, 690, 120] }     // actor name -> [x, y, s] on the stage
//   FOX.place(...where.fox, { ...FOX.idle(t), ...talk.state(FOX, t, where) })
//   talk.draw(t, where)                                               // the bubbles
//   score: talk.events(shot.t0)
//
// dialogue(turns, { t0, gap, audience, ...say options }) => a fragment:
//   turns    [actor, text, { kind, emote, voice, hold, ... any say option }]: the actor says text, in a bubble
//            of that kind (speech, thought, shout, whisper, caption); `emote` is its expression while the line
//            is up. A voiced turn ({ voice: id }) takes its timing from the recording (the copy may be null).
//   t0       when the first line starts, in shot seconds
//   gap      seconds between one line's last word and the next line's first; by default the time the reader
//            still needs for the line at the audience's reading speed (at least a quarter second), on the grid
//   where    actor name -> [x, y, s, o?] on the stage, when the actors stand still: the default for state and
//            draw, and it gives each actor a lane (its share of the stage between the midpoints to its
//            neighbours), so the copy wraps to fit it and two bubbles up at once never cross
//   audience a key of AUDIENCES (or a record): the reading speed, the hold of the last line, the letter size
//   hold     seconds the last line stays after its last word (by default the audience's: see actor.say)
//   gaze     true (4.0 K5): each actor also looks at the other's head (core/ik.js lookAt: the head turns and
//            the pupils slide), not only faces its way; needs `where` (or the where handed to state)
//
// A line's bubble stays up through the reply (so a question and its answer are on screen together, their
// bubbles leaning towards each other) and goes when that actor speaks again or the reply ends; the last line
// holds for its reading time. Every bubble keeps to its actor's lane when `where` places them. state(actor, t, where) is its mouth, the way it faces (look(dir) towards the
// actor it listens or talks to, when `where` places both) and its turn's emote; draw(t, where) the bubbles;
// events(t) every line's plucks or voice, placed with the shot at t. lines are the say fragments, turns
// [{ actor, text, t0, end, until, kind }]. Everything is worked out on first use, so a voiced turn waits for its wav.
import { FPS } from './curves.js';
import { audienceOf, wordCount } from './audience.js';
import { group } from './list.js';
import { lookAt } from './ik.js';

const onGrid = (s) => Math.ceil(s * FPS - 1e-6) / FPS;
const nameOf = (a) => a.name;

// dialogue(turns, { t0, gap, audience, where, hold, ...say options }) => a fragment of turns between actors:
// state(actor, t), draw(t), events(t), turns, lines, end, until (see the top of this file).
export function dialogue(turns, o = {}) {
  if (!Array.isArray(turns) || !turns.length) throw new TypeError('dialogue: expected a list of [actor, text, options] turns');
  turns.forEach((turn, k) => {
    if (!Array.isArray(turn) || typeof turn[0] !== 'function' || typeof turn[0].say !== 'function') throw new TypeError(`dialogue: turn ${k} must be [actor, text, options?]`);
  });
  const { t0 = 0, gap = null, audience = 'general', hold = null, where: stage = null, gaze = false, ...say } = o;
  if (!Number.isFinite(t0)) throw new TypeError(`dialogue: t0 must be a number, got ${t0}`);
  const A = audienceOf(audience);

  // Lanes: each placed actor's share of the stage, split halfway to its neighbours with a gutter between.
  const GUTTER = 16, MARGIN = 24, STAGE = 1080;
  const lanesOf = (where) => {
    const placed = [...new Set(turns.map(([a]) => a))].map((a) => [a, placeOf(where, a)]).filter(([, p]) => p).sort((a, b) => a[1][0] - b[1][0]);
    const out = new Map();
    placed.forEach(([a, p], j) => {
      const l = j ? (placed[j - 1][1][0] + p[0]) / 2 + GUTTER / 2 : MARGIN, r = j < placed.length - 1 ? (p[0] + placed[j + 1][1][0]) / 2 - GUTTER / 2 : STAGE - MARGIN;
      out.set(a, [l, r]);
    });
    return out;
  };
  const size = say.size ?? Math.round(48 * A.text);

  let S = null;
  const sched = () => S ??= schedule();
  function schedule() {
    const lanes = stage ? lanesOf(stage) : null;
    const opts = turns.map(([actor, , q = {}]) => {
      const { emote: _e, ...rest } = q, lane = lanes?.get(actor);
      // The copy wraps to its lane, less the bubble's margin.
      const width = lane ? Math.max(size * 3, lane[1] - lane[0] - (q.size ?? size) * 1.2) : undefined;
      return { audience, ...(width ? { width } : {}), ...say, ...rest };
    });
    // First pass: when each line starts and ends (a line's timing does not depend on its hold).
    const at = [];
    let t = t0;
    turns.forEach(([actor, text], k) => {
      const probe = actor.say(text, t, opts[k]);
      at.push({ t0: t, end: probe.end, text: probe.text });
      const need = wordCount(probe.text) / A.read - (probe.end - t);
      t = onGrid(probe.end + (gap ?? Math.max(0.25, need)));
    });
    // Second pass: each line held through the reply, and no longer than its speaker's next line.
    const lines = turns.map(([actor, text], k) => {
      const next = at[k + 1], again = at.findIndex((x, j) => j > k && turns[j][0] === actor);
      let until;
      if (!next) until = null;
      else if (turns[k + 1][0] === actor) until = next.t0;
      else until = Math.min(next.end + A.dwell, again >= 0 ? at[again].t0 : Infinity);
      const q = until === null ? { ...opts[k], ...(hold === null ? {} : { hold }) } : { ...opts[k], hold: Math.max(1 / FPS, until - at[k].end) };
      if (turns[k][2]?.hold !== undefined) q.hold = turns[k][2].hold;
      return actor.say(text, at[k].t0, q);
    });
    const info = lines.map((l, k) => Object.freeze({ actor: nameOf(turns[k][0]), text: l.text, t0: l.t0, end: l.end, until: l.until, kind: opts[k].kind ?? 'speech' }));
    return { lines, info };
  }

  // The turn being spoken or last spoken at t (its index), or 0 before the first.
  const turnAt = (t) => {
    const { info } = sched();
    let k = 0;
    while (k + 1 < info.length && info[k + 1].t0 <= t + 1e-9) k++;
    return k;
  };
  // Whom turn k's speaker talks to: the next other actor to speak, else the last one before it.
  const addressee = (k) => {
    const me = turns[k][0];
    return turns.slice(k + 1).find(([a]) => a !== me)?.[0] ?? turns.slice(0, k).reverse().find(([a]) => a !== me)?.[0] ?? null;
  };
  const placeOf = (where, actor) => where?.[nameOf(actor)] ?? (where instanceof Map ? where.get(actor) : undefined);
  // -1 or 1: the way an actor at `where` faces at t, or null when it cannot tell.
  const facing = (actor, t, where) => {
    const k = turnAt(t), speaker = turns[k][0], other = actor === speaker ? addressee(k) : speaker;
    const a = placeOf(where, actor), b = other && placeOf(where, other);
    if (!a || !b || a[0] === b[0]) return null;
    return b[0] > a[0] ? 1 : -1;
  };

  return Object.freeze({
    kind: 'dialogue',
    get lines() { return sched().lines; },
    get turns() { return sched().info; },
    get end() { const { lines } = sched(); return lines[lines.length - 1].end; },
    get until() { return Math.max(...sched().lines.map((l) => l.until)); },
    facing,
    state(actor, t, where = stage) {
      const { lines, info } = sched(), out = {};
      const dir = facing(actor, t, where);
      if (dir !== null) Object.assign(out, actor.look(dir));
      if (gaze && dir !== null) {
        const k = turnAt(t), other = actor === turns[k][0] ? addressee(k) : turns[k][0], a = placeOf(where, actor), b = placeOf(where, other);
        Object.assign(out, lookAt(actor, other, { at: a, state: { ...(a[3] ?? {}), ...out }, other: [b[0], b[1], b[2], b[3] ?? {}] }));
      }
      lines.forEach((l, k) => {
        if (turns[k][0] !== actor || t < info[k].t0 - 1e-9 || t >= info[k].until - 1e-9) return;
        const emote = turns[k][2]?.emote;
        if (emote) Object.assign(out, actor.emote(emote));
        Object.assign(out, l.state(t));
      });
      return out;
    },
    draw(t, where = stage) {
      const { lines } = sched(), kids = [], lanes = where ? lanesOf(where) : new Map();
      lines.forEach((l, k) => {
        const actor = turns[k][0], p = placeOf(where, actor);
        if (!p) throw new Error(`dialogue: draw needs a place for ${nameOf(actor)} ([x, y, s] under its name)`);
        const dir = facing(actor, t, where), lane = lanes.get(actor);
        kids.push(l.draw(t, p[0], p[1], p[2], { ...(p[3] ?? {}), ...(dir === null ? {} : { dir }), ...(lane ? { lane } : {}) }));
      });
      const drawn = kids.filter(Boolean);
      return drawn.length ? group({ name: 'dialogue', cache: 'never' }, drawn) : null;
    },
    events: (t = 0, e = {}) => sched().lines.flatMap((l) => l.events(t, e)),
  });
}

// The recipe maker the shot recipes share (recipes/shots.js A to Z, recipes/teach.js AN to AQ), and the actor
// as a figure. Not part of the author's surface: films import recipes, not this.
import { FPS, paper, night, group, meta, translate, scale, mmul, shot, place, perform } from '../core/index.js';
import { bounds, norm } from '../core/list.js';

// A duration worked out from a recipe's content, up to the next drawn frame (1/12 s).
export const onGrid = (s) => Math.ceil(s * FPS - 1e-6) / FPS;

// recipe(letter, name, defaults, layer, { ground, anchor, crop, camera, cast, square }) => R
//   ground   'paper' | 'night' | 'none' (the layer draws its own first op)
//   anchor   meta data, a list of them, or (o) => either
//   cast     false: the actor is the recipe's own business (a teaching recipe's presenter), not its subject
//   square   true: the layer is laid out on the 1080 square (the teaching recipes); in any other frame it is
//            drawn on the square and centred in it (R.squareLayer), the ground and the metas left outside
// dur may be a function of the options (the teaching recipes time themselves from their copy and audience);
// what it returns is put on the grid.
export function recipe(letter, name, defaults, layer, { ground = 'paper', anchor, crop = false, camera, cast: casts = true, square = false } = {}) {
  const prep = (o) => (casts ? cast(o) : o);
  const draw = square ? (ctx, o) => onSquare(ctx, (c) => layer(c, o)) : layer;
  const R = (opts = {}) => {
    const o = prep({ ...defaults, ...opts });
    const anchors = [typeof (o.anchor ?? anchor) === 'function' ? (o.anchor ?? anchor)(o) : (o.anchor ?? anchor)].flat().filter(Boolean);
    const dur = typeof o.dur === 'function' ? onGrid(o.dur(o)) : o.dur;
    return shot(o.name ?? name, dur, (ctx) => [
      ground === 'paper' ? paper() : ground === 'night' ? night() : null,
      ...norm(draw(ctx, o)),
      ...anchors.map((a) => meta('anchor', a)),
      (o.crop ?? crop) && meta('intent', 'crop'),
    ], { recipe: letter, camera: o.camera ?? camera, fit: o.fit, look: o.look });
  };
  R.layer = (ctx, opts = {}) => layer(ctx, prep({ ...defaults, ...opts }));
  if (square) R.squareLayer = (ctx, opts = {}) => norm(draw(ctx, prep({ ...defaults, ...opts })));
  R.recipe = letter;
  R.defaults = defaults;
  return Object.freeze(R);
}

const SQ = 1080;
// A layer laid out on the 1080 square, drawn centred in a frame of another aspect (16:9 across, 9:16 down):
// draw(ctx) gets the square's W, H, CX and CY and its ops go in a group 'square'. At 1:1 it is draw(ctx).
export function onSquare(ctx, draw) {
  const { W = SQ, H = SQ } = ctx;
  if (W === SQ && H === SQ) return draw(ctx);
  return [group({ name: 'square', xf: translate((W - SQ) / 2, (H - SQ) / 2) }, norm(draw({ ...ctx, W: SQ, H: SQ, CX: SQ / 2, CY: SQ / 2 })))];
}

// An actor as a subject: its state drawn centred on its box, h units tall (the boat is 138), mirrored for
// dir -1. Scaled, so it draws direct. fit 'drawn' (what a recipe's `h` asks for) measures the rest pose's
// drawing instead of the box -- a rig box holds every swing of every pose, so a puppet fitted by it reads
// small -- and boxes the figure by what this state draws, so the anchor, the push and lint see the drawing.
export function actorFigure(actor, state = {}, h = 140, fit = 'box') {
  const dir = state.dir < 0 ? -1 : 1;
  if (fit !== 'drawn') {
    const [bx, by, bw, bh] = actor.box, k = h / (bh || 1);
    return group({ name: 'actor', xf: mmul(scale(k * dir, k), translate(-(bx + bw / 2), -(by + bh / 2))), cache: 'never' }, [actor(state)]);
  }
  const [rx, ry, rw, rh] = restBox(actor), k = h / (rh || 1), g = actor(state), d = bounds(g.kids) ?? g.box;
  return group({ name: 'actor', xf: mmul(scale(k * dir, k), translate(-(rx + rw / 2), -(ry + rh / 2))), cache: 'never', box: d }, [g]);
}
const rests = new WeakMap();
function restBox(actor) {
  if (!rests.has(actor)) { const g = actor(actor.idle(0, 0)); rests.set(actor, bounds(g.kids) ?? actor.box); }
  return rests.get(actor);
}
// opts with an actor in them: the subject or figure becomes the actor. G's subject is handed a pose and is
// turned to head up the path, so the actor there is turned back upright, faces the way it travels and walks.
// opts.perform (4.0 K4) is a performance of that actor (perform(actor, script)) or a script to make one: its
// state at the shot's t stands in for the idle (and for G's walk; the facing still follows the path unless
// the performance sets dir), with the actor's follow parts (4.0 K6: a tail, a scarf) settled from its history.
function cast(o) {
  const A = o.actor;
  if (!A) {
    if (o.perform) throw new TypeError('recipe: perform needs an actor to perform it');
    return o;
  }
  const out = { ...o };
  const [h, fit] = Number.isFinite(o.h) && o.h > 0 ? [o.h, 'drawn'] : [140, 'box'];
  const P = performanceOf(A, o.perform);
  const still = (t) => (P ? A.follow(P.state, t) : A.idle(t, o.seed));
  if ('figure' in o) out.figure = (ctx) => actorFigure(A, still(ctx.t), h, fit);
  if ('subject' in o) {
    out.subject = (a, b) => (a && a.dir !== undefined && a.x !== undefined
      ? place(0, 0, { rot: -(a.dir + Math.PI / 2) }, actorFigure(A, P ? { ...A.look(Math.cos(a.dir)), ...A.follow(P.state, a.t) } : { ...A.cycle('walk', a.t), ...A.look(Math.cos(a.dir)) }, h, fit))
      : actorFigure(A, still(a.t), h, fit));
  }
  return out;
}
function performanceOf(A, p) {
  if (!p) return null;
  if (Array.isArray(p)) return perform(A, p);
  if (typeof p.state !== 'function') throw new TypeError('recipe: perform is perform(actor, script) or a script');
  if (p.actor !== A.name) throw new TypeError(`recipe: the performance is ${p.actor}'s, the actor is ${A.name}`);
  return p;
}

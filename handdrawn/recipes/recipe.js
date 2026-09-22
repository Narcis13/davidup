// The recipe maker the shot recipes share (recipes/shots.js A to Z, recipes/teach.js AN to AQ), and the actor
// as a figure. Not part of the author's surface: films import recipes, not this.
import { FPS, paper, night, group, meta, translate, scale, mmul, shot, place } from '../core/index.js';
import { bounds, norm } from '../core/list.js';

// A duration worked out from a recipe's content, up to the next drawn frame (1/12 s).
export const onGrid = (s) => Math.ceil(s * FPS - 1e-6) / FPS;

// recipe(letter, name, defaults, layer, { ground, anchor, crop, camera, cast }) => R
//   ground   'paper' | 'night' | 'none' (the layer draws its own first op)
//   anchor   meta data, a list of them, or (o) => either
//   cast     false: the actor is the recipe's own business (a teaching recipe's presenter), not its subject
// dur may be a function of the options (the teaching recipes time themselves from their copy and audience);
// what it returns is put on the grid.
export function recipe(letter, name, defaults, layer, { ground = 'paper', anchor, crop = false, camera, cast: casts = true } = {}) {
  const prep = (o) => (casts ? cast(o) : o);
  const R = (opts = {}) => {
    const o = prep({ ...defaults, ...opts });
    const anchors = [typeof (o.anchor ?? anchor) === 'function' ? (o.anchor ?? anchor)(o) : (o.anchor ?? anchor)].flat().filter(Boolean);
    const dur = typeof o.dur === 'function' ? onGrid(o.dur(o)) : o.dur;
    return shot(o.name ?? name, dur, (ctx) => [
      ground === 'paper' ? paper() : ground === 'night' ? night() : null,
      ...norm(layer(ctx, o)),
      ...anchors.map((a) => meta('anchor', a)),
      (o.crop ?? crop) && meta('intent', 'crop'),
    ], { recipe: letter, camera: o.camera ?? camera, fit: o.fit, look: o.look });
  };
  R.layer = (ctx, opts = {}) => layer(ctx, prep({ ...defaults, ...opts }));
  R.recipe = letter;
  R.defaults = defaults;
  return Object.freeze(R);
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
function cast(o) {
  const A = o.actor;
  if (!A) return o;
  const out = { ...o };
  const [h, fit] = Number.isFinite(o.h) && o.h > 0 ? [o.h, 'drawn'] : [140, 'box'];
  if ('figure' in o) out.figure = (ctx) => actorFigure(A, A.idle(ctx.t, o.seed), h, fit);
  if ('subject' in o) {
    out.subject = (a, b) => (a && a.dir !== undefined && a.x !== undefined
      ? place(0, 0, { rot: -(a.dir + Math.PI / 2) }, actorFigure(A, { ...A.cycle('walk', a.t), ...A.look(Math.cos(a.dir)) }, h, fit))
      : actorFigure(A, A.idle(a.t, o.seed), h, fit));
  }
  return out;
}

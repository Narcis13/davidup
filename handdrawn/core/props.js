// Props (4.0 K8): the teacher holds the chalk; the fox holds the teapot.
//
//   const POT = attach(FOX, 'hand-r', teapotNode, { grip: [0, 0], tip: SPOUT, level: true, rot: 30 });
//   FOX.place(x, y, s, { ...state, props: [POT] })                   the teapot in the paw, turning with it
//   const CHALK = attach(SAM, 'hand-r', heldTool({ tool: 'chalk' }), { scale: 0.5 });
//   SAM.place(x, y, s, { ...state, ...held(SAM, CHALK, [700, 400], { at: [x, y, s], state }), props: [CHALK] })
//
// A puppet's sockets (core/puppet.js) are places on its parts where something is held. attach() makes a
// prop for one: what to draw and how it sits there, worked out from the state each frame, so it turns with
// the hand. actor.place draws `props` inside the socket's part, in front of the hand (or behind it, `behind:
// true`), mirrored with the puppet. held() is reach (core/ik.js) for the prop's tip rather than the wrist.
//
// attach(actor, socket, what, { rot, scale, s, grip, tip, level, behind, inputs, name }) => a prop
//   what     a cel (called with `inputs`), an op or a list of ops, or { node, grip, tip, name } (heldTool's)
//   grip     the point of `what` that sits in the socket (default [0, 0]); tip: the point that does the job
//            (a chalk's end, a spout), for held and propAt
//   rot      degrees, turned about the grip after the socket's own angle; scale: drawing units per unit of
//            `what`, and with s (the actor's stage size) `what` is in stage units, so a teapot drawn 260 tall
//            on the stage is 260 tall in the paw
//   level    true: the prop keeps its own angle in the drawing (rot from level) whatever the hand does, so a
//            teapot stays upright while the arm lifts it and tips only by rot
//   behind   drawn first in the part's group, behind the hand's own drawing
// held(actor, prop, [x, y], { at, state, elbow }) => the limb's joints so the prop's tip is at the point:
//   reach (core/ik.js) with the tip as the point that lands, the lower bone run out to it (the joints are on
//   a 2 degree grid, so within a few units). The socket's part is the limb's (hand-, fore-, arm-); the fox's
//   paw is the end of a one-segment arm, which is only aimed: the tip points at the point.
// propAt(actor, prop, [x, y, s], state, pt = tip) => where a point of the prop is on the stage (the spout the
//   tea pours from); socketAt(actor, socket, [x, y, s], state, pt = [0, 0]) the same for a socket.
import { group, mapply, mmul, norm, rotate, scale, translate } from './list.js';
import { reach } from './ik.js';

const RAD = Math.PI / 180;
const isPt = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const LIMB = /^(arm|fore|hand|leg|shin|foot)-(l|r)$/;

const skeleton = (actor, what) => {
  const p = actor?.puppet;
  if (!p?.socketOf) throw new TypeError(`${what}: ${actor?.name ?? 'actor'} is not a puppet (props are held in a puppet's sockets)`);
  return p;
};

// The node of what is held: a cel called with its inputs, an op, or a list of ops as one group.
function nodeOf(what, inputs, where) {
  if (typeof what === 'function') {
    if (!what.cel) throw new TypeError(`${where}: a function to hold must be a cel`);
    return what(inputs ?? {});
  }
  if (Array.isArray(what)) return group('prop', norm(what));
  if (what && typeof what === 'object' && typeof what.op === 'string') return what;
  throw new TypeError(`${where}: hold a cel, an op, a list of ops or { node, grip, tip }, got ${JSON.stringify(what)?.slice(0, 60)}`);
}

// attach(actor, socket, what, o) => a prop (see the top of this file).
export function attach(actor, socket, what, o = {}) {
  const p = skeleton(actor, 'attach'), where = `attach ${actor.name} '${socket}'`;
  const { part } = p.socketOf(socket);
  const spec = what && typeof what === 'object' && !Array.isArray(what) && what.node ? what : { node: what };
  const node = nodeOf(spec.node, o.inputs, where);
  const grip = o.grip ?? spec.grip ?? [0, 0], tip = o.tip ?? spec.tip ?? null;
  if (!isPt(grip)) throw new TypeError(`${where}: grip is [x, y], got ${JSON.stringify(grip)}`);
  if (tip !== null && !isPt(tip)) throw new TypeError(`${where}: tip is [x, y], got ${JSON.stringify(tip)}`);
  const rot = o.rot ?? 0;
  if (!Number.isFinite(rot)) throw new TypeError(`${where}: rot is degrees, got ${rot}`);
  if (o.s !== undefined && !(o.s > 0)) throw new TypeError(`${where}: s is the actor's stage size, got ${o.s}`);
  const k = (o.scale ?? spec.scale ?? 1) / (o.s ? actor.stage.k(o.s) : 1);
  if (!(k > 0)) throw new TypeError(`${where}: scale must be above 0`);
  // The prop's matrix in its part's coordinates at a state: the socket, turned (level: back to the drawing's
  // own angle first), scaled, the grip at the origin.
  const xfIn = (state = {}) => {
    const q = { ...p.rest, ...state }, sk = p.socketOf(socket, q.dir ?? p.rest.dir);
    let a = sk.angle + rot;
    if (o.level) { const w = p.worldOf(part, q, { mirror: false }); a = rot - Math.atan2(w[1], w[0]) / RAD; }
    return mmul(mmul(translate(sk.at[0], sk.at[1]), rotate(a * RAD)), mmul(scale(k), translate(-grip[0], -grip[1])));
  };
  return Object.freeze({ kind: 'prop', actor: actor.name, socket, part, name: o.name ?? spec.name ?? socket, node, grip, tip, behind: !!o.behind, level: !!o.level, xfIn });
}

// A prop's point in the unmirrored drawing (no stage), or on the stage with at.
function pointOf(actor, prop, at, state, pt) {
  const p = actor.puppet, q = { ...p.rest, ...state };
  if (!at) return mapply(mmul(p.worldOf(prop.part, q, { mirror: false }), prop.xfIn(q)), pt[0], pt[1]);
  const [x, y, s] = at;
  return mapply(mmul(actor.stage.xf(x, y, s, q), mmul(p.worldOf(prop.part, q), prop.xfIn(q))), pt[0], pt[1]);
}

// propAt(actor, prop, [x, y, s], state, pt) => [x, y] on the stage.
export function propAt(actor, prop, at, state = {}, pt = prop?.tip ?? [0, 0]) {
  skeleton(actor, 'propAt');
  if (prop?.kind !== 'prop') throw new TypeError(`propAt ${actor.name}: expected a prop (attach's), got ${JSON.stringify(prop)?.slice(0, 60)}`);
  if (!Array.isArray(at) || at.length !== 3) throw new TypeError(`propAt ${actor.name}: at is the actor's place [x, y, s]`);
  return pointOf(actor, prop, at, state, pt ?? [0, 0]);
}

// socketAt(actor, socket, [x, y, s], state, pt) => [x, y] on the stage.
export function socketAt(actor, socket, [x, y, s], state = {}, pt = [0, 0]) {
  const p = skeleton(actor, 'socketAt'), q = { ...p.rest, ...state };
  return mapply(mmul(actor.stage.xf(x, y, s, q), p.socketXf(socket, q)), pt[0], pt[1]);
}

// held(actor, prop, [x, y], { at, state, elbow }) => the limb's joints so the prop's tip lands on the point.
export function held(actor, prop, target, o = {}) {
  skeleton(actor, 'held');
  if (prop?.kind !== 'prop') prop = attach(actor, o.socket ?? 'hand-r', prop, o);
  if (!isPt(target)) throw new TypeError(`held ${actor.name}: target is [x, y], got ${JSON.stringify(target)}`);
  if (!LIMB.test(prop.part)) throw new Error(`held ${actor.name}: socket '${prop.socket}' is on '${prop.part}', which no limb reaches (hand-, fore-, arm-, foot-, shin-, leg-)`);
  const { at, state = {}, elbow } = o, tip = prop.tip ?? [0, 0];
  // The tip in its part's coordinates rides the hand, so reach lands it directly (core/ik.js tip). A level
  // prop turns against the arm, so its tip moves as the arm does: solve again from where the last solve left
  // the arm, keeping the nearest.
  let q = state, best = null;
  for (let j = 0; j < (prop.level ? 4 : 1); j++) {
    const patch = reach(actor, prop.part, target, { at, state, elbow, tip: { part: prop.part, at: mapply(prop.xfIn({ ...q }), tip[0], tip[1]) } });
    const got = pointOf(actor, prop, at, { ...state, ...patch }, tip), err = Math.hypot(target[0] - got[0], target[1] - got[1]);
    if (!best || err < best.err - 1e-9) best = { patch, err };
    q = { ...state, ...patch };
  }
  return best.patch;
}

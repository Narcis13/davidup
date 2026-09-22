// Teaching recipes (4.0 E2): the explainer's shots, AN to AQ, re-exported from recipes/shots.js.
//
//   titleCard({ title, sub })                   AN  the title written on, the teacher presenting it
//   labelled({ subject, labels })               AO  leader-line labels arriving in order, the camera nudging to each
//   counting({ items, n })                      AP  objects appearing one by one with digits and a tally
//   compare({ left, right, sign })              AQ  a split frame, two subjects, the sign drawn last
//   chapter(title, ...nodes)                        a chapter: its title card (AN), the nodes, a hold (4.0 E1)
//
// They time themselves: `dur` defaults to what the copy needs for the audience (`audience:`, a key of
// AUDIENCES: how big the letters are, how fast the pen writes, how fast the viewer reads, how long a thing
// dwells), so a longer label gets longer on screen and a lesson for five-year-olds runs slower than one for
// adults. Give `dur` to fix it (the timing inside stays; a longer shot holds at the end). The lettering is
// written on in stroke order at the audience's pen speed; titleCard's `hand:` puts a drawn hand to the pen (T6).
//
// actor: here the actor is the teacher, not the subject: a cast member standing at the side (`side`, `h` its
// rest pose's drawn height) facing us, idling on the twos, presenting the title, pointing at what arrives,
// thinking over a comparison. A puppet with the biped vocabulary (a stick, the fox) takes its poses; one
// without just idles. The subject of AO is `subject`, to label an actor pass
// `subject: (ctx) => actorFigure(A, A.idle(ctx.t), 300, 'drawn')`.
//
// Words: every lettered string counts against the allowance (digits too): the film's audience's (4.0 T10,
// film({ audience })), or for a general film the look's (12 a shot on the whiteboard; `look.words` wins).
// Coordinates are v1's: a 1080 square around (540, 540).
import {
  fill, stroke, group, circle, ellipse, line, poly, spline, place, cel, ramp, ease, reveal, handText, cam,
} from '../core/index.js';
import { bounds, withProps } from '../core/list.js';
import { chapterSeq } from '../core/tree.js';
import { audienceOf } from '../core/audience.js';
import { writing } from '../core/write.js';
import { writer } from '../packs/hands.js';
import { recipe, actorFigure, onGrid } from './recipe.js';

const lerp = (a, b, u) => a + (b - a) * u;
const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length;
const chars = (s) => String(s ?? '').replace(/\s+/g, '').length;

// The audiences live in core (core/audience.js); re-exported here, where E2 first defined them.
export { AUDIENCES, audienceOf } from '../core/audience.js';

// Seconds to write s (at least a third of a second) and to read it (at least the dwell).
const writeT = (s, A) => Math.max(1 / 3, chars(s) / A.write);
const readT = (s, A) => Math.max(A.dwell, words(s) / A.read);

// Lettering in the recipes' style: one ink, no misregistered second ink, written on by p.
const letters = (str, x, y, o) => handText(String(str), x, y, { ink2: null, ...o });
const writeOn = (p, node) => (p <= 0 ? null : p >= 1 ? node : reveal(p, node));
// Pops in over 0.25 s from u = 0 (ease out), from 60% of its size, about (x, y).
const pop = (u, x, y, node) => (u <= 0 ? null : place(x, y, { scale: lerp(0.6, 1, ease.out(Math.min(1, u))) }, direct(node)));
// A node with every group in it drawn direct, never as a cached layer. The whiteboard's bullet marker is
// translucent, and a kept layer (baked through 8-bit unpremultiplied pixels) of it can differ by a level from
// the same layer replayed on its first sighting, so the same object drawn several times in a frame (the apples)
// would render differently with the cache on and off, and across worker splits. Direct is the same every time.
const direct = (node) => (Array.isArray(node) ? node.map(direct) : node?.op === 'group' ? withProps(node, { cache: 'never', kids: node.kids.map(direct) }) : node);
const popAt = (t, t0) => ramp(t0, t0 + 0.25, t);

// ---------- the presenter ----------

// The teacher standing at (x, feet), h tall, facing us (mirrored for side 'right', so its presenting arm is
// the one towards the board), in a vocabulary pose reached by k (0..1) over its idle, plus an expression.
// A pose or expression the actor lacks is nothing, so any cast member can stand in.
function presenter(A, ctx, { x, feet, h, side = 'left', pose = null, k = 1, emote = null, seed = 0 }) {
  const has = (list, n) => n && list.includes(n);
  const v = A.vocabulary, state = { ...A.idle(ctx.t, seed), ...A.look(0) };
  if (has(v.poses, pose) && k > 0) Object.assign(state, A.pose(pose, Math.min(1, k)));
  if (has(v.expressions, emote)) Object.assign(state, A.emote(emote));
  const fig = actorFigure(A, state, h, 'drawn');
  return place(x, feet - h / 2, { flip: side === 'right' }, group('presenter', [fig]));
}
// The pose's k, reaching it over 0.4 s from t0 (ease io), or 0 before.
const reach = (t, t0) => ramp(t0, t0 + 0.4, t, ease.io);

// ---------- default subjects ----------

// A flower to label (AO's default): petals, a centre, a stem, a leaf, roots. The label points are FLOWER_AT.
export const flower = cel('flower', () => {
  const petals = [];
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * Math.PI * 2, x = Math.cos(a) * 46, y = -150 + Math.sin(a) * 46;
    petals.push(place(x, y, { rot: a }, [fill(ellipse(0, 0, 38, 22, 24), 'blush', { name: `petal${j}` }), stroke(ellipse(0, 0, 38, 22, 24), 'ink', { w: 2.6, wobble: 1 })]));
  }
  const leaf = poly([[0, 20], [40, -10], [96, -18], [60, 18], [0, 20]]);
  const roots = [[0, 130, -40, 170, -70, 176], [0, 130, 6, 180, 0, 206], [0, 130, 36, 162, 70, 172]];
  return [
    stroke(spline([[0, -110], [-8, -20], [6, 60], [0, 130]]), 'ink', { w: 3.4, wobble: 1, name: 'stem' }),
    fill(leaf, 'fills.2', { name: 'leaf' }), stroke(leaf, 'ink', { w: 2.4, wobble: 1 }),
    stroke({ sub: roots.map((pts) => ({ pts, closed: false })), box: [-70, 130, 140, 76] }, 'ink', { w: 2.2, wobble: 1.2, name: 'roots' }),
    stroke(line(-120, 130, 120, 130), 'shade', { w: 2.4, wobble: 2, name: 'soil' }),
    ...petals,
    fill(circle(0, -150, 26, 32), 'fills.3', { name: 'centre' }), stroke(circle(0, -150, 26, 32), 'ink', { w: 2.6, wobble: 1 }),
  ];
}, { box: [-132, -240, 264, 452], desc: 'a flower to label: petals, centre, stem, leaf, roots' });
// Where the flower's parts are, in its own units (place it at (x, y) with `scale` and add them).
export const FLOWER_AT = Object.freeze({ petal: [72, -178], centre: [0, -150], stem: [-5, -40], leaf: [70, -4], roots: [-52, 172] });

// An apple to count (AP's and AQ's default), about 60 units across.
export const apple = cel('apple', () => {
  const body = spline([[0, -22], [22, -30], [32, -6], [24, 22], [0, 30], [-24, 22], [-32, -6], [-22, -30]], { closed: true });
  return [
    fill(body, 'blush', { name: 'body' }), stroke(body, 'ink', { w: 2.6, wobble: 0.8 }),
    stroke(line(0, -22, 4, -40), 'ink', { w: 3, wobble: 0.5, name: 'stalk' }),
    fill(ellipse(14, -36, 11, 5, 16), 'fills.2', { name: 'leaf' }),
  ];
}, { box: [-34, -44, 68, 76], desc: 'an apple to count' });

// ---------- AN. title card ----------

// The title card's times: the title written from `at`, the swash, the sub, and the end once it is read.
// With a hand the words are written at the audience's reading speed, a word at a time (writeOn's schedule:
// the hand comes in over HAND_LEAD, a word takes 1 / read seconds), and the hand leaves after the last.
const HAND_LEAD = 0.4;
function titlePlan(o) {
  const A = audienceOf(o.audience), t0 = o.at, hand = !!o.hand;
  const t1 = t0 + (hand ? HAND_LEAD + words(o.title) / A.read : writeT(o.title, A)), u1 = t1 + 0.3;
  const t2 = o.sub ? u1 + (hand ? words(o.sub) / A.read : writeT(o.sub, A)) : u1;
  return { A, t0, t1, u1, t2, hand, end: t2 + readT(`${o.title} ${o.sub ?? ''}`, A) + (hand ? 0.4 : 0) };
}
// AN. Title card (3 to 5 s): after a beat the title is written on (centred, wrapped to `width`) at the pen's
// pace, a swash underlines it, the `sub` writes under it; the actor, at the side, presents it as the title is
// finished. dur: the writing plus the time to read it all. hand: true (or writer's options: tool, side,
// scale, skin, ink) and a drawn hand writes it all, a word at a time at the audience's reading speed,
// lifting between words (T6), then leaves.
export const titleCard = recipe('AN', 'title', {
  dur: (o) => titlePlan(o).end, title: 'why does the moon change shape?', sub: null, audience: 'general', actor: null,
  side: 'right', h: 380, x: null, y: 500, size: 108, width: 760, role: 'ink', swash: 'accents.0', at: 0.25, pose: 'present', seed: 150,
  hand: null,
}, (ctx, o) => {
  const P = titlePlan(o), { A } = P, t = ctx.t, s = o.size * A.text;
  const x = o.x ?? (o.actor ? (o.side === 'right' ? 440 : 640) : 540);
  const title = letters(o.title, x, o.y, { size: s, align: 'center', valign: 'bottom', width: o.width, role: o.role, seed: o.seed });
  const [bx, by, bw, bh] = bounds(title.kids) ?? [x - o.width / 2, o.y - s, o.width, s];
  const swash = stroke(spline([[bx - 10, by + bh + 22], [bx + bw * 0.5, by + bh + 12], [bx + bw + 16, by + bh + 20]], { n: 6 }), o.swash, { w: Math.max(3, s * 0.06), wobble: 1.2, seed: o.seed + 1, name: 'swash' });
  const sub = o.sub && letters(o.sub, x, by + bh + 34 + s * 0.55, { size: s * 0.55, align: 'center', valign: 'top', width: o.width, role: o.role, seed: o.seed + 2 });
  const W = { per: 'word', wps: A.read }, onTitle = { ...W, at: P.t0, lead: HAND_LEAD }, onSub = { ...W, at: P.u1, lead: 0 };
  const pTitle = P.hand ? writing(title, onTitle).p(t) : ramp(P.t0, P.t1, t), pSub = P.hand && sub ? writing(sub, onSub).p(t) : ramp(P.u1, P.t2, t);
  // The hand on whichever part is being written; after the last, it goes back the way it came.
  const H = P.hand && { look: ctx.look, scale: s / 100, ...(o.hand === true ? {} : o.hand) }, last = sub || swash;
  const hand = P.hand && (t < P.t1 ? writer(title, t, { ...H, ...onTitle })
    : t < P.u1 ? writer(swash, t, { ...H, p: ramp(P.t1, P.u1, t) })
      : sub && t < P.t2 ? writer(sub, t, { ...H, ...onSub })
        : writer(last, t, { ...H, p: 1, leave: ramp(P.t2, P.t2 + 0.4, t, ease.io) }));
  // The group is boxed by the whole card, so the anchor is there (for the fit and lint) before a letter is.
  return [
    group({ name: 'title', box: bounds([title, swash, sub].filter(Boolean)) }, [
      writeOn(pTitle, title),
      writeOn(ramp(P.t1, P.u1, t), swash),
      sub && writeOn(pSub, sub),
    ]),
    o.actor && presenter(o.actor, ctx, { x: o.side === 'right' ? 890 : 190, feet: 1010, h: o.h, side: o.side, pose: o.pose, k: reach(t, P.t1 - 0.2), emote: t >= P.t2 ? 'happy' : null, seed: o.seed }),
    hand,
  ];
}, { anchor: { name: 'title' }, cast: false });

// ---------- chapters (4.0 E1) ----------

// chapter(title | { title, sub, actor, audience, hand, card, hold, ... }, ...nodes): a lesson's chapter, a seq
// of a title card, the nodes and a hold. The card is titleCard with the chapter's title and whatever else the
// options carry (sub, actor, audience, hand, side, ...), named 'card: <title>'; `card` gives a node of your
// own instead, options merged into the default, or false for none. `hold` seconds (on the grid) of the last
// node's last frame close the chapter, a beat before the next title: by default the audience's dwell, and at
// least its cut floor (so a hold is never a shot lint calls too short); 0 for none. The board, `hdf grid
// --chapter n`, `hdf render --chapter n` and lint's chapter lines take the film a chapter at a time; a lesson
// runs up to 180 s, a chapter every 20 to 40 s.
export function chapter(head, ...nodes) {
  const o = typeof head === 'string' ? { title: head } : { ...head };
  const { title, card, hold, ...rest } = o;
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('chapter: needs a title');
  const A = audienceOf(rest.audience);
  const made = card === false ? null
    : card?.kind ? card
      : titleCard({ name: `card: ${title}`, title, ...rest, ...(card ?? {}) });
  const h = hold ?? onGrid(Math.max(A.dwell, A.cutFloor));
  return chapterSeq(title, nodes, { card: made, hold: h });
}

// ---------- AO. labelled ----------

// Where each label sits: its own `from`, or out to the side of the subject's box that its point is on (`reach`
// past the edge, at the point's height), the labels on one side kept a line and a half apart.
function labelFroms(labels, c, box, reachBy, s) {
  const out = labels.map((l) => l.from ?? [l.at[0] < c[0] ? box[0] - reachBy : box[0] + box[2] + reachBy, l.at[1]]);
  for (const left of [true, false]) {
    const js = labels.map((l, j) => j).filter((j) => !labels[j].from && (labels[j].at[0] < c[0]) === left).sort((a, b) => out[a][1] - out[b][1]);
    for (let q = 1; q < js.length; q++) out[js[q]] = [out[js[q]][0], Math.max(out[js[q]][1], out[js[q - 1]][1] + s * 1.5)];
  }
  return out;
}
// Each label's start and its parts' times: a dot, the leader (0.3 s), the word written, then read.
function labelPlan(o) {
  const A = audienceOf(o.audience), out = [];
  let t = o.at;
  for (const l of o.labels) {
    const lead = t + 0.3, w1 = lead + writeT(l.text, A), next = o.per ?? (w1 - t) + readT(l.text, A);
    out.push({ t0: t, lead, w1 });
    t += next;
  }
  return { A, labels: out, end: t + A.dwell };
}
// AO. Labelled subject (3 to 8 s): the subject drawn at (x, y) by `scale`, then one label at a time: a dot on
// the part (`at`), a leader line out to where the word sits (`from`, or `reach` out past the side of the subject the part is on, at its height),
// the word written on beside it; the camera eases a little towards each label as it arrives (`nudge`, 0 for
// none) and back to the whole at the end. `per` fixes the seconds per label (default: write it, then read it).
// labels: [{ text, at: [x, y], from?: [x, y] }] in recipe units.
export const labelled = recipe('AO', 'labelled', {
  dur: (o) => labelPlan(o).end, subject: () => flower({}), x: 620, y: 520, scale: 1.3, reach: 60,
  labels: Object.entries(FLOWER_AT).filter(([k]) => k !== 'centre').map(([text, [u, v]]) => ({ text, at: [620 + u * 1.3, 520 + v * 1.3] })),
  per: null, audience: 'general', actor: null, side: 'left', h: 300, size: 44, role: 'ink', leader: 'inks.1', nudge: 0.1, at: 0.4, pose: 'point-r', seed: 160,
}, (ctx, o) => {
  const P = labelPlan(o), { A } = P, t = ctx.t, s = o.size * A.text, c = [o.x, o.y];
  const subject = place(o.x, o.y, { scale: o.scale }, group('subject', [o.subject(ctx, 'ink')]));
  const froms = labelFroms(o.labels, c, bounds([subject]) ?? [o.x, o.y, 0, 0], o.reach, s);
  const kids = o.labels.map((l, j) => {
    const q = P.labels[j];
    if (t < q.t0) return null;
    const from = froms[j], right = from[0] >= l.at[0], gap = s * 0.25;
    const dot = fill(circle(l.at[0], l.at[1], 5, 16), o.leader, { name: 'dot' });
    const lead = stroke(line(l.at[0], l.at[1], from[0], from[1]), o.leader, { w: 2.4, wobble: 1, seed: o.seed + j, name: 'leader' });
    const word = letters(l.text, from[0] + (right ? gap : -gap), from[1] + s * 0.3, { size: s, align: right ? 'left' : 'right', role: o.role, seed: o.seed + 20 + j });
    return group(`label${j}`, [dot, writeOn(ramp(q.t0, q.lead, t), lead), writeOn(ramp(q.lead, q.w1, t), word)]);
  });
  // The camera: towards the newest label's middle by `nudge`, eased over 0.5 s; home over the last dwell.
  const target = (j) => (j < 0 ? c : (() => { const l = o.labels[j], f = froms[j]; return [(l.at[0] + f[0]) / 2, (l.at[1] + f[1]) / 2]; })());
  const now = P.labels.filter((q) => t >= q.t0).length - 1, q = P.labels[now];
  const home = P.end - A.dwell, u = t >= home ? 1 - ramp(home, home + A.dwell * 0.8, t, ease.io) : 1;
  const a = target(now - 1), b = target(now), m = q ? ramp(q.t0, q.t0 + 0.5, t, ease.io) : 0;
  const aim = [lerp(a[0], b[0], m), lerp(a[1], b[1], m)], k = o.nudge * (now < 0 ? 0 : u);
  const view = { x: lerp(540, aim[0], k), y: lerp(540, aim[1], k), zoom: 1 + 0.5 * k, W: 1080, H: 1080 };
  const first = P.labels[0]?.t0 ?? 0;
  return [
    cam(view, [
      subject,
      group('labels', kids),
    ]),
    o.actor && presenter(o.actor, ctx, { x: o.side === 'right' ? 920 : 150, feet: 1010, h: o.h, side: o.side, pose: o.pose, k: reach(t, first) * u, seed: o.seed }),
  ];
}, { anchor: { name: 'subject' }, cast: false });

// ---------- AP. counting ----------

// Where the j-th of n objects sits: rows of `cols` centred on (x, y), `gap` apart.
function slot(j, n, o) {
  const cols = Math.min(n, o.cols), rows = Math.ceil(n / cols), r = Math.floor(j / cols), inRow = r < rows - 1 ? cols : n - r * cols;
  return [o.x + (j % cols - (inRow - 1) / 2) * o.gap, o.y + (r - (rows - 1) / 2) * o.gap * 1.25];
}
function countPlan(o) {
  const A = audienceOf(o.audience), per = o.per ?? A.count, last = o.at + (o.n - 1) * per;
  const lab = o.label ? last + per : null, end = (lab ?? last) + (o.label ? writeT(`${o.n} ${o.label}`, A) : 0) + readT(o.label ? `${o.n} ${o.label}` : '', A) + A.dwell;
  return { A, per, t: (j) => o.at + j * per, lab, end };
}
// The tally for c marks: fours of uprights struck through by the fifth, from (x, y).
function tally(c, x, y, hgt, role, seed) {
  const sub = [];
  for (let j = 0; j < c; j++) {
    const g = Math.floor(j / 5), gx = x + g * hgt * 1.15;
    sub.push(j % 5 === 4
      ? { pts: [gx - hgt * 0.12, y + hgt * 0.8, gx + hgt * 0.72, y + hgt * 0.15], closed: false }
      : { pts: [gx + (j % 5) * hgt * 0.17, y, gx + (j % 5) * hgt * 0.17 + 2, y + hgt], closed: false });
  }
  return sub.length ? stroke({ sub, box: [x, y, Math.ceil(c / 5) * hgt * 1.15, hgt] }, role, { w: 3, wobble: 1, seed, name: 'tally' }) : null;
}
// AP. Counting (0.5 to 1 s an object): n objects pop in one at a time (`per`, default the audience's
// counting pace) in rows of `cols`, each with its number written under it; a tally grows at the bottom
// (`tally: false` for none); with `label`, the total is written at the end ("8 phases"). items: a cel, or
// (ctx, j) => node, drawn at the slot's centre by `scale`.
export const counting = recipe('AP', 'counting', {
  dur: (o) => countPlan(o).end, items: apple, n: 5, cols: 5, x: 600, y: 420, gap: 150, scale: 1.4, per: null,
  tally: true, label: null, audience: 'general', actor: null, side: 'left', h: 300, size: 44, role: 'ink', mark: 'inks.1',
  at: 0.4, pose: 'point-r', seed: 170,
}, (ctx, o) => {
  const P = countPlan(o), { A } = P, t = ctx.t, s = o.size * A.text;
  const draw = typeof o.items === 'function' && o.items.cel ? () => o.items({}) : (j) => o.items(ctx, j);
  const shown = Array.from({ length: o.n }, (_, j) => j).filter((j) => t >= P.t(j));
  const kids = shown.map((j) => {
    const [x, y] = slot(j, o.n, o), u = popAt(t, P.t(j));
    return group(`item${j}`, [
      pop(u, x, y, place(0, 0, { scale: o.scale }, draw(j))),
      writeOn(ramp(P.t(j) + 0.1, P.t(j) + 0.1 + Math.min(0.3, writeT(String(j + 1), A)), t), letters(String(j + 1), x, y + o.gap * 0.42 + s * 0.35, { size: s, align: 'center', role: o.role, seed: o.seed + j })),
    ]);
  });
  const [, lastY] = slot(o.n - 1, o.n, o), ty = lastY + o.gap * 0.62 + s * 0.6;
  const total = o.label && t >= P.lab ? writeOn(ramp(P.lab, P.lab + writeT(`${o.n} ${o.label}`, A), t), letters(`${o.n} ${o.label}`, o.x, ty + s * 2.6, { size: s * 1.2, align: 'center', role: o.role, seed: o.seed + 99 })) : null;
  const done = t >= P.t(o.n - 1) + P.per;
  // Boxed by every slot, so the anchor is where the objects will be before the first arrives.
  const at = Array.from({ length: o.n }, (_, j) => slot(j, o.n, o)), r = o.gap / 2;
  const xs = at.map((p) => p[0]), ys = at.map((p) => p[1]);
  const box = [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) - Math.min(...xs) + 2 * r, Math.max(...ys) - Math.min(...ys) + 2 * r];
  return [
    group({ name: 'items', box }, kids),
    o.tally && tally(shown.length, o.x - Math.ceil(o.n / 5) * s * 1.1 * 1.15 / 2, ty, s * 1.1, o.mark, o.seed + 50),
    total && group('total', [total]),
    o.actor && presenter(o.actor, ctx, { x: o.side === 'right' ? 930 : 150, feet: 1010, h: o.h, side: o.side, pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.t(o.n - 1) + P.per) : reach(t, o.at), emote: done ? 'happy' : null, seed: o.seed }),
  ];
}, { anchor: { name: 'items' }, cast: false });

// ---------- AQ. compare ----------

// The sign between two things, drawn as strokes at (x, y), size s: '=' '>' '<' ('vs' is lettered).
function signStrokes(sign, x, y, s, role, seed) {
  const h = s / 2, sub = sign === '='
    ? [[x - h, y - h * 0.35, x + h, y - h * 0.35], [x - h, y + h * 0.35, x + h, y + h * 0.35]]
    : sign === '>' ? [[x - h * 0.7, y - h, x + h * 0.7, y, x - h * 0.7, y + h]]
      : sign === '<' ? [[x + h * 0.7, y - h, x - h * 0.7, y, x + h * 0.7, y + h]] : null;
  if (!sub) throw new TypeError(`compare: sign '${sign}' is not one of vs, =, >, <`);
  return stroke({ sub: sub.map((pts) => ({ pts, closed: false })), box: [x - h, y - h, s, s] }, role, { w: Math.max(5, s * 0.09), wobble: 1, seed, name: 'signMark' });
}
function comparePlan(o) {
  if (!['vs', '=', '>', '<'].includes(o.sign)) throw new TypeError(`compare: sign '${o.sign}' is not one of vs, =, >, <`);
  const A = audienceOf(o.audience), t0 = o.at, tl = t0 + 0.35, tr = tl + 0.5 + (o.labels ? readT(o.labels[0], A) : A.dwell);
  const ts = tr + 0.5 + (o.labels ? readT(o.labels[1], A) : A.dwell), s1 = ts + 0.5;
  return { A, t0, tl, tr, ts, s1, end: s1 + readT([...(o.labels ?? []), o.sign === 'vs' ? 'vs' : ''].join(' '), A) + A.dwell };
}
// AQ. Compare (3 to 5 s): a line splits the frame, the left subject pops in (its label written under it),
// then the right, then the sign between them is drawn last in `role` in a gap left in the line: 'vs'
// lettered, '=' '>' '<' drawn. The actor stands small at the bottom between the labels, thinking, and is
// pleased once the sign is down. left / right: (ctx, mode) => node, drawn at their halves' centres.
export const compare = recipe('AQ', 'compare', {
  dur: (o) => comparePlan(o).end,
  left: () => group([[-50, 30], [50, 30], [0, -40]].map(([x, y]) => place(x, y, apple({})))),
  right: () => group([[-100, 30], [0, 30], [100, 30], [-50, -40], [50, -40]].map(([x, y]) => place(x, y, apple({})))),
  sign: '<', labels: ['3', '5'], x: [270, 810], y: 440, scale: 1.3, audience: 'general', actor: null, h: 230,
  size: 56, role: 'ink', mark: 'accents.0', divider: 'shade', at: 0.25, seed: 180,
}, (ctx, o) => {
  const P = comparePlan(o), { A } = P, t = ctx.t, s = o.size * A.text, mid = (o.x[0] + o.x[1]) / 2;
  const side = (j, t1) => {
    if (t < t1) return null;
    const x = o.x[j], sub = j ? o.right : o.left, lab = o.labels?.[j];
    return group(j ? 'right' : 'left', [
      pop(popAt(t, t1), x, o.y, place(0, 0, { scale: o.scale }, sub(ctx, 'ink'))),
      lab && writeOn(ramp(t1 + 0.25, t1 + 0.25 + writeT(lab, A), t), letters(lab, x, o.y + 190 + s * 0.35, { size: s, align: 'center', role: o.role, seed: o.seed + j })),
    ]);
  };
  const S = s * 1.8, ps = ramp(P.ts, P.s1, t);
  const sign = ps > 0 && group('sign', [
    writeOn(ps, o.sign === 'vs'
      ? letters('vs', mid, o.y + S * 0.3, { size: S, align: 'center', role: o.mark, seed: o.seed + 5 })
      : signStrokes(o.sign, mid, o.y, S, o.mark, o.seed + 5)),
  ]);
  return [
    writeOn(ramp(P.t0, P.tl, t), stroke({ sub: [{ pts: [mid, 110, mid, o.y - S * 0.8], closed: false }, { pts: [mid, o.y + S * 0.8, mid, 770], closed: false }], box: [mid - 1, 110, 2, 660] }, o.divider, { w: 2.6, wobble: 1.5, seed: o.seed + 3, name: 'divider' })),
    group({ name: 'compare', box: bounds([0, 1].map((j) => place(o.x[j], o.y, { scale: o.scale }, (j ? o.right : o.left)(ctx, 'ink')))) }, [side(0, P.tl), side(1, P.tr)]),
    sign,
    o.actor && presenter(o.actor, ctx, { x: mid, feet: 1030, h: o.h, pose: t >= P.s1 ? 'present' : 'think', k: t >= P.s1 ? reach(t, P.s1) : reach(t, P.tl), emote: t >= P.s1 ? 'happy' : 'thinking', seed: o.seed }),
  ];
}, { anchor: { name: 'compare' }, cast: false });

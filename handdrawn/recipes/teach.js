// Teaching recipes (4.0 E2): the explainer's shots, AN to AQ, re-exported from recipes/shots.js.
//
//   titleCard({ title, sub })                   AN  the title written on, the teacher presenting it
//   labelled({ subject, labels })               AO  leader-line labels arriving in order, the camera nudging to each
//   counting({ items, n })                      AP  objects appearing one by one with digits and a tally
//   compare({ left, right, sign })              AQ  a split frame, two subjects, the sign drawn last
//   process({ steps, arrows })                  AR  cards with arrows, one a beat (4.0 E3)
//   cycleDiagram({ steps, travel })             AS  steps on a ring, names along it, a marker going round
//   numberLine({ from, to, start, jumpTo })     AT  a hop at a time along a line, the leg's +n, the landing ringed
//   growth({ cel, from, to, count })            AU  a bar rising (or a pictograph stacking), its number counting on
//   questionCard({ text })                      AV  a big ? drawn, the question written, the teacher shrugging (4.0 E4)
//   quiz({ question, options, answer })         AW  options one by one, a pause, the wrong ones crossed, the right one ringed
//   mapRoute({ map, path, label, ends })        AX  a marker travels a route over a drawn map, the label along it
//   dialogueShot({ actor, other, lines })       AY  two actors on a ground, facing each other, T9's dialogue as the beat
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
  fill, stroke, group, circle, ellipse, line, poly, spline, arc, rect, roundRect, at, len, place, cel, ramp, ease, reveal, handText, textOnPath, cam,
  pin, on, photo, dialogue, actorOf, puppet, stickSource,
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
// E3's pop: the same, but the last sliver of the ease snaps to 1. A list hash rounds a scale of 0.99998 to 1,
// so the renderer takes that frame for a repeat of the next one, and the two draw differently depending on
// where a worker's range starts. E2's pop keeps the sliver so its films' frames stay as they were.
const popIn = (u, x, y, node) => { const k = lerp(0.6, 1, ease.out(Math.min(1, u))); return u <= 0 ? null : place(x, y, { scale: k > 0.9995 ? 1 : k }, direct(node)); };
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

// ---------- 4.0 E3: process, cycle, number line, growth (AR to AU) ----------

// An arrow along a path: the shaft, then a head at its end turned to the path's last heading, one stroke each,
// so a reveal draws the shaft and then the head.
function arrow(path, role, { w = 3, head = 16, seed = 0, name = 'arrow' } = {}) {
  const e = at(path, len(path)), a = e.heading, h = head;
  const tip = [[e.x - Math.cos(a - 0.45) * h, e.y - Math.sin(a - 0.45) * h, e.x, e.y, e.x - Math.cos(a + 0.45) * h, e.y - Math.sin(a + 0.45) * h]];
  return group(name, [
    stroke(path, role, { w, wobble: 1, seed, name: 'shaft' }),
    stroke({ sub: tip.map((pts) => ({ pts, closed: false })), box: [e.x - h, e.y - h, 2 * h, 2 * h] }, role, { w, wobble: 0.6, seed: seed + 1, name: 'head' }),
  ]);
}
// A cel (or (ctx, j) => node) drawn centred at (x, y), scaled to fit a d-unit square by its box.
function fitted(item, ctx, j, x, y, d) {
  const node = item.cel ? item({}) : item(ctx, j);
  const [bx, by, bw, bh] = item.cel?.box ?? bounds([node]) ?? [-50, -50, 100, 100], k = d / Math.max(bw, bh, 1);
  return place(x, y, { scale: k }, place(-(bx + bw / 2), -(by + bh / 2), node));
}
// A step as { text, cel }: a string is its text.
const stepOf = (s) => (typeof s === 'string' ? { text: s } : { ...s });
// The presenter's x at the side it stands on, and the middle of what is left of the frame for the diagram.
const standX = (o, left, right) => (o.side === 'right' ? right : left);
const middleX = (o, x) => x ?? (o.actor ? (o.side === 'right' ? 460 : 620) : 540);

// A seed, the first of AR's default process (seed, sprout, flower).
export const seed = cel('seed', () => {
  const body = spline([[0, -26], [18, -8], [16, 16], [0, 26], [-16, 16], [-18, -8]], { closed: true });
  return [fill(body, 'fills.3', { name: 'body' }), stroke(body, 'ink', { w: 2.6, wobble: 0.8 }), stroke(line(-4, -14, 4, 14), 'shade', { w: 1.8, wobble: 0.6, name: 'seam' })];
}, { box: [-20, -28, 40, 56], desc: 'a seed' });
// A sprout with two leaves, the second of AR's default process.
export const sprout = cel('sprout', () => {
  const l = poly([[0, -40], [-36, -66], [-60, -52], [-30, -36], [0, -40]]), r = poly([[0, -52], [30, -86], [60, -74], [34, -50], [0, -52]]);
  return [
    stroke(spline([[0, 40], [-4, 0], [0, -52]]), 'ink', { w: 3, wobble: 1, name: 'stem' }),
    fill(l, 'fills.2', { name: 'leafL' }), stroke(l, 'ink', { w: 2.2, wobble: 1 }),
    fill(r, 'fills.2', { name: 'leafR' }), stroke(r, 'ink', { w: 2.2, wobble: 1 }),
    stroke(line(-50, 40, 50, 40), 'shade', { w: 2.4, wobble: 2, name: 'soil' }),
  ];
}, { box: [-62, -88, 124, 130], desc: 'a sprout, two leaves' });

// ---------- AR. process ----------

// Where the j-th card sits: rows of `cols` across the frame's middle (clear of the teacher), centred on y.
function processCards(o, s) {
  const n = o.steps.length, cols = Math.min(n, o.cols ?? (n > 4 ? Math.ceil(n / 2) : n)), rows = Math.ceil(n / cols);
  const x0 = o.actor && o.side !== 'right' ? 290 : 70, x1 = o.actor && o.side === 'right' ? 790 : 1010, gap = o.gap;
  const w = Math.min(o.card, (x1 - x0 - gap * (cols - 1)) / cols), h = w * 0.72 + s * 2.7;
  return o.steps.map((_, j) => {
    const r = Math.floor(j / cols), c = j % cols, inRow = r < rows - 1 ? cols : n - r * cols;
    const cx = (x0 + x1) / 2 + (c - (inRow - 1) / 2) * (w + gap), cy = o.y + (r - (rows - 1) / 2) * (h + gap * 1.2);
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, row: r };
  });
}
function processPlan(o) {
  if (!['straight', 'curved'].includes(o.arrows)) throw new TypeError(`process: arrows '${o.arrows}' is not straight or curved`);
  const A = audienceOf(o.audience), steps = o.steps.map(stepOf), out = [];
  if (!steps.length) throw new TypeError('process: needs steps');
  let t = o.at;
  steps.forEach((st, j) => {
    const w0 = t + 0.45, w1 = w0 + writeT(st.text ?? '', A), a0 = o.per ? t + o.per - 0.35 : w1 + readT(st.text ?? '', A);
    out.push({ t0: t, w0, w1, a0 });
    if (j < steps.length - 1) t = a0 + 0.35;
  });
  const last = out[out.length - 1];
  return { A, steps, cards: out, end: (o.per ? last.a0 : last.w1 + readT(steps[steps.length - 1].text ?? '', A)) + A.dwell };
}
// The arrow from card a to card b: across between two in a row, down from under a card to the next row's top.
function cardArrow(a, b, curved) {
  const pts = a.row === b.row
    ? [[a.x + a.w + 10, a.cy], [b.x - 10, b.cy]]
    : [[a.cx, a.y + a.h + 8], [b.cx, b.y - 12]];
  const [p, q] = pts, dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
  if (!curved) return line(p[0], p[1], q[0], q[1]);
  const bow = Math.min(40, L * 0.3), m = [(p[0] + q[0]) / 2 + (dy / L) * bow, (p[1] + q[1]) / 2 - (dx / L) * bow];
  return spline([p, m, q], { n: 8 });
}
// AR. Process (a card a beat): the steps in order as cards, left to right (in rows of `cols` past four), each
// card drawn, its picture (`cel`: a cel or (ctx, j) => node) popping in, its text written under it and read,
// then an arrow ('straight' or 'curved') drawn on to the next. `per` fixes the seconds a step. The teacher
// points at each card as it arrives, and cheers at the end. steps: [{ text, cel }] or strings.
export const process = recipe('AR', 'process', {
  dur: (o) => processPlan(o).end, steps: [{ text: 'seed', cel: seed }, { text: 'sprout', cel: sprout }, { text: 'flower', cel: flower }],
  arrows: 'curved', per: null, audience: 'general', actor: null, side: 'left', h: 300, y: 500, card: 240, gap: 70, cols: null,
  size: 40, role: 'ink', frame: 'ink', mark: 'inks.1', at: 0.4, pose: 'point-r', seed: 190,
}, (ctx, o) => {
  const P = processPlan(o), { A } = P, t = ctx.t, s = o.size * A.text, cards = processCards(o, s);
  const kids = P.steps.map((st, j) => {
    const q = P.cards[j], c = cards[j];
    if (t < q.t0) return null;
    const pic = st.cel && popIn(popAt(t, q.t0 + 0.3), c.cx, c.y + c.w * 0.4, fitted(st.cel, ctx, j, 0, 0, c.w * 0.6));
    const word = st.text && letters(st.text, c.cx, c.y + c.w * 0.72 + s * 0.2, { size: s, align: 'center', valign: 'top', width: c.w - 20, role: o.role, seed: o.seed + 20 + j });
    const next = cards[j + 1];
    return group(`step${j}`, [
      writeOn(ramp(q.t0, q.t0 + 0.35, t), stroke(roundRect(c.x, c.y, c.w, c.h, 18), o.frame, { w: 2.6, wobble: 1.2, seed: o.seed + j, name: 'card' })),
      pic,
      word && writeOn(ramp(q.w0, q.w1, t), word),
      next && t >= q.a0 && writeOn(ramp(q.a0, q.a0 + 0.35, t), arrow(cardArrow(c, next, o.arrows === 'curved'), o.mark, { seed: o.seed + 40 + j })),
    ]);
  });
  const done = t >= P.cards[P.cards.length - 1].w1;
  return [
    group({ name: 'process', box: bounds(cards.map((c) => stroke(roundRect(c.x, c.y, c.w, c.h, 18), 'ink', { w: 0 }))) }, kids),
    o.actor && presenter(o.actor, ctx, { x: standX(o, 150, 930), feet: 1010, h: o.h, side: o.side, pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.cards[P.cards.length - 1].w1) : reach(t, o.at), emote: done ? 'happy' : null, seed: o.seed }),
  ];
}, { anchor: { name: 'process' }, cast: false });

// ---------- AS. cycle diagram ----------

function cyclePlan(o) {
  const A = audienceOf(o.audience), steps = o.steps.map(stepOf), n = steps.length, out = [];
  if (n < 2) throw new TypeError('cycleDiagram: needs two steps or more');
  let t = o.at + (o.centre ? writeT(o.centre, A) + readT(o.centre, A) : 0);
  const c1 = o.at + (o.centre ? writeT(o.centre, A) : 0);
  steps.forEach((st) => {
    const w0 = t + 0.3, w1 = w0 + writeT(st.text ?? '', A), a0 = o.per ? t + o.per - 0.4 : w1 + readT(st.text ?? '', A);
    out.push({ t0: t, w0, w1, a0 });
    t = a0 + 0.4;
  });
  const lap = o.travel ? o.lap ?? n * Math.max(0.6, A.dwell) : 0, l0 = t + 0.1;
  return { A, steps, nodes: out, c1, l0, l1: l0 + lap * o.laps, lap, end: (o.travel ? l0 + lap * o.laps : t) + A.dwell };
}
// AS. Cycle diagram (a beat a step, then a lap): the steps on a ring (clockwise from `start`, the top), one at
// a time: a node pops in (its `cel` in it, or a coloured dot), its name lettered along the ring outside it
// (textOnPath; at the sides, level inside the ring), then an arrow along the ring to the next, the last one
// closing the loop. With `travel` a marker then goes round `laps` times (a lap in `lap` seconds, default the
// dwell a step), each node swelling as it passes. `centre` letters a title in the middle first. The teacher
// points, then cheers once the loop is closed. steps: [{ text, cel }] or strings.
export const cycleDiagram = recipe('AS', 'cycle', {
  dur: (o) => cyclePlan(o).end, steps: ['rain', 'river', 'sea', 'cloud'], travel: true, laps: 1, lap: null, per: null, centre: null,
  audience: 'general', actor: null, side: 'left', h: 300, x: null, y: 520, r: 270, node: 38, start: -Math.PI / 2,
  size: 44, role: 'ink', ring: 'inks.1', marker: 'accents.0', at: 0.4, pose: 'point-r', seed: 200,
}, (ctx, o) => {
  const P = cyclePlan(o), { A } = P, t = ctx.t, s = o.size * A.text, n = P.steps.length, cx = middleX(o, o.x), cy = o.y, R = o.r;
  const ang = (j) => o.start + (j / n) * Math.PI * 2, pt = (a, r = R) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const gapA = (o.node + 14) / R;
  // The marker's angle while it travels, and how much each node swells as it passes (0..1).
  const lapU = o.travel && t >= P.l0 && t < P.l1 ? (t - P.l0) / P.lap : null;
  const swell = (j) => {
    if (lapU === null) return 0;
    const d = ((lapU % 1) * n - j + n) % n;
    return Math.max(0, 1 - Math.min(d, n - d) * 2.5);
  };
  const label = (st, j) => {
    const a = ang(j), c = Math.cos(a), sn = Math.sin(a), size = s, seed = o.seed + 20 + j;
    if (Math.abs(c) > 0.8) {
      // At the sides: level, inside the ring, ending (or starting) a gap from the node.
      const [nx, ny] = pt(a), y0 = ny + s * 0.3, x = nx - Math.sign(c) * (o.node + 22);
      return c > 0 ? textOnPath(st.text, line(x - 2000, y0, x, y0), { size, align: 'end', role: o.role, seed, ink2: null })
        : textOnPath(st.text, line(x, y0, x + 2000, y0), { size, align: 'start', role: o.role, seed, ink2: null });
    }
    // Top: on an arc outside, run clockwise, letters standing out; bottom: run the other way, a cap height further out, letters standing in.
    const top = sn < 0, rb = R + o.node + 14 + (top ? 0 : s * 0.72);
    return textOnPath(st.text, top ? arc(cx, cy, rb, a - Math.PI / 2, a + Math.PI / 2) : arc(cx, cy, rb, a + Math.PI / 2, a - Math.PI / 2), { size, role: o.role, seed, ink2: null });
  };
  const kids = P.steps.map((st, j) => {
    const q = P.nodes[j];
    if (t < q.t0) return null;
    const a = ang(j), [nx, ny] = pt(a), sw = 1 + 0.25 * ease.io(swell(j));
    const body = st.cel ? fitted(st.cel, ctx, j, 0, 0, o.node * 1.6) : fill(circle(0, 0, o.node * 0.62, 32), `fills.${j % 4}`, { name: 'dot' });
    const node = [fill(circle(0, 0, o.node, 40), 'paper', { name: 'nodeBg' }), stroke(circle(0, 0, o.node, 40), 'ink', { w: 2.6, wobble: 1, seed: o.seed + j, name: 'node' }), body];
    const link = arc(cx, cy, R, a + gapA, ang(j + 1) - gapA);
    return group(`step${j}`, [
      t >= q.a0 && writeOn(ramp(q.a0, q.a0 + 0.4, t), arrow(link, o.ring, { seed: o.seed + 40 + j, name: 'link' })),
      popIn(popAt(t, q.t0), nx, ny, place(0, 0, { scale: sw }, node)),
      st.text && writeOn(ramp(q.w0, q.w1, t), label(st, j)),
    ]);
  });
  const centre = o.centre && writeOn(ramp(o.at, P.c1, t), letters(o.centre, cx, cy + s * 0.3, { size: s, align: 'center', width: R * 1.3, role: o.role, seed: o.seed + 9 }));
  const [mx, my] = lapU === null ? [0, 0] : pt(ang(0) + (lapU % 1) * Math.PI * 2);
  const heading = lapU === null ? 0 : ang(0) + (lapU % 1) * Math.PI * 2 + Math.PI / 2, m = o.node * 0.55;
  const marker = lapU !== null && place(mx, my, { rot: heading }, fill(poly([[m, 0], [-m * 0.7, -m * 0.7], [-m * 0.3, 0], [-m * 0.7, m * 0.7]]), o.marker, { name: 'traveller' }));
  const done = t >= P.nodes[n - 1].a0 + 0.4;
  return [
    group({ name: 'cycle', box: [cx - R - o.node, cy - R - o.node, 2 * (R + o.node), 2 * (R + o.node)] }, [centre && group('centre', [centre]), ...kids]),
    marker,
    o.actor && presenter(o.actor, ctx, { x: standX(o, 150, 930), feet: 1010, h: o.h, side: o.side, pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.nodes[n - 1].a0 + 0.4) : reach(t, o.at), emote: done ? 'happy' : null, seed: o.seed }),
  ];
}, { anchor: { name: 'cycle' }, cast: false });

// ---------- AT. number line ----------

// The numbers a hop goes through: start, then each of jumpTo, a unit at a time when `hops` is 'unit'.
function hopsOf(o) {
  const targets = [o.jumpTo ?? []].flat(), out = [];
  let x = o.start ?? o.from;
  for (const to of targets) {
    if (!Number.isFinite(to) || to < o.from || to > o.to) throw new TypeError(`numberLine: jumpTo ${to} is not on the line ${o.from} to ${o.to}`);
    const d = to - x, unit = o.hops === 'unit' && Math.abs(d) <= 12 && Number.isInteger(d);
    const seg = { from: x, to, hops: [] };
    if (unit) for (let k = 1; k <= Math.abs(d); k++) seg.hops.push([x + Math.sign(d) * (k - 1), x + Math.sign(d) * k]);
    else if (d) seg.hops.push([x, to]);
    out.push(seg);
    x = to;
  }
  return out;
}
const signed = (d) => `${d < 0 ? '-' : '+'}${Math.abs(d)}`;
function linePlan(o) {
  const A = audienceOf(o.audience), segs = hopsOf(o), marks = marksOf(o), per = o.per ?? A.count;
  const l1 = o.at + 0.5, n1 = l1 + 1.2, m0 = n1 + 0.2;
  let t = m0 + 0.25 + A.dwell;
  const out = segs.map((seg) => {
    const hops = seg.hops.map(() => { const h = t; t += per; return h; });
    const lab = t, lab1 = lab + writeT(signed(seg.to - seg.from), A);
    t = lab1 + readT(signed(seg.to - seg.from), A);
    return { ...seg, at: hops, lab, lab1 };
  });
  return { A, per, marks, l1, n1, m0, segs: out, ring: t, end: t + 0.4 + A.dwell };
}
// The numbers written under the line: `marks` (a list, or a step), by default every tick when there are 11 or
// fewer and they fit the audience's words with the legs' '+n' (12 on a general board), else the ends, the
// start and where each leg lands.
function marksOf(o, A = audienceOf(o.audience)) {
  if (Array.isArray(o.marks)) return o.marks;
  const out = [], ticks = Math.floor((o.to - o.from) / o.step + 1e-9) + 1, legs = [o.jumpTo ?? []].flat();
  if (o.marks == null && (ticks > 11 || ticks + legs.length > (A.words ?? 12))) {
    return [...new Set([o.from, o.start ?? o.from, ...legs, o.to])].sort((a, b) => a - b);
  }
  for (let v = o.from; v <= o.to + 1e-9; v += o.marks ?? o.step) out.push(+v.toFixed(6));
  return out;
}
// AT. Number line (a hop a beat): a line from `from` to `to` drawn with a tick every `step` and the numbers
// (`marks`: a list, or every how many; by default every tick if they fit the audience's words, else the
// ends, the start and the landings) written under it; a marker (`marker`: a cel or (ctx) => node, default a
// dot) pops in at `start` (default `from`) and hops to `jumpTo` (a number or a list, one leg each), a unit at
// a time (`hops: 'unit'`, the audience's counting pace or `per` a hop) or in one leap (`hops: 'one'`), each
// hop an arc drawn as it goes; each leg's '+n' is written over its arcs, and the number it lands on at the
// end is ringed. The teacher points, then cheers.
export const numberLine = recipe('AT', 'number line', {
  dur: (o) => linePlan(o).end, from: 0, to: 10, step: 1, marks: null, start: 3, jumpTo: 7, hops: 'unit', per: null, marker: null,
  audience: 'general', actor: null, side: 'left', h: 280, x: null, y: 600, width: 760, size: 40, role: 'ink', mark: 'inks.1',
  dot: 'accents.0', at: 0.4, pose: 'point-r', seed: 210,
}, (ctx, o) => {
  if (!(o.to > o.from) || !(o.step > 0)) throw new TypeError(`numberLine: from ${o.from} to ${o.to} by ${o.step} is not a line`);
  const P = linePlan(o), { A } = P, t = ctx.t, s = o.size * A.text, cx = middleX(o, o.x);
  const x0 = cx - o.width / 2, xAt = (v) => x0 + ((v - o.from) / (o.to - o.from)) * o.width, y = o.y;
  const ticks = [];
  for (let v = o.from; v <= o.to + 1e-9; v += o.step) ticks.push({ pts: [xAt(v), y - 12, xAt(v), y + 12], closed: false });
  const axis = [
    writeOn(ramp(o.at, P.l1, t), stroke(line(x0 - 30, y, x0 + o.width + 30, y), 'ink', { w: 3, wobble: 1, seed: o.seed, name: 'line' })),
    writeOn(ramp(o.at + 0.2, P.l1, t), stroke({ sub: ticks, box: [x0, y - 12, o.width, 24] }, 'ink', { w: 2.4, wobble: 0.6, seed: o.seed + 1, name: 'ticks' })),
    group('numbers', P.marks.map((v, j) => {
      const u = P.l1 + (j / P.marks.length) * (P.n1 - P.l1);
      return t >= u && writeOn(ramp(u, u + Math.min(0.3, writeT(String(v), A)), t), letters(String(v), xAt(v), y + 24 + s * 0.75, { size: s, align: 'center', role: o.role, seed: o.seed + 10 + j }));
    })),
  ];
  // Where the marker is: at start, then along each hop's arc as it goes (a hop lands a tenth before its beat ends).
  const arcOf = ([a, b]) => { const xa = xAt(a), xb = xAt(b), hh = Math.min(140, 30 + Math.abs(xb - xa) * 0.5); return [xa, xb, hh]; };
  const along = ([xa, xb, hh], u) => [lerp(xa, xb, u), y - 18 - Math.sin(Math.PI * u) * hh];
  let pos = [xAt(o.start ?? o.from), y - 18];
  const arcs = [], labels = [];
  P.segs.forEach((seg, g) => {
    seg.hops.forEach((hop, k) => {
      const t0 = seg.at[k], u = ramp(t0, t0 + P.per * 0.9, t, ease.io);
      if (t < t0) return;
      const A3 = arcOf(hop), pts = Array.from({ length: 17 }, (_, i) => along(A3, i / 16));
      arcs.push(writeOn(u, arrow(spline(pts), o.mark, { w: 2.6, head: 12, seed: o.seed + 30 + g * 20 + k, name: 'hop' })));
      pos = along(A3, u);
    });
    if (t >= seg.lab && seg.hops.length) {
      const xa = xAt(seg.from), xb = xAt(seg.to), top = Math.max(...seg.hops.map((h) => arcOf(h)[2]));
      labels.push(writeOn(ramp(seg.lab, seg.lab1, t), letters(signed(seg.to - seg.from), (xa + xb) / 2, y - 40 - top - s * 0.2, { size: s, align: 'center', role: o.mark, seed: o.seed + 90 + g })));
    }
  });
  const last = P.segs[P.segs.length - 1]?.to ?? o.start ?? o.from;
  const ringed = t >= P.ring && writeOn(ramp(P.ring, P.ring + 0.4, t), stroke(ellipse(xAt(last), y + 24 + s * 0.45, s * 0.75, s * 0.7, 32), o.dot, { w: 3, wobble: 1.4, seed: o.seed + 99, name: 'ring' }));
  const marker = t >= P.m0 && popIn(popAt(t, P.m0), pos[0], pos[1] - 4, o.marker ? fitted(o.marker, ctx, 0, 0, -20, 56) : [fill(circle(0, 0, 14, 24), o.dot, { name: 'bead' }), stroke(circle(0, 0, 14, 24), 'ink', { w: 2.4, wobble: 0.6 })]);
  const done = t >= P.ring;
  return [
    group({ name: 'numberLine', box: [x0 - 30, y - 200, o.width + 60, 240 + s] }, [...axis, group('hops', arcs), group('legs', labels), ringed]),
    marker && group('marker', [marker]),
    o.actor && presenter(o.actor, ctx, { x: standX(o, 150, 930), feet: 1010, h: o.h, side: o.side, pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.ring) : reach(t, o.at), emote: done ? 'happy' : null, seed: o.seed }),
  ];
}, { anchor: { name: 'numberLine' }, cast: false });

// The seconds into an AT shot at which each hop starts (for the score: a note a hop), from the same options.
export const hopTimes = (opts = {}) => linePlan({ ...numberLine.defaults, ...opts }).segs.flatMap((g) => g.at);

// ---------- AU. growth ----------

// The values it counts through: from, then every `by` to `to` (by default the step keeping it to 9 numbers).
function growthPlan(o) {
  const A = audienceOf(o.audience), span = o.to - o.from;
  if (!(span > 0)) throw new TypeError(`growth: from ${o.from} to ${o.to} does not grow`);
  const by = o.by ?? Math.max(1, Math.ceil(span / 8)), vals = [];
  for (let v = o.from; v < o.to; v += by) vals.push(v);
  vals.push(o.to);
  const per = o.per ?? A.count, l1 = o.at + (o.label ? writeT(o.label, A) : 0.3), g0 = l1 + 0.3;
  return { A, by, vals, per, l1, g0, g1: g0 + (vals.length - 1) * per, end: g0 + (vals.length - 1) * per + readT(`${o.label ?? ''} ${o.to}`, A) + A.dwell };
}
// AU. Growth (a value a beat): a baseline with its `label` written under it, then a bar (no `cel`) rising from
// `from` to `to`, or a pictograph (`cel`: a cel or (ctx, j) => node) stacking one picture a `unit` in columns of
// `cols`; either way the number above it counts on (`count: false` for none) in steps of `by` (default: at
// most nine numbers), a step every `per` seconds (the audience's counting pace). `max` is the value the full
// height stands for (default `to`). The teacher points, then cheers at the top.
export const growth = recipe('AU', 'growth', {
  dur: (o) => growthPlan(o).end, cel: null, from: 0, to: 8, by: null, unit: 1, max: null, count: true, label: null, per: null,
  audience: 'general', actor: null, side: 'left', h: 300, x: null, y: 820, height: 520, width: 150, cols: 2, size: 44,
  role: 'ink', bar: 'fills.0', at: 0.4, pose: 'point-r', seed: 220,
}, (ctx, o) => {
  const P = growthPlan(o), { A } = P, t = ctx.t, s = o.size * A.text, cx = middleX(o, o.x), floor = o.y, max = o.max ?? o.to;
  // The value now: each step eases up over 0.8 of its beat; the counted number is the last step reached.
  const k = t < P.g0 ? 0 : Math.min(P.vals.length - 1, Math.floor((t - P.g0) / P.per + 1e-9));
  const v = k >= P.vals.length - 1 || t < P.g0 ? P.vals[k] : lerp(P.vals[k], P.vals[k + 1], ramp(P.g0 + k * P.per, P.g0 + (k + 0.8) * P.per, t, ease.io));
  const yOf = (u) => floor - (u / max) * o.height;
  let body, top;
  if (!o.cel) {
    const h = Math.max(0, floor - yOf(v));
    body = h > 0.5 && [fill(rect(cx - o.width / 2, floor - h, o.width, h), o.bar, { name: 'barFill' }), stroke(rect(cx - o.width / 2, floor - h, o.width, h), 'ink', { w: 2.6, wobble: 0.8, seed: o.seed + 3, name: 'bar' })];
    top = floor - h;
  } else {
    // One picture a unit, in columns of cols from the floor up, each popping in as the count passes it.
    const n = Math.round((o.to - 0) / o.unit), cell = Math.min(o.height / Math.ceil(n / o.cols), o.width), shown = Math.floor(v / o.unit + 1e-9);
    const pics = [];
    for (let j = 0; j < shown; j++) {
      const r = Math.floor(j / o.cols), c = j % o.cols, px = cx + (c - (o.cols - 1) / 2) * cell, py = floor - cell * (r + 0.5);
      const tj = P.g0 + ((j + 1) * o.unit - P.vals[0]) / P.by * P.per - P.per;
      pics.push(popIn(popAt(t, Math.max(P.g0 - 0.25, tj)), px, py, fitted(o.cel, ctx, j, 0, 0, cell * 0.85)));
    }
    body = pics;
    top = floor - cell * Math.ceil(Math.max(1, shown) / o.cols);
  }
  const number = o.count && t >= P.g0 - 0.3 && letters(String(P.vals[k]), cx, top - 20, { size: s * 1.3, align: 'center', role: o.role, seed: o.seed + 50 + k });
  const done = t >= P.g1;
  return [
    writeOn(ramp(o.at, o.at + 0.3, t), stroke(line(cx - 200, floor, cx + 200, floor), 'ink', { w: 3, wobble: 1, seed: o.seed, name: 'baseline' })),
    o.label && writeOn(ramp(o.at, P.l1, t), letters(o.label, cx, floor + s * 1.3, { size: s, align: 'center', role: o.role, seed: o.seed + 1 })),
    group({ name: 'growth', box: [cx - 200, floor - o.height - s * 1.6, 400, o.height + s * 1.6] }, [body && group('rising', body), number && group('count', [number])]),
    o.actor && presenter(o.actor, ctx, { x: standX(o, 150, 930), feet: 1010, h: o.h, side: o.side, pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.g1) : reach(t, o.at), emote: done ? 'happy' : null, seed: o.seed }),
  ];
}, { anchor: { name: 'growth' }, cast: false });

// ---------- 4.0 E4: question, quiz, map, dialogue (AV to AY) ----------

// The teacher's stand when a recipe does not centre it: at the side, feet on the floor.
const stand = (o, ctx, extra) => o.actor && presenter(o.actor, ctx, { x: standX(o, 150, 930), feet: 1010, h: o.h, side: o.side, seed: o.seed, ...extra });

// ---------- AV. question card ----------

// A big question mark, h tall, centred at (x, y): the hook (one stroke) and the dot (a fill about the origin,
// to pop in at `at` after the hook is drawn).
function questionMark(x, y, h, role, seed) {
  const P = [[-0.27, -0.26], [-0.2, -0.43], [0, -0.5], [0.22, -0.44], [0.29, -0.25], [0.18, -0.08], [0.02, 0.04], [0, 0.22]];
  return {
    hook: stroke(spline(P.map(([u, v]) => [x + u * h, y + v * h]), { n: 8 }), role, { w: Math.max(6, h * 0.075), wobble: 1.4, seed, name: 'hook' }),
    dot: fill(circle(0, 0, h * 0.06, 24), role, { name: 'point' }), at: [x, y + 0.41 * h],
  };
}
function questionPlan(o) {
  const A = audienceOf(o.audience), q0 = o.at, q1 = q0 + 0.7, d1 = q1 + 0.2, w0 = d1 + 0.15, w1 = w0 + writeT(o.text, A);
  return { A, q0, q1, d1, w0, w1, end: w1 + readT(o.text, A) + A.dwell };
}
// AV. Question card (3 to 5 s): a big `?` is drawn (the hook, then its dot pops), the question is written on
// under it (centred, wrapped to `width`, hanging from `y`) and read; the actor at the side shrugs (`pose`) and looks puzzled
// (`emote`) once the mark is down. The mark is drawn, not lettered, so it is no word for lint.
export const questionCard = recipe('AV', 'question', {
  dur: (o) => questionPlan(o).end, text: 'why does the moon change shape?', audience: 'general', actor: null, side: 'right', h: 360,
  x: null, y: 560, mark: 'accents.0', markH: 340, size: 72, width: 720, role: 'ink', at: 0.25, pose: 'shrug', emote: 'confused', seed: 230,
}, (ctx, o) => {
  const P = questionPlan(o), { A } = P, t = ctx.t, s = o.size * A.text, x = middleX(o, o.x);
  // The question hangs from y (its first line's top there); the mark stands above it.
  const words = letters(o.text, x, o.y, { size: s, align: 'center', valign: 'top', width: o.width, role: o.role, seed: o.seed + 1 });
  const top = bounds(words.kids)?.[1] ?? o.y, q = questionMark(x, top - 40 - o.markH * 0.53, o.markH, o.mark, o.seed);
  return [
    group({ name: 'question', box: bounds([q.hook, place(...q.at, q.dot), words]) }, [
      writeOn(ramp(P.q0, P.q1, t), q.hook),
      popIn(popAt(t, P.q1), ...q.at, q.dot),
      writeOn(ramp(P.w0, P.w1, t), words),
    ]),
    stand(o, ctx, { pose: o.pose, k: reach(t, P.q1), emote: t >= P.q1 ? o.emote : null }),
  ];
}, { anchor: { name: 'question' }, cast: false });

// ---------- AW. quiz ----------

const optionOf = (s) => (typeof s === 'string' ? { text: s } : { ...s });
function quizPlan(o) {
  const A = audienceOf(o.audience), opts = o.options.map(optionOf), n = opts.length;
  if (n < 2 || n > 4) throw new TypeError(`quiz: needs two to four options, got ${n}`);
  if (!Number.isInteger(o.answer) || o.answer < 0 || o.answer >= n) throw new TypeError(`quiz: answer ${o.answer} is not an option's index (0 to ${n - 1})`);
  const q1 = o.at + writeT(o.question, A);
  let t = q1 + readT(o.question, A);
  const rows = opts.map((op) => { const r = { t0: t, w0: t + 0.3, w1: t + 0.3 + writeT(op.text, A) }; t = r.w1 + readT(op.text, A) * 0.5 + 0.2; return r; });
  const p0 = t, p1 = p0 + (o.pause ?? Math.max(1.5, A.dwell * 2.5));
  const wrong = opts.map((_, j) => j).filter((j) => j !== o.answer), ticks = wrong.map((_, k) => p1 + k * 0.6);
  const ding = p1 + wrong.length * 0.6 + 0.2;
  return { A, opts, q1, rows, p0, p1, wrong, ticks, ding, end: ding + 0.5 + readT(opts[o.answer].text, A) + A.dwell };
}
// AW. Quiz (a beat an option, a pause, the answer): the question is written at the top and read, the options
// (two to four: strings, or { text, cel }) arrive one under another, each with a box to its left (its `cel`
// popping in beside it), then a pause (`pause` seconds, by default 2.5 dwells, at least 1.5 s) while three dots
// fill in one by one; the wrong ones are struck through and crossed in their boxes one at a time, then the
// right one (`answer`, its index) is circled and ticked. The teacher thinks through the pause, points at the
// answer and cheers. quizTimes(opts) gives the score the strikes (a tick each) and the ding.
export const quiz = recipe('AW', 'quiz', {
  dur: (o) => quizPlan(o).end, question: 'which moon is round?', options: ['new', 'half', 'full'], answer: 2, pause: null,
  audience: 'general', actor: null, side: 'left', h: 300, x: null, y: 250, gap: 130, size: 52, width: 700, role: 'ink',
  box: 'ink', strike: 'inks.2', ring: 'inks.3', at: 0.3, seed: 240,
}, (ctx, o) => {
  const P = quizPlan(o), { A } = P, t = ctx.t, s = o.size * A.text, cx = middleX(o, o.x);
  const question = letters(o.question, cx, o.y, { size: s * 1.1, align: 'center', valign: 'bottom', width: o.width, role: o.role, seed: o.seed });
  const qb = bounds(question.kids) ?? [cx - o.width / 2, o.y - s, o.width, s];
  const rowY = (j) => qb[1] + qb[3] + o.gap * (j + 1) * A.text, bx = cx - o.width / 2 + 20, b = s * 0.8;
  const rows = P.opts.map((op, j) => {
    const r = P.rows[j], y = rowY(j);
    if (t < r.t0) return null;
    const tx = bx + b + 30 + (op.cel ? b * 1.6 : 0);
    const word = letters(op.text, tx, y + s * 0.32, { size: s, align: 'left', role: o.role, seed: o.seed + 10 + j });
    const wb = bounds(word.kids) ?? [tx, y - s * 0.4, s * 2, s * 0.8];
    const tick = P.wrong.indexOf(j), struck = tick >= 0 && t >= P.ticks[tick], right = j === o.answer && t >= P.ding;
    const k0 = tick >= 0 ? P.ticks[tick] : P.ding;
    const mark = struck
      ? writeOn(ramp(k0, k0 + 0.35, t), group('crossed', [
        stroke({ sub: [{ pts: [bx + 6, y - b / 2 + 6, bx + b - 6, y + b / 2 - 6], closed: false }, { pts: [bx + b - 6, y - b / 2 + 6, bx + 6, y + b / 2 - 6], closed: false }], box: [bx, y - b / 2, b, b] }, o.strike, { w: 4, wobble: 0.8, seed: o.seed + 30 + j, name: 'cross' }),
        stroke(line(wb[0] - 10, wb[1] + wb[3] * 0.55, wb[0] + wb[2] + 10, wb[1] + wb[3] * 0.45), o.strike, { w: 4, wobble: 1, seed: o.seed + 40 + j, name: 'strike' }),
      ]))
      : right && writeOn(ramp(k0, k0 + 0.5, t), group('answer', [
        stroke(poly([[bx + 8, y], [bx + b * 0.4, y + b / 2 - 8], [bx + b + 6, y - b / 2 - 10]], false), o.ring, { w: 4.5, wobble: 0.8, seed: o.seed + 50, name: 'tick' }),
        stroke(ellipse(wb[0] + wb[2] / 2, wb[1] + wb[3] / 2, wb[2] / 2 + 34, wb[3] / 2 + 22, 40), o.ring, { w: 4, wobble: 1.6, seed: o.seed + 51, name: 'ring' }),
      ]));
    return group(`option${j}`, [
      writeOn(ramp(r.t0, r.t0 + 0.3, t), stroke(roundRect(bx, y - b / 2, b, b, 8), o.box, { w: 2.6, wobble: 1, seed: o.seed + 20 + j, name: 'box' })),
      op.cel && popIn(popAt(t, r.t0 + 0.2), bx + b + 22 + b * 0.7, y, fitted(op.cel, ctx, j, 0, 0, b * 1.3)),
      writeOn(ramp(r.w0, r.w1, t), word),
      mark,
    ]);
  });
  // The pause: three dots under the options, filling in one a third of the way.
  const dy = rowY(P.opts.length - 1) + o.gap * 0.7 * A.text;
  const dots = t >= P.p0 && t < P.ding && group('pause', [0, 1, 2].map((k) => t >= P.p0 + ((P.p1 - P.p0) * k) / 3 && fill(circle(cx - 40 + k * 40, dy, 9, 16), 'shade', { name: 'wait' })));
  const box = [cx - o.width / 2, qb[1], o.width, rowY(P.opts.length - 1) + o.gap * 0.5 - qb[1]];
  const thinking = t >= P.p0 && t < P.p1, pointing = t >= P.p1 && t < P.ding, done = t >= P.ding;
  return [
    group({ name: 'quiz', box }, [writeOn(ramp(o.at, P.q1, t), question), ...rows, dots]),
    stand(o, ctx, { pose: done ? 'cheer' : pointing ? 'point-r' : 'think', k: done ? reach(t, P.ding) : pointing ? reach(t, P.p1) : reach(t, P.p0), emote: done ? 'happy' : thinking ? 'thinking' : null }),
  ];
}, { anchor: { name: 'quiz' }, cast: false });

// The seconds into an AW shot of each wrong option's strike (a tick each) and of the answer's ring (a ding),
// and the pause, from the same options, for the score.
export const quizTimes = (opts = {}) => { const P = quizPlan({ ...quiz.defaults, ...opts }); return { ticks: P.ticks, ding: P.ding, pause: [P.p0, P.p1] }; };

// ---------- AX. map route ----------

// A drawn map to trace a route over (AX's default), 760 by 560 units about its centre: a lake, a river, hills,
// trees and two houses.
export const map = cel('map', () => {
  const sheet = roundRect(-380, -280, 760, 560, 22);
  const lake = spline([[150, 40], [230, 10], [300, 60], [270, 130], [180, 140], [130, 100]], { closed: true });
  const house = (x, y, name) => group(name, [
    fill(rect(x - 26, y - 24, 52, 40), 'fills.3', { name: 'wall' }), stroke(rect(x - 26, y - 24, 52, 40), 'ink', { w: 2.4, wobble: 0.6 }),
    stroke(poly([[x - 34, y - 22], [x, y - 52], [x + 34, y - 22]], false), 'ink', { w: 2.6, wobble: 0.6, name: 'roof' }),
  ]);
  const tree = (x, y, j) => group(`tree${j}`, [stroke(line(x, y, x, y + 26), 'ink', { w: 2.4, wobble: 0.4 }), fill(circle(x, y - 6, 18, 20), 'fills.2', { name: 'crown' }), stroke(circle(x, y - 6, 18, 20), 'ink', { w: 2, wobble: 0.8 })]);
  const hills = [[-200, -170], [-140, -150], [-80, -176]].map(([x, y]) => ({ pts: [x - 36, y + 24, x, y - 18, x + 36, y + 24], closed: false }));
  return [
    stroke(sheet, 'ink', { w: 3, wobble: 1.4, name: 'sheet' }),
    fill(lake, 'fills.1', { name: 'lake' }), stroke(lake, 'inks.1', { w: 2.6, wobble: 1 }),
    stroke(spline([[-380, -40], [-260, -70], [-120, -20], [40, -60], [150, 40]], { n: 8 }), 'inks.1', { w: 5, wobble: 1.2, name: 'river' }),
    stroke({ sub: hills, box: [-236, -194, 192, 66] }, 'shade', { w: 2.6, wobble: 1, name: 'hills' }),
    ...[[-40, 150], [0, 180], [60, 200], [200, -170], [250, -140]].map(([x, y], j) => tree(x, y, j)),
    house(-260, 140, 'home'), house(300, -150, 'school'),
  ];
}, { box: [-384, -284, 768, 568], desc: 'a drawn map: a lake, a river, hills, trees, two houses' });
// Where the places on the default map are, in its units (AX's path is in the same units).
export const MAP_AT = Object.freeze({ home: [-260, 140], school: [300, -150], lake: [215, 75], river: [-120, -20], hills: [-140, -160] });

// The route in frame units, and where the map goes. A cutout photo (hdf photo) is pinned `scale` × 760 wide
// and its route is in its own 0..1 (u, v); a cel or (ctx) => node is placed by `scale` and its route is in
// its own units.
function routeOf(o) {
  const pts = o.path;
  if (!Array.isArray(pts) || pts.length < 2 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new TypeError('mapRoute: path needs two [x, y] points or more');
  const cx = middleX(o, o.x), cy = o.y;
  if (o.map?.sil && o.map.w) {
    const pl = pin(o.map, { x: cx, y: cy, w: 760 * o.scale });
    return { cx, cy, pl, pts: pts.map(([u, v]) => on(pl, u, v)) };
  }
  if (typeof o.map !== 'function') throw new TypeError('mapRoute: map is a cel, (ctx) => node or a cutout photo');
  return { cx, cy, pl: null, pts: pts.map(([u, v]) => [cx + u * o.scale, cy + v * o.scale]) };
}
const mapNodeOf = (o, ctx, R) => (R.pl ? photo(R.pl, { shadow: 0 }) : place(R.cx, R.cy, { scale: o.scale }, group('map', [o.map.cel ? o.map({}) : o.map(ctx)])));
function routePlan(o) {
  const A = audienceOf(o.audience), m1 = o.at + (o.draw ?? 1.2), e1 = m1 + (o.ends?.[0] ? writeT(o.ends[0], A) : 0) + 0.2;
  const L = len(spline(routeOf(o).pts, { n: 8 })), g1 = e1 + (o.travel ?? Math.max(1.5, L / o.speed));
  const x1 = g1 + 0.35, n1 = x1 + (o.ends?.[1] ? writeT(o.ends[1], A) : 0), l1 = n1 + (o.label ? 0.2 + writeT(o.label, A) : 0);
  return { A, m1, e1, g1, x1, n1, l1, end: l1 + readT([o.ends?.[0], o.ends?.[1], o.label].filter(Boolean).join(' '), A) + A.dwell };
}
// The route's label: lettered along the chord from 15% to 85% of the way, left to right so it stands upright,
// on the side of the chord the route does not bow to (a label on the curve itself bunches on its inside).
function labelAlong(str, route, right, s, o) {
  const L = len(route), a = at(route, L * 0.15), b = at(route, L * 0.85), m = at(route, L * 0.5);
  const [p, q] = right ? [a, b] : [b, a], dx = q.x - p.x, dy = q.y - p.y;
  const above = dx * (m.y - p.y) - dy * (m.x - p.x) < 0;   // the route's middle is on the chord's left (above it)
  return textOnPath(str, line(p.x, p.y, q.x, q.y), { size: s, offset: above ? -s * 1.1 : s * 0.5, role: o.role, seed: o.seed + 70, ink2: null });
}
// AX. Map route (a map, then a journey): the map is drawn on in stroke order over `draw` seconds (a photo pops
// in), a start dot and the first of `ends` written by it, then a marker (`marker`: a cel, default a pin)
// travels the route (`path`, a spline through the points, in the map's units) at `speed` units a second (or
// over `travel` seconds), a dashed trail drawn behind it; at the end an X is drawn, the second of `ends` written,
// and `label` lettered along the route (textOnPath, along its chord, on the side it does not bow to).
// The teacher points, then cheers. map: a cel (default `map`), (ctx) => node, or a cutout photo.
export const mapRoute = recipe('AX', 'map', {
  dur: (o) => routePlan(o).end, map, path: [[-260, 165], [-170, 120], [-80, 115], [20, 60], [100, -30], [200, -90], [300, -128]],
  marker: null, label: 'the way to school', ends: ['home', 'school'], draw: null, travel: null, speed: 320,
  audience: 'general', actor: null, side: 'left', h: 300, x: null, y: 500, scale: 1, size: 40, role: 'ink',
  trail: 'accents.0', pin: 'accents.0', at: 0.3, pose: 'point-r', seed: 250,
}, (ctx, o) => {
  const P = routePlan(o), { A } = P, t = ctx.t, s = o.size * A.text, M = routeOf(o), mapNode = mapNodeOf(o, ctx, M);
  const route = spline(M.pts, { n: 8 }), L = len(route), u = ramp(P.e1, P.g1, t, ease.io), here = at(route, u * L);
  const [p0, p1] = [M.pts[0], M.pts[M.pts.length - 1]], right = p1[0] >= p0[0];
  const endWord = (j, [x, y], t0) => o.ends?.[j] && t >= t0 && writeOn(ramp(t0, t0 + writeT(o.ends[j], A), t), letters(o.ends[j], x, y + s * 1.5, { size: s, align: 'center', role: o.role, seed: o.seed + 60 + j }));
  const X = s * 0.45;
  const drawn = [
    t >= P.m1 - 0.2 && popIn(popAt(t, P.m1 - 0.2), p0[0], p0[1], fill(circle(0, 0, 10, 20), o.pin, { name: 'start' })),
    endWord(0, p0, P.m1),
    t >= P.e1 && writeOn(u, stroke(route, o.trail, { w: 4, wobble: 0.8, dash: [16, 12], seed: o.seed + 2, name: 'trail' })),
    t >= P.g1 && writeOn(ramp(P.g1, P.x1, t), stroke({ sub: [{ pts: [p1[0] - X, p1[1] - X, p1[0] + X, p1[1] + X], closed: false }, { pts: [p1[0] + X, p1[1] - X, p1[0] - X, p1[1] + X], closed: false }], box: [p1[0] - X, p1[1] - X, 2 * X, 2 * X] }, o.pin, { w: 5, wobble: 0.6, seed: o.seed + 3, name: 'spot' })),
    endWord(1, p1, P.x1),
    o.label && t >= P.n1 && writeOn(ramp(P.n1 + 0.2, P.l1, t), labelAlong(o.label, route, right, s, o)),
  ];
  // The marker: a pin standing on the route (a cel faces the way it goes), from the start until it arrives.
  const pinNode = [fill(poly([[0, 0], [-14, -26], [-14, -40], [0, -52], [14, -40], [14, -26]]), o.pin, { name: 'pin' }), stroke(circle(0, -38, 6, 12), 'paper', { w: 3, name: 'eye' })];
  const moving = t >= P.m1 - 0.2 && t < P.x1;
  const marker = moving && popIn(popAt(t, P.m1 - 0.2), here.x, here.y, o.marker
    ? place(0, 0, { flip: Math.cos(here.heading) < 0 }, fitted(o.marker, ctx, 0, 0, -30, 64))
    : pinNode);
  const done = t >= P.x1;
  return [
    group({ name: 'route', box: bounds([mapNode]) }, [M.pl ? popIn(popAt(t, o.at), M.cx, M.cy, place(-M.cx, -M.cy, mapNode)) : writeOn(ramp(o.at, P.m1, t), mapNode), group('journey', drawn)]),
    marker && group('marker', [marker]),
    stand(o, ctx, { pose: done ? 'cheer' : o.pose, k: done ? reach(t, P.x1) : reach(t, o.at), emote: done ? 'happy' : null }),
  ];
}, { anchor: { name: 'route' }, cast: false });

// ---------- AY. dialogue shot ----------

// Two actors staged on a ground: [x, y, s] for each (actor.place's stage), s such that its rest pose draws
// h tall, its feet on the ground line.
const drawnH = new WeakMap();
function stageOf(A, x, ground, h) {
  if (!drawnH.has(A)) { const b = bounds(A(A.idle(0, 0)).kids) ?? A.box; drawnH.set(A, b[3] || 1); }
  const s = h / (drawnH.get(A) * A.stage.k(1)), m = A.stage.xf(0, 0, 1), [gx, gy] = A.ground;
  return [x, ground - (m[1] * gx + m[3] * gy + m[5]) * s, s];
}
// The default pair when no actors are given: two stick puppets, an adult and a child.
let PAIR = null;
const pairOf = () => (PAIR ??= [actorOf(puppet(stickSource({ name: 'sam' }))), actorOf(puppet(stickSource({ name: 'kit', build: 'kid' })))]);
// The dialogue a dialogue shot plays, worked out once for its options.
const talks = new WeakMap();
function talkOf(o) {
  if (talks.has(o)) return talks.get(o);
  const [a, b] = o.actor ? [o.actor, o.other ?? pairOf()[1]] : pairOf();
  if (!b || typeof b.say !== 'function') throw new TypeError('dialogueShot: other must be an actor');
  if (a.name === b.name) throw new TypeError(`dialogueShot: the two actors are both called ${a.name}`);
  const hs = [o.h].flat(), where = { [a.name]: stageOf(a, o.x[0], o.ground, hs[0]), [b.name]: stageOf(b, o.x[1], o.ground, hs[1] ?? hs[0]) };
  const who = (w) => (w === 0 || w === 'left' ? a : w === 1 || w === 'right' ? b : w === a || w === b ? w : (() => { throw new TypeError(`dialogueShot: a line's speaker is 0 or 1 ('left' or 'right') or one of the two actors, got ${w?.name ?? w}`); })());
  const turns = o.lines.map(([w, text, q]) => [who(w), text, q ?? {}]);
  const talk = dialogue(turns, { t0: o.at, audience: o.audience, where, gaze: o.gaze, ...(o.gap === null ? {} : { gap: o.gap }) });
  const out = { a, b, where, talk };
  talks.set(o, out);
  return out;
}
// AY. Dialogue shot (a line a beat): two actors (`actor` on the left, `other` on the right; by default two
// stick puppets, sam and a child, kit) stand `h` tall (one for both, or [left, right]) on a ground line at `x`, facing each other, and play
// `lines` ([speaker, text, { kind, emote, voice, ... }], the speaker 0 or 'left', 1 or 'right', or the actor)
// as T9's dialogue: each line at the audience's reading pace, its bubble held through the reply, the listener
// looking at the speaker (`gaze`). dialogueOf(opts) is the same dialogue, for the score (`.events(shot.t0)`).
// Every line is a word for lint: a long exchange is several shots.
export const dialogueShot = recipe('AY', 'dialogue', {
  dur: (o) => talkOf(o).talk.until + 0.25 + audienceOf(o.audience).dwell,
  lines: [[1, 'why does it change?', { emote: 'confused' }], [0, 'the sun lights half.', { emote: 'happy' }]],
  actor: null, other: null, audience: 'general', x: [300, 780], ground: 900, h: [330, 270], gaze: true, gap: null, at: 0.4,
  floor: 'shade', seed: 260,
}, (ctx, o) => {
  const { a, b, where, talk } = talkOf(o), t = ctx.t;
  const figure = (A, j) => A.place(...where[A.name], { ...A.idle(t, o.seed + j), ...talk.state(A, t) });
  return [
    stroke(line(40, o.ground, 1040, o.ground), o.floor, { w: 3, wobble: 2, seed: o.seed, name: 'ground' }),
    group({ name: 'pair', cache: 'never' }, [figure(a, 0), figure(b, 1)]),
    talk.draw(t),
  ];
}, { anchor: { name: 'pair' }, cast: false });

// The dialogue an AY shot with these options plays: its turns, lines and events(t) for the score.
export const dialogueOf = (opts = {}) => talkOf({ ...dialogueShot.defaults, ...opts }).talk;

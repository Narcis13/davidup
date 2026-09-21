// Lint: the review checklist as walks over display lists and the time tree. No pixels. Every shot is
// evaluated at every frame it plays (hold: its last frame only), in its own coordinates and look, so a
// finding names the shot and the first frame it shows up on. Findings are deduplicated per rule, shot
// and subject, which is what makes one broken rule one finding.
import { FPS } from './curves.js';
import { bounds, mmul, norm } from './list.js';
import { fallbacks } from './glyphs.js';
import { handOf, handRecord, parseLookName, resolveLook, resolveRole } from './looks.js';
import { JOINT, VIEW_DIRS, puppet } from './puppet.js';
import { cues, evalShot, frame } from './tree.js';

export const RULES = Object.freeze({
  draw: "the shot's draw function threw",
  role: 'colour role not in the look, or a raw colour',
  'first-op': "a shot's first op is not paper, night or a backdrop image",
  'one-look': 'two finishes in one shot, or a look op inside a shot',
  anchor: "the anchor is missing from a shot, or names nothing it draws",
  scribble: 'more than two scribbled parts in a frame',
  'cel-box': 'a cel draws outside its declared box',
  words: "a shot's words exceed the look's allowance (the sign-off does not count)",
  'cut-long': 'a cut longer than 1 s',
  'cut-adjacent': 'two cuts in a row',
  'cut-orphan': "a cut's outgoing or incoming shot never plays: cut(kind, dur, a, b) is only the transition, write seq(a, cut(kind, dur, a, b), b)",
  'sign-off': 'no sign-off, or it is still being written 1.5 s before the end',
  'subject-size': 'the anchor subject is under the readability floor at 240 px',
  'subject-crop': "the anchor subject is cut by the frame edge without meta('intent', 'crop')",
  grid: 'a cue off the 1/12 s grid',
  'puppet-joint': 'a puppet pose or cycle names nothing, or sets a joint off the 2 degree grid or out of range',
  'roles-raw': 'a raw colour in a puppet part, where a palette role belongs',
  'actor-cycle': 'an actor lacks a cycle a recipe asked for, and its fallback bob is on screen over 1 s in a shot',
  'pack-mirror': "a pack cel's store mirror is missing, or its sha no longer matches what the cel draws",
  'hand-missing': 'the look names a hand the store lacks, or the sign-off falls back to the house hand for a glyph',
  source: 'Math.random, Date, ctx.filter, shadowBlur or a gradient in the film source',
});

// Warnings: worth saying, not worth failing a film for. `hdf lint` prints them and still exits 0.
export const WARNINGS = Object.freeze({
  'inline-asset': 'an asset carried in the film as a data URL instead of named in the store',
});

// Handwritten words a shot may carry, by look (base name, before any '~' derivation). look.words wins.
export const WORDS = Object.freeze({ doodlePastel: 3, cutout: 3 });
export const FLOOR_PX = 24;        // the subject's long side at a 240 px wide render
export const SIGN_OFF_LEAD = 1.5;  // seconds the finished sign-off must hold before the end
const MAX_CUT = 1, MAX_SCRIBBLES = 2, TOL = 1, MAX_BOB = 1;

const lookName = (l) => resolveLook(l).name;
const wordAllowance = (l) => { const lk = resolveLook(l); return lk.words ?? WORDS[lk.name.split('~')[0]] ?? 0; };
const finishOf = (op, look) => (typeof op.finish === 'string' ? op.finish : op.finish?.kind ?? resolveLook(look).finish);
const countWords = (s) => s.split(/\s+/).filter(Boolean).length;
const isCrop = (op) => op.op === 'meta' && op.tag === 'intent' && (op.data === 'crop' || op.data?.crop === true || op.data?.kind === 'crop');
const fmtBox = (b) => `[${b.map((v) => Math.round(v)).join(', ')}]`;

// Where each shot plays: [{ node, f0, ks, i(k), look }]. Cuts show their neighbours' frames, so they are
// not plays of their own; hold plays its child's last frame.
export function plays(film) {
  const out = [];
  const visit = (node, f0, sel, look) => {
    switch (node.kind) {
      case 'shot': {
        const ks = sel === null ? [...Array(node.n).keys()] : [sel];
        out.push({ node, f0, ks, i: (k) => (sel === null ? f0 + k : f0), look });
        break;
      }
      case 'seq': {
        let at = f0, k = sel;
        for (const c of node.kids) {
          if (sel === null) visit(c, at, null, look);
          else if (k < c.n) { visit(c, at, k, look); break; } else k -= c.n;
          at += c.n;
        }
        break;
      }
      case 'par': node.kids.forEach((c) => visit(c, f0, sel === null ? null : Math.min(sel, c.n - 1), look)); break;
      case 'hold': visit(node.child, f0, node.child.n - 1, look); break;
      case 'look': visit(node.child, f0, sel, node.look); break;
      default: break;
    }
  };
  visit(film.timeline, 0, null, undefined);
  return out;
}

function finder() {
  const seen = new Set(), list = [];
  return {
    list,
    add(rule, shot, frame, detail, key = detail) {
      const id = `${rule}|${shot}|${key}`;
      if (seen.has(id)) return;
      seen.add(id);
      list.push({ rule, shot, frame, detail });
    },
  };
}

// Cel groups checked against their box once per (frozen, memoised) group object.
const celMemo = new WeakMap();
export function celOverflow(op) {
  if (celMemo.has(op)) return celMemo.get(op);
  const b = bounds(op.kids), [x, y, w, h] = op.box;
  const out = b && (b[0] < x - TOL || b[1] < y - TOL || b[0] + b[2] > x + w + TOL || b[1] + b[3] > y + h + TOL) ? b : null;
  celMemo.set(op, out);
  return out;
}

// One evaluated shot frame: roles, looks, finishes, scribbles, cels, words, anchors and crop intent.
function scan(list, look, report) {
  const got = { looks: 0, finishes: new Set(), scribbles: 0, words: new Set(), anchors: [], crop: false, bobs: new Set() };
  const role = (r, lk, where) => {
    if (r === null || r === undefined) return;
    try { resolveRole(r, lk); } catch (e) { report('role', `${where}: ${e.message}`, `${JSON.stringify(r)}@${lookName(lk)}`); }
  };
  const visit = (ops, lk, inSignOff) => {
    for (const op of ops) {
      switch (op.op) {
        case 'fill': role(op.role, lk, 'fill'); if (op.finish) got.finishes.add(finishOf(op, lk)); break;
        case 'stroke': case 'dots': role(op.role, lk, op.op); break;
        case 'text':
          role(op.role, lk, 'text');
          if (typeof op.ink2 === 'string') role(op.ink2, lk, 'text ink2');
          if (!inSignOff) got.words.add(op.str);
          break;
        case 'look': if (!op.inset) got.looks++; visit(op.kids, resolveLook(op.look), inSignOff); continue;   // inset: a thumbnail of another shot
        case 'fx': if (op.kind === 'scribble') got.scribbles++; break;
        case 'meta':
          if (op.tag === 'anchor') got.anchors.push(op.data ?? {});
          if (isCrop(op)) got.crop = true;
          if (op.tag === 'actor-cycle') got.bobs.add(`${op.data?.actor}|${op.data?.cycle}`);   // core/actor.js fallback
          break;
        case 'group': {
          if (op.cel && op.box) {
            const b = celOverflow(op);
            if (b) report('cel-box', `cel '${op.cel}' draws ${fmtBox(b)} outside its box ${fmtBox(op.box)}`, op.cel);
          }
          const sign = inSignOff || op.name === 'signOff';
          if (!sign && typeof op.name === 'string' && op.name.startsWith('text:')) got.words.add(op.name.slice(5));
          visit(op.kids, lk, sign);
          continue;
        }
        default: break;
      }
      if (op.kids) visit(op.kids, lk, inSignOff);
    }
  };
  visit(list, resolveLook(look), false);
  return got;
}

// Ops an anchor meta points at ({ cel } or { name }: a group, or any named op such as a sand bed's image),
// with their boxes in shot coordinates.
function anchorBoxes(list, data) {
  const match = data.cel !== undefined ? (op) => op.cel === data.cel : data.name !== undefined ? (op) => op.name === data.name : null;
  if (!match) return null;
  const boxes = [];
  const visit = (ops, m) => {
    for (const op of ops) {
      if (op.op !== 'meta' && match(op)) { const b = bounds([op], m); if (b) boxes.push(b); continue; }
      if (op.kids) visit(op.kids, op.op === 'group' ? mmul(m, op.xf) : m);
    }
  };
  visit(list, [1, 0, 0, 1, 0, 0]);
  return boxes;
}

const anchorLabel = (d) => (d.cel !== undefined ? `cel '${d.cel}'` : d.name !== undefined ? `'${d.name}'` : 'anchor');

// inspect(film) => { findings, shots } where shots summarise each play for `hdf board`:
// { name, f0, n, dur, look, anchor, recipe, camera, finishes, words }.
export function inspect(film) {
  const F = finder(), shots = [];
  for (const p of plays(film)) {
    const { node } = p, name = node.name;
    const s = { name, f0: p.f0, n: p.ks.length === 1 ? 1 : node.n, dur: node.dur, look: null, anchor: true, recipe: node.recipe, camera: node.camera, finishes: new Set(), words: new Set() };
    let looked = false, size = null;
    const bobs = new Map();   // 'actor|cycle' => { n, i }: frames the fallback bob was drawn, and the first
    p.ks.forEach((k, j) => {
      const i = p.i(k);
      const report = (rule, detail, key) => F.add(rule, name, i, detail, key);
      let ev;
      try { ev = evalShot(film, node, k, { i, look: p.look }); } catch (e) { report('draw', e.message, 'draw'); return; }
      s.look ??= lookName(ev.look);
      s.lookObj ??= ev.look;
      const { list, env } = ev;
      if (j === 0) {
        const first = list[0];
        const backdrop = first?.op === 'image' && (first.backdrop || (first.x <= 0 && first.y <= 0 && first.x + first.w >= env.W && first.y + first.h >= env.H));
        if (!first || !(first.op === 'paper' || first.op === 'night' || backdrop)) report('first-op', `first op is ${first ? `'${first.op}'` : 'missing'}; start with paper(), night() or a backdrop image`, 'first');
      }
      const got = scan(list, ev.look, report);
      if (got.looks) { looked = true; report('one-look', 'a look op inside the shot; put the look on the shot or on lookOn()', 'look'); }
      got.finishes.forEach((x) => s.finishes.add(x));
      got.words.forEach((w) => s.words.add(w));
      got.bobs.forEach((b) => { const e = bobs.get(b); if (e) e.n++; else bobs.set(b, { n: 1, i }); });
      if (got.scribbles > MAX_SCRIBBLES) report('scribble', `${got.scribbles} scribbled parts in one frame (at most ${MAX_SCRIBBLES})`, 'scribble');
      if (!got.anchors.length) { s.anchor = false; report('anchor', "no meta('anchor', ...) in the shot", 'anchor'); return; }
      // Several anchors are alternatives (a seed dot, and the ripples it makes): one of them must be drawn.
      const drawn = got.anchors.map((d) => [d, anchorBoxes(list, d)]).filter(([, boxes]) => boxes);
      if (drawn.length && drawn.every(([, boxes]) => !boxes.length)) report('anchor', `anchor names ${drawn.map(([d]) => anchorLabel(d)).join(' / ')} but the shot does not draw it`, 'anchor');
      for (const [d, boxes] of drawn) {
        for (const b of boxes) {
          const px = Math.max(b[2], b[3]) * 240 / env.W;
          if (!size || px > size.px) size = { px, i, label: anchorLabel(d) };
          const out = b[0] < -TOL || b[1] < -TOL || b[0] + b[2] > env.W + TOL || b[1] + b[3] > env.H + TOL;
          if (out && !got.crop) report('subject-crop', `${anchorLabel(d)} at ${fmtBox(b)} crosses the ${env.W}x${env.H} frame edge`, 'crop');
        }
      }
    });
    for (const [b, e] of bobs) {
      const [who, cyc] = b.split('|');
      if (e.n > MAX_BOB * FPS) F.add('actor-cycle', name, e.i, `actor '${who}' has no cycle '${cyc}'; its fallback bob is on screen ${(e.n / FPS).toFixed(2)} s (at most ${MAX_BOB} s): give it the cycle, or ask for one it has`, b);
    }
    if (s.finishes.size > 1 && !looked) F.add('one-look', name, p.f0, `two finishes in one shot: ${[...s.finishes].join(', ')}`, 'finish');
    if (size && size.px < FLOOR_PX) F.add('subject-size', name, size.i, `${size.label} is at most ${size.px.toFixed(1)} px at 240 px wide (floor ${FLOOR_PX})`, 'size');
    const words = [...s.words].reduce((a, w) => a + countWords(w), 0), allow = s.lookObj ? wordAllowance(s.lookObj) : 0;
    delete s.lookObj;
    if (words > allow) F.add('words', name, p.f0, `${words} words (${[...s.words].map((w) => `"${w}"`).join(', ')}); look ${s.look} allows ${allow} outside the sign-off`, 'words');
    shots.push(s);
  }
  timelineRules(film, F);
  handRule(film, F);
  signOffRule(film, F);
  gridRule(film, F);
  const findings = F.list.sort((a, b) => (a.frame ?? -1) - (b.frame ?? -1));
  return { findings, shots };
}

// The shot a node shows first or last (through seq, look and hold); a cut's own end shots count as its ends.
const endShot = (node, last) => {
  switch (node.kind) {
    case 'seq': return endShot(node.kids[last ? node.kids.length - 1 : 0], last);
    case 'look': case 'hold': return endShot(node.child, last);
    case 'cut': return endShot(last ? node.b : node.a, last);
    default: return node;
  }
};

// cut-long, cut-adjacent and cut-orphan, from the tree.
function timelineRules(film, F) {
  const played = new Set(), cuts = [];
  const visit = (node, f0) => {
    if (node.kind !== 'cut') played.add(node);
    switch (node.kind) {
      case 'cut':
        cuts.push([node, f0]);
        if (node.dur > MAX_CUT) F.add('cut-long', node.name, f0, `cut ${node.fx} lasts ${node.dur.toFixed(2)} s (at most ${MAX_CUT})`, 'long');
        break;
      case 'seq': {
        let at = f0;
        node.kids.forEach((c, j) => {
          if (j && c.kind === 'cut' && node.kids[j - 1].kind === 'cut') F.add('cut-adjacent', c.name, at, `follows ${node.kids[j - 1].name} with no shot between`, 'adjacent');
          visit(c, at);
          at += c.n;
        });
        break;
      }
      case 'par': node.kids.forEach((c) => visit(c, f0)); break;
      case 'hold': visit(node.child, f0); break;
      case 'look': visit(node.child, f0); break;
      default: break;
    }
  };
  visit(film.timeline, 0);
  // A cut shows a's last frame under b's first; neither plays unless the timeline has it too.
  for (const [c, f0] of cuts) {
    const gone = [['outgoing', endShot(c.a, true)], ['incoming', endShot(c.b, false)]].filter(([, s]) => !played.has(s));
    if (gone.length) {
      F.add('cut-orphan', c.name, f0, `the ${gone.map(([w, s]) => `${w} shot '${s.name ?? s.kind}'`).join(' and the ')} never ${gone.length > 1 ? 'play' : 'plays'} outside the cut; write seq(a, cut(...), b)`, 'orphan');
    }
  }
}

function signOffIn(list) {
  let found = null;
  const visit = (ops) => { for (const op of ops) { if (found) return; if (op.op === 'meta' && op.tag === 'signOff') found = op.data; else if (op.kids) visit(op.kids); } };
  visit(norm(list));
  return found;
}

// hand-missing, first half: every look the film names (its own, lookOn, a shot's) whose '~hand:<id>' is in
// neither the film's assets nor a store that was read.
function handRule(film, F) {
  const names = new Set([film.look?.name]);
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.look?.name) names.add(node.look.name);
    for (const c of [node.child, node.a, node.b, ...(node.kids ?? [])]) visit(c);
  };
  visit(film.timeline);
  const assets = Array.isArray(film.assets) ? {} : film.assets;
  for (const name of names) {
    for (const [kind, id] of parseLookName(name ?? '').mods) {
      if (kind !== 'hand') continue;
      try { handRecord(id, assets, name); } catch (e) { F.add('hand-missing', null, 0, e.message, `look|${id}`); }
    }
  }
}

// The sign-off must be in the last frame and complete (pA = pB = 1) by end - 1.5 s; in a look with a hand,
// every letter of it must be that hand's own (hand-missing, second half).
function signOffRule(film, F) {
  let last;
  try { last = frame(film, film.n - 1); } catch { return; }   // a draw error is already a finding
  const sign = signOffIn(last.list);
  if (!sign) { F.add('sign-off', last.shot, film.n - 1, 'no signOff() in the last frame', 'none'); return; }
  const hand = handOf(last.look), missing = hand ? fallbacks(`${sign.a ?? ''}${sign.b ?? ''}`, hand) : [];
  if (missing.length) F.add('hand-missing', last.shot, film.n - 1, `the sign-off letters ${missing.map((c) => `'${c}'`).join(', ')} in the house hand: hand '${hand.name}' has no glyph for ${missing.length > 1 ? 'them' : 'it'}`, 'fallback');
  const i = Math.max(0, film.n - Math.round(SIGN_OFF_LEAD * FPS)), at = frame(film, i), s = signOffIn(at.list);
  const done = s && (s.pA ?? 1) >= 1 && (s.pB ?? 1) >= 1;
  if (!done) F.add('sign-off', at.shot, i, `not complete at ${(i / FPS).toFixed(2)} s (end ${(film.n / FPS).toFixed(2)} s - ${SIGN_OFF_LEAD} s): ${s ? `pA ${(+s.pA).toFixed(2)}, pB ${(+s.pB).toFixed(2)}` : 'not drawn yet'}`, 'late');
}

function gridRule(film, F) {
  const off = (t) => Math.abs(t * FPS - Math.round(t * FPS)) >= 1e-9;
  const c = cues(film);
  for (const s of c.shots) if (off(s.t0) || off(s.dur)) F.add('grid', s.name, Math.round(s.t0 * FPS), `cue ${s.t0} s / ${s.dur} s is off the 1/${FPS} s grid`, 'grid');
  for (const t of c.cuts) if (off(t)) F.add('grid', null, Math.round(t * FPS), `cut at ${t} s is off the 1/${FPS} s grid`, `cut${t}`);
}

// lintList(list, look, name) => findings over a display list that is not a shot (a model sheet): the
// per-frame checks that make sense of any drawing, `role` and `cel-box`.
export function lintList(list, look, name = 'list') {
  const F = finder();
  scan(norm(list), look, (rule, detail, key) => { if (rule === 'role' || rule === 'cel-box') F.add(rule, name, null, detail, key); });
  return F.list;
}

// ---------- puppets ----------

// Every op field that holds a role, so a hex that came in from a drawing program is found wherever it sits.
const RAW = /^#|^rgba?\(/i;
function rawRoles(list) {
  const out = new Set();
  const role = (r) => {
    if (typeof r === 'string') { if (RAW.test(r)) out.add(r); return; }
    if (r && typeof r === 'object') { role(r.base); if (Array.isArray(r.mix)) role(r.mix[0]); }
  };
  const visit = (ops) => { for (const op of ops ?? []) { role(op.role); role(op.ink2); if (Array.isArray(op.kids)) visit(op.kids); } };
  visit(Array.isArray(list) ? list : []);
  return [...out];
}

// lintPuppet(payload) => findings over a puppet before it is written to the store (`hdf import --kind puppet`
// runs it): `puppet-joint` over every pose and cycle frame, `roles-raw` over every part's ops and variants,
// and `cel-box` over the drawing of the rest pose, every view both ways round, every named pose, every
// variant and every cycle frame -- the box in the payload is what `cel()` hands lint and the sheet, so it
// has to hold all of them.
export function lintPuppet(data, name = data?.name ?? 'puppet') {
  const F = finder();
  const add = (rule, detail, key = detail) => F.add(rule, name, null, detail, key);
  const parts = data?.parts && typeof data.parts === 'object' ? data.parts : {};
  const declared = data?.inputs && typeof data.inputs === 'object' ? data.inputs : {};
  const joints = new Set(Object.keys(parts).filter((n) => !parts[n]?.variants));

  const joint = (where, key, v) => {
    if (!parts[key] && declared[key] === undefined) { add('puppet-joint', `${where} names '${key}', which is not a part or a declared input`, `${where}|${key}`); return; }
    if (!joints.has(key) || typeof v !== 'number') return;   // a variant pick reads as its key, not an angle
    if (!Number.isFinite(v) || v < JOINT[0] || v > JOINT[1]) add('puppet-joint', `${where} sets '${key}' to ${v} degrees, outside ${JOINT[0]}..${JOINT[1]}`, `${where}|${key}`);
    else if (Math.abs(v % JOINT[2]) > 1e-9) add('puppet-joint', `${where} sets '${key}' to ${v} degrees, off the ${JOINT[2]} degree grid`, `${where}|${key}`);
  };
  for (const [pn, pose] of Object.entries(data?.poses ?? {})) for (const [k, v] of Object.entries(pose ?? {})) joint(`pose '${pn}'`, k, v);
  for (const [cn, c] of Object.entries(data?.cycles ?? {})) {
    const frames = Array.isArray(c?.frames) ? c.frames : [];
    if (c?.n !== undefined && c.n !== frames.length) add('puppet-joint', `cycle '${cn}' says n ${c.n} and carries ${frames.length} frames`, `cycle|${cn}`);
    frames.forEach((fr, j) => {
      for (const [k, v] of Object.entries(fr ?? {})) {
        if (k !== 'lift') joint(`cycle '${cn}' frame ${j}`, k, v);
        else if (!Number.isFinite(v)) add('puppet-joint', `cycle '${cn}' frame ${j} lifts by ${JSON.stringify(v)}; a lift is a number of puppet units`, `cycle|${cn}|${j}|lift`);
      }
    });
  }
  // An op list, or op lists keyed by view: [label, list] for each.
  const lists = (label, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([view, l]) => [`${label} in view ${view}`, l]) : [[label, v]]);
  for (const [pn, p] of Object.entries(parts)) {
    for (const [label, list] of [...lists('ops', p?.ops), ...Object.entries(p?.variants ?? {}).flatMap(([k, v]) => lists(`variant '${k}'`, v))]) {
      for (const r of rawRoles(list)) add('roles-raw', `part '${pn}' ${label} paints ${r}; name a palette role (ink, fills.0, light, ...)`, `${pn}|${r}`);
    }
  }

  // A pack mirror keeps its ops in a pool.
  for (const r of rawRoles(data?.mirror?.pool)) add('roles-raw', `the mirror's pool paints ${r}; name a palette role (ink, fills.0, light, ...)`, `pool|${r}`);

  let make;
  try { make = puppet({ ...data, name }); } catch (e) { add('draw', `the puppet does not build: ${e.message}`, 'build'); return F.list; }
  try {
    for (const [label, inputs] of puppetCases(make, data)) {
      const g = make(inputs), b = celOverflow(g);
      if (b) add('cel-box', `${label} draws ${fmtBox(b)} outside the declared box ${fmtBox(g.box)}`, 'box');
    }
  } catch (e) { add('draw', `the puppet does not draw: ${e.message}`, 'draw'); }
  return F.list;
}

// Every drawing a puppet's box has to hold, as [label, inputs]: the rest pose, every view both ways round
// (the turnaround), every named pose, every variant (a pack mirror: every input set) and every cycle frame.
export function puppetCases(make, data) {
  const parts = data?.parts && typeof data.parts === 'object' ? data.parts : {};
  const cases = [['rest', make.rest]];
  for (const v of make.views ?? []) for (const dir of [1, -1]) cases.push([`view ${v}${dir < 0 ? ' mirrored' : ''}`, { ...make.rest, dir: dir * (VIEW_DIRS[v] ?? 1) }]);
  for (const pn of make.poses) cases.push([`pose '${pn}'`, make.poseOf(pn, 1)]);
  if (make.mirror) for (const [k, q] of Object.entries(make.states())) cases.push([k || 'no inputs', q]);
  else for (const [pn, p] of Object.entries(parts)) for (const k of Object.keys(p?.variants ?? {})) cases.push([`${pn} = ${k}`, { ...make.rest, [pn]: k }]);
  for (const [cn, c] of Object.entries(data?.cycles ?? {})) (c?.frames ?? []).forEach((_, j) => cases.push([`cycle '${cn}' frame ${j}`, make.frameOf(cn, j / (c.fps ?? FPS))]));
  return cases;
}

// puppetReach(payload) => { box, by } : the union of what every case in puppetCases draws, and the label of
// each case that reaches past the declared box (so `hdf svg` can widen the box once, at import, instead of
// the author guessing a wider viewBox). null when the puppet does not build or draws nothing.
export function puppetReach(data, name = data?.name ?? 'puppet') {
  let make;
  try { make = puppet({ ...data, name }); } catch { return null; }
  let box = null;
  const by = [];
  for (const [label, inputs] of puppetCases(make, data)) {
    const g = make(inputs), b = bounds(g.kids);
    if (!b) continue;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[0] + box[2], b[0] + b[2]) - Math.min(box[0], b[0]),
      Math.max(box[1] + box[3], b[1] + b[3]) - Math.min(box[1], b[1])] : b;
    if (celOverflow(g)) by.push(label);
  }
  return box && { box, by };
}

// Findings on a pack (3.0 S13): each cel's mirror in the store against what the cel draws now. cels: the
// pack's manifest entries ({ name, store: { id, sha } }); fresh(name): the sha the mirror would have if it
// were exported now; stored(id): the catalogue entry's sha, or undefined. Node does the reading (cli/lint.mjs).
export function lintPack(cels, { fresh, stored }, name = 'pack') {
  const F = finder();
  const add = (cel, detail) => F.add('pack-mirror', name, null, `${cel}: ${detail}; hdf donate --manifest`, cel);
  for (const c of cels) {
    if (!c.store) { add(c.name, 'no store mirror in the manifest'); continue; }
    const now = fresh(c.name), have = stored(c.store.id);
    if (have === undefined) add(c.name, `the store has no '${c.store.id}'`);
    else if (have !== c.store.sha) add(c.name, `the store holds ${have.slice(0, 8)} for '${c.store.id}', the manifest says ${c.store.sha.slice(0, 8)}`);
    else if (now !== c.store.sha) add(c.name, `the cel draws ${now.slice(0, 8)} now, its mirror is ${c.store.sha.slice(0, 8)} (stale)`);
  }
  return F.list;
}

// Comments blanked (newlines kept, so line numbers hold), then banned calls matched line by line.
const BANNED = [
  [/\bMath\.random\b/, 'Math.random: use rng(seed) so frames are pure'],
  [/\bDate\b/, 'Date: frames depend on t and k only'],
  [/\.filter\s*=(?!=)/, 'ctx.filter: not in the house style, and not in skia'],
  [/\bshadowBlur\b/, 'shadowBlur: soft shadows are not drawn'],
  [/\bcreate(?:Linear|Radial)Gradient\b/, 'a gradient: use cov descriptors or a finish'],
];
function blankComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}
export function lintSource(src) {
  const out = [];
  blankComments(src).split('\n').forEach((text, j) => {
    for (const [re, why] of BANNED) if (re.test(text)) out.push({ rule: 'source', shot: null, frame: null, line: j + 1, detail: why });
  });
  return out;
}

// Warnings about the film's assets: every one it carries inline as a data URL. The store holds a payload
// once, addressed by content (`hdf import --v2 <module>` moves a 2.0 photos.js or clips.js into it), and the
// film names ids instead -- which is also what lets `hdf find` and a shared licence reach them. A film built
// in memory (a test, a sketch) is welcome to carry its pixels, so this warns and never fails.
export function warnAssets(film) {
  const all = film?.assets;
  if (!all || Array.isArray(all)) return [];
  return Object.entries(all)
    .filter(([, a]) => typeof a?.src === 'string' && a.src.startsWith('data:'))
    .map(([id, a]) => ({ rule: 'inline-asset', warn: true, shot: null, frame: null, detail: `'${id}': ${Math.round(a.src.length / 1024)} KB of data URL; hdf import --v2 it and name the id in assets` }));
}

// lint(film, { source }) => findings [{ rule, shot, frame, line?, detail }], source rules first.
export function lint(film, { source } = {}) {
  return [...(source ? lintSource(source) : []), ...inspect(film).findings];
}

// `file:shot:frame  rule  detail` (source findings put the line in the frame slot as L<n>; a warning says so).
export function formatFinding(f, file = '') {
  const where = `${file}:${f.shot ?? '-'}:${f.line ? `L${f.line}` : f.frame ?? '-'}`;
  return `${where}  ${f.warn ? 'warn ' : ''}${f.rule}  ${f.detail}`;
}

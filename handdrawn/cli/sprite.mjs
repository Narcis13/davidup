// hdf sprite <puppet> [--states idle,walk,happy]: a cast member as a sprite sheet for davidup's sprite item
// (4.0 D2). One PNG, the states' frames in a grid of equal cells read left to right and top to bottom, and a
// JSON beside it naming each state's run of frames; `scripts/hdf-to-davidup.ts --sprites` registers the pair
// as an image asset with a `sheet`, and a davidup sprite plays a state by name (`cycle`).
//
// The puppet is a store id (a puppet, or a pack cel's mirror: pack:boat), `stick:<name>[:<build>]` (a stick
// puppet built from its source the way the films build sam: stick:sam), a puppet payload .json, or, with
// --film, a member of that film's cast: the store puppets it reads and the entries of the module's `cast`
// export (name -> actor or puppet). A state is
//   idle                     the actor breathing and blinking, --idle seconds of it (2), looping, over the
//                            vocabulary's idle pose when it has one
//   a cycle                  its own or the vocabulary's (walk, run, jump, breathe, talk-hands ...), one loop
//                            sampled at --fps, looping; a cycle that travels stands on its planted foot and
//                            carries `speed`, px a second at the frame's size, so a tween can move it without
//                            the feet sliding
//   a pose or an expression  one frame, held (point, shrug, cheer; happy, sad, confused ...)
// Every frame faces --dir (1 right, -1 left) and shares one cell: the union of every frame's ink, so the
// figure stands in the same place in every cell and a state can change without the sprite jumping. `anchor`
// is where the feet are in the cell (fractions), for davidup's anchorX / anchorY.
//
// A frame is seeded by its place in its state, so a looping state's boil loops with it. --alpha draws on no
// stock (the look's `~alpha`), which is what an overlay wants; without it every cell has the look's paper.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { actorOf } from '../core/actor.js';
import { FPS } from '../core/curves.js';
import { stand, strideOf } from '../core/ik.js';
import { bounds, group, paper, translate } from '../core/list.js';
import { LOOKS, modifyLook, resolveLook } from '../core/looks.js';
import { puppet } from '../core/puppet.js';
import { stickSource } from '../core/stick.js';
import { outDir, paint } from './sheets.mjs';
import { skiaCanvas } from './skia.mjs';
import { assetsOf, imagesOf, UsageError } from './load.mjs';

const STAGE = [540, 600, 120];        // where a frame is drawn on the logical stage: x, y, size
const PAD = 0.04;                     // of the cell's height, round the union of the ink
const MAX_SIDE = 16384;               // a PNG side davidup's canvases can take

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// An actor from a sprite's name: stick:<name>[:<build>], a payload file, a film's cast member, a store puppet.
export async function spriteActor(ref, { film, path, root } = {}) {
  if (!ref) throw new UsageError('sprite: say which puppet, e.g. hdf sprite fox or hdf sprite stick:sam');
  if (ref.startsWith('stick:')) {
    const [, name, build = 'adult'] = ref.split(':');
    if (!name) throw new UsageError(`sprite: '${ref}' names no stick puppet (stick:<name>[:<build>])`);
    try { return { id: name, actor: actorOf(puppet(stickSource({ name, build }))) }; } catch (e) { throw new UsageError(`sprite: ${e.message}`); }
  }
  if (ref.endsWith('.json')) {
    const d = JSON.parse(readFileSync(resolve(ref), 'utf8'));
    const id = d.name ?? basename(ref).replace(/(\.puppet)?\.json$/, '');
    return { id, actor: actorOf(puppet({ ...d, name: id })) };
  }
  if (film) {
    const cast = await castOf(film, path);
    if (cast[ref]) return { id: ref, actor: cast[ref] };
    const st = readCatalogue(root ?? ASSET_ROOT);
    if (!(st.has(ref) && st.entry(ref).kind === 'puppet')) {
      throw new UsageError(`sprite: '${ref}' is not in ${film.name}'s cast (has ${Object.keys(cast).join(', ') || 'none'})`);
    }
  }
  const st = readCatalogue(root ?? ASSET_ROOT);
  if (!st.has(ref)) throw new UsageError(`sprite: no puppet '${ref}' in the store (hdf find ${ref}; stick:<name> builds a stick puppet)`);
  const e = st.entry(ref);
  if (e.kind !== 'puppet') throw new UsageError(`sprite: '${ref}' is a ${e.kind}, not a puppet`);
  return { id: ref, actor: actorOf(puppet({ ...st.json(e), name: ref })) };
}

// A film's cast: the store puppets it read, then the module's `cast` export (actors, or puppets made actors),
// which wins on a name. The loader has already read the store puppets the film names.
export async function castOf(film, path) {
  const out = {};
  const st = readCatalogue();
  for (const id of Object.keys(assetsOf(film))) if (st.has(id) && st.entry(id).kind === 'puppet') out[id] = actorOf(puppet(id));
  const mod = path ? await import(pathToFileURL(resolve(path)).href) : {};
  for (const [name, who] of Object.entries(mod.cast ?? {})) {
    if (typeof who !== 'function') continue;
    out[name] = who.place && who.cycle ? who : who.puppet ? actorOf(who) : null;
    if (!out[name]) delete out[name];
  }
  return out;
}

// [{ name, loop, states: [state...], speed? }]: what each state name draws, frame by frame, at fps.
export function spriteStates(actor, names, { fps = FPS, dir = 1, idle = 2 } = {}) {
  const voc = actor.vocabulary, face = actor.look(dir);
  return names.map((name) => {
    if (name === 'idle') {
      // Breathing and blinking over the vocabulary's idle pose when the actor has it (a stick stands easy).
      const n = Math.max(1, Math.round(idle * fps)), base = voc.poses.includes('idle') ? actor.pose('idle', 1) : {};
      return { name, loop: true, states: Array.from({ length: n }, (_, j) => ({ ...face, ...base, ...actor.idle(j / fps) })) };
    }
    const c = actor.cycleOf(name);
    if (c) {
      // One loop of the cycle at the sheet's rate: a 6 fps jump is its frames each drawn twice at 12.
      const period = c.n / c.fps, n = Math.max(1, Math.round(period * fps));
      let g = null;
      try { g = actor.puppet?.worldOf ? strideOf(actor, name) : null; } catch { g = null; }
      const states = Array.from({ length: n }, (_, j) => {
        const q = { ...face, ...actor.cycle(name, j / fps + 1e-9) };
        return g ? stand(actor, q) : q;
      });
      return { name, loop: true, states, ...(g ? { stride: g.stride, period } : {}) };
    }
    if (voc.poses.includes(name)) return { name, loop: false, states: [{ ...face, ...actor.pose(name, 1) }] };
    if (voc.expressions.includes(name)) return { name, loop: false, states: [{ ...face, ...actor.emote(name) }] };
    throw new UsageError(`sprite: ${actor.name} has no state '${name}' (idle; cycles ${voc.cycles.join(', ') || 'none'}; `
      + `poses ${voc.poses.join(', ') || 'none'}; expressions ${voc.expressions.join(', ') || 'none'})`);
  });
}

// The sheet: { canvas, json }. states from spriteStates; h the cell's height in px.
export function spriteSheet(actor, states, { look, h = 300, fps = FPS, cols, alpha = false, images = null, name = actor.name } = {}) {
  const [X, Y, S] = STAGE;
  const frames = states.flatMap((st) => st.states.map((q, j) => ({ q, j })));
  const placed = frames.map(({ q }) => actor.place(X, Y, S, q));
  // One cell for every frame: the union of their ink, padded.
  let box = null;
  for (const g of placed) {
    const b = bounds([g]);
    if (!b) continue;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[0] + box[2], b[0] + b[2]) - Math.min(box[0], b[0]), Math.max(box[1] + box[3], b[1] + b[3]) - Math.min(box[1], b[1])] : b;
  }
  if (!box) throw new Error(`sprite: ${actor.name} draws nothing`);
  const pad = PAD * box[3];
  const [bx, by, bw, bh] = [box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad];
  const k = h / bh, fw = Math.max(1, Math.round(bw * k)), fh = Math.round(h);
  const n = frames.length, C = Math.max(1, Math.min(n, cols ?? Math.ceil(Math.sqrt(n * fh / fw)))), R = Math.ceil(n / C);
  if (C * fw > MAX_SIDE || R * fh > MAX_SIDE) throw new UsageError(`sprite: a ${C * fw}x${R * fh} sheet is past ${MAX_SIDE} px a side; lower --h or set --cols`);

  const lk = alpha ? modifyLook(look, [['alpha', '']]) : resolveLook(look);
  const sheet = skiaCanvas(C * fw, R * fh), g = sheet.getContext('2d');
  placed.forEach((node, i) => {
    const list = [...(alpha ? [] : [paper()]), group({ name: 'sprite', xf: translate(-bx, -by) }, [node])];
    const cell = paint(list, { look: lk, W: bw, H: bh, width: fw, seed: 1 + frames[i].j, images });
    g.drawImage(cell, (i % C) * fw, Math.floor(i / C) * fh, fw, fh);
  });

  // The stage units of a drawing unit at size S, times px a stage unit: a stride in px at the frame's size.
  const px = actor.stage ? actor.stage.k(S) * k : 0;
  const cycles = {};
  let start = 0;
  for (const st of states) {
    cycles[st.name] = { start, count: st.states.length, ...(st.loop ? {} : { loop: false }), ...(st.stride && px ? { speed: r2(st.stride * px / st.period) } : {}) };
    start += st.states.length;
  }
  const feet = [X, Y + 0.86 * S];
  const json = {
    kind: 'hdf-sprite', name, look: lk.name,
    frameWidth: fw, frameHeight: fh, columns: C, count: n, fps, cycles,
    anchor: { x: r3((feet[0] - bx) / bw), y: r3((feet[1] - by) / bh) },
    frames: frames.map((_, i) => [(i % C) * fw, Math.floor(i / C) * fh, fw, fh]),
  };
  return { canvas: sheet, json };
}

const list = (v, dflt) => (v === undefined || v === true ? dflt : String(v).split(',').map((s) => s.trim()).filter(Boolean));

export async function run([ref], flags, { loadFilm }) {
  const path = flags.film ? String(flags.film) : null;
  const film = path ? await loadFilm(path) : null;
  const { id, actor } = await spriteActor(ref, { film, path, root: flags.root ? resolve(String(flags.root)) : undefined });
  const fps = flags.fps ?? FPS, h = flags.h ?? 300, dir = flags.dir ?? 1;
  if (!(fps > 0 && fps <= 60)) throw new UsageError(`sprite: --fps ${flags.fps}; 1 to 60`);
  if (!(h >= 16 && h <= 4096)) throw new UsageError(`sprite: --h ${flags.h}; 16 to 4096 px`);
  const names = list(flags.states, ['idle', 'walk', 'happy']);
  const states = spriteStates(actor, names, { fps, dir, idle: flags.idle ?? 2 });
  const look = flags.look ? String(flags.look) : film?.look ?? LOOKS.doodlePastel;
  const { canvas, json } = spriteSheet(actor, states, {
    look, h, fps, cols: flags.cols, alpha: !!flags.alpha, images: film ? imagesOf(film) : null, name: id,
  });
  const dir0 = outDir(flags);
  mkdirSync(dir0, { recursive: true });
  const stem = `${id}-sprite${flags.alpha ? '-alpha' : ''}`;
  const png = join(dir0, `${stem}.png`), file = join(dir0, `${stem}.json`);
  json.image = basename(png);
  await canvas.toFile(png);
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  const runs = Object.entries(json.cycles).map(([k, c]) => `${k} ${c.count}${c.speed ? ` @${c.speed}px/s` : ''}`).join(', ');
  process.stdout.write(`${png}  ${json.count} frames of ${json.frameWidth}x${json.frameHeight} in ${json.columns} columns at ${fps} fps: ${runs}\n${file}  the sheet\n`);
  return 0;
}

// hdf sheet <film.js> <cel>: one JPEG for judging a cel before it goes in a shot. Rows are the preset
// looks; columns are the cel at 0.6, 1 and 1.8 scale for each input variant (defaults, then every declared
// input at its min and max), with the declared box as a guide. A last row holds the silhouette (the
// union of its fills in ink) and the cel at scale 1 in a full frame rendered 240 px wide.
// The cel is found among the film module's exports; failing that, the first group drawn with that cel
// name in the film is used as is (no input variants).
//
// hdf sheet store <id> [--pose wave] [--cycle walk]: the same sheet for a puppet in the asset store
// (`store` in place of a film says look in the catalogue). Its columns are the puppet's poses and then
// every variant of every part; a puppet with views (a turnaround) gets a column for every view each way round
// first; `--cycle` adds the cycle's frames as a strip along the bottom. It writes
// assets/sheets/<id>.jpg, which is what `hdf find` points at.
//
// hdf sheet store <id> --poses [--look risoPop]: the model sheet, the brief you hand a client before a frame
// is rendered. One page in one look (default doodlePastel), top to bottom: a title card in hand lettering,
// the turnaround (every view each way round, on construction lines), the expressions (neutral and every
// emote name, the head at 2x), hands and feet at 2x (every limb in every view it is drawn in), every named
// pose, every cycle as a strip, and a credits line. The page is one display list, so it hashes, and lint's
// `role` and `cel-box` run over it before any pixel does. It writes assets/sheets/<id>-model.jpg.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { FPS } from '../core/curves.js';
import { format } from '../core/fit.js';
import { actorOf, EMOTES } from '../core/actor.js';
import { bounds, fill, group, hashList, line, paper, parse, poly, rect, stroke, walk, xf } from '../core/list.js';
import { formatFinding, lintList } from '../core/lint.js';
import { LOOKS, modifyLook, resolveLook } from '../core/looks.js';
import { VIEW_DIRS, puppet } from '../core/puppet.js';
import { hash32 } from '../core/rand.js';
import { handText, measure } from '../core/text.js';
import { asHand, glyph, GLYPHS, houseHand } from '../core/glyphs.js';
import { SHAPES, SYMBOLS, UNIT } from '../core/handsheet.js';
import { cel, frame, place } from '../core/tree.js';
import { outDir, paint, tileSheet } from './sheets.mjs';
import { imagesOf, UsageError } from './load.mjs';
import { skiaCanvas } from './skia.mjs';

const SCALES = [0.6, 1, 1.8];

async function findCel(path, film, name) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  const make = Object.values(mod).find((v) => typeof v === 'function' && v.cel?.name === name);
  if (make) return { make, meta: make.cel };
  for (let i = 0; i < film.n; i++) {
    let hit = null;
    walk(frame(film, i).list, (op) => { if (!hit && op.op === 'group' && op.cel === name) hit = op; });
    if (hit) return { make: () => hit, meta: { name, box: hit.box, inputs: {} } };
  }
  const known = Object.values(mod).filter((v) => typeof v === 'function' && v.cel).map((v) => v.cel.name);
  throw new Error(`sheet: no cel '${name}' in ${path}${known.length ? ` (exported: ${known.join(', ')})` : '; export it from the film module'}`);
}

// [label, inputs]: defaults, then each input at its min and at its max; variants that draw the same are dropped.
function variants(make, inputs) {
  const out = [['defaults', {}]];
  for (const [k, spec] of Object.entries(inputs ?? {})) {
    if (!Array.isArray(spec)) continue;
    out.push([`${k}=${spec[0]}`, { [k]: spec[0] }], [`${k}=${spec[1]}`, { [k]: spec[1] }]);
  }
  const seen = new Set();
  return out.filter(([, v]) => { const h = hashList(make(v).kids); if (seen.has(h)) return false; seen.add(h); return true; });
}

// Union of the cel's fills, through nested group transforms, as one ink fill.
function silhouette(g) {
  const sub = [];
  walk(g.kids, (op, m) => { if (op.op === 'fill') sub.push(...xf(op.path, m).sub); });
  return sub.length ? [fill({ sub, box: g.box ?? [0, 0, 0, 0] }, 'ink')] : [];
}

export async function run([path, name], flags, { loadFilm }) {
  if (flags.hand !== undefined && !path) return handSheetFile(flags.hand === true ? '' : String(flags.hand), flags);
  if (path === 'store') return storeSheet(name, flags);
  if (!name) throw new Error('sheet: say which cel, e.g. hdf sheet films/mini.js ball');
  const film = await loadFilm(path);
  const { make, meta } = await findCel(path, film, name);
  const file = join(outDir(flags), `${film.name}-sheet-${name}.jpg`);
  const { looks, variants: nv } = await celSheet(make, meta, { look: film.look, format: film.format, images: imagesOf(film), file });
  process.stdout.write(`${file}  ${looks} looks x ${nv} variant${nv > 1 ? 's' : ''} x ${SCALES.length} scales\n`);
  return 0;
}

// A puppet in the store: its poses and variants as the columns, the cycle `--cycle` names as a strip.
export async function storeSheet(id, flags) {
  if (!id) throw new UsageError('sheet: say which asset, e.g. hdf sheet store fox');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const e = st.entry(id);
  if (e.kind === 'hand') return handSheetFile(id, flags);
  if (e.kind === 'motif') return motifSheet(id, e, st, flags);
  if (e.kind !== 'puppet') throw new UsageError(`sheet: '${id}' is a ${e.kind}; hdf sheet store draws a puppet, a motif or a hand (hdf sheet <film.js> <cel> for a cel)`);
  const d = st.json(e), make = puppet({ ...d, name: id });
  if (d.mirror) return mirrorSheet(id, make, st, flags);
  if (flags.poses) return modelSheetFile(make, e, st, flags);

  const poses = flags.pose ? [String(flags.pose)] : make.poses;
  // The turnaround: side, three-quarter, front, three-quarter mirrored, side mirrored.
  const dirs = [...new Set((make.views ?? []).map((v) => VIEW_DIRS[v] ?? 1))].sort((a, b) => b - a);
  const turn = [...dirs, ...dirs.filter((v) => v > 0).reverse().map((v) => -v)].map((dir) => [`view ${make.viewOf(dir)}${dir < 0 ? ' <' : ''}`, { ...make.rest, dir }]);
  const cases = [...turn, ...poses.map((p) => [`pose ${p}`, make.poseOf(p, 1)])];
  if (!cases.length) cases.push(['rest', make.rest]);
  for (const [pn, part] of Object.entries(d.parts)) for (const k of Object.keys(part.variants ?? {})) cases.push([`${pn}=${k}`, { ...make.rest, [pn]: k }]);

  const cyc = flags.cycle === true ? make.cycles[0] : flags.cycle ? String(flags.cycle) : null;
  const c = cyc ? d.cycles?.[cyc] : null;
  if (cyc && !c) throw new UsageError(`sheet: '${id}' has no cycle '${cyc}' (has ${make.cycles.join(', ') || 'none'})`);
  const strip = c ? c.frames.map((_, j) => [`${cyc} ${j}`, make.frameOf(cyc, j / (c.fps ?? FPS)), make.liftOf(cyc, j / (c.fps ?? FPS))]) : [];

  const file = st.sheetPath(id);
  mkdirSync(dirname(file), { recursive: true });
  const { looks } = await celSheet(make, make.cel, {
    look: flags.look ? resolveLook(String(flags.look)) : LOOKS.doodlePastel, format: format('1:1'), file, cell: 160, cases, strip,
  });
  process.stdout.write(`${file}  ${looks} looks x ${cases.length} state${cases.length > 1 ? 's' : ''} x ${SCALES.length} scales`
    + `${strip.length ? ` + ${strip.length} frames of ${cyc}` : ''}\n`);
  return 0;
}

// A motif: its one op list as a cel over the entry's box, at three scales in every look.
async function motifSheet(id, e, st, flags) {
  if (flags.poses || flags.pose || flags.cycle) throw new UsageError(`sheet: '${id}' is a motif; it has no poses or cycles`);
  const ops = parse(JSON.stringify(st.json(e))), make = cel(id, () => ops, { box: e.box });
  const file = st.sheetPath(id);
  mkdirSync(dirname(file), { recursive: true });
  const { looks } = await celSheet(make, make.cel, { look: flags.look ? resolveLook(String(flags.look)) : LOOKS.paperInk, format: format('1:1'), file, cell: 160 });
  process.stdout.write(`${file}  ${looks} looks x ${SCALES.length} scales\n`);
  return 0;
}

// A pack cel's mirror (3.0 S13): the sheet of the cel it mirrors, drawn from the store.
async function mirrorSheet(id, make, st, flags) {
  if (flags.poses || flags.pose || flags.cycle) throw new UsageError(`sheet: '${id}' mirrors a pack cel; it has inputs, not poses or cycles`);
  const file = st.sheetPath(id);
  mkdirSync(dirname(file), { recursive: true });
  const { looks, variants: nv } = await celSheet(make, make.cel, { look: flags.look ? resolveLook(String(flags.look)) : LOOKS.paperInk, format: format('1:1'), file, cell: 120 });
  process.stdout.write(`${file}  ${looks} looks x ${nv} variant${nv > 1 ? 's' : ''} x ${SCALES.length} scales\n`);
  return 0;
}

// The sheet of one cel (make: the cel function, meta: make.cel) written to `file` as a JPEG. look and
// format are the film's (the silhouette and the 240 px cell use them); cell is the tile size in pixels.
// cases replaces the input extremes with states of your own ([label, inputs]), and strip adds a row of
// them at scale 1 in `look` -- the two together are what a puppet's poses, variants and cycle come in as.
export async function celSheet(make, meta, { look: filmLook, format: fmt, images = new Map(), file, cell: CELL = 200, quality = 0.9, cases, strip = [] }) {
  const { name } = meta;
  const base = make({});
  const box = meta.box ?? base.box;
  if (!box) throw new Error(`sheet: cel '${name}' has no box`);
  const [bx, by, bw, bh] = box, C = Math.max(bw, bh) * SCALES.at(-1) * 1.15, seed = hash32('sheet', name);
  // The cel centred in a C x C cell at scale s, over its declared box drawn as a guide.
  const cell = (g, s) => [
    paper(),
    place(C / 2 - (bx + bw / 2) * s, C / 2 - (by + bh / 2) * s, s === 1 ? {} : { scale: s }, group('frame', [stroke(rect(bx, by, bw, bh), 'guide', { w: 1 / s, wobble: 0 }), g])),
  ];
  const vs = cases ?? variants(make, meta.inputs), tiles = [];
  for (const look of Object.values(LOOKS)) {
    for (const [label, inputs] of vs) for (const s of SCALES) {
      tiles.push({ canvas: paint(cell(make(inputs), s), { look, W: C, H: C, width: CELL, seed, images }), label: `${look.name} ${s}x ${label}` });
    }
  }
  const cols = vs.length * SCALES.length;
  tiles.push({ canvas: paint([paper(), place(C / 2 - bx - bw / 2, C / 2 - by - bh / 2, group('sil', silhouette(base)))], { look: filmLook, W: C, H: C, width: CELL, seed, images }), label: 'silhouette' });
  const fw = fmt.W, fh = fmt.H;
  tiles.push({ canvas: paint([paper(), place(fw / 2 - bx - bw / 2, fh / 2 - by - bh / 2, base)], { look: filmLook, W: fw, H: fh, width: 240, seed, images }), label: '240 px' });
  if (strip.length) {
    while (tiles.length % cols) tiles.push({ canvas: skiaCanvas(1, 1) });   // the strip starts on a row of its own
    // A strip entry may carry a lift (a retargeted cycle, 3.0 S14): the figure rides that high over its box.
    for (const [label, inputs, up = 0] of strip) {
      const g = make(inputs);
      tiles.push({ canvas: paint(cell(up ? place(0, -up, g) : g, SCALES.at(-1)), { look: filmLook, W: C, H: C, width: CELL, seed, images }), label: up ? `${label} +${up}` : label });
    }
  }
  await tileSheet(tiles, { cols, label: 18 }).toFile(file, { quality });
  return { looks: Object.keys(LOOKS).length, variants: vs.length };
}

// ---------- the model sheet ----------

const PAGE = 1760, MARGIN = 64, GAP = 24, FIG = [180, 230], LABEL = 36;   // logical units; FIG: a figure's most
const EXTREMITY = /^(arm|hand|paw|leg|foot|feet)\b/;                        // width and height on the sheet

// Words the hand lettering can draw: accents dropped, anything it has no glyph for a space.
const lettered = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^0-9A-Za-z.,:'\-!?& ]+/g, ' ').replace(/\s+/g, ' ').trim();

// The part named n lifted out of a drawing with its parent's matrix: { g, own } (own: its drawing alone,
// so the same limb drawn again in another view dedups), or null.
function partOf(list, n) {
  let hit = null;
  walk(list, (op, m) => {
    if (hit) return false;
    if (op.op === 'group' && op.name === n) { hit = { g: group({ name: `part:${n}`, xf: m }, [op]), own: op.kids }; return false; }
  });
  return hit;
}

// modelSheet(make, { entry, look }) => { list, W, H, rows }: the model sheet of a puppet as one display
// list on a PAGE-wide page, and the names of its rows. make is a puppet (puppet(id)), entry its catalogue
// record (credits), look the look it is drawn in (its name goes in the credits).
export function modelSheet(make, { entry = {}, look = LOOKS.doodlePastel } = {}) {
  const id = entry.name ?? make.cel.name, A = actorOf(make), [bx, by, bw, bh] = make.cel.box;
  const S = Math.min(FIG[0] / bw, FIG[1] / bh);   // every figure on the sheet at the one scale
  const views = make.views ?? [];

  // A cell: { key, label, w, h, at(x, y) => op drawn in the box [x, y, w, h] }.
  // up: a retargeted cycle frame's lift (3.0 S14), in the puppet's units; the figure rides that high in its cell.
  const figure = (label, inputs, up = 0) => {
    const g = make(inputs);
    return { key: hashList([g]) + (up ? `^${up}` : ''), label, w: bw * S, h: bh * S, at: (x, y) => place(x - bx * S, y - (by + up) * S, { scale: S }, g) };
  };
  const lifted = (label, { g, own }, k, key = hashList([g])) => {
    const [x0, y0, w, h] = bounds([g]);
    return { key, own, label, w: w * k, h: h * k, at: (x, y) => place(x - x0 * k, y - y0 * k, { scale: k }, g) };
  };
  const once = (cells) => { const seen = new Set(); return cells.filter((c) => !seen.has(c.key) && seen.add(c.key)); };
  const rows = [];
  // guides: construction lines across the row, at these heights in the puppet's units (figure rows only).
  const row = (name, heading, cells, guides = []) => { if (cells.length) rows.push({ name, heading, cells, guides }); };
  const ground = make.ground[1], lines = [ground];

  // The turnaround: side, three-quarter, front, three-quarter mirrored, side mirrored, on lines at the top of
  // the box, the neck and the ground.
  if (views.length) {
    const dirs = [...new Set(views.map((v) => VIEW_DIRS[v] ?? 1))].sort((a, b) => b - a);
    const turn = [...dirs, ...dirs.filter((v) => v > 0).reverse().map((v) => -v)];
    const neck = make.parts.includes('head') ? [make.pivotAt('head', views[0])[1]] : [];
    row('turnaround', 'turnaround', once(turn.map((dir) => figure(`${make.viewOf(dir)}${dir < 0 ? ', mirrored' : ''}`, { ...make.rest, dir }))), [by, ...neck, ground]);
  } else row('turnaround', 'rest', [figure('rest', make.rest)], lines);

  // Expressions: neutral and every emote, turned three-quarter when the puppet has that view; the head
  // alone at 2x when it has a head.
  const face = views.includes('three-quarter') ? { ...make.rest, ...A.look(0.5) } : make.rest;
  const heads = make.parts.includes('head');
  const faces = once([['neutral', face], ...Object.keys(EMOTES).map((e) => [e, { ...face, ...A.emote(e) }])]
    .map(([label, q]) => (heads ? lifted(label, partOf([make(q)], 'head'), 2 * S) : figure(label, q))));
  if (faces.length > 1) row('expressions', heads ? 'expressions, 2x' : 'expressions', faces, heads ? [] : lines);

  // Hands and feet at 2x: every limb in every view it has a drawing of its own in.
  const limbs = make.parts.filter((n) => EXTREMITY.test(n)), seen = new Set(), ext = [];
  for (const V of views.length ? views : [null]) {
    const list = [make(V ? { ...make.rest, dir: VIEW_DIRS[V] ?? 1 } : make.rest)];
    for (const n of limbs) {
      const p = partOf(list, n), key = p && hashList(p.own);
      if (!p || seen.has(key)) continue;
      seen.add(key);
      ext.push(lifted(views.length > 1 ? `${n}, ${V}` : n, p, 2 * S, key));
    }
  }
  row('hands and feet', 'hands and feet, 2x', ext);

  // The neutral pose first, so every other pose reads against it; it counts as one. A puppet with no named
  // pose has no row (the turnaround already shows it at rest).
  const named = make.poses.filter((p) => p !== 'rest'), rest = make.poses.includes('rest') ? make.poseOf('rest', 1) : make.rest;
  row('poses', 'poses', named.length ? [figure('rest', rest), ...named.map((p) => figure(p, make.poseOf(p, 1)))] : [], lines);
  const cycles = make.puppet.cycles ?? {};
  for (const cyc of make.cycles) {
    const c = cycles[cyc], fps = c.fps ?? FPS;
    row(`cycle ${cyc}`, `${cyc}, ${c.frames.length} frames at ${fps} fps`, c.frames.map((_, j) => figure(String(j), make.frameOf(cyc, j / fps), make.liftOf(cyc, j / fps))), lines);
  }

  // Top to bottom: the title card, the rows, the credits.
  const list = [paper()], right = PAGE - MARGIN;
  let y = MARGIN;
  const nViews = Math.max(1, views.length), nPoses = named.length ? named.length + 1 : 0;
  list.push(
    handText(lettered(id), MARGIN, y + 96, { size: 112 }),
    handText('model sheet', right, y + 60, { size: 44, align: 'right' }),
    handText(`${nViews} view${nViews > 1 ? 's' : ''}, ${nPoses} pose${nPoses === 1 ? '' : 's'}, ${make.cycles.length} cycle${make.cycles.length === 1 ? '' : 's'}`, right, y + 108, { size: 24, align: 'right', ink2: null }),
  );
  y += 140;
  const desc = lettered(make.puppet.desc);
  if (desc) { list.push(handText(desc, MARGIN, y + 8, { size: 26, ink2: null })); y += 40; }
  list.push(stroke(line(MARGIN, y, right, y), 'ink', { w: 2.4 }));
  y += 28;

  for (const r of rows) {
    list.push(handText(r.heading, MARGIN, y + 34, { size: 34 }));
    y += 60;
    const cw = Math.max(...r.cells.map((c) => Math.max(c.w, measure(lettered(c.label), 20) + 8))), ch = Math.max(...r.cells.map((c) => c.h));
    const per = Math.max(1, Math.floor((right - MARGIN + GAP) / (cw + GAP)));
    for (let j0 = 0; j0 < r.cells.length; j0 += per) {
      const n = Math.min(per, r.cells.length - j0);
      for (const gy of r.guides) { const ly = y + (gy - by) * S; list.push(stroke(line(MARGIN - 8, ly, MARGIN + n * (cw + GAP) - GAP + 8, ly), 'guide', { w: 1, wobble: 0 })); }
      r.cells.slice(j0, j0 + n).forEach((c, j) => {
        const x = MARGIN + j * (cw + GAP);
        list.push(c.at(x + (cw - c.w) / 2, y + (ch - c.h)), handText(lettered(c.label), x + cw / 2, y + ch + 26, { size: 20, align: 'center', ink2: null }));
      });
      y += ch + LABEL + GAP;
    }
    y += 12;
  }

  list.push(stroke(line(MARGIN, y, right, y), 'ink', { w: 1.6 }));
  const credits = [id, entry.licence && `licence ${entry.licence}`, entry.credit || (entry.licence === 'own' ? 'own drawing' : ''),
    entry.sha && `sha ${entry.sha.slice(0, 8)}`, `drawn in ${look.name}`].filter(Boolean).map(lettered).join(', ');
  list.push(handText(credits, MARGIN, y + 40, { size: 22, ink2: null }));
  y += 40 + MARGIN;
  return { list, W: PAGE, H: Math.ceil(y), rows: ['title', ...rows.map((r) => r.name), 'credits'], labels: Object.fromEntries(rows.map((r) => [r.name, r.cells.map((c) => c.label)])) };
}

// The model sheet written to assets/sheets/<id>-model.jpg; lint findings on the page stop it.
async function modelSheetFile(make, entry, st, flags) {
  const look = flags.look ? resolveLook(String(flags.look)) : LOOKS.doodlePastel;
  const { list, W, H, rows } = modelSheet(make, { entry, look });
  const found = lintList(list, look, `${entry.name}-model`);
  if (found.length) {
    for (const f of found) process.stderr.write(`${formatFinding(f, 'sheet')}\n`);
    return 1;
  }
  const file = st.sheetPath(`${entry.name}-model`);
  mkdirSync(dirname(file), { recursive: true });
  await paint(list, { look, W, H, width: Math.round(W * 1.5), seed: hash32('model', entry.name) }).toFile(file, { quality: 0.92 });
  process.stdout.write(`${file}  model sheet in ${look.name}, ${rows.length} rows: ${rows.join(', ')}  (list ${hashList(list).slice(0, 12)})\n`);
  return 0;
}

// ---------- a hand beside the house ----------

const HAND_W = 1600, PANGRAMS = ['The quick brown fox jumps over the lazy dog.', 'Pack my box with five dozen liquor jugs!', '0123456789  Sphinx of black quartz, judge my vow.'];

// handPage(hand) => { list, W, H }: one hand on a page: its name, its pen profile, every glyph (the ones it
// lacks drawn by the house, in the guide colour and listed), three pangrams, and the pen row of the hand sheet
// (a line, a circle, a square, a zigzag, a long S) for the pen to draw in the hand's look.
export function handPage(rec) {
  const H = asHand(rec), house = H === houseHand(), list = [paper()], M = 60, st = H.stroke;
  let y = M;
  list.push(handText(lettered(H.name), M, y + 90, { size: 100, hand: H }));
  const prof = `wobble ${st.wobble}, overshoot ${st.overshoot}, hook ${st.hook}, pressure ${st.pressure.join(' ')}, tremor ${st.tremor}, rounding ${st.rounding}`;
  list.push(handText(prof, M, y + 140, { size: 26, hand: H, ink2: null }));
  y += 170;
  const chars = [...Object.keys(GLYPHS).filter((c) => /[0-9A-Za-z]/.test(c)).sort((a, b) => rank(a) - rank(b)), ...SYMBOLS];
  const per = 14, cw = (HAND_W - 2 * M) / per, ch = 112, lacks = [];
  chars.forEach((c, i) => {
    const own = glyph(c, H).own;
    if (!own) lacks.push(c);
    const x = M + (i % per) * cw + cw / 2, by = y + Math.floor(i / per) * ch + 88;
    list.push(stroke(line(x - cw / 2 + 8, by, x + cw / 2 - 8, by), 'guide', { w: 1, wobble: 0 }));
    list.push(handText(c, x, by, { size: 76, align: 'center', hand: H, ink2: null, role: own ? 'ink' : 'guide' }));
  });
  y += Math.ceil(chars.length / per) * ch + 10;
  list.push(handText(lacks.length ? `the house draws ${lacks.join(' ')}` : house ? 'the house hand' : 'every glyph its own', M, y + 30, { size: 26, hand: H, ink2: null, role: lacks.length ? 'guide' : 'ink' }));
  y += 60;
  for (const p of PANGRAMS) { list.push(handText(p, M, y + 64, { size: 56, hand: H, ink2: null })); y += 86; }
  y += 20;
  let x = M;
  for (const c of SHAPES) {
    list.push(place(x, y, group(`pen:${c.name}`, c.paths.map((p, i) => stroke(poly(p, false), 'ink', { w: 4.5, name: `${c.name}${i}` })))));
    x += c.w / UNIT + 30;
  }
  y += 140 + M;
  return { list, W: HAND_W, H: Math.ceil(y) };
}
const rank = (c) => (/[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 100 : 200) + c.charCodeAt(0);

// The house page beside the hand's, each painted in paperInk carrying its hand (so its pen draws the pen row),
// written to assets/sheets/<id>.jpg (what `hdf find` points at).
export async function handSheetFile(id, flags = {}) {
  if (!id) throw new UsageError('sheet: say which hand, e.g. hdf sheet --hand narcis');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  let rec;
  if (id === 'house') rec = houseHand();
  else {
    if (!st.has(id)) throw new UsageError(`sheet: no hand '${id}' in the store`);
    const e = st.entry(id);
    if (e.kind !== 'hand') throw new UsageError(`sheet: '${id}' is a ${e.kind}, not a hand`);
    rec = { ...st.json(e), name: id };
  }
  const pages = [[houseHand(), LOOKS.paperInk], [rec, id === 'house' ? LOOKS.paperInk : modifyLook(LOOKS.paperInk, [['hand', id]], { [id]: rec })]];
  const tiles = pages.map(([h, look]) => {
    const { list, W, H } = handPage(h);
    return { canvas: paint(list, { look, W, H, width: 1100, seed: hash32('hand sheet', h.name) }), label: h.name };
  });
  const file = st.sheetPath(id);
  mkdirSync(dirname(file), { recursive: true });
  await tileSheet(tiles, { cols: 2, label: 18 }).toFile(file, { quality: 0.9 });
  const lacks = Object.keys(GLYPHS).filter((c) => c.trim() && !glyph(c, asHand(rec)).own);
  process.stdout.write(`${file}  house | ${id}${lacks.length ? `  (the house draws ${lacks.join(' ')})` : ''}\n`);
  return 0;
}

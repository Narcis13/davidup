#!/usr/bin/env node
// The first house pack (asset-library plan I2): what our own tools make, put on the house shelf (<repo>/assets)
// as records whose `made` block is the recipe, so `asset remake <id>` makes any of them again. Six paper
// stocks (the looks' paper, `paper`), twelve sound effects and two music beds (`synth sample`), the four hands as
// fonts (`hdf hand --export-ttf`), the fox and the octopus as sprite sheets (`hdf sprite`) and model sheets
// (`hdf sheet store`); and the descs and tags that make the records already on the shelf findable.
//
//   node scripts/house-pack.mjs                  make what is not on the shelf yet, fill in missing descs and tags
//   node scripts/house-pack.mjs --only paper-warm,sfx-pop --force    make those again (a remake, in place)
//   node scripts/house-pack.mjs --dry            say what it would do
//
// The catalogue is the truth once a record is on it: a run never overwrites a desc or drops a tag, it only adds
// the ones NOTES names that are missing. The model sheets are JPEGs over a megabyte each, so the shelf's
// .gitignore keeps blobs/*.jpg out of git and out of the npm package (made, and `asset check --house` notes
// them as unmade in a checkout); everything else ships, under the 15 MB budget.
import { fileURLToPath } from 'node:url';
import { HOUSE_ROOT, addHost, check, loadHosts, make, openLibrary } from '../assetlib/index.js';

const own = { licence: 'own', credit: '', source: '' };

// A look's paper stock: 2048 px square webp.
const paper = (id, name, look, desc, tags) => ({
  id, kind: 'stock', name, desc, tags: ['paper', 'texture', 'background', 'stock', ...tags], ...own,
  made: { tool: 'paper', from: [], args: { look, size: 2048, quality: 0.9 } },
});

// A sound effect of recipes/sfx.js as a wav sample, its peak at -6 dB.
const sfx = (id, name, args, desc, tags) => ({
  id, kind: 'sample', name, desc, tags: ['sfx', 'sound', 'effect', ...tags], ...own,
  made: { tool: 'synth sample', from: [], args: { ...args, peak: 0.5 } },
});

// A music bed that loops, as an m4a.
const bed = (id, name, mood, bars, desc, tags) => ({
  id, kind: 'audio', name, desc, tags: ['music', 'bed', 'loop', 'background', ...tags], ...own,
  made: { tool: 'synth sample', from: [], args: { bed: { mood }, bars, peak: 0.5, kbps: 96 } },
});

// A hand as a TrueType font (family hdf-<hand>, as render_hdf_clip names it); licence and credit are the hand's.
const font = (hand, name, desc, tags) => ({
  id: `${hand}-font`, kind: 'font', name, desc, tags: ['font', 'hand-drawn', 'lettering', 'single-stroke', ...tags],
  family: `hdf-${hand}`, from: hand,
  made: { tool: 'hdf hand --export-ttf', from: [hand], args: { hand } },
});

// A puppet as a sprite sheet on no stock, three states; licence and credit are the puppet's.
const sprite = (puppet, name, desc, tags) => ({
  id: `${puppet}-sprite`, kind: 'image', name, desc, tags: ['sprite', 'sheet', 'character', 'hand-drawn', 'idle', 'walk', 'wave', puppet, ...tags],
  from: puppet,
  made: { tool: 'hdf sprite', from: [puppet], args: { name: puppet, states: 'idle,walk,wave' } },
});

// A puppet's model sheet (turnaround, expressions, hands and feet, poses).
const model = (puppet, name, desc, tags) => ({
  id: `${puppet}-model-sheet`, kind: 'image', name, desc, tags: ['model-sheet', 'reference', 'character', 'hand-drawn', 'poses', puppet, ...tags],
  from: puppet,
  made: { tool: 'hdf sheet store', from: [puppet], args: { puppet, poses: true } },
});

export const RECIPES = [
  paper('paper-warm', 'Warm paper', 'paperInk', 'Warm cream paper with soft diagonal light bands and a fine grain (the paperInk stock)', ['warm', 'cream', 'light']),
  paper('paper-white', 'Cold white paper', 'pencilMinimal~sheet:#eef1f3', 'Cool, near-white drawing paper with a faint grain, for quiet graphite and ink', ['white', 'cold', 'cool', 'light', 'minimal']),
  paper('paper-kraft', 'Kraft card', 'cutout~sheet:sand', 'Brown kraft card with a heavy tooth and pale fibres (the cutout look\'s card in sand)', ['kraft', 'brown', 'card', 'cardboard', 'warm']),
  paper('paper-ruled', 'Notebook page', 'notebook', 'A ruled school notebook page: pale blue lines, a red margin and three punched holes', ['notebook', 'ruled', 'lined', 'school', 'light']),
  paper('paper-blueprint', 'Blueprint', 'blueprintNight', 'Deep navy blueprint stock flecked with chalky specks, for white line drawing', ['blueprint', 'navy', 'blue', 'dark', 'night']),
  paper('paper-chalkboard', 'Chalkboard', 'chalkboard', 'A green-black chalkboard with the haze of wiped lessons and a wooden ledge holding chalk and a felt eraser', ['chalkboard', 'blackboard', 'slate', 'green', 'dark', 'school']),

  sfx('sfx-pop', 'Pop', { sfx: 'pop' }, 'A cork pop: a quick upward sine sweep and a click, for something appearing or landing', ['pop', 'cork', 'appear', 'short']),
  sfx('sfx-boing', 'Boing', { sfx: 'boing' }, 'A spring boing: a triangle bent up a fifth with a wide vibrato, half a second', ['boing', 'spring', 'bounce', 'cartoon']),
  sfx('sfx-ding', 'Ding', { sfx: 'ding' }, 'A small bell ding ringing out over a second and a half, for a right answer or an idea', ['ding', 'bell', 'chime', 'correct']),
  sfx('sfx-whoosh', 'Whoosh', { sfx: 'whoosh' }, 'Air rushing past, noise swept up through a band-pass, for a transition or something flying in', ['whoosh', 'swoosh', 'air', 'transition']),
  sfx('sfx-whoosh-out', 'Whoosh out', { sfx: 'whoosh', opts: { down: true } }, 'Air rushing past the other way, noise swept down, for something leaving or a cut out', ['whoosh', 'swoosh', 'air', 'transition', 'exit']),
  sfx('sfx-tada', 'Ta-da', { sfx: 'tada' }, 'A short fanfare: a quick triad, then the triad held with its octave, for a reveal', ['tada', 'fanfare', 'reveal', 'success']),
  sfx('sfx-tick', 'Tick', { sfx: 'tick' }, 'A dry tick: a short high noise and a click, for a mark, a checkbox or a wrong answer crossed', ['tick', 'click', 'mark', 'short']),
  sfx('sfx-pencil', 'Pencil scratch', { sfx: 'pencilScratch', dur: 0.8 }, 'Graphite scratching on paper for most of a second, for sketching and writing', ['pencil', 'scratch', 'writing', 'drawing', 'paper']),
  sfx('sfx-page-turn', 'Page turn', { sfx: 'flip' }, 'A page turning: a swell falling through the band and the page landing', ['page', 'turn', 'flip', 'paper', 'book']),
  sfx('sfx-chalk', 'Chalk on a board', { sfx: 'squeak', opts: { tool: 'chalk', dur: 0.5 } }, 'Chalk meeting a board with a knock, then a dusty stroke, for writing on a chalkboard', ['chalk', 'chalkboard', 'writing', 'school']),
  sfx('sfx-eraser', 'Eraser scrub', { sfx: 'erase', dur: 0.8, opts: { strokes: 4 } }, 'An eraser scrubbing back and forth four times, for wiping a board or rubbing out', ['eraser', 'erase', 'rub', 'wipe', 'school']),
  sfx('sfx-marker', 'Marker squeak', { sfx: 'squeak', opts: { tool: 'marker', dur: 0.4 } }, 'A felt marker squeaking on a whiteboard, for writing on a board', ['marker', 'squeak', 'whiteboard', 'writing']),

  bed('bed-calm', 'Calm bed', 'calm', 4, 'A calm music bed at 72 bpm in C: soft sine pads, a low bass and a slow arpeggio; 13 s that loop', ['calm', 'gentle', 'soft', 'ambient']),
  bed('bed-bright', 'Bright bed', 'bright', 8, 'A bright music bed at 112 bpm in C: triangle chord hits, a walking bass and running eighths; 17 s that loop', ['bright', 'upbeat', 'cheerful', 'happy']),

  font('hershey-romans', 'Hershey Roman (font)', 'The Hershey single-stroke roman hand as a TrueType font, its centre lines swept by the pen', ['hershey', 'roman', 'print', 'engraving']),
  font('hershey-script', 'Hershey Script (handwritten font)', 'The Hershey joined script hand as a TrueType font: cursive handwriting, its centre lines swept by the pen', ['hershey', 'script', 'cursive', 'handwritten', 'handwriting', 'joined']),
  font('hershey-cyrillic', 'Hershey Cyrillic (font)', 'The Hershey Cyrillic hand as a TrueType font, Latin and Cyrillic, its centre lines swept by the pen', ['hershey', 'cyrillic', 'russian', 'print']),
  font('test', 'Test hand (font)', 'The test hand as a TrueType font: a hand synthesised from the house hand by hdf hand --synth', ['synthetic', 'test', 'handwriting']),

  sprite('fox', 'Fox sprite sheet', 'The fox as a sprite sheet on a transparent ground: idle (24 frames, breathing), walk (8, a loop that travels) and wave (1), 12 fps', ['fox', 'animal']),
  sprite('octopus', 'Octopus sprite sheet', 'The pink octopus as a sprite sheet on a transparent ground: idle (24 frames, breathing), walk (12) and wave (1), 12 fps', ['octopus', 'animal', 'sea', 'pink']),
  model('fox', 'Fox model sheet', 'The model sheet of the fox puppet: turnaround, expressions, hands and feet, and its poses', ['fox', 'animal']),
  model('octopus', 'Octopus model sheet', 'The model sheet of the pink octopus puppet: turnaround, expressions and its poses', ['octopus', 'animal', 'sea']),
];

// Descs and tags for the records on the shelf before the pack: a desc is set where there is none, tags are
// added where missing. `voice` samples get their speaker; the Met cutouts their object tags.
const met = (desc, tags) => ({ desc, tags: ['photo', 'museum', ...tags] });
export const NOTES = {
  teapot: met('A white porcelain teapot painted with flowers, ca. 1755, cut out on a transparent ground', ['kitchen', 'teapot', 'tea', 'porcelain']),
  cup: met('A blue and white porcelain cup with a stylised floral pattern, ca. 1860-70, cut out', ['kitchen', 'cup', 'tea', 'porcelain', 'blue']),
  helmet: met('A steel close helmet from a suit of armour, ca. 1550, cut out', ['armour', 'armor', 'helmet', 'knight', 'metal']),
  hourglass: met('A gilded half-hour sandglass, ca. 1500-25, cut out', ['time', 'hourglass', 'sand', 'clock']),
  watch: met('A gold pocket watch with a white enamel dial and Roman numerals, ca. 1900, cut out', ['time', 'watch', 'clock', 'gold']),
  lantern: met('A tin lantern with an engraved glass globe and a candle inside, 1825-31, cut out', ['light', 'lantern', 'lamp', 'candle']),
  violin: met('The Gould violin by Antonio Stradivari, 1693, cut out', ['music', 'violin', 'instrument', 'strings']),

  fox: { desc: 'A cartoon fox standing upright, drawn in ink and rigged: three views, walk, run, gallop and jump cycles, poses and expressions', tags: ['fox', 'animal', 'character', 'cast', 'biped'] },
  octopus: { desc: 'A pink cartoon octopus, rigged: three views, swim and walk cycles, poses and expressions', tags: ['octopus', 'animal', 'sea', 'character', 'cast', 'pink'] },
  bit: { desc: 'Bit, the small boxy robot of how-ai-learns with a screen face and dials on its chest', tags: ['character', 'machine'] },
  sam: { desc: 'Sam, a person drawn on the rig sheets for the moon film, side and front views, with a stick puppet face', tags: ['character', 'person'] },

  elephant: { desc: 'An elephant walking, traced frame by frame from Muybridge\'s plates (found motion)', tags: ['elephant', 'walk', 'cycle', 'motion'] },
  horse: { desc: 'A horse galloping, traced frame by frame from Muybridge\'s plates (found motion)', tags: ['horse', 'gallop', 'cycle', 'motion'] },
  kangaroo: { desc: 'A kangaroo hopping, traced frame by frame from Muybridge\'s plates (found motion)', tags: ['kangaroo', 'hop', 'jump', 'cycle', 'motion'] },
  pigeons: { desc: 'Pigeons in flight, traced frame by frame from Muybridge\'s plates (found motion)', tags: ['pigeon', 'bird', 'flight', 'fly', 'cycle', 'motion'] },

  'hershey-romans': { desc: 'The Hershey Roman simplex hand: single-stroke roman capitals and lower case, drawn as centre lines', tags: ['lettering', 'roman', 'single-stroke', 'print'] },
  'hershey-script': { desc: 'The Hershey script hand: joined single-stroke cursive, drawn as centre lines', tags: ['lettering', 'script', 'cursive', 'handwriting', 'single-stroke'] },
  'hershey-cyrillic': { desc: 'The Hershey Cyrillic hand: single-stroke Cyrillic and Latin letters, drawn as centre lines', tags: ['lettering', 'cyrillic', 'single-stroke'] },
  test: { desc: 'A test hand synthesised from the house hand by hdf hand --synth, for trying a hand without drawing one', tags: ['lettering', 'handwriting', 'test'] },
};
// how-ai-learns lines by their speaker (the id's prefix), and the one-off voice lines.
const SPEAKERS = { 'ai-': ['narration', 'narrator'], 'bit-': ['bit', 'robot', 'character'], 'fox-': ['fox', 'character'] };

// What to add to an entry: the NOTES desc where it has none, the NOTES (or speaker) tags it lacks.
export function notesFor(id, e) {
  const n = NOTES[id] ?? (e.kind === 'sample' && e.tags?.includes('voice') ? { tags: [...(Object.entries(SPEAKERS).find(([p]) => id.startsWith(p))?.[1] ?? []), 'speech'] } : null);
  if (!n) return null;
  const patch = {};
  if (n.desc && !String(e.desc ?? '').trim()) patch.desc = n.desc;
  const tags = [...new Set([...(e.tags ?? []), ...(n.tags ?? [])])];
  if (tags.length !== (e.tags ?? []).length) patch.tags = tags;
  return Object.keys(patch).length ? patch : null;
}

// A recipe as make() takes it: `from` (a source record) lends its licence and credit, and names it as the source.
function recipeOf(lib, r) {
  const { from, ...rest } = r;
  if (!from) return rest;
  const src = lib.get(from);
  return { ...rest, licence: src.licence, credit: src.credit ?? '', source: src.source ?? '' };
}

function parse(argv) {
  const o = { only: null, force: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') o.force = true;
    else if (a === '--dry') o.dry = true;
    else if (a === '--only') o.only = new Set(String(argv[++i] ?? '').split(',').filter(Boolean));
    else throw new Error(`house-pack: unknown argument '${a}' (--only id,id --force --dry)`);
  }
  return o;
}

export async function main(argv = process.argv.slice(2), { root = HOUSE_ROOT, out = process.stdout } = {}) {
  const o = parse(argv), say = (s) => out.write(`${s}\n`);
  const lib = openLibrary({ shelves: [{ name: 'house', root }] });
  const { makers, adds, warnings } = await loadHosts();
  for (const w of warnings) say(`warning: ${w}`);
  // hdf's pixels (skia) for every kind, so a JPEG model sheet gets its palette too (assetlib decodes PNG only).
  const { probes } = await addHost(adds, 'stock');
  const known = new Set(RECIPES.map((r) => r.id));
  for (const id of o.only ?? []) if (!known.has(id)) throw new Error(`house-pack: '${id}' is no recipe (${[...known].join(', ')})`);

  for (const r of RECIPES) {
    if (o.only && !o.only.has(r.id)) continue;
    const had = lib.shelf('house').entries.has(r.id);
    if (had && !o.force) { say(`${r.id.padEnd(24)} on the shelf`); continue; }
    if (o.dry) { say(`${r.id.padEnd(24)} would ${had ? 'remake' : 'make'} (${r.made.tool})`); continue; }
    const got = await make(lib, recipeOf(lib, r), { makers, shelf: 'house', host: { adds, probes }, replace: o.force });
    say(`${r.id.padEnd(24)} ${got.tool.padEnd(22)} ${got.sha.slice(0, 12)}.${got.entry.ext}  ${(got.entry.bytes / 1024).toFixed(0)} KB${got.was && !got.changed ? '  same bytes' : ''}`);
    for (const w of got.warnings) say(`  warning: ${w}`);
  }

  if (!o.only) {
    const s = lib.shelf('house');
    for (const id of s.ids) {
      const patch = notesFor(id, s.entry(id));
      if (!patch) continue;
      if (!o.dry) lib.update(id, patch, { shelf: 'house' });
      say(`${id.padEnd(24)} ${o.dry ? 'would add' : 'added'} ${Object.keys(patch).join(', ')}`);
    }
  }

  const found = check(lib, { house: true }).filter((f) => f.level !== 'note');
  for (const f of found) say(`${f.level}  ${f.rule}  ${f.id ?? f.path}: ${f.detail}`);
  return found.some((f) => f.level === 'error') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}

// hdf donate <module.js> <cel...> [--pack name] [--packs dir] [--no-sheets]: copy cels into a pack, then
// regenerate packs/manifest.json and packs/sheets/<cel>.jpg.
// hdf donate --manifest [--all-sheets]: only regenerate the manifest (and missing or, with --all-sheets, every sheet).
//
// The source is any module exporting cels (a film, a recipes module). A cel is copied as source text: its
// statement plus every top-level declaration it reaches (helpers, constants), the top-level statements that
// only touch those (a registerClips(CLIPS) call), and the imports they use, rewritten to resolve from the
// pack. Each cel lands in a block between markers, so donating it again replaces it:
//   // ---- donated: fly from films/fly-style.js ----
//   ...
//   // ---- end fly ----
// A helper the pack already declares is shared when its text is identical and refused when it differs.
// After writing, the pack is imported and every input variant of the copy must hash the same as the
// original, or the pack file is restored and donate fails.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashList } from '../core/list.js';
import { LOOKS } from '../core/looks.js';
import { format } from '../core/fit.js';
import { importText, statements } from './jsscan.mjs';
import { celSheet } from './sheet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKS = resolve(HERE, '..', 'packs');
const SHEET_CELL = 120;

const SLOT = '// ---- donate: slot ----';
const BEGIN = /^\/\/ ---- donated: (\S+) from (\S+) ----$/, END = (name) => `// ---- end ${name} ----`;

export async function run(args, flags) {
  const dir = resolve(String(flags.packs ?? PACKS));
  if (flags.manifest) {
    const m = await writeManifest(dir, { sheets: flags.sheets !== false, all: !!flags.allSheets });
    process.stdout.write(`${join(dir, 'manifest.json')}  ${m.cels.length} cels in ${new Set(m.cels.map((c) => c.pack)).size} packs\n`);
    return 0;
  }
  const [path, ...names] = args;
  if (!path || !names.length) throw new Error('donate: say which module and cels, e.g. hdf donate films/fly-style.js fly --pack creatures');
  const known = readManifest(dir);
  const done = [];
  for (const name of names) {
    const pack = flags.pack && flags.pack !== true ? String(flags.pack) : known.cels.find((c) => c.name === name)?.pack;
    if (!pack) throw new Error(`donate: which pack for '${name}'? say --pack <name> (creatures, objects, tech, or a new one)`);
    const r = await donate(resolve(path), name, { dir, pack });
    process.stdout.write(`${name} -> ${relative(process.cwd(), r.file)}  (${r.helpers} helper${r.helpers === 1 ? '' : 's'}, ${r.imports} import${r.imports === 1 ? '' : 's'}, ${r.variants} variants hash-checked)\n`);
    done.push(name);
  }
  const m = await writeManifest(dir, { sheets: flags.sheets !== false, redo: done });
  process.stdout.write(`${join(dir, 'manifest.json')}  ${m.cels.length} cels\n`);
  return 0;
}

// ---------- donating one cel ----------

export async function donate(src, name, { dir = PACKS, pack }) {
  if (!/^[a-z][a-z0-9-]*$/.test(pack)) throw new Error(`donate: pack name '${pack}' (lowercase letters, digits, '-')`);
  const mod = await import(pathToFileURL(src).href);
  const hit = Object.entries(mod).find(([, v]) => typeof v === 'function' && v.cel?.name === name);
  if (!hit) {
    const have = Object.values(mod).filter((v) => typeof v === 'function' && v.cel).map((v) => v.cel.name);
    throw new Error(`donate: ${relative(process.cwd(), src)} exports no cel '${name}'${have.length ? ` (it exports: ${have.join(', ')})` : ''}`);
  }
  const [binding, make] = hit;
  mkdirSync(dir, { recursive: true });
  dir = realpathSync(dir);   // imports are rewritten as relative paths, so both ends must be real paths
  const block = extract(readFileSync(src, 'utf8'), binding, { from: dirname(realpathSync(src)), to: dir });

  const file = join(dir, `${pack}.js`);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const text = merge(before ?? header(pack), block, { name, from: relative(realpathSync(resolve(HERE, '..')), realpathSync(src)) });
  writeFileSync(file, text);
  try {
    const copy = (await import(`${pathToFileURL(file).href}?v=${Date.now()}`))[binding];
    if (typeof copy !== 'function' || copy.cel?.name !== name) throw new Error(`the pack does not export cel '${name}' as ${binding}`);
    const vs = inputVariants(make.cel.inputs);
    for (const v of vs) {
      if (hashList([copy(v)]) !== hashList([make(v)])) throw new Error(`the copy draws differently from the original for inputs ${JSON.stringify(v)}`);
    }
    return { file, helpers: block.stmts.length - 1, imports: block.imports.length, variants: vs.length };
  } catch (e) {
    if (before === null) rmSync(file); else writeFileSync(file, before);
    throw new Error(`donate ${name}: ${e.message} (pack left as it was)`);
  }
}

// Defaults, then each numeric input at its min and at its max.
export function inputVariants(inputs = {}) {
  const out = [{}];
  for (const [k, spec] of Object.entries(inputs)) if (Array.isArray(spec)) out.push({ [k]: spec[0] }, { [k]: spec[1] });
  return out;
}

const header = (pack) => `// The ${pack} pack: cels to place in films (plan 1.6). Cels are copied in from films by \`hdf donate\`
// (between the donated markers; donate again to update one) or drawn here. packs/manifest.json lists them
// with their box, inputs and description; packs/sheets/<cel>.jpg shows each in every look.
`;

// The statements a binding needs, in source order, and the import bindings they use (sources rewritten
// from the module's directory to the pack's).
function extract(source, binding, { from, to }) {
  const all = statements(source);
  const declOf = new Map(), importOf = new Map();
  for (const st of all) {
    if (st.kind === 'decl') for (const d of st.decls) declOf.set(d, st);
    if (st.kind === 'import') for (const b of st.imports) importOf.set(b.local, b);
  }
  const target = declOf.get(binding);
  if (!target) throw new Error(`donate: cannot find the declaration of '${binding}' (export it as \`export const ${binding} = cel(...)\`)`);
  const keep = new Set(), imports = new Map();
  const reach = (st) => {
    if (keep.has(st)) return;
    keep.add(st);
    for (const u of st.uses) {
      if (declOf.has(u)) reach(declOf.get(u));
      else if (importOf.has(u)) imports.set(u, importOf.get(u));
    }
  };
  reach(target);
  // statements that only touch what is kept (module set-up such as registerClips(CLIPS)), to a fixed point
  for (let grew = true; grew;) {
    grew = false;
    for (const st of all) {
      if (st.kind !== 'expr' || keep.has(st)) continue;
      const us = [...st.uses].filter((u) => declOf.has(u) || importOf.has(u));
      if (!us.length || !us.every((u) => importOf.has(u) || keep.has(declOf.get(u)))) continue;
      keep.add(st);
      for (const u of us) if (importOf.has(u)) imports.set(u, importOf.get(u));
      grew = true;
    }
  }
  const stmts = all.filter((st) => keep.has(st)).map((st) => {
    let text = st.text;
    if (st === target) { if (!st.exported) text = `${st.lead}export ${text.slice(st.lead.length)}`; }
    else if (st.exported) text = text.replace(/^((?:\/\/.*\n)*)export /, '$1');
    return { text, decls: st.decls };
  });
  const rebase = (s) => {
    if (!s.startsWith('.') && !s.startsWith('file:')) return s;   // bare specifiers stay as they are
    const r = relative(to, s.startsWith('file:') ? fileURLToPath(s) : resolve(from, s)).split('\\').join('/');
    return r.startsWith('.') ? r : `./${r}`;
  };
  return { stmts, imports: [...imports.values()].map((b) => ({ ...b, source: rebase(b.source) })) };
}

// The pack's text with `block` as the cel's (new or replaced) donated block and its imports merged.
function merge(text, block, { name, from }) {
  const lines = text.split('\n');
  // drop the old block of this cel
  const s = lines.findIndex((l) => BEGIN.exec(l)?.[1] === name);
  if (s >= 0) {
    const e = lines.indexOf(END(name), s);
    if (e < 0) throw new Error(`donate: the block of '${name}' in the pack has no end marker`);
    lines.splice(s, e - s + 1, SLOT);   // the new block goes back where the old one was
  }
  text = lines.join('\n');
  const all = statements(text);
  // header comment, imports, body
  const firstCode = all.length ? all[0].s - all[0].lead.length : text.length;
  const head = text.slice(0, firstCode).replace(/\s+$/, '') + '\n';
  const bindings = [];
  const bound = new Map();
  const bind = (b) => {
    const was = bound.get(b.local);
    if (was && (was.source !== b.source || was.imported !== b.imported)) {
      throw new Error(`donate: '${b.local}' is imported from ${b.source} but the pack already imports it from ${was.source}`);
    }
    if (!was) { bound.set(b.local, b); bindings.push(b); }
  };
  const declared = new Map();
  let body = '';
  for (const st of all) {
    if (st.kind === 'import') { st.imports.forEach(bind); continue; }
    for (const d of st.decls) declared.set(d, norm(st.text));
    body += text.slice(prevEnd(all, st), st.e);
  }
  if (all.length) body += text.slice(all.at(-1).e);   // a trailing end marker
  body = body.replace(/^\s+/, '').replace(/\s+$/, '');
  block.imports.forEach(bind);
  const own = [];
  for (const st of block.stmts) {
    const clash = [...st.decls].filter((d) => declared.has(d));
    if (clash.length && clash.every((d) => declared.get(d) === norm(st.text))) continue;   // identical helper: share it
    if (clash.length) throw new Error(`donate: the pack already declares ${clash.map((d) => `'${d}'`).join(', ')} differently; rename it in the source`);
    if ([...st.decls].some((d) => bound.has(d))) throw new Error(`donate: '${[...st.decls].find((d) => bound.has(d))}' clashes with an import of the pack`);
    own.push(st.text);
  }
  const blockText = [`// ---- donated: ${name} from ${from} ----`, ...own, END(name)].join('\n');
  body = body.includes(SLOT) ? body.replace(SLOT, blockText) : `${body ? body + '\n\n' : ''}${blockText}`;
  return `${head}${bindings.length ? '\n' + importText(bindings) + '\n' : ''}\n${body}\n`;
}
const norm = (t) => t.replace(/^(\/\/.*\n)*/, '').replace(/^export /, '').replace(/\s+/g, ' ').trim();
// Where the text belonging to st starts: right after the previous statement (so comments between travel with it).
function prevEnd(all, st) { const k = all.indexOf(st); return k > 0 ? all[k - 1].e : st.s - st.lead.length; }

// ---------- manifest and sheets ----------

export function readManifest(dir = PACKS) {
  const f = join(dir, 'manifest.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { cels: [] };
}

// Every exported cel of every packs/*.js: { cels: [{ name, pack, export, box, inputs, desc, sheet }] }.
export async function packCels(dir = PACKS) {
  const out = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];
  for (const f of files) {
    const mod = await import(`${pathToFileURL(join(dir, f)).href}?v=${Date.now()}`);
    for (const [binding, v] of Object.entries(mod)) {
      if (typeof v !== 'function' || !v.cel) continue;
      const { name, box, inputs, desc } = v.cel;
      const dup = out.find((c) => c.name === name);
      if (dup) throw new Error(`packs: cel '${name}' is in both ${dup.pack} and ${basename(f, '.js')}`);
      out.push({ name, pack: basename(f, '.js'), export: binding, box: box ?? null, inputs: inputs ?? {}, desc: desc ?? '', sheet: `sheets/${name}.jpg`, make: v });
    }
  }
  return out;
}

export async function writeManifest(dir = PACKS, { sheets = true, all = false, redo = [] } = {}) {
  const cels = await packCels(dir);
  const manifest = { cels: cels.map(({ make, ...c }) => c) };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  if (sheets) {
    mkdirSync(join(dir, 'sheets'), { recursive: true });
    for (const c of cels) {
      const file = join(dir, c.sheet);
      if (!all && existsSync(file) && !redo.includes(c.name)) continue;
      await celSheet(c.make, c.make.cel, { look: LOOKS.paperInk, format: format('1:1'), file, cell: SHEET_CELL, quality: 0.8 });
      process.stdout.write(`${file}\n`);
    }
  }
  return manifest;
}

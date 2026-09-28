#!/usr/bin/env node
// asset: the library from a terminal (asset-library plan §5 A6).
//
//   asset find warm paper --media raster      ranked hits, why each matched, and what else there is
//   asset show teapot                         the record, its shelves, thumb, what it was made from and into, its `use`
//   asset add paper.png --kind stock --name "Warm paper" --licence own --tags paper,warm
//   asset tag teapot +kitchen -object         asset desc teapot "Silver teapot, three-quarter view"
//   asset rm teapot     asset mv teapot --to house     asset gc --dry
//   asset thumb teapot | --all                asset sheet teapot cup fox --out candidates.png
//   asset ls --shelf house                    asset check
//   asset migrate --sha256 house              rehash a shelf's sha1 blobs as sha256 (H1)
//
// The shelves are the standard three (index.js standardShelves): `--project <dir>` opens <dir>/assets as the
// project shelf; $DAVIDUP_ASSETS and $DAVIDUP_HOUSE move the user's pool and the house. A write goes to
// --shelf, else the project when one is open, else the user's pool. `--json` prints what a verb found as JSON.
//
// main(argv, host) is the whole CLI; run(verb, argv, host) is one verb without the printing, and addAsset the
// one way in. A host (hdf's find/import/remove/gc since H2, davidup) passes what it knows better: `probes`
// (over probe.js's), `previewers`, `derive` ({ kind: (bytes, { file, entry }) -> fields }, over DERIVE),
// `fields` (validate()'s per-kind checks), `by` (the door an add came in by) and `library` (a library it
// opened itself); tests pass `out`, `err`, `env`, `cwd` and `home`.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, LEVELS } from './check.js';
import { loadHosts } from './hosts.js';
import { imageInfo } from './image.js';
import { ID, KINDS, LICENCES, THUMB_CACHE, factsOf, isLegacySha, migrateSha256, openLibrary, readShelf, standardShelves } from './index.js';
import { defaultProbes } from './probe.js';

export const USAGE = `asset: the asset library shared by davidup and hdf (docs/asset-library-plan.md)

usage: asset <verb> [args] [--project <dir>] [--json]

  find    <words...> [--kind k,k] [--media m] [--shelf s] [--tags t,t] [--licence l,l] [--alpha] [--dark]
          [--hue warm|cool|red|...] [--min-w px] [--min-h px] [--aspect 16:9] [--sec-min s] [--sec-max s] [--limit n]
                                    ranked hits with why each matched; with no hit, what the library has
  show    <id | sha:hex> [--shelf]  the record, its shelves, blob and thumb, what it was made from and into,
                                    and the exact call that brings it into davidup and into hdf
  add     <file> --kind <kind> --name <name> [--id] [--licence] [--credit] [--source] [--tags a,b] [--desc]
          [--family] [--with '<json>'] [--shelf]
                                    one way in: hashed, probed, validated, then written (--id defaults to
                                    the name as an id; --with adds fields the CLI cannot derive, a cutout's sil)
  tag     <id> +tag -tag [tag] [--shelf]   add (+ or bare) and drop (-) tags; commas take several
  desc    <id> <line...> [--shelf]  set the one-line description (an empty line removes it)
  rm      <id...> [--shelf]         remove, with the blob and thumb when nothing else on the shelf shares them
  mv      <id> --to <shelf> [--from <shelf>]   move blob, thumb and entry (the editor's promote)
  gc      [--dry] [--shelf]         delete blobs and thumbs no entry points at
  thumb   <id...> | --all [--shelf] [--force]  draw the previews: a host's picture where one draws the kind
                                    (hdf's for its seven kinds), else a card
  sheet   <id...> [--cols n] [--cell px] [--out file]   one contact sheet PNG with id captions
  ls      [--shelf] [--kind]        every entry, shelf by shelf, with what shadows what
  check   [--shelf]                 licence unknown, missing blob, orphan, duplicate sha across shelves,
                                    missing thumb, sha1 entries, bad ids, empty desc or tags; exits 1 on an error
  migrate --sha256 <shelf | dir> [--dry]   rename a shelf's sha1 blobs by their sha256 (bytes kept; a JSON
                                    payload naming another blob's sha1 names its sha256) and rewrite the entries

shelves: project (--project <dir>: <dir>/assets), user ($DAVIDUP_ASSETS, else ~/.davidup/assets),
         house ($DAVIDUP_HOUSE, else the repo's store). kinds: ${KINDS.join(' ')}
         licences: ${LICENCES.join(' ')}
hosts:   previews are drawn by hdf (handdrawn/cli/host.mjs) when it is next to this package, and by the
         modules $ASSETLIB_HOSTS names ('-' first: those alone)
`;

export const VERBS = ['find', 'show', 'add', 'tag', 'desc', 'rm', 'mv', 'gc', 'thumb', 'sheet', 'ls', 'check', 'migrate'];

export class UsageError extends Error {}
const usage = (msg) => new UsageError(msg);

// ---------- arguments ----------

// Flags that never take a value, so `asset find --alpha fox` searches for fox.
const BOOLEAN = new Set(['json', 'dry', 'all', 'force', 'alpha', 'dark', 'help', 'sha256']);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// --key value, --key=value, --flag, --no-flag, -- ends flags. Values stay strings: each verb reads its own.
// A single dash is not a flag, so `asset tag fox -object` drops a tag.
export function parseArgs(argv) {
  const args = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a.length === 2) { args.push(a); continue; }
    const eq = a.indexOf('='), raw = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq < 0 && raw.startsWith('no-')) { flags[camel(raw.slice(3))] = false; continue; }
    const key = camel(raw);
    if (eq > 0) flags[key] = a.slice(eq + 1);
    else if (BOOLEAN.has(key)) flags[key] = true;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { args, flags };
}

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const str = (flags, k) => {
  const v = flags[k];
  if (v === undefined || v === false) return undefined;
  if (v === true) throw usage(`--${kebab(k)} needs a value`);
  return String(v);
};
const list = (flags, k) => {
  const v = str(flags, k);
  return v === undefined ? undefined : v.split(',').map((x) => x.trim()).filter(Boolean);
};
const num = (flags, k) => {
  const v = str(flags, k);
  if (v === undefined) return undefined;
  if (v.trim() === '' || !Number.isFinite(+v)) throw usage(`--${kebab(k)} ${v}: expected a number`);
  return +v;
};
const bool = (flags, k) => {
  const v = flags[k];
  if (v === undefined || typeof v === 'boolean') return v;
  if (/^(true|yes|1)$/i.test(v)) return true;
  if (/^(false|no|0)$/i.test(v)) return false;
  throw usage(`--${kebab(k)} ${v}: expected true or false`);
};
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// A name as an id: "Warm paper" -> "warm-paper".
export const idOf = (name) => String(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9:]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- what `add` derives ----------

const jsonOf = (bytes) => { try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; } };
const box4 = (b) => (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? b : undefined);
const frame = (bytes) => { const h = imageInfo(bytes); return h ? { box: [0, 0, h.w, h.h] } : {}; };

// The per-kind fields `asset add` reads off a payload itself, where the payload says them: a raster's frame as
// its box, a JSON kind's own counts and box. What only hdf can work out (a cutout's silhouette, a puppet's box
// from its parts, a motif's bounds) comes from the host's `derive` (hdf's, from H2) or from --with.
export const DERIVE = Object.freeze({
  stock: frame,
  cutout: frame,
  hand: (bytes) => {
    const d = jsonOf(bytes), marks = Object.keys(d?.marks ?? {}).length;
    return d?.glyphs && typeof d.glyphs === 'object' ? { glyphs: Object.keys(d.glyphs).length, ...(marks ? { marks } : {}) } : {};
  },
  clip: (bytes) => {
    const d = jsonOf(bytes);
    if (!d) return {};
    const n = Number.isInteger(d.n) ? d.n : Array.isArray(d.frames) ? d.frames.length : undefined;
    return defined({ n, fps: d.fps ?? 12, h: Number.isFinite(d.h) ? d.h : undefined, track: d.track, box: box4(d.box) ?? (d.track ? [0, 0, 0, 0] : undefined) });
  },
  puppet: (bytes) => { const d = jsonOf(bytes); return defined({ units: d?.units, box: box4(d?.box) }); },
  motif: (bytes) => defined({ box: box4(jsonOf(bytes)?.box) }),
});

// What to do when a kind's payload lacks what only a tool can derive.
const HINT = {
  cutout: "a cutout's silhouette is traced by `hdf import --kind cutout` (or `hdf photo`); or give it with --with '{\"sil\": {...}}'",
  puppet: "`hdf import --kind puppet` lints a puppet and works out its box; or give --with '{\"box\": [x, y, w, h]}'",
  motif: "`hdf svg --motif` works out a motif's box; or give --with '{\"box\": [x, y, w, h]}'",
  clip: "`hdf import --kind clip` works out a clip's box; or give --with '{\"box\": [x, y, w, h]}'",
  font: 'give the family the font is asked for by with --family',
};

// The one way in, for this CLI's `add` and for a host command that already holds the bytes (hdf import, which
// compiles a stick first): the fields the kind's payload says (the host's `derive`, else DERIVE; the entry's
// own fields win), then `extra`, then probed (probe.js's probes under the host's), validated and written on
// `shelf` (default: the only shelf, else the project, else the user's pool). Resolves to { id, shelf, entry,
// path, created, replaced, warnings }; `replaced` is the entry the id had on that shelf, or null.
export async function addAsset(lib, { bytes, file, entry, extra = {}, shelf }, host = {}) {
  const { id, kind } = entry;
  const own = host.derive?.[kind], derive = own ?? DERIVE[kind];
  const derived = derive ? (await derive(bytes, { file, entry })) ?? {} : {};
  const full = { ...entry, ...Object.fromEntries(Object.entries(derived).filter(([k]) => entry[k] === undefined)), ...extra };
  const target = shelf ?? (lib.shelves.length === 1 ? lib.shelves[0].name : lib.shelves.some((s) => s.name === 'project') ? 'project' : 'user');
  const replaced = lib.shelf(target).entries.get(id) ?? null;
  let out;
  try {
    out = await lib.put(target, full, bytes, { probes: { ...defaultProbes(), ...host.probes }, fields: host.fields, by: host.by ?? 'asset add' });
  } catch (err) {
    throw new Error(`${err.message}${HINT[kind] && !own ? `\n(${HINT[kind]})` : ''}`);
  }
  return { ...out, replaced };
}

// ---------- printing ----------

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const short = (h) => `${String(h).slice(0, 12)}…`;
const pad = (s, n) => String(s).padEnd(n);
// "kind: sample 30, puppet 14 · licence: own 50" (the first `top` values of each facet).
const facetLine = (facets, top = 6) => Object.entries(facets ?? {})
  .filter(([, v]) => Object.keys(v).length)
  .map(([k, v]) => `${k}: ${Object.entries(v).slice(0, top).map(([x, n]) => `${x} ${n}`).join(', ')}${Object.keys(v).length > top ? ', ...' : ''}`)
  .join(' · ');
// A list of ids, cut after `max`.
const ids = (xs, max = 12) => `${xs.slice(0, max).join(', ')}${xs.length > max ? ` and ${xs.length - max} more` : ''}`;

// ---------- the verbs ----------

// Each verb resolves to { code, data, text }: `data` is what --json prints, `text` what a person reads.
export const verbs = {
  async find(ctx, args, flags) {
    const filters = defined({
      kind: list(flags, 'kind'), media: list(flags, 'media'), shelf: list(flags, 'shelf'), tags: list(flags, 'tags'),
      licence: list(flags, 'licence'), alpha: bool(flags, 'alpha'), minW: num(flags, 'minW'), minH: num(flags, 'minH'),
      aspect: str(flags, 'aspect'), secMin: num(flags, 'secMin'), secMax: num(flags, 'secMax'), dark: bool(flags, 'dark'),
      hue: list(flags, 'hue'),
    });
    const q = args.join(' ').trim();
    if (!q && !Object.keys(filters).length) throw usage('find: need <words...> or a filter (asset ls lists everything)');
    const limit = num(flags, 'limit');
    let out;
    try { out = ctx.lib().search(defined({ q: q || undefined, ...filters, limit })); } catch (err) { throw usage(`find: ${err.message}`); }
    const asked = [q && `"${q}"`, ...Object.entries(filters).map(([k, v]) => `--${kebab(k)} ${Array.isArray(v) ? v.join(',') : v}`)].filter(Boolean).join(' ');
    if (!out.hits.length) {
      return { code: 1, data: out, text: `no asset matches ${asked} (${out.total} on shelves ${ctx.names()})\nthe library has ${facetLine(out.facets) || 'nothing'}\n` };
    }
    const w = Math.max(12, ...out.hits.map((h) => h.id.length)), indent = ' '.repeat(w + 1);
    const lines = [];
    for (const h of out.hits) {
      const r = h.record;
      lines.push(`${pad(h.id, w)} ${pad(r.kind, 7)} ${pad(h.shelf, 8)} ${pad(r.licence, 9)} ${factsOf(r)}`.trimEnd());
      if (h.why.length) lines.push(`${indent}why: ${h.why.join(', ')}`);
      if (r.credit) lines.push(`${indent}${r.credit}`);
      if (h.thumb) lines.push(`${indent}${ctx.rel(h.thumb)}`);
    }
    lines.push(`${out.count} of ${out.total}${out.count > out.hits.length ? `, the first ${out.hits.length} shown (--limit)` : ''} · ${facetLine(out.facets)}`);
    lines.push('asset show <id> for the record and how davidup and hdf take it');
    return { code: 0, data: out, text: `${lines.join('\n')}\n` };
  },

  async show(ctx, args, flags) {
    if (args.length !== 1) throw usage('show: need one <id> (or sha:<hex>)');
    const lib = ctx.lib(), shelf = str(flags, 'shelf');
    const loc = lib.locate(args[0]);
    const s = shelf ? lib.shelf(shelf) : lib.shelf(loc.shelf);
    const entry = s.entry(loc.id), record = shelf ? { ...entry, id: loc.id, shelf: s.name } : lib.get(args[0]);
    const blob = s.blobPath(entry), thumb = [s.thumbPath(entry), join(ctx.thumbCache, `${entry.sha}.png`)].find((p) => existsSync(p)) ?? null;
    const same = lib.holders(entry.sha).filter((h) => !(h.shelf === s.name && h.id === loc.id));
    const into = lib.made(loc.id).map((r) => ({ id: r.id, kind: r.kind, shelf: r.shelf, tool: r.made?.tool }));
    const from = (record.made?.from ?? []).map((id) => (lib.has(id) ? { id, kind: lib.get(id).kind, shelf: lib.get(id).shelf } : { id, missing: true }));
    const use = lib.use(loc.id);
    const data = { record, shelf: s.name, shadowed: record.shadowed ?? [], blob: existsSync(blob) ? blob : null, thumb, same, made: { from, into }, use };

    const row = (k, v) => (v === undefined || v === null || v === '' ? null : `  ${pad(k, 9)} ${v}`);
    const d = use.davidup, h = use.hdf;
    const lines = [
      `${loc.id} · ${record.kind}${record.media ? ` (${record.media})` : ''} · ${s.name}${record.shadowed?.length ? `, shadows ${record.shadowed.join(', ')}` : ''}`,
      row('name', record.name),
      row('desc', record.desc || '(none: asset desc)'),
      row('tags', record.tags?.length ? record.tags.join(', ') : '(none: asset tag)'),
      row('licence', record.licence),
      row('credit', record.credit),
      row('source', record.source),
      row('facts', factsOf(record)),
      row('colours', record.colours?.slice(0, 5).map((c) => `${c.hex} ${Math.round(c.area * 100)}%`).join('  ')),
      row('sha', `${short(entry.sha)}${isLegacySha(entry.sha) ? ' (sha1: asset migrate --sha256)' : ''}`),
      row('blob', existsSync(blob) ? `${ctx.rel(blob)}  ${kb(entry.bytes ?? readFileSync(blob).length)}` : `MISSING: ${ctx.rel(blob)}`),
      row('thumb', thumb ? ctx.rel(thumb) : `none yet (asset thumb ${loc.id})`),
      row('added', [entry.added, entry.by && `by ${entry.by}`, entry.file && `from ${entry.file}`].filter(Boolean).join(' ')),
      row('same', same.length ? `bytes as ${same.map((x) => `${x.shelf}:${x.id}`).join(', ')}` : null),
      row('made', record.made ? `by ${record.made.tool}${from.length ? ` from ${from.map((f) => (f.missing ? `${f.id} (on no shelf)` : `${f.id} (${f.kind})`)).join(', ')}` : ''}${record.made.at ? ` at ${record.made.at}` : ''}` : null),
      row('made into', into.length ? into.map((r) => `${r.id} (${r.kind}${r.tool ? `, ${r.tool}` : ''})`).join(', ') : null),
      row('davidup', d ? `${d.tool} ${JSON.stringify(d.args)}${d.via ? `\n            via ${d.via}${d.also ? `; also ${d.also.join(', ')}` : ''}` : ''}` : `(none${['puppet', 'hand', 'motif'].includes(record.kind) ? ` yet: davidup takes a ${record.kind} through a sprite sheet, font or image made from it, and nothing is` : `: davidup does not take a ${record.kind}`})`),
      row('hdf', !h ? '(none: hdf does not read this kind)' : h.cli ?? [h.code, h.take && `take  ${h.take}`, h.look && `look  ${h.look}`].filter(Boolean).join('\n            ')),
    ].filter(Boolean);
    return { code: 0, data, text: `${lines.join('\n')}\n` };
  },

  async add(ctx, args, flags) {
    if (args.length !== 1) throw usage('add: need one <file>');
    const kind = str(flags, 'kind'), name = str(flags, 'name');
    if (!KINDS.includes(kind)) throw usage(`add: --kind ${kind ?? '<kind>'} (expected ${KINDS.join(' | ')})`);
    if (!name) throw usage('add: need --name <name>');
    const id = str(flags, 'id') ?? idOf(name);
    if (!ID.test(id)) throw usage(`add: '${id}' is not an id (lower-case letters, digits and dashes); give --id`);
    const licence = str(flags, 'licence') ?? 'unknown';
    if (!LICENCES.includes(licence)) throw usage(`add: --licence ${licence} (expected ${LICENCES.join(' | ')})`);
    const abs = resolve(ctx.cwd, args[0]);
    if (!existsSync(abs)) throw usage(`add: no such file '${args[0]}'`);
    let extra = {};
    if (flags.with !== undefined) {
      try { extra = JSON.parse(str(flags, 'with')); } catch (err) { throw usage(`add: --with is not JSON (${err.message})`); }
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw usage('add: --with must be a JSON object of entry fields');
    }

    const lib = ctx.lib(), bytes = readFileSync(abs);
    const entry = defined({
      id, kind, name, file: basename(abs), licence, credit: str(flags, 'credit') ?? '', source: str(flags, 'source') ?? '',
      tags: list(flags, 'tags') ?? [], desc: str(flags, 'desc'), family: str(flags, 'family'),
    });
    const out = await addAsset(lib, { bytes, file: abs, entry, extra, shelf: str(flags, 'shelf') }, ctx.host);
    const e = out.entry, warnings = [...out.warnings];
    if (licence === 'unknown') warnings.push(`'${id}' has licence unknown; asset check flags it until it is added again with --licence`);
    const was = !out.replaced ? 'new' : out.replaced.sha === e.sha ? 'unchanged bytes' : `replaces ${short(out.replaced.sha)}`;
    return {
      code: 0, warnings,
      data: { id, shelf: out.shelf, entry: e, path: out.path, created: out.created, replaced: out.replaced, warnings },
      text: `${id}  ${kind}  ${short(e.sha)}.${e.ext}  ${e.licence}  on ${out.shelf} (${was})\n${ctx.rel(out.path)}  ${kb(e.bytes)}${factsOf(e) ? `  ${factsOf(e)}` : ''}\n`,
    };
  },

  async tag(ctx, args, flags) {
    const [id, ...ops] = args;
    if (!id || !ops.length) throw usage('tag: need <id> and +tag / -tag');
    const lib = ctx.lib(), shelf = str(flags, 'shelf') ?? lib.locate(id).shelf, before = lib.shelf(shelf).entry(id).tags ?? [];
    let tags = [...before];
    for (const op of ops) {
      const drop = op.startsWith('-');
      for (const t of op.replace(/^[+-]/, '').split(',').map((x) => x.trim()).filter(Boolean)) {
        if (drop) tags = tags.filter((x) => x !== t);
        else if (!tags.includes(t)) tags.push(t);
      }
    }
    const out = lib.update(id, { tags }, { shelf, fields: ctx.host.fields });
    const added = tags.filter((t) => !before.includes(t)), dropped = before.filter((t) => !tags.includes(t));
    const change = [...added.map((t) => `+${t}`), ...dropped.map((t) => `-${t}`)].join(' ') || 'unchanged';
    return { code: 0, data: out, text: `${id}  tags: ${tags.join(', ') || '(none)'}  on ${out.shelf} (${change})\n` };
  },

  async desc(ctx, args, flags) {
    const [id, ...words] = args;
    if (!id || !words.length) throw usage('desc: need <id> and the line ("" removes it)');
    const line = words.join(' ').trim();
    const lib = ctx.lib(), shelf = str(flags, 'shelf') ?? lib.locate(id).shelf;
    const out = lib.update(id, { desc: line || null }, { shelf, fields: ctx.host.fields });
    return { code: 0, data: out, text: `${id}  desc: ${line ? JSON.stringify(line) : '(removed)'}  on ${out.shelf}\n` };
  },

  async rm(ctx, args, flags) {
    if (!args.length) throw usage('rm: need <id...>');
    const lib = ctx.lib(), shelf = str(flags, 'shelf'), done = [], lines = [];
    for (const id of args) {
      const out = lib.remove(id, defined({ shelf }));
      done.push(out);
      lines.push(`removed ${id} from ${out.shelf}${out.removed.length ? `: ${out.removed.map(ctx.rel).join(', ')}` : ' (its blob is shared, kept)'}`);
      if (lib.has(id)) lines.push(`  ${id} now resolves to ${lib.locate(id).shelf}`);
    }
    return { code: 0, data: done, text: `${lines.join('\n')}\n` };
  },

  async mv(ctx, args, flags) {
    if (args.length !== 1) throw usage('mv: need one <id> and --to <shelf>');
    const to = str(flags, 'to');
    if (!to) throw usage('mv: need --to <shelf>');
    const out = ctx.lib().move(args[0], to, defined({ from: str(flags, 'from'), fields: ctx.host.fields }));
    return { code: 0, data: out, text: `${out.id}  ${out.from} -> ${out.to}  ${short(out.entry.sha)}.${out.entry.ext}\n${ctx.rel(out.path)}\n` };
  },

  async gc(ctx, args, flags) {
    const dry = !!bool(flags, 'dry'), shelf = str(flags, 'shelf');
    const out = ctx.lib().gc(defined({ shelf, dry }));
    if (!out.length) return { code: 0, data: out, text: `nothing to collect on ${shelf ?? ctx.names()}\n` };
    const total = out.reduce((n, g) => n + g.bytes, 0);
    const lines = out.map((g) => `${dry ? 'would delete' : 'deleted'}  ${pad(g.shelf, 8)} ${ctx.rel(g.path)}  ${kb(g.bytes)}`);
    lines.push(`${out.length} file${out.length > 1 ? 's' : ''}, ${kb(total)}${dry ? ' (dry run: nothing deleted)' : ''}`);
    return { code: 0, data: out, text: `${lines.join('\n')}\n` };
  },

  async thumb(ctx, args, flags) {
    const lib = ctx.lib(), shelf = str(flags, 'shelf');
    const refs = flags.all ? lib.ids.filter((id) => !shelf || lib.locate(id).shelf === shelf) : args;
    if (!refs.length) throw usage(flags.all ? `thumb: no asset on ${shelf ?? ctx.names()}` : 'thumb: need <id...> or --all');
    const done = [], lines = [], warnings = [];
    const w = Math.max(...refs.map((r) => r.length));
    for (const ref of refs) {
      const pv = await lib.preview(ref, { force: !!bool(flags, 'force') });
      done.push({ id: pv.id, shelf: pv.shelf, path: pv.path, by: pv.by, cached: pv.cached });
      warnings.push(...pv.warnings);
      lines.push(`${pad(ref, w)}  ${pv.cached ? 'cached' : 'drawn '}  ${pad(pv.by, 14)} ${pv.path ? ctx.rel(pv.path) : '(not written)'}`);
    }
    return { code: 0, data: done, warnings, text: `${lines.join('\n')}\n` };
  },

  async sheet(ctx, args, flags) {
    if (!args.length) throw usage('sheet: need <id...>');
    const out = resolve(ctx.cwd, str(flags, 'out') ?? 'asset-sheet.png');
    const s = await ctx.lib().sheet(args, defined({ cols: num(flags, 'cols'), cell: num(flags, 'cell'), force: bool(flags, 'force'), out }));
    const data = { path: s.path, width: s.width, height: s.height, cols: s.cols, rows: s.rows, cells: s.cells };
    return { code: 0, data, warnings: s.warnings, text: `${ctx.rel(s.path)}  ${s.width}×${s.height}, ${s.cols} across, ${s.rows} down: ${s.cells.map((c) => c.id).join(', ')}\n` };
  },

  async ls(ctx, args, flags) {
    const lib = ctx.lib(), shelf = str(flags, 'shelf'), kinds = list(flags, 'kind');
    if (kinds) for (const k of kinds) if (!KINDS.includes(k)) throw usage(`ls: --kind ${k} (expected ${KINDS.join(' | ')})`);
    const shelves = shelf ? [lib.shelf(shelf)] : lib.shelves;
    const data = [], lines = [];
    for (const s of shelves) {
      const rows = s.ids.map((id) => ({ id, entry: s.entries.get(id) })).filter((r) => !kinds || kinds.includes(r.entry?.kind));
      const out = rows.map(({ id, entry }) => {
        const winner = lib.locate(id);
        return { id, kind: entry?.kind, licence: entry?.licence, facts: factsOf(entry ?? {}), shadowedBy: winner.shelf !== s.name ? winner.shelf : null, shadows: winner.shelf === s.name ? winner.shadowed : [] };
      });
      data.push({ shelf: s.name, root: s.root, count: out.length, entries: out });
      lines.push(`${s.name}  ${ctx.rel(s.root)}  ${out.length} asset${out.length === 1 ? '' : 's'}${kinds ? ` (${kinds.join(', ')})` : ''}${existsSync(s.root) ? '' : ' (no such directory yet)'}`);
      const w = Math.max(12, ...out.map((r) => r.id.length));
      for (const r of out) {
        const note = r.shadowedBy ? `  (shadowed by ${r.shadowedBy})` : r.shadows.length ? `  (shadows ${r.shadows.join(', ')})` : '';
        lines.push(`  ${pad(r.id, w)} ${pad(r.kind, 7)} ${pad(r.licence, 9)} ${r.facts}${note}`.trimEnd());
      }
    }
    return { code: 0, data, text: `${lines.join('\n')}\n` };
  },

  async check(ctx, args, flags) {
    const lib = ctx.lib(), shelf = str(flags, 'shelf');
    if (shelf) lib.shelf(shelf);
    const findings = check(lib, defined({ shelves: shelf ? [shelf] : undefined, fields: ctx.host.fields, thumbCache: ctx.thumbCache }));
    const by = (level) => findings.filter((f) => f.level === level).length;
    const counts = Object.fromEntries(LEVELS.map((l) => [l, by(l)]));
    const on = (shelf ? [lib.shelf(shelf)] : lib.shelves).map((s) => `${s.name} (${s.ids.length})`).join(', ');
    const lines = [];
    // Errors one line each; a warning or note that many entries share is one line listing them.
    const groups = [];
    for (const f of findings) {
      const g = groups.find((x) => f.level !== 'error' && x.level === f.level && x.rule === f.rule && x.shelf === f.shelf);
      if (g) g.items.push(f); else groups.push({ level: f.level, rule: f.rule, shelf: f.shelf, items: [f] });
    }
    const w = Math.max(8, ...lib.shelves.map((s) => s.name.length));
    for (const g of groups) {
      const head = `${pad(g.level, 5)}  ${pad(g.rule, 9)}  ${pad(g.shelf, w)}`;
      if (g.items.length > 3) lines.push(`${head}  ${g.items.length} entries: ${ids(g.items.map((f) => f.id ?? basename(f.path)))}${NEXT[g.rule] ? `  (${NEXT[g.rule]})` : ''}`);
      else for (const f of g.items) lines.push(`${head}  ${f.id ? `${f.id}: ` : ''}${f.detail}`);
    }
    lines.push(findings.length
      ? `${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}, ${counts.note} note${counts.note === 1 ? '' : 's'} on ${on}`
      : `clean: ${on}`);
    return { code: counts.error ? 1 : 0, data: { counts, findings }, text: `${lines.join('\n')}\n` };
  },

  async migrate(ctx, args, flags) {
    if (!flags.sha256) throw usage('migrate: say which migration (--sha256)');
    if (args.length !== 1) throw usage('migrate: need one <shelf> (a shelf name or a directory)');
    const lib = ctx.lib(), named = lib.shelves.find((s) => s.name === args[0]);
    const dir = named ? null : resolve(ctx.cwd, args[0]);
    if (!named && !existsSync(join(dir, 'catalogue.json'))) throw usage(`migrate: '${args[0]}' is neither a shelf (${ctx.names()}) nor a directory with a catalogue.json`);
    const shelf = named ?? readShelf(dir), dry = !!bool(flags, 'dry');
    const out = migrateSha256(shelf, { dry });
    if (!out.blobs.length) return { code: 0, data: out, text: `${shelf.name}: no sha1 entry, nothing to migrate\n` };
    const lines = out.blobs.map((b) => `${short(b.from)} -> ${short(b.to)}.${b.ext}  ${ids(b.ids, 4)}${b.rewrote.length ? `  (names ${b.rewrote.map(short).join(', ')}: rewritten)` : ''}`);
    const n = out.blobs.reduce((k, b) => k + b.ids.length, 0);
    lines.push(`${out.blobs.length} blob${out.blobs.length === 1 ? '' : 's'}, ${n} entr${n === 1 ? 'y' : 'ies'} on ${shelf.name}${dry ? ' (dry run: nothing written)' : ' rehashed as sha256'}`);
    return { code: 0, data: out, text: `${lines.join('\n')}\n` };
  },
};

// What to run about a grouped finding.
const NEXT = {
  sha1: 'asset migrate --sha256 <shelf>',
  licence: 'asset add again with --licence',
  orphan: 'asset gc',
  thumb: 'asset thumb --all',
  desc: 'asset desc <id> "<line>"',
  tags: 'asset tag <id> +tag',
  shadow: 'asset rm --shelf, or asset mv',
  duplicate: 'asset mv collapses them',
};

// ---------- main ----------

// One verb, run: resolves to { code, data, text, warnings } and prints nothing; throws a UsageError for a bad
// command line and an Error for a refused read or write. `argv` is the verb's arguments, or { args, flags }
// already parsed (parseArgs). A host that has opened its own library (hdf's store with --root) passes it as
// `host.library`; otherwise the standard shelves are opened, with --project.
export async function run(verb, argv = [], host = {}) {
  if (!VERBS.includes(verb)) throw usage(`unknown verb '${verb}'`);
  const { args, flags } = Array.isArray(argv) ? parseArgs(argv) : argv;
  const cwd = host.cwd ?? process.cwd(), project = str(flags, 'project');
  let lib = host.library ?? null;
  const rel = (p) => { const r = relative(cwd, p); return r && !r.startsWith('..') ? r : p; };
  const ctx = {
    host, cwd, rel, thumbCache: host.thumbCache ?? THUMB_CACHE,
    lib: () => (lib ??= openLibrary(defined({
      shelves: standardShelves(defined({ project: project && resolve(cwd, project), env: host.env ?? process.env, home: host.home })),
      previewers: host.previewers, thumbCache: host.thumbCache,
    }))),
    names: () => ctx.lib().shelves.map((s) => s.name).join(', '),
  };
  return verbs[verb](ctx, args, flags);
}

// Runs one command line; resolves to the exit code (0 fine, 1 nothing found or a check error or a refused
// write, 2 a usage error). Never throws.
export async function main(argv = process.argv.slice(2), host = {}) {
  const out = host.out ?? process.stdout, err = host.err ?? process.stderr;
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    const only = verb === 'help' && rest[0];
    if (only && !VERBS.includes(only)) { err.write(`asset: unknown verb '${only}'\n\n${USAGE}`); return 2; }
    out.write(only ? usageOf(only) : USAGE);
    return 0;
  }
  if (!VERBS.includes(verb)) { err.write(`asset: unknown verb '${verb}'\n\n${USAGE}`); return 2; }
  try {
    const parsed = parseArgs(rest);
    if (parsed.flags.help) { out.write(usageOf(verb)); return 0; }
    if (host.discover) {
      const found = await loadHosts(defined({ env: host.env, cwd: host.cwd }));
      for (const w of found.warnings) err.write(`warning: ${w}\n`);
      host = { ...host, previewers: { ...found.previewers, ...host.previewers } };
    }
    const res = await run(verb, parsed, host);
    for (const w of res.warnings ?? []) err.write(`warning: ${w}\n`);
    out.write(parsed.flags.json ? `${JSON.stringify(res.data, null, 2)}\n` : res.text);
    return res.code ?? 0;
  } catch (e) {
    if (e instanceof UsageError) { err.write(`asset: ${e.message}\n(asset help ${verb} for its usage)\n`); return 2; }
    err.write(`asset: ${e?.message ?? e}\n`);
    return 1;
  }
}

// The USAGE lines of one verb: its own line and the indented lines under it.
export function usageOf(verb) {
  const lines = [];
  let mine = false;
  for (const line of USAGE.split('\n')) {
    const head = /^ {2}(\S+)/.exec(line);
    if (head) mine = head[1] === verb;
    else if (!/^ {4,}\S/.test(line)) mine = false;
    if (mine) lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

// Run only when executed (also through the npm bin symlink), not when imported by tests or a host.
const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main(process.argv.slice(2), { discover: true }).then((code) => { process.exitCode = code; });

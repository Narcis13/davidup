// What is wrong with the shelves (asset-library plan §5 A6, `asset check`): every finding a sentence with a
// level, a rule, the shelf and the id it is about.
//
//   error  id         an id outside the rule (lower case, digits, dashes; pack:<cel>)
//   error  invalid    an entry validate() refuses
//   error  blob       an entry whose blob is missing
//   error  sha        a blob whose bytes do not hash to its entry's sha
//   error  size       with `house`: a house blob over 5 MB that is not `made` and git-ignored (plan H4)
//   error  ignored    with `house`: a house blob git ignores whose entry is not `made`, so a checkout lacks it
//   error  budget     with `house`: the house blobs that ship (in git and the npm package) over 15 MB
//   warn   sha1       a 40-hex sha1 from before H1 (`asset migrate --sha256` rehashes the shelf)
//   warn   licence    licence unknown
//   warn   credit     CC-BY or CC-BY-SA with no credit (davidup's W_ASSET_CREDIT)
//   warn   duplicate  the same bytes on two shelves (`move` collapses them)
//   warn   shadow     an id an earlier shelf holds too, so this one is never read
//   warn   orphan     a blob no entry points at (`gc` deletes it)
//   note   thumb      no preview drawn yet (`asset thumb`)
//   note   desc       no one-line description, so search has less to go on
//   note   tags       no tags
//   note   legacy     with `legacy`: a file in davidup's old library (<root>/assets, <root>/fonts) on no shelf,
//                     with the `asset add` line that brings it onto the user's pool (D5)
//
// Reading only: nothing is written. Blobs are hashed once each, so a check reads every byte on the shelves.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { fontInfo } from './probe.js';
import { ID, SCHEMAS, isLegacySha, validate } from './record.js';

export const LEVELS = Object.freeze(['error', 'warn', 'note']);
export const RULES = Object.freeze({
  id: 'error', invalid: 'error', blob: 'error', sha: 'error', size: 'error', ignored: 'error', budget: 'error',
  sha1: 'warn', licence: 'warn', credit: 'warn', duplicate: 'warn', shadow: 'warn', orphan: 'warn',
  thumb: 'note', desc: 'note', tags: 'note', legacy: 'note',
});
const ORDER = Object.keys(RULES);

// Every finding on a library's shelves (or the ones named in `shelves`), errors first, then by rule, shelf
// and id. `fields` is validate()'s per-kind checks; `thumbCache` the machine-wide thumb cache (a read-only
// shelf's thumbs are there); `legacy` davidup's old library root, whose loose files are offered for import
// (legacyFindings); `house` (true, or { maxBlob, budget, ignored }) adds the house shelf's size rules
// (houseFindings). Each finding is { level, rule, shelf, id, detail } (`path` for an orphan, a legacy file or a
// house blob).
export function check(lib, { shelves, fields, thumbCache, legacy, house } = {}) {
  const on = lib.shelves.filter((s) => !shelves || shelves.includes(s.name));
  const out = [], hashed = new Map();
  const add = (rule, shelf, id, detail, more) => out.push({ level: RULES[rule], rule, shelf, id, detail, ...more });
  const hashOf = (path, legacy) => {
    const key = `${legacy ? 'sha1' : 'sha256'}:${path}`;
    if (!hashed.has(key)) hashed.set(key, createHash(legacy ? 'sha1' : 'sha256').update(readFileSync(path)).digest('hex'));
    return hashed.get(key);
  };

  for (const s of on) {
    for (const id of s.ids) {
      const e = s.entries.get(id), bad = validate(id, e, { fields });
      const idBad = bad.filter((m) => m.startsWith('id '));
      if (idBad.length) add('id', s.name, id, idBad.join('; '));
      if (bad.length > idBad.length) add('invalid', s.name, id, bad.filter((m) => !m.startsWith('id ')).join('; '));
      if (!e || typeof e !== 'object') continue;

      const legacy = isLegacySha(e.sha);
      if (legacy) add('sha1', s.name, id, `sha ${e.sha.slice(0, 12)} is sha1`);
      if (typeof e.sha === 'string' && typeof e.ext === 'string') {
        const blob = s.blobPath(e);
        if (!existsSync(blob)) add('blob', s.name, id, `blob ${e.sha.slice(0, 12)}….${e.ext} is missing from ${join(s.root, 'blobs')}`);
        else if (hashOf(blob, legacy) !== e.sha) add('sha', s.name, id, `blob ${e.sha.slice(0, 12)}….${e.ext} hashes to ${hashOf(blob, legacy).slice(0, 12)}…`);
      }
      if (e.licence === 'unknown') add('licence', s.name, id, 'licence unknown');
      if ((e.licence === 'CC-BY' || e.licence === 'CC-BY-SA') && !String(e.credit ?? '').trim()) add('credit', s.name, id, `${e.licence} with no credit`);
      if (lib.has(id) && lib.locate(id).shelf !== s.name) add('shadow', s.name, id, `shadowed by ${lib.locate(id).shelf}`);
      if (typeof e.sha === 'string' && !existsSync(s.thumbPath(e)) && !(thumbCache && existsSync(join(thumbCache, `${e.sha}.png`)))) add('thumb', s.name, id, 'no thumb');
      if (!String(e.desc ?? '').trim()) add('desc', s.name, id, 'no desc');
      if (!Array.isArray(e.tags) || !e.tags.length) add('tags', s.name, id, 'no tags');
    }
    for (const path of s.orphans()) add('orphan', s.name, null, `blob ${path.slice(path.lastIndexOf('/') + 1)} has no entry`, { path });
  }

  // The same bytes on two shelves: one finding per sha, on the first shelf holding it.
  const bySha = new Map();
  for (const s of lib.shelves) {
    for (const id of s.ids) {
      const h = s.entries.get(id)?.sha;
      if (typeof h !== 'string') continue;
      if (!bySha.has(h)) bySha.set(h, []);
      bySha.get(h).push({ shelf: s.name, id });
    }
  }
  for (const holders of bySha.values()) {
    if (new Set(holders.map((x) => x.shelf)).size < 2 || !on.some((s) => holders.some((x) => x.shelf === s.name))) continue;
    add('duplicate', holders[0].shelf, holders[0].id, `same bytes as ${holders.slice(1).map((x) => `${x.shelf}:${x.id}`).join(', ')}`);
  }

  if (legacy) out.push(...legacyFindings(lib, legacy));
  if (house && on.some((s) => s.name === 'house')) out.push(...houseFindings(lib.shelf('house'), house === true ? {} : house).findings);

  const shelfAt = Object.fromEntries(lib.shelves.map((s, i) => [s.name, i]));
  return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule)
    || (shelfAt[a.shelf] ?? -1) - (shelfAt[b.shelf] ?? -1) || String(a.id ?? a.path).localeCompare(String(b.id ?? b.path)));
}

// ---------- house (H4) ----------

// The house shelf is in git and in davidup's npm package (package.json#files: assets/catalogue.json,
// assets/blobs), so what it holds is what every checkout and every install carries. A blob over HOUSE_BLOB_MAX
// is kept only when its entry is `made` (`asset remake` rebuilds it) and git ignores it; the blobs that ship
// together stay under HOUSE_BUDGET.
export const HOUSE_BLOB_MAX = 5 * 1024 * 1024;
export const HOUSE_BUDGET = 15 * 1024 * 1024;

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// The paths among `paths` (files under `root`) that git ignores, by one `git check-ignore`; none outside a work
// tree or without git, where nothing is ignored.
export function gitIgnored(root, paths) {
  if (!paths.length) return new Set();
  const r = spawnSync('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: paths.map((p) => relative(root, p)).join('\0') });
  if (r.status !== 0 || !r.stdout) return new Set();
  return new Set(r.stdout.toString('utf8').split('\0').filter(Boolean).map((p) => join(root, p)));
}

// The size rules on one shelf (the house): { findings, bytes, blobs } where `bytes` is what the `blobs` that
// ship weigh. A blob several entries share is counted once. `ignored(root, paths)` is gitIgnored unless given.
export function houseFindings(shelf, { maxBlob = HOUSE_BLOB_MAX, budget = HOUSE_BUDGET, ignored = gitIgnored } = {}) {
  const blobs = new Map();
  for (const id of shelf.ids) {
    const e = shelf.entries.get(id);
    if (!e || typeof e.sha !== 'string' || typeof e.ext !== 'string') continue;
    const path = shelf.blobPath(e);
    if (!existsSync(path)) continue;
    const b = blobs.get(path) ?? { path, bytes: statSync(path).size, ids: [], made: true };
    b.ids.push(id);
    b.made &&= !!e.made && typeof e.made === 'object';
    blobs.set(path, b);
  }
  const off = ignored(shelf.root, [...blobs.keys()]), findings = [];
  const add = (rule, id, detail, path) => findings.push({ level: RULES[rule], rule, shelf: shelf.name, id, detail, ...(path ? { path } : {}) });
  let bytes = 0, shipped = 0;
  for (const b of blobs.values()) {
    const name = `blob ${basename(b.path).slice(0, 12)}….${b.path.slice(b.path.lastIndexOf('.') + 1)}`;
    if (off.has(b.path) && !b.made) add('ignored', b.ids[0], `${name} is ignored by git but not made, so a checkout has no copy`, b.path);
    if (off.has(b.path) && b.made) continue;
    bytes += b.bytes; shipped++;
    if (b.bytes > maxBlob) add('size', b.ids[0], `${name} is ${mb(b.bytes)}, over ${mb(maxBlob)}: make it (\`made\`) and git-ignore it, or keep it off the house`, b.path);
  }
  if (bytes > budget) add('budget', null, `the ${shipped} blobs that ship weigh ${mb(bytes)}, over the ${mb(budget)} budget`);
  return { findings, bytes, blobs: shipped, budget };
}

// ---------- legacy (D5) ----------

// Where davidup kept assets before the library: the editor's uploads in <root>/assets and the seed's fonts in
// <root>/fonts, <root> being $DAVIDUP_LIBRARY or ~/.davidup/library.
export const LEGACY_DIRS = Object.freeze(['assets', 'fonts']);
const DAVIDUP_KINDS = ['image', 'video', 'audio', 'font'];

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => !d.name.startsWith('.'))
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : [])).sort();
};

// What <root>/index.json says about a file, by its path under <root> (`global:fonts/x.woff2` -> fonts/x.woff2).
function indexed(root) {
  const out = new Map();
  let idx;
  try { idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')); } catch { return out; }
  for (const e of [...(Array.isArray(idx?.assets) ? idx.assets : []), ...(Array.isArray(idx?.fonts) ? idx.fonts : [])]) {
    const src = e && typeof e === 'object' ? [e.src, e.url, e.path].find((v) => typeof v === 'string' && v.startsWith('global:')) : null;
    if (src) out.set(src.slice('global:'.length), e);
  }
  return out;
}

// A `legacy` note for every file under <root>/assets and <root>/fonts whose bytes are on none of the library's
// shelves, its detail the `asset add` line that puts it on the user's pool: the kind from the extension, the
// id, name and a font's family from the index.json entry naming the file, else from the file itself. A file
// whose extension is no davidup kind is listed without a line. Each is { level, rule, shelf: 'library', id:
// null, path, detail, kind, add }.
export function legacyFindings(lib, root) {
  const out = [], named = indexed(root);
  for (const sub of LEGACY_DIRS) {
    for (const path of walk(join(root, sub))) {
      const bytes = readFileSync(path);
      if (lib.has(`sha:${createHash('sha256').update(bytes).digest('hex')}`)) continue;
      const rel = [sub, ...relative(join(root, sub), path).split(sep)].join('/');
      const ext = extname(path).slice(1).toLowerCase().replace(/^jpeg$/, 'jpg');
      const kind = DAVIDUP_KINDS.find((k) => SCHEMAS[k].exts.includes(ext)) ?? null;
      const finding = { level: RULES.legacy, rule: 'legacy', shelf: 'library', id: null, path, kind, add: null };
      if (!kind) { out.push({ ...finding, detail: `${rel} is on no shelf, and .${ext} is no kind davidup takes` }); continue; }
      const e = named.get(rel) ?? {};
      let family = kind === 'font' && typeof e.family === 'string' ? e.family : undefined;
      if (kind === 'font' && !family) try { family = fontInfo(bytes).family; } catch { family = undefined; }
      const name = [e.name, e.family, e.id].find((v) => typeof v === 'string' && v) ?? basename(path, extname(path));
      const add = ['asset', 'add', quote(path), '--kind', kind, '--name', quote(name),
        ...(typeof e.id === 'string' && ID.test(e.id) ? ['--id', e.id] : []),
        ...(kind === 'font' ? ['--family', quote(family ?? '<family>')] : []),
        '--licence', 'unknown', '--shelf', 'user'].join(' ');
      out.push({ ...finding, add, detail: `${rel} is on no shelf: ${add}` });
    }
  }
  return out;
}

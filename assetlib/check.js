// What is wrong with the shelves (asset-library plan §5 A6, `asset check`): every finding a sentence with a
// level, a rule, the shelf and the id it is about.
//
//   error  id         an id outside the rule (lower case, digits, dashes; pack:<cel>)
//   error  invalid    an entry validate() refuses
//   error  blob       an entry whose blob is missing
//   error  sha        a blob whose bytes do not hash to its entry's sha
//   warn   sha1       a 40-hex sha1 from before H1 (`asset migrate --sha256` rehashes the shelf)
//   warn   licence    licence unknown
//   warn   credit     CC-BY or CC-BY-SA with no credit (davidup's W_ASSET_CREDIT)
//   warn   duplicate  the same bytes on two shelves (`move` collapses them)
//   warn   shadow     an id an earlier shelf holds too, so this one is never read
//   warn   orphan     a blob no entry points at (`gc` deletes it)
//   note   thumb      no preview drawn yet (`asset thumb`)
//   note   desc       no one-line description, so search has less to go on
//   note   tags       no tags
//
// Reading only: nothing is written. Blobs are hashed once each, so a check reads every byte on the shelves.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLegacySha, validate } from './record.js';

export const LEVELS = Object.freeze(['error', 'warn', 'note']);
export const RULES = Object.freeze({
  id: 'error', invalid: 'error', blob: 'error', sha: 'error',
  sha1: 'warn', licence: 'warn', credit: 'warn', duplicate: 'warn', shadow: 'warn', orphan: 'warn',
  thumb: 'note', desc: 'note', tags: 'note',
});
const ORDER = Object.keys(RULES);

// Every finding on a library's shelves (or the ones named in `shelves`), errors first, then by rule, shelf
// and id. `fields` is validate()'s per-kind checks; `thumbCache` the machine-wide thumb cache (a read-only
// shelf's thumbs are there). Each finding is { level, rule, shelf, id, detail } (`path` for an orphan).
export function check(lib, { shelves, fields, thumbCache } = {}) {
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

  const shelfAt = Object.fromEntries(lib.shelves.map((s, i) => [s.name, i]));
  return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule)
    || shelfAt[a.shelf] - shelfAt[b.shelf] || String(a.id ?? a.path).localeCompare(String(b.id ?? b.path)));
}

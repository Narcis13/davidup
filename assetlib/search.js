// Search (asset-library plan §4): local, ranked, faceted, explainable.
//
//   search(records, { q: 'warm paper', media: 'raster', hue: 'warm', limit: 12 })
//   -> { count, total, facets, facetsOf, hits: [{ id, shelf, score, why, record }] }
//
// The query's words are folded (lower case, diacritics off), stop words dropped, and each word is looked up as
// a prefix in an index of the records' words. A record scores, for each query word, its best field hit:
// id 6, name 5, tags 4, desc 2, credit, source, kind and licence 1. A word found only through the synonym
// table (synonyms.json) scores 0.6 of its field's weight; a query that is the id adds 10. Filters are exact
// and every one must hold. Ties break on `added` (newest first), then id, so a test can pin an order.
//
// `why` is the hits themselves ("name: paper", "tags: animal (dog)", "colours: warm #efe6d4"), so an agent can
// tell a real match from a lucky prefix. Facets count the matches (all of them, not only the page), and when
// nothing matches they count the whole library instead, so the agent sees what there is.
//
// A host may replace the scorer (`rank`) with one that has seen an embedding; the result does not change shape.
import { readFileSync } from 'node:fs';
import { KINDS, LICENCES, MEDIA, mediaOf } from './record.js';

export const WEIGHTS = Object.freeze({ id: 6, name: 5, tags: 4, desc: 2, credit: 1, source: 1, kind: 1, licence: 1 });
export const EXACT_ID = 10;
export const SYNONYM = 0.6;

// query word -> the words it also finds (at SYNONYM of their field's weight). One way: `dog` finds `animal`,
// `animal` does not find `dog`. Keys and words are folded single words.
export const SYNONYMS = Object.freeze(
  Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('./synonyms.json', import.meta.url), 'utf8'))).filter(([k]) => k !== '_')),
);

// Words a query drops: they would prefix half the library and say nothing about an asset.
const STOP = new Set(['a', 'an', 'and', 'any', 'as', 'at', 'by', 'for', 'from', 'i', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'some', 'that', 'the', 'this', 'to', 'with']);

// Lower case, diacritics off: "Café" and "cafe" are one word, "Brîndușescu" is "brindusescu".
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// The words of a string: runs of letters and digits, folded.
export const tokenise = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// A query word's plain form, so "foxes" and "puppies" find what "fox" and "puppy" find.
function singular(w) {
  if (w.length < 4) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(x|z|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// ---------- colour facts ----------

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};

// The hue bands a `hue` filter names. A swatch whose chroma is under NEUTRAL (greys, near whites, near blacks)
// is `neutral`; any other has one band and is `warm` (pink, red, orange, yellow) or `cool` (the rest).
export const HUES = Object.freeze(['warm', 'cool', 'neutral', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']);
const NEUTRAL = 0.08;
const BANDS = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [165, 'green'], [195, 'cyan'], [255, 'blue'], [290, 'purple'], [345, 'pink'], [360, 'red']];
const WARM = new Set(['pink', 'red', 'orange', 'yellow']);

// The bands of one swatch: ['neutral'], or [band, 'warm' | 'cool']. Null for a hex that is not #rrggbb.
export function hueOf(hex) {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < NEUTRAL) return ['neutral'];
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const band = BANDS.find(([top]) => h < top)[1];
  return [band, WARM.has(band) ? 'warm' : 'cool'];
}

// The area-weighted mean CIE lightness (L*, 0..100) of a colours table, or null when it has none. Under 50 is
// dark: about where white text starts to out-contrast black on it.
export const DARK = 50;
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export function lightness(colours) {
  let sum = 0, area = 0;
  for (const s of Array.isArray(colours) ? colours : []) {
    const c = rgb(s?.hex);
    if (!c || !(s.area > 0)) continue;
    const y = 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
    sum += s.area * (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
    area += s.area;
  }
  return area > 0 ? sum / area : null;
}

// Whether a record's pixels carry alpha: as it says; a cutout always does, a jpeg never does; else unknown.
const alphaOf = (r) => (typeof r.alpha === 'boolean' ? r.alpha : r.kind === 'cutout' ? true : r.ext === 'jpg' ? false : undefined);

// ---------- the query ----------

const KEYS = ['q', 'kind', 'media', 'shelf', 'tags', 'licence', 'alpha', 'minW', 'minH', 'aspect', 'secMin', 'secMax', 'dark', 'hue', 'limit', 'facets'];
export const LIMIT = 20;
// How many tags the facets list (the most common first); the other facets list every value.
export const TAG_FACETS = 30;

const list = (v) => (v === undefined || v === null ? null : (Array.isArray(v) ? v : [v]).map(String));
function oneOf(key, v, allowed) {
  const vs = list(v);
  if (!vs) return null;
  for (const x of vs) if (!allowed.includes(x)) throw new Error(`${key} '${x}': expected ${allowed.join(' | ')}`);
  return vs;
}
function num(key, v, { int = false, min = -Infinity } = {}) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || (int && !Number.isInteger(v)) || v < min) {
    throw new Error(`${key} ${JSON.stringify(v)}: expected ${int ? 'an integer' : 'a number'}${min > -Infinity ? ` >= ${min}` : ''}`);
  }
  return v;
}
function flag(key, v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean') throw new Error(`${key} ${JSON.stringify(v)}: expected true or false`);
  return v;
}
// "16:9", "16/9", "16x9" or a number (w / h).
function ratio(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(v));
  if (!m || !(+m[1] > 0 && +m[2] > 0)) throw new Error(`aspect ${JSON.stringify(v)}: expected "w:h" (16:9) or a number (w / h)`);
  return +m[1] / +m[2];
}

// A query as the search reads it: checked, every filter in one shape. A string is `{ q }`. Throws on a field
// it does not know or a value outside a closed list, naming what is allowed. `shelves`, when given, is the
// list a `shelf` filter must come from.
export function parseQuery(query = {}, { shelves } = {}) {
  if (typeof query === 'string') query = { q: query };
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('query: a string or { q, kind, media, ... }');
  for (const k of Object.keys(query)) if (!KEYS.includes(k)) throw new Error(`query field '${k}': expected ${KEYS.join(' | ')}`);
  const q = query.q === undefined || query.q === null ? '' : String(query.q).trim();
  const words = [...new Set(tokenise(q).filter((w) => !STOP.has(w)))];
  const minW = num('minW', query.minW, { min: 0 }), minH = num('minH', query.minH, { min: 0 });
  const secMin = num('secMin', query.secMin, { min: 0 }), secMax = num('secMax', query.secMax, { min: 0 });
  return {
    q, words,
    kind: oneOf('kind', query.kind, KINDS),
    media: oneOf('media', query.media, MEDIA),
    shelf: shelves ? oneOf('shelf', query.shelf, shelves) : list(query.shelf),
    tags: list(query.tags)?.map(fold) ?? null,
    licence: oneOf('licence', query.licence, LICENCES),
    alpha: flag('alpha', query.alpha),
    minW, minH, aspect: ratio(query.aspect), secMin, secMax,
    dark: flag('dark', query.dark),
    hue: oneOf('hue', query.hue, HUES),
    limit: num('limit', query.limit, { int: true, min: 0 }) ?? LIMIT,
    facets: flag('facets', query.facets) ?? true,
  };
}

// Every filter the query sets, as record -> false | true | a `why` line. All must pass.
function filtersOf(p) {
  const f = [];
  if (p.kind) f.push((r) => p.kind.includes(r.kind));
  if (p.media) f.push((r) => p.media.includes(r.media));
  if (p.shelf) f.push((r) => p.shelf.includes(r.shelf));
  if (p.licence) f.push((r) => p.licence.includes(r.licence));
  if (p.tags) f.push((r) => { const t = new Set((r.tags ?? []).map(fold)); return p.tags.every((x) => t.has(x)); });
  if (p.alpha !== null) f.push((r) => alphaOf(r) === p.alpha);
  if (p.minW !== null) f.push((r) => typeof r.w === 'number' && r.w >= p.minW);
  if (p.minH !== null) f.push((r) => typeof r.h === 'number' && r.h >= p.minH);
  if (p.aspect !== null) {
    f.push((r) => {
      if (!(r.w > 0 && r.h > 0)) return false;
      const a = r.w / r.h;
      return Math.abs(a / p.aspect - 1) <= 0.02 && `aspect: ${+a.toFixed(3)}`;
    });
  }
  if (p.secMin !== null) f.push((r) => typeof r.sec === 'number' && r.sec >= p.secMin);
  if (p.secMax !== null) f.push((r) => typeof r.sec === 'number' && r.sec <= p.secMax);
  if (p.dark !== null) {
    f.push((r) => {
      const l = lightness(r.colours);
      return l !== null && (l < DARK) === p.dark && `colours: ${p.dark ? 'dark' : 'light'} (L* ${Math.round(l)})`;
    });
  }
  if (p.hue) {
    f.push((r) => {
      const dom = r.colours?.[0]?.hex, bands = hueOf(dom);
      const hit = bands && p.hue.find((h) => bands.includes(h));
      return !!hit && `colours: ${hit} ${dom}`;
    });
  }
  return f;
}

// ---------- the index ----------

// The words of each weighted field of a record.
function fieldWords(r) {
  return {
    id: tokenise(r.id), name: tokenise(r.name), tags: (r.tags ?? []).flatMap(tokenise), desc: tokenise(r.desc),
    credit: tokenise(r.credit), source: tokenise(r.source), kind: tokenise(r.kind), licence: tokenise(r.licence),
  };
}

// A prefix index over records ([{ id, shelf, ... }], the library's winners): every word, sorted, with the
// records and fields it occurs in. Built once; search() runs any number of queries against it.
export function searchIndex(records) {
  const recs = [...records].map((r) => (r.media !== undefined ? r : { ...r, media: MEDIA_OF[r.kind] }));
  const postings = new Map();   // word -> [[record index, field]]
  recs.forEach((r, i) => {
    for (const [field, ws] of Object.entries(fieldWords(r))) {
      for (const w of new Set(ws)) {
        if (!postings.has(w)) postings.set(w, []);
        postings.get(w).push([i, field]);
      }
    }
  });
  const words = [...postings.keys()].sort();

  // Every [record index, field, word] whose word begins with `t` (a word under 3 letters must be whole).
  const lookup = (t) => {
    if (t.length < 3) return (postings.get(t) ?? []).map(([i, f]) => [i, f, t]);
    let lo = 0, hi = words.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < t) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let k = lo; k < words.length && words[k].startsWith(t); k++) for (const [i, f] of postings.get(words[k])) out.push([i, f, words[k]]);
    return out;
  };

  // The built-in score of every record for some query words: index -> { score, why }.
  const scoreAll = (p) => {
    const best = new Map();   // index -> Map(query word -> { w, line })
    const hit = (qw, i, f, word, factor, via) => {
      const w = WEIGHTS[f] * factor;
      if (!best.has(i)) best.set(i, new Map());
      const cur = best.get(i).get(qw);
      // The heavier hit wins; at equal weight, the field listed first in WEIGHTS.
      if (cur && (cur.w > w || (cur.w === w && cur.order <= FIELD_ORDER[f]))) return;
      best.get(i).set(qw, { w, order: FIELD_ORDER[f], line: `${f}: ${word}${via ? ` (${via})` : ''}` });
    };
    for (const qw of p.words) {
      const forms = [...new Set([qw, singular(qw)])];
      for (const form of forms) for (const [i, f, word] of lookup(form)) hit(qw, i, f, word, 1);
      const syns = new Set(forms.flatMap((form) => SYNONYMS[form] ?? []));
      for (const s of syns) for (const [i, f, word] of lookup(s)) hit(qw, i, f, word, SYNONYM, qw);
    }
    // A query that is the id (words joined by dashes, or as typed: "pack:teapot") adds EXACT_ID, even when its
    // words were all dropped as stop words or too short to prefix.
    const idQuery = tokenise(p.q).join('-'), typed = fold(p.q);
    const out = new Map();
    for (const [i, per] of best) {
      const hits = [...per.values()];
      out.set(i, { score: hits.reduce((s, h) => s + h.w, 0), why: hits.map((h) => h.line) });
    }
    recs.forEach((r, i) => {
      if (r.id !== idQuery && r.id !== typed) return;
      const s = out.get(i) ?? { score: 0, why: [] };
      s.score += EXACT_ID;
      s.why.unshift(`id: ${r.id} (exact)`);
      out.set(i, s);
    });
    return out;
  };

  return {
    records: recs,
    words,
    // Runs a query (see parseQuery). `rank(record, query, { score })` replaces the built-in scorer when the
    // query has a `q`: it returns { score, why } or null (out), and `score()` is the built-in one for that
    // record, so a host can blend. `shelves` checks a `shelf` filter against the shelves there are.
    search(query, { rank, shelves } = {}) {
      const p = parseQuery(query, { shelves });
      const filters = filtersOf(p);
      const ranked = p.q !== '';
      const builtin = ranked ? scoreAll(p) : null;
      const matches = [];
      recs.forEach((r, i) => {
        const whyFilters = [];
        for (const f of filters) {
          const ok = f(r);
          if (!ok) return;
          if (typeof ok === 'string') whyFilters.push(ok);
        }
        if (!ranked) { matches.push({ r, score: 0, why: whyFilters }); return; }
        const s = rank ? rank(r, p, { score: () => builtin.get(i) ?? null }) : builtin.get(i);
        if (!s || !(s.score > 0)) return;
        matches.push({ r, score: round(s.score), why: [...(s.why ?? []), ...whyFilters] });
      });
      matches.sort(ranked
        ? (a, b) => b.score - a.score || String(b.r.added ?? '').localeCompare(String(a.r.added ?? '')) || cmp(a.r.id, b.r.id)
        : (a, b) => cmp(a.r.kind, b.r.kind) || cmp(a.r.id, b.r.id));
      const out = { count: matches.length, total: recs.length };
      if (p.facets) {
        out.facetsOf = matches.length ? 'hits' : 'all';
        out.facets = facetsOf(matches.length ? matches.map((m) => m.r) : recs);
      }
      // A copy of each record: the index keeps its own.
      out.hits = matches.slice(0, p.limit).map((m) => ({ id: m.r.id, shelf: m.r.shelf, score: m.score, why: m.why, record: { ...m.r } }));
      return out;
    },
  };
}

const MEDIA_OF = Object.fromEntries(KINDS.map((k) => [k, mediaOf(k)]));
const FIELD_ORDER = Object.fromEntries(Object.keys(WEIGHTS).map((f, i) => [f, i]));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Scores to 3 places, so sums of 0.6s compare equal when they are.
const round = (x) => Math.round(x * 1000) / 1000;

// Counts per kind, media, shelf and licence (each adds up to the records counted) and the TAG_FACETS most
// common tags; each facet's keys in order of count, then name.
export function facetsOf(records) {
  const count = (get) => {
    const m = new Map();
    for (const r of records) for (const v of get(r)) if (v !== undefined && v !== null) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  };
  const obj = (pairs) => Object.fromEntries(pairs);
  return {
    kind: obj(count((r) => [r.kind])),
    media: obj(count((r) => [r.media])),
    shelf: obj(count((r) => [r.shelf])),
    licence: obj(count((r) => [r.licence])),
    tags: obj(count((r) => [...new Set((r.tags ?? []).map(fold))]).slice(0, TAG_FACETS)),
  };
}

// One query over some records, without keeping the index.
export const search = (records, query, opts) => searchIndex(records).search(query, opts);

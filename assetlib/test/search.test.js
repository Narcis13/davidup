// A3: search -- ranked, faceted, explainable (asset-library plan §4, §5 A3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_ROOT, HUES, SYNONYMS, facetsOf, fold, hueOf, lightness, openLibrary, parseQuery, search, tokenise } from '../index.js';
import * as hdf from '../../handdrawn/core/assets.js';

// Three shelves, 31 entries, 30 records: the project's paper-warm shadows the house's (fixtures/search/generate.mjs).
const FIX = fileURLToPath(new URL('./fixtures/search/', import.meta.url));
const SHELVES = ['project', 'user', 'house'].map((name) => ({ name, root: join(FIX, name) }));
const lib = openLibrary({ shelves: SHELVES });
const ids = (out) => out.hits.map((h) => h.id);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('the fixture: 30 records on three shelves', () => {
  const out = lib.search({});
  assert.equal(out.total, 30);
  assert.equal(out.count, 30);
  assert.deepEqual(out.facets.shelf, { house: 25, project: 3, user: 2 });
  assert.equal(out.hits.length, 20, 'the default limit');
});

test('"paper": the three papers by id (newest first), then texture and stock through the synonym table', () => {
  const out = lib.search('paper');
  assert.deepEqual(ids(out), ['paper-warm', 'paper-kraft', 'paper-graph', 'linen', 'chalkboard']);
  assert.deepEqual(out.hits.map((h) => [h.score, h.why]), [
    [6, ['id: paper']], [6, ['id: paper']], [6, ['id: paper']],
    [2.4, ['tags: texture (paper)']],
    [0.6, ['kind: stock (paper)']],
  ]);
  // The winning record, from the project shelf, shadowing the house's.
  const warm = out.hits[0];
  assert.equal(warm.shelf, 'project');
  assert.deepEqual(warm.record.shadowed, ['house']);
  assert.equal(warm.record.desc, "the project's own warm paper, rougher");
  assert.equal(warm.path, join(FIX, 'project', 'blobs', `${warm.record.sha}.webp`));
  assert.equal(warm.thumb, null, 'no preview yet');
});

test('"warm paper": both words add up', () => {
  const out = lib.search('warm paper');
  assert.deepEqual(ids(out), ['paper-warm', 'paper-kraft', 'paper-graph', 'linen', 'chalkboard']);
  assert.deepEqual(out.hits[0].why, ['id: warm', 'id: paper']);
  assert.equal(out.hits[0].score, 12);
});

test('"dog": the one word hit, then what the synonym table finds', () => {
  const out = lib.search('dog');
  assert.deepEqual(out.hits.map((h) => [h.id, h.score, h.why]), [
    ['bit-dog', 6, ['id: dog']],
    ['terrier', 3.6, ['id: terrier (dog)']],
    ['horse', 2.4, ['tags: animal (dog)']],   // same score: the newer first
    ['fox', 2.4, ['tags: animal (dog)']],
  ]);
  assert.deepEqual(ids(lib.search('dogs')), ids(out), 'a plural finds what the word finds');
  assert.ok(SYNONYMS.dog.includes('animal'));
  assert.equal(SYNONYMS._, undefined, 'the note is not a synonym');
});

test('{ media: raster, alpha: true }: filters only, by kind then id', () => {
  const out = lib.search({ media: 'raster', alpha: true });
  assert.deepEqual(ids(out), ['helmet', 'mug', 'teapot', 'terrier', 'violin', 'cafe-sign', 'logo-mark']);
  assert.ok(out.hits.every((h) => h.score === 0));
});

test('{ q: fox, kind: [puppet] }: the exact id first, then a word in a desc; the fox video is not a puppet', () => {
  const out = lib.search({ q: 'fox', kind: ['puppet'] });
  assert.deepEqual(out.hits.map((h) => [h.id, h.score, h.why]), [
    ['fox', 16, ['id: fox (exact)', 'id: fox']],
    ['sam', 2, ['desc: fox']],
  ]);
  assert.deepEqual(ids(lib.search('fox')), ['fox', 'fox-wave', 'sam']);
  assert.deepEqual(ids(lib.search('pack:teapot')).slice(0, 2), ['pack:teapot', 'teapot'], 'an id as typed is exact');
});

test('facets count every match, and each facet but tags adds up to count', () => {
  for (const q of ['paper', 'dog', { media: 'raster' }, { q: 'object', limit: 1 }, { q: 'object', licence: ['CC0', 'CC-BY'] }, {}]) {
    const out = lib.search(q);
    assert.equal(out.facetsOf, 'hits', JSON.stringify(q));
    for (const f of ['kind', 'media', 'shelf', 'licence']) assert.equal(sum(out.facets[f]), out.count, `${JSON.stringify(q)} ${f}`);
  }
  const page = lib.search({ media: 'raster', limit: 3 });
  assert.equal(page.hits.length, 3);
  assert.equal(page.count, 15);
  assert.deepEqual(page.facets.kind, { cutout: 5, image: 5, stock: 5 });
  assert.deepEqual(Object.keys(page.facets.tags).slice(0, 4), ['object', 'met', 'paper', 'texture'], 'tags by count, then name');
  assert.equal(lib.search({ q: 'paper', facets: false }).facets, undefined);
});

test('no hits: hits [] and the facets of the whole library, so the agent sees what exists', () => {
  for (const q of ['zebra', { q: 'paper', kind: 'font' }, { minW: 10000 }, 'the']) {
    const out = lib.search(q);
    assert.deepEqual(out.hits, [], JSON.stringify(q));
    assert.equal(out.count, 0);
    assert.equal(out.total, 30);
    assert.equal(out.facetsOf, 'all');
    assert.deepEqual(out.facets, lib.search({}).facets);
    assert.equal(sum(out.facets.kind), 30);
  }
});

test('words: folded, stop words dropped, prefixes, a short word whole', () => {
  assert.equal(fold('Café Brîndușescu'), 'cafe brindusescu');
  assert.deepEqual(tokenise('pack:teapot, Wire-haired  CAFÉ'), ['pack', 'teapot', 'wire', 'haired', 'cafe']);
  assert.deepEqual(ids(lib.search('cafe')), ['cafe-sign']);
  assert.deepEqual(ids(lib.search('CAFÉ')), ['cafe-sign']);
  assert.deepEqual(lib.search('café').hits[0].why, ['id: cafe']);
  assert.deepEqual(ids(lib.search('pap')), ['paper-warm', 'paper-kraft', 'paper-graph'], 'a prefix finds, but has no synonyms');
  assert.deepEqual(ids(lib.search('the paper')), ids(lib.search('paper')));
  assert.deepEqual(parseQuery('a fox in the snow').words, ['fox', 'snow']);
  // "ui" is too short to prefix: it finds inter's tag, not every word starting ui.
  assert.deepEqual(ids(lib.search('ui')), ['inter']);
  assert.deepEqual(lib.search('credit').hits, [], 'field names are not words');
  assert.deepEqual(ids(lib.search('metmuseum')), ['helmet', 'teapot', 'violin'], 'source is searched (weight 1)');
  assert.deepEqual(lib.search('ofl').hits.map((h) => h.why[0]), ['licence: ofl', 'licence: ofl']);
});

test('ranking: the field weights, the best field per word, ties on added then id', () => {
  // "kitchen" is a tag of teapot (house, 2026-09-01) and mug (project, 2026-09-25).
  assert.deepEqual(lib.search('kitchen').hits.map((h) => [h.id, h.score]), [['mug', 4], ['teapot', 4]]);
  // "teapot": its id (6) beats pack:teapot's id (6) only by the exact bonus; the desc hit of neither counts twice.
  assert.deepEqual(lib.search('teapot').hits.map((h) => [h.id, h.score, h.why]), [
    ['teapot', 16, ['id: teapot (exact)', 'id: teapot']],
    ['pack:teapot', 6, ['id: teapot']],
  ]);
  // name 5 beats desc 2: "Dusk sky" vs "orange dusk sky over hills" is the same record; "night" is id, name, tags and desc.
  assert.deepEqual(lib.search('night').hits[0].why, ['id: night']);
  assert.deepEqual(lib.search('hills').hits[0].why, ['desc: hills']);
  assert.deepEqual(lib.search('calm').hits.map((h) => [h.id, h.why]), [['piano-bed', ['tags: calm']]]);
});

test('filters', () => {
  const q = (query) => ids(lib.search(query));
  assert.deepEqual(q({ kind: 'font' }), ['caveat', 'inter']);
  assert.deepEqual(q({ kind: ['audio', 'sample'] }), ['piano-bed', 'rain-loop', 'bit-dog', 'narr-moon']);
  assert.deepEqual(q({ media: 'audio' }), q({ kind: ['audio', 'sample'] }));
  assert.deepEqual(q({ shelf: 'user' }), ['title-card', 'fox-wave']);
  assert.deepEqual(q({ shelf: 'house', q: 'paper' }), ['paper-kraft', 'paper-graph', 'linen', 'chalkboard'], 'the shadowed house paper-warm is not listed');
  assert.deepEqual(q({ tags: ['met', 'music'] }), ['violin']);
  assert.deepEqual(q({ tags: 'CAFÉ' }), ['cafe-sign']);
  assert.deepEqual(q({ licence: ['PD'] }), ['horse', 'hershey-script']);
  assert.deepEqual(q({ licence: 'CC-BY', q: 'object' }), ['mug', 'terrier'], 'the terrier is a cutout, which object finds (0.6)');
  assert.deepEqual(q({ alpha: false, kind: 'image' }), ['night-city', 'sky-dusk', 'title-card']);
  assert.deepEqual(q({ minW: 1920, kind: 'image' }), ['night-city', 'sky-dusk', 'title-card']);
  assert.deepEqual(q({ minW: 1920, minH: 2000 }), ['night-city', 'paper-warm']);
  assert.deepEqual(q({ secMin: 3, secMax: 30 }), ['rain-loop', 'narr-moon', 'fox-wave', 'ocean-drone']);
  assert.deepEqual(q({ secMax: 2 }), ['bit-dog']);
  // aspect within 2 %: the teapot (1093 x 627 = 1.743) is 16:9 enough, the violin is not anything.
  const wide = lib.search({ aspect: '16:9' });
  assert.deepEqual(ids(wide), ['teapot', 'night-city', 'sky-dusk', 'title-card', 'chalkboard', 'paper-graph', 'paper-kraft', 'ocean-drone']);
  assert.deepEqual(wide.hits[0].why, ['aspect: 1.743']);
  assert.deepEqual(q({ aspect: 1 }), q({ aspect: '1:1' }));
  assert.deepEqual(q({ aspect: '1:1' }), ['logo-mark', 'linen', 'paper-warm', 'fox-wave']);
  assert.deepEqual(q({ aspect: '9x16' }), []);
});

test('colour filters: dark from the mean lightness, hue from the dominant swatch', () => {
  const dark = lib.search({ dark: true });
  assert.deepEqual(ids(dark), ['helmet', 'violin', 'cafe-sign', 'logo-mark', 'night-city', 'chalkboard', 'ocean-drone']);
  assert.deepEqual(dark.hits.find((h) => h.id === 'chalkboard').why, ['colours: dark (L* 23)']);
  const light = ids(lib.search({ dark: false }));
  assert.equal(light.length, 10);
  assert.ok(!light.some((id) => ids(dark).includes(id)));
  assert.ok(!light.includes('fox'), 'a record with no colours is neither');

  const warm = lib.search({ hue: 'warm', media: 'raster' });
  assert.deepEqual(ids(warm), ['teapot', 'terrier', 'violin', 'sky-dusk', 'paper-kraft', 'paper-warm']);
  assert.deepEqual(warm.hits.at(-1).why, ['colours: warm #eadcc0']);
  assert.deepEqual(ids(lib.search({ hue: 'cool' })), ['cafe-sign', 'logo-mark', 'night-city', 'ocean-drone']);
  assert.deepEqual(ids(lib.search({ hue: ['blue'] })), ['logo-mark', 'night-city', 'ocean-drone']);
  assert.deepEqual(ids(lib.search({ hue: ['green', 'red'] })), ['cafe-sign']);
  assert.deepEqual(ids(lib.search({ hue: 'neutral', kind: 'stock' })), ['chalkboard', 'linen', 'paper-graph']);
  // Filters narrow a ranked query and say why.
  assert.deepEqual(lib.search({ q: 'paper', hue: 'warm', dark: false }).hits.map((h) => [h.id, h.why]), [
    ['paper-warm', ['id: paper', 'colours: light (L* 88)', 'colours: warm #eadcc0']],
    ['paper-kraft', ['id: paper', 'colours: light (L* 71)', 'colours: warm #c8a878']],
  ]);

  assert.deepEqual(hueOf('#efe6d4'), ['orange', 'warm']);
  assert.deepEqual(hueOf('#dbdddf'), ['neutral']);
  assert.deepEqual(hueOf('#2a6bd1'), ['blue', 'cool']);
  assert.deepEqual(hueOf('#e0204a'), ['red', 'warm']);
  assert.equal(hueOf('teal'), null);
  assert.equal(HUES.length, 11);
  assert.equal(lightness([{ hex: '#000000', area: 1 }]), 0);
  assert.equal(Math.round(lightness([{ hex: '#ffffff', area: 1 }])), 100);
  assert.equal(Math.round(lightness([{ hex: '#000000', area: 3 }, { hex: '#ffffff', area: 1 }])), 25, 'weighted by area');
  assert.equal(lightness([]), null);
});

test('a bad query says what is allowed', () => {
  assert.throws(() => lib.search({ q: 'x', colour: 'red' }), /query field 'colour': expected q \| kind \| media/);
  assert.throws(() => lib.search({ kind: 'sprite' }), /kind 'sprite': expected image \| video/);
  assert.throws(() => lib.search({ media: ['raster', 'svg'] }), /media 'svg': expected raster/);
  assert.throws(() => lib.search({ shelf: 'global' }), /shelf 'global': expected project \| user \| house/);
  assert.throws(() => lib.search({ licence: 'MIT' }), /licence 'MIT': expected CC0/);
  assert.throws(() => lib.search({ hue: 'teal' }), /hue 'teal': expected warm \| cool \| neutral/);
  assert.throws(() => lib.search({ aspect: 'wide' }), /aspect "wide": expected "w:h"/);
  assert.throws(() => lib.search({ minW: '1920' }), /minW "1920": expected a number >= 0/);
  assert.throws(() => lib.search({ limit: 2.5 }), /limit 2.5: expected an integer >= 0/);
  assert.throws(() => lib.search({ alpha: 'yes' }), /alpha "yes": expected true or false/);
  assert.throws(() => lib.search(['paper']), /query: a string or/);
});

test('limit 0 counts without hits', () => {
  const out = lib.search({ q: 'paper', limit: 0 });
  assert.deepEqual(out.hits, []);
  assert.equal(out.count, 5);
  assert.equal(out.facetsOf, 'hits');
});

test('the rank seam: a host scorer replaces the built-in one, can blend it, and keeps the result shape', () => {
  const seen = [];
  const rank = (r, query, { score }) => {
    seen.push(query.words);
    const s = score();
    // A pretend embedding: anything with colours is somewhat near; the built-in hits count double.
    if (!s && !r.colours) return null;
    return { score: (s?.score ?? 0) * 2 + (r.colours ? 1 : 0), why: [...(s?.why ?? []), 'embedding: 1'] };
  };
  const ranked = openLibrary({ shelves: SHELVES, rank });
  const out = ranked.search({ q: 'paper', kind: 'stock' });
  assert.deepEqual(out.hits.map((h) => [h.id, h.score, h.why]), [
    ['paper-warm', 13, ['id: paper', 'embedding: 1']],
    ['paper-kraft', 13, ['id: paper', 'embedding: 1']],
    ['paper-graph', 13, ['id: paper', 'embedding: 1']],
    ['linen', 5.8, ['tags: texture (paper)', 'embedding: 1']],
    ['chalkboard', 2.2, ['kind: stock (paper)', 'embedding: 1']],
  ]);
  assert.deepEqual(seen[0], ['paper']);
  // No q: filters only, the ranker is not asked.
  seen.length = 0;
  assert.deepEqual(ids(ranked.search({ kind: 'font' })), ['caveat', 'inter']);
  assert.deepEqual(seen, []);
});

test('the pure search over any records, and the index follows writes', async () => {
  const recs = [
    { id: 'a-paper', kind: 'stock', name: 'A', tags: [], licence: 'own' },
    { id: 'b', kind: 'image', name: 'Paper B', tags: [], licence: 'own' },
  ];
  const out = search(recs, 'paper');
  assert.deepEqual(out.hits.map((h) => [h.id, h.score]), [['a-paper', 6], ['b', 5]]);
  assert.deepEqual(out.facets.media, { raster: 2 }, 'media from the kind when a record does not carry it');
  assert.deepEqual(facetsOf(recs).kind, { image: 1, stock: 1 });

  const root = mkdtempSync(join(tmpdir(), 'assetlib-search-'));
  try {
    cpSync(join(FIX, 'user'), join(root, 'user'), { recursive: true });
    const w = openLibrary({ shelves: [{ name: 'user', root: join(root, 'user') }] });
    assert.deepEqual(ids(w.search('title')), ['title-card']);
    await w.put('user', { id: 'score', kind: 'audio', name: 'Title music', tags: ['music'], licence: 'own', credit: '', source: '', sec: 20 }, Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'));
    assert.deepEqual(ids(w.search('title')), ['title-card', 'score']);
    w.remove('title-card');
    assert.deepEqual(ids(w.search('title')), ['score']);
    // A thumb that exists is given.
    const thumb = w.locate('fox-wave').thumb;
    mkdirSync(join(root, 'user', 'thumbs'), { recursive: true });
    writeFileSync(thumb, 'png');
    assert.equal(w.search('fox').hits[0].thumb, thumb);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('on the house shelf: finds everything hdf find does for one word, the exact id first', () => {
  const house = openLibrary({ shelves: [{ name: 'house', root: HOUSE_ROOT }] });
  const st = hdf.readCatalogue();
  for (const word of ['teapot', 'fox', 'moon', 'muybridge', 'voice', 'hershey', 'pack', 'cat']) {
    const theirs = hdf.search(st, word).map((h) => h.id);
    const ours = ids(house.search({ q: word, limit: 1000 }));
    assert.deepEqual(theirs.filter((id) => !ours.includes(id)), [], word);
  }
  // hdf find is a substring: "met" is in "sometimes". A word's prefix is not.
  assert.ok(hdf.search(st, 'met').some((h) => h.id === 'ai-friend'));
  assert.deepEqual(ids(house.search('met')), ['cup', 'helmet', 'hourglass', 'lantern', 'teapot', 'violin', 'watch']);
  assert.equal(house.search('teapot').hits[0].id, 'teapot');
  assert.equal(house.search('fox').hits[0].id, 'fox');
  assert.deepEqual(ids(house.search({ kind: 'cutout', dark: true })), ['helmet', 'hourglass', 'violin']);
});

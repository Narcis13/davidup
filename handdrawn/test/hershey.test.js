// 4.0 T3: Hershey fonts as hands -- the JHF reader, the maps, the vendored files into a temp store through
// `hdf hand --hershey`, and films lettered in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCatalogue, validatePayload } from '../core/assets.js';
import { asHand, glyph } from '../core/glyphs.js';
import { HERSHEY_CREDIT, HERSHEY_K, MAPS, hersheyHand, mapFor, mergeHand, parseJhf } from '../core/hershey.js';
import { hashList, meta, paper } from '../core/list.js';
import { lint } from '../core/lint.js';
import { ramp } from '../core/curves.js';
import { handText, signOff } from '../core/text.js';
import { film, frame, seq, shot } from '../core/tree.js';
import mini, { roll, sign } from '../films/mini.js';

const SRC = 'assets/src/hershey';
const jhf = (f) => readFileSync(join(SRC, `${f}.jhf`), 'latin1');
const FILES = { romans: 'hershey-romans', scripts: 'hershey-script', cyrillic: 'hershey-cyrillic' };
const ys = (g) => g.s.flat().filter((_, i) => i % 2);

test('parseJhf: bounds, pen lifts, wrapped entries; a short file is an error', () => {
  // '#' of romans: bounds H\ (-10, 10), four strokes.
  const [g] = parseJhf('  733 12H]SBLb RYBRb RLOZO RKUYU\n');
  assert.deepEqual([g.n, g.l, g.r], [733, -10, 11]);
  assert.deepEqual(g.s, [[1, -16, -6, 16], [7, -16, 0, 16], [-6, -3, 8, -3], [-7, 3, 7, 3]]);
  assert.deepEqual(parseJhf('  733 12H]SBLb RYB\nRb RLOZO RKUYU')[0].s, g.s, 'an entry may wrap onto the next line');
  assert.deepEqual(parseJhf('12345  1JZ')[0], { n: 12345, l: -8, r: 8, s: [] }, 'the space');
  assert.deepEqual(parseJhf('12345  3JZRR RSS')[0].s, [], 'a lone vertex draws nothing');
  assert.throws(() => parseJhf('12345 12H]SBLb'), /12 pairs, the file ends after 3/);
  assert.throws(() => parseJhf('hello'), /jhf line 1/);
  for (const f of Object.keys(FILES)) assert.equal(parseJhf(jhf(f)).length, 96, f);
});

test('the maps: ASCII order; Greek and Cyrillic over the Latin slots', () => {
  for (const m of Object.values(MAPS)) assert.equal(m.length, 96);
  assert.deepEqual([MAPS.ascii[0], MAPS.ascii[33], MAPS.ascii[94], MAPS.ascii[95]], [' ', 'A', '~', null]);
  const at = (m, c) => MAPS[m][c.charCodeAt(0) - 32];
  assert.deepEqual(['A', 'C', 'H', 'X', 'Y', 'a', 'w'].map((c) => at('greek', c)), ['Α', 'Γ', 'Θ', 'Ω', null, 'α', 'ψ']);
  assert.deepEqual(['A', 'C', 'E', 'H', '[', '`', '$', '%', 'e', '}', '0', ','].map((c) => at('cyrillic', c)),
    ['А', 'Э', null, 'Ж', 'Е', 'Ц', 'Ы', 'ц', 'й', 'я', '0', ',']);
  assert.equal(MAPS.cyrillic[95], '~');
  const russian = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
  for (const c of russian + russian.toUpperCase().replace('Й', '')) assert.ok(MAPS.cyrillic.includes(c), c);
  assert.deepEqual(['greeks.jhf', 'dir/greekc.jhf', 'cyrillic.jhf', 'CYRILLIC', 'scripts.jhf', 'cyrilc_1.jhf'].map(mapFor),
    ['greek', 'greek', 'cyrillic', 'cyrillic', 'ascii', 'ascii']);
});

test('hersheyHand: a valid PD hand at the house cap height and x-height, track 0, the notice as credit', () => {
  const h = hersheyHand(jhf('romans'), { name: 'r' });
  assert.deepEqual(validatePayload('hand', h), []);
  assert.deepEqual([h.kind, h.name, h.track, h.licence, h.credit, h.stroke], ['hand', 'r', 0, 'PD', HERSHEY_CREDIT, undefined]);
  assert.match(h.credit, /Dr\. A\. V\. Hershey .* James Hurt/);
  assert.equal(Object.keys(h.glyphs).length, 95);
  assert.deepEqual([Math.min(...ys(h.glyphs.H)), Math.max(...ys(h.glyphs.H))], [-72, 0]);
  assert.equal(Math.min(...ys(h.glyphs.x)), -48);
  assert.deepEqual(h.glyphs[' '], { w: +(16 * HERSHEY_K).toFixed(1), s: [] });
  assert.ok(Math.min(...h.glyphs.o.s.flat().filter((_, i) => i % 2 === 0)) > 0, 'the left bearing is kept');
  const c = hersheyHand(jhf('cyrillic'), { map: 'cyrillic' });
  assert.equal(Object.keys(c.glyphs).length, 95);
  assert.ok(c.glyphs['Ж'] && c.glyphs['й'] && !c.glyphs.A && !c.glyphs.E);
  assert.throws(() => hersheyHand(jhf('romans'), { map: 'runes' }), /no map 'runes'/);
});

test('the store holds the three vendored fonts as they parse today', () => {
  const st = readCatalogue();
  for (const [f, id] of Object.entries(FILES)) {
    assert.equal(st.entry(id).licence, 'PD');
    assert.deepEqual(st.json(id), hersheyHand(jhf(f), { name: id, map: mapFor(f) }), `regenerate: hdf hand --hershey ${SRC}/${f}.jhf --name ${id}`);
  }
});

test('a Cyrillic hand composes Ё and Й from its own Е and И; a script hand letters a film', () => {
  const C = asHand({ ...hersheyHand(jhf('cyrillic'), { map: 'cyrillic' }), name: 'cyr' });
  assert.equal(glyph('Ж', C).own, true);
  for (const [ch, base] of [['Ё', 'Е'], ['Й', 'И'], ['ё', 'е']]) {
    const g = glyph(ch, C);
    assert.equal(g.own, false, `${ch}: the mark is the house's`);
    assert.equal(g.w, C.glyphs[base].w);
    assert.deepEqual(g.s.slice(0, C.glyphs[base].s.length), C.glyphs[base].s, `${ch} is its hand's ${base}`);
  }
  // The sign-off lints clean in the Cyrillic hand; in a Latin Hershey hand the house stands in (and draws '?').
  const end = shot('end', 2, ({ t, CX, CY }) => [
    paper(), meta('anchor', { name: 'signOff' }),
    signOff('спасибо', 'пока', { x: CX, y: CY, size: 80, pA: ramp(0, 0.2, t), pB: ramp(0.2, 0.4, t) }),
  ]);
  const rules = (look) => lint(film({ name: 'ru', look, timeline: seq(end) })).map((x) => x.rule);
  assert.deepEqual(rules('paperInk~hand:hershey-cyrillic'), []);
  const f = lint(film({ name: 'ru', look: 'paperInk~hand:hershey-romans', timeline: seq(end) }));
  assert.deepEqual(f.map((x) => x.rule), ['hand-missing']);
  assert.match(f[0].detail, /letters 'с', 'п', 'а', 'и', 'б', 'о', 'к' as '\?': neither hand 'hershey-romans' nor the house has them/);
  assert.match(lint(film({ name: 'ru', look: 'paperInk', timeline: seq(end) }))[0].detail, /as '\?': the house hand has no glyph for them/);
  // mini in the script hand: other strokes, the same ball.
  const last = mini.n - 1, S = film({ name: 'mini', look: 'paperInk~hand:hershey-script', timeline: seq(roll, sign) });
  assert.notEqual(hashList(frame(S, last).list), hashList(frame(mini, last).list));
  assert.equal(hashList(frame(S, 0).list), hashList(frame(mini, 0).list), 'no lettering, no change');
  assert.ok(handText('mini', 0, 0, { size: 100, look: 'paperInk~hand:hershey-script' }).kids.length > 0);
});

test('mergeHand: the hand keeps its own glyphs, gains the new, credits once', () => {
  const a = { kind: 'hand', name: 'a', glyphs: { x: { w: 1, s: [] } }, credit: 'mine' };
  const { hand, added, kept } = mergeHand(a, { glyphs: { x: { w: 2, s: [] }, y: { w: 3, s: [] } }, credit: 'mine' });
  assert.deepEqual([added, kept, hand.glyphs.x.w, hand.glyphs.y.w, hand.credit], [['y'], ['x'], 1, 3, 'mine']);
});

test('hdf hand --hershey: the vendored files into a temp store, --merge, the errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-hershey-'));
  const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv, '--root', dir, '--out', dir, '--no-sheet'], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  try {
    for (const [f, id] of Object.entries(FILES)) {
      const r = hdf('hand', '--hershey', `${SRC}/${f}.jhf`, '--name', id);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, new RegExp(`^${id} {2}hand {2}[0-9a-f]{40}\\.json {2}PD {2}\\(new\\)$`, 'm'));
      assert.match(r.out, new RegExp(`^95 glyphs from ${f}\\.jhf \\(map ${mapFor(f)}\\)$`, 'm'));
    }
    const st = readCatalogue(dir), main = readCatalogue();
    for (const id of Object.values(FILES)) assert.equal(st.entry(id).sha, main.entry(id).sha, `${id}: the same blob as the package store`);
    assert.deepEqual([st.entry('hershey-script').source, st.entry('hershey-script').tags], ['scripts.jhf', ['hand', 'hershey']]);
    // Latin from romans into the Cyrillic hand, under a new name: the digits and punctuation it has stay its own.
    const m = hdf('hand', '--hershey', `${SRC}/romans.jhf`, '--merge', 'hershey-cyrillic', '--name', 'ru-en');
    assert.equal(m.code, 0, m.out);
    assert.match(m.out, /^63 glyphs from romans\.jhf \(map ascii\) added to hershey-cyrillic, 32 it has kept; 158 in all$/m);
    const e = readCatalogue(dir).entry('ru-en'), d = readCatalogue(dir).json('ru-en');
    assert.deepEqual([e.glyphs, e.licence, e.source, d.credit], [158, 'PD', 'cyrillic.jhf + romans.jhf', HERSHEY_CREDIT]);
    assert.deepEqual(d.glyphs['0'], readCatalogue(dir).json('hershey-cyrillic').glyphs['0']);
    assert.ok(d.glyphs.A && d.glyphs['Ж']);
    assert.match(hdf('hand', '--hershey', `${SRC}/romans.jhf`, '--merge', 'hershey-cyrillic').out, /hershey-cyrillic {2}hand .*\(replaces/, '--merge alone writes back to the hand');
    // Errors: no name, no file, a bad map, no hand to merge into, the house.
    assert.match(hdf('hand', '--hershey', `${SRC}/romans.jhf`).out, /need --name/);
    assert.equal(hdf('hand', '--hershey', 'nope.jhf', '--name', 'x').code, 2);
    assert.match(hdf('hand', '--hershey', `${SRC}/romans.jhf`, '--name', 'x', '--map', 'runes').out, /--map runes \(expected ascii \| greek \| cyrillic\)/);
    assert.match(hdf('hand', '--hershey', `${SRC}/romans.jhf`, '--merge', 'nobody').out, /no hand 'nobody' in the store/);
    assert.equal(hdf('hand', '--hershey', `${SRC}/romans.jhf`, '--name', 'house').code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

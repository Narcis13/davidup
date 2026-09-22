// 4.0 T4: any font as a hand -- the glyph sets, the em scale, the pen profile, serifs off a skeleton, fonts from
// the repository traced through `hdf hand --font` into a temp store, films lettered in them, and lint 'credit'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCatalogue, validatePayload } from '../core/assets.js';
import { ramp } from '../core/curves.js';
import { FONT_MARKS, GLYPH_SETS, emScale, fontHandRecord, pressureOf, setsOf, strays } from '../core/fonthand.js';
import { GLYPHS, MARKS, asHand, fallbacks, glyph } from '../core/glyphs.js';
import { lint } from '../core/lint.js';
import { hashList, meta, paper } from '../core/list.js';
import { distanceTransform, prune, serifs, traceSkeleton, zhangSuen } from '../core/skeleton.js';
import { handText, signOff } from '../core/text.js';
import { register } from '../core/store.js';
import { film, frame, seq, shot } from '../core/tree.js';
import { fontHand } from '../cli/hand.mjs';
import mini, { roll, sign } from '../films/mini.js';

const INTER = '../fonts/Inter-Regular.ttf';                    // OFL, Latin only
const MONO = '../examples/fonts/JetBrainsMono-Bold.ttf';        // OFL, Latin, Cyrillic, Greek
const ys = (g) => g.s.flat().filter((_, i) => i % 2);

test('the glyph sets and --glyphs', () => {
  const { latin, cyrillic, greek, symbols } = GLYPH_SETS;
  for (const c of 'azAZ09ßăȘłŒ') assert.ok(latin.includes(c), c);
  assert.equal(cyrillic.length, 96);
  assert.ok(cyrillic.includes('Ж') && cyrillic.includes('ё') && cyrillic.includes('ї'));
  assert.equal(greek.length, 69);
  assert.ok(greek.includes('Ω') && greek.includes('ά') && !greek.includes('\u03a2'));
  for (const c of '.,?€→«—…<{|\\^`') assert.ok(symbols.includes(c), c);
  assert.ok(!symbols.includes(' ') && !symbols.includes('a') && !symbols.includes('\u00a0'));
  for (const set of Object.values(GLYPH_SETS)) assert.equal(new Set(set).size, set.length);
  assert.deepEqual(setsOf(undefined), ['latin', 'cyrillic', 'greek', 'symbols']);
  assert.deepEqual(setsOf('Cyrillic, latin,latin'), ['cyrillic', 'latin']);
  assert.throws(() => setsOf('latin,runes'), /--glyphs latin,runes \(expected a list of latin, cyrillic, greek, symbols\)/);
  for (const m of Object.keys(FONT_MARKS)) assert.ok(MARKS[m]);
});

test('emScale splits the difference between the cap height and the x-height', () => {
  assert.equal(emScale(72, 48), 1);
  assert.ok(Math.abs(emScale(144, 96) - 0.5) < 1e-12, 'a face with the house proportions lands on both lines');
  const k = emScale(286, 207);                                 // Arial at 400 px
  assert.deepEqual([Math.round(286 * k), Math.round(207 * k)], [69, 50]);
  assert.throws(() => emScale(0, 10), /must be > 0/);
});

test('pressureOf, strays and the record', () => {
  assert.deepEqual(pressureOf([]), [1, 1, 1]);
  assert.deepEqual(pressureOf([{ widths: [[2, 4, 3], null], lens: [10, 50] }, { widths: [[4, 4, 4]], lens: [10] }]), [0.75, 1, 0.88]);
  assert.deepEqual(strays({ l: { w: 20, s: [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]] }, o: { w: 40, s: [[0, 0, 1, 1]] }, 'ж': { w: 1, s: [] } }), [{ ch: 'l', n: 4, house: GLYPHS.l.s.length }]);
  const r = fontHandRecord({ name: 'f', glyphs: { a: { w: 40, s: [[0, 0, 10, -10]] } }, pressure: [0.9, 1, 0.9], credit: 'c', licence: 'OFL' });
  assert.deepEqual(validatePayload('hand', r), []);
  assert.deepEqual([r.track, r.stroke, r.marks, r.licence], [0, { hook: 0, pressure: [0.9, 1, 0.9] }, undefined, 'OFL']);
  assert.equal(asHand(r).stroke.wobble, asHand(null).stroke.wobble, 'the wobble is the pen\'s');
});

// A stem 10 px wide, 100 tall, on a 120 x 140 mask, with bars 4 px thick.
const W = 120, H = 140;
const mask = (rects) => { const m = new Uint8Array(W * H); for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; return m; };
const strokes = (m, serif) => {
  const dt = distanceTransform(m, W, H);
  let sk = prune(zhangSuen(m, W, H), W, H, 10);
  if (serif) sk = serifs(sk, W, H, dt, { far: 22, thin: 7.5 });
  return traceSkeleton(sk, W, H, { dt, minLen: 10 }).length;
};

test('serifs: pairs of thin spurs at a stroke end go; a cross bar, a bar to one side, stay', () => {
  const I = mask([[55, 20, 65, 120], [40, 20, 80, 24], [40, 116, 80, 120]]);
  assert.deepEqual([strokes(I), strokes(I, true)], [3, 1]);
  const f = mask([[55, 20, 65, 120], [40, 60, 80, 64]]);
  assert.deepEqual([strokes(f), strokes(f, true)], [2, 2]);
  const t = mask([[55, 20, 65, 120], [40, 20, 80, 24], [42, 60, 55, 64]]);
  assert.deepEqual([strokes(t), strokes(t, true)], [3, 2], 'the top serifs go, the bar to the left stays');
  const thick = mask([[55, 20, 65, 120], [40, 20, 80, 30]]);
  assert.equal(strokes(thick, true), strokes(thick), 'a slab as thick as the stem is no serif');
});

test('fontHand: Inter\'s symbols, the pen from its l, dots and commas, the x\'s two bars', { skip: !existsSync(INTER) && `no ${INTER}` }, () => {
  const r = fontHand(INTER, { name: 'inter', sets: ['symbols'], licence: 'OFL' }), h = r.hand;
  assert.equal(r.family, 'Inter');
  assert.deepEqual(validatePayload('hand', h), []);
  // 55 since 4.0 T8 composed the minus sign, which Inter draws for itself.
  assert.deepEqual([r.drawn.symbols, r.lacks.symbols, r.blank], [55, [], []]);
  assert.equal(h.glyphs[' '].s.length, 0);
  assert.ok(h.glyphs[' '].w > 20);
  assert.equal(h.glyphs['.'].s.length, 1, 'a period is a dot');
  assert.equal(h.glyphs['×'].s.length, 2, 'both bars (Zhang-Suen alone erases one)');
  assert.equal(h.glyphs['+'].s.length, 2);
  assert.equal(h.glyphs[':'].s.length, 2);
  assert.deepEqual([...Object.keys(h.marks)].sort(), ['acute', 'cedilla', 'circumflex', 'grave', 'macron', 'ring', 'tilde', 'umlaut']);
  assert.equal(h.marks.umlaut.s.length, 2);
  assert.match(h.credit, /^Inter, traced from Inter-Regular\.ttf by hdf hand --font$/);
  assert.deepEqual(h.stroke.pressure.map((v) => v > 0.85), [true, true, true], 'an even stroke');
  assert.deepEqual(r.strays, [{ ch: '#', n: 8, house: 4 }]);
});

test('fontHand: a Cyrillic font, drawn by the pen; lacking sets reported', { skip: !existsSync(MONO) && `no ${MONO}` }, () => {
  const r = fontHand(MONO, { name: 'mono', sets: ['cyrillic'], licence: 'OFL' }), H = asHand(r.hand);
  assert.equal(r.drawn.cyrillic, 96);
  assert.deepEqual(fallbacks('спасибо, пока', H), [','], 'the comma is a symbol, not asked for');
  assert.equal(glyph('ж', H).own, true);
  // Centre lines: the capitals and the x-height near the house's 72 and 48, standing on the baseline.
  const top = (c) => Math.min(...ys(H.glyphs[c])), foot = (c) => Math.max(...ys(H.glyphs[c]));
  assert.ok(Math.abs(top('Н') + 72) < 4 && Math.abs(top('н') + 48) < 4, `Н tops at ${top('Н')}, н at ${top('н')}`);
  assert.ok(Math.abs(foot('Н')) < 1 && Math.abs(foot('н')) < 1, `feet at ${foot('Н')} and ${foot('н')}`);
  const end = shot('end', 2, ({ t, CX, CY }) => [
    paper(), meta('anchor', { name: 'signOff' }),
    signOff('спасибо', 'пока', { x: CX, y: CY, size: 80, pA: ramp(0, 0.2, t), pB: ramp(0.2, 0.4, t) }),
  ]);
  register({ 't4-mono': { ...r.hand, name: 't4-mono' }, 't4-mono-free': { ...r.hand, name: 't4-mono-free', licence: 'unknown' } });
  assert.deepEqual(lint(film({ name: 'ru', look: 'paperInk~hand:t4-mono', timeline: seq(end) })), []);
  // Not licensed: lint 'credit' fails the film, and names the hand once.
  const f = lint(film({ name: 'ru', look: 'paperInk~hand:t4-mono-free', timeline: seq(end), assets: ['t4-mono-free'] }));
  assert.deepEqual(f.map((x) => x.rule), ['credit']);
  assert.match(f[0].detail, /hand 't4-mono-free' has licence unknown/);
  const other = lint(film({ name: 'ru', look: 'paperInk~hand:t4-mono', timeline: seq(end), assets: { photo: { name: 'photo', licence: 'unknown', w: 1, h: 1 } } }));
  assert.deepEqual(other.map((x) => [x.rule, /asset 'photo'/.test(x.detail)]), [['credit', true]]);
});

test('hdf hand --font: Inter into a temp store, mini lettered in it; the errors', { skip: !existsSync(INTER) && `no ${INTER}` }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-font-'));
  const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv, '--root', dir, '--out', dir, '--no-sheet'], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  try {
    const r = hdf('hand', '--font', INTER, '--name', 'inter', '--glyphs', 'latin', '--licence', 'OFL');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^inter {2}hand {2}[0-9a-f]{40}\.json {2}OFL {2}\(new\)$/m);
    assert.match(r.out, /^256 glyphs from Inter \(latin 255\/258\), 8 marks; pressure [\d.]+\/1\/[\d.]+$/m);
    assert.match(r.out, /^the font lacks 3 latin: ȷ ẞ ŉ$/m);
    const st = readCatalogue(dir), e = st.entry('inter'), h = { ...st.json('inter'), name: 't4-inter' };
    register({ 't4-inter': h });
    assert.deepEqual([e.licence, e.source, e.tags], ['OFL', 'Inter-Regular.ttf', ['hand', 'font']]);
    assert.deepEqual(strays(h.glyphs), [], 'no letter far off the house\'s strokes');
    for (const c of 'tfx') assert.equal(h.glyphs[c].s.length, { t: 2, f: 2, x: 3 }[c], `${c}: its bars`);
    assert.equal(glyph('ă', asHand(h)).own, true, 'the font\'s own ă');
    // mini in Inter: its lettering changes, its ball does not, and it lints clean.
    const last = mini.n - 1, S = film({ name: 'mini', look: 'paperInk~hand:t4-inter', timeline: seq(roll, sign) });
    assert.notEqual(hashList(frame(S, last).list), hashList(frame(mini, last).list));
    assert.equal(hashList(frame(S, 0).list), hashList(frame(mini, 0).list));
    assert.deepEqual(lint(S), []);
    assert.ok(handText('mini', 0, 0, { size: 100, hand: asHand(h) }).kids.length > 0);
    // No --licence: unknown, with the warning.
    assert.match(hdf('hand', '--font', INTER, '--name', 'free', '--glyphs', 'symbols').out, /free {2}hand .* unknown .*\n[\s\S]*warning: 'free' has licence unknown/);
    // Errors.
    assert.match(hdf('hand', '--font', INTER).out, /need --name/);
    assert.equal(hdf('hand', '--font', 'nope.ttf', '--name', 'x').code, 2);
    assert.match(hdf('hand', '--font', INTER, '--name', 'x', '--glyphs', 'runes').out, /--glyphs runes/);
    assert.match(hdf('hand', '--font', INTER, '--name', 'x', '--px', '10').out, /--px 10/);
    assert.equal(hdf('hand', '--font', INTER, '--name', 'house').code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

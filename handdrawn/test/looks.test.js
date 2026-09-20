import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, resolveLook, resolveRole, derive, duotone, pastel, hashLook, hsl, mix, parse, parseLookName } from '../core/looks.js';

test('six presets, each with the full role set', () => {
  assert.deepEqual(Object.keys(LOOKS), ['paperInk', 'risoPop', 'screenSea', 'pencilMinimal', 'blueprintNight', 'doodlePastel']);
  for (const l of Object.values(LOOKS)) {
    for (const r of ['paper', 'ink', 'chalk', 'night', 'shade', 'light', 'blush', 'fills.0', 'accents.3', 'inks.1']) assert.ok(resolveRole(r, l), `${l.name} ${r}`);
    assert.ok(Object.isFrozen(l.palette.fills));
  }
});

test('roles resolve names, indices and modifiers; raw colours are refused', () => {
  const l = resolveLook('paperInk');
  assert.equal(resolveRole('fills.0', l), '#e79256');
  assert.equal(resolveRole('fills.4', l), '#e79256');   // wraps
  assert.equal(resolveRole({ base: 'paper', shade: 0.5 }, l), mix('#f3e6cf', '#000000', 0.5));
  assert.equal(resolveRole({ base: 'ink', alpha: 0.5 }, l), 'rgba(30,22,48,0.5)');
  assert.equal(resolveRole({ base: 'night', tint: 1 }, l), '#ffffff');
  assert.deepEqual(parse(resolveRole('guide', l)), [70, 100, 255, 0.55]);
  assert.throws(() => resolveRole('#ff0000', l), /raw colours/);
  assert.throws(() => resolveRole('nope', l), /not in look/);
  assert.throws(() => resolveLook('nope'), /unknown look/);
});

test('derived looks keep their base, and hash differently', () => {
  const d = derive('risoPop', { hue: 40 }), duo = duotone('risoPop', '#ff48b0', '#0078bf'), p = pastel('doodlePastel', 'mint');
  assert.equal(d.palette.paper, LOOKS.risoPop.palette.paper);
  assert.notEqual(d.palette.fills[0], LOOKS.risoPop.palette.fills[0]);
  assert.deepEqual(duo.palette.inks, ['#ff48b0', '#0078bf']);
  assert.equal(p.palette.paper, '#d3e6d9');
  const hs = [LOOKS.risoPop, d, duo, p].map(hashLook);
  assert.equal(new Set(hs).size, 4);
  assert.equal(hashLook({ name: 'risoPop' }), hashLook(LOOKS.risoPop));
  assert.match(hs[0], /^[0-9a-f]{16}$/);
});

// S1: a look in a cutout's own colours. The table is what `hdf photo` writes into a cutout record.
const TEAPOT = {
  name: 'teapot',
  colours: [
    { hex: '#8fb0c8', area: 0.12 }, { hex: '#e8e0d2', area: 0.46 }, { hex: '#c0452e', area: 0.06 },
    { hex: '#2b4f8a', area: 0.21 }, { hex: '#141414', area: 0.03 },
  ],
};

test('derive({ from }): fills follow area, accents are the saturated four, the sheet is untouched', () => {
  const d = derive('doodlePastel', { from: TEAPOT });
  assert.equal(d.name, 'doodlePastel~from:teapot');
  assert.deepEqual(d.palette.fills, ['#e8e0d2', '#2b4f8a', '#8fb0c8', '#c0452e', '#141414']);
  for (const k of ['paper', 'ink', 'night', 'light', 'chalk']) assert.equal(d.palette[k], LOOKS.doodlePastel.palette[k], k);
  assert.equal(d.palette.accents.length, 4);
  for (const a of d.palette.accents) {
    const [, s, l] = hsl(a);
    assert.ok(s >= hsl('#8fb0c8')[1], `accent ${a} is at least as saturated as the flattest source`);
    assert.ok(Math.abs(l - 0.5) < 0.02, `accent ${a} sits at mid lightness`);
  }
  assert.equal(d.palette.inks[0], LOOKS.doodlePastel.palette.ink);
  assert.equal(d.palette.inks[1], '#2b4f8a', 'darkest saturated colour, not the flat near-black');
  assert.equal(d.palette.shade, mix('#141414', '#000000', 0.3), 'darkest, shaded');
  assert.equal(d.palette.blush, mix('#c0452e', '#ffffff', 0.3), 'warmest by saturation, tinted');
  assert.equal(resolveRole('fills.0', d), '#e8e0d2');
  assert.notEqual(hashLook(d), hashLook('doodlePastel'));
  assert.deepEqual(derive(LOOKS.doodlePastel, { from: TEAPOT.colours }).palette.fills, d.palette.fills);
});

test('a cutout without colours names the command that adds them', () => {
  assert.throws(() => derive('doodlePastel', { from: { name: 'cup' } }), /cutout 'cup' has no colours.*hdf photo --refresh/s);
  assert.throws(() => derive('doodlePastel', { from: [] }), /hdf photo --refresh/);
});

test("'preset~from:id' resolves against a film's assets, and only there", () => {
  assert.deepEqual(parseLookName('doodlePastel~from:teapot'), { base: 'doodlePastel', mods: [['from', 'teapot']] });
  const l = resolveLook('doodlePastel~from:teapot', { teapot: TEAPOT });
  assert.equal(l.name, 'doodlePastel~from:teapot');
  assert.deepEqual(l.palette.fills, derive('doodlePastel', { from: TEAPOT }).palette.fills);
  assert.equal(hashLook(l), hashLook(resolveLook('doodlePastel~from:teapot', new Map([['teapot', TEAPOT]]))));
  assert.throws(() => resolveLook('doodlePastel~from:teapot'), /needs the film's assets/);
  assert.throws(() => resolveLook('doodlePastel~from:cup', { teapot: TEAPOT }), /no asset 'cup'.*has teapot/);
  assert.throws(() => resolveLook('doodlePastel~nope:x', { teapot: TEAPOT }), /unknown modifier 'nope'/);
  assert.throws(() => resolveLook('nope~from:teapot', { teapot: TEAPOT }), /unknown look/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, resolveLook, resolveRole, derive, duotone, pastel, hashLook, mix, parse } from '../core/looks.js';

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

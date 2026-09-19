import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Canvas } from 'skia-canvas';
import mini from '../films/mini.js';
import { frame } from '../core/tree.js';
import { expand } from '../core/finish.js';
import { draw, outputSize, renderFrame } from '../core/raster.js';
import { fill, circle, text, paper, walk, group } from '../core/list.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('expand turns finishes, stock and text into drawable ops, memoised', () => {
  const { list } = frame(mini, 0);
  const a = expand(list, 'paperInk'), b = expand(list, 'paperInk');
  assert.equal(a[0], b[0]);
  const kinds = new Set();
  walk(a, (op) => { kinds.add(op.op); if (op.op === 'fill') assert.ok(!op.finish); });
  for (const k of ['group', 'fill', 'clip', 'stroke', 'specks']) assert.ok(kinds.has(k), k);
  for (const k of ['paper', 'text']) assert.ok(!kinds.has(k), k);
  const t = expand([text('hi', 0, 0, { seed: 3 })], 'paperInk');
  assert.equal(t[0].op, 'group');
  assert.ok(t[0].kids.every((s) => s.op === 'stroke' && Number.isInteger(s.seed)));
});

test('draw refuses unexpanded and unknown ops', () => {
  const ctx = new Canvas(10, 10).getContext('2d');
  assert.throws(() => draw(ctx, [paper()], { look: 'paperInk' }), /expand/);
  assert.throws(() => draw(ctx, [fill(circle(0, 0, 1), 'ink', { finish: true })], { look: 'paperInk' }), /expand/);
  assert.throws(() => draw(ctx, [group([{ op: 'bogus' }])], { look: 'paperInk' }), /unknown op/);
});

test('mini renders deterministically at an even output size, opaque', () => {
  const { outW, outH } = outputSize(mini.format, 240);
  const c = new Canvas(outW, outH), ctx = c.getContext('2d');
  const shot = (i) => { renderFrame(ctx, mini, i, { width: 240 }); return c.toBufferSync('raw'); };
  const a = shot(3), b = shot(3);
  assert.equal(sha(a), sha(b));
  assert.notEqual(sha(shot(4)), sha(a));
  assert.equal(outW, 240);
  const px = (buf, x, y) => [...buf.subarray((y * outW + x) * 4, (y * outW + x) * 4 + 4)];
  assert.equal(px(a, 0, 0)[3], 255);
});

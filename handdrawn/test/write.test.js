// 4.0 T6: reveal schedules at a reading speed (writeOn, revealed, writing), the pen tip (penAt), and a
// drawn hand that writes (packs/hands.js writingHand, writer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, group, handText, line, stroke, textBox, place } from '../core/index.js';
import { hashList, walk } from '../core/list.js';
import { penAt, penStrokes, reveal } from '../core/tools.js';
import { glyphUnits } from '../core/text.js';
import { revealed, writeOn, writing } from '../core/write.js';
import { toolFor, writer, writingHand } from '../packs/hands.js';
import { frame } from '../core/tree.js';
import written from '../films/written.js';
import { titleCard } from '../recipes/shots.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('glyphUnits counts words across lines and leaves spaces out of words', () => {
  const u = glyphUnits('ab cd\nef');
  assert.deepEqual(u.map((g) => g.word), [0, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual(u.map((g) => g.line), [0, 0, 0, 0, 0, 1, 1]);
});

test('penAt follows trim: the tip is where reveal stops, through groups; up at both ends', () => {
  const node = place(100, 50, { scale: 2 }, [stroke(line(0, 0, 10, 0), 'ink', { name: 'a' }), stroke(line(0, 10, 0, 30), 'ink', { name: 'b' })]);
  const S = penStrokes(node);
  assert.equal(S.items.length, 2);
  assert.ok(near(S.total, 60));
  const half = penAt(1 / 6, node);
  assert.ok(near(half.x, 110) && near(half.y, 50) && half.down && near(half.a, 0));
  const b = penAt(0.5, node);
  assert.ok(near(b.x, 100) && near(b.y, 80) && near(b.a, Math.PI / 2) && b.item === 1);
  assert.equal(penAt(0, node).down, false);
  const end = penAt(1, node);
  assert.ok(near(end.x, 100) && near(end.y, 110) && !end.down);
  assert.equal(penAt(0.5, group([])), null);
});

test('penStrokes knows lettering: a text op and an already lettered handText group give words', () => {
  const g = handText('hi you', 0, 100, { size: 60, ink2: null });
  const S = penStrokes(g);
  assert.ok(S.items.every((it) => it.text === g && it.gi >= 0));
  const W = writing(g, { wps: 2, lead: 0 });
  assert.equal(W.units.length, 2, 'two words, two units');
  assert.ok(near(W.end, 1), 'two words at 2 a second take a second');
  assert.equal(writing(g, { per: 'glyph', lead: 0 }).units.length, 5);
  assert.equal(writing(g, { per: 'line', lead: 0 }).units.length, 1);
  assert.throws(() => writing(g, { per: 'page' }), /per 'page'/);
});

test('writeOn: nothing before the lead, a word at a time at wps, whole at the end; revealed agrees', () => {
  const g = textBox('the moon has no light', [100, 100, 800, 400], { size: 80, ink2: null });
  const o = { at: 0.5, lead: 0.4, wps: 2 };
  const W = writing(g, o);
  assert.equal(W.units.length, 5);
  assert.ok(near(W.end, 0.5 + 0.4 + 5 / 2));
  assert.equal(revealed(g, 0.8, o), 0);
  assert.equal(revealed(g, W.end, o), 1);
  assert.equal(hashList([writeOn(g, { ...o, t: 99 })]), hashList([g]));
  assert.equal(hashList([writeOn(g, { ...o, t: 2 })]), hashList([reveal(revealed(g, 2, o), g)]));
  // Progress holds still through each lift, and grows through each word.
  const u = W.units[2];
  assert.equal(W.p(u.t0), W.p(u.t1 - 1e-6));
  assert.ok(W.p(u.t2 - 1e-6) > W.p(u.t1 + 1e-6));
});

test('the pen comes in, is down while writing, lifts between words, leaves, then is gone', () => {
  const g = textBox('one two three', [100, 100, 900, 300], { size: 80, ink2: null });
  const W = writing(g, { at: 0, lead: 0.4, wps: 2 });
  assert.equal(W.pen(-0.1), null);
  const come = W.pen(0.2);
  assert.ok(!come.down && come.enter > 0 && come.enter < 1);
  const [, u1] = W.units;
  const mid = W.pen((u1.t0 + u1.t1) / 2);
  assert.ok(!mid.down && mid.lift > 0.5, 'up between words');
  assert.ok(W.pen((u1.t1 + u1.t2) / 2).down, 'down in a word');
  const go = W.pen(W.end + 0.2);
  assert.ok(!go.down && go.leave > 0);
  assert.equal(W.pen(W.end + 0.5), null);
});

test('writer: the hand at the tip, lifted between words (a shadow at the point), absent when not writing', () => {
  const g = textBox('one two', [100, 100, 900, 300], { size: 80, ink2: null });
  const o = { at: 0, lead: 0.4, wps: 2 };
  const W = writing(g, o), [, u1] = W.units;
  const down = writer(g, (u1.t1 + u1.t2) / 2, o), up = writer(g, (u1.t0 + u1.t1) / 2, o);
  const names = (n) => { const out = []; walk([n], (op) => out.push(op.name)); return out; };
  assert.ok(names(down).includes('writing-hand') && !names(down).includes('tipShadow'));
  assert.ok(names(up).includes('tipShadow'));
  const tip = W.pen((u1.t1 + u1.t2) / 2), hand = down.kids.find((k) => k.cel === 'writing-hand');
  assert.ok(near(hand.xf[4], tip.x) && near(hand.xf[5], tip.y), 'the point on the tip');
  assert.equal(writer(g, -1, o), null);
  assert.equal(writer(g, 0, { p: 0 }), null);
  assert.equal(writer(g, 0, { p: 1 }), null);
  assert.ok(writer(g, 0, { p: 0.5 }));
});

test('writingHand: four tools, both hands; the look picks the tool', () => {
  for (const tool of ['pen', 'marker', 'chalk', 'crayon']) assert.equal(writingHand({ tool }).cel, 'writing-hand');
  assert.equal(writingHand({ side: 'l' }).xf[0], -1);
  assert.throws(() => writingHand({ tool: 'quill' }), /tool 'quill'/);
  assert.equal(toolFor('whiteboard'), 'marker');
  assert.equal(toolFor('paperInk'), 'pen');
});

test('films/written: the caption writes at two words a second and the hand lifts between words', () => {
  const kinds = [];
  for (let i = 0; i < 6.33 * FPS; i++) {
    let hand = false, shadow = false;
    walk(frame(written, i).list, (op) => { if (op.cel === 'writing-hand') hand = true; if (op.name === 'tipShadow') shadow = true; });
    kinds.push(hand ? (shadow ? 'up' : 'down') : '-');
  }
  const runs = kinds.join('').replace(/(down)+/g, 'D').replace(/(up)+/g, 'U').replace(/-+/g, '-');
  assert.match(runs, /^-U?D(UD){7,}U?-?$/, runs);
});

test('titleCard hand: a hand writes the title a word at a time; without it nothing changes', () => {
  const s = titleCard({ title: 'the moon', sub: 'a lesson', hand: true, audience: 'kids-9' });
  assert.ok(s.dur > titleCard({ title: 'the moon', sub: 'a lesson', audience: 'kids-9' }).dur - 1);
  let seen = 0;
  for (let k = 0; k < s.n; k++) walk(s.draw({ t: k / FPS, k, look: 'whiteboard', W: 1080, H: 1080 }), (op) => { if (op.cel === 'writing-hand') seen++; });
  assert.ok(seen > 10);
});

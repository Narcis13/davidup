// 4.0 T9: bubble kinds, say over several lines, dialogue between actors, captions from plain copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorOf } from '../core/actor.js';
import { AUDIENCES } from '../core/audience.js';
import { captions } from '../core/captions.js';
import { dialogue } from '../core/dialogue.js';
import { bounds, hashList, meta, paper, walk } from '../core/list.js';
import { lintAll } from '../core/lint.js';
import { bubble, BUBBLE_KINDS } from '../core/marks.js';
import { puppet } from '../core/puppet.js';
import { stickSource } from '../core/stick.js';
import { signOff } from '../core/text.js';
import { film, seq, shot } from '../core/tree.js';
import { FPS } from '../core/curves.js';

const AMY = actorOf(puppet(stickSource({ name: 'amy' })));
const BEN = actorOf(puppet(stickSource({ name: 'ben', build: 'tall' })));
const WHERE = { amy: [300, 600, 100], ben: [780, 600, 100] };

const glyphs = (node) => { let n = 0; walk([node], (op) => { if (op.op === 'stroke' && /^g\d+\./.test(op.name ?? '')) n++; }); return n; };
const named = (node, re) => { const out = []; walk([node], (op) => { if (re.test(op.name ?? '')) out.push(op); }); return out; };

test('bubble kinds: speech, thought, shout, whisper and caption, each seeded, the tail reaching its point', () => {
  const box = [100, 100, 300, 90], tip = [180, 320];
  assert.deepEqual(BUBBLE_KINDS, ['speech', 'thought', 'shout', 'whisper', 'caption']);
  const hashes = new Set();
  for (const kind of BUBBLE_KINDS) {
    const b = bubble(box, tip, { kind, seed: 4 });
    assert.equal(b.name, 'bubble');
    assert.deepEqual(b.kids.slice(0, 2).map((k) => [k.op, k.role]), [['fill', 'paper'], ['stroke', 'ink']]);
    assert.equal(hashList([b]), hashList([bubble(box, tip, { kind, seed: 4 })]), kind);
    hashes.add(hashList([b]));
    const [x, y, w, h] = bounds(b.kids);
    // Every kind covers the box; all but the caption reach down to the point.
    assert.ok(x <= box[0] + 3 && y <= box[1] + 3 && x + w >= box[0] + box[2] - 3 && y + h >= box[1] + box[3] - 3, kind);
    // The wedges run to the point; a thought's puffs lead most of the way there.
    if (kind !== 'caption') assert.ok(y + h >= tip[1] - (kind === 'thought' ? 80 : 1), `${kind} reaches towards its tail's point`);
  }
  assert.equal(hashes.size, 5);
  // The whisper is the speech outline, dashed.
  const [sp, wh] = ['speech', 'whisper'].map((kind) => bubble(box, tip, { kind, seed: 4 }));
  assert.deepEqual(wh.kids[0].path, sp.kids[0].path);
  assert.ok(wh.kids[1].dash && !sp.kids[1].dash);
  // A thought's tail is puffs, not a wedge; a caption has no tail at all.
  assert.deepEqual(bubble(box, tip, { kind: 'thought' }).kids.map((k) => k.name), ['sheet', 'edge', 'puffs', 'puffEdge']);
  assert.ok(bounds(bubble(box, tip, { kind: 'caption' }).kids)[3] < box[3] + 6);
  // A shout's tail is a wedge even where no spike sits close to the one facing the point.
  const shout = bubble(box, tip, { kind: 'shout', seed: 4 }).kids[0].path.sub[0].pts, at = shout.findIndex((v, i) => i % 2 === 0 && v === tip[0] && shout[i + 1] === tip[1]);
  const prev = [shout[at - 2], shout[at - 1]], next = [shout[at + 2], shout[at + 3]];
  assert.ok(Math.hypot(prev[0] - next[0], prev[1] - next[1]) > 10);
  assert.throws(() => bubble(box, tip, { kind: 'scream' }), /kind 'scream'/);
});

test('say: a long line wraps into a taller bubble, "\\n" breaks, and the letters still arrive in order', () => {
  const one = AMY.say('hello there', 0), long = AMY.say('have you seen the teapot that ran away this morning?', 0, { width: 360 });
  const d1 = one.draw(one.end, 300, 600, 100), dl = long.draw(long.end, 300, 600, 100);
  const b1 = d1.kids[0].kids[0].path.box, bl = dl.kids[0].kids[0].path.box;
  assert.ok(bl[3] > b1[3] * 1.8, 'several lines are taller');
  assert.ok(bl[2] < 360 + 48 * 1.2 + 12, 'and no wider than the wrap and its margin');
  // Letters arrive as spoken across the lines: more later, all by the end, none before.
  const mid = long.draw((long.t0 + long.end) / 2, 300, 600, 100);
  assert.ok(glyphs(mid) > 0 && glyphs(mid) < glyphs(dl));
  assert.equal(glyphs(dl), glyphs(long.draw(long.until - 1 / FPS, 300, 600, 100)), 'all of it by the end');
  assert.equal(glyphs(long.draw(0, 300, 600, 100)) <= 2, true);
  const broken = AMY.say('a teapot?\nno!', 0).draw(2, 300, 600, 100);
  assert.equal(named(broken, /^text:/)[0].name, 'text:a teapot?\nno!');
  assert.ok(broken.kids[0].kids[0].path.box[3] > b1[3] + 48, 'a line taller (the tails end at the same point)');
  // The first baseline sits as far below the bubble's top in both (one line as before T9, 0.36 of a size
  // under the middle; several centred on the middle as a block).
  const drop = (d, b) => named(d, /^text:/)[0].xf[5] - b[1];
  assert.ok(Math.abs(drop(d1, b1) - 48 * (0.95 + 0.36)) < 6, `${drop(d1, b1)}`);
  assert.ok(Math.abs(drop(dl, bl) - drop(d1, b1)) < 8);
});

test('say: kind picks the bubble, audience the letter size and the hold, lane keeps the bubble between two xs', () => {
  const th = AMY.say('hmm', 0, { kind: 'thought' }).draw(0.2, 300, 600, 100);
  assert.ok(named(th, /^puffs$/).length);
  assert.throws(() => AMY.say('hi', 0, { kind: 'yell' }), /say kind 'yell'/);
  // An audience: bigger letters, and the line up for its reading time at the least.
  const text = 'the moon has no light of its own';
  const plain = AMY.say(text, 0), kids = AMY.say(text, 0, { audience: 'kids-5' });
  assert.equal(plain.until, plain.end + 0.75, 'no audience: the old 0.75 s');
  const words = 8, A = AUDIENCES['kids-5'];
  assert.ok(kids.until >= words / A.read - 1e-9 && kids.until - kids.end >= A.dwell - 1e-9);
  const size = (l) => named(l.draw(l.end, 300, 600, 100), /^text:/)[0].kids[0].w;
  assert.ok(size(kids) > size(plain));
  // lane: the bubble stays inside [x0, x1] even when its speaker faces out of it.
  const lane = [400, 900], d = AMY.say('over here', 0).draw(0.5, 420, 600, 100, { dir: -1, lane });
  const b = d.kids[0].kids[0].path.box;
  assert.ok(b[0] >= lane[0] - 4 && b[0] + b[2] <= lane[1] + 4, `${b}`);
});

test('dialogue: turns at a reading pace, each bubble up through the reply, the actors facing each other', () => {
  const talk = dialogue([
    [AMY, 'have you seen a teapot?', { emote: 'worried' }],
    [BEN, 'a teapot?', { kind: 'thought' }],
    [AMY, 'it ran away!', { kind: 'shout' }],
    [BEN, 'it went that way.', { kind: 'whisper' }],
  ], { t0: 0.5, where: WHERE });
  const T = talk.turns;
  assert.deepEqual(T.map((x) => [x.actor, x.kind]), [['amy', 'speech'], ['ben', 'thought'], ['amy', 'shout'], ['ben', 'whisper']]);
  assert.equal(T[0].t0, 0.5);
  for (let k = 1; k < T.length; k++) {
    assert.ok(T[k].t0 >= T[k - 1].end + 0.25 - 1e-9, 'a gap after each line');
    assert.ok(Math.abs(T[k].t0 * FPS - Math.round(T[k].t0 * FPS)) < 1e-6, 'on the grid');
    // Read before the reply: the line has been up for its words at the reading speed.
    const words = T[k - 1].text.split(/\s+/).length;
    assert.ok(T[k].t0 - T[k - 1].t0 >= words / AUDIENCES.general.read - 1e-9);
  }
  // A question and its answer are up together; a speaker's bubble goes when it speaks again.
  assert.ok(T[0].until > T[1].t0 && T[0].until <= T[2].t0 + 1e-9);
  const both = talk.draw(T[1].end - 0.01);
  assert.equal(named(both, /^say:/).length, 2);
  // Bubbles never cross: each keeps to its actor's lane.
  const [ba, bb] = named(both, /^say:/).map((g) => bounds(g.kids.filter((k) => k.name === 'bubble')));
  assert.ok(ba[0] + ba[2] <= bb[0] + 1, `${ba} | ${bb}`);
  // Facing: amy (left) faces right, ben faces left, whoever talks.
  for (const t of [0.6, T[1].t0 + 0.1, T[3].t0 + 0.1]) {
    assert.equal(talk.state(AMY, t).dir, 1);
    assert.equal(talk.state(BEN, t).dir, -1);
  }
  // The speaker's mouth moves while it speaks and the emote holds while its line is up.
  const worried = AMY.emote('worried');
  assert.ok(Object.entries(worried).every(([k, v]) => k === 'mouth' || talk.state(AMY, 0.6)[k] === v));
  assert.ok(Array.from({ length: 12 }, (_, j) => talk.state(AMY, 0.5 + j / 12).mouth).some((m) => m !== undefined && m !== 0));
  assert.equal(talk.state(BEN, 0.6).mouth, undefined, 'the listener is silent');
  // Events: every line's plucks, in order, placed with the shot.
  const ev = talk.events(10);
  assert.ok(ev.length >= 4 && ev.every((e, j) => !j || e.t >= ev[j - 1].t - 1e-9) && ev[0].t === 10.5);
  assert.equal(talk.draw(talk.until + 0.1), null);
  assert.equal(talk.until, Math.max(...T.map((x) => x.until)));
});

test('dialogue: where at draw time, a speaker speaking twice, gap and hold, bad turns', () => {
  const talk = dialogue([[AMY, 'one.'], [AMY, 'two.'], [BEN, 'three.']], { gap: 0.5, hold: 2 });
  const T = talk.turns;
  assert.ok(Math.abs(T[1].t0 - (T[0].end + 0.5)) < 1 / FPS + 1e-9);
  assert.ok(Math.abs(T[0].until - T[1].t0) < 1e-9, "a speaker's bubble gives way to its own next line");
  assert.ok(Math.abs(T[2].until - (T[2].end + 2)) < 1e-9, 'hold is the last line\'s');
  // No stage: state has no look; draw needs a place for everyone who speaks.
  assert.equal(talk.state(AMY, 0.1).dir, undefined);
  assert.throws(() => talk.draw(0.1), /place for amy/);
  const flipped = { amy: [800, 600, 100], ben: [200, 600, 100] };
  assert.equal(talk.state(AMY, 0.1, flipped).dir, -1);
  assert.ok(talk.draw(0.1, flipped));
  assert.throws(() => dialogue([]), /list of/);
  assert.throws(() => dialogue([['amy', 'hi']]), /turn 0/);
});

test('captions from copy: a page per string at the reading pace, lettered whole, the underline walking', () => {
  const C = captions(['the moon is a ball of rock', 'it has no light of its own'], { t0: 1, audience: 'kids-9' });
  const A = AUDIENCES['kids-9'];
  assert.equal(C.id, 'copy');
  assert.equal(C.words.length, 14);
  assert.ok(Math.abs(C.words[1].t0 - 1 / A.read) < 1e-9);
  assert.ok(Math.abs(C.words[7].t0 - (7 / A.read + A.dwell)) < 1e-9, 'the second string after a pause');
  const lines = (t) => named(C.draw(t), /^text:/).map((g) => g.name.slice(5));
  assert.deepEqual(lines(1.1), ['the moon is a ball of rock'], 'a page is the whole string, at once');
  assert.deepEqual(lines(1 + C.words[8].t0), ['it has no light of its own'], 'the next string opens a page');
  const u = (t) => named(C.draw(t), /^underline/).map((op) => +op.name.slice(9));
  assert.deepEqual(u(1 + C.words[3].t0 + 0.01), [3]);
  // Its letters scale with the audience.
  const g = (c) => named(c.draw(1.1), /^text:/)[0].kids[0].w;
  assert.ok(g(C) > g(captions(['the moon is a ball of rock'], { t0: 1 })));
  // Lint: copy captions are timed 'by: reading', not an estimate, and are not the shot's words.
  const a = shot('a', 6, ({ t, W, H }) => [paper(), meta('anchor', { name: 'strip' }), C.draw(t, { W, H })]);
  const z = shot('z', 2, () => [paper(), meta('anchor', { name: 'signOff' }), signOff('a', 'b')]);
  const L = lintAll(film({ name: 'copy', look: 'paperInk', timeline: seq(a, z) }));
  assert.deepEqual(L.findings.filter((f) => f.rule === 'words'), []);
  assert.deepEqual(L.warnings, []);
  assert.throws(() => captions([]), /non-empty/);
  assert.throws(() => captions(['ok', '  ']), /non-empty/);
});

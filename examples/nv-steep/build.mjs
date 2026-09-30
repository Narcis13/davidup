// Steep: 21 s, 1920x1080 (16:9), 30 fps. A teaser for a made-up loose-leaf tea, and the worked example of
// the new-video skill (.claude/skills/new-video). brief.md is the plan: the brief, the style card, the beats.
//   node .claude/skills/new-video/scripts/nv.mjs build examples/nv-steep
//   node .claude/skills/new-video/scripts/nv.mjs sheet examples/nv-steep
// Every time is on the bed's grid `g` (80 bpm: a beat 0.75 s, a bar 3 s); an act moves by moving its bar.
import { video } from '../../.claude/skills/new-video/scripts/kit.mjs';

const v = video({ dir: import.meta.dirname, w: 1920, h: 1080, fps: 30, dur: 21, bg: '#17110d' });
const { CX, CY, W, H } = v;

// ---- palette and type ----
const C = { ink: '#f5ecdf', dim: '#b9ab98', amber: '#e9a23b', terra: '#d4654a', sage: '#8fbfa8', bg: '#17110d' };
const DISPLAY = v.font('playfair-bold');
const TEXT = v.font('dm-sans-medium');

// ---- time ----
v.music('bed-calm-80', { volume: 0.6, fadeOut: 1.5 });
const g = v.bedBeats('bed-calm-80');
const ACT = { fast: 0, calm: g.bar(1), teapot: g.bar(2), three: g.bar(3, 2), take: g.bar(5), end: g.bar(6) };
for (const [name, t] of Object.entries(ACT)) v.marker(t, name);
const eighth = g.period / 2;

// ---- layers, back to front ----
v.layer('bg');
v.layer('objects');
v.layer('main');
v.layer('hand');   // the hand-drawn accents: over the picture, under the transitions
v.layer('fx');

// ---- background: warm light drifting, a quiet grid that ripples on the hits ----
v.aurora('bg', { colors: [C.amber, C.terra, '#6b3a22'], o: 0.24, blur: 170 });
v.dotGrid('bg', { color: C.ink, o: 0.1, gap: 72, size: 4, ripple: { t: ACT.calm, speed: 1600 } });

// ---- 1. fast: the words jump in on eighths and jitter ----
const fast = v.words('fast', 'Everything is fast.', { font: DISPLAY, size: 150, color: C.ink, x: CX, y: CY, t: 0.2, stagger: eighth, dur: 0.3, from: 'scale' }, 'main');
fast.ids.forEach((id, k) => {
  const at = 0.2 + k * eighth;
  v.sfx('sfx-pop', at, { volume: 0.5 });
  const { x, y } = v.item(id).transform;   // each word's own centre
  v.ring(`ring${k}`, { t: at + 0.05, x, y, d0: 60, d1: 700 + k * 200, width: 5, color: [C.amber, C.terra, C.ink][k], dur: 0.9 }, 'fx');
  v.shake(id, at + 0.45, { amplitude: 10, cycles: 4, dur: 0.3, axis: 'y' });
});
v.particles('fx', { t: 0.2 + 2 * eighth + 0.1, x: CX + 330, y: CY, n: 28, colors: [C.amber, C.terra, C.ink], radius: [120, 380], size: [5, 12] });
v.whip(fast.id, null, ACT.calm - 0.05, { dir: 'left', dur: 0.4 });

// ---- 2. calm: one line, slowly ----
v.flash(ACT.calm, { color: C.ink, dur: 0.35, o: 0.55 });
v.sfx('sfx-whoosh', ACT.calm - 0.3, { volume: 0.45 });
v.lineReveal('calm', 'Tea isn’t.', { font: DISPLAY, size: 200, color: C.ink, x: CX, y: CY, t: ACT.calm + 0.15, dur: 1.4, ease: 'snap' }, 'main');
v.drift('calm', ACT.calm, ACT.teapot, { s: [1, 1.05] });
v.lineHide('calm', ACT.teapot - 0.5, { dur: 0.45 });

// ---- 3. teapot: a real object with a history ----
const pot = v.library('teapot').record;
const potW = 780, potH = Math.round((pot.h / pot.w) * potW);
v.add('teapot', v.sprite('teapot', potW, potH, { x: 1340, y: 600, effects: [{ type: 'shadow', color: 'rgba(0,0,0,0.55)', blur: 40, offsetX: 0, offsetY: 28 }] }), 'objects');
v.rise('teapot', ACT.teapot + 0.1, { dy: 90, dur: 1.1 });
v.drift('teapot', ACT.teapot + 1.2, ACT.three - 0.2, { s: [1, 1.04] });
v.sfx('sfx-whoosh', ACT.teapot - 0.2, { volume: 0.4 });
v.lineReveal('potTitle', 'Steeped\nin patience.', { font: DISPLAY, size: 120, color: C.ink, x: 500, y: CY, lineHeight: 1.1, t: ACT.teapot + 0.5, dur: 1.2 }, 'main');
v.add('potSub', v.text('Teapot, ca. 1755', { font: TEXT, size: 34, color: C.dim, x: 500, y: CY + 190 }), 'main');
v.rise('potSub', ACT.teapot + 1.3, { dy: 24 });

// ---- 4. three minutes ----
v.wipe(ACT.three, { colors: [C.terra, C.amber, C.ink], dir: 'left' });
v.sfx('sfx-whoosh', ACT.three - 0.45, { volume: 0.5 });
for (const id of ['teapot', 'potTitle', 'potSub']) v.item(id).exit = ACT.three;
v.lineReveal('three', 'Three minutes.', { font: DISPLAY, size: 130, color: C.ink, x: 1120, y: 380, t: ACT.three + 0.15, dur: 1.0 }, 'main');
const glass = v.library('hourglass').record, gH = 620, gW = Math.round((glass.w / glass.h) * gH);
v.add('glass', v.sprite('hourglass', gW, gH, { x: 430, y: CY + 20, effects: [{ type: 'shadow', color: 'rgba(0,0,0,0.5)', blur: 30, offsetX: 0, offsetY: 20 }] }), 'objects');
v.rise('glass', ACT.three + 0.1, { dy: 60, dur: 0.9 });
v.tw('glass', 'r', 0, Math.PI, ACT.three + 1.1, 0.7, 'swift');   // the glass is turned over
const T0 = ACT.three + 1.5, TD = 4 * g.period;
const timer = v.counter('timer', { from: 0, to: 180, t: T0, dur: TD, ease: 'linear', format: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`, font: DISPLAY, size: 230, color: C.amber, x: 1120, y: 640, until: ACT.take }, 'main');
v.fadeIn(timer.id, ACT.three + 0.9, 0.4);
v.bar('timeBar', { x: 820, y: 800, len: 600, thick: 10, color: C.amber, t: T0, dur: TD, ease: 'linear', exit: ACT.take }, 'main');
for (let k = 1; k <= 4; k++) v.sfx('sfx-tick', T0 + k * g.period - 0.05, { volume: 0.5 });
for (const id of ['three', 'glass']) v.item(id).exit = ACT.take;

// ---- 5. take them: the fox takes the break ----
v.wipe(ACT.take, { colors: [C.sage, C.amber, C.ink], dir: 'left' });
v.sfx('sfx-whoosh', ACT.take - 0.45, { volume: 0.5 });
const cup = v.library('cup').record, cupW = 520, cupH = Math.round((cup.h / cup.w) * cupW);
v.add('cup', v.sprite('cup', cupW, cupH, { x: 1320, y: 660, effects: [{ type: 'shadow', color: 'rgba(0,0,0,0.5)', blur: 30, offsetX: 0, offsetY: 20 }], exit: ACT.end }), 'objects');
v.pop('cup', ACT.take + 0.2, { from: 0.6, dur: 0.6 });
v.sfx('sfx-pop', ACT.take + 0.2, { volume: 0.45 });
const arrive = v.character('fox', 'fox-sprite', { from: 760, to: 900, y: 930, h: 520, t: ACT.take + 0.1, then: 'wave', until: ACT.end, layer: 'objects' });
v.lineReveal('takeTitle', 'Take them.', { font: DISPLAY, size: 150, color: C.ink, x: 540, y: 330, t: ACT.take + 0.4, dur: 1.0, exit: ACT.end }, 'main');

// ---- 6. end card ----
v.wipe(ACT.end, { colors: [C.terra, C.amber, C.ink], dir: 'left' });
v.sfx('sfx-whoosh', ACT.end - 0.45, { volume: 0.45 });
v.add('mark', v.text('STEEP', { font: DISPLAY, size: 230, color: C.ink, x: CX, y: CY - 40, letterSpacing: 18, enter: ACT.end }), 'main');
v.trackIn('mark', ACT.end + 0.1, { from: 70, dur: 1.6 });
v.fadeIn('mark', ACT.end + 0.1, 0.6);
v.add('tagline', v.text('loose leaf, slowly.', { font: TEXT, size: 46, color: C.dim, x: CX, y: CY + 110, enter: ACT.end }), 'main');
v.rise('tagline', ACT.end + 0.7, { dy: 26 });
v.add('url', v.text('steep.tea', { font: TEXT, size: 40, color: C.amber, x: CX, y: CY + 190, enter: ACT.end }), 'main');
v.rise('url', ACT.end + 1.0, { dy: 26 });
v.sfx('sfx-ding', ACT.end + 0.15, { volume: 0.45 });

// ---- the hand: chalk marks over the frame ----
const hand = v.hand({ look: 'chalkboard', ink: C.ink, colors: [C.ink, C.amber, C.terra, C.sage], w: 4.5 });
hand.circle({ of: 'teapot', grow: 0.8, at: ACT.teapot + 1.6, dur: 0.7, color: 1, until: ACT.three });
hand.callout({ text: 'since 1755', of: 'teapot', grow: 0.8, at: ACT.teapot + 2.3, dur: 1.0, dir: -Math.PI / 4, reach: 150, size: 56, color: 0, until: ACT.three });
hand.underline({ of: 'three', at: ACT.three + 1.2, color: 1, until: ACT.take });
hand.star({ of: 'cup', at: arrive, color: 1, until: ACT.end });
hand.underline({ of: 'mark', at: ACT.end + 1.3, boxAt: ACT.end + 2.0, color: 1 });

// ---- texture over everything ----
v.texture('paper-kraft', { blend: 'overlay', o: 0.18 });

v.write();

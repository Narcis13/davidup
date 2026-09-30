// {{TITLE}}: {{DUR}} s, {{W}}x{{H}} ({{AR}}), {{FPS}} fps. The video as a program; brief.md is the plan.
//   node .claude/skills/new-video/scripts/nv.mjs build <this folder>     composition.json, hand accents, validate
//   node .claude/skills/new-video/scripts/nv.mjs sheet <this folder>     look at it
// Every time below is on the beat grid `g`; move an act by moving its bar, not its seconds.
import { video, beats } from '{{KIT}}';

const v = video({ dir: import.meta.dirname, w: {{W}}, h: {{H}}, fps: {{FPS}}, dur: {{DUR}}, bg: '#0d0f14' });
const { CX, CY, W, H } = v;

// ---- palette and type (the style card) ----
const C = { ink: '#f4f1ea', dim: '#8a8f9c', a1: '#ff4d6d', a2: '#ffc23d', a3: '#3de8ff' };
const DISPLAY = v.font('font:default');   // a library face: `nv find --kind font`, then v.font('<id>')
const TEXT = v.font('font:default');

// ---- time: the music and its grid ----
v.music('bed-bright', { volume: 0.55 });   // or a bed made to measure (`nv bed`) or a file ('assets/track.mp3')
const g = v.bedBeats('bed-bright');        // for a file: beats({ bpm, offset }) from `nv beats`
const ACT = { hook: 0, one: g.bar(1), two: g.bar(3), end: Math.min(g.bar(5), v.dur - 3) };
for (const [name, t] of Object.entries(ACT)) v.marker(t, name);

// ---- layers, back to front: the hand-drawn accents over the picture and under the transitions;
// v.texture() adds a blended 'texture' layer over everything ----
v.layer('bg');
v.layer('main');
v.layer('hand');
v.layer('fx');

// ---- background: never a dead flat field ----
v.aurora('bg', { colors: [C.a1, C.a3, '#6b4cff'], o: 0.28 });
v.dotGrid('bg', { color: C.ink, o: 0.12, ripple: { t: ACT.one } });

// ---- hook ----
v.lineReveal('hook', 'Start with the hook', { font: DISPLAY, size: 132, color: C.ink, t: 0.25, x: CX, y: CY }, 'main');
v.lineHide('hook', ACT.one - 0.45);

// ---- act one ----
const one = v.words('one', 'Say one thing per shot', { font: DISPLAY, size: 110, color: C.ink, x: CX, y: CY, t: ACT.one + 0.1 }, 'main');
v.leave(one.id, ACT.two - 0.4);
v.flash(ACT.one, { color: C.a2, dur: 0.25, o: 0.5 });
v.sfx('sfx-whoosh', ACT.one - 0.2, { volume: 0.5 });

// ---- act two ----
v.wipe(ACT.two, { colors: [C.a3, C.a1, C.ink], dir: 'left' });
v.sfx('sfx-whoosh', ACT.two - 0.35, { volume: 0.5 });
const stat = v.counter('stat', { from: 0, to: 100, suffix: '%', t: ACT.two + 0.2, dur: 1.4, font: DISPLAY, size: 220, color: C.a2, x: CX, y: CY - 40 }, 'main');
v.rise(stat.id, ACT.two + 0.1, { dy: 50 });
v.bar('statBar', { x: CX - 300, y: CY + 110, len: 600, thick: 10, color: C.a2, t: ACT.two + 0.2, dur: 1.4 }, 'main');

// ---- end card ----
v.add('endTitle', v.text('{{TITLE}}', { font: DISPLAY, size: 150, color: C.ink, x: CX, y: CY - 30, enter: ACT.end }), 'main');
v.trackIn('endTitle', ACT.end + 0.1, { from: 60, dur: 1.2 });
v.fadeIn('endTitle', ACT.end + 0.1, 0.5);
v.add('endCta', v.text('your.url', { font: TEXT, size: 44, color: C.dim, x: CX, y: CY + 80, enter: ACT.end }), 'main');
v.rise('endCta', ACT.end + 0.6);
v.sfx('sfx-ding', ACT.end + 0.1, { volume: 0.45 });
for (const id of ['stat', 'statBar']) v.item(id).exit = ACT.end;

// ---- hand-drawn accents (drawn by the handdrawn package over everything) ----
const hand = v.hand({ look: 'paperInk', ink: C.ink, colors: [C.a1, C.a2, C.a3] });
hand.underline({ of: 'endTitle', at: ACT.end + 1.2, color: 0 });

v.write();

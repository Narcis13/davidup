// kit: a davidup composition written as a program. A video project's build.mjs imports this, describes the
// film in acts on a beat grid, and calls v.write(); `nv build` runs it, renders the hand-drawn accents it
// asked for, and validates. Plain JS on node (no build step); the output is ordinary davidup JSON (schema
// 0.1), so `davidup render`, the editor and the MCP tools all read it.
//
//   import { video, EASE, beats } from '<rel>/.claude/skills/new-video/scripts/kit.mjs';
//   const v = video({ dir: import.meta.dirname, w: 1920, h: 1080, fps: 30, dur: 20, bg: '#0b0d17' });
//   v.layer('bg'); v.layer('main');
//   v.add('title', v.text('Hello', { font: v.font('font:default'), size: 140, color: '#fff', x: 960, y: 540 }), 'main');
//   v.anim('title', 0.4, 0.8, { y: [600, 540], o: [0, 1] }, 'snap');
//   v.write();
//
// Everything is in composition pixels and seconds. Items default to anchor 0.5 (their centre on x, y), so a
// scale or a rotation turns about the middle. The reference is references/kit.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, FontLibrary } from 'skia-canvas';
import { openLibrary, standardShelves } from '../../../../assetlib/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../../..');

// ---------- easing ----------

// davidup's 19 names plus short aliases and a few curves motion designers reach for.
export const EASE = Object.freeze({
  linear: 'linear',
  in: 'easeInCubic', out: 'easeOutCubic', inOut: 'easeInOutCubic',
  inQuad: 'easeInQuad', outQuad: 'easeOutQuad', inOutQuad: 'easeInOutQuad',
  inQuart: 'easeInQuart', outQuart: 'easeOutQuart', inOutQuart: 'easeInOutQuart',
  inExpo: 'easeInExpo', outExpo: 'easeOutExpo', inOutExpo: 'easeInOutExpo',
  inBack: 'easeInBack', outBack: 'easeOutBack', inOutBack: 'easeInOutBack',
  inSine: 'easeInSine', outSine: 'easeOutSine', sine: 'easeInOutSine',
  snap: { bezier: [0.16, 1, 0.3, 1] },      // fast out, long soft landing: the default entrance
  swift: { bezier: [0.65, 0, 0.35, 1] },    // decisive in-out: moves, camera, wipes
  punch: { bezier: [0.34, 1.56, 0.64, 1] }, // overshoots a little and settles: pops, stamps
  accel: { bezier: [0.7, 0, 0.84, 0] },     // leaves fast: exits
  glide: { bezier: [0.45, 0, 0.55, 1] },    // gentle in-out: drifts, ambient loops
});
export const steps = (n) => ({ steps: n });
const easeOf = (e, dflt = 'snap') => {
  const k = e ?? dflt;
  if (typeof k === 'object') return k;
  return EASE[k] ?? k;
};

// ---------- small helpers ----------

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// Hex colour with an alpha 0..1 appended.
export function withAlpha(hex, a) {
  const h = hex.replace('#', ''), full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return `#${full}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`;
}

// A transform from shorthand: x y, s (both scales) sx sy, r (radians), a (both anchors) ax ay, o (opacity).
export function tf(o = {}, anchor = 0.5) {
  return {
    x: o.x ?? 0, y: o.y ?? 0,
    scaleX: o.sx ?? o.s ?? 1, scaleY: o.sy ?? o.s ?? 1,
    rotation: o.r ?? 0,
    anchorX: o.ax ?? o.a ?? anchor, anchorY: o.ay ?? o.a ?? anchor,
    opacity: o.o ?? o.opacity ?? 1,
  };
}
const FLAGS = ['visible', 'locked', 'name', 'enter', 'exit', 'effects'];
const flags = (o) => Object.fromEntries(FLAGS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// Tween property shorthand.
const PROP = { x: 'transform.x', y: 'transform.y', sx: 'transform.scaleX', sy: 'transform.scaleY', r: 'transform.rotation', o: 'transform.opacity', ax: 'transform.anchorX', ay: 'transform.anchorY', opacity: 'transform.opacity', rotation: 'transform.rotation' };

// ---------- beats ----------

// A beat grid: `bpm` (or `period` seconds), the first beat at `offset`, `perBar` beats a bar, up to `dur`.
//   g.t(n) the nth beat (from 0), g.bar(b, beat = 0), g.snap(t), g.times, g.markers(name) for an audio track
export function beats({ bpm, period, offset = 0, perBar = 4, dur = 600 } = {}) {
  const p = period ?? 60 / bpm;
  if (!(p > 0)) throw new TypeError('beats: needs bpm or period');
  const times = [];
  for (let t = offset; t < dur - 1e-9; t += p) times.push(r3(t));
  const g = {
    period: p, bpm: 60 / p, offset, perBar, times,
    t: (n) => r3(offset + n * p),
    bar: (b, beat = 0) => r3(offset + (b * perBar + beat) * p),
    snap: (t) => r3(offset + Math.round((t - offset) / p) * p),
    // track markers are seconds into the source file; with trimIn 0 and start 0 they are timeline seconds
    markers: (name = 'beat', { every = 1, from = 0 } = {}) => times.filter((_, k) => k % every === 0 && k >= from).map((t) => ({ t, name })),
  };
  return g;
}

// ---------- the library ----------

let LIB = null;
const libFor = (dir) => (LIB ??= openLibrary({ shelves: standardShelves({ project: dir }) }));

// ---------- fonts and measuring ----------

const FAMILIES = new Map();   // font asset id -> family registered with skia for measuring
function registerFamily(fontId, family, path) {
  if (FAMILIES.has(fontId)) return;
  try { if (path && existsSync(path)) FontLibrary.use(family, [path]); } catch { /* measured with a fallback */ }
  FAMILIES.set(fontId, family);
}
registerFamily('font:default', 'Inter', join(REPO, 'fonts', 'Inter-Regular.ttf'));
const MEASURE = new Canvas(8, 8).getContext('2d');

// ---------- the video ----------

export function video(opts) { return new Video(opts); }

export class Video {
  constructor({ dir, w = 1920, h = 1080, fps = 30, dur = 20, bg = '#000000', audioMaster = { limiter: true, targetLufs: -14 }, comment } = {}) {
    if (!dir) throw new TypeError('video: pass { dir: import.meta.dirname } so assets and outputs resolve against the project');
    if (w % 2 || h % 2) throw new TypeError(`video: ${w}x${h} — H.264 needs even sizes`);
    Object.assign(this, { dir: resolve(dir), W: w, H: h, fps, dur, bg, audioMaster, comment });
    this.CX = w / 2; this.CY = h / 2;
    this.items = {}; this.layers = []; this.tweens = []; this.assets = []; this.audio = []; this.markers = [];
    this.templates = {}; this.behaviors = {};
    this._n = 0; this._accents = null; this.credits = [];
  }

  // ----- structure -----

  // A layer, painted above the ones before it. { blend: 'multiply', o: 0.5, enter, exit }
  layer(id, o = {}) {
    if (this.layers.some((l) => l.id === id)) return id;
    this.layers.push({ id, z: this.layers.length * 10, opacity: o.o ?? 1, blendMode: o.blend ?? 'normal', items: [], ...flags(o) });
    return id;
  }

  // Put an item in the composition, in a layer when one is named (an item a group lists is in no layer).
  add(id, item, layer) {
    if (this.items[id]) throw new Error(`kit: item '${id}' exists`);
    this.items[id] = item;
    if (layer) {
      const L = this.layers.find((l) => l.id === layer);
      if (!L) throw new Error(`kit: no layer '${layer}' (v.layer('${layer}') first)`);
      L.items.push(id);
    }
    return id;
  }
  item(id) { const it = this.items[id]; if (!it) throw new Error(`kit: no item '${id}'`); return it; }

  // ----- items (plain objects; add them with v.add) -----

  text(str, o = {}) {
    const it = { type: 'text', text: String(str), font: o.font ?? 'font:default', fontSize: o.size ?? 64, color: o.color ?? '#ffffff', transform: tf(o) };
    for (const [k, f] of [['align', 'align'], ['maxWidth', 'maxWidth'], ['lineHeight', 'lineHeight'], ['letterSpacing', 'letterSpacing'], ['weight', 'fontWeight'], ['style', 'fontStyle'], ['strokeColor', 'strokeColor'], ['strokeWidth', 'strokeWidth'], ['shadow', 'shadow']]) if (o[k] !== undefined) it[f] = o[k];
    if (o.align === undefined && (o.a ?? o.ax ?? 0.5) === 0.5) it.align = 'center';
    return { ...it, ...flags(o) };
  }
  rect(w, h, o = {}) { return this._shape('rect', { width: w, height: h, ...(o.radius !== undefined ? { cornerRadius: o.radius } : {}) }, o); }
  circle(d, o = {}) { return this._shape('circle', { width: d, height: d }, o); }
  poly(points, o = {}) { return this._shape('polygon', { points }, o); }
  _shape(kind, dims, o) {
    // skia-canvas 3.0.8 drops everything drawn before an opaque rect path at least the frame's size that sits
    // partly off-canvas under a transform (a wipe panel mid-slide blanks the frame); a round-rect path of
    // radius 1 is drawn correctly and looks the same
    if (kind === 'rect' && dims.width >= this.W && dims.height >= this.H && !dims.cornerRadius) dims.cornerRadius = 1;
    const it = { type: 'shape', kind, ...dims, transform: tf(o) };
    if (o.fill !== undefined) it.fillColor = o.fill;
    if (o.stroke !== undefined) { it.strokeColor = o.stroke; it.strokeWidth = o.strokeWidth ?? 2; }
    if (it.fillColor === undefined && it.strokeColor === undefined) it.fillColor = '#ffffff';
    return { ...it, ...flags(o) };
  }
  sprite(asset, w, h, o = {}) {
    const it = { type: 'sprite', asset, width: w, height: h, transform: tf(o) };
    if (o.tint !== undefined) it.tint = o.tint;
    if (o.cycle !== undefined) it.cycle = o.cycle;
    if (o.frame !== undefined) it.frame = o.frame;
    return { ...it, ...flags(o) };
  }
  clip(asset, w, h, o = {}) {
    const it = { type: 'video', asset, width: w, height: h, start: o.start ?? 0, fit: o.fit ?? 'cover', loop: o.loop ?? false, transform: tf(o) };
    for (const k of ['end', 'trimIn', 'trimOut', 'keepAudio']) if (o[k] !== undefined) it[k] = o[k];
    return { ...it, ...flags(o) };
  }
  // A group; `box: true` gives it the frame as its box (so anchor 0.5 pivots on the frame's centre).
  group(children, o = {}) {
    const it = { type: 'group', items: children, transform: tf(o, o.width || o.box ? 0.5 : 0) };
    if (o.box) { it.width = this.W; it.height = this.H; }
    if (o.width !== undefined) it.width = o.width;
    if (o.height !== undefined) it.height = o.height;
    if (o.isolate) it.isolate = true;
    if (o.blend) it.blendMode = o.blend;
    return { ...it, ...flags(o) };
  }
  // A davidup template instance (built-ins titleCard, lowerThird, captionBurst, bulletList, kenburnsImage;
  // or 'global:<id>' from the library), its tweens starting at `start` (`nv` lists params: the davidup
  // README, "Level 3").
  template(id, name, params, layer, { start = 0 } = {}) { return this.add(id, { $template: name, params, start }, layer); }

  // ----- tweens -----

  // One property from `from` to `to` over [start, start + dur). Throws on an overlap with another tween of
  // the same item and property (davidup's E_TWEEN_OVERLAP, found at build time with both named).
  tw(target, prop, from, to, start, dur, ease) {
    const property = PROP[prop] ?? prop;
    if (!(dur > 0)) throw new Error(`kit: tween ${target}.${property} at ${start}s has duration ${dur}`);
    const s = r3(start), e = r3(start + dur);
    for (const t of this.tweens) {
      if (t.target !== target || t.property !== property || t.$behavior) continue;
      if (s < t.start + t.duration - 1e-6 && t.start < e - 1e-6) {
        throw new Error(`kit: ${target}.${property} ${s}..${e}s overlaps ${t.id} (${t.start}..${r3(t.start + t.duration)}s); end one before the other starts`);
      }
    }
    const id = `${target}.${property.replace('transform.', '')}@${s}#${this._n++}`;
    this.tweens.push({ id, target, property, from, to, start: s, duration: r3(dur), easing: easeOf(ease) });
    return this;
  }
  // Several properties at once: v.anim('title', 1.2, 0.6, { y: [620, 540], o: [0, 1], s: [0.9, 1] }, 'snap').
  // `s` tweens both scales.
  anim(target, start, dur, props, ease) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 's') { this.tw(target, 'sx', v[0], v[1], start, dur, ease); this.tw(target, 'sy', v[0], v[1], start, dur, ease); }
      else this.tw(target, k, v[0], v[1], start, dur, ease);
    }
    return this;
  }
  // A built-in behavior (fadeIn fadeOut popIn popOut slideIn slideOut rotateSpin kenburns shake colorCycle pulse).
  behavior(name, target, start, dur, params = {}, ease) {
    this.tweens.push({ $behavior: name, target, start: r3(start), duration: r3(dur), params, ...(ease ? { easing: easeOf(ease) } : {}) });
    return this;
  }

  // ----- assets -----

  asset(id, type, src, extra = {}) {
    const have = this.assets.find((a) => a.id === id);
    if (have) return id;
    this.assets.push({ id, type, src, ...extra });
    return id;
  }
  // A record of the asset library (project, user, house shelves), registered with its pinned src, credit and
  // licence; returns { id, record } (record: w h sec sheet family colours dark room ...).
  library(libId, { as } = {}) {
    const lib = libFor(this.dir);
    let rec, use;
    try { rec = lib.get(libId); use = lib.use(libId); } catch { rec = null; }
    if (!rec) throw new Error(`kit: no '${libId}' on the project, user or house shelf (nv find ${libId})`);
    if (!use?.davidup) throw new Error(`kit: '${libId}' (${rec.kind}) cannot go into davidup directly${use?.davidup === null ? '' : ''}; see asset show ${libId}`);
    const { id: _id, type, ...args } = use.davidup.args, id = as ?? libId;
    this.asset(id, type, args.src, Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'src')));
    if (rec.credit || rec.licence) this.credits.push({ id: libId, licence: rec.licence, credit: rec.credit ?? '' });
    if (type === 'font') registerFamily(id, args.family ?? rec.family, lib.locate(libId)?.path);
    return { id, record: rec, sheet: args.sheet };
  }
  // A sprite sheet `hdf sprite` wrote (its png and the json beside it) as an image asset with its sheet:
  // any puppet or stick figure, `node handdrawn/cli/hdf.mjs sprite stick:sam --states idle,walk,wave --alpha
  // --out <project>/hdf`. -> { id, sheet } for v.sprite(id, ...) or v.character(name, { id, sheet }, ...).
  spriteSheet(id, png, json = png.replace(/\.png$/, '.json')) {
    const j = JSON.parse(readFileSync(resolve(this.dir, json), 'utf8'));
    const sheet = Object.fromEntries(['frameWidth', 'frameHeight', 'columns', 'count', 'fps', 'cycles', 'anchor'].filter((k) => j[k] !== undefined).map((k) => [k, j[k]]));
    this.asset(id, 'image', relative(this.dir, resolve(this.dir, png)), { sheet });
    return { id, sheet };
  }
  // A font to letter with: 'font:default' (Inter, bundled), a library id, or a file path. Returns the id a
  // text item names.
  font(ref, { family, as } = {}) {
    if (ref === 'font:default') return ref;
    if (/\.(ttf|otf|woff2?)$/i.test(ref)) {
      const id = as ?? `font-${ref.split('/').pop().replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const fam = family ?? id;
      const src = relative(this.dir, resolve(this.dir, ref));
      this.asset(id, 'font', src, { family: fam });
      registerFamily(id, fam, resolve(this.dir, ref));
      return id;
    }
    return this.library(ref, { as }).id;
  }

  // The width of a line of text as davidup lays it out (skia measures the same font the renderer loads).
  measure(str, { font = 'font:default', size = 64, letterSpacing = 0, weight } = {}) {
    const fam = FAMILIES.get(font) ?? 'Inter';
    MEASURE.font = `${weight ?? 'normal'} ${size}px "${fam}"`;
    const s = String(str);
    return MEASURE.measureText(s).width + letterSpacing * Math.max(0, [...s].length - 1);
  }
  // Greedy word wrap at maxWidth, as the engine wraps.
  wrap(str, { maxWidth, ...m } = {}) {
    const out = [];
    for (const para of String(str).split('\n')) {
      if (!maxWidth) { out.push(para); continue; }
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${w}` : w;
        if (line && this.measure(next, m) > maxWidth) { out.push(line); line = w; } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  // The box [x, y, w, h] a text item paints at rest (its own transform, no parents, no tweens). For an exact
  // box at a time, `nv boxes <project> --at t`.
  boxOf(id) {
    const it = this.item(id);
    if (it.type !== 'text') throw new Error(`kit: boxOf '${id}': text items only`);
    const m = { font: it.font, size: it.fontSize, letterSpacing: it.letterSpacing ?? 0, weight: it.fontWeight };
    const lines = this.wrap(it.text, { maxWidth: it.maxWidth, ...m });
    const w = it.maxWidth ?? Math.max(...lines.map((l) => this.measure(l, m))), h = lines.length * (it.lineHeight ?? 1.2) * it.fontSize;
    const T = it.transform, sw = w * Math.abs(T.scaleX), sh = h * Math.abs(T.scaleY);
    return [Math.round(T.x - T.anchorX * sw), Math.round(T.y - T.anchorY * sh), Math.round(sw), Math.round(sh)];
  }

  // ----- markers and sound -----

  marker(t, name) { this.markers.push({ t: r3(t), name }); return this; }
  // A music bed: a library id or a path; { start, end, volume, fadeIn, fadeOut, loop, trimIn, markers }.
  music(ref, o = {}) {
    const id = this._audioAsset(ref, o.as);
    this.audio.push({ id: o.track ?? `music-${this.audio.length}`, asset: id, start: o.start ?? 0, ...(o.end !== undefined ? { end: o.end } : { end: this.dur }),
      volume: o.volume ?? 0.8, ...(o.fadeIn !== undefined ? { fadeIn: o.fadeIn } : { fadeIn: 0.3 }), fadeOut: o.fadeOut ?? 1.2,
      ...(o.loop !== undefined ? { loop: o.loop } : { loop: true }), ...(o.trimIn !== undefined ? { trimIn: o.trimIn } : {}), ...(o.markers ? { markers: o.markers } : {}) });
    return id;
  }
  // A sound at t: a library id (sfx-pop, sfx-whoosh, ...) or a path.
  sfx(ref, t, o = {}) {
    const id = this._audioAsset(ref, o.as);
    this.audio.push({ id: `sfx-${this.audio.length}-${id}`, asset: id, start: r3(Math.max(0, t)), volume: o.volume ?? 0.7, ...(o.end !== undefined ? { end: o.end } : {}) });
    return this;
  }
  _audioAsset(ref, as) {
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(ref)) {
      const id = as ?? ref.split('/').pop().replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return this.asset(id, 'audio', relative(this.dir, resolve(this.dir, ref)));
    }
    return this.library(ref, { as }).id;
  }
  // The beat grid of a library bed made by `synth sample` (its bars and length say its tempo exactly).
  bedBeats(libId, { offset = 0 } = {}) {
    let rec = null;
    try { rec = libFor(this.dir).get(libId); } catch { /* reported below */ }
    const bars = rec?.made?.args?.bars, sec = rec?.sec;
    if (!bars || !sec) throw new Error(`kit: '${libId}' does not say its bars (not a synth bed); run nv beats on it`);
    return beats({ period: sec / (bars * 4), offset, dur: this.dur });
  }

  // ----- entrances, exits, emphasis -----

  // Rise into place: from dy below, fading in.
  rise(id, t, { dy = 60, dur = 0.7, ease = 'snap', fade = true } = {}) {
    const T = this.item(id).transform;
    this.tw(id, 'y', T.y + dy, T.y, t, dur, ease);
    if (fade) this.tw(id, 'o', 0, T.opacity || 1, t, Math.min(dur, 0.35), 'outQuad');
    T.opacity = fade ? 0 : T.opacity;
    return r3(t + dur);
  }
  // Pop in from a smaller scale, overshooting a little.
  pop(id, t, { from = 0.4, dur = 0.5, ease = 'punch', fade = true } = {}) {
    const T = this.item(id).transform, s = T.scaleX;
    this.anim(id, t, dur, { s: [s * from, s] }, ease);
    if (fade) { this.tw(id, 'o', 0, T.opacity || 1, t, Math.min(dur, 0.2), 'outQuad'); T.opacity = 0; }
    return r3(t + dur);
  }
  // Leave: up (dy < 0) or down, fading out, accelerating.
  leave(id, t, { dy = -40, dur = 0.4, ease = 'accel', s } = {}) {
    const T = this.item(id).transform;
    if (dy) this.tw(id, 'y', T.y, T.y + dy, t, dur, ease);
    if (s !== undefined) this.anim(id, t, dur, { s: [T.scaleX, s] }, ease);
    this.tw(id, 'o', T.opacity || 1, 0, t, dur, 'inQuad');
    return r3(t + dur);
  }
  fadeIn(id, t, dur = 0.4, ease = 'outQuad') { const T = this.item(id).transform, o = T.opacity || 1; T.opacity = 0; this.tw(id, 'o', 0, o, t, dur, ease); return r3(t + dur); }
  fadeOut(id, t, dur = 0.4, ease = 'inQuad') { this.tw(id, 'o', this.item(id).transform.opacity || 1, 0, t, dur, ease); return r3(t + dur); }
  // Tracking tightens as it fades in: the premium title move.
  trackIn(id, t, { from = 40, dur = 1.2, ease = 'snap' } = {}) {
    const it = this.item(id), to = it.letterSpacing ?? 0;
    it.letterSpacing = from;
    this.tw(id, 'letterSpacing', from, to, t, dur, ease);
    return r3(t + dur);
  }
  // A slow push-in (or drift) across a hold, so nothing sits dead still.
  drift(id, t0, t1, { s = [1, 1.05], x, y, r, ease = 'glide' } = {}) {
    const props = { s };
    if (x) props.x = x;
    if (y) props.y = y;
    if (r) props.r = r;
    this.anim(id, t0, t1 - t0, props, ease);
    return this;
  }
  // A short shake on a beat (the built-in behavior).
  shake(id, t, { amplitude = 12, cycles = 3, dur = 0.3, axis = 'x' } = {}) {
    return this.behavior('shake', id, t, dur, { amplitude, cycles, axis, center: this.item(id).transform[axis] });
  }

  // ----- text in motion -----

  // A line (or lines) revealed from behind a mask: slides up out of nothing. Returns the group id; the text is
  // `${id}_t`. o: text options plus { t, dur, dir: 'up' | 'down', maskW }.
  lineReveal(id, str, o = {}, layer) {
    const size = o.size ?? 96, lh = o.lineHeight ?? 1.15, m = { font: o.font, size, letterSpacing: o.letterSpacing, weight: o.weight };
    const lines = this.wrap(str, { maxWidth: o.maxWidth, ...m });
    const bh = lines.length * lh * size, w = o.maskW ?? (o.maxWidth ?? Math.max(...lines.map((l) => this.measure(l, m)))) + size;
    const t = o.t ?? 0, dur = o.dur ?? 0.8, dir = o.dir === 'down' ? -1 : 1;
    const { x = this.CX, y = this.CY, t: _t, dur: _d, dir: _dir, maskW: _mw, ...textOpts } = o;
    this.add(`${id}_t`, this.text(str, { ...textOpts, lineHeight: lh, x: 0, y: dir * bh * 1.08 }));
    this.add(`${id}_mr`, this.rect(w, bh * 1.12, { fill: '#ffffff' }));
    this.add(`${id}_m`, this.group([`${id}_mr`], { blend: 'destination-in' }));
    this.add(id, this.group([`${id}_t`, `${id}_m`], { x, y, isolate: true, ...flags(o) }), layer);
    this.tw(`${id}_t`, 'y', dir * bh * 1.08, 0, t, dur, o.ease ?? 'snap');
    return id;
  }
  // Hide a lineReveal the way it came (or the other way).
  lineHide(id, t, { dur = 0.5, dir = 'up', ease = 'accel' } = {}) {
    const txt = this.item(`${id}_t`), bh = (this.item(`${id}_mr`).height) / 1.12;
    this.tw(`${id}_t`, 'y', 0, (dir === 'down' ? 1 : -1) * bh * 1.08, t, dur, ease);
    void txt;
    return r3(t + dur);
  }

  // Words laid out as one line block (wrapped at maxWidth), each its own item, arriving one after another,
  // inside a group `id` (move or leave the block as one). o: text options + { x, y, t, stagger = 0.08,
  // dur = 0.55, from: 'up' | 'down' | 'scale' | 'blur' | 'fade', align: 'center' | 'left', gap, colors }
  // -> { id, ids, end }. The words are `${id}_w${k}`.
  words(id, str, o = {}, layer) {
    const size = o.size ?? 96, lh = o.lineHeight ?? 1.15, m = { font: o.font, size, letterSpacing: o.letterSpacing, weight: o.weight };
    const lines = this.wrap(str, { maxWidth: o.maxWidth, ...m }), space = this.measure(' ', m) + (o.gap ?? 0);
    const x0 = o.x ?? this.CX, y0 = o.y ?? this.CY, t = o.t ?? 0, st = o.stagger ?? 0.08, dur = o.dur ?? 0.55, from = o.from ?? 'up';
    const align = o.align ?? 'center', ids = [], { x: _x, y: _y, t: _t, stagger: _s, dur: _d, from: _f, align: _a, gap: _g, maxWidth: _mw, colors, ...textOpts } = o;
    let k = 0;
    lines.forEach((line, li) => {
      const ws = line.split(/\s+/).filter(Boolean), widths = ws.map((w) => this.measure(w, m));
      const total = widths.reduce((s, w) => s + w, 0) + space * (ws.length - 1);
      let x = align === 'left' ? x0 : x0 - total / 2;
      const y = y0 + (li - (lines.length - 1) / 2) * lh * size;
      ws.forEach((w, j) => {
        const wid = `${id}_w${k}`, cx = x + widths[j] / 2, color = colors ? colors[k % colors.length] : textOpts.color;
        this.add(wid, this.text(w, { ...textOpts, color, size, x: cx, y }));
        const at = t + k * st;
        if (from === 'up' || from === 'down') this.rise(wid, at, { dy: (from === 'up' ? 1 : -1) * size * 0.6, dur });
        else if (from === 'scale') this.pop(wid, at, { dur, from: 0.3 });
        else if (from === 'blur') {
          this.item(wid).effects = [{ type: 'blur', radius: 0 }];
          this.tw(wid, 'effects.0.radius', 18, 0, at, dur, 'outQuad');
          this.fadeIn(wid, at, dur * 0.6);
        } else this.fadeIn(wid, at, dur);
        ids.push(wid);
        x += widths[j] + space; k++;
      });
    });
    this.add(id, this.group(ids, flags(o)), layer);
    return { id, ids, end: r3(t + (k - 1) * st + dur) };
  }

  // Letters typed on at `cps` characters a second (a prefix per item, left-anchored at x), with a blinking
  // caret, in a group `id` -> { id, ids, end }.
  typeOn(id, str, o = {}, layer) {
    const t = o.t ?? 0, cps = o.cps ?? 18, until = o.until ?? this.dur, s = String(str), n = s.length, ids = [];
    const { t: _t, cps: _c, until: _u, caret = true, ...textOpts } = o;
    for (let i = 1; i <= n; i++) {
      const enter = r3(t + (i - 1) / cps), exit = i < n ? r3(t + i / cps) : until;
      if (s[i - 1] === ' ' && i < n) continue;
      const iid = `${id}_c${i}`;
      this.add(iid, this.text(s.slice(0, i), { ...textOpts, ax: 0, ay: 0.5, align: 'left', enter, exit }));
      ids.push(iid);
    }
    if (caret) {
      const size = o.size ?? 64, cid = `${id}_caret`, m = { font: o.font, size, letterSpacing: o.letterSpacing };
      // the caret follows the typing: one caret item per character position would be many; it sits at the
      // end of the line, appearing when typing ends, blinking (a steps(1) tween holds, then jumps)
      const w = this.measure(s, m), done = r3(t + n / cps);
      this.add(cid, this.rect(Math.max(3, size * 0.07), size * 0.95, { fill: o.color ?? '#ffffff', x: (o.x ?? 0) + w + size * 0.14, y: o.y ?? 0, enter: done, exit: until }));
      for (let b = 0, at = done; at + 0.5 <= until && b < 40; b++, at = r3(at + 0.5)) this.tw(cid, 'o', b % 2 ? 0 : 1, b % 2 ? 1 : 0, at, 0.5, steps(1));
      ids.push(cid);
    }
    this.add(id, this.group(ids), layer);
    return { id, ids, end: r3(t + n / cps) };
  }

  // A number counting from `from` to `to` over [t, t + dur], one item per value shown (sampled at the frame
  // rate), in a group `id` (fade or rise the group). o: text options + { t, dur, ease ('out' | 'linear'),
  // format: (n) => string, prefix, suffix, until } -> { id, ids, end }.
  counter(id, o = {}, layer) {
    const t = o.t ?? 0, dur = o.dur ?? 1.5, from = o.from ?? 0, to = o.to ?? 100, until = o.until ?? this.dur;
    const fmt = o.format ?? ((n) => Math.round(n).toLocaleString('en-US')), pre = o.prefix ?? '', suf = o.suffix ?? '';
    const curve = o.ease === 'linear' ? (u) => u : (u) => 1 - (1 - u) ** 3;
    const { t: _t, dur: _d, from: _f, to: _to, until: _u, format: _fm, prefix: _p, suffix: _s, ease: _e, ...textOpts } = o;
    const frames = Math.max(1, Math.round(dur * this.fps)), runs = [];
    for (let f = 0; f <= frames; f++) {
      const label = `${pre}${fmt(lerp(from, to, curve(f / frames)))}${suf}`, at = r3(t + f / this.fps);
      if (runs.length && runs[runs.length - 1].label === label) continue;
      if (runs.length) runs[runs.length - 1].exit = at;
      runs.push({ label, enter: f === 0 ? 0 : at });
    }
    runs[runs.length - 1].exit = until;
    if (runs.length > 400) throw new Error(`kit: counter '${id}' makes ${runs.length} items; count a smaller range or for less time`);
    const { enter: _en, exit: _ex, ...itemOpts } = textOpts;
    const ids = runs.map((r, k) => this.add(`${id}_n${k}`, this.text(r.label, { ...itemOpts, enter: r.enter, exit: r.exit })));
    this.add(id, this.group(ids, flags(o)), layer);
    return { id, ids, end: r3(t + dur) };
  }

  // ----- lines, bars, rings -----

  // A bar growing from one end: { x, y (the start), len, thick, color, t, dur, dir: 'right'|'left'|'down'|'up' }.
  bar(id, o = {}, layer) {
    const dir = o.dir ?? 'right', horiz = dir === 'right' || dir === 'left', len = o.len ?? 400, th = o.thick ?? 8;
    const ax = dir === 'right' ? 0 : dir === 'left' ? 1 : 0.5, ay = dir === 'down' ? 0 : dir === 'up' ? 1 : 0.5;
    this.add(id, this.rect(horiz ? 0 : th, horiz ? th : 0, { fill: o.color ?? '#ffffff', x: o.x ?? 0, y: o.y ?? 0, ax, ay, radius: o.radius ?? th / 2, ...flags(o) }), layer);
    this.tw(id, horiz ? 'width' : 'height', 0, len, o.t ?? 0, o.dur ?? 0.6, o.ease ?? 'snap');
    return r3((o.t ?? 0) + (o.dur ?? 0.6));
  }
  // A straight line drawn on from `from` to `to`.
  line(id, o = {}, layer) {
    const [x0, y0] = o.from, [x1, y1] = o.to, len = Math.hypot(x1 - x0, y1 - y0), th = o.thick ?? 4;
    this.add(id, this.rect(0, th, { fill: o.color ?? '#ffffff', x: x0, y: y0, ax: 0, ay: 0.5, r: Math.atan2(y1 - y0, x1 - x0), radius: th / 2, ...flags(o) }), layer);
    this.tw(id, 'width', 0, len, o.t ?? 0, o.dur ?? 0.6, o.ease ?? 'swift');
    return r3((o.t ?? 0) + (o.dur ?? 0.6));
  }
  // A ring that expands and fades: a shockwave on a hit.
  ring(id, o = {}, layer) {
    const t = o.t ?? 0, dur = o.dur ?? 0.8, d0 = o.d0 ?? 40, d1 = o.d1 ?? 600;
    this.add(id, this.circle(d0, { stroke: o.color ?? '#ffffff', strokeWidth: o.width ?? 6, fill: '#00000000', x: o.x ?? this.CX, y: o.y ?? this.CY, enter: t, exit: r3(t + dur) }), layer);
    this.anim(id, t, dur, { width: [d0, d1], height: [d0, d1] }, 'outExpo');
    this.tw(id, 'o', 1, 0, t + dur * 0.3, dur * 0.7, 'outQuad');
    this.tw(id, 'strokeWidth', o.width ?? 6, 0.5, t, dur, 'outQuad');
    return this;
  }

  // ----- transitions (on a layer of their own, above the rest) -----

  _fxLayer(layer) { this.layer(layer ?? 'fx'); return layer ?? 'fx'; }

  // Bands of colour sweep across and cover the frame by `t`, then leave: cut the content under them at t.
  // { colors: ['#..', ...] (last on top), dur = 0.9, dir: 'left'|'right'|'up'|'down', stagger = 0.07 }
  wipe(t, o = {}) {
    const L = this._fxLayer(o.layer), colors = o.colors ?? ['#ffffff'], n = colors.length, st = o.stagger ?? 0.07, half = (o.dur ?? 0.9) / 2;
    const dir = o.dir ?? 'left', horiz = dir === 'left' || dir === 'right', sign = dir === 'left' || dir === 'up' ? -1 : 1;
    const span = horiz ? this.W : this.H, c = horiz ? this.CX : this.CY, prop = horiz ? 'x' : 'y';
    colors.forEach((col, i) => {
      const id = `wipe${this._n++}`, tin = t - half - (n - 1 - i) * st, tout = t + 0.02 + (n - 1 - i) * st;
      const start = c - sign * span, mid = c, end = c + sign * span;
      this.add(id, this.rect(this.W + 4, this.H + 4, { fill: col, x: horiz ? start : this.CX, y: horiz ? this.CY : start, enter: r3(Math.max(0, tin)), exit: r3(tout + half) }), L);
      this.tw(id, prop, start, mid, Math.max(0, tin), half, 'swift');
      this.tw(id, prop, mid, end, tout, half, 'swift');
    });
    return this;
  }
  // A full-frame flash that fades.
  flash(t, { color = '#ffffff', dur = 0.3, o = 0.9, layer } = {}) {
    const L = this._fxLayer(layer), id = `flash${this._n++}`;
    this.add(id, this.rect(this.W + 4, this.H + 4, { fill: color, x: this.CX, y: this.CY, o, enter: r3(t), exit: r3(t + dur) }), L);
    this.tw(id, 'o', o, 0, t, dur, 'outQuad');
    return this;
  }
  // A circle of colour grows from (x, y) to cover the frame by t, then fades: cut under it.
  iris(t, { color = '#ffffff', x = this.CX, y = this.CY, dur = 0.7, layer } = {}) {
    const L = this._fxLayer(layer), id = `iris${this._n++}`, d = 2.3 * Math.hypot(Math.max(x, this.W - x), Math.max(y, this.H - y));
    this.add(id, this.circle(10, { fill: color, x, y, enter: r3(t - dur * 0.6), exit: r3(t + dur * 0.5) }), L);
    this.anim(id, t - dur * 0.6, dur * 0.6, { width: [10, d], height: [10, d] }, 'inQuart');
    this.tw(id, 'o', 1, 0, t + 0.05, dur * 0.4, 'outQuad');
    return this;
  }
  // The outgoing group pushes through the lens (bigger, blurred, gone); the incoming one lands from behind.
  zoomThrough(fromId, toId, t, { dur = 0.5, blur = 36, scale = 1.6 } = {}) {
    const blurIx = (id) => {
      const it = this.item(id);
      it.effects ??= [];
      let k = it.effects.findIndex((e) => e.type === 'blur');
      if (k < 0) { it.effects.push({ type: 'blur', radius: 0 }); k = it.effects.length - 1; }
      return k;
    };
    if (fromId) {
      const k = blurIx(fromId), s = this.item(fromId).transform.scaleX;
      this.anim(fromId, t - dur / 2, dur / 2, { s: [s, s * scale] }, 'inExpo');
      this.tw(fromId, `effects.${k}.radius`, 0, blur, t - dur / 2, dur / 2, 'inQuad');
      this.tw(fromId, 'o', 1, 0, t - dur * 0.2, dur * 0.2, 'inQuad');
    }
    if (toId) {
      const k = blurIx(toId), s = this.item(toId).transform.scaleX;
      this.anim(toId, t, dur * 0.8, { s: [s * 0.75, s] }, 'outExpo');
      this.tw(toId, `effects.${k}.radius`, blur, 0, t, dur * 0.7, 'outQuad');
      this.tw(toId, 'o', 0, 1, t, dur * 0.25, 'outQuad');
      this.item(toId).transform.opacity = 0;
    }
    return this;
  }
  // A whip pan: the outgoing group flies off, blurred, the incoming one flies in from the other side.
  whip(fromId, toId, t, { dir = 'left', dur = 0.45, blur = 28 } = {}) {
    const sign = dir === 'left' ? -1 : 1, dist = this.W * 1.1;
    const blurIx = (id) => { const it = this.item(id); it.effects ??= []; it.effects.push({ type: 'blur', radius: 0 }); return it.effects.length - 1; };
    if (fromId) {
      const x = this.item(fromId).transform.x, k = blurIx(fromId);
      this.tw(fromId, 'x', x, x + sign * dist, t - dur / 2, dur / 2, 'inQuart');
      this.tw(fromId, `effects.${k}.radius`, 0, blur, t - dur / 2, dur / 2, 'inQuad');
    }
    if (toId) {
      const x = this.item(toId).transform.x, k = blurIx(toId);
      this.tw(toId, 'x', x - sign * dist, x, t, dur / 2, 'outQuart');
      this.tw(toId, `effects.${k}.radius`, blur, 0, t, dur / 2, 'outQuad');
    }
    return this;
  }

  // ----- camera -----

  // A group the size of the frame, pivoting on its centre, to move like a camera: its children are in frame
  // coordinates. keys: [[t, { x, y, s, r }], ...]; between two keys the changing values ease 'swift'.
  camera(id, children, keys = [], { layer, ease = 'swift', ...o } = {}) {
    this.add(id, this.group(children, { box: true, x: this.CX, y: this.CY, ...o }), layer);
    const base = { x: this.CX, y: this.CY, s: 1, r: 0 };
    let prev = null;
    for (const [t, k] of keys) {
      const cur = { ...(prev ? prev.v : base), ...k };
      if (prev) {
        const props = {};
        for (const p of ['x', 'y', 's', 'r']) if (cur[p] !== prev.v[p]) props[p] = [prev.v[p], cur[p]];
        if (Object.keys(props).length) this.anim(id, prev.t, t - prev.t, props, k.ease ?? ease);
      } else {
        const T = this.item(id).transform;
        T.x = cur.x; T.y = cur.y; T.scaleX = T.scaleY = cur.s; T.rotation = cur.r;
      }
      prev = { t, v: cur };
    }
    return id;
  }

  // ----- backgrounds and texture -----

  // Big soft blobs of colour drifting behind everything (an isolated, blurred group).
  aurora(layer, { colors = ['#6b4cff', '#ff3d9a', '#3de8ff'], blur = 150, o = 0.35, t0 = 0, t1 = this.dur, seed = 3 } = {}) {
    const q = rng(seed), ids = [];
    colors.forEach((col, k) => {
      const id = `aurora${k}`, d = Math.max(this.W, this.H) * (0.45 + q() * 0.25);
      const x0 = this.W * (0.15 + q() * 0.7), y0 = this.H * (0.15 + q() * 0.7), x1 = this.W * (0.15 + q() * 0.7), y1 = this.H * (0.15 + q() * 0.7);
      this.add(id, this.circle(d, { fill: col, x: x0, y: y0 }));
      this.anim(id, t0, t1 - t0, { x: [x0, x1], y: [y0, y1] }, 'glide');
      ids.push(id);
    });
    return this.add('aurora', this.group(ids, { o, isolate: true, effects: [{ type: 'blur', radius: blur }] }), layer);
  }
  // A grid of dots; with ripple { t, x, y, speed = 1400 } each dot swells as a wave passes.
  dotGrid(layer, { gap = 64, size = 5, color = '#ffffff', o = 0.18, ripple, id = 'dots' } = {}) {
    const cols = Math.ceil(this.W / gap) + 1, rows = Math.ceil(this.H / gap) + 1;
    this.items[id] = { $repeat: { count: cols, as: 'i' }, item: { $repeat: { count: rows, as: 'j', id: `${id}\${i}_\${j}` },
      item: { type: 'shape', kind: 'circle', width: size, height: size, fillColor: color, transform: { x: '${i * ' + gap + '}', y: '${j * ' + gap + '}', scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 } } } };
    this.add(`${id}_g`, this.group([id], { o }), layer);
    if (ripple) {
      const { t, x = this.CX, y = this.CY, speed = 1400, peak = 2.6 } = ripple;
      const delay = `sqrt(pow(i * ${gap} - ${x}, 2) + pow(j * ${gap} - ${y}, 2)) / ${speed}`;
      for (const [ax, name] of [['scaleX', 'rx'], ['scaleY', 'ry']]) {
        this.tweens.push({ $repeat: { count: cols, as: 'i' }, item: { $repeat: { count: rows, as: 'j' }, item: {
          id: `${id}${name}\${i}_\${j}`, target: `${id}\${i}_\${j}`, property: `transform.${ax}`, from: 1, to: peak,
          start: `\${${t} + ${delay}}`, duration: 0.18, easing: 'easeOutQuad' } } });
        this.tweens.push({ $repeat: { count: cols, as: 'i' }, item: { $repeat: { count: rows, as: 'j' }, item: {
          id: `${id}${name}b\${i}_\${j}`, target: `${id}\${i}_\${j}`, property: `transform.${ax}`, from: peak, to: 1,
          start: `\${${t} + 0.18 + ${delay}}`, duration: 0.5, easing: 'easeInOutSine' } } });
      }
    }
    return `${id}_g`;
  }
  // A library texture (paper-warm, paper-kraft, ...) over or under the frame on a layer of its own,
  // blended: 'multiply' darkens with the paper's grain, 'overlay' / 'soft-light' texture a dark frame.
  texture(libId = 'paper-warm', { blend = 'multiply', o = 0.5, layer = 'texture', drift = true } = {}) {
    const { id, record } = this.library(libId);
    this.layer(layer, { blend, o });
    const side = Math.max(this.W, this.H) * 1.08, k = side / Math.max(record.w ?? side, record.h ?? side);
    const sid = this.add(`${layer}_img`, this.sprite(id, Math.round((record.w ?? side) * k), Math.round((record.h ?? side) * k), { x: this.CX, y: this.CY }), layer);
    if (drift) this.anim(sid, 0, this.dur, { x: [this.CX, this.CX - 30], y: [this.CY, this.CY - 18] }, 'linear');
    return sid;
  }
  // A burst of particles from (x, y) at t: seeded, so the same every render.
  particles(layer, { id = `burst${this._n++}`, x = this.CX, y = this.CY, t = 0, n = 36, dur = 1.1, radius = [160, 520], size = [6, 16], colors = ['#ffffff'], seed = 7, gravity = 0 } = {}) {
    const q = rng(seed), ids = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (q() - 0.5) * 0.6, r = lerp(radius[0], radius[1], q()), d = lerp(size[0], size[1], q());
      const pid = `${id}_${k}`, delay = q() * 0.08;
      this.add(pid, this.circle(d, { fill: colors[k % colors.length], x, y, enter: r3(t), exit: r3(t + dur + 0.1) }));
      this.tw(pid, 'x', x, x + Math.cos(a) * r, t + delay, dur - delay, 'outExpo');
      this.tw(pid, 'y', y, y + Math.sin(a) * r + gravity, t + delay, dur - delay, gravity ? 'outQuad' : 'outExpo');
      this.anim(pid, t + dur * 0.35, dur * 0.65, { s: [1, 0.2], o: [1, 0] }, 'inQuad');
      ids.push(pid);
    }
    return this.add(id, this.group(ids), layer);
  }
  // A slow Ken Burns on an image or clip item.
  kenburns(id, t0, t1, { s = [1, 1.1], x, y } = {}) { return this.drift(id, t0, t1, { s, x, y, ease: 'linear' }); }

  // ----- hand-drawn -----

  // A hand-drawn character walking in on its sprite sheet (a library id with a sheet: fox-sprite,
  // octopus-sprite; or what v.spriteSheet() returned), its feet planted: the walk lasts as long as its
  // stride needs.
  // { from: x, to: x, y (feet), h (height), t, then: 'idle'|'wave'|..., until, layer } -> the arrival time.
  character(id, ref, o = {}) {
    const { id: asset, sheet } = typeof ref === 'string' ? this.library(ref) : ref;
    const libId = typeof ref === 'string' ? ref : ref.id;
    if (!sheet?.cycles?.walk) throw new Error(`kit: '${libId}' has no walk cycle on its sheet`);
    const h = o.h ?? 300, k = h / sheet.frameHeight, w = Math.round(sheet.frameWidth * k), speed = (sheet.cycles.walk.speed ?? 60) * k;
    const x0 = o.from ?? -w, x1 = o.to ?? this.CX, t = o.t ?? 0, dur = Math.abs(x1 - x0) / speed, arrive = r3(t + dur);
    const face = x1 < x0 ? -1 : 1, until = o.until ?? this.dur, layer = o.layer;
    const common = { x: x0, y: o.y ?? this.H * 0.85, ax: sheet.anchor?.x ?? 0.5, ay: sheet.anchor?.y ?? 1, sx: face, sy: 1 };
    this.add(`${id}_walk`, this.sprite(asset, w, h, { ...common, cycle: 'walk', enter: r3(t), exit: arrive }), layer);
    this.tw(`${id}_walk`, 'x', x0, x1, t, dur, 'linear');
    if (o.then !== false && arrive < until) {
      const then = o.then ?? 'idle';
      if (!sheet.cycles[then]) throw new Error(`kit: '${libId}' has no '${then}' cycle (${Object.keys(sheet.cycles).join(', ')})`);
      this.add(`${id}_${then}`, this.sprite(asset, w, h, { ...common, x: x1, cycle: then, enter: arrive, exit: until }), layer);
    }
    return arrive;
  }

  // Hand-drawn marks drawn over the video by the handdrawn package (one alpha film, on the top layer):
  //   const hand = v.hand({ look: 'paperInk', ink: '#fff', colors: ['#ff4d6d', '#ffd166'] });
  //   hand.circle({ of: 'price', at: 3.2 }); hand.underline({ of: 'title', at: 1.4, color: 1 });
  //   hand.arrow({ from: [300, 800], to: 'logo', at: 5 }); hand.write({ text: 'wow!', box: [...], at: 6 });
  // `of` / `to` name an item: `nv build` finds where it is on screen at `boxAt ?? at`.
  hand(o = {}) {
    if (this._accents) return this._accents;
    this.layer('hand');
    const W = this.W, H = this.H;
    const asset = this.asset('hdf-accents', 'video', 'hdf/accents.webm', { hasAlpha: true, codec: 'vp9' });
    this.add('hdf_accents', this.clip(asset, W, H, { x: W / 2, y: H / 2, fit: 'fill', start: 0, name: 'hdf:accents' }), 'hand');
    const spec = { look: o.look ?? 'paperInk', ink: o.ink ?? '#1d1b18', colors: o.colors ?? ['#ff3d6e', '#ffc23d', '#3de8ff', '#7dff9a'], w: o.w, hand: o.handId, marks: [] };
    const mark = (kind) => (m) => {
      if (m.at === undefined) throw new Error(`hand.${kind}: needs at (seconds)`);
      if (!m.of && !m.box && !m.from && !m.point) throw new Error(`hand.${kind}: needs of (an item id) or box [x, y, w, h]`);
      spec.marks.push({ kind, dur: DUR[kind] ?? 0.5, ...m });
      return this._accents;
    };
    const DUR = { underline: 0.45, circle: 0.6, arrow: 0.5, star: 0.35, highlight: 0.4, strike: 0.35, bracket: 0.45, tick: 0.3, cross: 0.3, question: 0.4, callout: 0.9, write: 1.2, scribble: 0.8 };
    this._accents = { spec, ...Object.fromEntries(Object.keys(DUR).map((k) => [k, mark(k)])) };
    return this._accents;
  }

  // ----- output -----

  toJSON() {
    for (const L of this.layers) for (const id of L.items) if (!this.items[id]) throw new Error(`kit: layer '${L.id}' lists '${id}', which is not an item`);
    const comp = {
      $comment: this.comment ?? 'Built by the new-video kit; edit build.mjs, not this file.',
      version: '0.1',
      composition: { width: this.W, height: this.H, fps: this.fps, duration: this.dur, background: this.bg, ...(this.audioMaster ? { audioMaster: this.audioMaster } : {}), ...(this.markers.length ? { markers: [...this.markers].sort((a, b) => a.t - b.t) } : {}) },
      assets: this.assets,
      ...(Object.keys(this.templates).length ? { templates: this.templates } : {}),
      ...(Object.keys(this.behaviors).length ? { behaviors: this.behaviors } : {}),
      layers: this.layers,
      items: this.items,
      tweens: this.tweens,
      ...(this.audio.length ? { audio: this.audio } : {}),
    };
    return comp;
  }

  // composition.json (and hdf/accents.json when hand marks were asked for) in the project folder.
  write() {
    const out = join(this.dir, 'composition.json');
    writeFileSync(out, JSON.stringify(this.toJSON(), null, 1) + '\n');
    const acc = join(this.dir, 'hdf', 'accents.json');
    if (this._accents) {
      mkdirSync(join(this.dir, 'hdf'), { recursive: true });
      const s = this._accents.spec;
      writeFileSync(acc, JSON.stringify({ W: this.W, H: this.H, dur: this.dur, ...s, marks: [...s.marks].sort((a, b) => a.at - b.at) }, null, 1) + '\n');
    }
    if (this.credits.length) writeFileSync(join(this.dir, 'credits.json'), JSON.stringify(this.credits, null, 1) + '\n');
    const tw = this.tweens.length, it = Object.keys(this.items).length;
    process.stdout.write(`${out}  ${this.W}x${this.H} ${this.dur}s  ${it} items, ${tw} tween entries, ${this.assets.length} assets, ${this.audio.length} tracks${this._accents ? `, ${this._accents.spec.marks.length} hand marks` : ''}\n`);
    return out;
  }
}

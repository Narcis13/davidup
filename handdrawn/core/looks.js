// Looks: palette, finish, paper stock and tool defaults. Colour maths ported from v1 core.js so ported
// films keep their colours. A role (plan 1.2) is resolved against the current look, never raw hex.
import { asHand, houseHand } from './glyphs.js';
import { hashData } from './list.js';
import { peek } from './store.js';

// ---------- colour maths (hex in, hex out; alpha() and rgba parsing are the exceptions) ----------

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// [r, g, b, a] from '#rgb', '#rrggbb', '#rrggbbaa' or 'rgb(a)(...)'.
export function parse(c) {
  if (typeof c !== 'string') throw new TypeError(`colour: expected a string, got ${String(c)}`);
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`colour: bad hex '${c}'`);
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const m = c.match(/-?[\d.]+/g);
  if (!/^rgba?\(/.test(c) || !m || m.length < 3) throw new Error(`colour: cannot parse '${c}'`);
  return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
// CSS for [r, g, b, a]: hex when opaque, rgba() otherwise.
export function css([r, g, b, a = 1]) {
  if (a >= 1) return toHex([r, g, b]);
  const q = (v) => Math.round(clamp(v, 0, 255));
  return `rgba(${q(r)},${q(g)},${q(b)},${+clamp(a, 0, 1).toFixed(4)})`;
}
const keepAlpha = (c, rgb) => css([...rgb, parse(c)[3]]);

// Colour helpers for derived palettes (hex in, CSS out); films use roles, not these, in ops.
export function mix(a, b, t) { const A = parse(a), B = parse(b); return css(A.map((v, i) => lerp(v, B[i], t))); }
export const tint = (c, t) => mix(c, '#ffffff', t);    // towards white
export const shade = (c, t) => mix(c, '#000000', t);   // towards black
// c with its alpha multiplied by a.
export function alpha(c, a) { const [r, g, b, a0] = parse(c); return css([r, g, b, a0 * a]); }

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
export const hsl = (c) => rgbToHsl(parse(c));
export const withHsl = (c, fn) => keepAlpha(c, hslToRgb(fn(hsl(c))));
export const rotateHue = (c, deg) => withHsl(c, ([h, s, l]) => [h + deg, s, l]);
export const saturate = (c, k) => withHsl(c, ([h, s, l]) => [h, clamp(s * k, 0, 1), l]);
export const lighten = (c, d) => withHsl(c, ([h, s, l]) => [h, s, clamp(l + d, 0, 1)]);
// n steps from a light tint through the colour to a dark shade.
export const ramp = (c, n = 5) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return t < 0.5 ? tint(c, (0.5 - t) * 1.4) : shade(c, (t - 0.5) * 1.4); });
export const harmony = (base) => ({
  complement: rotateHue(base, 180), triad: [rotateHue(base, 120), rotateHue(base, 240)],
  analog: [rotateHue(base, -30), rotateHue(base, 30)], split: [rotateHue(base, 150), rotateHue(base, 210)],
});

// ---------- presets (plan 1.4), palettes as measured for v1 ----------

const TOOLS = {
  pen: { w: 2.6, wobble: 1.8, bleed: 0 },
  brush: { taper: 1, amp: 1.6 },
  pencil: { w: 0.9, wobble: 1.2 },
  chalk: { w: 2, wobble: 1.6, dash: 10, gap: 2.5 },
};
const mkLook = (name, palette, finish, paper, tools = {}, more = {}) => deepFreeze({
  name, palette, finish, paper, edition: 0,
  tools: Object.fromEntries(Object.keys(TOOLS).map((k) => [k, { ...TOOLS[k], ...tools[k] }])),
  ...more,
});

// The cut-out of a look that has one (read only by core/puppet.js): shadow is the drop shadow's alpha,
// fastener the brass fastener's radius and edge the paper edge's width (both in hundredths of the puppet's
// units), tilt the scale-y of the whole puppet, the camera above the table.
export const CUTOUT = Object.freeze({ shadow: 0.3, fastener: 3, edge: 0.6, tilt: 0.94 });

// The nine presets (plan 1.4, 3.0 S10, 4.0 L1 and L2): paperInk, risoPop, screenSea, pencilMinimal, blueprintNight,
// doodlePastel, cutout, whiteboard, chalkboard.
export const LOOKS = Object.freeze({
  // the fruit-fly film: warm paper, brown inks, four riso accents
  paperInk: mkLook('paperInk', {
    paper: '#f3e6cf', paperBand: 'rgba(255,238,200,.65)', ink: '#1e1630', night: '#0b0d1f', chalk: '#e8ecff', chalkDim: '#8d97c9', guide: 'rgba(70,100,255,.55)',
    fills: ['#e79256', '#c99a5a', '#b8864e', '#d9b078'], shade: '#3a2214', light: '#fff1d6', blush: '#c8473f',
    accents: ['#ff2bd6', '#28f0e0', '#ffe22b', '#5cff5c'], inks: ['#1e1630', '#c8473f', '#2b5fb8'],
  }, 'hatch', 'bands'),
  // the flipbook: cream stock, fluorescent riso inks, halftone dots, dark purple night
  risoPop: mkLook('risoPop', {
    paper: '#f0ece2', paperBand: null, ink: '#22366b', night: '#2a2050', chalk: '#f3ebb1', chalkDim: '#8f86c8', guide: 'rgba(34,54,107,.5)',
    fills: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#ff6c2f', '#765ba7'], shade: '#22366b', light: '#fff9c8', blush: '#ff48b0',
    accents: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c'], inks: ['#0078bf', '#ff48b0', '#ffe800', '#22366b'],
  }, 'halftone', 'cream'),
  // the paper boat: sea blues, cream sky, flat shapes under a regular dot screen
  screenSea: mkLook('screenSea', {
    paper: '#e8e6db', paperBand: null, ink: '#1f1e2d', night: '#1a1c2e', chalk: '#e8e6db', chalkDim: '#8a93a6', guide: 'rgba(10,80,131,.5)',
    fills: ['#0a5083', '#518e9d', '#becacc', '#e4a05c', '#91906a', '#e8c84a', '#c8473f', '#051630'], shade: '#051630', light: '#f4f2e8', blush: '#e4a05c',
    accents: ['#c8473f', '#e8c84a', '#518e9d', '#f0a0b0'], inks: ['#0a5083', '#051630', '#e8c84a'],
  }, 'dots', 'cream'),
  // near-monochrome cream and charcoal, thin graphite lines
  pencilMinimal: mkLook('pencilMinimal', {
    paper: '#f4efe4', paperBand: null, ink: '#201f1b', night: '#27251f', chalk: '#d9d2c2', chalkDim: '#7d786c', guide: 'rgba(32,31,27,.35)',
    fills: ['#e8d6cc', '#e0e2d0', '#dad2c5', '#f4efe4'], shade: '#5e5a50', light: '#ffffff', blush: '#c9a9a0',
    accents: ['#8a8a55', '#b0483a', '#7e8aa0', '#c9a15a'], inks: ['#201f1b', '#8a8a55'],
  }, 'graphite', 'cream', { pen: { w: 1.6, wobble: 1.2 } }),
  // chalk on navy only
  blueprintNight: mkLook('blueprintNight', {
    paper: '#0b0d1f', paperBand: null, ink: '#e8ecff', night: '#0b0d1f', chalk: '#e8ecff', chalkDim: '#8d97c9', guide: 'rgba(150,170,255,.7)',
    fills: ['#1a2040', '#22306a', '#2c3a80', '#141a33'], shade: '#8d97c9', light: '#ffffff', blush: '#7fe7ff',
    accents: ['#7fe7ff', '#ff6fd8', '#ffe22b', '#5fe08a'], inks: ['#e8ecff', '#7fe7ff'],
  }, 'hatch', 'night'),
  // doodles on photos: pastel paper, near-black brush pen, watercolour fills
  doodlePastel: mkLook('doodlePastel', {
    paper: '#efd2d1', paperBand: null, ink: '#23202b', night: '#2c2f5e', chalk: '#f7f3e8', chalkDim: '#a9acd6', guide: 'rgba(0,80,255,.5)',
    fills: ['#f2a7b3', '#8fc4e8', '#f6d46b', '#9fd3a8', '#f3b27a', '#c3a6e0'], shade: '#6b6577', light: '#fffdf7', blush: '#f28aa0',
    accents: ['#e8505b', '#3f7fd1', '#f0b429', '#4caf7d'], inks: ['#23202b', '#e8505b'],
  }, 'wash', 'pastel', { pen: { w: 4, wobble: 1.4 } }),
  // Gilliam by way of stage3d: printed card on a table, flat colours, pieces pinned with brass fasteners
  // (accents.2) that cast soft shadows
  cutout: mkLook('cutout', {
    paper: '#e6dcc4', paperBand: null, ink: '#2a2220', night: '#1e1b26', chalk: '#f4ecd8', chalkDim: '#9c9280', guide: 'rgba(42,34,32,.4)',
    fills: ['#d0632f', '#2f6f73', '#d9a441', '#7b8f5a', '#b98a6a', '#394a6d'], shade: '#4a3a30', light: '#f8f1df', blush: '#c9573f',
    accents: ['#b8352a', '#2f6f73', '#c49a3c', '#7d4f86'], inks: ['#2a2220', '#b8352a'],
  }, 'flat', 'card', { pen: { w: 2.2, wobble: 0.6 } }, { cutout: CUTOUT }),
  // the classroom whiteboard: a cool white board with a glare and a tray, round-tip markers in black, blue,
  // red and green (inks.N) drawing every pen line (penTool), fills coloured in with a marker's passes
  whiteboard: mkLook('whiteboard', {
    paper: '#eceeea', paperBand: null, ink: '#1d1f24', night: '#23272e', chalk: '#f4f5f2', chalkDim: '#9aa1a8', guide: 'rgba(31,95,201,.35)',
    fills: ['#8db7ea', '#f2a0a0', '#9ed39a', '#f6d46e', '#c4a5e0', '#f5b574'], shade: '#3c424a', light: '#ffffff', blush: '#ef8686',
    accents: ['#d8342f', '#1f5fc9', '#23924a', '#ef9a1c'], inks: ['#1d1f24', '#1f5fc9', '#d8342f', '#23924a'],
  }, 'marker', 'board', { pen: { w: 3.4, wobble: 0.7 } }, { penTool: 'bullet' }),
  // the classroom chalkboard: green-black slate with the haze of old lessons and a wooden ledge, white chalk
  // drawing every pen line (penTool) with dust along it (dust), coloured chalks as accents and inks.1..3,
  // fills rubbed in with the side of a stick. ~ghost:<alpha> keeps the last shot, half erased, under the next.
  chalkboard: mkLook('chalkboard', {
    paper: '#2a3b33', paperBand: null, ink: '#eef0e6', night: '#161f1b', chalk: '#eef0e6', chalkDim: '#8e9d94', guide: 'rgba(238,240,230,.28)',
    fills: ['#6f8fa8', '#a87f86', '#7f9d72', '#b3a266', '#8d7fa3', '#b08868'], shade: '#7d8c84', light: '#fbfcf5', blush: '#e8a0ab',
    accents: ['#f4d36b', '#f0a3b8', '#96cfe6', '#a6dc92'], inks: ['#eef0e6', '#f4d36b', '#f0a3b8', '#96cfe6'],
  }, 'chalk', 'slate', { pen: { w: 3.2, wobble: 1.1 }, chalk: { w: 3.2, wobble: 1.3, dash: 13, gap: 2.6 } }, { penTool: 'chalk', dust: 1 }),
});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

// A preset name split on its modifiers: 'doodlePastel~from:teapot' -> { base: 'doodlePastel', mods: [['from', 'teapot']] }.
export function parseLookName(name) {
  const [base, ...rest] = String(name).split('~');
  return { base, mods: rest.filter(Boolean).map((m) => { const i = m.indexOf(':'); return i < 0 ? [m, ''] : [m.slice(0, i), m.slice(i + 1)]; }) };
}

// The look modifiers `--look` understands, applied left to right. `from` needs the film's assets, so it only
// resolves where they are at hand (cli/load.mjs passes them).
const MODS = {
  from: (look, id, assets, name) => derive(look, { from: assetRecord(id, assets, name), name: `${look.name}~from:${id}` }),
  // The look lettered (and its pens drawn) in a hand from the store; the whole record is part of the look, so
  // two hands hash as two looks and never share a cache.
  hand: (look, id, assets, name) => withLook(look, { name: `${look.name}~hand:${id}`, hand: handRecord(id, assets, name) }),
  // The look on no stock at all (`hdf render --alpha`): paper() and night() draw nothing, so the drawing sits
  // on transparency. The paper role keeps its colour: a bubble, an eye white, a knockout still read as paper.
  alpha: (look) => alphaOf(look),
  // The shot before, wiped not quite clean, under each shot at this alpha (4.0 L2; 0.15 when none is given).
  ghost: (look, v, assets, name) => {
    const a = v === '' ? 0.15 : Number(v);
    if (!(a > 0 && a <= 1)) throw new Error(`look '${name}': ghost wants an alpha in (0, 1], got '${v}'`);
    return withLook(look, { name: `${look.name}~ghost:${a}`, ghost: a });
  },
};

// A look on no stock, one object per look (so its hash and the layer cache see one look, not one per frame).
const alphaMemo = new WeakMap();
function alphaOf(look) {
  if (look.alpha) return look;
  let a = alphaMemo.get(look);
  if (!a) alphaMemo.set(look, (a = withLook(look, { name: `${look.name}~alpha`, alpha: true })));
  return a;
}

// The look a lookNode's kids draw in: its own, on no stock when the look around it has none.
export function innerLook(look, outer) {
  const inner = resolveLook(look);
  return outer?.alpha ? alphaOf(inner) : inner;
}

// A hand by id: 'house', one of the film's assets, or one read from a store (loadFilm reads the hand a look
// names; a film may name it in fromStore([...]) instead).
export function handRecord(id, assets, name = `~hand:${id}`) {
  if (id === 'house') return houseHand();
  const own = assets instanceof Map ? assets.get(id) : assets?.[id];
  if (own?.glyphs) return asHand(own);
  if (peek(id)?.glyphs) return asHand(peek(id));
  throw new Error(`look '${name}': no hand '${id}' in the store (make one with \`hdf hand --synth ${id}\` or \`hdf import <file> --kind hand --name ${id}\`)`);
}

// The hand a look letters in, as a full record, or null for the house hand. A look named with a '~hand:'
// modifier is resolved to find it; any other named preset is house.
export function handOf(look) {
  if (!look) return null;
  let lk = look;
  if (!(typeof look === 'object' && look.palette)) {
    if (!parseLookName(typeof look === 'string' ? look : look.name ?? '').mods.some(([k]) => k === 'hand')) return null;
    lk = resolveLook(look);
  }
  if (!lk.hand) return null;
  const h = asHand(lk.hand);
  return h === houseHand() ? null : h;
}

// The alpha a look keeps the shot before at (4.0 L2's ghost), 0 for none, read without resolving the look (a
// '~from:' name needs the film's assets): a look object's own field, else the name's last '~ghost:' modifier.
export function ghostOf(look) {
  if (!look) return 0;
  if (typeof look === 'object' && look.palette) return look.ghost ?? 0;
  const { base, mods } = parseLookName(typeof look === 'string' ? look : look.name ?? '');
  const g = mods.filter(([k]) => k === 'ghost').at(-1);
  return g ? (g[1] === '' ? 0.15 : Number(g[1]) || 0) : LOOKS[base]?.ghost ?? 0;
}

// A cutout by id: one of the film's assets, else one read from the store (fromStore, or the store next to the
// package), so a recipe that resolves 'doodlePastel~from:violin' at module load finds it before the loader
// has the film's assets.
function assetRecord(id, assets, name) {
  const own = assets instanceof Map ? assets.get(id) : assets?.[id];
  const rec = own ?? peek(id);
  if (rec) return rec;
  if (!assets) throw new Error(`look '${name}': no asset '${id}' in the store (a '~from:' look reads a cutout by id; \`hdf find ${id}\`, or call derive(look, { from }))`);
  const have = (assets instanceof Map ? [...assets.keys()] : Object.keys(assets)).join(', ');
  throw new Error(`look '${name}': no asset '${id}' in this film (has ${have || 'none'}) or in the store`);
}

// A look with the modifiers of a name applied to it, in order (mods as parseLookName returns them). The name's
// own base is not consulted: this transforms the look it is handed, which is how a modifier reaches the looks a
// film pins shot by shot.
export function modifyLook(look, mods, assets, name) {
  let out = resolveLook(look);
  for (const [kind, value] of mods) {
    const label = name ?? `${out.name}~${kind}:${value}`;
    if (!MODS[kind]) throw new Error(`look '${label}': unknown modifier '${kind}' (expected ${Object.keys(MODS).map((k) => (k === 'alpha' ? k : k === 'ghost' ? `${k}:<alpha>` : `${k}:<id>`)).join(', ')})`);
    out = MODS[kind](out, value, assets, label);
  }
  return out;
}

// A full look from a preset name, { name } (what film() stores for a string) or a full look object. A name may
// carry modifiers -- 'doodlePastel~from:teapot' -- and those that read an asset need the film's `assets`.
export function resolveLook(l, assets) {
  if (l && typeof l === 'object' && l.palette) return l;
  const name = typeof l === 'string' ? l : l?.name;
  if (LOOKS[name]) return LOOKS[name];
  const { base, mods } = parseLookName(name ?? '');
  if (!LOOKS[base] || !mods.length) throw new Error(`unknown look '${name}' (expected ${Object.keys(LOOKS).join(', ')}, or a look object)`);
  return modifyLook(LOOKS[base], mods, assets, name);
}

// A look with some fields replaced; palette and tools merge one level deep.
export function withLook(base, part = {}) {
  const b = resolveLook(base);
  return deepFreeze({
    ...b, ...part,
    palette: { ...b.palette, ...part.palette },
    tools: Object.fromEntries(Object.keys(b.tools).map((k) => [k, { ...b.tools[k], ...part.tools?.[k] }])),
  });
}

// Shift a whole palette (hue in degrees, saturation factor, lightness delta), or repaint it in the colours of
// `from` -- a cutout record written by `hdf photo` (or a bare colours list). Either way paper, ink, night,
// light and chalk stay: the sheet does not change, what is drawn on it does.
export function derive(look, { hue = 0, sat = 1, light = 0, from, name } = {}) {
  const b = from === undefined ? resolveLook(look) : fromColours(resolveLook(look), from);
  if (!hue && sat === 1 && !light) return name && name !== b.name ? withLook(b, { name }) : b;
  const p = b.palette, f = (c) => lighten(saturate(rotateHue(c, hue), sat), light);
  return withLook(b, {
    name: name ?? `${b.name}~h${hue}s${sat}l${light}`,
    palette: { fills: p.fills.map(f), accents: p.accents.map(f), inks: p.inks.map(f), shade: f(p.shade), blush: f(p.blush) },
  });
}

// The colours table of a cutout record (or a bare list of { hex, area } / hex strings), biggest area first.
function coloursOf(from) {
  const list = Array.isArray(from) ? from : from?.colours;
  if (!Array.isArray(list) || !list.length) {
    const who = Array.isArray(from) ? 'this list' : `cutout '${from?.name ?? String(from)}'`;
    throw new Error(`derive({ from }): ${who} has no colours; run \`hdf photo --refresh <photos.js>\` to add them`);
  }
  return list.map((c) => (typeof c === 'string' ? { hex: c, area: 0 } : { hex: c.hex, area: c.area ?? 0 }))
    .map((c) => { parse(c.hex); return c; })
    .sort((a, b) => b.area - a.area).map((c) => c.hex);
}

// fills are the cutout's colours by area, accents its four most saturated pushed to mid lightness, the inks
// end on its darkest saturated colour, shade on its darkest, blush on its warmest.
function fromColours(base, from) {
  const hexes = coloursOf(from), h = hexes.map((c) => hsl(c)), idx = hexes.map((_, i) => i);
  const best = (score, among = idx) => among.reduce((a, b) => (score(h[b]) > score(h[a]) ? b : a));
  const dark = best(([, , l]) => -l), saturated = idx.filter((i) => h[i][1] >= 0.15);
  const warm = idx.filter((i) => h[i][0] <= 90 || h[i][0] >= 330);
  const bySat = [...idx].sort((a, b) => h[b][1] - h[a][1]);
  const pop = (c) => withHsl(c, ([hh, s]) => [hh, clamp(s * 1.3, 0, 1), 0.5]);
  return withLook(base, {
    name: `${base.name}~from:${Array.isArray(from) ? 'colours' : from.name}`,
    palette: {
      fills: hexes,
      accents: Array.from({ length: 4 }, (_, i) => pop(hexes[bySat[i % bySat.length]])),
      inks: [base.palette.ink, hexes[saturated.length ? best(([, , l]) => -l, saturated) : dark]],
      shade: shade(hexes[dark], 0.3),
      blush: tint(hexes[best(([, s]) => s, warm.length ? warm : idx)], 0.3),
    },
  });
}

// Two inks on the look's paper, the way the flipbook goes magenta + blue for a beat.
export function duotone(look, a, b) {
  const base = resolveLook(look), paper = base.palette.paper;
  return withLook(base, {
    name: `${base.name}~duo`, finish: 'halftone',
    palette: {
      ink: a, night: shade(a, 0.6), chalk: paper, chalkDim: mix(a, paper, 0.5), guide: alpha(a, 0.5),
      fills: [a, b, mix(a, b, 0.5), tint(a, 0.5), tint(b, 0.5)], shade: a, light: paper, blush: b,
      accents: [b, a, tint(b, 0.4), tint(a, 0.4)], inks: [a, b],
    },
  });
}

// The doodle palette on another sheet of paper. Sheets measured off the reference film.
export const PASTELS = Object.freeze({ rose: '#efd2d1', mint: '#d3e6d9', butter: '#efe4b3', sky: '#d2dee8', cream: '#ebe5d4', peach: '#eeccb4', lilac: '#ded4e9', sand: '#c9b07e', night: '#383750' });
// The look on a pastel sheet: n names a PASTELS paper or is any colour.
export function pastel(look, n) {
  const paper = PASTELS[n] ?? n;
  parse(paper);
  return withLook(look, { name: `${resolveLook(look).name}~${n}`, palette: { paper } });
}

const lookMemo = new WeakMap();
export function hashLook(l) {
  const full = resolveLook(l);
  let h = lookMemo.get(full);
  if (!h) { h = hashData(full); lookMemo.set(full, h); }
  return h;
}

// ---------- roles ----------

// 'ink' | 'fills.2' | { base, tint?, shade?, alpha?, hue?, mix?: [role, t] } => CSS colour.
export function resolveRole(role, look) {
  const p = resolveLook(look).palette;
  if (typeof role === 'string') {
    if (role[0] === '#' || /^rgba?\(/.test(role)) throw new Error(`role '${role}': raw colours are not roles; use a palette role (ink, fills.0, ...)`);
    const [key, idx] = role.split('.');
    let v = p[key];
    if (idx !== undefined) {
      if (!Array.isArray(v)) throw new Error(`role '${role}': '${key}' is not a list`);
      v = v[+idx % v.length];
    }
    if (typeof v !== 'string') throw new Error(`role '${role}' is not in look '${resolveLook(look).name}'`);
    return v;
  }
  if (!role || typeof role !== 'object' || role.base === undefined) throw new TypeError(`role: expected a name or { base, ... }, got ${JSON.stringify(role)}`);
  let c = resolveRole(role.base, look);
  if (role.hue) c = rotateHue(c, role.hue);
  if (role.mix) c = mix(c, resolveRole(role.mix[0], look), role.mix[1]);
  if (role.tint) c = tint(c, role.tint);
  if (role.shade) c = shade(c, role.shade);
  if (role.alpha !== undefined) c = alpha(c, role.alpha);
  return c;
}

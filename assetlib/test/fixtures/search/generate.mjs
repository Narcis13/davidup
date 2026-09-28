// The search fixture (A3): writes project, user and house catalogue.json here. 31 entries, 30 records (the
// project's paper-warm shadows the house's). Catalogues only: search reads no blobs. Run it after editing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, validate, mediaOf } from '../../../index.js';
const ROOT = dirname(fileURLToPath(import.meta.url));
const EXT = { stock: 'webp', cutout: 'webp', image: 'png', puppet: 'json', clip: 'json', hand: 'json', motif: 'json', font: 'ttf', audio: 'mp3', sample: 'wav', video: 'mp4' };
const e = (kind, name, o = {}) => ({ kind, name, desc: '', tags: [], licence: 'own', credit: '', source: '', ...o, ext: o.ext ?? EXT[kind], media: mediaOf(kind) });
const met = (id) => ({ licence: 'CC0', credit: `${id}, The Met, Open Access`, source: `https://www.metmuseum.org/art/collection/search/${id}` });
const shelves = {
  house: {
    'paper-warm': e('stock', 'Warm paper', { desc: 'cream laid paper, soft fibres', tags: ['paper', 'warm', 'texture'], w: 2048, h: 2048, box: [0, 0, 2048, 2048], alpha: false, colours: [{ hex: '#efe6d4', area: 0.9 }, { hex: '#e2d6bf', area: 0.1 }], added: '2026-09-20' }),
    'paper-kraft': e('stock', 'Kraft paper', { desc: 'brown wrapping paper', tags: ['paper', 'brown', 'texture'], licence: 'CC0', w: 1920, h: 1080, box: [0, 0, 1920, 1080], alpha: false, colours: [{ hex: '#c8a878', area: 1 }], added: '2026-09-18' }),
    'paper-graph': e('stock', 'Graph paper', { desc: 'blue grid on white', tags: ['paper', 'grid'], w: 1920, h: 1080, box: [0, 0, 1920, 1080], alpha: false, colours: [{ hex: '#f4f6f8', area: 0.8 }, { hex: '#9fb6d6', area: 0.2 }], added: '2026-09-10' }),
    chalkboard: e('stock', 'Chalkboard', { desc: 'dark slate with chalk dust', tags: ['board', 'dark'], w: 1920, h: 1080, box: [0, 0, 1920, 1080], alpha: false, colours: [{ hex: '#2b3230', area: 0.95 }, { hex: '#d8dcd9', area: 0.05 }], added: '2026-09-12' }),
    linen: e('stock', 'Linen', { desc: 'woven linen, cool grey', tags: ['fabric', 'texture'], licence: 'CC0', w: 1024, h: 1024, box: [0, 0, 1024, 1024], alpha: false, colours: [{ hex: '#c9ccd1', area: 1 }], added: '2026-09-05' }),
    teapot: e('cutout', 'Teapot', { desc: 'silver teapot, three-quarter view', tags: ['met', 'object', 'kitchen'], ...met('teapot'), w: 1093, h: 627, box: [0, 0, 1093, 627], sil: { sub: [{ pts: [0, 0, 1093, 0, 1093, 627], closed: true }], box: [0, 0, 1093, 627] }, colours: [{ hex: '#b2ab9c', area: 0.6 }], added: '2026-09-01' }),
    violin: e('cutout', 'Violin', { desc: 'baroque violin, front', tags: ['met', 'object', 'music'], ...met('violin'), w: 395, h: 1167, box: [0, 0, 395, 1167], sil: { sub: [{ pts: [0, 0, 395, 0, 395, 1167], closed: true }], box: [0, 0, 395, 1167] }, colours: [{ hex: '#814722', area: 0.7 }], added: '2026-09-01' }),
    helmet: e('cutout', 'Helmet', { desc: 'close helmet, steel', tags: ['met', 'object', 'armour'], ...met('helmet'), w: 726, h: 1007, box: [0, 0, 726, 1007], sil: { sub: [{ pts: [0, 0, 726, 0, 726, 1007], closed: true }], box: [0, 0, 726, 1007] }, colours: [{ hex: '#494139', area: 0.8 }], added: '2026-09-01' }),
    terrier: e('cutout', 'Terrier', { desc: 'wire-haired terrier sitting, side view', tags: ['animal', 'pet'], licence: 'CC-BY', credit: 'A. Photographer', source: 'https://example.org/terrier', w: 600, h: 520, box: [0, 0, 600, 520], sil: { sub: [{ pts: [0, 0, 600, 0, 600, 520], closed: true }], box: [0, 0, 600, 520] }, colours: [{ hex: '#a0785a', area: 0.8 }], added: '2026-09-14' }),
    'sky-dusk': e('image', 'Dusk sky', { desc: 'orange dusk sky over hills', tags: ['sky', 'sunset'], licence: 'CC0', ext: 'jpg', w: 1920, h: 1080, alpha: false, colours: [{ hex: '#e88a4a', area: 0.6 }, { hex: '#5a3a5e', area: 0.4 }], added: '2026-09-15' }),
    'night-city': e('image', 'City at night', { desc: 'city lights at night', tags: ['city', 'night'], licence: 'CC0', ext: 'jpg', w: 3840, h: 2160, alpha: false, colours: [{ hex: '#141a2e', area: 0.85 }, { hex: '#f2c14e', area: 0.15 }], added: '2026-09-16' }),
    'logo-mark': e('image', 'Logo mark', { desc: 'round blue mark', tags: ['logo', 'brand'], w: 512, h: 512, alpha: true, colours: [{ hex: '#2a6bd1', area: 1 }], added: '2026-09-02' }),
    fox: e('puppet', 'Fox', { desc: 'a red fox that trots and sits', tags: ['animal', 'cast'], box: [0, 0, 300, 200], units: 100, added: '2026-09-03' }),
    sam: e('puppet', 'Sam', { desc: 'a girl in a yellow raincoat who follows the fox', tags: ['cast', 'sketch'], box: [0, 0, 120, 300], units: 100, added: '2026-09-03' }),
    'pack:teapot': e('puppet', 'pack:teapot', { desc: 'a round teapot; the lid lifts', tags: ['pack', 'objects'], box: [0, 0, 200, 160], units: 100, added: '2026-09-04' }),
    horse: e('clip', 'Horse', { desc: 'a galloping horse, twelve poses', tags: ['muybridge', 'animal'], licence: 'PD', credit: 'Eadweard Muybridge, 1878', source: 'https://commons.wikimedia.org/wiki/Horse_in_Motion', box: [0, 0, 400, 271], n: 12, fps: 12, h: 271, added: '2026-09-06' }),
    'walk-cycle': e('clip', 'Walk cycle', { desc: 'a person walking, traced from a phone video', tags: ['walk', 'cycle'], box: [0, 0, 200, 400], n: 16, fps: 12, added: '2026-09-07' }),
    'hershey-script': e('hand', 'Hershey script', { desc: 'joined cursive single-stroke letters', tags: ['hand', 'hershey'], licence: 'PD', credit: 'A. V. Hershey', source: '', glyphs: 95, added: '2026-09-08' }),
    'leaf-motif': e('motif', 'Leaf', { desc: 'a single leaf for borders', tags: ['leaf', 'border', 'nature'], box: [0, 0, 64, 64], added: '2026-09-09' }),
    inter: e('font', 'Inter', { desc: 'a sans for interfaces', tags: ['sans', 'ui'], licence: 'OFL', credit: 'Rasmus Andersson', source: 'https://rsms.me/inter/', family: 'Inter', weight: 400, added: '2026-09-02' }),
    caveat: e('font', 'Caveat', { desc: 'a casual handwritten script', tags: ['handwriting', 'script'], licence: 'OFL', credit: 'Impallari Type', source: 'https://fonts.google.com/specimen/Caveat', family: 'Caveat', weight: 400, added: '2026-09-02' }),
    'rain-loop': e('audio', 'Rain loop', { desc: 'steady rain on a window', tags: ['ambience', 'rain'], licence: 'CC0', sec: 30, rate: 48000, channels: 2, codec: 'mp3', added: '2026-09-11' }),
    'piano-bed': e('audio', 'Piano bed', { desc: 'a calm piano under narration', tags: ['music', 'piano', 'calm'], sec: 45, rate: 44100, channels: 2, codec: 'mp3', added: '2026-09-11' }),
    'narr-moon': e('sample', 'Moon line', { desc: 'The moon has no light of its own.', tags: ['voice', 'narration', 'moon'], sec: 5.2, added: '2026-09-13' }),
    'bit-dog': e('sample', 'bit-dog', { desc: 'A dog!', tags: ['voice', 'how-ai-learns'], sec: 1.2, added: '2026-09-13' }),
    'ocean-drone': e('video', 'Ocean from above', { desc: 'aerial shot of waves breaking', tags: ['ocean', 'aerial'], licence: 'CC0', sec: 12, fps: 30, w: 1920, h: 1080, alpha: false, codec: 'h264', audio: false, colours: [{ hex: '#1d4e6b', area: 0.8 }, { hex: '#e8eef0', area: 0.2 }], added: '2026-09-17' }),
  },
  user: {
    'fox-wave': e('video', 'Fox waves', { desc: 'the fox waves hello', tags: ['fox', 'hdf'], sec: 4, fps: 12, w: 1080, h: 1080, alpha: true, codec: 'prores', audio: false, colours: [{ hex: '#d9622b', area: 0.5 }], made: { tool: 'hdf render', from: ['fox'], args: { film: 'fox-wave' }, at: '2026-09-19' }, ext: 'mov', added: '2026-09-19' }),
    'title-card': e('image', 'Title card', { desc: 'white card for a title', tags: ['title'], w: 1920, h: 1080, alpha: false, colours: [{ hex: '#fafafa', area: 1 }], added: '2026-09-21' }),
  },
  project: {
    'paper-warm': e('stock', 'Warm paper', { desc: "the project's own warm paper, rougher", tags: ['paper', 'warm', 'texture'], w: 2048, h: 2048, box: [0, 0, 2048, 2048], alpha: false, colours: [{ hex: '#eadcc0', area: 1 }], added: '2026-09-27' }),
    'cafe-sign': e('image', 'Café sign', { desc: 'a painted sign over a café door', tags: ['sign', 'café'], w: 1200, h: 800, alpha: true, colours: [{ hex: '#2f5d3a', area: 0.6 }], added: '2026-09-26' }),
    mug: e('cutout', 'Mug', { desc: 'an enamel mug', tags: ['object', 'kitchen'], licence: 'CC-BY', credit: 'Jane Doe', source: 'https://example.org/mug', w: 400, h: 480, box: [0, 0, 400, 480], sil: { sub: [{ pts: [0, 0, 400, 0, 400, 480], closed: true }], box: [0, 0, 400, 480] }, colours: [{ hex: '#f3f1ec', area: 0.9 }], added: '2026-09-25' }),
  },
};
let n = 0;
for (const [shelf, entries] of Object.entries(shelves)) {
  const lines = Object.keys(entries).sort().map((id) => {
    const x = { ...entries[id], sha: sha(`${shelf}/${id}`) };
    const { media, ...rest } = x; // keep key order: put media after kind
    const out = { kind: x.kind, media, ...rest };
    const bad = validate(id, out);
    if (bad.length) throw new Error(`${shelf}/${id}: ${bad.join('; ')}`);
    n++;
    return `${JSON.stringify(id)}: ${JSON.stringify(out)}`;
  });
  mkdirSync(join(ROOT, shelf), { recursive: true });
  writeFileSync(join(ROOT, shelf, 'catalogue.json'), `{\n${lines.join(',\n')}\n}\n`);
}
console.log(n, 'entries');

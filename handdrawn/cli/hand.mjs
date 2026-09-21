// hdf hand: hands into the store (plan 1.4). A hand is the glyphs a look letters in and the pen profile its
// strokes are drawn with; `--look 'risoPop~hand:<id>'` letters and draws a film in it.
//
//   hdf hand --synth test                 a deterministic hand made from the house one (tests, goldens)
//   hdf hand --synth test --root ../other into a store that is not handdrawn/assets
//   node cli/hand.mjs --synth test        the same, without the hdf entry
//
// `hdf hand --template` and `hdf hand <sheet.jpg> --name <id>` (your own hand from a photographed sheet)
// land in S12; --synth is how the package tests a hand without a photo.
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS } from '../core/glyphs.js';
import { hash32, rng } from '../core/rand.js';
import { putPayload } from './import.mjs';
import { parseArgs } from './hdf.mjs';
import { UsageError } from './load.mjs';

// The synthetic hand's profile: a backhand (slant -6), looser and faster than the house, corners run past,
// lines hooked on entry, pressed hardest mid-stroke.
export const SYNTH = Object.freeze({
  track: 6, slant: -6, baselineDrift: 1.8,
  stroke: { wobble: 2.2, overshoot: 0.15, hook: 0.35, pressure: [0.7, 1, 0.85], speed: 1150, tremor: 0.5, rounding: 0.3 },
});

const r1 = (v) => Math.round(v * 10) / 10;

// The house glyphs perturbed by a seeded rng: each glyph a little narrower and taller, each stroke pushed by
// two slow waves (about 2.5 em units), so every letter is recognisably itself and none is the house's.
export function synthHand(id) {
  const r = rng(hash32('hand', id)), glyphs = {};
  for (const [ch, g] of Object.entries(GLYPHS)) {
    if (!g.s.length) { glyphs[ch] = { w: g.w, s: [] }; continue; }   // the space
    const sx = 0.9 + r() * 0.08, sy = 1.04 + r() * 0.08;
    glyphs[ch] = {
      w: r1(Math.max(8, g.w * sx)),
      s: g.s.map((pts) => {
        const a = 1.8 + r() * 1.4, f1 = 0.04 + r() * 0.05, f2 = 0.04 + r() * 0.05, p1 = r() * 6.3, p2 = r() * 6.3, out = new Array(pts.length);
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i], y = pts[i + 1];
          out[i] = r1(x * sx + a * Math.sin(y * f1 + p1));
          out[i + 1] = r1(y * sy + a * 0.7 * Math.sin(x * f2 + p2));
        }
        return out;
      }),
    };
  }
  return { kind: 'hand', name: id, glyphs, ...SYNTH, stroke: { ...SYNTH.stroke }, credit: 'synthesised from the house hand by `hdf hand --synth`', licence: 'own' };
}

export async function run(args, flags) {
  if (flags.template || args.length) throw new UsageError('hand: --template and <sheet.jpg> arrive in S12; for now `hdf hand --synth <id>`');
  const id = flags.synth === true || flags.synth === undefined ? '' : String(flags.synth);
  if (!id) throw new UsageError('hand: need --synth <id>');
  const data = synthHand(id);
  return putPayload({
    kind: 'hand', name: id, bytes: Buffer.from(JSON.stringify(data) + '\n'), abs: resolve(`${id}.hand.json`),
    flags: { licence: 'own', credit: data.credit, tags: 'hand,synthetic', ...flags },
  });
}

const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const { args, flags } = parseArgs(process.argv.slice(2));
  run(args, flags).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`hand: ${e.message}\n`); process.exitCode = e instanceof UsageError ? 2 : 1; });
}

// hdf stick --name sam [--h 300] [--build kid|adult|tall|round] [--style line|tube] [--hands dots|mitts|none]
// [--no-face] [--root dir] [--no-sheet]: a stick puppet (4.0 K2), the explainer's first citizen. Writes the
// stick source to <store>/src/<name>.stick.json (joints, bones, head, the front spread; edit it and run
// `hdf import <it> --kind puppet --name <name>` to take the edit), puts it in the store compiled to parts
// (core/stick.js) and draws its sheet. A cycle retargeted onto an earlier <name> is kept.
//
//   hdf stick --name sam --build kid --style tube
//   hdf retarget --clip me --to sam --name walk      no --map: the stick's joints are the biped rig's
//   hdf sheet store sam --cycle walk
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSET_ROOT } from '../core/assets.js';
import { BUILDS, HANDS, STYLES, compileStick, stickSource } from '../core/stick.js';
import { putPayload } from './import.mjs';
import { UsageError } from './load.mjs';
import { storeSheet } from './sheet.mjs';
import { keepRetargeted } from './svg.mjs';

const str = (v) => (v === undefined || v === true ? '' : String(v));

export async function run(args, flags) {
  const name = str(flags.name), build = str(flags.build) || 'adult', style = str(flags.style) || 'line', hands = str(flags.hands) || 'dots';
  const h = flags.h === undefined ? 300 : +flags.h;
  if (!name) throw new UsageError('stick: need --name <id>');
  if (!BUILDS[build]) throw new UsageError(`stick: --build ${build} (expected ${Object.keys(BUILDS).join(' | ')})`);
  if (!STYLES.includes(style)) throw new UsageError(`stick: --style ${style} (expected ${STYLES.join(' | ')})`);
  if (!HANDS.includes(hands)) throw new UsageError(`stick: --hands ${hands} (expected ${HANDS.join(' | ')})`);
  if (!(h > 0)) throw new UsageError(`stick: --h ${flags.h}; the figure's height in units, > 0`);

  const src = stickSource({ name, h, build, style, hands, face: flags.face !== false });
  const root = flags.root ? resolve(String(flags.root)) : ASSET_ROOT, dir = join(root, 'src'), file = join(dir, `${name}.stick.json`);
  mkdirSync(dir, { recursive: true });
  const had = existsSync(file);
  writeFileSync(file, `${JSON.stringify(src, null, 2)}\n`);
  const d = compileStick(src);
  process.stdout.write(`${file}  ${had ? 'rewritten' : 'new'}: ${build}, ${style}, hands ${hands}, ${src.head.face ? 'a face' : 'no face'}, ${h} units\n`
    + `  parts: ${Object.keys(d.parts).join(' ')}\n  views: ${d.views.join(', ')}\n`);
  // The stored payload is the compiled one, with any retargeted cycle the earlier puppet of this name had.
  const payload = { ...src };
  keepRetargeted(payload, name, flags);
  await putPayload({ kind: 'puppet', name, bytes: Buffer.from(JSON.stringify(payload)), abs: file, flags: { licence: 'own', ...flags } });
  if (flags.sheet !== false) await storeSheet(name, { root: flags.root, ...(payload.cycles ? { cycle: Object.keys(payload.cycles)[0] } : {}) });
  process.stdout.write(`next: hdf retarget --clip <biped clip> --to ${name} --name walk   (no --map: a stick is the biped rig)\n`);
  return 0;
}

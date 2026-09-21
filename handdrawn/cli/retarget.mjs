// hdf retarget --clip <id> --to <puppet> --map <map.json> --name <cycle>: a clip's skeleton as a puppet's cycle
// (3.0 S14). Per frame, each mapped part follows its clip chain's direction (core/retarget.js), quantised to
// 2 degrees, with a lift scaled by leg length; the cycle is written into the puppet's payload in the store
// (a new sha, the catalogue updated, the old blob dropped) and recorded with where it came from, so the
// command can be run again. A cycle of that name is replaced. The payload must still pass lint (the box has
// to hold every frame), as `hdf import` checks it.
//
//   hdf clip --store horse --rig quadruped                                  the skeleton, once
//   hdf retarget --clip horse --to fox --map horse-fox.json --name gallop   (maps: as given, else the store's src/)
//   hdf sheet store fox --cycle gallop
//   hdf clip --kind pose work/me --name me                                  your walk, filmed (3.0 S15)
//   hdf retarget --clip me --to fox --map biped-fox.json --name walk        replaces the hand-authored walk
//   hdf retarget --clip me --to sam --name walk                             a stick (4.0 K2) derives its own map
//
// --dry prints the frames and the lift without writing; --root <dir> works on another store.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { lintPuppet } from '../core/lint.js';
import { retarget } from '../core/retarget.js';
import { stickMap } from '../core/stick.js';
import { UsageError } from './load.mjs';

const str = (v) => (v === undefined || v === true ? '' : String(v));

export async function run(args, flags) {
  const clipId = str(flags.clip), to = str(flags.to), mapArg = str(flags.map), name = str(flags.name);
  if (!clipId || !to || !name) throw new UsageError('retarget: need --clip <id> --to <puppet> --map <map.json> --name <cycle> (a stick puppet needs no --map)');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const ce = st.entry(clipId), pe = st.entry(to);
  if (ce.kind !== 'clip') throw new UsageError(`retarget: --clip ${clipId} is a ${ce.kind}, not a clip`);
  if (pe.kind !== 'puppet') throw new UsageError(`retarget: --to ${to} is a ${pe.kind}, not a puppet`);
  const clip = st.json(ce), d = st.json(pe);
  if (d.mirror) throw new UsageError(`retarget: '${to}' mirrors a pack cel; it has inputs, not joints`);
  let map, mapFile;
  if (mapArg) {
    const dirs = [...new Set([join(st.root, 'src'), join(ASSET_ROOT, 'src')])];
    mapFile = [resolve(mapArg), ...dirs.map((dd) => join(dd, mapArg))].find(existsSync);
    if (!mapFile) throw new UsageError(`retarget: no map '${mapArg}' (looked here and in ${dirs.join(', ')})`);
    map = JSON.parse(readFileSync(mapFile, 'utf8'));
  } else if (d.stick) {
    map = stickMap(d);   // a stick's joints are the biped rig's (4.0 K2)
    if (clip.rig && clip.rig !== 'biped') throw new UsageError(`retarget: '${to}' is a stick, a biped; the clip is ${clip.rig} (give a --map)`);
  } else throw new UsageError(`retarget: need --map <map.json> ('${to}' is not a stick puppet, so no map can be derived)`);

  const { cycle, report } = retarget(clip, d, map);
  const joints = report.parts;
  process.stdout.write(`${clipId} -> ${to}.${name}: ${cycle.n} frames at ${cycle.fps} fps, ${joints.join(' ')}`
    + `${report.flip ? ', mirrored' : ''}, lift x${report.scale}${mapFile ? '' : ', map from the stick'}\n`);
  cycle.frames.forEach((f, k) => process.stdout.write(`  ${String(k).padStart(2)}  ${joints.map((j) => `${j} ${f[j]}`).join('  ')}${f.lift ? `  lift ${f.lift}` : ''}\n`));
  if (flags.dry) return 0;

  const data = { ...d, cycles: { ...(d.cycles ?? {}), [name]: { ...cycle, from: { clip: clipId, sha: ce.sha, map: mapFile ? basename(mapFile) : 'stick' } } } };
  const found = lintPuppet(data, to);
  if (found.length) throw new Error(`retarget: ${to} with cycle '${name}' does not pass lint:\n  ${found.map((f) => `${f.rule}  ${f.detail}`).join('\n  ')}`);
  const bytes = Buffer.from(JSON.stringify(data));
  const was = d.cycles?.[name];
  if (was) process.stdout.write(`replaces cycle ${name} (${was.from ? `retargeted from ${was.from.clip}` : 'hand-authored'})\n`);
  const put = st.put({ ...pe }, bytes);
  if (put.sha !== pe.sha && ![...st.entries.values()].some((e) => e.sha === pe.sha)) rmSync(st.payloadPath(pe), { force: true });
  process.stdout.write(`${to}  puppet  ${put.sha}.json  cycles: ${Object.keys(data.cycles).join(', ')}  (${put.sha === pe.sha ? 'unchanged' : `replaces ${pe.sha.slice(0, 8)}`})\n`);
  return 0;
}

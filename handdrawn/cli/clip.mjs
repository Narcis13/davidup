// hdf clip <input> [--name id] [--js clips.js]: traced clips into the v2 format (plan 1.6), as an ES module
// of plain data that a film registers with engines/traced.js:
//   registerClips(CLIPS)   (CLIPS: this module's default export, imported by the film)
// <input> is what cli/roto.py writes (a clips.js of registerClip("name", {...}) lines; roto.py is v1's,
// unchanged), a JSON file of one clip (needs --name) or of { name: clip }. Clips already in --js are kept
// unless the input replaces them. --name picks one clip out of a multi-clip input.
//
//   python3 cli/roto.py work/horse --name horse --kind disc --drop-last --js work/clips.js --credit "..."
//   hdf clip work/clips.js --js films/gallop-clips.js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError } from './load.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flat().map(r1);

// One clip, v1 or v2 shape in, v2 plain data out: { n, fps, h, credit, source, frames: [{ outer, lines }] }.
export function toV2(c) {
  const frames = c.frames.map((fr) => {
    const outer = Array.isArray(fr.outer)
      ? { sub: fr.outer.map((q) => ({ pts: flat(q), closed: true })) }
      : { sub: fr.outer.sub.map((s) => ({ pts: s.pts.map(r1), closed: s.closed !== false })) };
    const lines = fr.lines.map((l) => ({ path: { sub: [{ pts: l.p ? flat(l.p) : (l.path.sub?.[0]?.pts ?? l.path).map(r1), closed: false }] }, w: r1(l.w) }));
    return { outer, lines };
  });
  return { n: c.n ?? frames.length, fps: c.fps ?? 12, h: c.h, credit: c.credit ?? '', source: c.source ?? '', frames };
}

// { name: clip } from a roto.py clips.js or a JSON file.
export function readClips(file, name) {
  const text = readFileSync(file, 'utf8');
  const out = {};
  if (/registerClip\s*\(/.test(text)) {
    for (const m of text.matchAll(/registerClip\(\s*["']([\w-]+)["']\s*,\s*(\{.*\})\s*\)\s*;?\s*$/gm)) out[m[1]] = JSON.parse(m[2]);
  } else {
    const data = JSON.parse(text);
    if (Array.isArray(data.frames)) {
      if (!name) throw new UsageError('clip: a single-clip JSON needs --name');
      out[name] = data;
    } else Object.assign(out, data);
  }
  if (!Object.keys(out).length) throw new Error(`clip: no clips found in ${file}`);
  return out;
}

const HEAD = [
  '// Traced clips (found motion), written by hdf clip. One line per clip; register them with',
  "// engines/traced.js: the film imports this module's default export and calls registerClips on it.",
  'export const CLIPS = {};',
  'export default CLIPS;',
];

export async function run([input], flags) {
  if (!input) throw new UsageError('clip: need <clips.js | clip.json>');
  if (!existsSync(input)) throw new UsageError(`clip: no such file '${input}'`);
  const name = typeof flags.name === 'string' ? flags.name : undefined;
  let got = readClips(input, name);
  if (name && Object.keys(got).length > 1) {
    if (!got[name]) throw new Error(`clip: '${name}' is not in ${input} (have ${Object.keys(got).join(', ')})`);
    got = { [name]: got[name] };
  }
  const js = resolve(String(flags.js ?? 'clips.js'));
  const all = {};
  if (existsSync(js)) Object.assign(all, (await import(pathToFileURL(js).href + `?t=${Date.now()}`)).default);
  for (const [k, v] of Object.entries(got)) all[k] = toV2(v);
  writeFileSync(js, [...HEAD, ...Object.entries(all).map(([k, v]) => `CLIPS[${JSON.stringify(k)}] = ${JSON.stringify(v)};`)].join('\n') + '\n');
  for (const [k, v] of Object.entries(got)) process.stdout.write(`${k}  ${v.frames.length} poses  h ${v.h}  -> ${js}\n`);
  return 0;
}

// hdf clip <input> [--name id] [--js clips.js]: traced clips into the v2 format (plan 1.6), as an ES module
// of plain data that a film registers with engines/traced.js:
//   registerClips(CLIPS)   (CLIPS: this module's default export, imported by the film)
// <input> is what cli/roto.py writes (a clips.js of registerClip("name", {...}) lines), a JSON file of one
// clip (needs --name) or of { name: clip }. Clips already in --js are kept unless the input replaces them.
// --name picks one clip out of a multi-clip input.
//
// Skeletons (3.0 S14): a clip whose roto.py run named a rig (`--rig quadruped|biped`), or any clip given
// `--rig` here, gets `skel: { joints, chains }` in every frame, labelled from its silhouette by core/rig.js
// (`--facing -1` for a figure that faces left); a frame that already has one keeps it. `--store <id>` does
// the same to a clip in the asset store, in place (new sha, catalogue updated, the old blob dropped). Either
// way the check sheet out/clip-<name>-skel.jpg draws every frame's skeleton on its silhouette.
//
//   python3 cli/roto.py work/horse --name horse --kind disc --drop-last --rig quadruped --js work/clips.js
//   hdf clip work/clips.js --js films/gallop-clips.js
//   hdf clip --store horse --rig quadruped          the horse in the store, without its source frames
//
// Motion from your phone (3.0 S15): `--kind pose <frames-dir> --name me` runs cli/pose.py (MediaPipe's pose
// landmarker, in the python named by $HDF_PYTHON, else python3) over the frames, keeps what it found in
// out/pose-<name>.json, and puts a biped clip into the store (core/pose.js: the skeleton from the landmarks,
// their hull as the outline, 12 fps, cut to its best loop unless --no-loop; licence `own` unless --licence).
// Given that .json instead of a folder it skips MediaPipe, so a clip can be made again without it installed.
// Without mediapipe it says what to install.
//
//   ffmpeg -i me.mov -vf fps=30 work/me/%04d.png
//   hdf clip --kind pose work/me --name me [--fps 30] [--model pose_landmarker_full.task]
//   hdf retarget --clip me --to fox --map biped-fox.json --name walk
//
// Your face and hands (4.0 K7): `--kind face <frames-dir> --name me-face` runs cli/track.py (MediaPipe's face
// landmarker with its blendshapes), keeps them in out/face-<name>.json and puts a face track into the store
// (core/face.js: twelve channels a frame at 12 fps, the take's resting level taken off); `--kind hands` the
// same with the hand landmarker (out/hands-<name>.json, five finger curls a hand a frame). Given that .json
// it skips MediaPipe. A film reads a track with actor.face(id, t, t0) / actor.hands(id, t, t0).
//
//   hdf clip --kind face work/me --name me-face [--fps 30] [--model face_landmarker.task]
//   hdf clip --kind hands work/me --name me-hands
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { poseClip } from '../core/pose.js';
import { FACE_KEYS, faceClip, handsClip, nearestHand } from '../core/face.js';
import { RIGS, rigClip } from '../core/rig.js';
import { putPayload } from './import.mjs';
import { UsageError } from './load.mjs';
import { skiaCanvas } from './skia.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flat().map(r1);

// One clip, v1 or v2 shape in, v2 plain data out: { n, fps, h, credit, source, frames: [{ outer, lines }] }.
export function toV2(c) {
  const frames = c.frames.map((fr) => {
    const outer = Array.isArray(fr.outer)
      ? { sub: fr.outer.map((q) => ({ pts: flat(q), closed: true })) }
      : { sub: fr.outer.sub.map((s) => ({ pts: s.pts.map(r1), closed: s.closed !== false })) };
    const lines = (fr.lines ?? []).map((l) => ({ path: { sub: [{ pts: l.p ? flat(l.p) : (l.path.sub?.[0]?.pts ?? l.path).map(r1), closed: false }] }, w: r1(l.w) }));
    return fr.skel ? { outer, lines, skel: fr.skel } : { outer, lines };
  });
  return {
    n: c.n ?? frames.length, fps: c.fps ?? 12, h: c.h, credit: c.credit ?? '', source: c.source ?? '',
    ...(c.rig ? { rig: c.rig, facing: c.facing ?? 1 } : {}), frames,
  };
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

// The rig to label a clip with: --rig, else the one its roto.py run recorded, else none.
function rigOf(clip, flags) {
  const rig = typeof flags.rig === 'string' ? flags.rig : clip.rig;
  if (rig !== undefined && !RIGS[rig]) throw new UsageError(`clip: --rig ${rig} (expected ${Object.keys(RIGS).join(' | ')})`);
  return rig;
}
const rigged = (clip, flags) => {
  const rig = rigOf(clip, flags);
  return rig ? rigClip(clip, rig, { facing: flags.facing !== undefined ? +flags.facing : clip.facing ?? 1, force: !!flags.force }) : clip;
};

export async function run([input], flags) {
  if (flags.kind !== undefined) {
    if (flags.kind === 'face' || flags.kind === 'hands') return tracked(String(flags.kind), input, flags);
    if (flags.kind !== 'pose') throw new UsageError(`clip: --kind ${flags.kind} (expected pose, face or hands; traced clips come from cli/roto.py)`);
    return posed(input, flags);
  }
  if (flags.store) return rigStored(String(flags.store), flags);
  if (!input) throw new UsageError('clip: need <clips.js | clip.json> (or --store <id> --rig <rig>)');
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
  for (const [k, v] of Object.entries(got)) all[k] = toV2(rigged(v, flags));
  writeFileSync(js, [...HEAD, ...Object.entries(all).map(([k, v]) => `CLIPS[${JSON.stringify(k)}] = ${JSON.stringify(v)};`)].join('\n') + '\n');
  for (const k of Object.keys(got)) {
    const v = all[k];
    process.stdout.write(`${k}  ${v.frames.length} poses  h ${v.h}${v.rig ? `  ${v.rig} skeleton` : ''}  -> ${js}\n`);
    if (v.rig) process.stdout.write(`${await skelSheet(k, v, flags.out)}\n`);
  }
  return 0;
}

// A clip in the store given its skeleton, in place: the payload rewritten, the entry's sha moved on.
async function rigStored(id, flags) {
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const was = st.entry(id);
  if (was.kind !== 'clip') throw new UsageError(`clip --store: '${id}' is a ${was.kind}, not a clip`);
  const clip = st.json(was);
  if (!rigOf(clip, flags)) throw new UsageError(`clip --store ${id}: which rig? --rig ${Object.keys(RIGS).join(' | ')}`);
  const out = rigged(clip, flags), bytes = Buffer.from(JSON.stringify(out));
  const put = st.put({ ...was }, bytes);
  if (put.sha !== was.sha && ![...st.entries.values()].some((e) => e.sha === was.sha)) rmSync(st.payloadPath(was), { force: true });
  process.stdout.write(`${id}  clip  ${put.sha}.json  ${out.rig} skeleton, ${out.frames.length} frames  (${put.sha === was.sha ? 'unchanged' : `replaces ${was.sha.slice(0, 8)}`})\n`);
  process.stdout.write(`${await skelSheet(id, out, flags.out)}\n`);
  return 0;
}

const PY = () => process.env.HDF_PYTHON || 'python3';
const INSTALL = (py, why) => `clip --kind pose: needs MediaPipe, and ${why}.\n`
  + '  python3 -m pip install mediapipe        (or a virtualenv with it: HDF_PYTHON=<venv>/bin/python)\n'
  + '  the Tasks API also wants its model: cli/pose.py --help says where to put pose_landmarker_full.task\n'
  + `  (checked: ${py} -c 'import mediapipe')\n`
  + 'Landmarks already found (out/pose-<name>.json) need none of it: hdf clip --kind pose out/pose-<name>.json --name <id>\n';

// A folder of frames (through MediaPipe) or its landmarks JSON -> a biped clip in the store.
async function posed(input, flags) {
  const name = typeof flags.name === 'string' ? flags.name : '';
  if (!input || !name) throw new UsageError('clip --kind pose: need <frames-dir | landmarks.json> --name <id>');
  if (!existsSync(input)) throw new UsageError(`clip --kind pose: no such folder or file '${input}'`);
  const outDir = String(flags.out ?? 'out');
  let rawFile = input;
  if (statSync(input).isDirectory()) {
    const py = PY(), probe = spawnSync(py, ['-c', 'import mediapipe'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      process.stderr.write(INSTALL(py, probe.error ? `there is no '${py}' to run` : `'${py}' does not have it`));
      return 1;
    }
    rawFile = join(outDir, `pose-${name}.json`);
    const args = [join(dirname(fileURLToPath(import.meta.url)), 'pose.py'), input, '--fps', String(flags.fps ?? 30), '--out', rawFile];
    if (typeof flags.model === 'string') args.push('--model', flags.model);
    const r = spawnSync(py, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) return r.status ?? 1;
  }
  let raw;
  try { raw = JSON.parse(readFileSync(rawFile, 'utf8')); } catch (e) { throw new UsageError(`clip --kind pose: ${rawFile} is not landmarks JSON (${e.message})`); }
  const clip = poseClip(raw, { loop: flags.loop !== false, credit: typeof flags.credit === 'string' ? flags.credit : '', source: typeof flags.source === 'string' ? flags.source : '' });
  const p = clip.pose, loop = p.loop;
  process.stdout.write(`${name}  ${p.from} frames at ${p.fps} fps -> ${clip.n} at 12 fps, biped, facing ${clip.facing}, h ${clip.h}`
    + `${p.swaps ? `, ${p.swaps} left/right swaps undone` : ''}`
    + `${loop?.cut ? `, loop of ${loop.n} from ${loop.start} (seam ${loop.err} h)` : loop ? `, kept whole (the best loop, ${loop.n} from ${loop.start}, has a seam of ${loop.err} h)` : flags.loop === false ? ', not looped' : ''}\n`
    + `  stride ${p.stride} h from the planted foot${Math.abs(p.travel - p.stride) > 0.25 * Math.max(p.stride, 0.05) ? `; the hips cross the picture ${p.travel} h (the camera moved, or the feet slide: the planted foot is what counts)` : ` (the hips cross the picture ${p.travel} h)`}\n`);
  const code = await putPayload({ kind: 'clip', name, bytes: Buffer.from(JSON.stringify(clip)), abs: resolve(input),
    flags: { ...flags, licence: flags.licence ?? 'own' } });
  process.stdout.write(`${await skelSheet(name, clip, outDir)}\n`);
  process.stdout.write(`next: hdf retarget --clip ${name} --to fox --map biped-fox.json --name walk${flags.root ? ` --root ${flags.root}` : ''}\n`);
  return code;
}

const TRACK_INSTALL = (kind, py, why) => `clip --kind ${kind}: needs MediaPipe, and ${why}.\n`
  + '  python3 -m pip install mediapipe        (or a virtualenv with it: HDF_PYTHON=<venv>/bin/python)\n'
  + `  and the ${kind === 'face' ? 'face' : 'hand'} landmarker's model: cli/track.py --help says where to put it\n`
  + `  (checked: ${py} -c 'import mediapipe')\n`
  + `Landmarks already found (out/${kind}-<name>.json) need none of it: hdf clip --kind ${kind} out/${kind}-<name>.json --name <id>\n`;

// A folder of frames (through MediaPipe) or its landmarks JSON -> a face or hands track in the store.
async function tracked(kind, input, flags) {
  const name = typeof flags.name === 'string' ? flags.name : '';
  if (!input || !name) throw new UsageError(`clip --kind ${kind}: need <frames-dir | landmarks.json> --name <id>`);
  if (!existsSync(input)) throw new UsageError(`clip --kind ${kind}: no such folder or file '${input}'`);
  const outDir = String(flags.out ?? 'out');
  let rawFile = input;
  if (statSync(input).isDirectory()) {
    const py = PY(), probe = spawnSync(py, ['-c', 'import mediapipe'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      process.stderr.write(TRACK_INSTALL(kind, py, probe.error ? `there is no '${py}' to run` : `'${py}' does not have it`));
      return 1;
    }
    rawFile = join(outDir, `${kind}-${name}.json`);
    const args = [join(dirname(fileURLToPath(import.meta.url)), 'track.py'), kind, input, '--fps', String(flags.fps ?? 30), '--out', rawFile];
    if (typeof flags.model === 'string') args.push('--model', flags.model);
    const r = spawnSync(py, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) return r.status ?? 1;
  }
  let raw;
  try { raw = JSON.parse(readFileSync(rawFile, 'utf8')); } catch (e) { throw new UsageError(`clip --kind ${kind}: ${rawFile} is not landmarks JSON (${e.message})`); }
  const o = { credit: typeof flags.credit === 'string' ? flags.credit : '', source: typeof flags.source === 'string' ? flags.source : '' };
  const track = kind === 'face' ? faceClip(raw, o) : handsClip(raw, o);
  process.stdout.write(`${name}  ${summary(track)}\n`);
  return putPayload({ kind: 'clip', name, bytes: Buffer.from(JSON.stringify(track)), abs: resolve(input), flags: { ...flags, licence: flags.licence ?? 'own' } });
}

// What a track holds, in a line: the frames, and how busy each channel (or hand pose) is.
export function summary(t) {
  if (t.track === 'face') {
    const busy = FACE_KEYS.map((c, i) => [c, t.frames.filter((f) => Math.abs(f[i]) >= 0.3).length]).filter(([, n]) => n);
    return `${t.face.from} frames at ${t.face.fps} fps (a face in ${t.face.found}) -> a face track of ${t.n} at 12 fps`
      + `${busy.length ? `; frames at 0.3 or more: ${busy.map(([c, n]) => `${c} ${n}`).join(', ')}` : '; nothing moves (a still face?)'}`;
  }
  const poses = (s) => { const m = {}; for (const f of t.frames) if (f[s]) { const p = nearestHand(f[s]); m[p] = (m[p] ?? 0) + 1; } return Object.entries(m).map(([p, n]) => `${p} ${n}`).join(' ') || 'not seen'; };
  return `${t.hands.from} frames at ${t.hands.fps} fps -> a hands track of ${t.n} at 12 fps; l: ${poses('l')}; r: ${poses('r')}`;
}

// The check sheet: every frame's silhouette with its skeleton on it, a colour a chain, joints named on frame 0.
export async function skelSheet(name, clip, outDir = 'out') {
  const subs = (fr) => fr.outer.sub.map((q) => q.pts);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const fr of clip.frames) for (const p of subs(fr)) for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  const n = clip.frames.length, cols = Math.min(n, 6), rows = Math.ceil(n / cols), cw = 300;
  const sc = cw / (x1 - x0 + 40), ch = Math.ceil((y1 - y0 + 40) * sc);
  const cv = skiaCanvas(cols * cw, rows * ch), g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  const COL = ['#1a8f3a', '#1f4fd1', '#19a9b8', '#d12b2b', '#f08c00', '#8a3fd1'];
  clip.frames.forEach((fr, k) => {
    const ox = (k % cols) * cw + (20 - x0) * sc, oy = Math.floor(k / cols) * ch + (20 - y0) * sc, T = ([x, y]) => [ox + x * sc, oy + y * sc];
    g.beginPath();
    for (const p of subs(fr)) { g.moveTo(...T([p[0], p[1]])); for (let i = 2; i < p.length; i += 2) g.lineTo(...T([p[i], p[i + 1]])); g.closePath(); }
    g.fillStyle = '#eddcc0'; g.fill('evenodd');
    g.strokeStyle = '#0050ff'; g.lineWidth = 1; g.beginPath(); g.moveTo((k % cols) * cw, oy); g.lineTo((k % cols + 1) * cw, oy); g.stroke();
    const J = fr.skel?.joints ?? {};
    (fr.skel?.chains ?? []).forEach((c, j) => {
      g.strokeStyle = COL[j % COL.length]; g.lineWidth = 2.5; g.beginPath();
      c.forEach((nm, i) => (i ? g.lineTo(...T(J[nm])) : g.moveTo(...T(J[nm]))));
      g.stroke();
    });
    g.fillStyle = '#111'; g.font = '9px sans-serif';
    for (const [nm, p] of Object.entries(J)) {
      const [x, y] = T(p);
      g.fillRect(x - 2, y - 2, 4, 4);
      if (k === 0) g.fillText(nm, x + 3, y - 3);
    }
    g.fillStyle = '#0050ff'; g.font = '11px sans-serif'; g.fillText(String(k), (k % cols) * cw + 4, Math.floor(k / cols) * ch + 12);
  });
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `clip-${name}-skel.jpg`);
  writeFileSync(file, await cv.toBuffer('jpg', { quality: 0.88 }));
  return file;
}

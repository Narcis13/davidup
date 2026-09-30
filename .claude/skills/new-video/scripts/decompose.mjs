#!/usr/bin/env node
// Decompose a video into what an agent can look at and reason about: shots, a keyframe per shot, pacing,
// motion energy, brightness, a palette, the music's tempo and beats, and how the cuts sit on them.
//
//   node decompose.mjs <video> [--out <dir>] [--fps N] [--max-shots 48]      a reference, whole
//   node decompose.mjs <video> --study <from>,<to> [--n 10] [--out <dir>]     one moment, frame by frame
//   node decompose.mjs <audio|video> --audio [--out <dir>]                    the music alone: tempo, beats, drops
//
// Writes into <out> (default ./refs/<name>/): sheet.jpg (a tile per shot: time, length, its colours),
// rhythm.png (thumbnails over energy, brightness, loudness, cuts and beats), palette.png, decomposition.json
// and summary.md (the numbers in sentences). --study writes study-<from>-<to>-strip.jpg and -onion.jpg.
// Used by `nv refs`, `nv study`, `nv beats` and `nv render` (which decomposes its own output).
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFrames, monoSamples, probe, rgbFrames } from './lib/media.mjs';
import { arc, beatTimes, drops, frameStats, holds, motion, onBeat, onsets, palette, shotsOf, tempo } from './lib/signal.mjs';
import { onion, paletteCard, rhythm, sheet, strip } from './lib/draw.mjs';

const r2 = (x) => Math.round(x * 100) / 100;

// The saturated, not-dark pixels of some RGB frames: what the accent colours are made of.
function vivid(frames) {
  const keep = [];
  for (const f of frames) for (let o = 0; o + 2 < f.length; o += 3) {
    const r = f[o], g = f[o + 1], b = f[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 60 && (mx - mn) / mx > 0.35) keep.push(r, g, b);
  }
  return Buffer.from(keep.length ? keep : [128, 128, 128]);
}
const fmt = (t) => `${t.toFixed(2)}s`;

export async function analyzeAudio(file, { duration } = {}) {
  const a = await monoSamples(file);
  if (!a) return null;
  const { env, rms, hopRate } = onsets(a.samples, a.rate);
  const tp = tempo(env, hopRate);
  const dur = duration ?? a.samples.length / a.rate;
  const beats = beatTimes(tp, dur);
  let peak = -Infinity, sum = 0;
  for (const v of rms) { peak = Math.max(peak, v); sum += v; }
  return {
    tempo: tp, beats, drops: drops(rms, hopRate), loudness: { rms, hopRate },
    meanDb: r2(sum / Math.max(1, rms.length)), peakDb: r2(peak),
  };
}

export async function analyzeVideo(file, { fps, maxShots = 48, out, name, thumbs = 16, keyframes = true } = {}) {
  const info = probe(file);
  if (!info.video) throw new Error(`${file} has no video stream (use --audio for music)`);
  const afps = fps ?? (info.duration <= 150 ? Math.min(30, Math.round(info.fps) || 30) : 10);
  const { frames, w, h } = await rgbFrames(file, { fps: afps, width: 160 });
  const stats = frames.map((f) => frameStats(f, w, h));
  const mo = motion(stats, afps, { w, h });
  const duration = info.duration || frames.length / afps;
  const shots = shotsOf(mo.changes, duration);
  const brightness = Float32Array.from(stats.map((s) => s.mean));
  const still = holds(mo.energy, afps);
  // per shot: energy, brightness, colours of its middle frame
  for (const s of shots) {
    const a = Math.floor(s.t0 * afps), b = Math.max(a + 1, Math.floor((s.t0 + s.dur) * afps));
    let e = 0, l = 0, c = 0;
    for (let i = a; i < b && i < frames.length; i++) { e += mo.energy[i]; l += brightness[i]; c++; }
    s.energy = r2((e / Math.max(1, c)) * 100);
    s.brightness = r2(l / Math.max(1, c));
    s.mid = Math.min(frames.length - 1, Math.floor((a + b) / 2));
    s.colours = palette(frames[s.mid], { k: 4 }).slice(0, 3).map((p) => p.hex);
  }
  // the palette of the whole: a frame every half second, weighted by time
  const every = Math.max(1, Math.round(afps / 2)), pool = [];
  for (let i = 0; i < frames.length; i += every) pool.push(frames[i]);
  const whole = palette(Buffer.concat(pool), { k: 8, step: 2 }).slice(0, 7);
  const accents = palette(vivid(pool), { k: 6 }).slice(0, 5);
  const audio = info.audio ? await analyzeAudio(file, { duration }) : null;
  const durs = shots.map((s) => s.dur).sort((a, b) => a - b);
  const result = {
    file: relative(process.cwd(), resolve(file)), name: name ?? basename(file, extname(file)),
    duration: r2(duration), width: info.width, height: info.height, fps: r2(info.fps), analysedAt: afps,
    shots: shots.map(({ mid, ...s }) => ({ ...s, t0: r2(s.t0), dur: r2(s.dur) })),
    pacing: {
      count: shots.length, averageShot: r2(duration / Math.max(1, shots.length)), medianShot: r2(durs[durs.length >> 1] ?? duration),
      shortest: r2(durs[0] ?? duration), longest: r2(durs[durs.length - 1] ?? duration),
      cutsPerMinute: r2((mo.changes.length / Math.max(1e-6, duration)) * 60),
      hardCuts: mo.cuts.length,
    },
    energy: { arc: arc(mo.energy), mean: r2((mo.energy.reduce((s, v) => s + v, 0) / Math.max(1, mo.energy.length)) * 100) },
    brightness: { mean: r2(brightness.reduce((s, v) => s + v, 0) / Math.max(1, brightness.length)), arc: arc(brightness).values.map(r2) },
    holds: still.map((x) => ({ t0: r2(x.t0), dur: r2(x.dur) })),
    palette: whole, accents,
    audio: audio && {
      tempo: audio.tempo, beatCount: audio.beats.length, drops: audio.drops, meanDb: audio.meanDb, peakDb: audio.peakDb,
      cutsOnBeat: onBeat(mo.changes, audio.beats, 0.1),
    },
    cuts: mo.changes.map(r2), hardCuts: mo.cuts.map(r2),
    series: { fps: afps, energy: Array.from(mo.energy, (v) => +v.toFixed(4)), brightness: Array.from(brightness, (v) => +v.toFixed(3)) },
    beats: audio?.beats ?? [],
  };
  if (out) await writeOutputs(file, result, { out, afps, shots, audio, maxShots, thumbs, keyframes, still });
  return result;
}

async function writeOutputs(file, R, { out, afps, shots, audio, maxShots, thumbs, keyframes, still }) {
  mkdirSync(out, { recursive: true });
  const kfDir = join(out, 'keyframes');
  rmSync(kfDir, { recursive: true, force: true });
  mkdirSync(kfDir, { recursive: true });
  // keyframes: the middle of each shot (evenly thinned past maxShots), and thumbnails for the chart
  let pick = shots;
  if (shots.length > maxShots) pick = Array.from({ length: maxShots }, (_, k) => shots[Math.floor((k * shots.length) / maxShots)]);
  const thumbT = Array.from({ length: thumbs }, (_, k) => ((k + 0.5) * R.duration) / thumbs);
  const idx = [...pick.map((s) => s.mid), ...thumbT.map((t) => Math.min(Math.round(t * afps), R.series.energy.length - 1))];
  const paths = keyframes ? extractFrames(file, idx, { fps: afps, width: 480, prefix: join(kfDir, 'f') }) : [];
  const kf = paths.slice(0, pick.length), th = paths.slice(pick.length);
  const tiles = pick.map((s, k) => ({
    img: kf[k], label: `#${s.n}  ${fmt(s.t0)}`, sub: `${s.dur.toFixed(2)}s  energy ${s.energy}`, swatches: s.colours,
  }));
  const sub = `${R.duration}s · ${R.width}x${R.height} · ${R.pacing.count} shots, average ${R.pacing.averageShot}s · ${R.pacing.cutsPerMinute} changes/min`
    + (R.audio?.tempo ? ` · ~${R.audio.tempo.bpm} BPM, ${Math.round((R.audio.cutsOnBeat ?? 0) * 100)}% of changes on a beat` : '');
  await sheet(tiles, { cols: 6, tileW: 300, title: `${R.name}: a keyframe per shot`, sub, out: join(out, 'sheet.jpg') });
  await rhythm({
    duration: R.duration, fps: afps, energy: R.series.energy, brightness: R.series.brightness,
    loudness: audio?.loudness, cuts: R.hardCuts, changes: R.cuts, beats: R.beats, holds: still,
    thumbs: thumbT.map((t, k) => ({ t, img: th[k] })),
    title: `${R.name}: rhythm`, sub, out: join(out, 'rhythm.png'),
  });
  await paletteCard(R.palette, { title: `${R.name}: palette by area`, accents: R.accents, out: join(out, 'palette.png') });
  writeFileSync(join(out, 'decomposition.json'), JSON.stringify(R, null, 1) + '\n');
  writeFileSync(join(out, 'summary.md'), summary(R));
}

export function summary(R) {
  const p = R.pacing, lines = [
    `# ${R.name}`, '',
    `${R.duration} s, ${R.width}x${R.height} at ${R.fps} fps (analysed at ${R.analysedAt} fps).`, '',
    '## Pacing',
    `- ${p.count} shots (scene changes by any transition; ${p.hardCuts} of them hard cuts); average ${p.averageShot} s, median ${p.medianShot} s, shortest ${p.shortest} s, longest ${p.longest} s; ${p.cutsPerMinute} changes a minute.`,
    `- Changes at: ${R.cuts.slice(0, 40).join(', ')}${R.cuts.length > 40 ? ', …' : ''}${R.hardCuts.length ? `; hard cuts at ${R.hardCuts.slice(0, 20).join(', ')}` : ''}`,
    `- Motion (share of the frame moving, mean ${R.energy.mean}%) by fifths: ${R.energy.arc.norm.map((v) => Math.round(v * 100)).join(' / ')} (% of the busiest fifth); it ${R.energy.arc.words}.`,
    `- Still spans (nothing moves for 1.5 s or more): ${R.holds.length ? R.holds.map((x) => `${x.t0}s for ${x.dur}s`).join(', ') : 'none'}.`,
    '', '## Picture',
    `- Brightness: mean ${R.brightness.mean} (${R.brightness.mean < 0.35 ? 'dark' : R.brightness.mean > 0.6 ? 'light' : 'mid'}); by fifths ${R.brightness.arc.join(' / ')}.`,
    `- Palette by area: ${R.palette.map((c) => `${c.hex} ${Math.round(c.area * 100)}%`).join(', ')}.`,
    `- Accent colours (the saturated pixels, by their share of them): ${R.accents.map((c) => `${c.hex} ${Math.round(c.area * 100)}%`).join(', ')}.`,
  ];
  if (R.audio) {
    const a = R.audio;
    lines.push('', '## Sound');
    lines.push(a.tempo
      ? `- Tempo ~${a.tempo.bpm} BPM (a beat every ${a.tempo.period.toFixed(3)} s, first at ${a.tempo.first.toFixed(2)} s; confidence ${a.tempo.confidence}, over 1.5 is a clear pulse). Octave errors happen: half or double may be the felt tempo.`
      : '- No steady pulse found.');
    lines.push(`- Loudness: mean ${a.meanDb} dBFS, peak ${a.peakDb} dBFS. Rises (drops/hits): ${a.drops.length ? a.drops.map((d) => `${d.t}s (+${d.rise} dB)`).join(', ') : 'none over 3 dB'}.`);
    if (a.cutsOnBeat !== null) lines.push(`- ${Math.round(a.cutsOnBeat * 100)}% of the scene changes land within 100 ms of a beat.`);
  } else lines.push('', '## Sound', '- No audio stream.');
  lines.push('', '## Shots', '', '| # | start | length | energy | brightness | colours |', '|---|---|---|---|---|---|');
  for (const s of R.shots) lines.push(`| ${s.n} | ${s.t0} | ${s.dur} | ${s.energy} | ${s.brightness} | ${s.colours.join(' ')} |`);
  lines.push('', 'Look at sheet.jpg (a keyframe per shot) and rhythm.png (the pacing over time) before writing the style card.', '');
  return lines.join('\n');
}

// One moment frame by frame: a strip and an onion skin.
export async function study(file, from, to, { n = 10, out }) {
  const info = probe(file);
  const f = Math.max(1, n / Math.max(1e-3, to - from));
  mkdirSync(out, { recursive: true });
  const dir = join(out, `study-${from}-${to}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const idx = Array.from({ length: n }, (_, k) => k);
  const paths = extractFrames(file, idx, { fps: f, width: 640, prefix: join(dir, 'f'), from });
  const labels = idx.map((k) => fmt(from + k / f));
  const tag = `${from}-${to}`;
  const sub = `${n} frames from ${fmt(from)} to ${fmt(to)} of ${basename(file)} (${info.width}x${info.height})`;
  const s = join(out, `study-${tag}-strip.jpg`), o = join(out, `study-${tag}-onion.jpg`);
  await strip(paths.filter(Boolean), labels, { cols: Math.min(5, n), tileW: 360, title: `study: ${basename(file)} ${tag}s`, sub, out: s });
  await onion(paths.filter(Boolean), { title: `onion skin ${tag}s: faint = earlier, solid = later`, sub, out: o });
  return { strip: s, onion: o };
}

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const file = pos[0];
  if (!file) {
    process.stderr.write('usage: decompose.mjs <video> [--out dir] [--fps N] [--max-shots 48] | --study a,b [--n 10] | --audio\n');
    return 2;
  }
  const name = flags.name ?? basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const out = resolve(flags.out ?? join('refs', name));
  if (flags.study) {
    const [a, b] = String(flags.study).split(',').map(Number);
    if (!(b > a)) { process.stderr.write('--study wants <from>,<to> seconds\n'); return 2; }
    const r = await study(file, a, b, { n: Number(flags.n ?? 10), out });
    process.stdout.write(`${r.strip}\n${r.onion}\n`);
    return 0;
  }
  if (flags.audio) {
    const info = probe(file);
    const a = await analyzeAudio(file, { duration: info.duration });
    if (!a) { process.stderr.write(`${file}: no audio stream\n`); return 1; }
    mkdirSync(out, { recursive: true });
    const res = { file: relative(process.cwd(), resolve(file)), name, duration: r2(info.duration), tempo: a.tempo, beats: a.beats, drops: a.drops, meanDb: a.meanDb, peakDb: a.peakDb };
    writeFileSync(join(out, 'beats.json'), JSON.stringify(res, null, 1) + '\n');
    await rhythm({ duration: info.duration, fps: 10, energy: [], loudness: a.loudness, beats: a.beats,
      markers: a.drops.map((d) => ({ t: d.t, name: `rise +${d.rise} dB` })),
      title: `${name}: the music`, sub: a.tempo ? `~${a.tempo.bpm} BPM, first beat ${a.tempo.first.toFixed(2)}s, confidence ${a.tempo.confidence}` : 'no steady pulse', out: join(out, 'music.png') });
    process.stdout.write(`${join(out, 'beats.json')}\n${join(out, 'music.png')}\n`);
    process.stdout.write(a.tempo ? `~${a.tempo.bpm} BPM, beat ${a.tempo.period.toFixed(3)}s, first ${a.tempo.first.toFixed(2)}s, ${a.beats.length} beats; rises at ${a.drops.map((d) => d.t).join(', ') || 'none'}\n` : 'no steady pulse\n');
    return 0;
  }
  const t0 = Date.now();
  const R = await analyzeVideo(file, { fps: flags.fps ? Number(flags.fps) : undefined, maxShots: Number(flags['max-shots'] ?? 48), out, name });
  for (const f of ['sheet.jpg', 'rhythm.png', 'palette.png', 'summary.md', 'decomposition.json']) process.stdout.write(`${join(out, f)}\n`);
  const p = R.pacing;
  process.stdout.write(`${R.name}: ${R.duration}s, ${p.count} shots (avg ${p.averageShot}s, ${p.hardCuts} hard cuts), ${p.cutsPerMinute} changes/min, motion ${R.energy.arc.words}`
    + (R.audio?.tempo ? `; ~${R.audio.tempo.bpm} BPM, ${Math.round((R.audio.cutsOnBeat ?? 0) * 100)}% of changes on a beat` : '') + ` (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}

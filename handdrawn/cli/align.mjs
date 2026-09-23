// hdf align <id>: word timing for a sample in the store (4.0 V2), stored on its catalogue entry (`align`) so
// captions and a voiced actor.say read it at render time with nothing installed.
//
//   hdf align moon-1 --text "The moon does not make its own light."   a transcriber's timing laid onto the copy
//   hdf align moon-1 --json words.json      any tool's words ([{ text, t0, t1 }] or { words: [...] }, seconds)
//   hdf align moon-1 --estimate             the estimate (the speech grid over the voiced part, pauses snapped
//                                           to the silences), stored as such
//   hdf align moon-1 --show                 what a render would use now, stored or estimated; writes nothing
//
// The copy is --text, else the stored alignment's, else the entry's desc. Without --json or --estimate the
// transcriber is cli/align.py under $HDF_PYTHON (else python3) with faster-whisper or whisper-timestamped;
// when neither is installed the estimate is stored instead and the command says how to get one. --model
// names the whisper model (base), --lang its language. The copy is not whisper's prompt (given one, it repeats
// it as ghost words at the end): fitWords lays the heard words onto it. --prompt hands whisper the copy (or
// --prompt "Ştefan, Ioana" a string) for names it misspells. Words past the voiced end are dropped before the
// fit, and a fit covering under half the voiced span is an error, not a stored alignment.
//
//   hdf align moon-1 --mouth                the mouth track (4.0 V3): Rhubarb Lip Sync (`rhubarb` on PATH, or
//                                           RHUBARB=/path/to/rhubarb) with the copy as its dialog, stored as
//                                           `mouth` on the entry; without it, or when it is killed by a signal,
//                                           the energy track, said so
//   hdf align moon-1 --mouth --json cues.json   any tool's cues ([{ start, end, value }] or { mouthCues })
//   hdf align moon-1 --mouth --estimate     the energy track, stored as such
//   hdf align moon-1 --mouth --show         what a render would use now, a letter per 1/12 s; writes nothing
// --recognizer phonetic hands Rhubarb its language-free recogniser (for a line not in English).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignSpan, checkFitted, estimateAlign, fitWords, packAlign, trimGhosts, unpackAlign } from '../core/align.js';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { SYNC_MAX } from '../core/lint.js';
import { checkMouth, cuesMouth, energyMouth } from '../core/mouth.js';
import { SR } from '../core/synth.js';
import { decodeWav, voicedSpan } from '../core/wav.js';
import { UsageError } from './load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = () => process.env.HDF_PYTHON || 'python3';
const str = (v) => (v === undefined || v === true ? '' : String(v));

export async function run([id], flags) {
  if (!id) throw new UsageError('align: need <id> (a sample in the store)');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  if (!st.has(id)) throw new UsageError(`align: no asset '${id}' in ${st.root} (hdf import <line.wav> --kind sample --name ${id})`);
  const e = st.entry(id);
  if (e.kind !== 'sample') throw new UsageError(`align: '${id}' is a ${e.kind}, not a sample`);
  const text = str(flags.text) || e.align?.text || e.desc || '';
  const wav = st.payloadPath(e);
  if (flags.mouth) return mouth(id, e, st, wav, text, flags);

  if (flags.show) {
    const A = e.align && (!str(flags.text) || e.align.text === text) ? unpackAlign(e.align) : estimateOrSay(text, wav, id);
    print(id, A);
    return 0;
  }
  let A;
  if (flags.json) {
    const file = resolve(String(flags.json));
    if (!existsSync(file)) throw new UsageError(`align: no such file '${flags.json}'`);
    const got = JSON.parse(readFileSync(file, 'utf8'));
    A = fitHeard(text, Array.isArray(got) ? got : got.words, wav, 'json');
  } else if (flags.estimate) {
    A = estimateOrSay(text, wav, id);
  } else {
    const heard = transcribe(wav, text, flags);
    if (heard) A = fitHeard(text, heard, wav, 'whisper');
    else {
      process.stderr.write(`align: no transcriber (python3 -m pip install faster-whisper, or HDF_PYTHON=<venv>/bin/python); storing the estimate\n`);
      A = estimateOrSay(text, wav, id);
    }
  }
  if (!A.words.length) throw new UsageError(`align: '${id}': no words to store (the copy is empty and the tool heard nothing)`);
  st.put({ ...e, ...(e.desc ? {} : { desc: A.text }), align: packAlign(A) }, st.payload(e));
  print(id, A);
  return 0;
}

// ---------- the mouth track (4.0 V3) ----------

function mouth(id, e, st, wav, text, flags) {
  const sec = e.sec ?? decodeWav(readFileSync(wav)).length / SR;
  if (flags.show) {
    const M = e.mouth && !checkMouth(e.mouth).length ? e.mouth : energyMouth(decodeWav(readFileSync(wav)));
    printMouth(id, M);
    return 0;
  }
  let M;
  if (flags.json) {
    const file = resolve(String(flags.json));
    if (!existsSync(file)) throw new UsageError(`align: no such file '${flags.json}'`);
    try { M = cuesMouth(JSON.parse(readFileSync(file, 'utf8')), sec, 'json'); } catch (err) { throw new UsageError(`align: ${err.message}`); }
  } else if (flags.estimate) {
    M = energyMouth(decodeWav(readFileSync(wav)));
  } else {
    const cues = rhubarb(wav, text, flags);
    M = cues ? cuesMouth(cues, sec, 'rhubarb') : energyMouth(decodeWav(readFileSync(wav)));
  }
  st.put({ ...e, mouth: { by: M.by, shapes: M.shapes } }, st.payload(e));
  printMouth(id, M);
  return 0;
}

// Rhubarb's cues, or null (said why) when it is not installed or is killed by a signal (1.14 segfaults on some
// Macs), so the energy track is stored. A non-zero exit is an error.
function rhubarb(wav, text, flags) {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-rhubarb-'));
  try {
    const args = ['-f', 'json', '-q', ...(flags.recognizer ? ['-r', String(flags.recognizer)] : [])];
    if (text.trim()) { writeFileSync(join(dir, 'dialog.txt'), text); args.push('-d', join(dir, 'dialog.txt')); }
    const r = spawnSync(process.env.RHUBARB || 'rhubarb', [...args, wav], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.error?.code === 'ENOENT') {
      process.stderr.write('align: no rhubarb (https://github.com/DanielSWolf/rhubarb-lip-sync/releases, on PATH or RHUBARB=<path>); storing the energy track\n');
      return null;
    }
    if (r.error) throw new Error(`align: rhubarb failed: ${r.error.message}`);
    if (r.status === null || r.signal) {
      process.stderr.write(`align: rhubarb was killed by ${r.signal ?? 'a signal'}; storing the energy track\n`);
      return null;
    }
    if (r.status !== 0) throw new Error(`align: rhubarb failed (${r.status}):\n${r.stderr}`);
    return JSON.parse(r.stdout).mouthCues;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function printMouth(id, M) {
  for (let k = 0; k < M.shapes.length; k += 24) process.stdout.write(`${(k / 12).toFixed(2).padStart(7)}  ${M.shapes.slice(k, k + 24)}\n`);
  process.stdout.write(`${id}: ${M.shapes.length} frames of mouth, by ${M.by}\n`);
}

function estimateOrSay(text, wav, id) {
  if (!text.trim()) throw new UsageError(`align: '${id}' has no copy: give --text "..." (or a desc on import)`);
  return estimateAlign(text, decodeWav(readFileSync(wav)));
}

// A tool's words laid onto the copy: ghosts trimmed first, the fit refused when it covers too little.
function fitHeard(text, heard, wav, by) {
  const x = decodeWav(readFileSync(wav)), voiced = voicedSpan(x), kept = trimGhosts(heard, { dur: x.length / SR, voiced });
  if (heard?.length && !kept.length) throw new UsageError(`align: all ${heard.length} of the tool's words are ghosts (zero-length, or past the voiced end); check the words, or store --estimate`);
  const A = fitWords(text || null, kept, by);
  try { checkFitted(A, voiced); } catch (err) { throw new UsageError(err.message); }
  return A;
}

// The transcriber's words, or null when neither library is installed. Any other failure is an error.
function transcribe(wav, text, flags) {
  const prompt = flags.prompt === true ? text : str(flags.prompt);
  const args = [join(HERE, 'align.py'), wav, '--model', str(flags.model) || 'base', ...(prompt ? ['--prompt', prompt] : []), ...(flags.lang ? ['--lang', String(flags.lang)] : [])];
  const r = spawnSync(PY(), args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error?.code === 'ENOENT') return null;
  if (r.status === 3) return null;
  if (r.status !== 0) throw new Error(`align: ${PY()} cli/align.py failed (${r.status}):\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function print(id, A) {
  for (const w of A.words) process.stdout.write(`${w.t0.toFixed(3).padStart(8)} ${w.t1.toFixed(3).padStart(8)}  ${w.text}\n`);
  const span = alignSpan(A);
  process.stdout.write(`${id}: ${A.words.length} words over ${span.toFixed(2)} s, by ${A.by}\n`);
  if (A.by === 'estimate' && span > SYNC_MAX) process.stderr.write(`note: an estimate over ${SYNC_MAX} s; lint warns caption-sync where it is captioned (a transcriber refines it)\n`);
}

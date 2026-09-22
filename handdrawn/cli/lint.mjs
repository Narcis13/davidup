// hdf lint <film.js>: the review checklist over lists and cues. Prints `file:shot:frame  rule  detail`
// per finding and exits 1 on any. Warnings (core/lint.js WARNINGS) print the same way, marked `warn`, and
// never change the exit code.
//
// hdf lint <film.js> --audience kids-5: the film against another audience's profile (4.0 T10) instead of its
// own (film({ audience }), 'general' by default).
//
// A film in chapters (4.0 E1) ends with a line per chapter: its span, shots, cuts, recipes and findings.
//
// hdf lint packs/<pack>.js: a pack is not a film; its findings are `pack-mirror`, one per cel whose store
// mirror is missing or stale (3.0 S13).
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ASSET_ROOT, readCatalogue, sha } from '../core/assets.js';
import { AUDIENCES } from '../core/audience.js';
import { chapterReport, formatChapter, lintAll, lintPack, formatFinding } from '../core/lint.js';
import { mirrorPayload, packCels, readManifest } from './donate.mjs';
import { UsageError } from './load.mjs';

export async function run([path], flags, { loadFilm }) {
  if (path && isPack(resolve(path))) return lintPackFile(resolve(path), flags);
  const audience = flags.audience;
  if (audience !== undefined && !Object.hasOwn(AUDIENCES, audience)) throw new UsageError(`lint: --audience takes ${Object.keys(AUDIENCES).join(', ')} (got '${audience}')`);
  const film = await loadFilm(path);
  const { findings, warnings } = lintAll(film, { source: readFileSync(resolve(path), 'utf8'), audience });
  const file = basename(path);
  for (const f of [...warnings, ...findings]) process.stdout.write(formatFinding(f, file) + '\n');
  for (const r of chapterReport(film, findings)) process.stdout.write(formatChapter(r) + '\n');
  const tail = warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : '';
  process.stdout.write(findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}${tail}\n` : `${film.name}: lint clean${audience ? ` for ${audience}` : film.audience && film.audience !== 'general' ? ` for ${film.audience}` : ''}${tail}\n`);
  return findings.length ? 1 : 0;
}

// A module in a directory with a manifest that lists cels of its pack.
function isPack(file) {
  const dir = dirname(file);
  return existsSync(join(dir, 'manifest.json')) && readManifest(dir).cels.some((c) => c.pack === basename(file, '.js'));
}

async function lintPackFile(file, flags) {
  const dir = dirname(file), pack = basename(file, '.js');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const code = new Map((await packCels(dir)).filter((c) => c.pack === pack).map((c) => [c.name, c]));
  const cels = readManifest(dir).cels.filter((c) => c.pack === pack);
  for (const name of code.keys()) if (!cels.some((c) => c.name === name)) cels.push({ name });   // not in the manifest yet
  const findings = lintPack(cels, {
    fresh: (name) => (code.has(name) ? sha(JSON.stringify(mirrorPayload(code.get(name)))) : 'gone'),
    stored: (id) => (st.has(id) ? st.entry(id).sha : undefined),
  }, pack);
  for (const f of findings) process.stdout.write(formatFinding(f, basename(file)) + '\n');
  process.stdout.write(findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}\n` : `${pack}: ${cels.length} cels, mirrors clean\n`);
  return findings.length ? 1 : 0;
}

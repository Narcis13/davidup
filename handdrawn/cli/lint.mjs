// hdf lint <film.js>: the review checklist over lists and cues. Prints `file:shot:frame  rule  detail`
// per finding and exits 1 on any. Warnings (core/lint.js WARNINGS) print the same way, marked `warn`, and
// never change the exit code.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { lint, formatFinding, warnAssets } from '../core/lint.js';

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const findings = lint(film, { source: readFileSync(resolve(path), 'utf8') });
  const warnings = warnAssets(film);
  const file = basename(path);
  for (const f of [...warnings, ...findings]) process.stdout.write(formatFinding(f, file) + '\n');
  const tail = warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : '';
  process.stdout.write(findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}${tail}\n` : `${film.name}: lint clean${tail}\n`);
  return findings.length ? 1 : 0;
}

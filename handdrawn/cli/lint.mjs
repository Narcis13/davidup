// hdf lint <film.js>: the review checklist over lists and cues. Prints `file:shot:frame  rule  detail`
// per finding and exits 1 on any.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { lint, formatFinding } from '../core/lint.js';

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const findings = lint(film, { source: readFileSync(resolve(path), 'utf8') });
  const file = basename(path);
  for (const f of findings) process.stdout.write(formatFinding(f, file) + '\n');
  process.stdout.write(findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}\n` : `${film.name}: lint clean\n`);
  return findings.length ? 1 : 0;
}

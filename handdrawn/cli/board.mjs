// hdf board <film.js>: the film's tree as text (storyboard cards land in P4).
import { describe } from '../core/tree.js';

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  process.stdout.write(describe(film) + '\n');
  return 0;
}

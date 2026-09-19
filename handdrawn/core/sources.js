// Procedural image sources: an image op whose src starts with a registered prefix ('sim:...') is drawn from
// pixels an engine computes, instead of a decoded asset. The src string carries everything the pixels depend
// on (engine state index, camera, tint), so the op hashes and dedups like any other.
//   registerSource('sim', (src, { w, h, makeCanvas }) => canvas)   w, h: the op's size in device pixels
const SOURCES = new Map();

// Draw image ops whose src starts with `prefix:` from fn(src, { w, h, makeCanvas }) => canvas.
export function registerSource(prefix, fn) {
  if (typeof prefix !== 'string' || !/^[\w-]+$/.test(prefix)) throw new TypeError(`registerSource: bad prefix '${prefix}'`);
  SOURCES.set(prefix, fn);
}

export function sourceFor(src) {
  if (typeof src !== 'string') return null;
  const i = src.indexOf(':');
  return i > 0 ? SOURCES.get(src.slice(0, i)) ?? null : null;
}

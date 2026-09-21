// ES module specifiers, found and rewritten without a parser, for `hdf dev` (serves modules to the browser)
// and `hdf bundle` (inlines them). Only the import forms our sources use: static import/export ... from,
// bare side-effect imports and import('literal').
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // the handdrawn package

// Modules with a browser twin: the key is served (and walked) as the value's source, under the key's own
// path, so its relative imports still resolve. core/assets.js reads the file system; its twin reads the
// records the page was handed, which is what lets a store-backed film play in `hdf dev` and `hdf bundle`.
export const TWINS = new Map([[resolve(ROOT, 'core/assets.js'), resolve(ROOT, 'core/assets.web.js')]]);

// The source `file` is served to the browser as: its twin's, if it has one.
export const webSource = (file) => readFileSync(TWINS.get(file) ?? file, 'utf8');

const SPEC = /(\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\2/g;

// Calls f(spec) for every specifier and puts back what it returns (undefined keeps the original).
export const rewrite = (src, f) => src.replace(SPEC, (all, head, q, spec) => {
  const to = f(spec);
  return to === undefined ? all : `${head}${q}${to}${q}`;
});

export const specifiers = (src) => { const out = []; rewrite(src, (s) => { out.push(s); }); return out; };

// The file a specifier names from `from` (a file path): relative paths, file: URLs, and the package's own
// name ('handdrawn' is core/index.js, 'handdrawn/x' is x). Anything else is an error: the browser has no
// node_modules.
export function resolveSpec(spec, from) {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return resolve(dirname(from), spec);
  if (spec.startsWith('file:')) return fileURLToPath(spec);
  if (spec === 'handdrawn') return resolve(ROOT, 'core/index.js');
  if (spec.startsWith('handdrawn/')) return resolve(ROOT, spec.slice('handdrawn/'.length));
  throw new Error(`${from}: cannot load '${spec}' in the browser (only relative imports and 'handdrawn')`);
}

// Every module reachable from the entries: Map(file -> source), in discovery order.
export function graph(entries) {
  const out = new Map(), todo = [...entries];
  while (todo.length) {
    const file = todo.shift();
    if (out.has(file)) continue;
    let src;
    try { src = webSource(file); } catch (e) { throw new Error(`cannot read module ${file} (${e.code ?? e.message})`); }
    out.set(file, src);
    if (file.endsWith('.json')) continue;   // a JSON module (packs/poses/biped.json): data, no imports
    for (const s of specifiers(src)) todo.push(resolveSpec(s, file));
  }
  return out;
}

// The deepest directory holding all the paths.
export function commonDir(paths) {
  let base = resolve(paths[0]);
  for (const p of paths.slice(1)) while (base !== dirname(base) && relative(base, resolve(p)).startsWith('..')) base = dirname(base);
  return base;
}

export const posix = (p) => p.split(sep).join('/');
export const within = (dir, file) => { const r = relative(dir, file); return !r.startsWith('..') && !r.startsWith(sep) && !/^[a-zA-Z]:/.test(r); };

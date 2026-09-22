#!/usr/bin/env node
// Writes the skill's references/api.md: one line per export of core/index.js, recipes/shots.js (with the doodle
// recipes) and the packs, each with its signature and the first sentence of the comment above its declaration.
//   node cli/apidoc.mjs [--out path]     write (default: the hand-drawn-film skill next to this repo)
//   node cli/apidoc.mjs --check          exit 1 if the file on disk differs (test/apidoc.test.js runs this)
// A comment is the run of `//` lines (or a /** */ block) directly above the declaration; section rulers
// (`// ---- x ----`) are not comments, and a one-liner's trailing `// ...` wins. An export with no comment is listed as `(undocumented)`.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = resolve(ROOT, '../.claude/skills/hand-drawn-film/references/api.md');

const src = new Map();
const read = (file) => { if (!src.has(file)) src.set(file, readFileSync(file, 'utf8').split('\n')); return src.get(file); };
const rel = (file) => file.slice(ROOT.length + 1);

// `export { a, b as c } from './x.js'` blocks of a module, in order: [{ names: [[local, exported]], from }].
function reexports(file) {
  const text = read(file).join('\n'), out = [];
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return [a, b ?? a]; });
    out.push({ names, from: resolve(dirname(file), m[2]) });
  }
  return out;
}

const RULER = /^\s*\/\/\s*(-{3,}|={3,})/;
function commentAbove(lines, at) {
  let j = at - 1;
  if (j >= 0 && /\*\/\s*$/.test(lines[j])) {
    const end = j;
    while (j >= 0 && !/\/\*\*?/.test(lines[j])) j--;
    return lines.slice(j, end + 1).join(' ').replace(/\/\*\*?|\*\/|^\s*\*|\s\*\s/g, ' ');
  }
  if (j >= 0 && RULER.test(lines[j]) && /^\s*\/\/\s*={3,}\s*$/.test(lines[j])) j--;   // a doodle recipe's banner
  const got = [];
  while (j >= 0 && /^\s*\/\//.test(lines[j]) && !RULER.test(lines[j])) got.unshift(lines[j--]);
  return got.map((l) => l.replace(/^\s*\/\/\s?/, '')).join(' ');
}

// First sentence (at least 60 characters of it, at most ~240).
function summary(c) {
  c = c.replace(/\s+/g, ' ').trim();
  if (!c) return '';
  const re = /\.(\s|$)/g;
  let m, cut = c.length;
  while ((m = re.exec(c))) if (m.index >= 60) { cut = m.index + 1; break; }
  let s = c.slice(0, cut).trim();
  if (s.length > 240) s = s.slice(0, 237).replace(/\s+\S*$/, '') + ' ...';
  return s;
}

// The text between the parenthesis at `from` and its match, whitespace collapsed.
function parens(text, from) {
  let d = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '(') d++;
    else if (text[i] === ')' && --d === 0) return text.slice(from + 1, i).replace(/\s+/g, ' ').trim();
  }
  return null;
}

// { line, sig, comment } for `name` declared (or re-exported) in file.
function find(file, name) {
  const lines = read(file), text = lines.join('\n');
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(function\\*?|const|let|class)\\s+${name.replace('$', '\\$')}\\b`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(decl);
    if (!m) continue;
    const offset = lines.slice(0, i).join('\n').length + (i ? 1 : 0);
    let sig = '';
    if (m[1].startsWith('function')) sig = `(${parens(text, text.indexOf('(', offset))})`;
    else if (m[1] === 'const') {
      const rest = text.slice(offset + m[0].length, offset + m[0].length + 400);
      const arrow = rest.match(/^\s*=\s*(?:Object\.assign\()?\s*(\(|[A-Za-z_$][\w$]*\s*=>)/);
      if (arrow && arrow[1] === '(') sig = `(${parens(text, offset + m[0].length + rest.indexOf('('))})`;
      else if (arrow) sig = `(${arrow[1].replace(/\s*=>$/, '')})`;
    }
    if (/Object\.assign\(/.test(text.slice(offset, offset + 200))) sig = '(opts)';
    const tail = lines[i].match(/;\s*\/\/\s*(.+)$/);   // a one-liner's own comment wins
    return { file, line: i + 1, sig, comment: tail ? tail[1] : commentAbove(lines, i) };
  }
  // export { name } re-exported from an import, or export * from '...'
  for (const r of reexports(file)) for (const [local, exp] of r.names) if (exp === name) return find(r.from, local);
  const imp = text.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
  if (imp && new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(text)) return find(resolve(dirname(file), imp[1]), name);
  for (const m of text.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
    const r = find(resolve(dirname(file), m[1]), name);
    if (r) return r;
  }
  return null;
}

// Option names of a doodle recipe: the keys of its `const { ... } = o;` destructuring.
function optionKeys(lines, line) {
  const body = lines.slice(line, line + 12).join(' '), m = body.match(/const\s*\{([\s\S]*?)\}\s*=\s*o;/);
  if (!m) return [];
  const out = [];
  let d = 0, cur = '';
  for (const ch of m[1] + ',') {
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { const k = cur.trim().match(/^[\w$]+/); if (k) out.push(k[0]); cur = ''; } else cur += ch;
  }
  return out;
}

const clip = (s, n = 110) => (s.length > n ? s.slice(0, n - 4).replace(/[,\s]+\S*$/, '') + ', ...' : s);
// No line numbers: they would make the file stale on every unrelated edit. withFile for sections that mix files.
const entry = (name, f, { tag = '', after = '', withFile = false } = {}) => {
  const doc = summary(f?.comment ?? '') || '(undocumented)';
  return `- \`${name}${clip(f?.sig ?? '')}\`${tag} ${doc}${after}${withFile && f ? ` <sub>${rel(f.file)}</sub>` : ''}`;
};

export async function generate() {
  const index = join(ROOT, 'core/index.js');
  const out = [
    '# handdrawn API',
    '',
    'Generated by `node handdrawn/cli/apidoc.mjs` from the comments above each declaration; do not edit by hand.',
    'Signatures are abbreviated past ~110 characters: the file is named in each section heading.',
    '',
    '## `handdrawn` (core/index.js)',
  ];
  const seen = new Set();
  for (const r of reexports(index)) {
    out.push('', `### ${rel(r.from)}`, '');
    for (const [local, name] of r.names) { seen.add(name); out.push(entry(name, find(r.from, local))); }
  }

  const shots = await import(pathToFileURL(join(ROOT, 'recipes/shots.js')).href);
  const shotsFile = join(ROOT, 'recipes/shots.js');
  const recipes = [], doodle = [], helpers = [];
  for (const name of Object.keys(shots).sort()) {
    const v = shots[name], f = find(shotsFile, name);
    if (v?.recipe) {
      const opts = v.defaults && Object.keys(v.defaults).length ? ` Options: ${Object.keys(v.defaults).join(', ')}.` : '';
      recipes.push([v.recipe, entry(name, f.sig ? f : { ...f, sig: '(opts)' }, { tag: ` **${v.recipe}**`, after: opts })]);
    } else if (f?.file.endsWith('doodle.js') && typeof v === 'function' && /^export function \w+\(o = \{\}\)/.test(read(f.file)[f.line - 1])) {
      const keys = optionKeys(read(f.file), f.line);
      doodle.push(entry(name, f, { after: keys.length ? ` Options: ${keys.join(', ')}.` : '' }));
    }
    else helpers.push(entry(name, f, { withFile: true }));
  }
  const byLetter = (a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]);
  out.push('', '## `handdrawn/recipes/shots.js`', '',
    'Every recipe `R(opts)` returns a shot; `R.layer(ctx, opts)` returns its drawing alone for composing; `R.defaults` lists its options.',
    '', '### Recipes by letter', '', ...recipes.sort(byLetter).map((r) => r[1]),
    '', '### Doodle recipes (recipes/doodle.js, re-exported)', '', 'Each takes `{ photo, name, dur, look, ... }` and returns a shot.', '', ...doodle,
    '', '### Helpers', '', ...helpers);

  const manifest = JSON.parse(readFileSync(join(ROOT, 'packs/manifest.json'), 'utf8'));
  out.push('', '## Packs (`handdrawn/packs/<pack>.js`)', '',
    '`import { gpu } from \'handdrawn/packs/tech.js\'`. Cels: `cel(inputs) => group`, placed with `place(x, y, [{ rot, scale, flip }], node)`. Inputs are `[min, max, step]`. Sheets: `handdrawn/packs/sheets/<cel>.jpg`.', '');
  for (const c of manifest.cels) {
    const inputs = Object.entries(c.inputs ?? {}).map(([k, [lo, hi, step]]) => `${k} ${lo}..${hi}${step ? ` step ${step}` : ''}`).join(', ');
    out.push(`- \`${c.name}\` (${c.pack}) box [${c.box.join(', ')}]${inputs ? `; inputs: ${inputs}` : ''}. ${c.desc}`);
  }

  const core = await import(pathToFileURL(index).href);
  out.push('', '## Tables', '',
    `- looks (\`LOOKS\`): ${Object.keys(core.LOOKS).join(', ')}`,
    `- paper sheets (\`PASTELS\`, for \`pastel(look, name)\`): ${Object.keys(core.PASTELS).join(', ')}`,
    `- construction paper (\`SHEETS\`, for \`~sheet:<name>\`): ${Object.keys(core.SHEETS).join(', ')}`,
    `- fx kinds (\`fx(kind, args, kids)\`, \`cut(kind, dur, a, b)\`): ${Object.keys(core.FX).join(', ')}`,
    `- margin doodles (\`MARGIN_DOODLES\`, for \`marginDoodle(kind, ...)\`): ${core.MARGIN_DOODLES.join(', ')}`,
    `- easings (\`ease.<name>\`): ${Object.keys(core.ease).join(', ')}`,
    `- sand gestures (\`G.<name>\`): ${Object.keys(core.G).join(', ')}`,
    `- formats (\`FORMATS\`): ${Object.entries(core.FORMATS).map(([k, [w, h]]) => `${k} ${w}x${h}`).join(', ')}`,
    '');
  return out.join('\n');
}

async function main(argv) {
  const check = argv.includes('--check');
  const o = argv.indexOf('--out'), dest = o >= 0 ? resolve(argv[o + 1]) : DEFAULT_OUT;
  const text = await generate();
  if (check) {
    const same = existsSync(dest) && readFileSync(dest, 'utf8') === text;
    if (!same) process.stderr.write(`${dest} is stale: run node handdrawn/cli/apidoc.mjs\n`);
    return same ? 0 : 1;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
  const missing = text.split('\n').filter((l) => l.includes('(undocumented)')).length;
  process.stdout.write(`${dest}  ${text.split('\n').filter((l) => l.startsWith('- ')).length} entries${missing ? `, ${missing} undocumented` : ''}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));

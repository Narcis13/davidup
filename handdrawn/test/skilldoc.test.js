// asset-library plan H5: the skill (SKILL.md, references/*.md) and this README name only commands that exist.
// Every `hdf <cmd>` and `asset <verb>` written in code (a fenced block or a backtick span) must be one the CLIs
// take. Skipped when the package sits outside this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../cli/hdf.mjs';
import { VERBS } from '../../assetlib/cli.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, '..', '.claude', 'skills', 'hand-drawn-film');
const HDF = new Set([...COMMANDS, 'help']), ASSET = new Set([...VERBS, 'help']);

// The code in a markdown file: fenced blocks whole, then backtick spans in the prose between them.
function code(md) {
  const out = [];
  md.split(/^```.*$/m).forEach((part, i) => {
    if (i % 2) out.push(part);
    else for (const m of part.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  });
  return out.join('\n');
}

// `hdf x` / `asset x` pairs in code. One that opens a line (or a span) is a command, whatever follows; further
// along a line only a real one counts, so a comment's "the asset store" is prose and `hdf finde` is caught.
function named(md) {
  const found = [];
  for (const line of code(md).split('\n')) {
    for (const m of line.matchAll(/(?<![\w./:-])(hdf|asset) ([a-z][a-z-]*)/g)) {
      const opens = /^\s*(\$\s*)?$/.test(line.slice(0, m.index));
      if (opens || HDF.has(m[2]) || ASSET.has(m[2])) found.push(`${m[1]} ${m[2]}`);
    }
  }
  return found;
}

const docs = () => [
  join(ROOT, 'README.md'),
  ...(existsSync(SKILL) ? [join(SKILL, 'SKILL.md'),
    ...readdirSync(join(SKILL, 'references')).filter((f) => f.endsWith('.md')).map((f) => join(SKILL, 'references', f))] : []),
];

test('the skill and the README name only hdf commands and asset verbs that exist', () => {
  const bad = [];
  for (const file of docs()) {
    for (const n of named(readFileSync(file, 'utf8'))) {
      const [bin, word] = n.split(' ');
      if (!(bin === 'hdf' ? HDF : ASSET).has(word)) bad.push(`${relative(join(ROOT, '..'), file)}: ${n}`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('the skill sends the agent to the library for the inventory', { skip: !existsSync(SKILL) && 'no hand-drawn-film skill next to the package' }, () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /asset ls --shelf house/);
  assert.doesNotMatch(skill, /What it holds today/, 'the inventory is data: asset ls --shelf house');
  assert.doesNotMatch(skill, /handdrawn\/assets/, 'the store moved to <repo>/assets (H4)');
});

test('named() reads code, not prose', () => {
  assert.deepEqual(named('the asset store and hdf renders it\n\n`hdf find fox` and `asset show x`\n```bash\nhdf lint a.js   # the asset store\nasset ls\nhdf finde fox\n  x.js   the asset store\n```'),
    ['hdf find', 'asset show', 'hdf lint', 'asset ls', 'hdf finde']);
});

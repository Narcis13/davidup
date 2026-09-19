// P9: the skill's references/api.md is generated from the comments above each export (cli/apidoc.mjs). It must
// be current, and every export must carry a comment. Skipped when the package sits outside this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, generate } from '../cli/apidoc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const skill = dirname(dirname(DEFAULT_OUT));

test('every export is documented', async () => {
  const bare = (await generate()).split('\n').filter((l) => l.includes('(undocumented)'));
  assert.deepEqual(bare, [], 'add a comment above each of these declarations');
});

test('references/api.md is current', { skip: !existsSync(skill) && 'no hand-drawn-film skill next to the package' }, () => {
  const r = spawnSync(process.execPath, ['cli/apidoc.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

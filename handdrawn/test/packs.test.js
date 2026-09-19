// P8: packs (creatures, objects, tech), their manifest and sheets, and hdf donate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashList, walk } from '../core/list.js';
import { LOOKS, resolveRole } from '../core/looks.js';
import { celOverflow } from '../core/lint.js';
import { PACKS, donate, inputVariants, packCels, readManifest, writeManifest } from '../cli/donate.mjs';
import { statements, tokenize } from '../cli/jsscan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = pathToFileURL(join(ROOT, 'core/index.js')).href;

test('the three packs hold the planned cels, and the manifest and sheets match them', async () => {
  const cels = await packCels();
  const by = (p) => cels.filter((c) => c.pack === p).map((c) => c.name).sort();
  assert.deepEqual(by('creatures'), ['fly', 'hedgehog', 'horse']);
  assert.deepEqual(by('objects'), ['boat', 'book', 'lamp', 'teapot']);
  assert.deepEqual(by('tech'), ['chip', 'gpu', 'server', 'token']);
  assert.deepEqual(readManifest(), { cels: cels.map(({ make, ...c }) => c) }, 'manifest.json is stale: hdf donate --manifest');
  for (const c of cels) {
    assert.ok(c.box && c.desc, `${c.name}: box and desc`);
    assert.ok(existsSync(join(PACKS, c.sheet)), `${c.name}: no ${c.sheet}; hdf donate --manifest`);
  }
});

test('every pack cel stays in its box and resolves its roles in every preset look, at every input extreme', async () => {
  for (const c of await packCels()) for (const v of inputVariants(c.inputs)) {
    const g = c.make(v), at = `${c.name} ${JSON.stringify(v)}`;
    assert.equal(celOverflow(g), null, `${at} draws outside its box`);
    const roles = [];
    walk(g.kids, (op) => { if (op.role !== undefined) roles.push(op.role); });
    assert.ok(roles.length, at);
    for (const look of Object.values(LOOKS)) for (const r of roles) assert.doesNotThrow(() => resolveRole(r, look), `${at} ${look.name} ${JSON.stringify(r)}`);
  }
});

test('donated cels still draw exactly like the cels in their source modules', async () => {
  let n = 0;
  for (const c of await packCels()) {
    const m = readFileSync(join(PACKS, `${c.pack}.js`), 'utf8').match(new RegExp(`^// ---- donated: ${c.name} from (\\S+) ----$`, 'm'));
    if (!m) continue;
    const orig = Object.values(await import(pathToFileURL(join(ROOT, m[1])).href)).find((v) => v?.cel?.name === c.name);
    assert.ok(orig, `${c.name}: ${m[1]} no longer exports it`);
    for (const v of inputVariants(c.inputs)) assert.equal(hashList([c.make(v)]), hashList([orig(v)]), `${c.name} ${JSON.stringify(v)}: re-donate it`);
    n++;
  }
  assert.equal(n, 4);   // fly, horse, hedgehog, boat
});

test('donate copies a cel with its helpers and imports, replaces it in place, and refuses a clashing helper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-donate-'));
  const packs = join(dir, 'packs');
  await donate(join(ROOT, 'films/mini.js'), 'ball', { dir: packs, pack: 'scratch' });
  await donate(join(ROOT, 'films/mini.js'), 'guides', { dir: packs, pack: 'scratch' });
  const file = join(packs, 'scratch.js'), first = readFileSync(file, 'utf8');
  assert.match(first, /^\/\/ ---- donated: ball from films\/mini\.js ----$/m);
  assert.match(first, /^import \{ cel, fill, circle, stroke, line \} from '.*core\/index\.js';$/m);
  assert.doesNotMatch(first, /signOff|shot\(/, 'only what the cels need');
  await donate(join(ROOT, 'films/mini.js'), 'ball', { dir: packs, pack: 'scratch' });
  assert.equal(readFileSync(file, 'utf8'), first, 'donating again is a no-op');

  // a helper and a registration statement travel with the cel; a same-named helper with other text is refused
  const src = (k, r) => `import { cel, fill, circle } from '${CORE}';\nconst REG = [];\nconst R = ${r};\nREG.push(R);\n// the ${k}\nexport const ${k} = cel('${k}', () => [fill(circle(0, 0, R + REG.length), 'ink')], { box: [-40, -40, 80, 80] });\nexport default null;\n`;
  writeFileSync(join(dir, 'a.js'), src('a', 30));
  writeFileSync(join(dir, 'b.js'), src('b', 20));
  const r = await donate(join(dir, 'a.js'), 'a', { dir: packs, pack: 'scratch' });
  assert.equal(r.helpers, 3);
  const withA = readFileSync(file, 'utf8');
  assert.match(withA, /REG\.push\(R\);\n\/\/ the a\nexport const a/);
  await assert.rejects(donate(join(dir, 'b.js'), 'b', { dir: packs, pack: 'scratch' }), /already declares 'R' differently/);
  assert.equal(readFileSync(file, 'utf8'), withA, 'a refused donation leaves the pack as it was');
  await assert.rejects(donate(join(ROOT, 'films/mini.js'), 'nope', { dir: packs, pack: 'scratch' }), /exports no cel 'nope' \(it exports: ball, guides\)/);

  const m = await writeManifest(packs, { sheets: false });
  assert.deepEqual(m.cels.map((c) => c.name), ['a', 'ball', 'guides']);   // a module namespace lists exports by name
});

test('jsscan: strings, templates, regexes and comments are not code; statements split and declare', () => {
  const src = [
    "import A, { b as c, d } from './x.js';",
    'const re = /[;{]/g, s = `a ${c({ k: 1 })} ; }`, t = "}; //";',
    '// lead',
    'function f(x) { return x / 2 / d; }',
    'const { p, q: r } = f(1);',
    'export default A;',
  ].join('\n');
  const st = statements(src);
  assert.deepEqual(st.map((s) => s.kind), ['import', 'decl', 'decl', 'decl', 'export-default']);
  assert.deepEqual([...st[0].decls], ['A', 'c', 'd']);
  assert.deepEqual([...st[1].decls], ['re', 's', 't']);
  assert.ok(st[1].uses.has('c') && !st[1].uses.has('k'));
  assert.equal(st[2].lead, '// lead\n');
  assert.deepEqual([...st[3].decls].sort(), ['p', 'r']);
  assert.ok(tokenize('a = b / c / d').every((t) => t.t !== 'str'));
});

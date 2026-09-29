// Hosts (asset-library plan H3): the apps that know how to draw a kind, found at run time, so the `asset` bin
// and davidup can show hdf's pictures without importing hdf, and work the same when hdf is not there.
//
//   const { previewers, hosts, warnings } = await loadHosts();
//   openLibrary({ previewers });                       // lib.preview draws with them, else the card
//
// A host is an ES module whose default export (or the module itself) is { name, previewers, adds, makers }, previewers
// as openLibrary takes them ({ kind: fn | { name, version, render } }); `adds` ({ kind: () -> Promise<{ derive,
// fields, probes }> }, D3) is what the host hands addAsset for a payload of that kind (hdf: a cutout's
// silhouette traced, a puppet linted, its checks), loaded on the first add so loading the host stays cheap; `makers`
// ({ tool: { version, make } }, I1) is how `asset remake` makes again a record whose made.tool names it. The known hosts are the ones that sit
// next to this package in the repo: hdf's (handdrawn/cli/host.mjs). $ASSETLIB_HOSTS adds modules (paths,
// separated by the platform's path delimiter), later ones taking a kind from earlier ones; '-' as its first
// entry leaves the known ones out. A known host that is not on disk is skipped quietly; a host that is there
// and does not load, or registers a previewer that is not one, is a warning and nothing of it is used.
import { existsSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { previewer } from './preview.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const KNOWN_HOSTS = [join(HERE, '..', 'handdrawn', 'cli', 'host.mjs')];

// Resolves to { hosts: [{ name, file, kinds, adds, makers }], previewers, adds, makers, warnings }. `known` replaces KNOWN_HOSTS (tests);
// `cwd` is what a relative $ASSETLIB_HOSTS entry is read against.
export async function loadHosts({ env = process.env, known = KNOWN_HOSTS, cwd = process.cwd() } = {}) {
  const extra = String(env.ASSETLIB_HOSTS ?? '').split(delimiter).filter(Boolean);
  const files = [...(extra[0] === '-' ? [] : known.filter((f) => existsSync(f))), ...extra.filter((f) => f !== '-').map((f) => resolve(cwd, f))];
  const hosts = [], previewers = {}, adds = {}, makers = {}, warnings = [];
  for (const file of [...new Set(files)]) {
    try {
      const mod = await import(pathToFileURL(file).href), h = mod.default ?? mod;
      const own = h?.previewers ?? {};
      if (typeof own !== 'object' || Array.isArray(own)) throw new Error('previewers: { kind: previewer }');
      for (const [kind, p] of Object.entries(own)) {
        try { previewer(p); } catch (e) { throw new Error(`previewers.${kind}: ${e.message}`); }
      }
      const add = h?.adds ?? {};
      if (typeof add !== 'object' || Array.isArray(add)) throw new Error('adds: { kind: () => Promise<{ derive, fields, probes }> }');
      for (const [kind, a] of Object.entries(add)) if (typeof a !== 'function') throw new Error(`adds.${kind}: a function resolving to { derive, fields, probes }`);
      const make = h?.makers ?? {};
      if (typeof make !== 'object' || Array.isArray(make)) throw new Error('makers: { tool: { version, make } }');
      for (const [tool, m] of Object.entries(make)) maker(m, `makers['${tool}']`);
      Object.assign(previewers, own);
      Object.assign(adds, add);
      Object.assign(makers, make);
      hosts.push({ name: h?.name ?? basename(file), file, kinds: Object.keys(own), adds: Object.keys(add), makers: Object.keys(make) });
    } catch (e) {
      warnings.push(`host ${file} not loaded: ${e?.message ?? e}`);
    }
  }
  return { hosts, previewers, adds, makers, warnings };
}

// What addAsset's `host` takes for a payload of `kind` from the hosts' `adds` (loadHosts), or {} when no host
// adds that kind: { derive: { [kind]: fn }, fields, probes }. A host that fails to load its side throws.
export async function addHost(adds, kind) {
  const load = adds?.[kind];
  if (!load) return {};
  const got = (await load()) ?? {};
  const derive = typeof got.derive === 'function' ? got.derive : got.derive?.[kind];
  return {
    ...(derive ? { derive: { [kind]: derive } } : {}),
    ...(got.fields ? { fields: got.fields } : {}),
    ...(got.probes ? { probes: got.probes } : {}),
  };
}

// A maker as remake runs it: { version, make }, or throws saying what a maker is.
export function maker(m, tool = 'maker') {
  const make = typeof m === 'function' ? m : m?.make;
  if (typeof make !== 'function') throw new Error(`${tool}: a maker is { version, make(record, ctx) } or a function`);
  const version = typeof m === 'function' ? undefined : m.version;
  if (version !== undefined && !(Number.isInteger(version) && version > 0) && !(typeof version === 'string' && version)) {
    throw new Error(`${tool}: a maker's version is an integer > 0 or a string (got ${JSON.stringify(version)})`);
  }
  return { version, make };
}

// hdf as a host of the asset library (asset-library plan H3): what hdf registers with any library the `asset`
// bin or davidup opens. assetlib finds this module by its place in the repo (assetlib/hosts.js KNOWN_HOSTS), so
// neither has to import hdf, and hdf need not be installed for either to work.
//
// Previewers: one per kind hdf draws, all named hdf at PREVIEW_VERSION, so a thumb says `hdf@1`. Adds (D3): what
// `hdf import` hands assetlib's addAsset (cli/import.mjs HOST: a cutout's silhouette traced, a puppet linted and
// boxed, hdf's checks, skia's pixels), so `asset add` and davidup's add_asset put a cutout as hdf would.
// Makers (I1): how `asset remake` makes again what hdf made, by the tool in the record's made block (makers.mjs).
// Loading this module is cheap; the drawing (cli/previews.mjs) and the import side (cli/import.mjs), and skia
// with them, are imported on the first thumb or the first add.
// Bump PREVIEW_VERSION when a picture changes: every thumb hdf drew before is redrawn, and no other host's is.
import { makers } from './makers.mjs';

export const PREVIEW_VERSION = 1;

// The seven kinds hdf draws (core/assets.js KINDS; test/previews.test.js holds the two lists equal).
export const KINDS = ['cutout', 'clip', 'puppet', 'hand', 'stock', 'motif', 'sample'];

let renderers;
const render = (kind) => async (file, record, opts) => {
  renderers ??= (await import('./previews.mjs')).RENDERERS;
  return renderers[kind](file, record, opts);
};

export const previewers = Object.fromEntries(KINDS.map((k) => [k, { name: 'hdf', version: PREVIEW_VERSION, render: render(k) }]));

let importing;
const side = () => (importing ??= import('./import.mjs').then((m) => m.HOST));
export const adds = Object.fromEntries(KINDS.map((k) => [k, side]));

export { makers };

export default { name: 'hdf', previewers, adds, makers };

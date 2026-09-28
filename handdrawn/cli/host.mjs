// hdf as a host of the asset library (asset-library plan H3): what hdf registers with any library the `asset`
// bin or davidup opens. assetlib finds this module by its place in the repo (assetlib/hosts.js KNOWN_HOSTS), so
// neither has to import hdf, and hdf need not be installed for either to work.
//
// Only previewers so far: one per kind hdf draws, all named hdf at PREVIEW_VERSION, so a thumb says `hdf@1`.
// Loading this module is cheap; the drawing (cli/previews.mjs, and skia with it) is imported on the first thumb.
// Bump PREVIEW_VERSION when a picture changes: every thumb hdf drew before is redrawn, and no other host's is.
export const PREVIEW_VERSION = 1;

// The seven kinds hdf draws (core/assets.js KINDS; test/previews.test.js holds the two lists equal).
export const KINDS = ['cutout', 'clip', 'puppet', 'hand', 'stock', 'motif', 'sample'];

let renderers;
const render = (kind) => async (file, record, opts) => {
  renderers ??= (await import('./previews.mjs')).RENDERERS;
  return renderers[kind](file, record, opts);
};

export const previewers = Object.fromEntries(KINDS.map((k) => [k, { name: 'hdf', version: PREVIEW_VERSION, render: render(k) }]));

export default { name: 'hdf', previewers };

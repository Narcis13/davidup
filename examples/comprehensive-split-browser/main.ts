// Browser preview for the comprehensive 20s demo, split-file edition.
//
// The composition lives across multiple files under
// `examples/comprehensive-split/` (entry → meta + 6 act bundles) and is
// stitched at runtime by the v0.2 `$ref` precompile pass
// (COMPOSITION_PRIMITIVES.md §5).
//
// Browser-side wiring:
//   1. `import.meta.glob('?raw')` eagerly inlines every split JSON as a string
//      so we don't need fetches at runtime.
//   2. We pretend they live under a virtual `/split/...` root and supply a
//      `readFile` callback that maps those virtual paths back to the raw
//      strings. The resolver doesn't care that the paths aren't real on disk;
//      it only needs them to be consistent under dirname/resolve.
//   3. Assets (`ball.png`, fonts) get their `src` patched from the JSON's
//      portable relative paths to hashed dev-server URLs (?url imports),
//      same trick the canonical comprehensive-browser uses.

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import { BrowserAssetLoader } from "../../src/assets/index.js";
import { validate } from "../../src/schema/index.js";
import { precompile } from "../../src/compose/index.js";
import { EASING_NAMES, type EasingName } from "../../src/easings/names.js";
import type { Composition } from "../../src/schema/types.js";

import ballUrl from "../ball.png?url";
import fontDisplayUrl from "../fonts/BebasNeue-Regular.ttf?url";
import fontMonoUrl from "../fonts/JetBrainsMono-Bold.ttf?url";

const ASSET_URLS: Record<string, string> = {
  ball: ballUrl,
  "font-display": fontDisplayUrl,
  "font-mono": fontMonoUrl,
};

// Eager-load every split JSON as a raw string. Vite returns the contents
// keyed by the relative glob path, e.g. "../comprehensive-split/meta.json".
const rawJsonModules = import.meta.glob<string>(
  "../comprehensive-split/**/*.json",
  { query: "?raw", import: "default", eager: true },
);

// Re-key under a virtual /split/ root so both the entry sourcePath and every
// $ref-resolved sibling share a stable absolute form. The resolver computes
// paths via path-style resolve(dirname(...), ref); using a synthetic root
// keeps that math identical to the on-disk layout without needing access to
// the actual filesystem.
const VIRTUAL_ROOT = "/split";
const fileMap = new Map<string, string>();
for (const [globKey, contents] of Object.entries(rawJsonModules)) {
  const tail = globKey.replace(/^\.\.\/comprehensive-split\//, "");
  fileMap.set(`${VIRTUAL_ROOT}/${tail}`, contents);
}

const ENTRY_PATH = `${VIRTUAL_ROOT}/comprehensive.json`;
const entryRaw = fileMap.get(ENTRY_PATH);
if (!entryRaw) {
  throw new Error(`[davidup] entry JSON not found in glob: ${ENTRY_PATH}`);
}
console.log(
  `[davidup] split sources loaded: ${fileMap.size} files`,
  Array.from(fileMap.keys()).sort(),
);

const entryJson = JSON.parse(entryRaw) as unknown;

// Precompile here (rather than letting attach() do it) so we can validate,
// count tweens, and patch asset URLs before the renderer ever sees the JSON.
const compiled = (await precompile(entryJson, {
  sourcePath: ENTRY_PATH,
  readFile: async (p) => {
    const v = fileMap.get(p);
    if (v === undefined) {
      throw new Error(`[davidup] $ref target not in in-memory map: ${p}`);
    }
    return v;
  },
})) as Composition;

for (const asset of compiled.assets) {
  const url = ASSET_URLS[asset.id];
  if (!url) throw new Error(`[davidup] no URL mapping for asset "${asset.id}"`);
  asset.src = url;
}

const usedEasings = new Set<EasingName>(
  compiled.tweens
    .map((t) => t.easing)
    .filter((e): e is EasingName => e !== undefined),
);
const missing = EASING_NAMES.filter((e) => !usedEasings.has(e));
if (missing.length > 0) {
  console.error("[davidup] missing easings:", missing);
} else {
  console.log(
    `[davidup] using all ${EASING_NAMES.length} easings across ${compiled.tweens.length} tweens`,
  );
}

const result = validate(compiled);
if (!result.valid) {
  console.error("[davidup] validation failed:", result.errors);
  throw new Error("composition invalid — see console");
}
for (const w of result.warnings) console.warn("[davidup] warning:", w);
console.log(
  `[davidup] valid: ${Object.keys(compiled.items).length} items, ` +
    `${compiled.layers.length} layers, ${compiled.tweens.length} tweens, ` +
    `${compiled.assets.length} assets`,
);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const replayBtn = document.getElementById("replay") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
const seekButtons: ReadonlyArray<{ id: string; t: number }> = [
  { id: "seek0", t: 0 },
  { id: "seek4", t: 4 },
  { id: "seek8", t: 8 },
  { id: "seek12", t: 12 },
  { id: "seek16", t: 16 },
];

const loader = new BrowserAssetLoader();
const duration = compiled.composition.duration;

let handle: AttachHandle | null = null;
let endTimer: number | null = null;

function clearEndTimer(): void {
  if (endTimer !== null) {
    clearTimeout(endTimer);
    endTimer = null;
  }
}

function scheduleEnd(remainingSeconds: number): void {
  clearEndTimer();
  endTimer = window.setTimeout(() => {
    status.textContent = "ended";
    endTimer = null;
  }, remainingSeconds * 1000 + 50);
}

let stopped = true;
async function ensureAttached(): Promise<AttachHandle | null> {
  if (handle && !stopped) return handle;
  status.textContent = "loading…";
  try {
    handle = await attach(compiled, canvas, { loader, startAt: 0 });
    stopped = false;
    return handle;
  } catch (err) {
    console.error(err);
    status.textContent = "load failed";
    return null;
  }
}

async function seekTo(t: number): Promise<void> {
  const h = await ensureAttached();
  if (!h) return;
  h.seek(t);
  status.textContent = t === 0 ? "playing" : `seek → ${t}s`;
  scheduleEnd(Math.max(0, duration - t));
}

replayBtn.addEventListener("click", () => {
  void seekTo(0);
});

for (const { id, t } of seekButtons) {
  const btn = document.getElementById(id) as HTMLButtonElement;
  btn.addEventListener("click", () => {
    void seekTo(t);
  });
}

stopBtn.addEventListener("click", () => {
  handle?.stop();
  handle = null;
  stopped = true;
  clearEndTimer();
  status.textContent = "stopped";
});

void seekTo(0);

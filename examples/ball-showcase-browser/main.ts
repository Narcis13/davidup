// Browser preview for the ball-showcase demo.
//
// Mirrors `examples/ball-showcase-60s/render.ts` (the node MP4 path) on the
// browser side: the entry composition `$ref`s 5 scene files under
// `examples/ball-showcase-60s/scenes/` plus a crossfade snippet under
// `examples/ball-showcase-60s/snippets/`, and the v0.2 import resolver lowers
// them at runtime via the v0.3 template pass and v0.4 scene precompile pass.
//
// Wiring (same trick as four-scenes-browser):
//   1. `import.meta.glob('?raw')` eagerly inlines the entry JSON + every
//      scene / snippet file as raw strings — no fetches at runtime.
//   2. We rehome them under a virtual `/showcase/` root and supply a
//      `readFile` callback so the resolver's dirname/resolve math matches the
//      on-disk layout without needing the real filesystem.
//   3. Font assets + the ball.png get their `src` patched from portable
//      relative paths to hashed `?url` imports (Vite hashes them).

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import { BrowserAssetLoader } from "../../src/assets/index.js";
import { validate } from "../../src/schema/index.js";
import { precompile } from "../../src/compose/index.js";
import type { Composition } from "../../src/schema/types.js";

import fontDisplayUrl from "../fonts/BebasNeue-Regular.ttf?url";
import fontMonoUrl from "../fonts/JetBrainsMono-Bold.ttf?url";
import ballUrl from "../ball.png?url";

const ASSET_URLS: Record<string, string> = {
  "font-display": fontDisplayUrl,
  "font-mono": fontMonoUrl,
  ball: ballUrl,
};

// Eager-load the entry + every scene/snippet JSON as raw strings. Vite returns
// contents keyed by the relative glob path, e.g.
// "../ball-showcase-60s/scenes/intro.json".
const rawJsonModules = import.meta.glob<string>(
  "../ball-showcase-60s/**/*.json",
  { query: "?raw", import: "default", eager: true },
);

// Re-key under a virtual /showcase/ root so both the entry sourcePath and
// every $ref-resolved sibling share a stable absolute form. The resolver
// computes paths via path-style resolve(dirname(...), ref); using a synthetic
// root keeps that math identical to the on-disk layout.
const VIRTUAL_ROOT = "/showcase";
const fileMap = new Map<string, string>();
for (const [globKey, contents] of Object.entries(rawJsonModules)) {
  const tail = globKey.replace(/^\.\.\/ball-showcase-60s\//, "");
  fileMap.set(`${VIRTUAL_ROOT}/${tail}`, contents);
}

const ENTRY_PATH = `${VIRTUAL_ROOT}/composition.json`;
const entryRaw = fileMap.get(ENTRY_PATH);
if (!entryRaw) {
  throw new Error(`[davidup] entry JSON not found in glob: ${ENTRY_PATH}`);
}
console.log(
  `[davidup] showcase sources loaded: ${fileMap.size} files`,
  Array.from(fileMap.keys()).sort(),
);

const entryJson = JSON.parse(entryRaw) as unknown;

// Precompile here (rather than letting attach() do it) so we can validate,
// log lowering stats, and patch asset URLs before the renderer ever sees the
// JSON.
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

const result = validate(compiled);
if (!result.valid) {
  console.error("[davidup] validation failed:", result.errors);
  throw new Error("composition invalid — see console");
}
for (const w of result.warnings) console.warn("[davidup] warning:", w);
console.log(
  `[davidup] valid: ${Object.keys(compiled.items).length} items, ` +
    `${compiled.layers.length} layers, ${compiled.tweens.length} tweens, ` +
    `${compiled.assets.length} assets — 5 scenes + 6 templates lowered ` +
    `(${compiled.composition.duration}s @ ${compiled.composition.fps}fps)`,
);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const replayBtn = document.getElementById("replay") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
// Seek points line up with scene boundaries from composition.json:
//   intro 0–10s · grid 10–22s · physics 22–40s · ballet 40–52s · finale 52–60s.
const seekButtons: ReadonlyArray<{ id: string; t: number }> = [
  { id: "seek0", t: 0 },
  { id: "seek10", t: 10 },
  { id: "seek22", t: 22 },
  { id: "seek40", t: 40 },
  { id: "seek52", t: 52 },
];

const loader = new BrowserAssetLoader();
const duration = compiled.composition.duration;

let handle: AttachHandle | null = null;
let endTimer: number | null = null;
let stopped = true;

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

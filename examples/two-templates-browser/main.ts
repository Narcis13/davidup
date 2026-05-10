// Davidup v0.3 — browser preview for the 30-second two-template demo.
//
// Loads `examples/two-templates-30s.json` (canonical authored source — exactly
// two `$template` instances), patches each font asset's `src` to a hashed
// dev-server URL, then hands the JSON straight to `attach`. The browser
// driver runs `precompile()` first, so the `$template` markers expand into
// concrete items + tweens at runtime — same JSON node uses for the MP4.

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import { BrowserAssetLoader } from "../../src/assets/index.js";
import type { Composition } from "../../src/schema/types.js";

import compositionJson from "../two-templates-30s.json";
import compositionRaw from "../two-templates-30s.json?raw";
import fontDisplayUrl from "../fonts/BebasNeue-Regular.ttf?url";
import fontMonoUrl from "../fonts/JetBrainsMono-Bold.ttf?url";

const ASSET_URLS: Record<string, string> = {
  "font-display": fontDisplayUrl,
  "font-mono": fontMonoUrl,
};

// Prove the <100-line claim in the page console.
const lineCount = compositionRaw.split("\n").length;
console.log(
  `[davidup] two-templates-30s.json = ${lineCount} lines ` +
    `${lineCount < 100 ? "✓" : "✗"} <100`,
);

// structuredClone so we don't mutate the frozen import. Vite freezes JSON
// modules in some pipelines, and we patch `assets[*].src` below.
const composition = structuredClone(compositionJson) as Composition;
for (const asset of composition.assets) {
  const url = ASSET_URLS[asset.id];
  if (!url) throw new Error(`[davidup] no URL mapping for asset "${asset.id}"`);
  asset.src = url;
}

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const replayBtn = document.getElementById("replay") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
const seekButtons: ReadonlyArray<{ id: string; t: number }> = [
  { id: "seek0", t: 0 },
  { id: "seek5", t: 5 },
  { id: "seek14", t: 14 },
  { id: "seek22", t: 22 },
];

const loader = new BrowserAssetLoader();
const duration = composition.composition.duration;

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
    handle = await attach(composition, canvas, { loader, startAt: 0 });
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
  btn.addEventListener("click", () => void seekTo(t));
}
stopBtn.addEventListener("click", () => {
  handle?.stop();
  handle = null;
  stopped = true;
  clearEndTimer();
  status.textContent = "stopped";
});

void seekTo(0);

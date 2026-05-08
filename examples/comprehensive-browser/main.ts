// Browser preview for the comprehensive 20s demo.
//
// The composition lives in `examples/comprehensive-composition.json` (the
// canonical, host-agnostic source per design-doc §3). Vite imports the JSON
// at build time and we patch the three asset `src` fields with hashed dev-
// server URLs (?url imports) before validating + attaching.
//
// Replay/Seek hit handle.seek() directly — exercising the v0.1 fix that
// re-primes the RAF loop after it has self-stopped past the end. Re-attach
// is reserved for an explicit "reload" path. Manual test plan:
//
//   1. Press Play, let the clip run to the end ("ended" status).
//   2. Press "Seek 0s" — canvas resumes painting from frame 0 (pre-fix this
//      was a no-op; the canvas froze on the t=duration black frame).
//   3. Press "Seek 12s" mid-run — playhead jumps without recreating the
//      loop or re-fetching assets.
//   4. Press Stop, then any Seek — nothing happens (stop is terminal).
//      Press Replay to recreate the handle.

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import { BrowserAssetLoader } from "../../src/assets/index.js";
import { validate } from "../../src/schema/index.js";
import { EASING_NAMES, type EasingName } from "../../src/easings/names.js";
import type { Composition } from "../../src/schema/types.js";

import compositionJson from "../comprehensive-composition.json";
import ballUrl from "../ball.png?url";
import fontDisplayUrl from "../fonts/BebasNeue-Regular.ttf?url";
import fontMonoUrl from "../fonts/JetBrainsMono-Bold.ttf?url";

const ASSET_URLS: Record<string, string> = {
  ball: ballUrl,
  "font-display": fontDisplayUrl,
  "font-mono": fontMonoUrl,
};

// Clone so we don't mutate the imported JSON module (some bundlers freeze it).
const composition = structuredClone(compositionJson) as Composition;
for (const asset of composition.assets) {
  const url = ASSET_URLS[asset.id];
  if (!url) throw new Error(`[motionforge] no URL mapping for asset "${asset.id}"`);
  asset.src = url;
}

const usedEasings = new Set<EasingName>(
  composition.tweens
    .map((t) => t.easing)
    .filter((e): e is EasingName => e !== undefined),
);
const missing = EASING_NAMES.filter((e) => !usedEasings.has(e));
if (missing.length > 0) {
  console.error("[motionforge] missing easings:", missing);
} else {
  console.log(
    `[motionforge] using all ${EASING_NAMES.length} easings across ${composition.tweens.length} tweens`,
  );
}

const result = validate(composition);
if (!result.valid) {
  console.error("[motionforge] validation failed:", result.errors);
  throw new Error("composition invalid — see console");
}
for (const w of result.warnings) console.warn("[motionforge] warning:", w);

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
const duration = composition.composition.duration;

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

// Build (or reuse) the RAF handle. Subsequent calls reuse the same handle
// and just seek() — proving the loop self-restarts after exiting at t>=duration.
let stopped = true;
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

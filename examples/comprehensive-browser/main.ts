// Browser preview for the comprehensive 20s demo.
//
// Builds the same Composition the node renderer uses (via the shared
// `comprehensive-composition` module), passing browser-served URLs for the
// three assets. Vite's `?url` import returns a hashed URL the dev server
// can resolve, so ball.png + the two TTFs are served straight from the
// `examples/` tree without a public/ copy.

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import { BrowserAssetLoader } from "../../src/assets/index.js";
import { validate } from "../../src/schema/index.js";
import { EASING_NAMES } from "../../src/easings/names.js";
import { buildCompositionAndCoverage } from "../comprehensive-composition.js";

import ballUrl from "../ball.png?url";
import fontDisplayUrl from "../fonts/BebasNeue-Regular.ttf?url";
import fontMonoUrl from "../fonts/JetBrainsMono-Bold.ttf?url";

const { composition, usedEasings } = buildCompositionAndCoverage({
  ball: ballUrl,
  fontDisplay: fontDisplayUrl,
  fontMono: fontMonoUrl,
});

const missing = EASING_NAMES.filter((e) => !usedEasings.has(e));
if (missing.length > 0) {
  console.error("[motionforge] missing easings:", missing);
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

// Reuse one loader across every attach() call so the TTFs and ball.png
// aren't re-fetched on each Replay/Seek. BrowserAssetLoader memoizes by
// asset id, so the second preloadAll resolves immediately.
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
    if (handle) status.textContent = "ended";
    endTimer = null;
  }, remainingSeconds * 1000 + 50);
}

// Always start fresh: stop any existing RAF loop and re-attach. The
// driver's `seek()` only adjusts the timeline; it does NOT restart a
// loop that has already exited (which happens once t passes duration).
// Re-attaching is the simplest way to guarantee a running loop after
// any user-initiated jump.
async function play(at: number): Promise<void> {
  handle?.stop();
  handle = null;
  clearEndTimer();
  status.textContent = "loading…";
  try {
    handle = await attach(composition, canvas, { loader, startAt: at });
  } catch (err) {
    console.error(err);
    status.textContent = "load failed";
    return;
  }
  status.textContent = "playing";
  scheduleEnd(Math.max(0, duration - at));
}

replayBtn.addEventListener("click", () => {
  void play(0);
});

for (const { id, t } of seekButtons) {
  const btn = document.getElementById(id) as HTMLButtonElement;
  btn.addEventListener("click", () => {
    void play(t);
  });
}

stopBtn.addEventListener("click", () => {
  handle?.stop();
  handle = null;
  clearEndTimer();
  status.textContent = "stopped";
});

void play(0);

// Bundled into an IIFE via esbuild at test time (see nodeBrowserParity
// integration test) and injected into a headless Chromium page. Exposes a
// single global that paints the real production browser driver (`attach`)
// onto a real DOM canvas at an exact time `t`, then returns the resulting
// pixels. This exercises the SAME code path the editor's stage ships —
// nothing parity-test-specific about the render, only about how the single
// frame is captured (a fake clock/RAF instead of a live RAF loop).

// Imported from its own file, not the `src/assets/index.js` barrel — that
// barrel also re-exports `NodeAssetLoader`, whose top-level `node:os`/
// `node:path` imports esbuild can't resolve (and shouldn't) for a browser
// bundle.
import { BrowserAssetLoader } from "../../../src/assets/browser.js";
import { attach } from "../../../src/drivers/browser/index.js";
import type { Composition } from "../../../src/schema/types.js";

async function renderAt(
  canvas: HTMLCanvasElement,
  comp: Composition,
  t: number,
): Promise<Uint8ClampedArray> {
  const loader = new BrowserAssetLoader();
  // Fixed clock + a RAF that's never actually flushed: `attach()` paints the
  // first frame synchronously (at `startAt`) before it returns, which is the
  // only frame this test needs — see tests/drivers/browser.test.ts for the
  // same "first paint is synchronous" contract this relies on.
  const handle = await attach(comp, canvas, {
    loader,
    startAt: t,
    now: () => 0,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {
      /* no-op */
    },
  });
  handle.stop();

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return img.data;
}

(globalThis as unknown as { __davidupRenderAt: typeof renderAt }).__davidupRenderAt =
  renderAt;

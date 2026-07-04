// Determinism harness — node↔browser pixel parity (v1 plan Session 23 item
// 3, R-16). Renders the SAME shapes/text-only composition through both
// production drivers — real skia-canvas in node, real headless Chromium
// Canvas2D in the browser — at the same instant, and asserts the two
// rasterizations agree within a similarity tolerance.
//
// Why a tolerance, not byte-identical: node's skia-canvas and Chromium's
// Canvas2D are both Skia-backed, but different Skia builds/embeddings with
// their own font-hinting and anti-aliasing edge cases — genuine bit-exact
// agreement on curved shape edges and glyph coverage isn't a realistic bar.
// What this test actually guards against is a DRIVER bug: wrong paint order,
// wrong blend math, wrong transform math, a color channel swap — anything
// that would move the mean pixel difference from "a few units of AA noise"
// to "a visibly different image". The threshold below was set from an
// observed baseline (see the comment at MAX_MEAN_CHANNEL_DIFF) with headroom,
// not picked to make the test pass.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderFrameRawAt } from "./support/renderSingleFrame.js";
import { buildParityComposition } from "./parity/fixture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(HERE, "../../examples/fonts/BebasNeue-Regular.ttf");
const BROWSER_ENTRY = resolve(HERE, "parity/browserEntry.ts");

// Chromium isn't always available (sandboxed CI runners, offline installs).
// Skip rather than fail hard — the golden-frame and bitexact tests already
// cover determinism without a browser dependency.
let chromiumAvailable = true;
let browser: import("playwright").Browser | undefined;

beforeAll(async () => {
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  } catch {
    chromiumAvailable = false;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function bundleBrowserEntry(): Promise<string> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [BROWSER_ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    // The engine/compose modules have a couple of lazy `import("node:...")`
    // calls guarded by runtime checks that never fire for a v0.1-canonical,
    // `$ref`-free composition (e.g. `compose/imports.ts`'s `defaultReadFile`)
    // — leave them unresolved rather than erroring; they're unreachable here.
    external: ["node:*"],
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error("esbuild produced no output for browserEntry.ts");
  return output.text;
}

async function renderInBrowser(
  bundle: string,
  compJson: unknown,
  t: number,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  if (!browser) throw new Error("browser not launched");
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.addScriptTag({ content: bundle });
    const pixels = await page.evaluate(
      async ({ compJson, t, width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        document.body.appendChild(canvas);
        const fn = (
          window as unknown as {
            __davidupRenderAt: (
              c: HTMLCanvasElement,
              comp: unknown,
              t: number,
            ) => Promise<Uint8ClampedArray>;
          }
        ).__davidupRenderAt;
        const data = await fn(canvas, compJson, t);
        return Array.from(data);
      },
      { compJson, t, width, height },
    );
    return Uint8ClampedArray.from(pixels);
  } finally {
    await page.close();
  }
}

// Mean per-channel (R/G/B, alpha excluded — both drivers paint an opaque
// background so alpha is uniformly 255) absolute difference across every
// pixel. Observed baseline on this fixture (axis-aligned shapes + one short
// text label, same embedded font both sides): ~1.1. Threshold gives ~5x
// headroom for AA/hinting variance across machines/Skia versions while still
// catching a real driver bug (e.g. a channel swap or blend-mode mismatch
// routinely moves this into the tens-to-hundreds range).
const MAX_MEAN_CHANNEL_DIFF = 6;

function meanChannelDiff(
  a: Uint8ClampedArray | Uint8Array,
  b: Uint8ClampedArray | Uint8Array,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i]! - b[i]!); // R
    sum += Math.abs(a[i + 1]! - b[i + 1]!); // G
    sum += Math.abs(a[i + 2]! - b[i + 2]!); // B
    count += 3;
  }
  return sum / count;
}

describe("determinism — node↔browser pixel parity", () => {
  it("agrees within tolerance on a shapes/text-only composition", async (ctx) => {
    if (!chromiumAvailable) {
      ctx.skip();
      return;
    }

    const t = 0.4; // arbitrary static instant — no tweens in this comp, but
    // exercises the same time-threading code path both drivers use.
    const fontBytes = await readFile(FONT_PATH);
    const dataUri = `data:font/ttf;base64,${fontBytes.toString("base64")}`;

    const nodeComp = buildParityComposition(FONT_PATH);
    const browserComp = buildParityComposition(dataUri);

    const [nodeFrame, bundle] = await Promise.all([
      renderFrameRawAt(nodeComp, t),
      bundleBrowserEntry(),
    ]);
    const browserPixels = await renderInBrowser(
      bundle,
      browserComp,
      t,
      nodeFrame.width,
      nodeFrame.height,
    );

    expect(browserPixels.length).toBe(nodeFrame.data.length);
    const diff = meanChannelDiff(nodeFrame.data, browserPixels);
    console.log(`[nodeBrowserParity] mean per-channel diff: ${diff.toFixed(3)}`);
    expect(
      diff,
      `mean per-channel pixel diff ${diff.toFixed(2)} exceeded ${MAX_MEAN_CHANNEL_DIFF} — ` +
        `likely a real node↔browser rendering divergence, not AA noise`,
    ).toBeLessThan(MAX_MEAN_CHANNEL_DIFF);
  }, 30_000);
});

// v1 plan Session 24 (§6 item 18) — one end-to-end smoke test driving the
// real editor through a real headless Chromium: boot the editor against a
// scratch copy of examples/editor-demo, add a shape via the stage toolbar,
// animate one of its transform fields via the Inspector's "+ animate"
// popover, kick off a draft-preset render, and confirm the rendered MP4 is
// actually reachable over HTTP.
//
// This isn't a unit test of any one module — it's a tripwire for the whole
// UI → command-bus → server → render pipeline breaking together in a way no
// individual test would catch (a stale data-testid after a refactor, a
// wired event that stopped firing, a regressed render route).
//
// Chromium isn't always available (sandboxed/offline CI runners) — skip
// rather than fail hard, matching tests/determinism/nodeBrowserParity's
// convention. CI installs it explicitly (`bunx playwright install --with-deps
// chromium`) for the root job, which this test also runs under.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { runEdit, type EditHandle } from "../../src/cli/edit.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = resolve(HERE, "..", "..");
const EDITOR_APP_DIR = join(REPO_ROOT, "apps", "editor");
const DEMO_PROJECT_DIR = join(REPO_ROOT, "examples", "editor-demo");

// Mirrors tests/determinism/nodeBrowserParity's probe: `chromium.launch()`
// itself throws if the browser binary was never installed (the common
// CI-cache-miss case), not just if the `playwright` package is missing — so
// the availability check has to attempt the launch, not just the import.
let chromiumAvailable = true;
let browser: import("playwright").Browser | undefined;
try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
} catch {
  chromiumAvailable = false;
}

afterAll(async () => {
  await browser?.close();
});

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error("could not allocate a free port")));
      }
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => {});
  }
});

describe.skipIf(!chromiumAvailable)(
  "editor smoke (boot → add shape → animate → render)",
  () => {
    it(
      "adds a shape, animates it, renders a draft MP4, and the output is reachable",
      async () => {
        // Work on a scratch copy so this test never mutates the git-tracked
        // examples/editor-demo fixture.
        const projectDir = await mkdtemp(
          join(tmpdir(), "davidup-editor-smoke-"),
        );
        cleanups.push(() => rm(projectDir, { recursive: true, force: true }));
        await cp(DEMO_PROJECT_DIR, projectDir, { recursive: true });

        const port = await getFreePort();
        const handle: EditHandle = await runEdit({
          projectDir,
          editorAppDir: EDITOR_APP_DIR,
          port,
          host: "127.0.0.1",
          noOpen: true,
          noWatch: true,
          readyTimeoutMs: 30_000,
        });
        cleanups.push(() => handle.close());

        const page = await browser!.newPage({
          viewport: { width: 1440, height: 900 },
        });
        cleanups.push(() => page.close());

        await page.goto(`${handle.url}/editor`, { waitUntil: "load" });

        // Dev mode serves the component tree as unbundled ES modules — each
        // SFC (and its scoped `<style>`) is a separate request, so the
        // document's `load` event fires well before the whole tree has
        // mounted and styled. Clicking before that lands on a CSS-less
        // layout (elements exist in the DOM but have no box, e.g. `<canvas>`
        // still reports its intrinsic 300×150 default — that's not a usable
        // signal). `.item-toolbar`'s scoped CSS sets `position: absolute`;
        // waiting for that to take effect confirms the toolbar's own module
        // (and everything it depends on) has actually loaded and applied.
        await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="item-toolbar"]');
            return !!el && getComputedStyle(el).position === "absolute";
          },
          undefined,
          { timeout: 20_000 },
        );

        // Dismiss the first-run onboarding overlay if it's showing. Its
        // dismissal persists machine-wide in ~/.davidup/state.json, so a
        // fresh CI runner sees it on the very first boot but a dev machine
        // that's already used the editor won't — handle both.
        const onboardingClose = page.locator(
          '[data-testid="onboarding-close"]',
        );
        if (await onboardingClose.isVisible().catch(() => false)) {
          await onboardingClose.click();
        }

        // ── Add a shape ──────────────────────────────────────────────────
        // Arms the rect tool, then a plain click on the stage canvas drops
        // it at the click coordinates (place-mode takes precedence over
        // hit-testing — see Stage.vue's onCanvasClick).
        await page.locator('[data-testid="item-toolbar-rect"]').click();
        await page.locator('[data-testid="stage-canvas"]').click();

        // Placing a shape auto-selects it (Stage.vue's placeAndSelect),
        // which flips the Inspector into single-item mode and reveals the
        // Transform fields, including the `+ animate` button on `x`.
        const animateX = page.locator('[data-testid="inspector-animate-x"]');
        await animateX.waitFor({ state: "visible", timeout: 10_000 });
        await animateX.click();
        await page
          .locator('[data-testid="inspector-animate-confirm"]')
          .click();

        // ── Render a draft MP4 ───────────────────────────────────────────
        await page.locator('[data-testid="render-button"]').click();
        await page
          .locator('[data-testid="render-dialog-preset-draft"]')
          .click();
        await page.locator('[data-testid="render-dialog-confirm"]').click();

        const renderDone = page.locator('[data-testid="render-done"]');
        await renderDone.waitFor({ state: "visible", timeout: 90_000 });

        const outputHref = await page
          .locator('[data-testid="render-output-link"]')
          .getAttribute("href");
        expect(outputHref).toBeTruthy();

        const response = await page.request.get(
          `${handle.url}${outputHref}`,
        );
        expect(response.ok()).toBe(true);
        const bytes = await response.body();
        expect(bytes.byteLength).toBeGreaterThan(0);
      },
      120_000,
    );
  },
);

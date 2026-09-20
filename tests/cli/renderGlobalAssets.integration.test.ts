// B-5 regression: `davidup render` must keep `global:` / `bundled:` asset srcs
// symbolic so the Node asset loader resolves them against the library root.
//
// Before the fix, `resolveAssetSources` treated any non-absolute src as a
// relative path and joined it onto the composition's directory, so a comp
// using a global-library font died with
//   `No such file or directory … /<comp dir>/global:fonts/anton-400.woff2`.
//
// Renders for real (skia-canvas, PNG sequence — no ffmpeg) against a fixture
// library pointed at by $DAVIDUP_LIBRARY, so the whole path is exercised:
// CLI → precompile → validate → resolveAssetSources → NodeAssetLoader.

import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderComposition } from "../../src/cli/render.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A 2×2 opaque red PNG — the smallest thing the image loader will accept.
const RED_2X2_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=",
  "base64",
);

const tmps: string[] = [];
const envBefore = process.env.DAVIDUP_LIBRARY;
afterEach(async () => {
  if (envBefore === undefined) delete process.env.DAVIDUP_LIBRARY;
  else process.env.DAVIDUP_LIBRARY = envBefore;
  while (tmps.length) {
    await rm(tmps.pop()!, { recursive: true, force: true });
  }
});

async function makeTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

/** A `$DAVIDUP_LIBRARY` root holding one image and one font. */
async function makeLibrary(): Promise<string> {
  const root = await makeTmp("davidup-lib-");
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "fonts"), { recursive: true });
  await writeFile(join(root, "assets", "dot.png"), RED_2X2_PNG);
  await copyFile(join(repoRoot, "fonts", "Inter-Regular.ttf"), join(root, "fonts", "lib.ttf"));
  return root;
}

function transform(x: number, y: number): Record<string, number> {
  return { x, y, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };
}

/** One frame with a `global:` image and a `global:` font, plus a local file. */
function globalAssetComposition(): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 64, height: 32, fps: 12, duration: 1 / 12, background: "#000010" },
    assets: [
      { id: "dot", type: "image", src: "global:assets/dot.png" },
      { id: "lib", type: "font", family: "LibFont", src: "global:fonts/lib.ttf" },
      { id: "local", type: "image", src: "./local.png" },
    ],
    layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: ["sprite", "near", "label"] }],
    items: {
      sprite: { type: "sprite", asset: "dot", width: 8, height: 8, transform: transform(2, 2) },
      near: { type: "sprite", asset: "local", width: 8, height: 8, transform: transform(2, 14) },
      label: {
        type: "text",
        text: "hi",
        font: "lib",
        fontSize: 12,
        color: "#ffffff",
        transform: transform(20, 20),
      },
    },
    tweens: [],
  };
}

describe("cli · render · global: asset srcs (B-5, integration)", () => {
  it("renders a composition whose image and font come from the global library", async () => {
    const library = await makeLibrary();
    process.env.DAVIDUP_LIBRARY = library;

    const project = await makeTmp("davidup-proj-");
    await writeFile(join(project, "local.png"), RED_2X2_PNG);
    await writeFile(
      join(project, "composition.json"),
      JSON.stringify(globalAssetComposition()),
    );

    const out = await makeTmp("davidup-out-");
    const result = await renderComposition({
      input: project,
      outputPath: out,
      format: "png-sequence",
    });

    expect(result.frameCount).toBe(1);
    expect((await readdir(out)).filter((f) => f.endsWith(".png"))).toHaveLength(1);
  }, 30_000);
});

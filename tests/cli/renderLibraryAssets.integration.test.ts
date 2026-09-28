// Asset library D1: `davidup render` of a composition whose assets are
// `asset:<id>[@sha12]` srcs — records on the project's `assets/` shelf, the
// user's pool and the house shelf (docs/asset-library-plan.md).
//
// Renders for real (skia-canvas, PNG sequence — no ffmpeg), so the whole path
// is exercised: CLI → precompile → validate → checkLibraryAssets →
// NodeAssetLoader → resolveGlobalSrc → assetlib.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOUSE_ROOT, decodePng, readShelf } from "../../assetlib/index.js";
import { RenderError, renderComposition } from "../../src/cli/render.js";
import { BLUE_PNG, RED_PNG, makeShelves, put, putFont, type Shelves } from "../assets/libraryShelves.js";

const envBefore = { ...process.env };
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  process.env = { ...envBefore };
  while (cleanups.length) await cleanups.pop()!();
});

function shelves(): Shelves {
  const sh = makeShelves();
  cleanups.push(sh.cleanup);
  Object.assign(process.env, sh.env);
  delete process.env.DAVIDUP_PROJECT;
  return sh;
}

async function outDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "davidup-out-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function transform(x: number, y: number): Record<string, number> {
  return { x, y, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };
}

function composition(assets: Array<Record<string, unknown>>, items: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 64, height: 32, fps: 12, duration: 1 / 12, background: "#000000" },
    assets,
    layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: Object.keys(items) }],
    items,
    tweens: [],
  };
}

async function renderOne(dir: string): Promise<{ data: Uint8ClampedArray; width: number }> {
  const out = await outDir();
  const result = await renderComposition({ input: dir, outputPath: out, format: "png-sequence" });
  expect(result.frameCount).toBe(1);
  const frames = (await readdir(out)).filter((f) => f.endsWith(".png"));
  expect(frames).toHaveLength(1);
  return decodePng(readFileSync(join(out, frames[0]!)));
}

const pixel = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
  [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

describe("cli · render · asset: srcs (asset library D1, integration)", () => {
  it("renders records from the project shelf (shadowing the user's) and the house shelf, pinned and not", async () => {
    const sh = shelves();
    const dot = put(join(sh.project, "assets"), { id: "dot", kind: "image" }, RED_PNG);
    put(sh.user, { id: "dot", kind: "image" }, BLUE_PNG);
    put(sh.house, { id: "sky", kind: "stock", box: [0, 0, 2, 2] }, BLUE_PNG);
    putFont(sh.user, "inter", "LibInter");
    await writeFile(
      join(sh.project, "composition.json"),
      JSON.stringify(
        composition(
          [
            { id: "dot", type: "image", src: `asset:dot@${dot.slice(0, 12)}` },
            { id: "sky", type: "image", src: "asset:sky" },
            { id: "inter", type: "font", family: "LibInter", src: "asset:inter" },
          ],
          {
            a: { type: "sprite", asset: "dot", width: 8, height: 8, transform: transform(2, 2) },
            b: { type: "sprite", asset: "sky", width: 8, height: 8, transform: transform(20, 2) },
            label: { type: "text", text: "hi", font: "inter", fontSize: 12, color: "#ffffff", transform: transform(40, 20) },
          },
        ),
      ),
    );

    const img = await renderOne(sh.project);
    expect(pixel(img, 5, 5)).toEqual([255, 0, 0]); // the project's red dot, not the user's blue one
    expect(pixel(img, 23, 5)).toEqual([0, 0, 255]); // the house sky
  }, 30_000);

  it("fails before rendering on a stale pin (E_ASSET_STALE) and a missing record (E_ASSET_MISSING)", async () => {
    const sh = shelves();
    put(join(sh.project, "assets"), { id: "dot", kind: "image" }, RED_PNG);
    const sprite = { a: { type: "sprite", asset: "dot", width: 8, height: 8, transform: transform(2, 2) } };

    await writeFile(
      join(sh.project, "composition.json"),
      JSON.stringify(composition([{ id: "dot", type: "image", src: "asset:dot@0123456789ab" }], sprite)),
    );
    const out = await outDir();
    const stale = renderComposition({ input: sh.project, outputPath: out, format: "png-sequence" });
    await expect(stale).rejects.toBeInstanceOf(RenderError);
    await expect(stale).rejects.toMatchObject({ code: "E_ASSET_STALE" });
    expect(await readdir(out)).toEqual([]);

    await writeFile(
      join(sh.project, "composition.json"),
      JSON.stringify(composition([{ id: "dot", type: "image", src: "asset:teapot" }], sprite)),
    );
    await expect(renderComposition({ input: sh.project, outputPath: out, format: "png-sequence" })).rejects.toMatchObject({
      code: "E_ASSET_MISSING",
      message: expect.stringContaining(`project (${join(sh.project, "assets")})`),
    });
  }, 30_000);

  it("takes the project shelf only from a directory that holds a catalogue, else $DAVIDUP_PROJECT", async () => {
    const sh = shelves();
    put(join(sh.project, "assets"), { id: "dot", kind: "image" }, RED_PNG);
    // The composition lives elsewhere, with no shelf of its own.
    const elsewhere = await outDir();
    await writeFile(
      join(elsewhere, "composition.json"),
      JSON.stringify(
        composition([{ id: "dot", type: "image", src: "asset:dot" }], {
          a: { type: "sprite", asset: "dot", width: 8, height: 8, transform: transform(2, 2) },
        }),
      ),
    );
    await expect(renderComposition({ input: elsewhere, outputPath: await outDir(), format: "png-sequence" })).rejects.toMatchObject({
      code: "E_ASSET_MISSING",
    });
    process.env.DAVIDUP_PROJECT = sh.project;
    expect(pixel(await renderOne(elsewhere), 5, 5)).toEqual([255, 0, 0]);
  }, 30_000);

  // The plan's done-when: `asset:teapot` off the real house shelf (hdf's Met cutout, a WebP).
  it.skipIf(!readShelf(HOUSE_ROOT).has("teapot"))("renders the house shelf's teapot", async () => {
    const sh = shelves();
    delete process.env.DAVIDUP_HOUSE; // the house shelf by path
    const teapot = readShelf(HOUSE_ROOT).entry("teapot");
    expect(existsSync(join(HOUSE_ROOT, "blobs", `${teapot.sha}.${teapot.ext}`))).toBe(true);
    await writeFile(
      join(sh.project, "composition.json"),
      JSON.stringify(
        composition([{ id: "teapot", type: "image", src: `asset:teapot@${teapot.sha.slice(0, 12)}` }], {
          pot: { type: "sprite", asset: "teapot", width: 64, height: 32, transform: transform(0, 0) },
        }),
      ),
    );
    const img = await renderOne(sh.project);
    // Something of the teapot is drawn over the black background.
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! > 60) lit++;
    expect(lit).toBeGreaterThan(64 * 32 * 0.1);
  }, 30_000);
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderComposition,
  resolveAssetSources,
  RenderError,
  type RenderDeps,
} from "../../src/cli/render.js";
import type { Composition } from "../../src/schema/types.js";
import type { RenderToFileResult } from "../../src/drivers/node/index.js";

const tmps: string[] = [];
afterEach(async () => {
  while (tmps.length) {
    const d = tmps.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

async function makeTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

function basicComposition(): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 16, height: 9, fps: 30, duration: 1, background: "#000000" },
    assets: [],
    layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 4,
        height: 4,
        fillColor: "#ffffff",
        transform: {
          x: 8,
          y: 4,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

function fakeRenderFn(): {
  renderFn: RenderDeps["renderFn"];
  calls: Array<{ comp: Composition; outPath: string; opts: unknown }>;
} {
  const calls: Array<{ comp: Composition; outPath: string; opts: unknown }> = [];
  const renderFn: RenderDeps["renderFn"] = async (comp, outPath, opts) => {
    calls.push({ comp, outPath, opts });
    const result: RenderToFileResult = {
      outputPath: outPath,
      durationMs: 5,
      frameCount: Math.max(1, Math.ceil(comp.composition.duration * comp.composition.fps)),
    };
    return result;
  };
  return { renderFn, calls };
}

describe("cli · render · renderComposition", () => {
  it("renders a project directory (composition.json)", async () => {
    const dir = await makeTmp("davidup-render-project-");
    await writeFile(join(dir, "composition.json"), JSON.stringify(basicComposition()));
    const { renderFn, calls } = fakeRenderFn();

    const result = await renderComposition(
      { input: dir, outputPath: join(dir, "out.mp4") },
      { renderFn },
    );

    expect(result.outputPath).toBe(join(dir, "out.mp4"));
    expect(result.frameCount).toBe(30);
    expect(calls).toHaveLength(1);
  });

  it("renders a standalone composition JSON file", async () => {
    const dir = await makeTmp("davidup-render-json-");
    const compPath = join(dir, "clip.json");
    await writeFile(compPath, JSON.stringify(basicComposition()));
    const { renderFn, calls } = fakeRenderFn();

    const result = await renderComposition(
      { input: compPath, outputPath: join(dir, "out.mp4") },
      { renderFn },
    );

    expect(result.frameCount).toBe(30);
    expect(calls[0]!.opts).toMatchObject({ sourcePath: compPath });
  });

  it("overrides fps on the loaded composition", async () => {
    const dir = await makeTmp("davidup-render-fps-");
    await writeFile(join(dir, "composition.json"), JSON.stringify(basicComposition()));
    const { renderFn, calls } = fakeRenderFn();

    await renderComposition(
      { input: dir, outputPath: join(dir, "out.mp4"), fps: 60 },
      { renderFn },
    );

    expect(calls[0]!.comp.composition.fps).toBe(60);
  });

  it("resolves relative asset src against the source file's directory", async () => {
    const dir = await makeTmp("davidup-render-assets-");
    await mkdir(join(dir, "fonts"), { recursive: true });
    await writeFile(join(dir, "fonts", "Foo.ttf"), "not-a-real-font");
    const comp = basicComposition();
    (comp as { assets: unknown[] }).assets = [
      { id: "font1", type: "font", src: "./fonts/Foo.ttf", family: "Foo" },
    ];
    await writeFile(join(dir, "composition.json"), JSON.stringify(comp));
    const { renderFn, calls } = fakeRenderFn();

    await renderComposition({ input: dir, outputPath: join(dir, "out.mp4") }, { renderFn });

    const assets = calls[0]!.comp.assets as Array<{ src: string }>;
    expect(assets[0]!.src).toBe(join(dir, "fonts", "Foo.ttf"));
  });

  it("throws E_INPUT_NOT_FOUND when the input path does not exist", async () => {
    const dir = await makeTmp("davidup-render-missing-");
    const { renderFn } = fakeRenderFn();
    await expect(
      renderComposition(
        { input: join(dir, "nope"), outputPath: join(dir, "out.mp4") },
        { renderFn },
      ),
    ).rejects.toMatchObject({ code: "E_INPUT_NOT_FOUND" });
  });

  it("throws E_INPUT_NOT_FOUND when a project dir is missing composition.json", async () => {
    const dir = await makeTmp("davidup-render-noproj-");
    const { renderFn } = fakeRenderFn();
    await expect(
      renderComposition({ input: dir, outputPath: join(dir, "out.mp4") }, { renderFn }),
    ).rejects.toMatchObject({ code: "E_INPUT_NOT_FOUND" });
  });

  it("throws E_INPUT_INVALID on malformed JSON", async () => {
    const dir = await makeTmp("davidup-render-badjson-");
    await writeFile(join(dir, "composition.json"), "{ not json");
    const { renderFn } = fakeRenderFn();
    await expect(
      renderComposition({ input: dir, outputPath: join(dir, "out.mp4") }, { renderFn }),
    ).rejects.toMatchObject({ code: "E_INPUT_INVALID" });
  });

  it("throws E_VALIDATION_FAILED when a referenced asset is missing", async () => {
    const dir = await makeTmp("davidup-render-invalid-");
    const comp = basicComposition();
    (comp as { items: Record<string, unknown> }).items.box = {
      type: "sprite",
      asset: "does-not-exist",
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 1,
      },
    };
    await writeFile(join(dir, "composition.json"), JSON.stringify(comp));
    const { renderFn } = fakeRenderFn();

    await expect(
      renderComposition({ input: dir, outputPath: join(dir, "out.mp4") }, { renderFn }),
    ).rejects.toMatchObject({ code: "E_VALIDATION_FAILED" });
  });

  it("wraps a render-time failure as E_RENDER_FAILED", async () => {
    const dir = await makeTmp("davidup-render-fail-");
    await writeFile(join(dir, "composition.json"), JSON.stringify(basicComposition()));
    const renderFn: RenderDeps["renderFn"] = async () => {
      throw new Error("ffmpeg exited with code 1:\nsome stderr tail");
    };

    await expect(
      renderComposition({ input: dir, outputPath: join(dir, "out.mp4") }, { renderFn }),
    ).rejects.toMatchObject({ code: "E_RENDER_FAILED" });
  });

  it("reports progress via the injected onProgress", async () => {
    const dir = await makeTmp("davidup-render-progress-");
    await writeFile(join(dir, "composition.json"), JSON.stringify(basicComposition()));
    const renderFn: RenderDeps["renderFn"] = async (comp, outPath, opts) => {
      opts.onProgress?.({ frame: 1, total: 30 });
      opts.onProgress?.({ frame: 30, total: 30 });
      return { outputPath: outPath, durationMs: 1, frameCount: 30 };
    };
    const seen: Array<{ frame: number; total: number }> = [];

    await renderComposition(
      { input: dir, outputPath: join(dir, "out.mp4") },
      { renderFn, onProgress: (info) => seen.push(info) },
    );

    expect(seen).toEqual([
      { frame: 1, total: 30 },
      { frame: 30, total: 30 },
    ]);
  });
});

describe("cli · render · resolveAssetSources", () => {
  it("leaves absolute src untouched", () => {
    const comp = {
      assets: [{ id: "a", type: "image", src: "/abs/path.png" }],
    } as unknown as Composition;
    const out = resolveAssetSources(comp, "/project/composition.json");
    expect((out.assets[0] as { src: string }).src).toBe("/abs/path.png");
  });
});

describe("cli · render · RenderError", () => {
  it("carries a code and message", () => {
    const err = new RenderError("E_INPUT_NOT_FOUND", "boom");
    expect(err.code).toBe("E_INPUT_NOT_FOUND");
    expect(err.message).toBe("boom");
    expect(err).toBeInstanceOf(Error);
  });
});

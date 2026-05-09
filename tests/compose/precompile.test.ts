// Tests for the v0.2 pre-compile orchestrator (COMPOSITION_PRIMITIVES.md §10).
// Covers: short-circuit on canonical input, expandBehaviors-only path, the
// $ref + $behavior combined pipeline, and the missing-sourcePath error.

import { describe, expect, it } from "vitest";

import { precompile } from "../../src/compose/index.js";
import type { ReadFile } from "../../src/compose/imports.js";

const ROOT = "/proj/root.json";

function vfs(files: Record<string, unknown>): { read: ReadFile; reads: string[] } {
  const reads: string[] = [];
  const read: ReadFile = async (absPath) => {
    reads.push(absPath);
    if (!(absPath in files)) {
      throw Object.assign(new Error(`ENOENT: ${absPath}`), { code: "ENOENT" });
    }
    return JSON.stringify(files[absPath]);
  };
  return { read, reads };
}

describe("precompile — short-circuit (no v0.2 markers)", () => {
  it("returns the same reference for ref- and behavior-free objects", async () => {
    const comp = {
      version: "0.1",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: [] }],
      items: {},
      tweens: [],
    };
    const out = await precompile(comp);
    expect(out).toBe(comp);
  });

  it("returns scalars unchanged", async () => {
    expect(await precompile(42)).toBe(42);
    expect(await precompile("hi")).toBe("hi");
    expect(await precompile(null)).toBe(null);
  });
});

describe("precompile — expandBehaviors only", () => {
  it("expands $behavior tween blocks without touching $ref machinery", async () => {
    const comp = {
      version: "0.2",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
      items: { s: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [
        {
          $behavior: "fadeIn",
          target: "s",
          start: 0,
          duration: 0.5,
        },
      ],
    };
    // No sourcePath needed — there are no $ref markers.
    const out = (await precompile(comp)) as { tweens: unknown[] };
    expect(out.tweens).toEqual([
      {
        id: "s_fadeIn_0__opacity",
        target: "s",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 0.5,
      },
    ]);
  });
});

describe("precompile — $ref + $behavior together", () => {
  it("resolves imports first, then expands behaviors that landed via $ref", async () => {
    const { read } = vfs({
      "/proj/tweens-intro.json": [
        { $behavior: "fadeIn", target: "title", start: 0.2, duration: 0.4 },
        { $behavior: "fadeOut", target: "title", start: 1.6, duration: 0.4 },
      ],
    });
    const comp = {
      version: "0.2",
      composition: { width: 16, height: 16, fps: 30, duration: 2, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["title"] }],
      items: { title: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [{ $ref: "./tweens-intro.json" }],
    };
    const out = (await precompile(comp, { sourcePath: ROOT, readFile: read })) as {
      tweens: Array<{ id: string; property: string; from: number; to: number }>;
    };
    expect(out.tweens).toHaveLength(2);
    expect(out.tweens[0]?.id).toBe("title_fadeIn_0.2__opacity");
    expect(out.tweens[1]?.id).toBe("title_fadeOut_1.6__opacity");
    expect(out.tweens[0]?.property).toBe("transform.opacity");
  });
});

describe("precompile — error paths", () => {
  it("throws a useful error when $ref is present without sourcePath", async () => {
    await expect(
      precompile({ tweens: [{ $ref: "./x.json" }] }),
    ).rejects.toThrow(/`\$ref` markers but no `sourcePath`/);
  });

  it("does NOT throw when $ref is absent and sourcePath is omitted", async () => {
    await expect(
      precompile({ tweens: [{ $behavior: "fadeIn", target: "x", start: 0, duration: 1 }] }),
    ).resolves.toBeDefined();
  });
});

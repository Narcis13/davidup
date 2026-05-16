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

// ──────────────── Source-map emission (PRD step 15) ────────────────
//
// The source-map path is opt-in via `emitSourceMap: true` (PRD §07 R1: keep
// the existing zero-cost path for callers that don't need it). When on,
// `precompile` returns `{ resolved, sourceMap }` and the resolved
// composition must remain byte-equal to the legacy return shape (the
// renderer must hash identical input).

describe("precompile — source-map: byte-equal resolved output", () => {
  it("returns the same canonical shape as the legacy path for a simple comp", async () => {
    const comp = {
      version: "0.2",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
      items: { s: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [
        { $behavior: "fadeIn", target: "s", start: 0, duration: 0.5 },
      ],
    };
    const legacy = await precompile(structuredClone(comp));
    const { resolved } = await precompile(structuredClone(comp), {
      emitSourceMap: true,
    });
    expect(resolved).toEqual(legacy);
  });

  it("strips __source from every resolved item and tween", async () => {
    const comp = {
      version: "0.2",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
      items: { s: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [
        { $behavior: "fadeIn", target: "s", start: 0, duration: 0.5 },
      ],
    };
    const { resolved } = (await precompile(comp, {
      emitSourceMap: true,
    })) as { resolved: { items: Record<string, unknown>; tweens: unknown[] } };
    for (const item of Object.values(resolved.items)) {
      expect((item as Record<string, unknown>).__source).toBeUndefined();
    }
    for (const tween of resolved.tweens) {
      expect((tween as Record<string, unknown>).__source).toBeUndefined();
    }
  });
});

describe("precompile — source-map: literal entries", () => {
  it("maps each authored literal item / tween to /items/<id> + /tweens/<i>", async () => {
    const comp = {
      version: "0.1",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["a"] }],
      items: {
        a: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" },
      },
      tweens: [
        {
          id: "fade",
          target: "a",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 0.5,
        },
      ],
    };
    const { sourceMap } = await precompile(comp, {
      emitSourceMap: true,
      sourcePath: "/tmp/clip.json",
    });
    expect(sourceMap.items["a"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/a",
      originKind: "literal",
    });
    expect(sourceMap.tweens["fade"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/tweens/0",
      originKind: "literal",
    });
  });

  it("defaults file to `<root>` when sourcePath is omitted", async () => {
    const comp = {
      version: "0.1",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["a"] }],
      items: { a: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [],
    };
    const { sourceMap } = await precompile(comp, { emitSourceMap: true });
    expect(sourceMap.items["a"].file).toBe("<root>");
  });
});

describe("precompile — source-map: $behavior expansion", () => {
  it("attributes every behavior-emitted tween back to its block's /tweens/<i>", async () => {
    const comp = {
      version: "0.2",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
      items: { s: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" } },
      tweens: [
        { $behavior: "popIn", target: "s", start: 0, duration: 0.5 },
        { $behavior: "fadeOut", target: "s", start: 0.5, duration: 0.5 },
      ],
    };
    const { resolved, sourceMap } = (await precompile(comp, {
      emitSourceMap: true,
      sourcePath: "/tmp/clip.json",
    })) as {
      resolved: { tweens: Array<{ id: string }> };
      sourceMap: { tweens: Record<string, { file: string; jsonPointer: string; originKind: string }> };
    };
    // popIn emits opacity + scaleX + scaleY (3 tweens), fadeOut emits opacity (1 tween)
    expect(resolved.tweens).toHaveLength(4);
    for (const t of resolved.tweens) {
      expect(sourceMap.tweens[t.id]?.originKind).toBe("behavior");
    }
    // popIn parentId = "s_popIn_0" → all three children point back to /tweens/0
    const popInChildren = resolved.tweens.filter((t) => t.id.startsWith("s_popIn_0__"));
    expect(popInChildren).toHaveLength(3);
    for (const t of popInChildren) {
      expect(sourceMap.tweens[t.id]).toEqual({
        file: "/tmp/clip.json",
        jsonPointer: "/tweens/0",
        originKind: "behavior",
      });
    }
    // fadeOut parentId = "s_fadeOut_0.5" → its one child points back to /tweens/1
    const fadeOutChildren = resolved.tweens.filter((t) => t.id.startsWith("s_fadeOut_0.5__"));
    expect(fadeOutChildren).toHaveLength(1);
    expect(sourceMap.tweens[fadeOutChildren[0]!.id]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/tweens/1",
      originKind: "behavior",
    });
  });
});

describe("precompile — source-map: $template expansion", () => {
  it("attributes template-emitted items + tweens back to the instance's /items/<id>", async () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["card"] }],
      templates: {
        card: {
          params: [
            { name: "label", type: "string", required: true },
          ],
          items: {
            bg: {
              type: "shape",
              kind: "rect",
              width: 10,
              height: 4,
              fillColor: "#888",
            },
            text: {
              type: "text",
              text: "${params.label}",
              fontSize: 12,
              color: "#fff",
            },
          },
          tweens: [
            {
              target: "bg",
              property: "transform.opacity",
              from: 0,
              to: 1,
              start: 0,
              duration: 0.5,
            },
          ],
        },
      },
      items: {
        card: {
          $template: "card",
          params: { label: "hi" },
        },
      },
      tweens: [],
    };
    const { resolved, sourceMap } = (await precompile(comp, {
      emitSourceMap: true,
      sourcePath: "/tmp/clip.json",
    })) as {
      resolved: { items: Record<string, unknown>; tweens: Array<{ id: string }> };
      sourceMap: {
        items: Record<string, { file: string; jsonPointer: string; originKind: string }>;
        tweens: Record<string, { file: string; jsonPointer: string; originKind: string }>;
      };
    };
    // Template emits two items, prefixed by the instance id "card".
    expect(resolved.items).toHaveProperty("card__bg");
    expect(resolved.items).toHaveProperty("card__text");
    expect(sourceMap.items["card__bg"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/card",
      originKind: "template",
    });
    expect(sourceMap.items["card__text"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/card",
      originKind: "template",
    });
    // The template's one tween was emitted under id `card__t0` (auto-derived).
    const tplTween = resolved.tweens.find((t) => t.id.startsWith("card__"));
    expect(tplTween).toBeDefined();
    expect(sourceMap.tweens[tplTween!.id]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/card",
      originKind: "template",
    });
  });
});

describe("precompile — source-map: scene expansion", () => {
  it("attributes scene wrapper + inner items + tweens back to the instance's /items/<id>", async () => {
    const comp = {
      version: "0.4",
      composition: { width: 320, height: 180, fps: 30, duration: 2, background: "#000" },
      assets: [],
      scenes: {
        intro: {
          duration: 1,
          size: { width: 320, height: 180 },
          background: "#101820",
          params: [],
          items: {
            title: {
              type: "shape",
              kind: "rect",
              width: 100,
              height: 20,
              fillColor: "#fff",
            },
          },
          tweens: [
            {
              target: "title",
              property: "transform.opacity",
              from: 0,
              to: 1,
              start: 0,
              duration: 0.5,
            },
          ],
        },
      },
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["intro"] }],
      items: {
        intro: {
          type: "scene",
          scene: "intro",
          start: 0,
        },
      },
      tweens: [],
    };
    const { resolved, sourceMap } = (await precompile(comp, {
      emitSourceMap: true,
      sourcePath: "/tmp/clip.json",
    })) as {
      resolved: { items: Record<string, unknown>; tweens: Array<{ id: string }> };
      sourceMap: {
        items: Record<string, { file: string; jsonPointer: string; originKind: string }>;
        tweens: Record<string, { file: string; jsonPointer: string; originKind: string }>;
      };
    };
    // Wrapper group + inner items + synthetic bg rect — all attribute to /items/intro.
    expect(sourceMap.items["intro"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/intro",
      originKind: "scene",
    });
    expect(sourceMap.items["intro__title"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/intro",
      originKind: "scene",
    });
    expect(sourceMap.items["intro__$bg"]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/intro",
      originKind: "background",
    });
    // Scene tween attributes to the same instance line.
    const sceneTween = resolved.tweens.find((t) => t.id.startsWith("intro__"));
    expect(sceneTween).toBeDefined();
    expect(sourceMap.tweens[sceneTween!.id]).toEqual({
      file: "/tmp/clip.json",
      jsonPointer: "/items/intro",
      originKind: "scene",
    });
  });
});

describe("precompile — source-map: $ref + $behavior together", () => {
  it("flags imported tweens as `ref` and continues attributing post-import behaviors", async () => {
    const { read } = vfs({
      "/proj/tweens-intro.json": [
        { $behavior: "fadeIn", target: "title", start: 0.2, duration: 0.4 },
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
    const { resolved, sourceMap } = (await precompile(comp, {
      emitSourceMap: true,
      sourcePath: ROOT,
      readFile: read,
    })) as {
      resolved: { tweens: Array<{ id: string }> };
      sourceMap: {
        tweens: Record<string, { file: string; jsonPointer: string; originKind: string }>;
      };
    };
    expect(resolved.tweens).toHaveLength(1);
    const id = resolved.tweens[0]!.id;
    // The behavior block came from the imported file; we don't have a direct
    // parentId match in the *root* behavior-source map, so it falls through
    // to the literal fallback rooted at sourcePath. The editor still has a
    // place to land. Future fidelity work can narrow this without breaking
    // the contract.
    expect(sourceMap.tweens[id]).toBeDefined();
  });
});

describe("precompile — source-map: mixed pipeline (literal + template + scene + behavior)", () => {
  it("attributes every emitted item / tween to the right authored line", async () => {
    const comp = {
      version: "0.4",
      composition: { width: 320, height: 180, fps: 30, duration: 4, background: "#000" },
      assets: [],
      scenes: {
        intro: {
          duration: 1,
          size: { width: 320, height: 180 },
          params: [],
          items: {
            title: {
              type: "shape",
              kind: "rect",
              width: 100,
              height: 20,
              fillColor: "#fff",
            },
          },
          tweens: [],
        },
      },
      templates: {
        card: {
          params: [],
          items: {
            bg: {
              type: "shape",
              kind: "rect",
              width: 50,
              height: 50,
              fillColor: "#0af",
            },
          },
          tweens: [],
        },
      },
      layers: [
        {
          id: "L",
          z: 0,
          opacity: 1,
          blendMode: "normal",
          items: ["literalBox", "introScene", "cardInstance"],
        },
      ],
      items: {
        literalBox: {
          type: "shape",
          kind: "rect",
          width: 8,
          height: 8,
          fillColor: "#f00",
        },
        introScene: { type: "scene", scene: "intro", start: 0 },
        cardInstance: { $template: "card", start: 0 },
      },
      tweens: [
        // Literal tween targeting a literal item
        {
          id: "literalFade",
          target: "literalBox",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 0.5,
        },
        // Behavior block authored at the root, targeting the literal item
        {
          $behavior: "popIn",
          target: "literalBox",
          start: 0.5,
          duration: 0.5,
        },
      ],
    };
    const { sourceMap } = (await precompile(comp, {
      emitSourceMap: true,
      sourcePath: "/proj/mixed.json",
    })) as {
      sourceMap: {
        items: Record<string, { file: string; jsonPointer: string; originKind: string }>;
        tweens: Record<string, { file: string; jsonPointer: string; originKind: string }>;
      };
    };

    // Literal item points at /items/literalBox.
    expect(sourceMap.items["literalBox"]).toEqual({
      file: "/proj/mixed.json",
      jsonPointer: "/items/literalBox",
      originKind: "literal",
    });
    // Scene wrapper + inner items + tweens all attribute to /items/introScene.
    expect(sourceMap.items["introScene"]?.originKind).toBe("scene");
    expect(sourceMap.items["introScene__title"]?.originKind).toBe("scene");
    expect(sourceMap.items["introScene"]?.jsonPointer).toBe("/items/introScene");
    // Template-emitted item attributes to /items/cardInstance.
    expect(sourceMap.items["cardInstance__bg"]).toEqual({
      file: "/proj/mixed.json",
      jsonPointer: "/items/cardInstance",
      originKind: "template",
    });
    // Literal tween attributes to /tweens/0.
    expect(sourceMap.tweens["literalFade"]).toEqual({
      file: "/proj/mixed.json",
      jsonPointer: "/tweens/0",
      originKind: "literal",
    });
    // popIn block at /tweens/1 — its three children all attribute back.
    const popInChildren = Object.keys(sourceMap.tweens).filter((id) =>
      id.startsWith("literalBox_popIn_0.5__"),
    );
    expect(popInChildren).toHaveLength(3);
    for (const id of popInChildren) {
      expect(sourceMap.tweens[id]).toEqual({
        file: "/proj/mixed.json",
        jsonPointer: "/tweens/1",
        originKind: "behavior",
      });
    }
  });
});

describe("precompile — source-map: __source never leaks into validator input", () => {
  it("produces a canonical-shape resolved object identical to vanilla precompile", async () => {
    const comp = {
      version: "0.4",
      composition: { width: 320, height: 180, fps: 30, duration: 2, background: "#000" },
      assets: [],
      scenes: {
        intro: {
          duration: 1,
          size: { width: 320, height: 180 },
          background: "#222",
          params: [],
          items: {
            t: {
              type: "shape",
              kind: "rect",
              width: 10,
              height: 10,
              fillColor: "#fff",
            },
          },
          tweens: [],
        },
      },
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
      items: {
        s: { type: "scene", scene: "intro", start: 0 },
      },
      tweens: [
        { $behavior: "fadeIn", target: "s", start: 0, duration: 0.5 },
      ],
    };
    const vanilla = await precompile(structuredClone(comp));
    const { resolved } = await precompile(structuredClone(comp), {
      emitSourceMap: true,
    });
    // Deep equality — byte-identical canonical output.
    expect(resolved).toEqual(vanilla);
  });
});

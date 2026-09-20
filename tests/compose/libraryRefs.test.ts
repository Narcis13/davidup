// Tests for `global:` template / behavior references (L-1) and the
// composition-scoped `behaviors{}` block they share a compile with.
//
// The library is a directory on disk, so every test here points
// `libraryRoot` at a fixture directory (or hands in a virtual reader) rather
// than touching the real `~/.davidup/library`.

import { describe, expect, it } from "vitest";

import { expandBehaviors } from "../../src/compose/behaviors.js";
import type { ReadFile } from "../../src/compose/imports.js";
import { resolveLibraryRefs } from "../../src/compose/libraryRefs.js";
import { precompile } from "../../src/compose/index.js";
import { MCPToolError } from "../../src/mcp/errors.js";

const LIB = "/lib";

/** Virtual library reader; keys are absolute paths under {@link LIB}. */
function vlib(files: Record<string, unknown>): { read: ReadFile; reads: string[] } {
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

const CTA_BUTTON = {
  id: "ctaButton",
  description: "Pill with a label.",
  params: [
    { name: "label", type: "string", required: true },
    { name: "x", type: "number", default: 100 },
  ],
  items: {
    pill: {
      type: "shape",
      kind: "rect",
      width: 200,
      height: 80,
      fillColor: "#ffffff",
      transform: { x: "${params.x}", y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    },
  },
  tweens: [
    {
      id: "in",
      target: "pill",
      property: "transform.opacity",
      from: 0,
      to: 1,
      start: 0,
      duration: 0.3,
    },
  ],
};

const NEON_FLICKER = {
  name: "neonFlicker",
  description: "Two hard opacity flashes settling on 1.",
  params: [{ name: "low", type: "number", default: 0.2 }],
  tweens: [
    {
      property: "transform.opacity",
      from: "${params.low}",
      to: 1,
      duration: 0.1,
      suffix: "f0",
    },
    {
      property: "transform.opacity",
      from: 1,
      to: 1,
      start: "${$.start + 0.1}",
      suffix: "f1",
    },
  ],
};

function baseComp(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 64, height: 64, fps: 30, duration: 2, background: "#000000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: [] }],
    items: {},
    tweens: [],
    ...extra,
  };
}

describe("resolveLibraryRefs — collection and injection", () => {
  it("returns the same reference when nothing uses `global:`", async () => {
    const comp = baseComp({ items: { a: { $template: "titleCard" } } });
    const { read } = vlib({});
    expect(await resolveLibraryRefs(comp, { readFile: read, libraryRoot: LIB })).toBe(comp);
  });

  it("loads a `global:` template under its prefixed key", async () => {
    const { read, reads } = vlib({
      "/lib/templates/ctaButton.template.json": CTA_BUTTON,
    });
    const out = (await resolveLibraryRefs(
      baseComp({ items: { follow: { $template: "global:ctaButton", params: { label: "Follow" } } } }),
      { readFile: read, libraryRoot: LIB },
    )) as { templates: Record<string, unknown> };
    expect(reads).toEqual(["/lib/templates/ctaButton.template.json"]);
    expect(Object.keys(out.templates)).toEqual(["global:ctaButton"]);
  });

  it("loads a `global:` behavior from behaviors/<name>.behavior.json", async () => {
    const { read, reads } = vlib({
      "/lib/behaviors/neonFlicker.behavior.json": NEON_FLICKER,
    });
    const out = (await resolveLibraryRefs(
      baseComp({
        tweens: [{ $behavior: "global:neonFlicker", target: "a", start: 0, duration: 0.2 }],
      }),
      { readFile: read, libraryRoot: LIB },
    )) as { behaviors: Record<string, unknown> };
    expect(reads).toEqual(["/lib/behaviors/neonFlicker.behavior.json"]);
    expect(Object.keys(out.behaviors)).toEqual(["global:neonFlicker"]);
  });

  it("reads each distinct reference once, wherever it appears", async () => {
    const { read, reads } = vlib({
      "/lib/templates/ctaButton.template.json": CTA_BUTTON,
    });
    await resolveLibraryRefs(
      baseComp({
        items: {
          a: { $template: "global:ctaButton", params: { label: "A" } },
          b: { $template: "global:ctaButton", params: { label: "B" } },
        },
        scenes: {
          s: { duration: 1, items: { c: { $template: "global:ctaButton" } }, tweens: [] },
        },
      }),
      { readFile: read, libraryRoot: LIB },
    );
    expect(reads).toEqual(["/lib/templates/ctaButton.template.json"]);
  });

  it("follows references inside a loaded definition (transitive)", async () => {
    const { read, reads } = vlib({
      "/lib/templates/outer.template.json": {
        id: "outer",
        params: [],
        items: { inner: { $template: "global:ctaButton", params: { label: "x" } } },
        tweens: [{ $behavior: "global:neonFlicker", target: "inner", start: 0, duration: 0.2 }],
      },
      "/lib/templates/ctaButton.template.json": CTA_BUTTON,
      "/lib/behaviors/neonFlicker.behavior.json": NEON_FLICKER,
    });
    const out = (await resolveLibraryRefs(
      baseComp({ items: { o: { $template: "global:outer" } } }),
      { readFile: read, libraryRoot: LIB },
    )) as { templates: Record<string, unknown>; behaviors: Record<string, unknown> };
    expect(reads.sort()).toEqual([
      "/lib/behaviors/neonFlicker.behavior.json",
      "/lib/templates/ctaButton.template.json",
      "/lib/templates/outer.template.json",
    ]);
    expect(Object.keys(out.templates).sort()).toEqual(["global:ctaButton", "global:outer"]);
    expect(Object.keys(out.behaviors)).toEqual(["global:neonFlicker"]);
  });

  it("an authored key of the same name shadows the library file", async () => {
    const { read, reads } = vlib({
      "/lib/templates/ctaButton.template.json": CTA_BUTTON,
    });
    const pinned = { id: "pinned", params: [], items: {}, tweens: [] };
    const out = (await resolveLibraryRefs(
      baseComp({
        items: { follow: { $template: "global:ctaButton" } },
        templates: { "global:ctaButton": pinned },
      }),
      { readFile: read, libraryRoot: LIB },
    )) as { templates: Record<string, unknown> };
    // The file is still read (the walk can't know the key exists until after
    // the scan), but the authored definition wins.
    expect(reads).toEqual(["/lib/templates/ctaButton.template.json"]);
    expect(out.templates["global:ctaButton"]).toBe(pinned);
  });

  it("keeps the authored templates that don't collide", async () => {
    const { read } = vlib({ "/lib/templates/ctaButton.template.json": CTA_BUTTON });
    const mine = { id: "mine", params: [], items: {}, tweens: [] };
    const out = (await resolveLibraryRefs(
      baseComp({
        items: { follow: { $template: "global:ctaButton" } },
        templates: { mine },
      }),
      { readFile: read, libraryRoot: LIB },
    )) as { templates: Record<string, unknown> };
    expect(Object.keys(out.templates).sort()).toEqual(["global:ctaButton", "mine"]);
  });
});

describe("resolveLibraryRefs — errors", () => {
  it("E_TEMPLATE_UNKNOWN names the path it looked for", async () => {
    const { read } = vlib({});
    await expect(
      resolveLibraryRefs(baseComp({ items: { a: { $template: "global:nope" } } }), {
        readFile: read,
        libraryRoot: LIB,
      }),
    ).rejects.toMatchObject({
      code: "E_TEMPLATE_UNKNOWN",
      message: expect.stringContaining("/lib/templates/nope.template.json"),
    });
  });

  it("E_BEHAVIOR_UNKNOWN for a missing behavior card", async () => {
    const { read } = vlib({});
    await expect(
      resolveLibraryRefs(
        baseComp({ tweens: [{ $behavior: "global:nope", target: "a", start: 0, duration: 1 }] }),
        { readFile: read, libraryRoot: LIB },
      ),
    ).rejects.toMatchObject({ code: "E_BEHAVIOR_UNKNOWN" });
  });

  it("rejects a reference that would climb out of the library root", async () => {
    const { read } = vlib({});
    for (const name of ["global:../../etc/passwd", "global:sub/dir", "global:"]) {
      await expect(
        resolveLibraryRefs(baseComp({ items: { a: { $template: name } } }), {
          readFile: read,
          libraryRoot: LIB,
        }),
      ).rejects.toMatchObject({ code: "E_INVALID_VALUE" });
    }
  });

  it("E_INVALID_VALUE for a library file that isn't a JSON object", async () => {
    const read: ReadFile = async () => "[1, 2, 3]";
    await expect(
      resolveLibraryRefs(baseComp({ items: { a: { $template: "global:arr" } } }), {
        readFile: read,
        libraryRoot: LIB,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID_VALUE" });
  });

  it("E_INVALID_VALUE for malformed JSON", async () => {
    const read: ReadFile = async () => "{ not json";
    await expect(
      resolveLibraryRefs(baseComp({ items: { a: { $template: "global:bad" } } }), {
        readFile: read,
        libraryRoot: LIB,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID_VALUE" });
  });
});

describe("resolveLibraryRefs — no Node, no library", () => {
  it("E_FEATURE_UNAVAILABLE names the inline alternative", async () => {
    const versions = process.versions;
    Object.defineProperty(process, "versions", {
      value: { ...versions, node: undefined },
      configurable: true,
    });
    try {
      await expect(
        resolveLibraryRefs(baseComp({ items: { a: { $template: "global:x" } } })),
      ).rejects.toMatchObject({
        code: "E_FEATURE_UNAVAILABLE",
        hint: expect.stringContaining("Inline the definition"),
      });
    } finally {
      Object.defineProperty(process, "versions", { value: versions, configurable: true });
    }
  });
});

describe("composition-scoped behaviors{}", () => {
  const scoped = baseComp({
    behaviors: {
      myFlicker: {
        params: [{ name: "low", type: "number", default: 0.2 }],
        tweens: [
          {
            property: "transform.opacity",
            from: "${params.low}",
            to: 1,
            suffix: "f0",
          },
        ],
      },
    },
    tweens: [{ $behavior: "myFlicker", target: "logo", start: 1, duration: 0.5 }],
  });

  it("expands a behavior the composition defines, and drops the block", () => {
    const out = expandBehaviors(structuredClone(scoped)) as {
      tweens: Array<Record<string, unknown>>;
      behaviors?: unknown;
    };
    expect(out.behaviors).toBeUndefined();
    expect(out.tweens).toEqual([
      {
        id: "logo_myFlicker_1__f0",
        target: "logo",
        property: "transform.opacity",
        from: 0.2,
        to: 1,
        start: 1,
        duration: 0.5,
      },
    ]);
  });

  it("does not leak into the process registry", () => {
    expandBehaviors(structuredClone(scoped));
    expect(() =>
      expandBehaviors(
        baseComp({ tweens: [{ $behavior: "myFlicker", target: "a", start: 0, duration: 1 }] }),
      ),
    ).toThrow(MCPToolError);
  });

  it("drops the block even when no tween uses it", () => {
    const out = expandBehaviors(baseComp({ behaviors: { unused: { tweens: [] } } })) as {
      behaviors?: unknown;
    };
    expect(out.behaviors).toBeUndefined();
  });

  it("wins over a session definition of the same name", () => {
    const out = expandBehaviors(structuredClone(scoped), {
      behaviors: {
        myFlicker: {
          name: "myFlicker",
          description: "",
          params: [],
          produces: "dynamic",
          tweens: [
            { property: "transform.scaleX", from: 0, to: 1, suffix: "s" },
          ],
        },
      },
    }) as { tweens: Array<Record<string, unknown>> };
    expect(out.tweens[0].property).toBe("transform.opacity");
  });

  it("shadows a built-in for this compile only", () => {
    const comp = baseComp({
      behaviors: {
        fadeIn: {
          params: [],
          tweens: [{ property: "transform.opacity", from: 0.5, to: 1, suffix: "in" }],
        },
      },
      tweens: [{ $behavior: "fadeIn", target: "a", start: 0, duration: 1 }],
    });
    const shadowed = expandBehaviors(comp) as { tweens: Array<Record<string, unknown>> };
    expect(shadowed.tweens[0].from).toBe(0.5);
    const plain = expandBehaviors(
      baseComp({ tweens: [{ $behavior: "fadeIn", target: "a", start: 0, duration: 1 }] }),
    ) as { tweens: Array<Record<string, unknown>> };
    expect(plain.tweens[0].from).toBe(0);
  });

  it("rejects a malformed block", () => {
    expect(() => expandBehaviors(baseComp({ behaviors: [] }))).toThrow(/must be an object/);
    expect(() => expandBehaviors(baseComp({ behaviors: { x: 7 } }))).toThrow(/must be an object/);
  });
});

describe("precompile — end to end", () => {
  it("renders a composition that names a library template and behavior", async () => {
    const { read } = vlib({
      "/lib/templates/ctaButton.template.json": CTA_BUTTON,
      "/lib/behaviors/neonFlicker.behavior.json": NEON_FLICKER,
    });
    const out = (await precompile(
      baseComp({
        layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["follow"] }],
        items: {
          follow: { $template: "global:ctaButton", start: 2, params: { label: "Follow", x: 40 } },
        },
        tweens: [
          { $behavior: "global:neonFlicker", target: "follow__pill", start: 0, duration: 0.2 },
        ],
      }),
      { readFile: read, libraryRoot: LIB },
    )) as {
      items: Record<string, Record<string, unknown>>;
      tweens: Array<Record<string, unknown>>;
      layers: Array<{ items: string[] }>;
      templates?: unknown;
      behaviors?: unknown;
    };
    // Compile-time-only blocks are gone; the canonical output is v0.1-shaped.
    expect(out.templates).toBeUndefined();
    expect(out.behaviors).toBeUndefined();
    expect(Object.keys(out.items)).toEqual(["follow__pill"]);
    expect((out.items.follow__pill.transform as { x: number }).x).toBe(40);
    expect(out.layers[0].items).toEqual(["follow__pill"]);
    // Root tweens first (the behavior block, expanded in place), then the
    // template's own, appended by `expandTemplates`.
    expect(out.tweens.map((t) => t.id)).toEqual([
      "follow__pill_global:neonFlicker_0__f0",
      "follow__pill_global:neonFlicker_0__f1",
      "follow__in",
    ]);
  });

  it("a `global:` template used inside a scene resolves too", async () => {
    const { read } = vlib({ "/lib/templates/ctaButton.template.json": CTA_BUTTON });
    const out = (await precompile(
      baseComp({
        layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
        scenes: {
          card: {
            duration: 1,
            items: { btn: { $template: "global:ctaButton", params: { label: "Go" } } },
            tweens: [],
          },
        },
        items: { s: { type: "scene", scene: "card", start: 0 } },
      }),
      { readFile: read, libraryRoot: LIB },
    )) as { items: Record<string, unknown> };
    expect(Object.keys(out.items).sort()).toEqual(["s", "s__btn__pill"]);
  });

  it("attributes library-template items to the instance in the source map", async () => {
    const { read } = vlib({ "/lib/templates/ctaButton.template.json": CTA_BUTTON });
    const { sourceMap } = await precompile(
      baseComp({
        layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["follow"] }],
        items: { follow: { $template: "global:ctaButton", params: { label: "Follow" } } },
      }),
      { readFile: read, libraryRoot: LIB, emitSourceMap: true, sourcePath: "/p/comp.json" },
    );
    expect(sourceMap.items.follow__pill).toEqual({
      file: "/p/comp.json",
      jsonPointer: "/items/follow",
      originKind: "template",
    });
  });
});

// Unit tests for the §8 scene registry — covers param substitution,
// id prefixing (§8.4), time-shifting (§8.5 identity mode), sealed-instance
// enforcement (§8.7), and the asset-merging conflict path (§8.8).

import { describe, expect, it } from "vitest";

import {
  expandSceneInstance,
  expandSceneInstances,
  registerScene,
  unregisterScene,
  type SceneDefinition,
} from "../../src/compose/scenes.js";
import { precompile } from "../../src/compose/precompile.js";
import { MCPToolError } from "../../src/mcp/errors.js";

function makeIntroCard(): SceneDefinition {
  return {
    id: "introCard",
    duration: 4,
    size: { width: 1280, height: 720 },
    background: "#101820",
    params: [
      { name: "title", type: "string", required: true },
      { name: "subtitle", type: "string", default: "" },
      { name: "primary", type: "color", default: "#ff6b35" },
    ],
    assets: [
      { id: "intro-font", type: "font", src: "./Bebas.ttf", family: "Bebas" },
    ],
    items: {
      title: {
        type: "text",
        text: "${params.title}",
        font: "intro-font",
        fontSize: 96,
        color: "${params.primary}",
        transform: {
          x: 100,
          y: 200,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      subtitle: {
        type: "text",
        text: "${params.subtitle}",
        font: "intro-font",
        fontSize: 36,
        color: "#ffffff",
        transform: {
          x: 100,
          y: 320,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        target: "subtitle",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0.5,
        duration: 0.4,
      },
    ],
  };
}

describe("expandSceneInstance — single instance", () => {
  it("prefixes inner item ids and shifts tween starts", () => {
    const def = makeIntroCard();
    const expanded = expandSceneInstance("intro", {
      scene: "introCard",
      params: { title: "Davidup", subtitle: "v0.4 demo" },
      start: 2,
    }, { scenes: { introCard: def } });

    // Items prefixed
    expect(Object.keys(expanded.items).sort()).toEqual([
      "intro__$bg",
      "intro__subtitle",
      "intro__title",
    ]);

    // Param substitution flowed through
    const title = expanded.items["intro__title"] as Record<string, unknown>;
    expect(title.text).toBe("Davidup");
    expect(title.color).toBe("#ff6b35");

    // Tween target prefixed and shifted by start
    const tween = expanded.tweens[0] as Record<string, unknown>;
    expect(tween.target).toBe("intro__subtitle");
    expect(tween.start).toBe(2.5);
    expect(tween.id).toBe("intro__t0");

    // Wrapper group lists direct children only (bg + scene-local items),
    // not the nested-scene-expanded ids.
    const group = expanded.groupItem;
    expect(group.type).toBe("group");
    expect((group as { items: string[] }).items).toEqual([
      "intro__$bg",
      "intro__subtitle",
      "intro__title",
    ]);
  });

  it("rejects missing required params with E_SCENE_PARAM_MISSING", () => {
    const def = makeIntroCard();
    expect(() =>
      expandSceneInstance(
        "intro",
        { scene: "introCard" },
        { scenes: { introCard: def } },
      ),
    ).toThrow(MCPToolError);
    try {
      expandSceneInstance(
        "intro",
        { scene: "introCard" },
        { scenes: { introCard: def } },
      );
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_SCENE_PARAM_MISSING");
    }
  });

  it("rejects wrong param types with E_SCENE_PARAM_TYPE", () => {
    const def = makeIntroCard();
    try {
      expandSceneInstance(
        "intro",
        { scene: "introCard", params: { title: 123 as unknown as string } },
        { scenes: { introCard: def } },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_SCENE_PARAM_TYPE");
    }
  });

  it("rejects unknown scene names with E_SCENE_UNKNOWN", () => {
    try {
      expandSceneInstance("foo", { scene: "doesNotExist" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_SCENE_UNKNOWN");
    }
  });
});

describe("expandSceneInstances — composition pass", () => {
  it("rewrites a `type:scene` item to a synthetic group + inner items + shifted tweens", async () => {
    const def = makeIntroCard();
    const authored = {
      version: "0.2",
      composition: { width: 1280, height: 720, fps: 30, duration: 5, background: "#000" },
      assets: [],
      scenes: { introCard: def },
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["intro"] }],
      items: {
        intro: {
          type: "scene",
          scene: "introCard",
          params: { title: "Hello", subtitle: "world" },
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0,
            anchorY: 0,
            opacity: 1,
          },
        },
      },
      tweens: [
        {
          id: "fade",
          target: "intro",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 0.4,
        },
      ],
    };

    const compiled = (await precompile(authored)) as {
      scenes?: unknown;
      assets: Array<{ id: string }>;
      items: Record<string, unknown>;
      layers: Array<{ id: string; items: string[] }>;
      tweens: Array<{ id: string; target: string }>;
    };

    expect(compiled.scenes).toBeUndefined();
    expect(compiled.assets.find((a) => a.id === "intro-font")).toBeDefined();

    // Wrapper still under "intro"; layer reference unchanged.
    expect(compiled.items["intro"]).toBeDefined();
    expect((compiled.items["intro"] as { type: string }).type).toBe("group");
    expect(compiled.layers[0]?.items).toEqual(["intro"]);

    // Inner items are prefixed and present in items map.
    expect(compiled.items["intro__title"]).toBeDefined();
    expect(compiled.items["intro__subtitle"]).toBeDefined();
    expect(compiled.items["intro__$bg"]).toBeDefined();

    // The parent's own tween is preserved; the scene's internal tween is appended.
    const sceneTween = compiled.tweens.find((t) => t.target === "intro__subtitle");
    expect(sceneTween).toBeDefined();
    const parentTween = compiled.tweens.find((t) => t.id === "fade");
    expect(parentTween?.target).toBe("intro");
  });

  it("rejects parent tweens that target scene-internal expanded ids (sealed instance)", async () => {
    const def = makeIntroCard();
    const authored = {
      version: "0.2",
      composition: { width: 1280, height: 720, fps: 30, duration: 5, background: "#000" },
      assets: [],
      scenes: { introCard: def },
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["intro"] }],
      items: {
        intro: {
          type: "scene",
          scene: "introCard",
          params: { title: "A" },
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1,
          },
        },
      },
      tweens: [
        {
          id: "deep",
          target: "intro__title",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 0.4,
        },
      ],
    };

    await expect(precompile(authored)).rejects.toThrow(MCPToolError);
    try {
      await precompile(authored);
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_SCENE_INSTANCE_DEEP_TARGET");
    }
  });

  it("merges duplicate-but-equivalent assets and rejects conflicts on different src", async () => {
    const sceneA: SceneDefinition = {
      id: "sceneA",
      duration: 1,
      params: [],
      assets: [{ id: "shared-font", type: "font", src: "./fonts/A.ttf", family: "A" }],
      items: {},
      tweens: [],
    };
    const ok = {
      version: "0.2",
      composition: { width: 100, height: 100, fps: 30, duration: 1, background: "#000" },
      assets: [{ id: "shared-font", type: "font", src: "./fonts/A.ttf", family: "A" }],
      scenes: { sceneA },
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["a"] }],
      items: {
        a: {
          type: "scene",
          scene: "sceneA",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
        },
      },
      tweens: [],
    };
    const compiled = (await precompile(ok)) as { assets: Array<{ id: string }> };
    // Equivalent dedup → still just one asset.
    expect(compiled.assets.filter((a) => a.id === "shared-font").length).toBe(1);

    const conflicting = {
      ...ok,
      assets: [{ id: "shared-font", type: "font", src: "./fonts/OTHER.ttf", family: "Other" }],
    };
    await expect(precompile(conflicting)).rejects.toThrow(MCPToolError);
    try {
      await precompile(conflicting);
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_ASSET_CONFLICT");
    }
  });

  it("detects scene-instance recursion", async () => {
    const recursive: SceneDefinition = {
      id: "loop",
      duration: 1,
      params: [],
      assets: [],
      items: {
        nested: {
          type: "scene",
          scene: "loop",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
        },
      },
      tweens: [],
    };
    const authored = {
      version: "0.2",
      composition: { width: 100, height: 100, fps: 30, duration: 1, background: "#000" },
      assets: [],
      scenes: { loop: recursive },
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["root"] }],
      items: {
        root: {
          type: "scene",
          scene: "loop",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
        },
      },
      tweens: [],
    };
    await expect(precompile(authored)).rejects.toThrow(MCPToolError);
    try {
      await precompile(authored);
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_SCENE_RECURSION");
    }
  });
});

describe("registerScene / unregisterScene global registry", () => {
  it("exposes registered scenes to expandSceneInstance without `options.scenes`", () => {
    registerScene({
      id: "tinyScene",
      duration: 1,
      params: [],
      assets: [],
      items: {},
      tweens: [],
    });
    const expanded = expandSceneInstance("x", { scene: "tinyScene" });
    expect(expanded.groupItem.type).toBe("group");
    unregisterScene("tinyScene");
  });
});

// ──────────────── §6.5 Templates inside scene definitions ────────────────

describe("expandTemplates — scene-internal $template instances", () => {
  // Local copy of lowerThird so the test doesn't depend on which built-ins
  // happen to ship in the registry today.
  const lowerThird = {
    id: "lowerThird",
    params: [
      { name: "name", type: "string", required: true },
      { name: "role", type: "string", required: true },
      { name: "color", type: "color", default: "#ffd166" },
      { name: "fontDisplay", type: "string", required: true },
      { name: "fontMono", type: "string", required: true },
    ],
    items: {
      bar: {
        type: "shape",
        kind: "rect",
        width: 0,
        height: 6,
        fillColor: "${params.color}",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 1,
        },
      },
      name: {
        type: "text",
        text: "${params.name}",
        font: "${params.fontDisplay}",
        fontSize: 64,
        color: "#ffffff",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 0,
        },
      },
      role: {
        type: "text",
        text: "${params.role}",
        font: "${params.fontMono}",
        fontSize: 24,
        color: "${params.color}",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 0,
        },
      },
    },
    tweens: [
      { $behavior: "fadeIn", target: "name", start: 0.0, duration: 0.4 },
      { $behavior: "fadeIn", target: "role", start: 0.2, duration: 0.4 },
      {
        target: "bar",
        property: "width",
        from: 0,
        to: 360,
        start: 0.0,
        duration: 0.6,
      },
    ],
  };

  function authored(extra?: Record<string, unknown>) {
    return {
      version: "0.4",
      composition: { width: 1280, height: 720, fps: 30, duration: 10, background: "#000" },
      assets: [
        { id: "intro-font", type: "font", src: "./Bebas.ttf", family: "Bebas" },
      ],
      templates: { lowerThird },
      scenes: {
        introCard: {
          id: "introCard",
          duration: 4,
          size: { width: 1280, height: 720 },
          params: [
            { name: "accent", type: "color", default: "#ff6b35" },
          ],
          assets: [],
          items: {
            lower: {
              $template: "lowerThird",
              params: {
                name: "Davidup",
                role: "Demo",
                color: "${params.accent}",
                fontDisplay: "intro-font",
                fontMono: "intro-font",
              },
            },
          },
          tweens: [],
          ...(extra ?? {}),
        },
      },
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["intro"] }],
      items: {
        intro: {
          type: "scene",
          scene: "introCard",
          params: { accent: "#00ffaa" },
          start: 2,
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 1,
          },
        },
      },
      tweens: [],
    };
  }

  it("lowers scene-internal $template into triple-prefixed ids and shifted tweens", async () => {
    const compiled = (await precompile(authored())) as {
      scenes?: unknown;
      templates?: unknown;
      items: Record<string, Record<string, unknown>>;
      tweens: Array<Record<string, unknown>>;
    };

    // Compile-time-only keys are stripped.
    expect(compiled.scenes).toBeUndefined();
    expect(compiled.templates).toBeUndefined();

    // Wrapper group lives under the scene-instance id.
    expect(compiled.items["intro"]).toBeDefined();
    expect(compiled.items["intro"].type).toBe("group");

    // Triple-prefix ids materialise: ${sceneInstance}__${templateInstanceKey}__${localId}.
    expect(compiled.items["intro__lower__bar"]).toBeDefined();
    expect(compiled.items["intro__lower__name"]).toBeDefined();
    expect(compiled.items["intro__lower__role"]).toBeDefined();

    // The placeholder key `lower` does NOT remain in the items map.
    expect(compiled.items["intro__lower"]).toBeUndefined();

    // The wrapper group lists the expanded children (template items),
    // not the lifted-away `lower` placeholder.
    const group = compiled.items["intro"] as { items: string[] };
    expect(group.items).toEqual(
      expect.arrayContaining([
        "intro__lower__bar",
        "intro__lower__name",
        "intro__lower__role",
      ]),
    );
    expect(group.items).not.toContain("intro__lower");

    // The literal template tween (`bar.width 0→360`) survived with global start.
    // Template-local start = 0, scene-internal expansion shifts by template
    // instance start (0) → scene-local 0, then scene instance start = 2 →
    // global 2.
    const barTween = compiled.tweens.find(
      (t) => t.target === "intro__lower__bar" && t.property === "width",
    );
    expect(barTween).toBeDefined();
    expect(barTween!.start).toBeCloseTo(2.0, 10);

    // Behavior tween targets resolved through both expansion stages.
    // Behaviors are lowered by expandBehaviors → fadeIn produces a single
    // `transform.opacity` tween targeting `intro__lower__name`.
    const fadeNameTween = compiled.tweens.find(
      (t) =>
        t.target === "intro__lower__name" &&
        t.property === "transform.opacity",
    );
    expect(fadeNameTween).toBeDefined();
    expect(fadeNameTween!.start).toBeCloseTo(2.0, 10);

    // The second fadeIn is offset by template-local 0.2, then by scene start 2.
    const fadeRoleTween = compiled.tweens.find(
      (t) =>
        t.target === "intro__lower__role" &&
        t.property === "transform.opacity",
    );
    expect(fadeRoleTween).toBeDefined();
    expect(fadeRoleTween!.start).toBeCloseTo(2.2, 10);

    // No $behavior markers remain after the full pipeline.
    expect(
      compiled.tweens.every((t) => typeof t.$behavior !== "string"),
    ).toBe(true);
  });

  it("template params can reference scene params via ${params.X}", async () => {
    const compiled = (await precompile(authored())) as {
      items: Record<string, Record<string, unknown>>;
    };
    // `color: "${params.accent}"` on the template instance flows through
    // template expansion as a still-unresolved placeholder, then resolves at
    // scene expansion to the scene-instance's accent value.
    const bar = compiled.items["intro__lower__bar"];
    expect(bar.fillColor).toBe("#00ffaa");
    const role = compiled.items["intro__lower__role"];
    expect(role.color).toBe("#00ffaa");
  });

  it("rejects an unknown template name with E_TEMPLATE_UNKNOWN", async () => {
    const broken = authored();
    broken.scenes.introCard.items.lower = {
      $template: "does-not-exist",
      params: {},
    };
    try {
      await precompile(broken);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TEMPLATE_UNKNOWN");
    }
  });

  it("rejects an id collision between a scene literal and a template-expanded id", async () => {
    const broken = authored();
    // Hand-craft a collision: a literal scene item with the same id the
    // template instance is going to emit.
    broken.scenes.introCard.items["lower__bar"] = {
      type: "shape",
      kind: "rect",
      width: 1,
      height: 1,
      transform: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        anchorX: 0, anchorY: 0, opacity: 1,
      },
    };
    try {
      await precompile(broken);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_DUPLICATE_ID");
      // Error message names the scene id so authors can locate the conflict.
      expect((err as MCPToolError).message).toContain("introCard");
    }
  });

  it("two scenes referencing the same template instance key produce distinct ids", async () => {
    const a = authored();
    a.scenes.sceneB = JSON.parse(JSON.stringify(a.scenes.introCard));
    a.scenes.sceneB.id = "sceneB";
    a.layers[0].items = ["intro", "introB"];
    a.items.introB = {
      type: "scene",
      scene: "sceneB",
      params: { accent: "#ff0000" },
      start: 6,
      transform: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        anchorX: 0, anchorY: 0, opacity: 1,
      },
    };

    const compiled = (await precompile(a)) as {
      items: Record<string, Record<string, unknown>>;
    };
    // Each scene instance prefixes the expanded ids — no collision possible.
    expect(compiled.items["intro__lower__bar"]).toBeDefined();
    expect(compiled.items["introB__lower__bar"]).toBeDefined();
    expect(compiled.items["intro__lower__bar"]).not.toBe(
      compiled.items["introB__lower__bar"],
    );
  });

  it("scene definitions without $template instances short-circuit", async () => {
    const plain = authored();
    // Replace the template instance with a literal text item, so no scene
    // template instances remain.
    delete plain.scenes.introCard.items.lower;
    plain.scenes.introCard.items.headline = {
      type: "text",
      text: "Hi",
      font: "intro-font",
      fontSize: 64,
      color: "#fff",
      transform: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        anchorX: 0, anchorY: 0, opacity: 1,
      },
    };
    // `templates` key is still present but unused — should still strip cleanly
    // and produce valid output.
    const compiled = (await precompile(plain)) as {
      templates?: unknown;
      items: Record<string, unknown>;
    };
    expect(compiled.templates).toBeUndefined();
    expect(compiled.items["intro__headline"]).toBeDefined();
  });

  it("regression: root-level $template still expands when scenes also contain templates", async () => {
    const mixed = authored();
    // Add a root-level template instance alongside the scene-internal one.
    mixed.items.rootLT = {
      $template: "lowerThird",
      layerId: "main",
      params: {
        name: "Root",
        role: "Banner",
        fontDisplay: "intro-font",
        fontMono: "intro-font",
      },
    };
    const compiled = (await precompile(mixed)) as {
      items: Record<string, unknown>;
      tweens: Array<Record<string, unknown>>;
    };
    // Root-level expansion produces `rootLT__bar/name/role` directly.
    expect(compiled.items["rootLT__bar"]).toBeDefined();
    expect(compiled.items["rootLT__name"]).toBeDefined();
    expect(compiled.items["rootLT__role"]).toBeDefined();
    // Scene-internal expansion still produced the triple-prefix ids.
    expect(compiled.items["intro__lower__bar"]).toBeDefined();
    expect(compiled.items["intro__lower__name"]).toBeDefined();
    expect(compiled.items["intro__lower__role"]).toBeDefined();
  });
});

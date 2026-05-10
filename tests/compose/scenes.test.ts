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

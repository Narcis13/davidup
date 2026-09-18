// End-to-end tests for the §8.9 MCP scene tools: `define_scene`,
// `add_scene_instance`, `update_scene_instance`, `remove_scene_instance`,
// `list_scenes`, `remove_scene`. Drives the dispatcher directly (no transport
// spawn).

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { unregisterScene } from "../../src/compose/scenes.js";
import { computeStateAt } from "../../src/engine/resolver.js";
import type { Composition } from "../../src/schema/types.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function setup(): Promise<{ deps: ToolDeps }> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await dispatchTool(
    getTool("create_composition"),
    { width: 1280, height: 720, fps: 30, duration: 30 },
    deps,
  );
  await dispatchTool(getTool("add_layer"), { z: 0, id: "main" }, deps);
  return { deps };
}

const titleSceneArgs = {
  id: "titleScene",
  duration: 4,
  size: { width: 1280, height: 720 },
  background: "#101820",
  params: [
    { name: "title", type: "string", required: true },
    { name: "color", type: "color", default: "#ff6b35" },
  ],
  assets: [
    { id: "title-font", type: "font", src: "./Bebas.ttf", family: "Bebas" },
  ],
  items: {
    headline: {
      type: "text",
      text: "${params.title}",
      font: "title-font",
      fontSize: 96,
      color: "${params.color}",
      transform: {
        x: 100, y: 200, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1,
      },
    },
  },
  tweens: [
    {
      target: "headline",
      property: "transform.opacity",
      from: 0,
      to: 1,
      start: 0,
      duration: 0.5,
    },
  ],
};

describe("define_scene + list_scenes", () => {
  it("registers a scene and surfaces it via list_scenes", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    expect(out.ok).toBe(true);

    const list = await dispatchTool(getTool("list_scenes"), {}, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const body = list.result as {
      scenes: Array<{ id: string; emits: string[]; assets: string[] }>;
    };
    const found = body.scenes.find((s) => s.id === "titleScene");
    expect(found).toBeDefined();
    expect(found?.emits).toEqual(["headline"]);
    expect(found?.assets).toEqual(["title-font"]);
    unregisterScene("titleScene");
  });
});

describe("add_scene_instance", () => {
  it("places a scene as a synthetic group + prefixed items + shifted tweens", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);

    const out = await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "intro",
        start: 2,
        params: { title: "Davidup" },
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as {
      instanceId: string;
      items: string[];
      tweens: string[];
      assets: string[];
    };
    expect(body.instanceId).toBe("intro");
    expect(body.items).toContain("intro");
    expect(body.items).toContain("intro__headline");
    expect(body.items).toContain("intro__$bg");
    expect(body.assets).toContain("title-font");

    // Verify the tween got shifted by start=2.
    const list = await dispatchTool(
      getTool("list_tweens"),
      { target: "intro__headline" },
      deps,
    );
    if (!list.ok) throw new Error("list_tweens failed");
    const tweens = (list.result as { tweens: Array<{ start: number }> }).tweens;
    expect(tweens.length).toBe(1);
    expect(tweens[0]?.start).toBe(2);

    // Composition should validate (assets merged, items/groups consistent).
    const valid = await dispatchTool(getTool("validate"), {}, deps);
    if (!valid.ok) throw new Error("validate failed");
    expect((valid.result as { valid: boolean }).valid).toBe(true);
    unregisterScene("titleScene");
  });

  it("rolls back on a per-instance asset conflict", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);

    // Pre-register a font under the same id but with a different src — this
    // forces the per-instance asset conflict path.
    await dispatchTool(
      getTool("register_asset"),
      { id: "title-font", type: "font", src: "./Other.ttf", family: "Other" },
      deps,
    );

    const out = await dispatchTool(
      getTool("add_scene_instance"),
      { sceneId: "titleScene", layerId: "main", params: { title: "X" } },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_CONFLICT");

    // Nothing left over in the items map post-rollback.
    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const items = (json.result as { json: { items: Record<string, unknown> } }).json.items;
    expect(Object.keys(items).filter((k) => k.startsWith("scene-"))).toEqual([]);
    unregisterScene("titleScene");
  });
});

describe("update_scene_instance", () => {
  it("re-expands with new params under the same id", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "intro",
        start: 0,
        params: { title: "First" },
      },
      deps,
    );

    const upd = await dispatchTool(
      getTool("update_scene_instance"),
      { instanceId: "intro", params: { title: "Second" }, start: 5 },
      deps,
    );
    expect(upd.ok).toBe(true);

    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const comp = (json.result as { json: {
      items: Record<string, { type: string; text?: string }>;
      tweens: Array<{ target: string; start: number }>;
    } }).json;
    expect(comp.items["intro__headline"]?.text).toBe("Second");
    const t = comp.tweens.find((t) => t.target === "intro__headline");
    expect(t?.start).toBe(5);
    unregisterScene("titleScene");
  });
});

describe("remove_scene_instance", () => {
  it("drops the wrapper, prefixed items, and tweens", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "intro",
        params: { title: "Hello" },
      },
      deps,
    );

    const rm = await dispatchTool(
      getTool("remove_scene_instance"),
      { instanceId: "intro" },
      deps,
    );
    expect(rm.ok).toBe(true);

    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const comp = (json.result as { json: {
      items: Record<string, unknown>;
      tweens: Array<{ id: string }>;
    } }).json;
    expect(comp.items["intro"]).toBeUndefined();
    expect(comp.items["intro__headline"]).toBeUndefined();
    expect(comp.tweens.length).toBe(0);
    unregisterScene("titleScene");
  });

  it("does not remove a separately-authored tween targeting the instance's synthetic group (R-27)", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "intro",
        params: { title: "Hello" },
      },
      deps,
    );

    // A behavior/tween authored separately, targeting the wrapper group id
    // (the one target parent tweens are allowed to use per §8.7).
    const userTween = await dispatchTool(
      getTool("add_tween"),
      {
        target: "intro",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
      },
      deps,
    );
    expect(userTween.ok).toBe(true);
    if (!userTween.ok) return;
    const userTweenId = (userTween.result as { tweenId: string }).tweenId;

    const rm = await dispatchTool(
      getTool("remove_scene_instance"),
      { instanceId: "intro" },
      deps,
    );
    expect(rm.ok).toBe(true);

    // The instance's own items are gone...
    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const comp = (json.result as { json: {
      items: Record<string, unknown>;
      tweens: Array<{ id: string; target: string }>;
    } }).json;
    expect(comp.items["intro"]).toBeUndefined();
    expect(comp.items["intro__headline"]).toBeUndefined();

    // ...but the separately-authored tween survives, even though it targeted
    // the now-removed wrapper group.
    expect(comp.tweens.find((t) => t.id === userTweenId)).toBeDefined();
    unregisterScene("titleScene");
  });
});

describe("scene-instance lifetime (R-26)", () => {
  it("defaults the synthetic group's window to its own span, so it disappears once its scene ends", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "statPanel",
        start: 4,
        params: { title: "Stats" },
      },
      deps,
    );

    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const comp = (json.result as { json: Composition }).json;

    // titleScene's duration is 4s; instance starts at t=4 → visible [4, 8).
    const before = computeStateAt(comp, 3.999);
    expect(before.items["statPanel"]?.visible).toBe(false);
    const during = computeStateAt(comp, 5);
    expect(during.items["statPanel"]?.visible).not.toBe(false);
    // Regression shape from the review: a scene instance must NOT still be
    // visible well past its own duration (it used to ride the parent
    // timeline all the way to the composition's end).
    const after = computeStateAt(comp, 12.9);
    expect(after.items["statPanel"]?.visible).toBe(false);
    unregisterScene("titleScene");
  });

  it("an explicit `exit` overrides the computed default, holding the instance visible past its own duration", async () => {
    const { deps } = await setup();
    await dispatchTool(getTool("define_scene"), titleSceneArgs, deps);
    await dispatchTool(
      getTool("add_scene_instance"),
      {
        sceneId: "titleScene",
        layerId: "main",
        id: "statPanel",
        start: 4,
        exit: 20,
        params: { title: "Stats" },
      },
      deps,
    );

    const json = await dispatchTool(getTool("get_composition"), {}, deps);
    if (!json.ok) throw new Error("get_composition failed");
    const comp = (json.result as { json: Composition }).json;
    const after = computeStateAt(comp, 12.9);
    expect(after.items["statPanel"]?.visible).not.toBe(false);
    unregisterScene("titleScene");
  });
});

// End-to-end tests for the §6.7 MCP tools `apply_behavior` and
// `list_behaviors`. Drives the dispatcher directly (no transport spawn).

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function setup(): Promise<{ deps: ToolDeps }> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await dispatchTool(
    getTool("create_composition"),
    { width: 100, height: 100, fps: 30, duration: 10 },
    deps,
  );
  await dispatchTool(getTool("add_layer"), { z: 0 }, deps);
  await dispatchTool(
    getTool("add_text"),
    {
      layerId: "layer-1",
      text: "hi",
      font: "system",
      fontSize: 24,
      color: "#ffffff",
      x: 0,
      y: 0,
      id: "title",
    },
    deps,
  );
  return { deps };
}

describe("list_behaviors tool", () => {
  it("lists all 11 built-ins with descriptors", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await dispatchTool(getTool("list_behaviors"), {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as { behaviors: Array<{ name: string }> };
    expect(body.behaviors.map((b) => b.name).sort()).toEqual(
      [
        "fadeIn",
        "fadeOut",
        "popIn",
        "popOut",
        "slideIn",
        "slideOut",
        "rotateSpin",
        "kenburns",
        "shake",
        "colorCycle",
        "pulse",
      ].sort(),
    );
  });
});

describe("apply_behavior tool", () => {
  it("popIn adds 3 tweens and reports their ids", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_behavior"),
      {
        target: "title",
        behavior: "popIn",
        start: 0,
        duration: 1,
        easing: "easeOutBack",
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as { tweenIds: string[] };
    expect(body.tweenIds).toEqual([
      "title_popIn_0__opacity",
      "title_popIn_0__scaleX",
      "title_popIn_0__scaleY",
    ]);
    // Verify the store actually holds them.
    const list = await dispatchTool(
      getTool("list_tweens"),
      { target: "title" },
      deps,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const tweens = (list.result as { tweens: unknown[] }).tweens;
    expect(tweens).toHaveLength(3);
  });

  it("rolls back partial tweens when one collides with an existing tween", async () => {
    const { deps } = await setup();
    // Pre-place a tween that will collide with popIn's opacity sub-tween.
    await dispatchTool(
      getTool("add_tween"),
      {
        target: "title",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
        id: "blocking",
      },
      deps,
    );
    const out = await dispatchTool(
      getTool("apply_behavior"),
      {
        target: "title",
        behavior: "popIn",
        start: 0,
        duration: 1,
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_TWEEN_OVERLAP");
    // Store should still only have the blocking tween, not any sibling
    // scaleX/scaleY that the behavior may have added before the collision.
    const list = await dispatchTool(
      getTool("list_tweens"),
      { target: "title" },
      deps,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const tweens = (list.result as { tweens: Array<{ id: string }> }).tweens;
    expect(tweens.map((t) => t.id)).toEqual(["blocking"]);
  });

  it("returns E_BEHAVIOR_UNKNOWN for an unregistered name", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_behavior"),
      {
        target: "title",
        behavior: "definitelyMissing",
        start: 0,
        duration: 1,
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_BEHAVIOR_UNKNOWN");
  });

  it("returns E_BEHAVIOR_PARAM_MISSING for a behavior whose required param is absent", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_behavior"),
      {
        target: "title",
        behavior: "slideIn",
        start: 0,
        duration: 1,
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_BEHAVIOR_PARAM_MISSING");
  });

  it("explicit id is used as the parent prefix", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_behavior"),
      {
        target: "title",
        behavior: "fadeIn",
        start: 0,
        duration: 1,
        id: "fade1",
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.result as { tweenIds: string[] }).tweenIds).toEqual([
      "fade1__opacity",
    ]);
  });
});

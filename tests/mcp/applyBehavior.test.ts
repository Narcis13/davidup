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

// ──────────── define_user_behavior with a body (v1.1 S19) ────────────

const BOINGE_TWEENS = [
  {
    property: "transform.scaleX",
    from: 1,
    to: "${params.amount}",
    duration: 0.2,
    easing: "easeOutBack",
    suffix: "out",
  },
  {
    property: "transform.scaleX",
    from: "${params.amount}",
    to: 1,
    start: "${$.start + 0.2}",
    duration: 0.2,
    easing: "easeInQuad",
    suffix: "in",
  },
];

async function defineBoinge(
  deps: ToolDeps,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const out = await dispatchTool(
    getTool("define_user_behavior"),
    {
      name: "myBoinge",
      description: "Scale out and back.",
      params: [{ name: "amount", type: "number", default: 1.2 }],
      tweens: BOINGE_TWEENS,
      ...extra,
    },
    deps,
  );
  expect(out.ok).toBe(true);
}

describe("define_user_behavior → apply_behavior", () => {
  it("defines once and applies, emitting the body's tweens", async () => {
    const { deps } = await setup();
    await defineBoinge(deps);

    const out = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "myBoinge", start: 1, duration: 0.4 },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.result as { tweenIds: string[] }).tweenIds).toEqual([
      "title_myBoinge_1__out",
      "title_myBoinge_1__in",
    ]);

    const listed = await dispatchTool(getTool("list_tweens"), {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const tweens = (listed.result as { tweens: Array<Record<string, unknown>> })
      .tweens;
    expect(tweens.map((t) => [t.id, t.start, t.duration, t.to])).toEqual([
      ["title_myBoinge_1__out", 1, 0.2, 1.2],
      ["title_myBoinge_1__in", 1.2, 0.2, 1],
    ]);
  });

  it("reports the derived produces + executable back to the caller", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("define_user_behavior"),
      {
        name: "myBoinge",
        params: [{ name: "amount", type: "number", default: 1.2 }],
        // A wrong `produces` is ignored — the body is the source of truth.
        produces: ["totally", "wrong"],
        tweens: BOINGE_TWEENS,
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({
      name: "myBoinge",
      executable: true,
      produces: ["out", "in"],
    });
  });

  it("applies the same definition N times under distinct ids", async () => {
    const { deps } = await setup();
    await defineBoinge(deps);
    for (const start of [0, 1, 2]) {
      const out = await dispatchTool(
        getTool("apply_behavior"),
        { target: "title", behavior: "myBoinge", start, duration: 0.4 },
        deps,
      );
      expect(out.ok).toBe(true);
    }
    const listed = await dispatchTool(getTool("list_tweens"), {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect((listed.result as { tweens: unknown[] }).tweens).toHaveLength(6);
  });

  it("list_behaviors marks bodyless definitions non-executable", async () => {
    const { deps } = await setup();
    await defineBoinge(deps);
    await dispatchTool(
      getTool("define_user_behavior"),
      { name: "justACard", description: "catalog only" },
      deps,
    );
    const out = await dispatchTool(getTool("list_behaviors"), {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const behaviors = (
      out.result as { behaviors: Array<{ name: string; executable?: boolean }> }
    ).behaviors;
    const byName = new Map(behaviors.map((b) => [b.name, b]));
    expect(byName.get("myBoinge")?.executable).toBe(true);
    expect(byName.get("justACard")?.executable).toBe(false);
    // Built-ins stay executable and are still listed alongside.
    expect(byName.get("fadeIn")?.executable).toBe(true);
  });

  it("applying a bodyless definition fails with a hint naming `tweens`", async () => {
    const { deps } = await setup();
    await dispatchTool(
      getTool("define_user_behavior"),
      { name: "justACard", description: "catalog only" },
      deps,
    );
    const out = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "justACard", start: 0, duration: 1 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_BEHAVIOR_UNKNOWN");
    expect(out.error.hint).toMatch(/tweens/);
  });

  it("a definition does not leak into another session's store", async () => {
    const { deps } = await setup();
    await defineBoinge(deps);
    const other = await setup();
    const out = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "myBoinge", start: 0, duration: 0.4 },
      other.deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_BEHAVIOR_UNKNOWN");
  });

  it("a session definition shadows a built-in for that session only", async () => {
    const { deps } = await setup();
    await dispatchTool(
      getTool("define_user_behavior"),
      {
        name: "fadeIn",
        description: "session fadeIn that slides instead",
        tweens: [{ property: "transform.x", from: 0, to: 50, suffix: "x" }],
      },
      deps,
    );
    const mine = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "fadeIn", start: 0, duration: 1, id: "f" },
      deps,
    );
    expect(mine.ok).toBe(true);

    const other = await setup();
    const theirs = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "fadeIn", start: 0, duration: 1, id: "f" },
      other.deps,
    );
    expect(theirs.ok).toBe(true);

    const listed = await dispatchTool(getTool("list_tweens"), {}, other.deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const tweens = (listed.result as { tweens: Array<{ property: string }> })
      .tweens;
    expect(tweens[0]?.property).toBe("transform.opacity");
  });

  it("rolls back atomically when a body tween clashes with an existing one", async () => {
    const { deps } = await setup();
    await defineBoinge(deps);
    // Occupy the window the behavior's second tween wants.
    const seed = await dispatchTool(
      getTool("add_tween"),
      {
        id: "seed",
        target: "title",
        property: "transform.scaleX",
        from: 0,
        to: 1,
        start: 1.25,
        duration: 0.1,
      },
      deps,
    );
    expect(seed.ok).toBe(true);

    const out = await dispatchTool(
      getTool("apply_behavior"),
      { target: "title", behavior: "myBoinge", start: 1, duration: 0.4 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_TWEEN_OVERLAP");

    // The first tween must not have survived the failed call.
    const listed = await dispatchTool(getTool("list_tweens"), {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(
      (listed.result as { tweens: Array<{ id: string }> }).tweens.map((t) => t.id),
    ).toEqual(["seed"]);
  });
});

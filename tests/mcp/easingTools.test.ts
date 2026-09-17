// Parametric easings through the MCP surface (v1.1 S17): add_tween /
// update_tween / apply_behavior accept `{ bezier }` and `{ steps }` next to
// the names, the store hands out copies of object easings, and the discovery
// tools document both forms.

import { describe, expect, it } from "vitest";

import { EASING_NAMES } from "../../src/easings/index.js";
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

async function call(deps: ToolDeps, name: string, args: Record<string, unknown>) {
  return dispatchTool(getTool(name), args, deps);
}

async function setup(): Promise<ToolDeps> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await call(deps, "create_composition", { width: 640, height: 360, fps: 30, duration: 4 });
  await call(deps, "add_layer", { z: 0, id: "fg" });
  const shape = await call(deps, "add_shape", {
    layerId: "fg",
    id: "box",
    kind: "rect",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fillColor: "#ff0000",
  });
  expect(shape.ok).toBe(true);
  return deps;
}

const EASE = { bezier: [0.25, 0.1, 0.25, 1] };

describe("add_tween / update_tween — parametric easings", () => {
  it("stores a bezier easing, round-trips it through toJSON and validates", async () => {
    const deps = await setup();
    const out = await call(deps, "add_tween", {
      id: "move",
      target: "box",
      property: "transform.x",
      from: 0,
      to: 200,
      start: 0,
      duration: 1,
      easing: EASE,
    });
    expect(out.ok).toBe(true);
    expect(deps.store.toJSON().tweens[0]!.easing).toEqual(EASE);
    expect(deps.store.validate().errors).toEqual([]);
  });

  it("update_tween switches between a name, { steps } and { bezier }", async () => {
    const deps = await setup();
    await call(deps, "add_tween", {
      id: "move",
      target: "box",
      property: "transform.x",
      from: 0,
      to: 200,
      start: 0,
      duration: 1,
      easing: "easeOutQuad",
    });
    const easingOf = () => deps.store.toJSON().tweens[0]!.easing;

    expect((await call(deps, "update_tween", { id: "move", props: { easing: { steps: 4 } } })).ok).toBe(true);
    expect(easingOf()).toEqual({ steps: 4 });

    expect((await call(deps, "update_tween", { id: "move", props: { easing: EASE } })).ok).toBe(true);
    expect(easingOf()).toEqual(EASE);

    // Patching another field keeps the object easing.
    expect((await call(deps, "update_tween", { id: "move", props: { duration: 2 } })).ok).toBe(true);
    expect(easingOf()).toEqual(EASE);

    expect((await call(deps, "update_tween", { id: "move", props: { easing: "linear" } })).ok).toBe(true);
    expect(easingOf()).toBe("linear");
  });

  it("rejects malformed object easings with E_INVALID_VALUE at the offending path", async () => {
    const deps = await setup();
    const base = { target: "box", property: "transform.x", from: 0, to: 1, start: 0, duration: 1 };

    const outOfRange = await call(deps, "add_tween", { ...base, easing: { bezier: [1.5, 0, 0.5, 1] } });
    expect(outOfRange.ok).toBe(false);
    if (outOfRange.ok) return;
    expect(outOfRange.error.code).toBe("E_INVALID_VALUE");
    expect(outOfRange.error.issues?.[0]?.path).toBe("easing.bezier.0");

    const fractionalSteps = await call(deps, "add_tween", { ...base, easing: { steps: 1.5 } });
    expect(fractionalSteps.ok).toBe(false);

    const typo = await call(deps, "add_tween", { ...base, easing: "easeOutQaud" });
    expect(typo.ok).toBe(false);
    if (typo.ok) return;
    expect(typo.error.message).toContain("easeOutQuad");
    expect(typo.error.message).toContain("{ steps: n }");

    expect(deps.store.toJSON().tweens).toEqual([]);
  });

  it("hands out copies: mutating a listed tween's easing leaves the store intact", async () => {
    const deps = await setup();
    await call(deps, "add_tween", {
      id: "move",
      target: "box",
      property: "transform.x",
      from: 0,
      to: 200,
      start: 0,
      duration: 1,
      easing: EASE,
    });
    const listed = await call(deps, "list_tweens", {});
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const tweens = (listed.result as { tweens: Array<{ easing: { bezier: number[] } }> }).tweens;
    tweens[0]!.easing.bezier[0] = 0.99;
    expect(deps.store.toJSON().tweens[0]!.easing).toEqual(EASE);
  });
});

describe("apply_behavior — parametric easing", () => {
  it("every emitted tween carries its own copy of the easing", async () => {
    const deps = await setup();
    const out = await call(deps, "apply_behavior", {
      target: "box",
      behavior: "popIn",
      start: 0,
      duration: 1,
      easing: { bezier: [0.34, 1.56, 0.64, 1] },
    });
    expect(out.ok).toBe(true);
    const tweens = deps.store.toJSON().tweens;
    expect(tweens).toHaveLength(3);
    for (const t of tweens) expect(t.easing).toEqual({ bezier: [0.34, 1.56, 0.64, 1] });
    expect(tweens[0]!.easing).not.toBe(tweens[1]!.easing);
    expect(deps.store.validate().errors).toEqual([]);
  });
});

describe("discovery — list_easings / list_engine_capabilities", () => {
  it("list_easings returns the names plus both parametric forms", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await call(deps, "list_easings", {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as {
      easings: string[];
      parametric: Array<{ form: string; syntax: string; example: unknown; description: string }>;
    };
    expect(result.easings).toEqual([...EASING_NAMES]);
    expect(result.parametric.map((p) => p.form)).toEqual(["bezier", "steps"]);
    expect(result.parametric[0]!.example).toEqual({ bezier: [0.25, 0.1, 0.25, 1] });
    expect(result.parametric[1]!.example).toEqual({ steps: 4 });

    // Examples are fresh copies per call.
    (result.parametric[0]!.example as { bezier: number[] }).bezier[0] = 9;
    const again = await call(deps, "list_easings", {});
    if (!again.ok) throw new Error("list_easings failed");
    const parametric = (again.result as { parametric: Array<{ example: unknown }> }).parametric;
    expect(parametric[0]!.example).toEqual({ bezier: [0.25, 0.1, 0.25, 1] });
  });

  it("each documented example is accepted by add_tween", async () => {
    const deps = await setup();
    const out = await call(deps, "list_easings", {});
    if (!out.ok) throw new Error("list_easings failed");
    const parametric = (out.result as { parametric: Array<{ example: unknown }> }).parametric;
    let start = 0;
    for (const p of parametric) {
      const added = await call(deps, "add_tween", {
        target: "box",
        property: "transform.y",
        from: 0,
        to: 10,
        start,
        duration: 1,
        easing: p.example,
      });
      expect(added.ok, JSON.stringify(p.example)).toBe(true);
      start += 1;
    }
  });

  it("list_engine_capabilities reports parametricEasings next to the names", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await call(deps, "list_engine_capabilities", {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const caps = out.result as { easings: string[]; parametricEasings: Array<{ form: string }> };
    expect(caps.easings).toHaveLength(19);
    expect(caps.parametricEasings.map((p) => p.form)).toEqual(["bezier", "steps"]);
  });
});

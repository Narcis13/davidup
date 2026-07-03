// §8.6 / R-26 — scene-instance lifetime. The synthetic group produced by
// `expandSceneInstance` must default to disappearing when its own scene ends
// instead of riding the parent timeline to the composition's end, and an
// author must be able to override that default explicitly.

import { describe, expect, it } from "vitest";

import {
  expandSceneInstance,
  type SceneDefinition,
} from "../../src/compose/scenes.js";
import { MCPToolError } from "../../src/mcp/errors.js";

function makeBoxScene(duration = 4): SceneDefinition {
  return {
    id: "boxScene",
    duration,
    params: [],
    assets: [],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 50,
        height: 50,
        fillColor: "#ff0000",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

describe("scene-instance lifetime — identity (default)", () => {
  it("defaults the synthetic group's window to [start, start + duration)", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance("stat1", { scene: "boxScene", start: 4 }, {
      scenes: { boxScene: def },
    });
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(4);
    expect(group.exit).toBe(8);
  });

  it("defaults start to 0 when omitted", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance("stat1", { scene: "boxScene" }, {
      scenes: { boxScene: def },
    });
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(0);
    expect(group.exit).toBe(4);
  });

  it("an explicit `enter`/`exit` override the computed default", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance(
      "stat1",
      { scene: "boxScene", start: 4, enter: 0, exit: 100 },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(0);
    expect(group.exit).toBe(100);
  });

  it("an explicit `enter` alone still gets the computed default `exit`", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance(
      "stat1",
      { scene: "boxScene", start: 4, enter: 1 },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(1);
    expect(group.exit).toBe(8);
  });

  it("rejects exit <= enter with E_INVALID_VALUE", () => {
    const def = makeBoxScene(4);
    try {
      expandSceneInstance(
        "stat1",
        { scene: "boxScene", enter: 5, exit: 5 },
        { scenes: { boxScene: def } },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
    }
  });

  it("rejects a negative enter with E_INVALID_VALUE", () => {
    const def = makeBoxScene(4);
    expect(() =>
      expandSceneInstance(
        "stat1",
        { scene: "boxScene", enter: -1 },
        { scenes: { boxScene: def } },
      ),
    ).toThrow(MCPToolError);
  });
});

describe("scene-instance lifetime — clip/loop/timeScale effective span", () => {
  it("clip: window is [start, start + (toTime - fromTime))", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 10, time: { mode: "clip", fromTime: 1, toTime: 3 } },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(10);
    expect(group.exit).toBe(12);
  });

  it("loop: window spans the first iteration's start through the last iteration's end", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 2, time: { mode: "loop", count: 3 } },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(2);
    expect(group.exit).toBe(2 + 4 * 3);
  });

  it("timeScale: window is [start, start + duration/scale)", () => {
    const def = makeBoxScene(4);
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 2, time: { mode: "timeScale", scale: 2 } },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    expect(group.enter).toBe(2);
    expect(group.exit).toBe(2 + 4 / 2);
  });
});

describe("scene-instance lifetime — nested scene instances", () => {
  it("a nested scene instance's window nests inside the outer instance's local time", () => {
    const inner = makeBoxScene(2);
    const outer: SceneDefinition = {
      id: "outerScene",
      duration: 6,
      params: [],
      assets: [],
      items: {
        nested: {
          type: "scene",
          scene: "boxScene",
          start: 1, // scene-local: nested plays from t=1 to t=3 within outerScene
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 1,
          },
        },
      },
      tweens: [],
    };
    const expanded = expandSceneInstance(
      "outer",
      { scene: "outerScene", start: 5 },
      { scenes: { outerScene: outer, boxScene: inner } },
    );
    const nestedGroup = expanded.items["outer__nested"] as {
      enter?: number;
      exit?: number;
    };
    // nested-local [1, 3) + outer start (5) = [6, 8)
    expect(nestedGroup.enter).toBe(6);
    expect(nestedGroup.exit).toBe(8);

    const outerGroup = expanded.groupItem as { enter?: number; exit?: number };
    expect(outerGroup.enter).toBe(5);
    expect(outerGroup.exit).toBe(11);
  });
});

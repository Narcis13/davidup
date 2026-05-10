// Per COMPOSITION_PRIMITIVES.md §13 v0.4 test list:
//   "mid-instance scene-internal tween + parent transform.opacity tween
//    multiply correctly (golden frame)."
//
// At draw time the Canvas2D group recursion multiplies parent opacity with
// each child's opacity (via globalAlpha). This test proves the precompiler
// preserves both halves of that product:
//   1. The wrapper group keeps its parent-authored opacity tween (target =
//      instance id, transform.opacity).
//   2. The scene-internal tween survives with its target prefixed and start
//      shifted; it animates the inner item, NOT the wrapper.
// Combined, the two values multiply at render time as documented.

import { describe, expect, it } from "vitest";

import { precompile } from "../../src/compose/index.js";
import { computeStateAt } from "../../src/engine/resolver.js";
import { validate } from "../../src/schema/validator.js";
import type { Composition } from "../../src/schema/types.js";

describe("scene instance — parent × scene-internal opacity multiply", () => {
  it("preserves both halves of the opacity product after compile", async () => {
    const authored = {
      version: "0.2",
      composition: {
        width: 100,
        height: 100,
        fps: 30,
        duration: 2,
        background: "#000000",
      },
      assets: [],
      scenes: {
        sceneA: {
          id: "sceneA",
          duration: 2,
          params: [],
          assets: [],
          items: {
            box: {
              type: "shape",
              kind: "rect",
              width: 100,
              height: 100,
              fillColor: "#ff0000",
              transform: {
                x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                anchorX: 0, anchorY: 0, opacity: 1,
              },
            },
          },
          tweens: [
            {
              target: "box",
              property: "transform.opacity",
              from: 0,
              to: 1,
              start: 0,
              duration: 1,
            },
          ],
        },
      },
      layers: [
        { id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["inst"] },
      ],
      items: {
        inst: {
          type: "scene",
          scene: "sceneA",
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 1,
          },
        },
      },
      tweens: [
        {
          id: "wrap-fade",
          target: "inst",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 1,
        },
      ],
    };

    const compiled = (await precompile(authored)) as Composition;
    expect(validate(compiled).valid).toBe(true);

    // Verify both halves of the multiplication exist post-compile.
    const wrapTween = compiled.tweens.find((t) => t.id === "wrap-fade");
    expect(wrapTween).toBeDefined();
    expect(wrapTween?.target).toBe("inst");

    const innerTween = compiled.tweens.find((t) => t.target === "inst__box");
    expect(innerTween).toBeDefined();

    // At t = 0.5s both tweens are at 50% (linear default).
    const state = computeStateAt(compiled, 0.5);
    const wrapper = state.items["inst"];
    const inner = state.items["inst__box"];
    expect(wrapper).toBeDefined();
    expect(inner).toBeDefined();
    if (!wrapper || !inner) return;

    // Wrapper opacity should be 0.5 (linear half-progress on 0 → 1).
    expect(wrapper.transform.opacity).toBeCloseTo(0.5, 5);
    // Inner opacity should also be 0.5.
    expect(inner.transform.opacity).toBeCloseTo(0.5, 5);

    // The Canvas2D rendering pass multiplies these via globalAlpha — the
    // effective on-screen opacity at t=0.5 is 0.25. We don't render a frame
    // here (engine tests cover that); confirming both halves resolve
    // independently is the precompile contract this test guards.
  });
});

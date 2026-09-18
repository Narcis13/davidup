// Parametric easings through the compile pipeline (v1.1 S17): `{ bezier }` /
// `{ steps }` pass through template param substitution, `$behavior` blocks,
// `$repeat` expressions and scene time mapping, and the precompiled result
// validates.

import { describe, expect, it } from "vitest";

import { precompile } from "../../src/compose/precompile.js";
import { validate } from "../../src/schema/validator.js";

const T0 = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };
const box = (fillColor: string) => ({
  type: "shape",
  kind: "rect",
  width: 10,
  height: 10,
  fillColor,
  transform: { ...T0 },
});

describe("precompile — parametric easings", () => {
  it("survive templates, behaviors, $repeat and scene time mapping", async () => {
    const comp = {
      version: "0.5",
      composition: { width: 100, height: 100, fps: 30, duration: 10, background: "#000000" },
      assets: [],
      templates: {
        slide: {
          id: "slide",
          params: [{ name: "x1", type: "number", default: 0.42 }],
          items: { dot: box("#ff0000") },
          tweens: [
            {
              id: "move",
              target: "dot",
              property: "transform.x",
              from: 0,
              to: 50,
              start: 0,
              duration: 1,
              easing: { bezier: ["${params.x1}", 0, 0.58, 1] },
            },
            { $behavior: "fadeIn", target: "dot", start: 0, duration: 1, easing: { steps: 3 } },
          ],
        },
      },
      scenes: {
        pulse: {
          id: "pulse",
          duration: 1,
          params: [],
          assets: [],
          items: { core: box("#00ff00") },
          tweens: [
            {
              id: "grow",
              target: "core",
              property: "width",
              from: 10,
              to: 40,
              start: 0,
              duration: 1,
              easing: { bezier: [0.34, 1.56, 0.64, 1] },
            },
          ],
        },
      },
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["t", "s", "row"] }],
      items: {
        t: { $template: "slide", params: { x1: 0.3 }, start: 1 },
        s: {
          type: "scene",
          scene: "pulse",
          start: 2,
          time: { mode: "loop", count: 2 },
          transform: { ...T0 },
        },
        row: {
          $repeat: { count: 2, as: "i", id: "row${i}" },
          item: box("#0000ff"),
        },
      },
      tweens: [
        {
          $repeat: { count: 2, as: "i" },
          item: {
            id: "rowMove${i}",
            target: "row${i}",
            property: "transform.y",
            from: 0,
            to: 90,
            start: 0,
            duration: 2,
            easing: { steps: "${i + 2}" },
          },
        },
      ],
    };

    const out = (await precompile(comp)) as {
      tweens: Array<{ id: string; target: string; property: string; easing?: unknown }>;
    };
    expect(validate(out).errors).toEqual([]);

    const byId = new Map(out.tweens.map((t) => [t.id, t]));
    expect(byId.get("t__move")?.easing).toEqual({ bezier: [0.3, 0, 0.58, 1] });
    const fade = out.tweens.find((t) => t.target === "t__dot" && t.property === "transform.opacity");
    expect(fade?.easing).toEqual({ steps: 3 });

    const grows = out.tweens.filter((t) => t.property === "width");
    expect(grows).toHaveLength(2); // loop count 2
    for (const g of grows) expect(g.easing).toEqual({ bezier: [0.34, 1.56, 0.64, 1] });

    expect(byId.get("rowMove0")?.easing).toEqual({ steps: 2 });
    expect(byId.get("rowMove1")?.easing).toEqual({ steps: 3 });
  });
});

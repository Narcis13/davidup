import { describe, expect, it } from "vitest";
import { computeStateAt, indexTweens, lerp } from "../../src/engine/index.js";
import type { Composition } from "../../src/schema/types.js";

function emptyComp(overrides: Partial<Composition> = {}): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 30,
      duration: 10,
      background: "#000000",
    },
    assets: [],
    layers: [
      { id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["box"] },
    ],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 50,
        height: 50,
        fillColor: "#ff0000",
        transform: {
          x: 10,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 0.5,
        },
      },
    },
    tweens: [],
    ...overrides,
  };
}

describe("computeStateAt — base values", () => {
  it("returns base item values when no tween addresses the property", () => {
    const comp = emptyComp();
    const scene = computeStateAt(comp, 5);
    expect(scene.items.box!.transform.x).toBe(10);
    expect(scene.items.box!.transform.opacity).toBe(0.5);
    expect((scene.items.box as { fillColor?: string }).fillColor).toBe(
      "#ff0000",
    );
  });

  it("does not mutate the source composition", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 100,
          start: 0,
          duration: 2,
          easing: "linear",
        },
      ],
    });
    const before = JSON.stringify(comp);
    computeStateAt(comp, 1);
    expect(JSON.stringify(comp)).toBe(before);
  });
});

describe("computeStateAt — single tween semantics", () => {
  const tween = {
    id: "t1",
    target: "box",
    property: "transform.x",
    from: 100,
    to: 200,
    start: 1,
    duration: 2,
    easing: "linear" as const,
  };

  it("uses tween.from before its start time", () => {
    const comp = emptyComp({ tweens: [tween] });
    expect(computeStateAt(comp, 0).items.box!.transform.x).toBe(100);
    expect(computeStateAt(comp, 0.999).items.box!.transform.x).toBe(100);
  });

  it("equals tween.from at exactly start", () => {
    const comp = emptyComp({ tweens: [tween] });
    expect(computeStateAt(comp, 1).items.box!.transform.x).toBe(100);
  });

  it("interpolates linearly mid-tween", () => {
    const comp = emptyComp({ tweens: [tween] });
    expect(computeStateAt(comp, 2).items.box!.transform.x).toBe(150);
  });

  it("holds at tween.to after end", () => {
    const comp = emptyComp({ tweens: [tween] });
    expect(computeStateAt(comp, 3).items.box!.transform.x).toBe(200);
    expect(computeStateAt(comp, 9).items.box!.transform.x).toBe(200);
  });
});

describe("computeStateAt — easings and clamping", () => {
  it("applies the named easing function", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 100,
          start: 0,
          duration: 1,
          easing: "easeInQuad",
        },
      ],
    });
    // easeInQuad(0.5) = 0.25 → 25
    expect(computeStateAt(comp, 0.5).items.box!.transform.x).toBe(25);
  });

  it("defaults to linear when easing is omitted", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 100,
          start: 0,
          duration: 1,
        },
      ],
    });
    expect(computeStateAt(comp, 0.5).items.box!.transform.x).toBe(50);
  });

  it("clamps opacity to [0, 1]", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.opacity",
          from: -0.5,
          to: 2,
          start: 0,
          duration: 1,
          easing: "linear",
        },
      ],
    });
    // Clamped to 0 at t=0 (raw -0.5) and to 1 at t=1 (raw 2).
    expect(computeStateAt(comp, 0).items.box!.transform.opacity).toBe(0);
    expect(computeStateAt(comp, 1).items.box!.transform.opacity).toBe(1);
  });
});

describe("computeStateAt — color tweens", () => {
  it("interpolates RGB hex colors", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "fillColor",
          from: "#000000",
          to: "#ffffff",
          start: 0,
          duration: 1,
          easing: "linear",
        },
      ],
    });
    const before = (computeStateAt(comp, -1).items.box as { fillColor: string })
      .fillColor;
    expect(before).toBe("#000000");

    const mid = (computeStateAt(comp, 0.5).items.box as { fillColor: string })
      .fillColor;
    // Linear midpoint: rgba(127.5,127.5,127.5,1) → rounded to 128 each.
    expect(mid).toBe("rgba(128, 128, 128, 1)");

    const after = (computeStateAt(comp, 5).items.box as { fillColor: string })
      .fillColor;
    expect(after).toBe("#ffffff");
  });
});

describe("computeStateAt — multiple tweens on same property", () => {
  function compTwo(): Composition {
    return emptyComp({
      tweens: [
        {
          id: "a",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 50,
          start: 0,
          duration: 1,
          easing: "linear",
        },
        {
          id: "b",
          target: "box",
          property: "transform.x",
          from: 100,
          to: 200,
          start: 3,
          duration: 1,
          easing: "linear",
        },
      ],
    });
  }

  it("holds at first.to in the gap between the two tweens", () => {
    expect(computeStateAt(compTwo(), 2).items.box!.transform.x).toBe(50);
  });

  it("uses second.from at second's start (not first.to anymore)", () => {
    expect(computeStateAt(compTwo(), 3).items.box!.transform.x).toBe(100);
  });

  it("interpolates the second tween mid-window", () => {
    expect(computeStateAt(compTwo(), 3.5).items.box!.transform.x).toBe(150);
  });

  it("holds at second.to past its end", () => {
    expect(computeStateAt(compTwo(), 9).items.box!.transform.x).toBe(200);
  });

  it("is order-independent: declaring tweens out of order yields the same scene", () => {
    const reversed = emptyComp({
      tweens: [
        {
          id: "b",
          target: "box",
          property: "transform.x",
          from: 100,
          to: 200,
          start: 3,
          duration: 1,
          easing: "linear",
        },
        {
          id: "a",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 50,
          start: 0,
          duration: 1,
          easing: "linear",
        },
      ],
    });
    expect(computeStateAt(reversed, 2).items.box!.transform.x).toBe(50);
    expect(computeStateAt(reversed, 3.5).items.box!.transform.x).toBe(150);
  });
});

describe("computeStateAt — determinism", () => {
  it("returns structurally identical scenes for the same (comp, t)", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 100,
          start: 0,
          duration: 2,
          easing: "easeInOutCubic",
        },
        {
          id: "t2",
          target: "box",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 1,
          easing: "easeOutQuad",
        },
      ],
    });
    const a = computeStateAt(comp, 0.7);
    const b = computeStateAt(comp, 0.7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces the same scene whether or not a precomputed index is passed", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "t1",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 100,
          start: 0,
          duration: 2,
          easing: "easeInOutQuad",
        },
      ],
    });
    const index = indexTweens(comp);
    const a = computeStateAt(comp, 1.3);
    const b = computeStateAt(comp, 1.3, index);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("indexTweens", () => {
  it("buckets tweens by (target, property) and sorts each bucket by start", () => {
    const comp = emptyComp({
      tweens: [
        {
          id: "late",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 1,
          start: 5,
          duration: 1,
        },
        {
          id: "early",
          target: "box",
          property: "transform.x",
          from: 0,
          to: 1,
          start: 1,
          duration: 1,
        },
        {
          id: "other",
          target: "box",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 1,
        },
      ],
    });
    const idx = indexTweens(comp);
    expect(idx.buckets.size).toBe(2);
    const xBucket = idx.buckets.get("box::transform.x")!;
    expect(xBucket.map((t) => t.id)).toEqual(["early", "late"]);
    const opacityBucket = idx.buckets.get("box::transform.opacity")!;
    expect(opacityBucket.map((t) => t.id)).toEqual(["other"]);
  });
});

describe("polymorphic lerp", () => {
  it("interpolates numbers", () => {
    expect(lerp(0, 10, 0.25, "number")).toBe(2.5);
  });

  it("interpolates color strings", () => {
    expect(lerp("#000000", "#ffffff", 0, "color")).toBe("rgba(0, 0, 0, 1)");
    expect(lerp("#000000", "#ffffff", 1, "color")).toBe("rgba(255, 255, 255, 1)");
  });
});

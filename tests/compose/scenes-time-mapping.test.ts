// v0.5 §8.5 — time mapping for scene instances.
//
// Four non-identity modes:
//   - clip   : trim to a [fromTime, toTime] sub-window of the scene's timeline
//   - loop   : play the scene N times back-to-back
//   - timeScale: play at K× speed (start and duration both divided by scale)
//   - reverse: play the scene backwards (v1.1 S20)
//
// v1.1 S20 also made `clip` auto-trim a tween that straddles a boundary
// rather than rejecting it — the sampled endpoints are the contract, so the
// tests below check trimmed values against the *untrimmed* scene at the cut
// points rather than against hand-computed constants alone.
//
// Each mode is exercised against expandSceneInstance directly (unit) and
// through precompile (the compile pipeline, including post-expansion
// validator pass). Loop iterations must produce tweens that touch at
// iteration boundaries without tripping E_TWEEN_OVERLAP (the validator's
// 1µs EPS guard covers FP drift).

import { describe, expect, it } from "vitest";

import {
  expandSceneInstance,
  type SceneDefinition,
} from "../../src/compose/scenes.js";
import { precompile } from "../../src/compose/precompile.js";
import { computeStateAt } from "../../src/engine/resolver.js";
import { MCPToolError } from "../../src/mcp/errors.js";
import { validate } from "../../src/schema/validator.js";
import type { Composition } from "../../src/schema/types.js";

function makeBoxScene(): SceneDefinition {
  return {
    id: "boxScene",
    duration: 4,
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
          anchorX: 0, anchorY: 0, opacity: 0,
        },
      },
    },
    tweens: [
      // Scene-local: fadeIn [0, 1], wait, fadeOut [3, 4]
      {
        id: "fadeIn",
        target: "box",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
      },
      {
        id: "fadeOut",
        target: "box",
        property: "transform.opacity",
        from: 1,
        to: 0,
        start: 3,
        duration: 1,
      },
    ],
  };
}

function makeAuthored(
  def: SceneDefinition,
  instance: Record<string, unknown>,
  compDuration = 20,
) {
  return {
    version: "0.5",
    composition: {
      width: 100,
      height: 100,
      fps: 30,
      duration: compDuration,
      background: "#000000",
    },
    assets: [],
    scenes: { [def.id]: def },
    layers: [
      { id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["s"] },
    ],
    items: {
      s: {
        type: "scene",
        scene: def.id,
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 1,
        },
        ...instance,
      },
    },
    tweens: [],
  };
}

describe("time mapping — identity (default, regression)", () => {
  it("matches v0.4 behavior when `time` is omitted", () => {
    const def = makeBoxScene();
    const a = expandSceneInstance("s", { scene: "boxScene", start: 2 }, {
      scenes: { boxScene: def },
    });
    const b = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 2, time: { mode: "identity" } },
      { scenes: { boxScene: def } },
    );
    expect(b.tweens).toEqual(a.tweens);
  });
});

describe("time mapping — clip", () => {
  it("drops tweens fully outside the window and shifts the rest", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      {
        scene: "boxScene",
        start: 10,
        time: { mode: "clip", fromTime: 2, toTime: 4 },
      },
      { scenes: { boxScene: def } },
    );
    // fadeIn ([0,1]) is fully before the clip window → dropped.
    // fadeOut ([3,4]) is fully inside [2,4] → kept, shifted by (10 - 2) = 8.
    expect(expanded.tweens).toHaveLength(1);
    const kept = expanded.tweens[0] as Record<string, unknown>;
    expect(kept.id).toBe("s__fadeOut");
    expect(kept.start).toBeCloseTo(11, 10);     // 3 (scene local) - 2 (fromTime) + 10 (parentStart) = 11
    expect(kept.duration).toBeCloseTo(1, 10);
  });

  it("throws E_TIME_MAPPING_TWEEN_SPLIT on boundary-crossing tweens under strict", () => {
    const def = makeBoxScene();
    try {
      expandSceneInstance(
        "s",
        {
          scene: "boxScene",
          // clip [0.5, 3.5] cuts across both fadeIn ([0,1]) and fadeOut ([3,4]).
          time: { mode: "clip", fromTime: 0.5, toTime: 3.5, strict: true },
        },
        { scenes: { boxScene: def } },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_TWEEN_SPLIT");
    }
  });

  it("rejects invalid clip windows with E_TIME_MAPPING_INVALID", () => {
    const def = makeBoxScene();
    const cases: Array<{ fromTime: number; toTime: number }> = [
      { fromTime: -1, toTime: 2 },
      { fromTime: 3, toTime: 3 },
      { fromTime: 3, toTime: 2 },
      { fromTime: 0, toTime: 5 }, // toTime > scene.duration (4)
    ];
    for (const t of cases) {
      try {
        expandSceneInstance(
          "s",
          { scene: "boxScene", time: { mode: "clip", ...t } },
          { scenes: { boxScene: def } },
        );
        throw new Error(`should have thrown for ${JSON.stringify(t)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(MCPToolError);
        expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
      }
    }
  });

  it("survives full precompile + validator with non-overlapping tweens", async () => {
    const def = makeBoxScene();
    const authored = makeAuthored(def, {
      time: { mode: "clip", fromTime: 2.5, toTime: 4 },
      start: 0,
    });
    const compiled = (await precompile(authored)) as Composition;
    const result = validate(compiled);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("time mapping — loop", () => {
  it("emits one copy per iteration with suffixed ids and shifted starts", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 0, time: { mode: "loop", count: 3 } },
      { scenes: { boxScene: def } },
    );
    // 2 scene tweens × 3 iterations = 6 emitted tweens.
    expect(expanded.tweens).toHaveLength(6);
    const ids = (expanded.tweens as Array<Record<string, unknown>>).map(
      (t) => t.id as string,
    );
    expect(ids).toContain("s__fadeIn__loop0");
    expect(ids).toContain("s__fadeIn__loop1");
    expect(ids).toContain("s__fadeIn__loop2");
    expect(ids).toContain("s__fadeOut__loop0");
    expect(ids).toContain("s__fadeOut__loop1");
    expect(ids).toContain("s__fadeOut__loop2");

    // fadeOut iteration 2 starts at: 2 * 4 (sceneDuration) + 3 = 11
    const fadeOutLoop2 = (expanded.tweens as Array<Record<string, unknown>>)
      .find((t) => t.id === "s__fadeOut__loop2") as Record<string, unknown>;
    expect(fadeOutLoop2.start).toBeCloseTo(11, 10);
  });

  it("touching tween ends across loop boundaries pass overlap validation", async () => {
    // A scene whose tween spans the full duration produces touching adjacent
    // copies under loop: end of iter i == start of iter i+1. The validator's
    // 1µs EPS guard must absorb the FP equality.
    const full: SceneDefinition = {
      id: "full",
      duration: 2,
      params: [],
      assets: [],
      items: {
        box: {
          type: "shape", kind: "rect", width: 10, height: 10,
          fillColor: "#fff",
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 0,
          },
        },
      },
      tweens: [
        {
          id: "full-fade",
          target: "box",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 2,
        },
      ],
    };
    const authored = makeAuthored(full, {
      time: { mode: "loop", count: 5 },
    }, 10);
    const compiled = (await precompile(authored)) as Composition;
    const result = validate(compiled);
    expect(result.valid).toBe(true);
    // Five copies, touching but not overlapping.
    const sameProp = compiled.tweens.filter(
      (t) => t.target === "s__box" && t.property === "transform.opacity",
    );
    expect(sameProp).toHaveLength(5);
  });

  it("rejects non-positive or non-integer loop counts", () => {
    const def = makeBoxScene();
    for (const count of [0, -1, 1.5]) {
      try {
        expandSceneInstance(
          "s",
          { scene: "boxScene", time: { mode: "loop", count } },
          { scenes: { boxScene: def } },
        );
        throw new Error(`should have thrown for count=${count}`);
      } catch (err) {
        expect(err).toBeInstanceOf(MCPToolError);
        expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
      }
    }
  });
});

describe("time mapping — timeScale", () => {
  it("scales start and duration by 1/scale", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 10, time: { mode: "timeScale", scale: 2 } },
      { scenes: { boxScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    const fadeIn = tweens.find((t) => t.id === "s__fadeIn")!;
    expect(fadeIn.start).toBeCloseTo(10, 10);
    expect(fadeIn.duration).toBeCloseTo(0.5, 10);
    const fadeOut = tweens.find((t) => t.id === "s__fadeOut")!;
    // scene-local start=3 → 3/2 = 1.5, + parentStart 10 = 11.5
    expect(fadeOut.start).toBeCloseTo(11.5, 10);
    expect(fadeOut.duration).toBeCloseTo(0.5, 10);
  });

  it("non-integer scales still produce overlap-safe output", async () => {
    // scale=1.5 yields fractional starts/durations. The two scene tweens
    // don't overlap pre-scale, so they still don't overlap post-scale.
    const def = makeBoxScene();
    const authored = makeAuthored(def, {
      time: { mode: "timeScale", scale: 1.5 },
    });
    const compiled = (await precompile(authored)) as Composition;
    expect(validate(compiled).valid).toBe(true);
  });

  it("rejects scale <= 0 with E_TIME_MAPPING_INVALID", () => {
    const def = makeBoxScene();
    for (const scale of [0, -1, -0.5]) {
      try {
        expandSceneInstance(
          "s",
          { scene: "boxScene", time: { mode: "timeScale", scale } },
          { scenes: { boxScene: def } },
        );
        throw new Error(`should have thrown for scale=${scale}`);
      } catch (err) {
        expect(err).toBeInstanceOf(MCPToolError);
        expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
      }
    }
  });
});

describe("time mapping — pipeline integration", () => {
  it("reads `time` from authored scene-instance items via precompile", async () => {
    const def = makeBoxScene();
    const authored = makeAuthored(def, {
      time: { mode: "loop", count: 2 },
      start: 0,
    });
    const compiled = (await precompile(authored)) as Composition;
    const sameProp = compiled.tweens.filter(
      (t) => t.target === "s__box" && t.property === "transform.opacity",
    );
    // 2 scene tweens × 2 iterations = 4
    expect(sameProp).toHaveLength(4);
    // fadeOut__loop1 start = 1 * 4 (sceneDuration) + 3 (scene-local) = 7
    const last = sameProp.find((t) => t.id === "s__fadeOut__loop1")!;
    expect(last.start).toBeCloseTo(7, 10);
  });

  it("rejects malformed `time` from authored items with E_TIME_MAPPING_INVALID", async () => {
    const def = makeBoxScene();
    const authored = makeAuthored(def, {
      time: { mode: "wobble" } as unknown as Record<string, unknown>,
    });
    try {
      await precompile(authored);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
    }
  });

  it("deterministic: same input → byte-identical compiled tweens", async () => {
    const def = makeBoxScene();
    const a = makeAuthored(def, { time: { mode: "loop", count: 4 } });
    const b = makeAuthored(def, { time: { mode: "loop", count: 4 } });
    const compiledA = (await precompile(a)) as Composition;
    const compiledB = (await precompile(b)) as Composition;
    expect(JSON.stringify(compiledA.tweens)).toBe(JSON.stringify(compiledB.tweens));
  });
});

// ──────────────── v1.1 S20 — clip auto-trim + reverse ────────────────

/** A scene whose single tween spans the whole timeline, so any clip cuts it. */
function makeSpanScene(
  easing?: unknown,
  over: { from: unknown; to: unknown; property?: string } = { from: 0, to: 1 },
): SceneDefinition {
  return {
    id: "spanScene",
    duration: 4,
    params: [],
    assets: [],
    items: {
      box: {
        type: "shape", kind: "rect", width: 50, height: 50,
        fillColor: "#ff0000",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          anchorX: 0, anchorY: 0, opacity: 0,
        },
      },
    },
    tweens: [
      {
        id: "span",
        target: "box",
        property: over.property ?? "transform.opacity",
        from: over.from,
        to: over.to,
        start: 0,
        duration: 4,
        ...(easing !== undefined ? { easing } : {}),
      },
    ],
  };
}

/** Read `s__box`'s opacity off a compiled composition at parent time `t`. */
function opacityAt(compiled: Composition, t: number): number {
  const item = computeStateAt(compiled, t).items["s__box"]!;
  return item.transform.opacity as number;
}

describe("time mapping — clip auto-trim (S20)", () => {
  it("trims a head-straddling tween, sampling its value at the cut", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      {
        scene: "boxScene",
        start: 10,
        // Cuts across fadeIn ([0,1]) at its middle; fadeOut ([3,4]) is inside.
        time: { mode: "clip", fromTime: 0.5, toTime: 4 },
      },
      { scenes: { boxScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    const fadeIn = tweens.find((t) => t.id === "s__fadeIn")!;
    // Kept half of [0,1]: starts at the window edge, runs 0.5s.
    expect(fadeIn.start).toBeCloseTo(10, 10);
    expect(fadeIn.duration).toBeCloseTo(0.5, 10);
    // Linear 0→1 sampled at progress 0.5 is 0.5; the tail value is untouched.
    expect(fadeIn.from).toBeCloseTo(0.5, 12);
    expect(fadeIn.to).toBe(1);

    // The untouched tween keeps its authored from/to exactly.
    const fadeOut = tweens.find((t) => t.id === "s__fadeOut")!;
    expect(fadeOut.from).toBe(1);
    expect(fadeOut.to).toBe(0);
  });

  it("trims a tail-straddling tween", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", time: { mode: "clip", fromTime: 0, toTime: 3.25 } },
      { scenes: { boxScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    const fadeOut = tweens.find((t) => t.id === "s__fadeOut")!;
    expect(fadeOut.start).toBeCloseTo(3, 10);
    expect(fadeOut.duration).toBeCloseTo(0.25, 10);
    // Head untouched (exact authored value), tail sampled at progress 0.25.
    expect(fadeOut.from).toBe(1);
    expect(fadeOut.to).toBeCloseTo(0.75, 12);
  });

  it("trims a tween straddling both edges down to the window", () => {
    const def = makeSpanScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "spanScene", time: { mode: "clip", fromTime: 1, toTime: 3 } },
      { scenes: { spanScene: def } },
    );
    const span = (expanded.tweens as Array<Record<string, unknown>>)[0]!;
    expect(span.start).toBeCloseTo(0, 10);
    expect(span.duration).toBeCloseTo(2, 10);
    expect(span.from).toBeCloseTo(0.25, 12);
    expect(span.to).toBeCloseTo(0.75, 12);
  });

  it("is exact for a linear tween — the clipped window replays the original", async () => {
    const def = makeSpanScene();
    const full = (await precompile(makeAuthored(def, { start: 0 }))) as Composition;
    const clipped = (await precompile(
      makeAuthored(def, { start: 0, time: { mode: "clip", fromTime: 1, toTime: 3 } }),
    )) as Composition;

    // Scene-local τ ∈ [1, 3] is parent time τ in the full instance and τ − 1
    // in the clipped one. Linear is the case the trim reproduces exactly.
    for (const tau of [1, 1.4, 1.75, 2, 2.5, 2.9, 3]) {
      expect(opacityAt(clipped, tau - 1)).toBeCloseTo(opacityAt(full, tau), 12);
    }
  });

  it("matches the untrimmed scene exactly at both cut points under an eased tween", async () => {
    const def = makeSpanScene("easeInOutCubic");
    const full = (await precompile(makeAuthored(def, { start: 0 }))) as Composition;
    const clipped = (await precompile(
      makeAuthored(def, { start: 0, time: { mode: "clip", fromTime: 1, toTime: 3 } }),
    )) as Composition;

    // The endpoints are the contract: sampled through the tween's own easing.
    // At its own end the trimmed tween holds `to`, which is the full scene's
    // value at the matching cut — so these agree to floating-point precision.
    expect(opacityAt(clipped, 0)).toBeCloseTo(opacityAt(full, 1), 12);
    expect(opacityAt(clipped, 2)).toBeCloseTo(opacityAt(full, 3), 12);

    // The interior is the documented approximation — the trimmed copy replays
    // the whole easing over the shorter span instead of the sub-curve. Assert
    // it stays between the endpoints, not that it matches.
    expect(opacityAt(clipped, 1)).toBeGreaterThan(opacityAt(clipped, 0));
    expect(opacityAt(clipped, 1)).toBeLessThan(opacityAt(clipped, 2));
  });

  it("samples a color tween through the lerp", async () => {
    const def = makeSpanScene(undefined, {
      from: "#000000",
      to: "#ffffff",
      property: "fillColor",
    });
    const expanded = expandSceneInstance(
      "s",
      { scene: "spanScene", time: { mode: "clip", fromTime: 2, toTime: 4 } },
      { scenes: { spanScene: def } },
    );
    const span = (expanded.tweens as Array<Record<string, unknown>>)[0]!;
    // Half-way through a black→white ramp. The sampled edge comes back in the
    // color module's own `rgba(...)` output form, which parseColor round-trips;
    // the tail edge wasn't cut, so it keeps the authored spelling.
    expect(span.from).toBe("rgba(128, 128, 128, 1)");
    expect(span.to).toBe("#ffffff");

    // And that sampled spelling is still a valid stored composition.
    const compiled = (await precompile(
      makeAuthored(def, { start: 0, time: { mode: "clip", fromTime: 2, toTime: 4 } }),
    )) as Composition;
    expect(validate(compiled).valid).toBe(true);
  });

  it("expands and trims a straddling $behavior block", () => {
    const def: SceneDefinition = {
      id: "behaviorScene",
      duration: 4,
      params: [],
      assets: [],
      items: {
        box: {
          type: "shape", kind: "rect", width: 10, height: 10, fillColor: "#fff",
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 0,
          },
        },
      },
      tweens: [{ $behavior: "fadeIn", target: "box", start: 0, duration: 4 }],
    };
    const expanded = expandSceneInstance(
      "s",
      { scene: "behaviorScene", time: { mode: "clip", fromTime: 1, toTime: 3 } },
      { scenes: { behaviorScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    expect(tweens).toHaveLength(1);
    // Lowered to a literal tween so its endpoints could be resampled — the
    // `$behavior` marker is gone.
    expect(tweens[0]!.$behavior).toBeUndefined();
    expect(tweens[0]!.property).toBe("transform.opacity");
    expect(tweens[0]!.from).toBeCloseTo(0.25, 12);
    expect(tweens[0]!.to).toBeCloseTo(0.75, 12);
    expect(tweens[0]!.duration).toBeCloseTo(2, 10);
  });

  it("leaves a $behavior block that sits inside the window unexpanded", () => {
    const def: SceneDefinition = {
      id: "behaviorInside",
      duration: 4,
      params: [],
      assets: [],
      items: {
        box: {
          type: "shape", kind: "rect", width: 10, height: 10, fillColor: "#fff",
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 0,
          },
        },
      },
      tweens: [{ $behavior: "fadeIn", target: "box", start: 1, duration: 1 }],
    };
    const expanded = expandSceneInstance(
      "s",
      { scene: "behaviorInside", time: { mode: "clip", fromTime: 0.5, toTime: 3 } },
      { scenes: { behaviorInside: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.$behavior).toBe("fadeIn");
    expect(tweens[0]!.start).toBeCloseTo(0.5, 10);
  });

  it("still drops tweens fully outside and keeps epsilon-aligned ones whole", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      // fadeOut sits exactly on [3, 4]; fadeIn ([0,1]) is fully outside.
      { scene: "boxScene", time: { mode: "clip", fromTime: 3, toTime: 4 } },
      { scenes: { boxScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    expect(tweens).toHaveLength(1);
    // Aligned with both edges → kept verbatim, not resampled.
    expect(tweens[0]!.from).toBe(1);
    expect(tweens[0]!.to).toBe(0);
    expect(tweens[0]!.duration).toBe(1);
  });

  it("survives full precompile + validator when trimming", async () => {
    const def = makeSpanScene("easeOutQuad");
    const authored = makeAuthored(def, {
      time: { mode: "clip", fromTime: 0.75, toTime: 3.25 },
      start: 0,
    });
    const compiled = (await precompile(authored)) as Composition;
    const result = validate(compiled);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects clip.strict that isn't a boolean", async () => {
    const def = makeBoxScene();
    const authored = makeAuthored(def, {
      time: { mode: "clip", fromTime: 0.5, toTime: 3.5, strict: "yes" },
    });
    try {
      await precompile(authored);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
    }
  });
});

describe("time mapping — reverse (S20)", () => {
  it("mirrors each tween about the scene's duration and swaps its endpoints", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 10, time: { mode: "reverse" } },
      { scenes: { boxScene: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    expect(tweens).toHaveLength(2);

    // fadeOut ([3,4] of a 4s scene) becomes the opening move, [0,1].
    const first = tweens[0]!;
    expect(first.id).toBe("s__fadeOut");
    expect(first.start).toBeCloseTo(10, 10);
    expect(first.duration).toBe(1);
    expect(first.from).toBe(0);
    expect(first.to).toBe(1);

    // fadeIn ([0,1]) becomes the closing move, [3,4].
    const second = tweens[1]!;
    expect(second.id).toBe("s__fadeIn");
    expect(second.start).toBeCloseTo(13, 10);
    expect(second.from).toBe(1);
    expect(second.to).toBe(0);
  });

  it("mirrors easings so the motion retraces itself", () => {
    const def = makeSpanScene("easeInQuad");
    const expanded = expandSceneInstance(
      "s",
      { scene: "spanScene", time: { mode: "reverse" } },
      { scenes: { spanScene: def } },
    );
    const span = (expanded.tweens as Array<Record<string, unknown>>)[0]!;
    expect(span.easing).toBe("easeOutQuad");
  });

  it("plays back the same values in the opposite order", async () => {
    const def = makeSpanScene("easeInOutCubic");
    const forward = (await precompile(makeAuthored(def, { start: 0 }))) as Composition;
    const backward = (await precompile(
      makeAuthored(def, { start: 0, time: { mode: "reverse" } }),
    )) as Composition;

    // Reversal is the defining property: value at t backwards == value at
    // (duration − t) forwards, for the whole scene.
    for (const t of [0, 0.5, 1, 1.75, 2, 3, 3.5]) {
      expect(opacityAt(backward, t)).toBeCloseTo(opacityAt(forward, 4 - t), 12);
    }
  });

  it("reverses $behavior blocks by lowering them to literal tweens first", () => {
    const def: SceneDefinition = {
      id: "behaviorReverse",
      duration: 4,
      params: [],
      assets: [],
      items: {
        box: {
          type: "shape", kind: "rect", width: 10, height: 10, fillColor: "#fff",
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 0,
          },
        },
      },
      tweens: [{ $behavior: "fadeIn", target: "box", start: 0, duration: 1 }],
    };
    const expanded = expandSceneInstance(
      "s",
      { scene: "behaviorReverse", time: { mode: "reverse" } },
      { scenes: { behaviorReverse: def } },
    );
    const tweens = expanded.tweens as Array<Record<string, unknown>>;
    expect(tweens).toHaveLength(1);
    // A fadeIn at the scene's head reverses into a fade *out* at its tail.
    expect(tweens[0]!.$behavior).toBeUndefined();
    expect(tweens[0]!.from).toBe(1);
    expect(tweens[0]!.to).toBe(0);
    expect(tweens[0]!.start).toBeCloseTo(3, 10);
  });

  it("rejects a tween that runs past the scene's own duration", () => {
    const def = makeBoxScene();
    def.duration = 3; // fadeOut still spans [3, 4] — off the mirror axis.
    try {
      expandSceneInstance(
        "s",
        { scene: "boxScene", time: { mode: "reverse" } },
        { scenes: { boxScene: def } },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TIME_MAPPING_INVALID");
    }
  });

  it("mirrors the wrapper group's own visibility window", () => {
    const def = makeBoxScene();
    const expanded = expandSceneInstance(
      "s",
      { scene: "boxScene", start: 5, time: { mode: "reverse" } },
      { scenes: { boxScene: def } },
    );
    const group = expanded.groupItem as { enter?: number; exit?: number };
    // Reversing doesn't change how long the instance is on screen.
    expect(group.enter).toBeCloseTo(5, 10);
    expect(group.exit).toBeCloseTo(9, 10);
  });

  it("nests inside loop — each iteration plays the reversed child", async () => {
    const inner = makeBoxScene();
    const outer: SceneDefinition = {
      id: "outerScene",
      duration: 4,
      params: [],
      assets: [],
      items: {
        nested: {
          type: "scene",
          scene: "boxScene",
          start: 0,
          time: { mode: "reverse" },
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            anchorX: 0, anchorY: 0, opacity: 1,
          },
        },
      },
      tweens: [],
    };
    const authored = {
      ...makeAuthored(outer, { time: { mode: "loop", count: 2 }, start: 0 }, 10),
      scenes: { outerScene: outer, boxScene: inner },
    };
    const compiled = (await precompile(authored)) as Composition;
    expect(validate(compiled).valid).toBe(true);

    const opacity = compiled.tweens.filter(
      (t) => t.target === "s__nested__box" && t.property === "transform.opacity",
    );
    // 2 scene tweens × 2 loop iterations.
    expect(opacity).toHaveLength(4);

    // Within iteration 0 the reversed child opens with what was fadeOut,
    // running 0→1 at t=0, and closes with the reversed fadeIn at t=3.
    const iter0 = opacity
      .filter((t) => t.start < 4)
      .sort((a, b) => a.start - b.start);
    expect(iter0[0]!.start).toBeCloseTo(0, 10);
    expect(iter0[0]!.from).toBe(0);
    expect(iter0[0]!.to).toBe(1);
    expect(iter0[1]!.start).toBeCloseTo(3, 10);
    expect(iter0[1]!.from).toBe(1);
    expect(iter0[1]!.to).toBe(0);

    // Iteration 1 is the same shape, one scene duration later.
    const iter1 = opacity
      .filter((t) => t.start >= 4)
      .sort((a, b) => a.start - b.start);
    expect(iter1[0]!.start).toBeCloseTo(4, 10);
    expect(iter1[1]!.start).toBeCloseTo(7, 10);
  });

  it("reads `reverse` from authored items and compiles deterministically", async () => {
    const def = makeBoxScene();
    const a = (await precompile(
      makeAuthored(def, { time: { mode: "reverse" } }),
    )) as Composition;
    const b = (await precompile(
      makeAuthored(def, { time: { mode: "reverse" } }),
    )) as Composition;
    expect(validate(a).valid).toBe(true);
    expect(JSON.stringify(a.tweens)).toBe(JSON.stringify(b.tweens));
  });
});

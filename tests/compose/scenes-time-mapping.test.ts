// v0.5 §8.5 — time mapping for scene instances.
//
// Three non-identity modes:
//   - clip   : trim to a [fromTime, toTime] sub-window of the scene's timeline
//   - loop   : play the scene N times back-to-back
//   - timeScale: play at K× speed (start and duration both divided by scale)
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

  it("throws E_TIME_MAPPING_TWEEN_SPLIT on boundary-crossing tweens", () => {
    const def = makeBoxScene();
    try {
      expandSceneInstance(
        "s",
        {
          scene: "boxScene",
          // clip [0.5, 3.5] cuts across both fadeIn ([0,1]) and fadeOut ([3,4]).
          time: { mode: "clip", fromTime: 0.5, toTime: 3.5 },
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

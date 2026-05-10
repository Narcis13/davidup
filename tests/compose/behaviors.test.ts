// Unit tests for the §6 behavior registry — covers the 11 built-ins from
// the table in §6.3, the deterministic id scheme from §6.4, parameter
// validation (E_BEHAVIOR_*), and the compile-time `expandBehaviors` walker.

import { describe, expect, it } from "vitest";

import {
  expandBehavior,
  expandBehaviors,
  getBehaviorDescriptor,
  hasBehavior,
  listBehaviors,
} from "../../src/compose/behaviors.js";
import { MCPToolError } from "../../src/mcp/errors.js";

describe("listBehaviors / discovery", () => {
  it("includes all 11 built-ins from §6.3", () => {
    const names = listBehaviors().map((b) => b.name).sort();
    expect(names).toEqual(
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

  it("descriptors carry name, description, params, produces", () => {
    const popIn = getBehaviorDescriptor("popIn");
    expect(popIn).toBeDefined();
    expect(popIn?.description).toBeTypeOf("string");
    expect(Array.isArray(popIn?.params)).toBe(true);
    expect(popIn?.produces).toEqual(["opacity", "scaleX", "scaleY"]);
  });

  it("hasBehavior returns false for unknown names", () => {
    expect(hasBehavior("popIn")).toBe(true);
    expect(hasBehavior("doesNotExist")).toBe(false);
  });
});

describe("expandBehavior — fadeIn / fadeOut", () => {
  it("fadeIn produces one opacity 0→1 tween with derived id", () => {
    const out = expandBehavior({
      behavior: "fadeIn",
      target: "title",
      start: 0.5,
      duration: 0.4,
      easing: "easeOutQuad",
    });
    expect(out).toEqual([
      {
        id: "title_fadeIn_0.5__opacity",
        target: "title",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0.5,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ]);
  });

  it("fadeOut defaults to 1→0 and inherits parent easing", () => {
    const out = expandBehavior({
      behavior: "fadeOut",
      target: "logo",
      start: 19,
      duration: 1,
    });
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.from).toBe(1);
    expect(t.to).toBe(0);
    expect(t.easing).toBeUndefined();
  });

  it("explicit id is honoured for tween id derivation", () => {
    const out = expandBehavior({
      behavior: "fadeIn",
      target: "title",
      start: 0,
      duration: 1,
      id: "fade1",
    });
    expect(out[0]?.id).toBe("fade1__opacity");
  });
});

describe("expandBehavior — popIn / popOut", () => {
  it("popIn produces opacity + scaleX + scaleY", () => {
    const out = expandBehavior({
      behavior: "popIn",
      target: "title",
      start: 0,
      duration: 1,
      params: { fromScale: 0.5 },
    });
    expect(out.map((t) => t.property)).toEqual([
      "transform.opacity",
      "transform.scaleX",
      "transform.scaleY",
    ]);
    expect(out[1]?.from).toBe(0.5);
    expect(out[2]?.from).toBe(0.5);
    expect(out[1]?.to).toBe(1);
  });

  it("popOut runs scale & opacity in reverse defaults", () => {
    const out = expandBehavior({
      behavior: "popOut",
      target: "title",
      start: 0,
      duration: 1,
    });
    expect(out[0]?.from).toBe(1);
    expect(out[0]?.to).toBe(0);
    expect(out[1]?.from).toBe(1);
    expect(out[1]?.to).toBe(0.2);
  });
});

describe("expandBehavior — slideIn / slideOut / rotateSpin / pulse", () => {
  it("slideIn requires from + axis", () => {
    expect(() =>
      expandBehavior({
        behavior: "slideIn",
        target: "title",
        start: 0,
        duration: 1,
      }),
    ).toThrowError(MCPToolError);

    const out = expandBehavior({
      behavior: "slideIn",
      target: "title",
      start: 0,
      duration: 1,
      params: { from: -200, axis: "y" },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.property).toBe("transform.y");
    expect(out[0]?.from).toBe(-200);
    expect(out[0]?.to).toBe(0);
    expect(out[0]?.id).toBe("title_slideIn_0__y");
  });

  it("slideOut sends axis from current → to", () => {
    const out = expandBehavior({
      behavior: "slideOut",
      target: "title",
      start: 0,
      duration: 1,
      params: { to: 1080, axis: "x" },
    });
    expect(out[0]?.property).toBe("transform.x");
    expect(out[0]?.from).toBe(0);
    expect(out[0]?.to).toBe(1080);
  });

  it("rotateSpin defaults to 1 turn (2π)", () => {
    const out = expandBehavior({
      behavior: "rotateSpin",
      target: "wheel",
      start: 0,
      duration: 2,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.property).toBe("transform.rotation");
    expect(out[0]?.from).toBe(0);
    expect(out[0]?.to).toBeCloseTo(2 * Math.PI, 10);
  });

  it("rotateSpin respects `turns`", () => {
    const out = expandBehavior({
      behavior: "rotateSpin",
      target: "wheel",
      start: 0,
      duration: 2,
      params: { turns: 3 },
    });
    expect(out[0]?.to).toBeCloseTo(6 * Math.PI, 10);
  });

  it("pulse emits two back-to-back scaleX tweens (out then in)", () => {
    const out = expandBehavior({
      behavior: "pulse",
      target: "ball",
      start: 1,
      duration: 0.6,
      params: { peakScale: 1.4 },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.property).toBe("transform.scaleX");
    expect(out[1]?.property).toBe("transform.scaleX");
    expect(out[0]?.from).toBe(1);
    expect(out[0]?.to).toBe(1.4);
    expect(out[0]?.start).toBe(1);
    expect(out[0]?.duration).toBeCloseTo(0.3, 10);
    expect(out[1]?.from).toBe(1.4);
    expect(out[1]?.to).toBe(1);
    expect(out[1]?.start).toBeCloseTo(1.3, 10);
  });
});

describe("expandBehavior — kenburns / shake / colorCycle", () => {
  it("kenburns emits position + scaleX tweens", () => {
    const out = expandBehavior({
      behavior: "kenburns",
      target: "still",
      start: 0,
      duration: 4,
      params: { fromScale: 1, toScale: 1.2, pan: 100 },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.property).toBe("transform.x");
    expect(out[0]?.from).toBe(0);
    expect(out[0]?.to).toBe(100);
    expect(out[1]?.property).toBe("transform.scaleX");
    expect(out[1]?.from).toBe(1);
    expect(out[1]?.to).toBe(1.2);
  });

  it("kenburns missing required params errors with E_BEHAVIOR_PARAM_MISSING", () => {
    try {
      expandBehavior({
        behavior: "kenburns",
        target: "still",
        start: 0,
        duration: 4,
        params: { fromScale: 1, toScale: 1.2 },
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_BEHAVIOR_PARAM_MISSING");
    }
  });

  it("shake emits 4·cycles back-to-back tweens that hit ±amplitude and return to 0", () => {
    const out = expandBehavior({
      behavior: "shake",
      target: "ball",
      start: 0,
      duration: 1,
      params: { amplitude: 10, cycles: 2 },
    });
    expect(out).toHaveLength(8);
    // First tween: 0 → +10
    expect(out[0]?.from).toBe(0);
    expect(out[0]?.to).toBe(10);
    // Last tween ends back at 0
    expect(out[out.length - 1]?.to).toBe(0);
    // Tweens are contiguous (no gaps, no overlaps).
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      expect(cur.start).toBeCloseTo(prev.start + prev.duration, 10);
    }
    // Total span equals the requested duration.
    const last = out[out.length - 1]!;
    expect(last.start + last.duration).toBeCloseTo(1, 10);
  });

  it("shake suffix is zero-padded so ids sort lexicographically", () => {
    const out = expandBehavior({
      behavior: "shake",
      target: "ball",
      start: 0,
      duration: 1,
      params: { amplitude: 1, cycles: 3 }, // 12 tweens → 2-digit pad
    });
    expect(out[0]?.id).toBe("ball_shake_0__x_00");
    expect(out[9]?.id).toBe("ball_shake_0__x_09");
    expect(out[11]?.id).toBe("ball_shake_0__x_11");
  });

  it("colorCycle requires colors[] of ≥2", () => {
    try {
      expandBehavior({
        behavior: "colorCycle",
        target: "ball",
        start: 0,
        duration: 1,
        params: { colors: ["#ff0000"] },
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_BEHAVIOR_PARAM_TYPE");
    }
  });

  it("colorCycle emits N-1 segments with default property `tint`", () => {
    const out = expandBehavior({
      behavior: "colorCycle",
      target: "ball",
      start: 0,
      duration: 3,
      params: { colors: ["#ff0000", "#00ff00", "#0000ff", "#ffffff"] },
    });
    expect(out).toHaveLength(3);
    expect(out[0]?.property).toBe("tint");
    expect(out[0]?.from).toBe("#ff0000");
    expect(out[0]?.to).toBe("#00ff00");
    expect(out[2]?.from).toBe("#0000ff");
    expect(out[2]?.to).toBe("#ffffff");
    // Each segment is duration/3 ≈ 1
    expect(out[0]?.duration).toBeCloseTo(1, 10);
    expect(out[1]?.start).toBeCloseTo(1, 10);
  });
});

describe("expandBehavior — error paths", () => {
  it("unknown behavior name → E_BEHAVIOR_UNKNOWN", () => {
    try {
      expandBehavior({
        behavior: "doesNotExist",
        target: "x",
        start: 0,
        duration: 1,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_BEHAVIOR_UNKNOWN");
    }
  });

  it("non-numeric param → E_BEHAVIOR_PARAM_TYPE", () => {
    try {
      expandBehavior({
        behavior: "fadeIn",
        target: "x",
        start: 0,
        duration: 1,
        params: { fromOpacity: "0" as unknown as number },
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_BEHAVIOR_PARAM_TYPE");
    }
  });

  it("zero or negative duration → E_INVALID_VALUE", () => {
    try {
      expandBehavior({
        behavior: "fadeIn",
        target: "x",
        start: 0,
        duration: 0,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
    }
  });
});

describe("expandBehaviors — compile-time pass over composition.tweens", () => {
  it("returns the input unchanged when no $behavior entries are present", () => {
    const comp = {
      tweens: [
        {
          id: "t1",
          target: "x",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 1,
        },
      ],
    };
    const out = expandBehaviors(comp);
    expect(out).toBe(comp);
  });

  it("expands $behavior entries and preserves surrounding plain tweens + order", () => {
    const comp = {
      version: "0.2",
      tweens: [
        {
          id: "manual",
          target: "x",
          property: "transform.x",
          from: 0,
          to: 10,
          start: 0,
          duration: 1,
        },
        {
          $behavior: "popIn",
          target: "title",
          start: 0,
          duration: 1,
        },
        {
          id: "after",
          target: "y",
          property: "transform.x",
          from: 0,
          to: 10,
          start: 0,
          duration: 1,
        },
      ],
    };
    const out = expandBehaviors(comp) as { version: string; tweens: unknown[] };
    expect(out).not.toBe(comp);
    expect(out.version).toBe("0.2");
    expect(out.tweens).toHaveLength(5);
    const ids = out.tweens.map((t) => (t as { id: string }).id);
    expect(ids).toEqual([
      "manual",
      "title_popIn_0__opacity",
      "title_popIn_0__scaleX",
      "title_popIn_0__scaleY",
      "after",
    ]);
  });

  it("ignores non-objects and missing tweens key gracefully", () => {
    expect(expandBehaviors(42)).toBe(42);
    expect(expandBehaviors(null)).toBe(null);
    expect(expandBehaviors({ items: {} })).toEqual({ items: {} });
  });
});

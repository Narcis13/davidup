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
  registerBehavior,
  unregisterBehavior,
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
  it("kenburns emits position + scaleX + scaleY tweens (dual-axis zoom)", () => {
    const out = expandBehavior({
      behavior: "kenburns",
      target: "still",
      start: 0,
      duration: 4,
      params: { fromScale: 1, toScale: 1.2, pan: 100 },
    });
    expect(out).toHaveLength(3);
    expect(out[0]?.property).toBe("transform.x");
    expect(out[0]?.from).toBe(0);
    expect(out[0]?.to).toBe(100);
    expect(out[1]?.property).toBe("transform.scaleX");
    expect(out[1]?.from).toBe(1);
    expect(out[1]?.to).toBe(1.2);
    expect(out[2]?.property).toBe("transform.scaleY");
    expect(out[2]?.from).toBe(1);
    expect(out[2]?.to).toBe(1.2);
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

  // R-25/R-31 repro: a `start` arriving with FP noise from an upstream chain
  // (e.g. 13.200000000000001, from summing prior tween starts+durations)
  // used to make colorCycle self-collide — segment i's computed end
  // (start + i*seg + seg) didn't bit-match segment i+1's start
  // (start + (i+1)*seg) — an internal E_TWEEN_OVERLAP false positive.
  // Boundaries are now derived from one shared breakpoints array so
  // consecutive segments abut exactly regardless of `start`'s own noise.
  it("colorCycle segments abut exactly even when start carries FP noise", () => {
    const noisyStart = 13.2 + 4 * 0.20000000000000284; // reproduces 13.200000000000001-style drift
    const out = expandBehavior({
      behavior: "colorCycle",
      target: "ball",
      start: noisyStart,
      duration: 0.8,
      params: { colors: ["#ff0000", "#00ff00", "#0000ff"] },
    });
    expect(out).toHaveLength(2);
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      // Bit-exact, not just close — this is the property the overlap check relies on.
      expect(cur.start).toBe(prev.start + prev.duration);
    }
  });

  it("derives the auto id from a rounded start, stripping FP noise", () => {
    const out = expandBehavior({
      behavior: "fadeIn",
      target: "stat2__label",
      start: 4.8999999999999995,
      duration: 0.3,
    });
    expect(out[0]?.id).toBe("stat2__label_fadeIn_4.9__opacity");
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

  it("passes a parametric easing through to every emitted tween (v1.1 S17)", () => {
    const easing = { bezier: [0.34, 1.56, 0.64, 1] };
    const out = expandBehaviors({
      tweens: [{ $behavior: "popIn", target: "title", start: 0, duration: 1, easing }],
    }) as { tweens: Array<{ easing?: unknown }> };
    expect(out.tweens).toHaveLength(3);
    for (const t of out.tweens) expect(t.easing).toEqual(easing);

    const stepped = expandBehavior({
      behavior: "fadeIn",
      target: "x",
      start: 0,
      duration: 1,
      easing: { steps: 3 },
    });
    expect(stepped[0]!.easing).toEqual({ steps: 3 });
  });

  it("rejects an easing that is neither a name nor an object", () => {
    try {
      expandBehaviors({
        tweens: [{ $behavior: "fadeIn", target: "x", start: 0, duration: 1, easing: 42 }],
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
      expect((err as MCPToolError).message).toMatch(/bezier.*steps/);
    }
  });

  it("ignores non-objects and missing tweens key gracefully", () => {
    expect(expandBehaviors(42)).toBe(42);
    expect(expandBehaviors(null)).toBe(null);
    expect(expandBehaviors({ items: {} })).toEqual({ items: {} });
  });
});

// ──────────────── registerBehavior / unregisterBehavior (step 20.3, F3) ────────────────

describe("registerBehavior / unregisterBehavior — library hydration path", () => {
  it("registers a descriptor-only entry visible to hasBehavior + listBehaviors", () => {
    expect(hasBehavior("user_bounce")).toBe(false);
    registerBehavior({
      name: "user_bounce",
      description: "Vertical bounce.",
      params: [
        {
          name: "height",
          type: "number",
          required: false,
          description: "Peak Y.",
          default: 80,
        },
      ],
      produces: "dynamic",
    });
    try {
      expect(hasBehavior("user_bounce")).toBe(true);
      const desc = getBehaviorDescriptor("user_bounce");
      expect(desc?.description).toBe("Vertical bounce.");
      expect(desc?.params[0]?.name).toBe("height");
      const names = listBehaviors().map((b) => b.name);
      expect(names).toContain("user_bounce");
    } finally {
      unregisterBehavior("user_bounce");
    }
    expect(hasBehavior("user_bounce")).toBe(false);
  });

  it("expandBehavior on a metadata-only behavior throws E_BEHAVIOR_UNKNOWN with a hint", () => {
    registerBehavior({
      name: "user_metaonly",
      description: "",
      params: [],
      produces: "dynamic",
    });
    try {
      let caught: MCPToolError | null = null;
      try {
        expandBehavior({
          behavior: "user_metaonly",
          target: "logo",
          start: 0,
          duration: 1,
        });
      } catch (err) {
        caught = err as MCPToolError;
      }
      expect(caught).toBeInstanceOf(MCPToolError);
      expect(caught?.code).toBe("E_BEHAVIOR_UNKNOWN");
      expect(caught?.message).toMatch(/catalog metadata/i);
      expect(caught?.hint).toMatch(/tweens/i);
    } finally {
      unregisterBehavior("user_metaonly");
    }
  });

  it("re-registering a built-in name preserves its expand function (metadata-only override)", () => {
    const beforeDescriptor = getBehaviorDescriptor("fadeIn");
    expect(beforeDescriptor).toBeDefined();

    registerBehavior({
      name: "fadeIn",
      description: "Custom library description for fadeIn.",
      params: [
        {
          name: "fromOpacity",
          type: "number",
          required: false,
          description: "Overridden in library JSON.",
          default: 0,
        },
      ],
      produces: "dynamic",
    });
    try {
      const desc = getBehaviorDescriptor("fadeIn");
      expect(desc?.description).toBe("Custom library description for fadeIn.");

      // The built-in `expand` still works — fadeIn produces one opacity tween.
      const tweens = expandBehavior({
        behavior: "fadeIn",
        target: "logo",
        start: 0,
        duration: 1,
      });
      expect(tweens).toHaveLength(1);
      expect(tweens[0]?.property).toBe("transform.opacity");
    } finally {
      // Restore the built-in descriptor metadata so other tests see canonical state.
      if (beforeDescriptor) registerBehavior(beforeDescriptor);
    }
  });

  it("registerBehavior rejects an empty name", () => {
    expect(() =>
      registerBehavior({ name: "", description: "", params: [], produces: "dynamic" }),
    ).toThrow();
  });

  it("unregisterBehavior returns false for unknown names", () => {
    expect(unregisterBehavior("nope-not-here")).toBe(false);
  });
});

// ──────────── Executable user behaviors (v1.1 S19, spec §6.6) ────────────

describe("user behaviors with a `tweens` body", () => {
  function define(name: string, extra: Record<string, unknown> = {}): void {
    registerBehavior({
      name,
      description: "",
      params: [
        {
          name: "amount",
          type: "number",
          required: false,
          description: "",
          default: 1.2,
        },
      ],
      produces: [],
      tweens: [
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
      ],
      ...extra,
    });
  }

  it("expands the §6.6 `myBoinge` shape verbatim, with absolute times", () => {
    define("myBoinge");
    try {
      const tweens = expandBehavior({
        behavior: "myBoinge",
        target: "logo",
        start: 1,
        duration: 0.4,
      });
      expect(tweens).toEqual([
        {
          id: "logo_myBoinge_1__out",
          target: "logo",
          property: "transform.scaleX",
          from: 1,
          to: 1.2,
          start: 1,
          duration: 0.2,
          easing: "easeOutBack",
        },
        {
          id: "logo_myBoinge_1__in",
          target: "logo",
          property: "transform.scaleX",
          from: 1.2,
          to: 1,
          start: 1.2,
          duration: 0.2,
          easing: "easeInQuad",
        },
      ]);
    } finally {
      unregisterBehavior("myBoinge");
    }
  });

  it("substitutes supplied params over declared defaults", () => {
    define("myBoinge");
    try {
      const tweens = expandBehavior({
        behavior: "myBoinge",
        target: "logo",
        start: 0,
        duration: 0.4,
        params: { amount: 2 },
      });
      expect(tweens[0]?.to).toBe(2);
      expect(tweens[1]?.from).toBe(2);
    } finally {
      unregisterBehavior("myBoinge");
    }
  });

  it("derives `produces` from the body and reports executable", () => {
    define("myBoinge");
    try {
      const desc = getBehaviorDescriptor("myBoinge");
      // The caller passed `produces: []` — the body's suffixes win.
      expect(desc?.produces).toEqual(["out", "in"]);
      expect(desc?.executable).toBe(true);
    } finally {
      unregisterBehavior("myBoinge");
    }
  });

  it("omitted start/duration fill the whole block", () => {
    registerBehavior({
      name: "user_fill",
      description: "",
      params: [],
      produces: [],
      tweens: [{ property: "transform.opacity", from: 0, to: 1 }],
    });
    try {
      const [t] = expandBehavior({
        behavior: "user_fill",
        target: "logo",
        start: 2,
        duration: 3,
      });
      expect(t?.start).toBe(2);
      expect(t?.duration).toBe(3);
      // Suffix defaults to the (zero-padded) index.
      expect(t?.id).toBe("logo_user_fill_2__0");
    } finally {
      unregisterBehavior("user_fill");
    }
  });

  it("the block's easing applies to body tweens that don't pin their own", () => {
    registerBehavior({
      name: "user_easing",
      description: "",
      params: [],
      produces: [],
      tweens: [
        { property: "transform.opacity", from: 0, to: 1, duration: 0.5, suffix: "a" },
        {
          property: "transform.x",
          from: 0,
          to: 10,
          easing: "linear",
          suffix: "b",
        },
      ],
    });
    try {
      const tweens = expandBehavior({
        behavior: "user_easing",
        target: "logo",
        start: 0,
        duration: 1,
        easing: "easeInOutQuad",
      });
      expect(tweens[0]?.easing).toBe("easeInOutQuad");
      expect(tweens[1]?.easing).toBe("linear");
    } finally {
      unregisterBehavior("user_easing");
    }
  });

  it("a `$repeat` body staggers, and makes `produces` dynamic", () => {
    registerBehavior({
      name: "user_echo",
      description: "",
      params: [
        { name: "count", type: "number", required: true, description: "" },
      ],
      produces: [],
      tweens: [
        {
          $repeat: { count: "${params.count}", as: "i" },
          item: {
            suffix: "e${i}",
            property: "transform.opacity",
            from: 0,
            to: 1,
            start: "${$.start + i * 0.25}",
            duration: 0.25,
          },
        },
      ],
    });
    try {
      expect(getBehaviorDescriptor("user_echo")?.produces).toBe("dynamic");
      const tweens = expandBehavior({
        behavior: "user_echo",
        target: "logo",
        start: 0,
        duration: 1,
        params: { count: 3 },
      });
      expect(tweens.map((t) => [t.id, t.start, t.duration])).toEqual([
        ["logo_user_echo_0__e0", 0, 0.25],
        ["logo_user_echo_0__e1", 0.25, 0.25],
        ["logo_user_echo_0__e2", 0.5, 0.25],
      ]);
    } finally {
      unregisterBehavior("user_echo");
    }
  });

  it("a tween may retarget a companion item via ${$.target}", () => {
    registerBehavior({
      name: "user_companion",
      description: "",
      params: [],
      produces: [],
      tweens: [
        { property: "transform.opacity", from: 0, to: 1, suffix: "self" },
        {
          target: "${$.target}__glow",
          property: "transform.opacity",
          from: 1,
          to: 0,
          suffix: "glow",
        },
      ],
    });
    try {
      const tweens = expandBehavior({
        behavior: "user_companion",
        target: "logo",
        start: 0,
        duration: 1,
      });
      expect(tweens[0]?.target).toBe("logo");
      expect(tweens[1]?.target).toBe("logo__glow");
    } finally {
      unregisterBehavior("user_companion");
    }
  });

  it("rejects a required param that wasn't supplied", () => {
    registerBehavior({
      name: "user_req",
      description: "",
      params: [{ name: "n", type: "number", required: true, description: "" }],
      produces: [],
      tweens: [{ property: "transform.x", from: 0, to: "${params.n}" }],
    });
    try {
      expect(() =>
        expandBehavior({
          behavior: "user_req",
          target: "logo",
          start: 0,
          duration: 1,
        }),
      ).toThrow(/requires param "n"/);
      try {
        expandBehavior({
          behavior: "user_req",
          target: "logo",
          start: 0,
          duration: 1,
          params: { n: "nope" },
        });
        expect.unreachable();
      } catch (err) {
        expect((err as MCPToolError).code).toBe("E_BEHAVIOR_PARAM_TYPE");
      }
    } finally {
      unregisterBehavior("user_req");
    }
  });

  it("rejects a body that overlaps itself on one target+property", () => {
    registerBehavior({
      name: "user_overlap",
      description: "",
      params: [],
      produces: [],
      tweens: [
        { property: "transform.x", from: 0, to: 10, duration: 0.8, suffix: "a" },
        {
          property: "transform.x",
          from: 10,
          to: 0,
          start: "${$.start + 0.5}",
          duration: 0.5,
          suffix: "b",
        },
      ],
    });
    try {
      try {
        expandBehavior({
          behavior: "user_overlap",
          target: "logo",
          start: 0,
          duration: 1,
        });
        expect.unreachable();
      } catch (err) {
        expect((err as MCPToolError).code).toBe("E_TWEEN_OVERLAP");
      }
    } finally {
      unregisterBehavior("user_overlap");
    }
  });

  it("tweens that merely touch at an endpoint are fine", () => {
    registerBehavior({
      name: "user_touch",
      description: "",
      params: [],
      produces: [],
      tweens: [
        { property: "transform.x", from: 0, to: 10, duration: 0.5, suffix: "a" },
        {
          property: "transform.x",
          from: 10,
          to: 0,
          start: "${$.start + 0.5}",
          duration: 0.5,
          suffix: "b",
        },
      ],
    });
    try {
      expect(
        expandBehavior({
          behavior: "user_touch",
          target: "logo",
          start: 0,
          duration: 1,
        }),
      ).toHaveLength(2);
    } finally {
      unregisterBehavior("user_touch");
    }
  });

  it("rejects two tweens that would emit the same id", () => {
    registerBehavior({
      name: "user_dup",
      description: "",
      params: [],
      produces: [],
      tweens: [
        { property: "transform.x", from: 0, to: 1, duration: 0.4, suffix: "s" },
        {
          property: "transform.y",
          from: 0,
          to: 1,
          duration: 0.4,
          suffix: "s",
        },
      ],
    });
    try {
      try {
        expandBehavior({
          behavior: "user_dup",
          target: "logo",
          start: 0,
          duration: 1,
        });
        expect.unreachable();
      } catch (err) {
        expect((err as MCPToolError).code).toBe("E_DUPLICATE_ID");
      }
    } finally {
      unregisterBehavior("user_dup");
    }
  });

  it("rejects a malformed body at registration", () => {
    expect(() =>
      registerBehavior({
        name: "user_bad",
        description: "",
        params: [],
        produces: [],
        tweens: "nope" as unknown as ReadonlyArray<unknown>,
      }),
    ).toThrow(/must be an array/);
    expect(hasBehavior("user_bad")).toBe(false);
  });

  it("rejects a body tween with no property", () => {
    registerBehavior({
      name: "user_noprop",
      description: "",
      params: [],
      produces: [],
      tweens: [{ from: 0, to: 1 }],
    });
    try {
      try {
        expandBehavior({
          behavior: "user_noprop",
          target: "logo",
          start: 0,
          duration: 1,
        });
        expect.unreachable();
      } catch (err) {
        expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
        expect((err as MCPToolError).message).toMatch(/"property"/);
      }
    } finally {
      unregisterBehavior("user_noprop");
    }
  });

  it("expandBehaviors expands a $behavior block naming a user behavior", () => {
    define("myBoinge");
    try {
      const out = expandBehaviors({
        tweens: [
          { $behavior: "myBoinge", target: "logo", start: 0, duration: 0.4 },
        ],
      }) as { tweens: Array<{ id: string }> };
      expect(out.tweens.map((t) => t.id)).toEqual([
        "logo_myBoinge_0__out",
        "logo_myBoinge_0__in",
      ]);
    } finally {
      unregisterBehavior("myBoinge");
    }
  });

  it("session definitions passed via options shadow the registry", () => {
    const tweens = expandBehavior(
      { behavior: "fadeIn", target: "logo", start: 0, duration: 1 },
      {
        behaviors: {
          fadeIn: {
            name: "fadeIn",
            description: "session override",
            params: [],
            produces: [],
            tweens: [{ property: "transform.x", from: 0, to: 5, suffix: "x" }],
          },
        },
      },
    );
    expect(tweens).toHaveLength(1);
    expect(tweens[0]?.property).toBe("transform.x");
    // The process-global built-in is untouched by the session override.
    expect(
      expandBehavior({ behavior: "fadeIn", target: "logo", start: 0, duration: 1 })[0]
        ?.property,
    ).toBe("transform.opacity");
  });
});

// ──────────── Bug 2.1 — shadowing a built-in then dropping the shadow ────────────

describe("built-in / overlay registry layering (BUGS.md 2.1)", () => {
  it("unregistering a shadowing entry restores the built-in", () => {
    // 1. A library `fadeIn.behavior.json` shadows the built-in.
    registerBehavior({
      name: "fadeIn",
      description: "Library fadeIn card.",
      params: [],
      produces: "dynamic",
    });
    expect(getBehaviorDescriptor("fadeIn")?.description).toBe(
      "Library fadeIn card.",
    );

    // 2. The file is deleted; the watcher's reload diff drops the entry.
    expect(unregisterBehavior("fadeIn")).toBe(true);

    // 3. The built-in is back — before the fix this threw E_BEHAVIOR_UNKNOWN
    //    for the rest of the process's life.
    expect(hasBehavior("fadeIn")).toBe(true);
    const tweens = expandBehavior({
      behavior: "fadeIn",
      target: "logo",
      start: 0,
      duration: 1,
    });
    expect(tweens).toHaveLength(1);
    expect(tweens[0]?.property).toBe("transform.opacity");
    expect(getBehaviorDescriptor("fadeIn")?.description).toMatch(/Fade transform/);
  });

  it("an executable shadow also gives way to the built-in on unregister", () => {
    registerBehavior({
      name: "popIn",
      description: "Library popIn with its own body.",
      params: [],
      produces: [],
      tweens: [{ property: "transform.x", from: 0, to: 1, suffix: "x" }],
    });
    expect(
      expandBehavior({ behavior: "popIn", target: "l", start: 0, duration: 1 }),
    ).toHaveLength(1);
    unregisterBehavior("popIn");
    // Built-in popIn emits opacity + scaleX + scaleY.
    expect(
      expandBehavior({ behavior: "popIn", target: "l", start: 0, duration: 1 }),
    ).toHaveLength(3);
  });

  it("built-ins cannot be unregistered — there is no overlay entry to drop", () => {
    expect(unregisterBehavior("kenburns")).toBe(false);
    expect(hasBehavior("kenburns")).toBe(true);
  });
});

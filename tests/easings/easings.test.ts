import { describe, expect, it } from "vitest";
import {
  EASINGS,
  EASING_NAMES,
  PARAMETRIC_EASINGS,
  cubicBezier,
  easeInBack,
  easeInOutBack,
  easeInOutQuad,
  easeInQuad,
  easeOutBack,
  easeOutQuad,
  formatEasing,
  getEasing,
  isEasingName,
  linear,
  steps,
} from "../../src/easings/index.js";

const EPS = 1e-9;

describe("easing identity at endpoints", () => {
  for (const name of EASING_NAMES) {
    it(`${name}(0) ≈ 0 and ${name}(1) ≈ 1`, () => {
      const f = EASINGS[name];
      expect(Math.abs(f(0))).toBeLessThan(EPS);
      expect(Math.abs(f(1) - 1)).toBeLessThan(EPS);
    });
  }
});

describe("known midpoint values", () => {
  it("linear is identity", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(linear(t)).toBe(t);
    }
  });

  it("easeInQuad(0.5) === 0.25", () => {
    expect(easeInQuad(0.5)).toBe(0.25);
  });

  it("easeOutQuad(0.5) === 0.75", () => {
    expect(easeOutQuad(0.5)).toBe(0.75);
  });

  it("easeInOutQuad(0.5) === 0.5", () => {
    expect(easeInOutQuad(0.5)).toBe(0.5);
  });
});

describe("monotonic easings stay within tolerance", () => {
  // back easings overshoot on purpose; exclude them from monotonicity check.
  const monotonic = EASING_NAMES.filter((n) => !n.toLowerCase().includes("back"));
  for (const name of monotonic) {
    it(`${name} is non-decreasing on a 0..1 grid`, () => {
      const f = EASINGS[name];
      let prev = f(0);
      for (let i = 1; i <= 100; i++) {
        const v = f(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - EPS);
        prev = v;
      }
    });
  }
});

describe("back easings overshoot", () => {
  it("easeInBack dips below 0", () => {
    expect(easeInBack(0.2)).toBeLessThan(0);
  });
  it("easeOutBack rises above 1", () => {
    expect(easeOutBack(0.8)).toBeGreaterThan(1);
  });
  it("easeInOutBack overshoots on both ends", () => {
    expect(easeInOutBack(0.2)).toBeLessThan(0);
    expect(easeInOutBack(0.8)).toBeGreaterThan(1);
  });
});

describe("getEasing dispatcher", () => {
  it("returns linear for undefined", () => {
    expect(getEasing(undefined)).toBe(linear);
  });
  it("returns the requested easing", () => {
    expect(getEasing("easeInQuad")).toBe(easeInQuad);
  });
});

describe("isEasingName guard", () => {
  it("recognises known names", () => {
    expect(isEasingName("easeInQuad")).toBe(true);
  });
  it("rejects unknown names", () => {
    expect(isEasingName("easeBogus")).toBe(false);
  });
});

// ──────────────── Parametric easings (v1.1 S17) ────────────────

// CSS reference: Chromium 149.0.7827.55, `el.animate([{opacity: 0}, {opacity: 1}],
// {duration: 1000, easing})` paused at currentTime = x·1000, reading
// `effect.getComputedTiming().progress`. Chromium's own solver stops at ~1e-7
// in x, so these agree with the exact curve to ~1e-8.
const CSS_BEZIER_REFERENCE: ReadonlyArray<{
  bezier: [number, number, number, number];
  samples: ReadonlyArray<[number, number]>;
}> = [
  {
    bezier: [0.25, 0.1, 0.25, 1], // CSS `ease`
    samples: [
      [0.1, 0.09479630571576989],
      [0.25, 0.4085105913555371],
      [0.5, 0.8024033910598437],
      [0.75, 0.9604589783649767],
      [0.9, 0.9943164774961483],
    ],
  },
  {
    bezier: [0.42, 0, 0.58, 1], // CSS `ease-in-out`
    samples: [
      [0.25, 0.129161931047288],
      [0.5, 0.5],
    ],
  },
  {
    bezier: [0.34, 1.56, 0.64, 1], // overshoots above 1
    samples: [
      [0.3, 0.9073613805602576],
      [0.5, 1.08740067022722],
      [0.7, 1.0757760613091034],
    ],
  },
  {
    bezier: [1, 0, 0, 1], // x'(0.5) = 0: Newton stalls, bisection finishes
    samples: [
      [0.001, 3.3368089589830144e-7],
      [0.49, 0.3014186737388962],
      [0.5, 0.5],
      [0.51, 0.6985813262611046],
    ],
  },
];

// Exact value of cubic-bezier(0.25, 0.1, 0.25, 1) at x = 0.5, from bisection
// in exact rational arithmetic (200 halvings).
const EASE_AT_HALF_EXACT = 0.80240338758485698952;

// Independent reference: bisection to double resolution on the Bernstein form
// (the solver under test uses the power basis and Newton first).
function bernstein(p1: number, p2: number, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
}

function referenceBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (bernstein(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bernstein(y1, y2, (lo + hi) / 2);
}

describe("cubicBezier", () => {
  it("bezier (0.25, 0.1, 0.25, 1) at t = 0.5 matches the CSS reference to 1e-6", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(Math.abs(ease(0.5) - 0.8024033910598437)).toBeLessThan(1e-6);
    // …and the exact curve far more tightly.
    expect(Math.abs(ease(0.5) - EASE_AT_HALF_EXACT)).toBeLessThan(1e-12);
  });

  for (const { bezier, samples } of CSS_BEZIER_REFERENCE) {
    it(`cubic-bezier(${bezier.join(", ")}) matches Chromium at every sample`, () => {
      const f = cubicBezier(...bezier);
      for (const [x, expected] of samples) {
        expect(Math.abs(f(x) - expected), `x = ${x}`).toBeLessThan(1e-6);
      }
    });
  }

  it("agrees with an independent bisection on 200 seeded random curves", () => {
    // LCG so the curve set is identical on every run.
    let seed = 0x5eed17;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let worst = 0;
    for (let c = 0; c < 200; c++) {
      // x kept off 0/1: at x1 = 0 or x2 = 1 the tangent can be vertical, where
      // any x-tolerance becomes a large y error for any solver.
      const x1 = 0.05 + 0.9 * rand();
      const y1 = -1 + 3 * rand();
      const x2 = 0.05 + 0.9 * rand();
      const y2 = -1 + 3 * rand();
      const f = cubicBezier(x1, y1, x2, y2);
      for (let i = 1; i < 50; i++) {
        const t = i / 50;
        worst = Math.max(worst, Math.abs(f(t) - referenceBezier(x1, y1, x2, y2, t)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("hits the endpoints exactly and clamps input outside [0, 1]", () => {
    const curves: Array<[number, number, number, number]> = [
      [0.25, 0.1, 0.25, 1],
      [0.34, 1.56, 0.64, 1],
      [0.6, -0.28, 0.735, 0.045],
      [0, 0, 1, 1],
      [1, 0, 0, 1],
      [0, 1, 1, 0],
    ];
    for (const b of curves) {
      const f = cubicBezier(...b);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-0.5)).toBe(0);
      expect(f(1.5)).toBe(1);
    }
  });

  it("degenerate control points reduce to linear", () => {
    for (const b of [
      [0, 0, 1, 1],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [1 / 3, 1 / 3, 2 / 3, 2 / 3],
    ] as Array<[number, number, number, number]>) {
      const f = cubicBezier(...b);
      for (let i = 1; i < 20; i++) {
        expect(Math.abs(f(i / 20) - i / 20), `${b} at ${i / 20}`).toBeLessThan(1e-9);
      }
    }
  });

  it("is non-decreasing when y1, y2 stay in [0, 1]", () => {
    const f = cubicBezier(0.25, 0.1, 0.25, 1);
    let prev = f(0);
    for (let i = 1; i <= 1000; i++) {
      const v = f(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("is deterministic: repeated evaluation returns identical bits", () => {
    const a = cubicBezier(0.6, -0.28, 0.735, 0.045);
    const b = cubicBezier(0.6, -0.28, 0.735, 0.045);
    for (let i = 0; i <= 100; i++) {
      expect(Object.is(a(i / 100), b(i / 100))).toBe(true);
    }
  });
});

describe("steps", () => {
  // Same Chromium 149 probe as above with `steps(4)` / `steps(1)`.
  it("steps(4) matches CSS steps(4) (jump-end), including step boundaries", () => {
    const f = steps(4);
    const css: Array<[number, number]> = [
      [0, 0],
      [0.1, 0],
      [0.25, 0.25],
      [0.26, 0.25],
      [0.5, 0.5],
      [0.74, 0.5],
      [0.75, 0.75],
      [0.99, 0.75],
      [1, 1],
    ];
    for (const [x, expected] of css) expect(f(x), `x = ${x}`).toBe(expected);
  });

  it("steps(1) holds at 0 until the end", () => {
    const f = steps(1);
    expect(f(0)).toBe(0);
    expect(f(0.5)).toBe(0);
    expect(f(0.999)).toBe(0);
    expect(f(1)).toBe(1);
  });

  it("clamps input outside [0, 1]", () => {
    expect(steps(3)(-1)).toBe(0);
    expect(steps(3)(2)).toBe(1);
  });
});

describe("getEasing — parametric forms", () => {
  it("dispatches { bezier } to the cubic-bezier solver", () => {
    const f = getEasing({ bezier: [0.25, 0.1, 0.25, 1] });
    expect(f(0.5)).toBe(cubicBezier(0.25, 0.1, 0.25, 1)(0.5));
  });

  it("dispatches { steps } to steps(n)", () => {
    const f = getEasing({ steps: 5 });
    expect(f(0.39)).toBe(0.2);
    expect(f(0.4)).toBe(0.4);
  });
});

describe("formatEasing", () => {
  it("renders names verbatim and object forms CSS-style", () => {
    expect(formatEasing("easeOutQuad")).toBe("easeOutQuad");
    expect(formatEasing({ bezier: [0.25, 0.1, 0.25, 1] })).toBe("cubic-bezier(0.25, 0.1, 0.25, 1)");
    expect(formatEasing({ steps: 4 })).toBe("steps(4)");
  });
});

describe("PARAMETRIC_EASINGS", () => {
  it("documents both object forms with examples getEasing accepts", () => {
    expect(PARAMETRIC_EASINGS.map((p) => p.form)).toEqual(["bezier", "steps"]);
    for (const p of PARAMETRIC_EASINGS) {
      const f = getEasing(p.example as Parameters<typeof getEasing>[0]);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
  });
});

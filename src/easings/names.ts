// Names of easings supported in v0.1 (per design-doc §3.4), plus the two
// parametric object forms added in v1.1 S17.
// Kept separate from the function implementations so schema validation
// can depend on the names without pulling in math.

export const EASING_NAMES = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
] as const;

export type EasingName = (typeof EASING_NAMES)[number];

export const EASING_NAME_SET: ReadonlySet<string> = new Set(EASING_NAMES);

export function isEasingName(name: string): name is EasingName {
  return EASING_NAME_SET.has(name);
}

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` with implicit endpoints (0, 0) and
 * (1, 1). `x1` and `x2` must lie in [0, 1] so the curve is a function of
 * time; `y1` / `y2` may leave [0, 1] to overshoot.
 */
export interface BezierEasing {
  bezier: [number, number, number, number];
}

/**
 * CSS `steps(n)` (`jump-end`): holds at 0, 1/n, …, (n − 1)/n and reaches 1
 * when the tween ends. `n` is an integer ≥ 1.
 */
export interface StepsEasing {
  steps: number;
}

/** A tween's `easing`: a name, or one of the parametric object forms. */
export type Easing = EasingName | BezierEasing | StepsEasing;

/** Discovery metadata for the object forms (`list_easings`, capabilities). */
export const PARAMETRIC_EASINGS = [
  {
    form: "bezier",
    syntax: "{ bezier: [x1, y1, x2, y2] }",
    example: { bezier: [0.25, 0.1, 0.25, 1] },
    description:
      "CSS cubic-bezier(x1, y1, x2, y2) with implicit endpoints (0, 0) and (1, 1). x1 and x2 must be in [0, 1]; y1 and y2 may leave [0, 1] to overshoot. The example is CSS `ease`.",
  },
  {
    form: "steps",
    syntax: "{ steps: n }",
    example: { steps: 4 },
    description:
      "CSS steps(n) (jump-end): holds at 0, 1/n, …, (n − 1)/n and reaches 1 when the tween ends. n is an integer ≥ 1.",
  },
] as const;

/**
 * CSS-style label for an easing: the name itself,
 * `cubic-bezier(0.25, 0.1, 0.25, 1)` or `steps(4)`. For display only.
 */
export function formatEasing(easing: Easing): string {
  if (typeof easing === "string") return easing;
  if ("bezier" in easing) return `cubic-bezier(${easing.bezier.join(", ")})`;
  return `steps(${easing.steps})`;
}

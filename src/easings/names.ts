// Names of easings supported in v0.1 (per design-doc §3.4).
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

// Pure helpers for the easing picker (`inputs/Easing.vue`) — v1.1 S17.
//
// Kept in its own file so the unit tests can import this module without the
// SFC (japa can't load `.vue`). Same split as `timelineDragMath.ts`.
//
// An easing is a name, `{ bezier: [x1, y1, x2, y2] }` or `{ steps: n }`
// (engine EasingSchema). The picker is one select — the 19 names plus two
// sentinel options for the object forms — and number fields for the object
// form in use.

import { EASING_NAMES } from 'davidup/easings'
import type { BezierEasing, Easing, StepsEasing } from 'davidup/easings'

// Select values for the object forms. Neither is an easing name.
export const BEZIER_OPTION = 'cubic-bezier'
export const STEPS_OPTION = 'steps'

/** Seed when switching to cubic-bezier: CSS `ease`. */
export const DEFAULT_BEZIER: readonly [number, number, number, number] = [0.25, 0.1, 0.25, 1]
/** Seed when switching to steps. */
export const DEFAULT_STEPS = 4

export type BezierSlot = 0 | 1 | 2 | 3

export function isBezierEasing(easing: Easing | undefined): easing is BezierEasing {
  return typeof easing === 'object' && easing !== null && 'bezier' in easing
}

export function isStepsEasing(easing: Easing | undefined): easing is StepsEasing {
  return typeof easing === 'object' && easing !== null && 'steps' in easing
}

/** The select value for an easing; an omitted easing is linear. */
export function easingOptionValue(easing: Easing | undefined): string {
  if (isBezierEasing(easing)) return BEZIER_OPTION
  if (isStepsEasing(easing)) return STEPS_OPTION
  return easing ?? 'linear'
}

/**
 * The easing to emit when the select changes to `option`. Re-selecting the
 * form already in use keeps its numbers; switching to a form seeds it.
 * Returns null for an unknown option.
 */
export function easingForOption(option: string, current: Easing | undefined): Easing | null {
  if (option === BEZIER_OPTION) {
    if (isBezierEasing(current)) return current
    const [x1, y1, x2, y2] = DEFAULT_BEZIER
    return { bezier: [x1, y1, x2, y2] }
  }
  if (option === STEPS_OPTION) {
    return isStepsEasing(current) ? current : { steps: DEFAULT_STEPS }
  }
  return (EASING_NAMES as ReadonlyArray<string>).includes(option) ? (option as Easing) : null
}

/**
 * Apply a typed value to one bezier slot. x1 and x2 (slots 0 and 2) must stay
 * in [0, 1]; y1 and y2 may be any finite number. Returns null when the text
 * is not acceptable, so the field reverts instead of emitting.
 */
export function patchBezier(easing: BezierEasing, slot: BezierSlot, raw: string): BezierEasing | null {
  const value = parseDecimal(raw)
  if (value === null) return null
  if ((slot === 0 || slot === 2) && (value < 0 || value > 1)) return null
  const [x1, y1, x2, y2] = easing.bezier
  const next: [number, number, number, number] = [x1, y1, x2, y2]
  next[slot] = value
  return { bezier: next }
}

/** Parse a steps count: an integer ≥ 1, else null. */
export function parseSteps(raw: string): StepsEasing | null {
  const value = parseDecimal(raw)
  if (value === null || !Number.isInteger(value) || value < 1) return null
  return { steps: value }
}

function parseDecimal(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

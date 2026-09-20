// Paint-time accounting for the renderer (v1.3 G8, finding P-1).
//
// P-1 recorded the vertical showcase rendering at 1.46 fps without knowing
// *what* was slow — "points at the always-on blurred aurora (not measured in
// isolation yet; profile first)". This module is that measurement: a plain
// counter bag the caller hands to `renderFrame` through
// `RenderOptions.profile`, which the engine adds to as it allocates scratch
// surfaces and runs blur passes.
//
// It is deliberately not a global: nothing in the engine reads a counter back,
// so a profiled render paints byte-identical frames to an unprofiled one, and
// the cost when `profile` is absent is one `undefined` check per site.

import type { RenderProfile } from "./types.js";

/** A zeroed {@link RenderProfile}. */
export function emptyRenderProfile(): RenderProfile {
  return {
    offscreens: 0,
    offscreenPixels: 0,
    offscreensPooled: 0,
    blurs: 0,
    blurPixels: 0,
    blurMs: 0,
    shadowPasses: 0,
    effectItems: 0,
    isolatedGroups: 0,
  };
}

/** Zero every counter of `p`, in place — one bag can then serve every frame. */
export function resetRenderProfile(p: RenderProfile): void {
  p.offscreens = 0;
  p.offscreenPixels = 0;
  p.offscreensPooled = 0;
  p.blurs = 0;
  p.blurPixels = 0;
  p.blurMs = 0;
  p.shadowPasses = 0;
  p.effectItems = 0;
  p.isolatedGroups = 0;
}

/** Add every counter of `src` into `into`, in place. */
export function addRenderProfile(into: RenderProfile, src: RenderProfile): void {
  into.offscreens += src.offscreens;
  into.offscreenPixels += src.offscreenPixels;
  into.offscreensPooled += src.offscreensPooled;
  into.blurs += src.blurs;
  into.blurPixels += src.blurPixels;
  into.blurMs += src.blurMs;
  into.shadowPasses += src.shadowPasses;
  into.effectItems += src.effectItems;
  into.isolatedGroups += src.isolatedGroups;
}

/**
 * Monotonic milliseconds, or 0 where no clock is exposed.
 *
 * `performance` is a global in Node ≥ 16 and in every browser the engine
 * targets, but the engine is written against no host at all — a bare test
 * double in an exotic runtime must not crash on a profiled render, it may
 * simply report 0 ms.
 */
export function profileNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;
}

---
phase: 03-animation-timeline
plan: 05
subsystem: animation
tags: [presets, keyframes, fade, slide, scale, bounce, enter, exit]

# Dependency graph
requires:
  - phase: 03-03
    provides: PropertyAnimation and Keyframe types for preset generators
provides:
  - generateEnterKeyframes for fade, slide, scale, bounce enter animations
  - generateExitKeyframes for fade, slide, scale, bounce exit animations
  - PresetConfig, PresetType, SlideDirection type exports
affects: [03-07-animated-frame-generator, phase-4-video-output]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Enter animations use easeOut easing by default"
    - "Exit animations use easeIn easing by default"
    - "Bounce presets use easeOutBounce/easeInBounce"

key-files:
  created:
    - src/animation/presets.ts
    - tests/animation/presets.test.ts
  modified:
    - src/animation/index.ts

key-decisions:
  - "Presets work in frames (not seconds) - caller converts with Math.round(seconds * fps)"
  - "Bounce preset fades in/out at 30% of duration for smoother visual"
  - "Custom easing overrides defaults except bounce which always uses bounce easing"

patterns-established:
  - "Enter/exit complementary: enter ends at state where exit starts"
  - "Preset functions return PropertyAnimation[] for direct use with animation engine"

# Metrics
duration: 3min
completed: 2026-01-25
---

# Phase 3 Plan 5: Animation Presets Summary

**Enter/exit preset generators for fade, slide, scale, and bounce animations with direction and easing configuration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-25T13:56:03Z
- **Completed:** 2026-01-25T13:58:40Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- Implemented generateEnterKeyframes for fade, slide, scale, bounce presets
- Implemented generateExitKeyframes with reversed animations
- Slide preset supports four directions (left, right, top, bottom)
- 35 comprehensive tests covering all preset types and configurations
- All preset types exported from animation module

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Preset Types and Helpers** - `2c289db` (feat)
2. **Task 2: Create Preset Tests** - `e9f6357` (test)
3. **Task 3: Update Animation Module Exports** - `0115ce1` (feat)

## Files Created/Modified

- `src/animation/presets.ts` - Preset generators (generateEnterKeyframes, generateExitKeyframes)
- `tests/animation/presets.test.ts` - 35 tests for preset functionality
- `src/animation/index.ts` - Export presets from animation module

## Decisions Made

1. **Duration in frames:** PresetConfig.duration uses frames not seconds. This matches the runtime keyframe format (established in 03-03). Callers convert with `Math.round(seconds * fps)`.

2. **Bounce opacity timing:** Bounce preset fades in at 30% of duration (enter) and fades out starting at 70% (exit). This creates a smoother visual than fading throughout the bounce animation.

3. **Bounce ignores custom easing for scale:** Bounce preset always uses easeOutBounce/easeInBounce for scaleX/scaleY regardless of custom easing parameter. This ensures the bounce effect is preserved.

4. **Default easing by mode:** Enter animations default to `easeOut` (fast start, slow end). Exit animations default to `easeIn` (slow start, fast end). This follows common animation UX patterns.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing ImageData type errors in src/timeline/transitions.ts caused `npm run typecheck` to fail. This is from another plan and does not affect the presets implementation. Verified presets.ts compiles correctly by checking it specifically.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Preset generators ready for use in AnimatedFrameGenerator (03-07)
- All PropertyAnimation[] outputs compatible with animation engine (03-03)
- Four preset types cover common enter/exit animation needs

---
*Phase: 03-animation-timeline*
*Completed: 2026-01-25*

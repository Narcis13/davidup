---
phase: 03-animation-timeline
plan: 03
subsystem: animation
tags: [interpolation, keyframes, animation-engine, tdd]
dependency-graph:
  requires: [03-01]
  provides: [interpolation-utils, animation-engine]
  affects: [03-04, 03-05, 03-06, 03-07]
tech-stack:
  added: []
  patterns:
    - range-mapping-interpolation
    - keyframe-based-animation
    - time-visibility-gating
key-files:
  created:
    - src/animation/interpolate.ts
    - src/animation/animation-engine.ts
  modified:
    - src/animation/types.ts
    - src/animation/index.ts
    - tests/animation/interpolate.test.ts
    - tests/animation/animation-engine.test.ts
decisions:
  - key: runtime-keyframes-use-frames
    rationale: Avoids floating-point drift in frame calculations
  - key: schema-keyframes-use-seconds
    rationale: User-friendly, fps-independent
  - key: clamp-extrapolation-default
    rationale: Prevents unexpected values outside defined range
  - key: easing-priority-keyframe-over-default
    rationale: Fine-grained control per animation segment
metrics:
  duration: 3m
  completed: 2026-01-25
---

# Phase 3 Plan 3: Interpolation & Animation Engine Summary

**One-liner:** Range-mapping interpolation with clamp/extend extrapolation and keyframe-based animation engine supporting easing per segment.

## What Was Built

### interpolate.ts
Linear interpolation function that maps values from input range to output range:
- Frame number input, normalized progress internally
- Default clamping at range boundaries
- Optional `extend` extrapolation for values outside range
- Optional easing function application
- Handles edge cases (zero-length range, reversed ranges, negative outputs)

### animation-engine.ts
Core animation processing functions:

1. **getAnimatedValue(frame, keyframes, defaultEasing)**
   - Processes keyframe arrays to return interpolated values
   - Handles single keyframe (constant value)
   - Handles before-first and after-last keyframe cases
   - Sorts out-of-order keyframes internally
   - Applies keyframe-specific easing with fallback to default

2. **getAnimatedElement(element, frame, fps)**
   - Resolves animated properties for a specific frame
   - Returns `null` when frame is outside element visibility (startTime/endTime)
   - Merges animated values with static element properties
   - Strips animation metadata from output

### types.ts Additions
Runtime type definitions distinct from schema types:
- `Keyframe`: Uses `frame` number (not `time` in seconds)
- `PropertyAnimation`: Animation for x, y, rotation, scaleX, scaleY, opacity
- `AnimationPreset`: Pre-built animation presets
- `AnimatedElementProps`: Mixin for animated elements

## Key Design: Schema vs Runtime Keyframes

**Schema types (03-02):** `KeyframeSchema.time` in **seconds** (user-friendly, fps-independent)

**Runtime types (this plan):** `Keyframe.frame` in **frame numbers** (precise, no floating-point drift)

Conversion handled by AnimatedFrameGenerator (Plan 03-07):
```typescript
frame = Math.round(time * fps)
```

## TDD Execution

| Phase | Tests | Commits |
|-------|-------|---------|
| RED | 37 new tests (interpolate + animation-engine) | f27f837 |
| GREEN | All 119 animation tests pass | 46622ee |
| REFACTOR | No changes needed - code already clean | - |

## Test Coverage

### interpolate.test.ts (18 tests)
- Linear interpolation: start, middle, end of range
- Non-zero start frame, reversed output range
- Clamping (default): below range, above range
- Extend extrapolation: below range, above range, reversed
- Easing: easeIn, easeOut, linear, default behavior
- Edge cases: zero-length input, negative output range

### animation-engine.test.ts (19 tests)
- Single keyframe returns constant
- Two keyframes linear interpolation
- Before first/after last keyframe handling
- Multiple keyframes segment selection
- Out-of-order keyframes sorting
- Keyframe-specific easing, default easing, priority
- Empty keyframes handling
- getAnimatedElement: time visibility, property merging, multiple animations

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| src/animation/interpolate.ts | Created | 112 |
| src/animation/animation-engine.ts | Created | 163 |
| src/animation/types.ts | Extended | +67 |
| src/animation/index.ts | Extended | +14 |
| tests/animation/interpolate.test.ts | Created | 105 |
| tests/animation/animation-engine.test.ts | Created | 186 |

## Verification Results

```
npm run typecheck   # Pass - no errors
npm test -- tests/animation
  Test Files  3 passed (3)
       Tests  119 passed (119)
```

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies Satisfied

- **Requires 03-01:** Uses getEasingFunction from easing.ts
- **Provides for 03-04:** Animation presets will use interpolate and getAnimatedValue
- **Provides for 03-07:** AnimatedFrameGenerator will use getAnimatedElement

## Next Phase Readiness

Plan 03-03 complete. Ready for:
- **03-04:** Animation preset expansion (uses interpolation)
- **03-05:** Scene transition engine (uses interpolation)
- **03-06:** Word-by-word reveal animation
- **03-07:** AnimatedFrameGenerator integration

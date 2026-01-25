---
phase: 03-animation-timeline
plan: 02
subsystem: schemas
tags: [zod, animation, keyframes, transitions, typescript]

dependency-graph:
  requires: [01-01, 02-02]
  provides: [animation-schemas, scene-transitions]
  affects: [03-03, 03-04]

tech-stack:
  added: []
  patterns: [zod-enums, schema-composition, type-inference]

key-files:
  created:
    - src/schemas/animation.ts
    - tests/schemas/animation.test.ts
  modified:
    - src/schemas/scene.ts
    - src/schemas/index.ts

decisions:
  - id: easing-12-functions
    choice: "12 easing functions covering linear, quad, cubic, bounce, elastic"
    rationale: "Comprehensive set for common animation needs without bloat"
  - id: keyframe-time-from-zero
    choice: "Keyframe time >= 0, not strictly positive"
    rationale: "Allows keyframe at t=0 for initial state"
  - id: transition-on-scene
    choice: "Transition is optional field on SceneSchema"
    rationale: "Not all scenes need transitions, keeps simple scenes simple"

metrics:
  duration: 98s
  completed: 2026-01-25
---

# Phase 3 Plan 2: Animation Schemas Summary

Zod schemas for keyframes, property animations, presets, and scene transitions with TypeScript type inference.

## What Was Built

### Animation Schemas (`src/schemas/animation.ts`)

1. **EasingNameSchema** - 12 easing function names:
   - linear
   - easeIn, easeOut, easeInOut
   - easeInCubic, easeOutCubic, easeInOutCubic
   - easeInBounce, easeOutBounce, easeInOutBounce
   - easeInElastic, easeOutElastic, easeInOutElastic

2. **KeyframeSchema** - Animation keyframe:
   - `time`: number >= 0 (seconds from element start)
   - `value`: number (target value)
   - `easing`: optional easing function

3. **PropertyAnimationSchema** - Keyframe-based property animation:
   - `property`: enum ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity']
   - `keyframes`: array of KeyframeSchema (min 1)

4. **AnimationPresetSchema** - Pre-built animation effects:
   - `type`: enum ['fade', 'slide', 'scale', 'bounce']
   - `duration`: positive number, default 0.5s
   - `direction`: optional ['left', 'right', 'top', 'bottom']
   - `distance`: optional positive number
   - `easing`: optional easing function

5. **TransitionSchema** - Scene transition effects:
   - `type`: enum ['fade', 'slide', 'zoom']
   - `duration`: positive number, default 0.5s
   - `direction`: optional ['left', 'right', 'up', 'down']
   - `easing`: optional easing function

### Scene Extension

- Added `transition` optional field to `SceneSchema`
- Scene can now specify enter transition effect

### Barrel Export

- All schemas exported from `src/schemas/index.ts`
- Type exports: `EasingName`, `Keyframe`, `PropertyAnimation`, `AnimationPreset`, `Transition`

## Implementation Details

### Schema Design Choices

- **Easing as enum**: Type-safe, autocomplete in editors
- **Keyframe time >= 0**: Allows t=0 for initial state
- **Property enum**: Limited to animatable transform properties
- **Default durations**: 0.5s is a sensible UX default
- **Direction variants**: Transition uses up/down, preset uses top/bottom (matches common conventions)

### Test Coverage

22 tests covering:
- All 12 easing names validation
- Keyframe parsing and edge cases
- Property animation with empty/valid keyframes
- Preset defaults and all options
- Transition types and directions

## Deviations from Plan

None - plan executed exactly as written.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | bd7a4de | Animation schemas with tests |
| 2 | 005fe2e | Scene schema with transitions |
| 3 | 92c7b53 | Export from barrel |

## Verification Results

```
npm run typecheck: PASS
npm test -- tests/schemas: 44 tests passed
```

## Next Phase Readiness

- Animation schemas ready for animation engine (03-03)
- Transition schema ready for timeline controller (03-04)
- All types inferred for TypeScript consumers

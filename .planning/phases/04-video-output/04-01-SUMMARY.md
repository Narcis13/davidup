---
phase: 04-video-output
plan: 01
subsystem: encoder
tags: [ffmpeg, ffprobe, audio, zod, video-encoding]

# Dependency graph
requires:
  - phase: 03-animation-timeline
    provides: AnimatedFrameGenerator yields Buffer frames for encoding
provides:
  - FFmpeg spawn wrapper with Promise-based API
  - AudioConfigSchema for audio validation
  - Video encoding dependency stack (ffmpeg-static, ffprobe-static, get-audio-duration)
affects: [04-02, 04-03, 04-04]

# Tech tracking
tech-stack:
  added: [ffmpeg-static@5.3.0, ffprobe-static@3.1.0, get-audio-duration@4.0.1]
  patterns: [createRequire for CJS/ESM interop]

key-files:
  created: [src/encoder/ffmpeg-process.ts, src/schemas/audio.ts]
  modified: [package.json, src/schemas/index.ts]

key-decisions:
  - "createRequire for ffmpeg-static ESM/CJS interop"
  - "Auto-include -hide_banner and -loglevel error in FFmpeg spawn"
  - "AudioConfigSchema strict mode rejects unknown fields"

patterns-established:
  - "FFmpeg wrapper: spawn with Promise-based finished property for async/await"
  - "Audio schema: volume 0-1 range, fade durations in seconds"

# Metrics
duration: 5min
completed: 2026-01-25
---

# Phase 04 Plan 01: Video Encoding Foundation Summary

**FFmpeg spawn wrapper with Promise-based API and AudioConfigSchema with volume/fade validation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-25T17:47:06Z
- **Completed:** 2026-01-25T17:52:00Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments
- Installed ffmpeg-static, ffprobe-static, get-audio-duration dependencies
- Created Promise-based FFmpeg spawn wrapper with stdin pipe support
- Created AudioConfigSchema with volume, fadeIn, fadeOut validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Install encoding dependencies** - `6f4b6d9` (chore)
2. **Task 2: Create FFmpeg process wrapper** - `0f4cceb` (feat)
3. **Task 3: Create AudioConfigSchema** - `b261a4a` (feat)

## Files Created/Modified
- `package.json` - Added ffmpeg-static, ffprobe-static, get-audio-duration dependencies
- `src/encoder/ffmpeg-process.ts` - FFmpeg spawn wrapper with Promise-based API
- `src/schemas/audio.ts` - AudioConfigSchema with volume/fade validation
- `src/schemas/index.ts` - Export AudioConfigSchema

## Decisions Made
- **createRequire for ESM/CJS interop:** ffmpeg-static is CJS, used createRequire(import.meta.url) for clean import in ESM context
- **Auto-include FFmpeg flags:** -hide_banner and -loglevel error always added to reduce noise in output
- **Strict schema validation:** AudioConfigSchema uses .strict() to reject unknown fields, matching existing schema patterns

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript type conflict with ffmpeg-static default import:** The default import `import ffmpegPath from 'ffmpeg-static'` caused type errors with NodeNext module resolution. Resolved by using `createRequire()` pattern which provides clean ESM/CJS interoperability and explicit type annotation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FFmpeg wrapper ready for VideoEncoder (04-02) to use for frame encoding
- AudioConfigSchema ready for AudioProcessor (04-03) to validate audio input
- ffprobe-static available for get-audio-duration in AudioProcessor

---
*Phase: 04-video-output*
*Completed: 2026-01-25*

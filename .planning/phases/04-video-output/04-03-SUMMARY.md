---
phase: 04-video-output
plan: 03
subsystem: encoder
tags: [ffmpeg, audio, muxing, volume, fade]

# Dependency graph
requires:
  - phase: 04-01
    provides: FFmpeg process wrapper (spawnFFmpeg)
  - phase: 04-02
    provides: Video encoder producing silent video files
provides:
  - Audio filter chain building for FFmpeg -af flag
  - Audio muxing with video without re-encoding
  - Volume control (0-1 scale)
  - Fade in/out effects with duration-based timing
affects: [04-04, pipeline, api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FFmpeg filter chains as comma-separated strings"
    - "Video copy codec (-c:v copy) for fast muxing"

key-files:
  created:
    - "src/encoder/audio-processor.ts"
    - "tests/unit/encoder/audio-processor.test.ts"
  modified:
    - "src/encoder/index.ts"

key-decisions:
  - "FFmpeg volume filter uses linear scale (0.5 = half volume)"
  - "Fade out start calculated from video duration, not audio"
  - "-c:v copy avoids re-encoding video during muxing"
  - "-shortest truncates audio to match video length"
  - "AAC codec at 128k bitrate for standard quality"

patterns-established:
  - "Filter chain building: pure functions returning FFmpeg filter strings"
  - "Audio muxing: two-pass approach (silent video first, then mux audio)"

# Metrics
duration: 3min
completed: 2026-01-25
---

# Phase 04 Plan 03: Audio Processor Summary

**FFmpeg audio muxing with volume control and fade in/out effects using filter chain builder**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-25T17:57:41Z
- **Completed:** 2026-01-25T17:59:30Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Audio filter chain builder producing correct FFmpeg -af strings
- Audio muxing function using -c:v copy (no video re-encoding)
- Fade out timing calculated from video duration (not audio)
- 10 unit tests covering all filter chain scenarios
- Complete encoder module public API exported

## Task Commits

Each task was committed atomically:

1. **Task 1: Create audio filter chain builder** - `a4d0e59` (feat)
2. **Task 2: Create audio processor unit tests** - `651f892` (test)
3. **Task 3: Update encoder exports** - `5afcffa` (chore)

## Files Created/Modified
- `src/encoder/audio-processor.ts` - Filter chain builder and muxing function
- `tests/unit/encoder/audio-processor.test.ts` - 10 unit tests for filter chain
- `src/encoder/index.ts` - Exports buildAudioFilterChain, muxAudioWithVideo, MuxAudioOptions

## Decisions Made
- **Volume filter linear scale:** FFmpeg volume=0.5 means half volume (matches AudioConfig 0-1 range)
- **Fade out from video duration:** Critical - audio fade out must end when video ends, not when audio ends
- **-c:v copy for fast muxing:** Avoids expensive video re-encoding since only adding audio
- **-shortest flag:** Truncates audio to match video duration automatically
- **AAC at 128k:** Standard quality audio bitrate for web video

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Audio muxing ready for integration in 04-04 (RenderPipeline)
- muxAudioWithVideo() accepts AudioConfig from schema
- Filter chain builder can be tested independently of FFmpeg execution
- All audio requirements (AUDI-01 through AUDI-04) implemented

---
*Phase: 04-video-output*
*Completed: 2026-01-25*

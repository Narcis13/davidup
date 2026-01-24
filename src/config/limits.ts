/**
 * Video specification limits.
 * All constraints are validated against these values.
 * Centralized here to allow easy adjustment without touching schemas.
 */
export const VIDEO_LIMITS = {
  /** Maximum width in pixels */
  maxWidth: 1920,
  /** Maximum height in pixels */
  maxHeight: 1920,
  /** Maximum frames per second */
  maxFps: 60,
  /** Minimum frames per second */
  minFps: 1,
  /** Default frames per second when not specified */
  defaultFps: 30,
  /** Maximum video duration in seconds */
  maxDuration: 300,
} as const;

/** Type for VIDEO_LIMITS for use in other modules */
export type VideoLimits = typeof VIDEO_LIMITS;

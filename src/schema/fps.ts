// Frame-rate helpers (v1.1 S7).
//
// `composition.fps` is either a positive number (24, 60, 29.97) or an exact
// rational string "N/D" ("30000/1001" for NTSC 29.97). Decimals stay decimals:
// a number is never snapped to its NTSC rational, so existing compositions
// render byte-identically. Only the string form gets an exact timebase.
//
// Every site that turns a frame index into seconds (or back) goes through
// these helpers so the rational form never loses precision to `1 / 29.97…`.

/** Composition frame rate: a positive number or an exact "N/D" rational. */
export type Fps = number | string;

export interface FpsRational {
  /** Numerator. For the number form this is the number itself (may be fractional). */
  num: number;
  /** Denominator. 1 for the number form. */
  den: number;
}

const RATIONAL_RE = /^([1-9]\d*)\/([1-9]\d*)$/;

/** True for a well-formed "N/D" string with positive integer parts. */
export function isRationalFps(value: unknown): value is string {
  return typeof value === "string" && RATIONAL_RE.test(value);
}

/**
 * Split an fps into `{num, den}`. A number maps to `{num: fps, den: 1}` so
 * `i * den / num` reduces to the historical `i / fps` exactly.
 *
 * @throws {Error} for a malformed string (the schema rejects those first).
 */
export function fpsRational(fps: Fps): FpsRational {
  if (typeof fps === "number") return { num: fps, den: 1 };
  const m = RATIONAL_RE.exec(fps);
  if (!m) throw new Error(`Invalid fps "${fps}": expected a positive number or "N/D".`);
  return { num: Number.parseInt(m[1]!, 10), den: Number.parseInt(m[2]!, 10) };
}

/** Frame rate as a float (frames per second). */
export function fpsValue(fps: Fps): number {
  if (typeof fps === "number") return fps;
  const { num, den } = fpsRational(fps);
  return num / den;
}

/** Composition time (seconds) of frame `i`: `i * den / num`. */
export function frameTime(i: number, fps: Fps): number {
  if (typeof fps === "number") return i / fps;
  const { num, den } = fpsRational(fps);
  return (i * den) / num;
}

/**
 * Number of frames covering `duration` seconds: `ceil(duration * fps)`.
 * The rational form tolerates float noise (10.01 s @ 30000/1001 is exactly
 * 300 frames, not 301).
 */
export function framesForDuration(duration: number, fps: Fps): number {
  if (typeof fps === "number") return Math.ceil(duration * fps);
  const { num, den } = fpsRational(fps);
  return Math.ceil((duration * num) / den - 1e-9);
}

/**
 * The frame rate as an ffmpeg argument (`-r`, the `fps=` filter): "N/D" for
 * the rational form, the decimal otherwise.
 */
export function fpsArg(fps: Fps): string {
  if (typeof fps === "number") return String(fps);
  const { num, den } = fpsRational(fps);
  return `${num}/${den}`;
}

// `davidup render --profile` — turning a {@link RenderProfileReport} into the
// table printed on stderr (v1.3 G8, finding P-1).
//
// P-1 was written from one number: 900 frames in 617 s. What it could not say
// was *which part of the film* was slow, or what the time went on. So the
// report is banded by composition time — one row per `bandSeconds` of the
// timeline, which for a cut-to-music film is about one row per act — and each
// row carries the two costs the renderer actually controls: the scratch
// surfaces it allocates and the in-engine blur it runs on them.
//
// Pure and string-returning so the shape of the table is testable without a
// render.

import type { RenderProfileReport } from "../drivers/node/index.js";

/** Default band width, in seconds of composition time. */
export const DEFAULT_PROFILE_BAND_SECONDS = 2;

export interface ProfileBand {
  /** Inclusive start of the band in composition time. */
  from: number;
  /** Exclusive end — `from + bandSeconds`, or the last frame's time. */
  to: number;
  frames: number;
  /** Mean paint time per frame, ms. */
  paintMs: number;
  /** Frames per second of wall clock this band painted at. */
  fps: number;
  /** Mean time per frame inside `blurPixels`, ms. */
  blurMs: number;
  /** Mean scratch-surface area allocated per frame, in megapixels. */
  offscreenMpx: number;
  /** Mean scratch surfaces allocated per frame. */
  offscreens: number;
}

/** Group a report's frames into bands of `bandSeconds` of composition time. */
export function bandProfile(
  report: RenderProfileReport,
  bandSeconds: number = DEFAULT_PROFILE_BAND_SECONDS,
): ProfileBand[] {
  const bands = new Map<number, ProfileBand>();
  for (const f of report.frames) {
    const key = Math.floor(f.t / bandSeconds);
    let band = bands.get(key);
    if (band === undefined) {
      band = {
        from: key * bandSeconds,
        to: (key + 1) * bandSeconds,
        frames: 0,
        paintMs: 0,
        fps: 0,
        blurMs: 0,
        offscreenMpx: 0,
        offscreens: 0,
      };
      bands.set(key, band);
    }
    band.frames += 1;
    // Sums first; the means below divide once per band.
    band.paintMs += f.paintMs;
    band.blurMs += f.engine.blurMs;
    band.offscreenMpx += f.engine.offscreenPixels / 1e6;
    band.offscreens += f.engine.offscreens;
  }
  const out = [...bands.values()].sort((a, b) => a.from - b.from);
  for (const band of out) {
    band.fps = band.paintMs > 0 ? (band.frames / band.paintMs) * 1000 : Infinity;
    band.paintMs /= band.frames;
    band.blurMs /= band.frames;
    band.offscreenMpx /= band.frames;
    band.offscreens /= band.frames;
  }
  return out;
}

/**
 * The stderr table: one row per band, then a totals line. `realtimeFactor` on
 * the totals line is paint throughput ÷ the composition's own frame rate — 1.0
 * means the renderer keeps up with playback.
 */
export function formatProfileReport(
  report: RenderProfileReport,
  bandSeconds: number = DEFAULT_PROFILE_BAND_SECONDS,
): string {
  const bands = bandProfile(report, bandSeconds);
  const lines: string[] = [];
  lines.push(
    "  t (s)      frames   paint ms     fps   blur ms   scratch Mpx/frame  surfaces",
  );
  for (const b of bands) {
    lines.push(
      [
        `  ${fixed(b.from, 1).padStart(6)}–${fixed(b.to, 1).padEnd(6)}`,
        String(b.frames).padStart(5),
        fixed(b.paintMs, 1).padStart(10),
        fixed(b.fps, 2).padStart(7),
        fixed(b.blurMs, 1).padStart(9),
        fixed(b.offscreenMpx, 1).padStart(18),
        fixed(b.offscreens, 1).padStart(9),
      ].join(""),
    );
  }
  const frames = report.frames.length;
  const totalPaintS = report.paintMsTotal / 1000;
  const overallFps = totalPaintS > 0 ? frames / totalPaintS : Infinity;
  const blurS = sum(report.frames.map((f) => f.engine.blurMs)) / 1000;
  const surfaces = sum(report.frames.map((f) => f.engine.offscreens));
  const mpx = sum(report.frames.map((f) => f.engine.offscreenPixels)) / 1e6;
  lines.push(
    `  total ${frames} frames · ${fixed(totalPaintS, 1)} s paint · ${fixed(overallFps, 2)} fps` +
      ` (${fixed(overallFps / report.fps, 2)}× realtime)`,
  );
  lines.push(
    `  blur ${fixed(blurS, 1)} s (${fixed((blurS / Math.max(totalPaintS, 1e-9)) * 100, 1)}% of paint)` +
      ` · ${surfaces} scratch surfaces, ${fixed(mpx, 0)} Mpx allocated`,
  );
  return lines.join("\n");
}

function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

function fixed(n: number, digits: number): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

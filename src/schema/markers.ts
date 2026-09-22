// Markers on the timeline (hand-drawn film 4.0 D4).
//
// A marker is a named moment: `{ t, name, source? }`. Two places hold them:
//
//   composition.markers   `t` is timeline seconds, as written
//   audio[i].markers      `t` is seconds into the track's SOURCE FILE — a
//                         beat grid belongs to the music, so it moves with the
//                         track, drops what `trimIn` skips, repeats on every
//                         `loop` and stops where the track stops
//
// `timelineMarkers` flattens both into one list on the composition timeline,
// sorted by time: what the editor's ruler draws, what `hdf render --cues-from`
// cuts a film to. The renderer never reads markers.
//
// Where a track ends: its `end`; else, looping, the composition end; else the
// source's end (`start + duration − trimIn`) when the asset was probed with a
// duration; else unbounded. A looping track whose asset has no duration plays
// its markers once (the period is unknown).
//
// handdrawn/core/cuefile.js reads compositions with the same rules (it cannot
// import this TypeScript); tests/cli/hdfBridge.integration.test.ts checks the
// two agree.

import type { AudioTrack, Composition, Marker } from "./types.js";

export interface TimelineMarker {
  /** Timeline seconds. */
  t: number;
  name: string;
  source?: string;
  /** The audio track the marker came from (its id, or `audio[i]` when it has none). */
  track?: string;
  /** For a track marker: its time in the source file. */
  at?: number;
}

/** A looping track repeats its markers at most this many times (a tiny source under a long clip). */
export const MAX_LOOP_REPEATS = 10_000;

/**
 * Timeline seconds at which each of one track's markers plays: an array per
 * marker, in the marker's order (empty when it never plays).
 */
export function trackMarkerTimes(
  track: Pick<AudioTrack, "start" | "end" | "trimIn" | "loop" | "markers">,
  opts: { assetDuration?: number | undefined; compositionDuration?: number | undefined } = {},
): number[][] {
  const trimIn = track.trimIn ?? 0;
  const dur = opts.assetDuration;
  const period = dur !== undefined && dur - trimIn > 0 ? dur - trimIn : undefined;
  const end =
    track.end ??
    (track.loop ? opts.compositionDuration ?? Infinity : period !== undefined ? track.start + period : Infinity);
  return (track.markers ?? []).map((m) => {
    if (m.t < trimIn || (dur !== undefined && m.t > dur)) return [];
    const first = track.start + (m.t - trimIn);
    if (!track.loop || period === undefined) return first < end ? [first] : [];
    const out: number[] = [];
    for (let k = 0; k < MAX_LOOP_REPEATS; k++) {
      const t = first + k * period;
      if (t >= end) break;
      out.push(t);
    }
    return out;
  });
}

/** Every marker of a composition on its timeline, sorted by time (ties keep document order). */
export function timelineMarkers(comp: Pick<Composition, "composition" | "assets"> & { audio?: AudioTrack[] | undefined }): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  const own = (m: Marker): TimelineMarker => ({ t: m.t, name: m.name, ...(m.source !== undefined ? { source: m.source } : {}) });
  for (const m of comp.composition.markers ?? []) out.push(own(m));
  const durations = new Map<string, number | undefined>();
  for (const a of comp.assets) if (a.type === "audio") durations.set(a.id, a.duration);
  (comp.audio ?? []).forEach((track, i) => {
    const times = trackMarkerTimes(track, {
      assetDuration: durations.get(track.asset),
      compositionDuration: comp.composition.duration,
    });
    const id = track.id ?? `audio[${i}]`;
    (track.markers ?? []).forEach((m, j) => {
      for (const t of times[j]!) out.push({ ...own(m), t, track: id, at: m.t });
    });
  });
  return out
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.t - b.m.t || a.i - b.i)
    .map(({ m }) => m);
}

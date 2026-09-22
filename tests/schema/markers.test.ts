// Markers (hand-drawn film 4.0 D4): the schema, where a track's markers land on
// the timeline, and the W_MARKER_OUTSIDE warning.

import { describe, expect, it } from "vitest";

import { timelineMarkers, trackMarkerTimes, validateComposition } from "../../src/schema/index.js";
import type { Composition } from "../../src/schema/types.js";

function comp(extra: Partial<Composition> & { markers?: Composition["composition"]["markers"] } = {}): Composition {
  const { markers, ...rest } = extra;
  return {
    version: "0.1",
    composition: { width: 640, height: 360, fps: 30, duration: 10, background: "#000", ...(markers ? { markers } : {}) },
    assets: [{ id: "music", type: "audio", src: "music.wav", duration: 4 }],
    layers: [],
    items: {},
    tweens: [],
    ...rest,
  };
}

describe("MarkerSchema", () => {
  it("accepts markers on the composition and on an audio track", () => {
    const r = validateComposition(
      comp({
        markers: [{ t: 1, name: "intro", source: "hdf:clip" }],
        audio: [{ id: "m", asset: "music", start: 0, markers: [{ t: 0.5, name: "beat" }] }],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects a negative time, an empty name and unknown keys", () => {
    for (const bad of [{ t: -1, name: "a" }, { t: 1, name: "" }, { t: 1, name: "a", at: 2 }]) {
      const r = validateComposition(comp({ markers: [bad as never] }));
      expect(r.valid).toBe(false);
      expect(r.errors[0]!.code).toBe("E_SCHEMA");
      expect(r.errors[0]!.path).toMatch(/^composition\.markers\.0/);
    }
  });
});

describe("trackMarkerTimes", () => {
  const beats = [0, 1, 2, 3].map((t) => ({ t, name: "beat" }));

  it("places source seconds after the track's start", () => {
    expect(trackMarkerTimes({ start: 2, markers: beats }, { assetDuration: 4 })).toEqual([[2], [3], [4], [5]]);
  });

  it("drops what trimIn skips and shifts the rest", () => {
    expect(trackMarkerTimes({ start: 1, trimIn: 1.5, markers: beats }, { assetDuration: 4 })).toEqual([[], [], [1.5], [2.5]]);
  });

  it("stops at the track's end, or where the source runs out", () => {
    expect(trackMarkerTimes({ start: 0, end: 2.5, markers: beats }, { assetDuration: 4 })).toEqual([[0], [1], [2], []]);
    expect(trackMarkerTimes({ start: 0, trimIn: 2, markers: beats }, { assetDuration: 4 })).toEqual([[], [], [0], [1]]);
    // No duration known and no end: unbounded.
    expect(trackMarkerTimes({ start: 0, markers: beats })).toEqual([[0], [1], [2], [3]]);
  });

  it("repeats on every loop, to the end or the composition end", () => {
    const drop = [{ t: 1, name: "drop" }];
    expect(trackMarkerTimes({ start: 0, loop: true, markers: drop }, { assetDuration: 4, compositionDuration: 10 })).toEqual([[1, 5, 9]]);
    expect(trackMarkerTimes({ start: 0, loop: true, end: 6, markers: drop }, { assetDuration: 4, compositionDuration: 10 })).toEqual([[1, 5]]);
    // The repeated window starts at trimIn.
    expect(trackMarkerTimes({ start: 0, loop: true, trimIn: 2, markers: [{ t: 3, name: "x" }] }, { assetDuration: 4, compositionDuration: 7 })).toEqual([[1, 3, 5]]);
    // A loop of unknown length plays its markers once.
    expect(trackMarkerTimes({ start: 0, loop: true, markers: drop }, { compositionDuration: 10 })).toEqual([[1]]);
  });

  it("ignores a marker past the source's end", () => {
    expect(trackMarkerTimes({ start: 0, markers: [{ t: 5, name: "late" }] }, { assetDuration: 4 })).toEqual([[]]);
  });
});

describe("timelineMarkers", () => {
  it("merges the composition's and the tracks' markers, sorted, ties in document order", () => {
    const got = timelineMarkers(
      comp({
        markers: [{ t: 3, name: "chapter", source: "hdf:clip" }, { t: 0.5, name: "open" }],
        audio: [{ id: "m", asset: "music", start: 1, loop: true, end: 9.5, markers: [{ t: 2, name: "drop" }] }],
      }),
    );
    expect(got).toEqual([
      { t: 0.5, name: "open" },
      { t: 3, name: "chapter", source: "hdf:clip" },
      { t: 3, name: "drop", track: "m", at: 2 },
      { t: 7, name: "drop", track: "m", at: 2 },
    ]);
  });

  it("names a track without an id by its index", () => {
    const got = timelineMarkers(comp({ audio: [{ asset: "music", start: 0, markers: [{ t: 1, name: "b" }] }] }));
    expect(got).toEqual([{ t: 1, name: "b", track: "audio[0]", at: 1 }]);
  });
});

describe("W_MARKER_OUTSIDE", () => {
  it("warns on a composition marker past the end", () => {
    const r = validateComposition(comp({ markers: [{ t: 12, name: "late" }] }));
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "W_MARKER_OUTSIDE", path: "composition.markers.0" })]);
  });

  it("warns on a track marker that never plays inside the composition", () => {
    const r = validateComposition(
      comp({
        audio: [
          { id: "a", asset: "music", start: 0, trimIn: 2, markers: [{ t: 1, name: "skipped" }, { t: 3, name: "fine" }] },
          { id: "b", asset: "music", start: 9, markers: [{ t: 2, name: "past" }] },
        ],
      }),
    );
    expect(r.warnings.map((w) => w.path)).toEqual(["audio.0.markers.0", "audio.1.markers.0"]);
  });

  it("is quiet for markers that play", () => {
    const r = validateComposition(
      comp({ markers: [{ t: 10, name: "end" }], audio: [{ asset: "music", start: 0, loop: true, markers: [{ t: 3, name: "x" }] }] }),
    );
    expect(r.warnings).toEqual([]);
  });
});

// keepAudio lowering (v1.1 S11): video items with `keepAudio: true` become
// ordinary `audio[]` tracks that mirror the item's timing and trim.

import { describe, expect, it } from "vitest";

import { synthesizeVideoAudio } from "../../src/compose/index.js";

const TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
};

function comp(
  video: Record<string, unknown>,
  extra: { assets?: unknown[]; audio?: unknown[] } = {},
): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 64, height: 48, fps: 10, duration: 10 },
    assets: extra.assets ?? [{ id: "broll", type: "video", src: "/v/broll.mp4" }],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["clip"] }],
    items: {
      clip: {
        type: "video",
        asset: "broll",
        width: 64,
        height: 48,
        start: 0,
        fit: "contain",
        loop: false,
        transform: TRANSFORM,
        ...video,
      },
    },
    tweens: [],
    ...(extra.audio !== undefined ? { audio: extra.audio } : {}),
  };
}

function audioOf(out: unknown): unknown[] | undefined {
  return (out as { audio?: unknown[] }).audio;
}

describe("synthesizeVideoAudio", () => {
  it("returns the input untouched when no video item opts in", () => {
    const input = comp({ start: 1 });
    expect(synthesizeVideoAudio(input)).toBe(input);
    const off = comp({ keepAudio: false });
    expect(synthesizeVideoAudio(off)).toBe(off);
  });

  it("mirrors start / end / trimIn onto a `${itemId}__audio` track", () => {
    const out = synthesizeVideoAudio(
      comp({ keepAudio: true, start: 2, end: 6, trimIn: 1 }),
    );
    expect(audioOf(out)).toEqual([
      { id: "clip__audio", asset: "broll", start: 2, end: 6, trimIn: 1 },
    ]);
  });

  it("leaves `end` open when the item has neither `end` nor `trimOut`", () => {
    const out = synthesizeVideoAudio(comp({ keepAudio: true, start: 3 }));
    expect(audioOf(out)).toEqual([{ id: "clip__audio", asset: "broll", start: 3 }]);
  });

  it("stops the audio where `trimOut` exhausts the source (picture freezes, sound doesn't run on)", () => {
    const freeze = synthesizeVideoAudio(
      comp({ keepAudio: true, start: 1, end: 9, trimIn: 0.5, trimOut: 2.5 }),
    );
    expect(audioOf(freeze)).toEqual([
      { id: "clip__audio", asset: "broll", start: 1, end: 3, trimIn: 0.5 },
    ]);
    const open = synthesizeVideoAudio(comp({ keepAudio: true, start: 1, trimOut: 4 }));
    expect(audioOf(open)).toEqual([{ id: "clip__audio", asset: "broll", start: 1, end: 5 }]);
    // An `end` inside the trimmed window wins.
    const short = synthesizeVideoAudio(
      comp({ keepAudio: true, start: 1, end: 2, trimOut: 4 }),
    );
    expect(audioOf(short)).toEqual([{ id: "clip__audio", asset: "broll", start: 1, end: 2 }]);
  });

  it("a looping clip keeps its `end` (or none) and loops the audio too", () => {
    const out = synthesizeVideoAudio(
      comp({ keepAudio: true, loop: true, start: 0, end: 8, trimOut: 2 }),
    );
    expect(audioOf(out)).toEqual([
      { id: "clip__audio", asset: "broll", start: 0, end: 8, loop: true },
    ]);
  });

  it("appends after authored tracks without mutating the input", () => {
    const input = comp(
      { keepAudio: true },
      {
        assets: [
          { id: "broll", type: "video", src: "/v/broll.mp4" },
          { id: "music", type: "audio", src: "/a/music.mp3" },
        ],
        audio: [{ id: "bed", asset: "music", start: 0 }],
      },
    );
    const out = synthesizeVideoAudio(input);
    expect(audioOf(out)).toEqual([
      { id: "bed", asset: "music", start: 0 },
      { id: "clip__audio", asset: "broll", start: 0 },
    ]);
    expect(audioOf(input)).toHaveLength(1);
  });

  it("skips hidden clips and assets probed with no audio stream", () => {
    const hidden = comp({ keepAudio: true, visible: false });
    expect(synthesizeVideoAudio(hidden)).toBe(hidden);
    const silent = comp(
      { keepAudio: true },
      { assets: [{ id: "broll", type: "video", src: "/v/broll.mp4", hasAudio: false }] },
    );
    expect(synthesizeVideoAudio(silent)).toBe(silent);
    const known = comp(
      { keepAudio: true },
      { assets: [{ id: "broll", type: "video", src: "/v/broll.mp4", hasAudio: true }] },
    );
    expect(audioOf(synthesizeVideoAudio(known))).toHaveLength(1);
  });

  it("throws when an authored track already uses the synthesised id", () => {
    const input = comp(
      { keepAudio: true },
      { audio: [{ id: "clip__audio", asset: "broll", start: 0 }] },
    );
    expect(() => synthesizeVideoAudio(input)).toThrow(/clip__audio/);
  });
});

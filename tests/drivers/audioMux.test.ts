// Unit tests for the v0.2 §S4 audio mux pipeline: the pure filter/arg builders
// and input resolver, plus the two-stage `renderToFile` behaviour exercised
// through the fake ffmpeg spawn (no real ffmpeg / skia).

import { describe, expect, it } from "vitest";

import {
  buildAudioFilterComplex,
  buildMuxArgs,
  formatFilterSeconds,
  MUX_SAMPLE_RATE,
  renderToFile,
  resolveAudioInputs,
  type ResolvedAudioTrack,
} from "../../src/drivers/node/index.js";
import type { AudioTrack, Composition } from "../../src/schema/types.js";
import { FakeFfmpeg, makeFakeSpawn } from "./fakeFfmpeg.js";
import type { FakeSpawnRecord } from "./fakeFfmpeg.js";
import type { FfmpegSpawn } from "../../src/drivers/node/index.js";
import { makeFakeSkia } from "./fakeSkia.js";

function comp(overrides: Partial<Composition> = {}): Composition {
  return {
    version: "0.1",
    composition: {
      width: 32,
      height: 32,
      fps: 5,
      duration: 2,
      background: "#101010",
      ...(overrides.composition ?? {}),
    },
    assets: overrides.assets ?? [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 10,
        height: 10,
        fillColor: "#ff0000",
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
    ...(overrides.audio !== undefined ? { audio: overrides.audio } : {}),
  };
}

function resolved(track: AudioTrack, assetDuration?: number): ResolvedAudioTrack {
  return {
    track,
    src: `/audio/${track.asset}.wav`,
    ...(assetDuration !== undefined ? { assetDuration } : {}),
  };
}

describe("formatFilterSeconds", () => {
  it("emits fixed-point, trims trailing zeros, never exponential", () => {
    expect(formatFilterSeconds(0)).toBe("0");
    expect(formatFilterSeconds(2)).toBe("2");
    expect(formatFilterSeconds(0.5)).toBe("0.5");
    expect(formatFilterSeconds(1.25)).toBe("1.25");
    expect(formatFilterSeconds(0.0000001)).toBe("0"); // below µs → rounds away
    expect(formatFilterSeconds(12345.678901)).not.toMatch(/e/i);
  });
});

describe("buildAudioFilterComplex", () => {
  it("single track: resample → stereo, then pad+cap to video duration", () => {
    const filter = buildAudioFilterComplex([resolved({ asset: "music", start: 0 })], 2);
    expect(filter).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo[a0];" +
        "[a0]apad,atrim=0:2[aout]",
    );
  });

  it("applies trim, volume, fades and delay in canonical order", () => {
    const filter = buildAudioFilterComplex(
      [
        resolved({
          asset: "vo",
          start: 0.5,
          end: 1.5,
          volume: 0.8,
          fadeIn: 0.2,
          fadeOut: 0.3,
        }),
      ],
      2,
    );
    expect(filter).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo," +
        "atrim=0:1,asetpts=PTS-STARTPTS," +
        "volume=0.8," +
        "afade=t=in:st=0:d=0.2," +
        "afade=t=out:st=0.7:d=0.3," +
        "adelay=500:all=1[a0];" +
        "[a0]apad,atrim=0:2[aout]",
    );
  });

  it("seeks into the source with `trimIn`, independent of timeline placement (R-11)", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "vo", start: 2, trimIn: 10, end: 3 })],
      4,
    );
    expect(filter).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo," +
        "atrim=10:11,asetpts=PTS-STARTPTS," +
        "adelay=2000:all=1[a0];" +
        "[a0]apad,atrim=0:4[aout]",
    );
  });

  it("applies `trimIn` alone (no `end`) as an open-ended source seek", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "music", start: 0, trimIn: 5 })],
      2,
    );
    expect(filter).toContain("atrim=5,asetpts=PTS-STARTPTS");
  });

  it("omits the per-clip atrim entirely when neither `trimIn` nor `end` is set", () => {
    const filter = buildAudioFilterComplex([resolved({ asset: "music", start: 0 })], 2);
    expect(filter).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo[a0];" +
        "[a0]apad,atrim=0:2[aout]",
    );
  });

  it("places a fade-out relative to the trimmed clip using the probed asset duration minus `trimIn`", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "music", start: 0, trimIn: 1, fadeOut: 1 }, 4)],
      4,
    );
    // Remaining source after trimIn(1) out of assetDuration(4) is 3s; fade-out
    // starts at 3 - 1 = 2.
    expect(filter).toContain("afade=t=out:st=2:d=1");
  });

  it("uses the probed asset duration to place a fade-out when `end` is omitted", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "music", start: 0, fadeOut: 1 }, 4)],
      3,
    );
    // fade-out starts at assetDuration(4) - fadeOut(1) = 3.
    expect(filter).toContain("afade=t=out:st=3:d=1");
    // No atrim on the clip itself (end omitted) — only the final pad+cap.
    expect(filter).not.toContain("atrim=0:4");
    expect(filter).toContain("[a0]apad,atrim=0:3[aout]");
  });

  it("skips a fade-out when neither `end` nor asset duration is known", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "music", start: 0, fadeOut: 1 })],
      3,
    );
    expect(filter).not.toContain("afade=t=out");
  });

  it("omits the identity volume multiplier and the zero delay", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "m", start: 0, volume: 1 })],
      2,
    );
    expect(filter).not.toContain("volume=");
    expect(filter).not.toContain("adelay");
  });

  it("mixes N tracks with amix normalize=0 then caps the mix", () => {
    const filter = buildAudioFilterComplex(
      [
        resolved({ asset: "music", start: 0, volume: 0.4 }),
        resolved({ asset: "vo", start: 0.5, end: 1, fadeIn: 0.1 }),
      ],
      2,
    );
    expect(filter).toContain("[1:a]");
    expect(filter).toContain("[2:a]");
    expect(filter).toContain(
      "[a0][a1]amix=inputs=2:normalize=0,apad,atrim=0:2[aout]",
    );
  });
});

describe("buildMuxArgs", () => {
  it("maps copied video + filtered audio, forces 48kHz aac, faststart optional", () => {
    const args = buildMuxArgs({
      tempVideoPath: "/tmp/.tmp.mp4",
      inputs: ["/a/music.mp3", "/a/vo.wav"],
      filterComplex: "[aout]",
      outputPath: "/tmp/out.mp4",
      movflagsFaststart: true,
    });
    expect(args).toEqual([
      "-y",
      "-i",
      "/tmp/.tmp.mp4",
      "-i",
      "/a/music.mp3",
      "-i",
      "/a/vo.wav",
      "-filter_complex",
      "[aout]",
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-movflags",
      "+faststart",
      "/tmp/out.mp4",
    ]);
  });

  it("omits faststart when not requested and keeps output path last", () => {
    const args = buildMuxArgs({
      tempVideoPath: "/tmp/t.mp4",
      inputs: ["/a/x.wav"],
      filterComplex: "[aout]",
      outputPath: "/tmp/o.mp4",
    });
    expect(args).not.toContain("-movflags");
    expect(args[args.length - 1]).toBe("/tmp/o.mp4");
  });
});

describe("resolveAudioInputs", () => {
  it("resolves plain and global: srcs and carries probed duration", () => {
    const c = comp({
      assets: [
        { id: "music", type: "audio", src: "global:beds/loop.mp3", duration: 9 },
        { id: "vo", type: "audio", src: "/abs/vo.wav" },
      ],
      audio: [
        { id: "t1", asset: "music", start: 0 },
        { id: "t2", asset: "vo", start: 1 },
      ],
    });
    const out = resolveAudioInputs(c, "/lib");
    expect(out[0]!.src).toBe("/lib/beds/loop.mp3");
    expect(out[0]!.assetDuration).toBe(9);
    expect(out[1]!.src).toBe("/abs/vo.wav");
    expect(out[1]!.assetDuration).toBeUndefined();
  });

  it("throws on a missing asset reference", () => {
    const c = comp({ audio: [{ asset: "ghost", start: 0 }] });
    expect(() => resolveAudioInputs(c)).toThrow(/unknown asset "ghost"/);
  });

  it("throws when a track references a non-audio asset", () => {
    const c = comp({
      assets: [{ id: "pic", type: "image", src: "pic.png" }],
      audio: [{ asset: "pic", start: 0 }],
    });
    expect(() => resolveAudioInputs(c)).toThrow(/not "audio"/);
  });
});

describe("renderToFile — two-stage audio pipeline", () => {
  function audioComp(): Composition {
    return comp({
      composition: {
        width: 32,
        height: 32,
        fps: 5,
        duration: 2,
        background: "#101010",
      },
      assets: [
        { id: "music", type: "audio", src: "/a/music.mp3", duration: 2 },
        { id: "vo", type: "audio", src: "/a/vo.wav", duration: 0.5 },
      ],
      audio: [
        { id: "m", asset: "music", start: 0, volume: 0.4 },
        { id: "v", asset: "vo", start: 0.5, fadeIn: 0.1 },
      ],
    });
  }

  it("encodes to a temp video, then muxes to the real output", async () => {
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    const result = await renderToFile(audioComp(), "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
      movflagsFaststart: true,
    });

    expect(result.outputPath).toBe("/tmp/out.mp4");
    expect(result.frameCount).toBe(10); // 2s @ 5fps
    expect(harness.calls).toHaveLength(2);

    // Stage 1: rawvideo → temp file (no audio inputs, faststart suppressed).
    const stage1 = harness.calls[0]!;
    expect(stage1.args).toContain("rawvideo");
    expect(stage1.args).not.toContain("-movflags");
    const tempPath = stage1.args[stage1.args.length - 1]!;
    expect(tempPath).toMatch(/davidup-tmpvideo-.*\.mp4$/);
    expect(tempPath).not.toBe("/tmp/out.mp4");
    expect(stage1.ffmpeg.stdin.writes).toHaveLength(10);

    // Stage 2: mux temp + 2 audio inputs → /tmp/out.mp4 with faststart.
    const mux = harness.calls[1]!;
    expect(mux.args).toContain("-filter_complex");
    expect(mux.args).toContain("copy"); // -c:v copy
    expect(mux.args).toEqual(expect.arrayContaining(["-i", "/a/music.mp3"]));
    expect(mux.args).toEqual(expect.arrayContaining(["-i", "/a/vo.wav"]));
    expect(mux.args).toContain("-movflags");
    expect(mux.args[mux.args.length - 1]).toBe("/tmp/out.mp4");
    // Mux reads from files, not stdin.
    expect(mux.ffmpeg.stdin.writes).toHaveLength(0);
    expect(mux.ffmpeg.stdin.ended).toBe(true);
  });

  it("passes the video duration (frames/fps) as the audio cap", async () => {
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    await renderToFile(audioComp(), "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
    });

    const filterIdx = harness.calls[1]!.args.indexOf("-filter_complex");
    const filter = harness.calls[1]!.args[filterIdx + 1]!;
    expect(filter).toContain("atrim=0:2[aout]");
    expect(filter).toContain(`aresample=${MUX_SAMPLE_RATE}`);
  });

  it("stays single-stage when there is no audio", async () => {
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    await renderToFile(comp(), "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
    });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]!.args[harness.calls[0]!.args.length - 1]).toBe(
      "/tmp/out.mp4",
    );
  });

  it("surfaces a mux (stage 2) failure with the ffmpeg stderr tail", async () => {
    const skia = makeFakeSkia();
    // Stage 1 (video encode) succeeds; stage 2 (mux) exits non-zero. A shared
    // exit code would fail at stage 1 instead, so vary it per spawn call.
    const calls: FakeSpawnRecord[] = [];
    const spawn: FfmpegSpawn = (cmd, args) => {
      const isMux = args.includes("-filter_complex");
      const ffmpeg = new FakeFfmpeg(
        isMux
          ? { exitCode: 1, stderr: "Invalid argument in filtergraph\n" }
          : { exitCode: 0 },
      );
      calls.push({ cmd, args, ffmpeg });
      return ffmpeg as unknown as ReturnType<FfmpegSpawn>;
    };

    await expect(
      renderToFile(audioComp(), "/tmp/out.mp4", { skiaCanvas: skia, spawn }),
    ).rejects.toThrow(/ffmpeg \(mux\) exited with code 1[\s\S]*filtergraph/);
    expect(calls).toHaveLength(2);
  });

  it("fails loudly when the mux (stage 2) ffmpeg is killed by a signal (R-7)", async () => {
    const skia = makeFakeSkia();
    const calls: FakeSpawnRecord[] = [];
    const spawn: FfmpegSpawn = (cmd, args) => {
      const isMux = args.includes("-filter_complex");
      const ffmpeg = new FakeFfmpeg(
        isMux
          ? { signal: "SIGKILL", stderr: "killed mid-mux\n" }
          : { exitCode: 0 },
      );
      calls.push({ cmd, args, ffmpeg });
      return ffmpeg as unknown as ReturnType<FfmpegSpawn>;
    };

    await expect(
      renderToFile(audioComp(), "/tmp/out.mp4", { skiaCanvas: skia, spawn }),
    ).rejects.toThrow(/ffmpeg \(mux\) exited with signal SIGKILL[\s\S]*killed mid-mux/);
    expect(calls).toHaveLength(2);
  });
});

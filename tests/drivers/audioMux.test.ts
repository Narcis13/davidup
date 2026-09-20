// Unit tests for the v0.2 §S4 audio mux pipeline: the pure filter/arg builders
// and input resolver, plus the two-stage `renderToFile` behaviour exercised
// through the fake ffmpeg spawn (no real ffmpeg / skia).

import { describe, expect, it } from "vitest";

import {
  buildAudioFilterComplex,
  buildLoudnormAnalysisArgs,
  buildLoudnormAnalysisFilterComplex,
  buildMuxArgs,
  formatFilterSeconds,
  MUX_SAMPLE_RATE,
  parseLoudnormMeasurement,
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

// Default master bus (v1.1 S10): -1 dBFS lookahead limiter, no auto-level.
const LIMITER = "alimiter=limit=0.891251:level=0:latency=1";

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
        "[a0]" + LIMITER + ",apad,atrim=0:2[aout]",
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
        "[a0]" + LIMITER + ",apad,atrim=0:2[aout]",
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
        "[a0]" + LIMITER + ",apad,atrim=0:4[aout]",
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
        "[a0]" + LIMITER + ",apad,atrim=0:2[aout]",
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
    expect(filter).toContain("[a0]" + LIMITER + ",apad,atrim=0:3[aout]");
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
      "[a0][a1]amix=inputs=2:normalize=0," + LIMITER + ",apad,atrim=0:2[aout]",
    );
  });
});

describe("buildAudioFilterComplex — per-track loop (v1.1 S10)", () => {
  it("loops the source with aloop and cuts it to [start, end)", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "bed", start: 1, end: 7, loop: true }, 2)],
      8,
    );
    expect(filter).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo," +
        "aloop=loop=-1:size=2147483647,atrim=0:6,asetpts=PTS-STARTPTS," +
        "adelay=1000:all=1[a0];" +
        "[a0]" + LIMITER + ",apad,atrim=0:8[aout]",
    );
  });

  it("without `end`, loops out to the composition (video) end", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "bed", start: 2, loop: true, fadeOut: 1 }, 1.5)],
      10,
    );
    expect(filter).toContain("aloop=loop=-1:size=2147483647,atrim=0:8,");
    // The fade-out lands at the end of the looped span, not the asset's end.
    expect(filter).toContain("afade=t=out:st=7:d=1");
  });

  it("seeks `trimIn` once, before the loop, so the repeated region starts there", () => {
    const filter = buildAudioFilterComplex(
      [resolved({ asset: "bed", start: 0, end: 5, trimIn: 0.5, loop: true })],
      5,
    );
    expect(filter).toContain(
      "atrim=0.5,asetpts=PTS-STARTPTS,aloop=loop=-1:size=2147483647,atrim=0:5,asetpts=PTS-STARTPTS",
    );
  });

  it("`loop: false` is identical to omitting it", () => {
    const track = { asset: "vo", start: 0.5, end: 1.5, trimIn: 1 };
    expect(buildAudioFilterComplex([resolved({ ...track, loop: false })], 2)).toBe(
      buildAudioFilterComplex([resolved(track)], 2),
    );
  });
});

describe("buildAudioFilterComplex — video sources (v1.1 S11 keepAudio)", () => {
  it("reads a video file's first audio stream", () => {
    const filter = buildAudioFilterComplex(
      [{ ...resolved({ asset: "broll", start: 1, end: 3, trimIn: 0.5 }), fromVideo: true }],
      4,
    );
    expect(filter).toBe(
      "[1:a:0]aresample=48000,aformat=channel_layouts=stereo," +
        "atrim=0.5:2.5,asetpts=PTS-STARTPTS,adelay=1000:all=1[a0];" +
        "[a0]" + LIMITER + ",apad,atrim=0:4[aout]",
    );
  });

  it("bounds a looping clip's repeated window to [trimIn, trimOut)", () => {
    const filter = buildAudioFilterComplex(
      [
        {
          ...resolved({ asset: "broll", start: 0, end: 6, trimIn: 0.5, loop: true }),
          fromVideo: true,
          trimOut: 2,
        },
      ],
      6,
    );
    expect(filter).toContain(
      "atrim=0.5:2,asetpts=PTS-STARTPTS,aloop=loop=-1:size=2147483647,atrim=0:6,asetpts=PTS-STARTPTS",
    );
  });
});

describe("buildAudioFilterComplex — master bus (v1.1 S10)", () => {
  const tracks = [
    resolved({ asset: "music", start: 0 }),
    resolved({ asset: "vo", start: 0 }),
  ];
  const measurement = {
    inputI: -27.5,
    inputTp: -9.1,
    inputLra: 3.2,
    inputThresh: -37.9,
    targetOffset: 0.4,
  };

  it("limits by default and when `limiter: true`", () => {
    const expected = "[a0][a1]amix=inputs=2:normalize=0," + LIMITER + ",apad,atrim=0:2[aout]";
    expect(buildAudioFilterComplex(tracks, 2)).toContain(expected);
    expect(buildAudioFilterComplex(tracks, 2, { limiter: true })).toContain(expected);
  });

  it("`limiter: false` drops the limiter", () => {
    const filter = buildAudioFilterComplex(tracks, 2, { limiter: false });
    expect(filter).not.toContain("alimiter");
    expect(filter).toContain("[a0][a1]amix=inputs=2:normalize=0,apad,atrim=0:2[aout]");
  });

  it("with a target + measurement: linear loudnorm → 48k → limiter → pad/cap", () => {
    const filter = buildAudioFilterComplex(tracks, 2, { targetLufs: -16 }, measurement);
    expect(filter).toContain(
      "amix=inputs=2:normalize=0," +
        "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-27.5:measured_TP=-9.1:" +
        "measured_LRA=3.2:measured_thresh=-37.9:offset=0.4:linear=true," +
        "aresample=48000,aformat=channel_layouts=stereo," + LIMITER + ",apad,atrim=0:2[aout]",
    );
  });

  it("with a target but no measurement: single-pass loudnorm", () => {
    const filter = buildAudioFilterComplex(tracks, 2, { targetLufs: -23, limiter: false });
    expect(filter).toContain(
      "normalize=0,loudnorm=I=-23:TP=-1.5:LRA=11," +
        "aresample=48000,aformat=channel_layouts=stereo,apad",
    );
    expect(filter).not.toContain("measured_I");
  });

  it("clamps extreme measurements into loudnorm's option ranges", () => {
    const filter = buildAudioFilterComplex(tracks, 2, { targetLufs: -16 }, {
      inputI: -120,
      inputTp: -150,
      inputLra: 140,
      inputThresh: -130,
      targetOffset: 0,
    });
    expect(filter).toContain(
      "measured_I=-99:measured_TP=-99:measured_LRA=99:measured_thresh=-99:offset=0",
    );
  });

  it("analysis graph: same mix, capped, into loudnorm json", () => {
    expect(buildLoudnormAnalysisFilterComplex(tracks, 2, -16)).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo[a0];" +
        "[2:a]aresample=48000,aformat=channel_layouts=stereo[a1];" +
        "[a0][a1]amix=inputs=2:normalize=0,atrim=0:2," +
        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json[aout]",
    );
    expect(
      buildLoudnormAnalysisArgs({
        tempVideoPath: "/t.mp4",
        inputs: ["/m.mp3"],
        filterComplex: "G",
      }),
    ).toEqual([
      "-hide_banner", "-nostats", "-i", "/t.mp4", "-i", "/m.mp3",
      "-filter_complex", "G", "-map", "[aout]", "-f", "null", "-",
    ]);
  });
});

const LOUDNORM_STDERR = `Input #0, wav, from 'x.wav':
[Parsed_loudnorm_2 @ 0x7ff6027184c0] 
{
	"input_i" : "-29.75",
	"input_tp" : "-26.02",
	"input_lra" : "0.00",
	"input_thresh" : "-39.75",
	"output_i" : "-15.95",
	"output_tp" : "-12.27",
	"output_lra" : "0.00",
	"output_thresh" : "-25.95",
	"normalization_type" : "dynamic",
	"target_offset" : "-0.05"
}
`;

describe("parseLoudnormMeasurement", () => {
  it("reads the measured values from loudnorm's JSON stderr block", () => {
    expect(parseLoudnormMeasurement(LOUDNORM_STDERR)).toEqual({
      inputI: -29.75,
      inputTp: -26.02,
      inputLra: 0,
      inputThresh: -39.75,
      targetOffset: -0.05,
    });
  });

  it("returns undefined for silence (-inf) or a missing block", () => {
    expect(
      parseLoudnormMeasurement(LOUDNORM_STDERR.replace('"-29.75"', '"-inf"')),
    ).toBeUndefined();
    expect(parseLoudnormMeasurement("no json here")).toBeUndefined();
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

  it("muxes Opus (not AAC) into WebM and never passes -movflags (v1.1 S9)", () => {
    const args = buildMuxArgs({
      tempVideoPath: "/tmp/t.webm",
      inputs: ["/a/x.wav"],
      filterComplex: "[aout]",
      outputPath: "/tmp/o.webm",
      movflagsFaststart: true,
    });
    expect(args.join(" ")).toContain("-c:v copy -c:a libopus");
    expect(args).not.toContain("aac");
    expect(args).not.toContain("-movflags");
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

  it("accepts a video asset and picks up its keepAudio item's trimOut (v1.1 S11)", () => {
    const base = comp({
      assets: [{ id: "broll", type: "video", src: "/v/broll.mp4", duration: 4 }],
      audio: [{ id: "clip__audio", asset: "broll", start: 0, loop: true }],
    });
    const c: Composition = {
      ...base,
      items: {
        ...base.items,
        clip: {
          type: "video",
          asset: "broll",
          width: 32,
          height: 32,
          start: 0,
          trimOut: 1.5,
          fit: "contain",
          loop: true,
          keepAudio: true,
          transform: base.items.s!.transform,
        },
      },
    };
    const [out] = resolveAudioInputs(c);
    expect(out).toMatchObject({
      src: "/v/broll.mp4",
      assetDuration: 4,
      fromVideo: true,
      trimOut: 1.5,
    });
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

  it("muxes a keepAudio video item's own sound (v1.1 S11)", async () => {
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });
    const base = comp({
      assets: [{ id: "broll", type: "video", src: "/v/broll.mp4", duration: 3 }],
    });
    const c: Composition = {
      ...base,
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["clip"] }],
      items: {
        clip: {
          type: "video",
          asset: "broll",
          width: 32,
          height: 32,
          start: 0.5,
          trimIn: 1,
          trimOut: 2,
          fit: "contain",
          loop: false,
          keepAudio: true,
          transform: base.items.s!.transform,
        },
      },
    };

    await renderToFile(c, "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
      preExtract: false,
    });

    expect(harness.calls).toHaveLength(2);
    const mux = harness.calls[1]!;
    expect(mux.args).toEqual(expect.arrayContaining(["-i", "/v/broll.mp4"]));
    const filter = mux.args[mux.args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("[1:a:0]");
    expect(filter).toContain("atrim=1:2,asetpts=PTS-STARTPTS,adelay=500:all=1");
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

describe("renderToFile — loudness target runs an analysis pass (v1.1 S10)", () => {
  function loudComp(audioMaster: Composition["composition"]["audioMaster"]): Composition {
    return comp({
      composition: {
        width: 32,
        height: 32,
        fps: 5,
        duration: 2,
        background: "#101010",
        ...(audioMaster !== undefined ? { audioMaster } : {}),
      },
      assets: [{ id: "music", type: "audio", src: "/a/music.mp3", duration: 2 }],
      audio: [{ id: "m", asset: "music", start: 0 }],
    });
  }

  function spawnWith(analysisStderr: string): { spawn: FfmpegSpawn; calls: FakeSpawnRecord[] } {
    const calls: FakeSpawnRecord[] = [];
    const spawn: FfmpegSpawn = (cmd, args) => {
      const isAnalysis = args.includes("null");
      const ffmpeg = new FakeFfmpeg(
        isAnalysis ? { exitCode: 0, stderr: analysisStderr } : { exitCode: 0 },
      );
      calls.push({ cmd, args, ffmpeg });
      return ffmpeg as unknown as ReturnType<FfmpegSpawn>;
    };
    return { spawn, calls };
  }

  const filterOf = (args: ReadonlyArray<string>): string =>
    args[args.indexOf("-filter_complex") + 1]!;

  it("encode → analysis → mux, feeding the measurement into pass 2", async () => {
    const { spawn, calls } = spawnWith(LOUDNORM_STDERR);
    await renderToFile(loudComp({ targetLufs: -16 }), "/tmp/out.mp4", {
      skiaCanvas: makeFakeSkia(),
      spawn,
    });
    expect(calls).toHaveLength(3);
    expect(filterOf(calls[1]!.args)).toContain("print_format=json");
    const mux = filterOf(calls[2]!.args);
    expect(mux).toContain("measured_I=-29.75:measured_TP=-26.02");
    expect(mux).toContain("linear=true");
    expect(mux).toContain(LIMITER);
  });

  it("a silent mix (-inf) skips loudnorm but keeps the limiter", async () => {
    const { spawn, calls } = spawnWith(LOUDNORM_STDERR.replace('"-29.75"', '"-inf"'));
    await renderToFile(loudComp({ targetLufs: -16 }), "/tmp/out.mp4", {
      skiaCanvas: makeFakeSkia(),
      spawn,
    });
    expect(calls).toHaveLength(3);
    const mux = filterOf(calls[2]!.args);
    expect(mux).not.toContain("loudnorm");
    expect(mux).toContain(LIMITER);
  });

  it("no target → no analysis pass; `limiter: false` reaches the mux", async () => {
    const { spawn, calls } = spawnWith("");
    await renderToFile(loudComp({ limiter: false }), "/tmp/out.mp4", {
      skiaCanvas: makeFakeSkia(),
      spawn,
    });
    expect(calls).toHaveLength(2);
    expect(filterOf(calls[1]!.args)).not.toContain("alimiter");
  });
});

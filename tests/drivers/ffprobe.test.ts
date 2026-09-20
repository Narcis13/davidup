// Unit tests for `probeAudio` parsing + failure modes (v0.2 §S2), plus
// `probeVideoSync` (v1.3 B-7).
//
// These drive a fake spawn so no real ffprobe runs — the real-binary path is
// covered by ffprobe.integration.test.ts against committed audio fixtures.

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  FfprobeUnavailableError,
  probeAudio,
  probeVideoSync,
  type ProbeSpawn,
} from "../../src/drivers/node/ffprobe.js";

interface FakeProcOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  /** Emit an 'error' event (spawn-level failure) instead of closing. */
  spawnError?: Error;
  /** Make the spawn function itself throw synchronously. */
  throwOnSpawn?: Error;
}

class FakeStream extends EventEmitter {
  setEncoding(): this {
    return this;
  }
}

class FakeProc extends EventEmitter {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  constructor(opts: FakeProcOptions) {
    super();
    // Defer so runFfprobe's listeners are attached before anything fires.
    setImmediate(() => {
      if (opts.spawnError) {
        this.emit("error", opts.spawnError);
        return;
      }
      if (opts.stdout) this.stdout.emit("data", opts.stdout);
      if (opts.stderr) this.stderr.emit("data", opts.stderr);
      this.emit("close", opts.exitCode ?? 0);
    });
  }
}

function makeSpawn(opts: FakeProcOptions): {
  spawn: ProbeSpawn;
  calls: { cmd: string; args: ReadonlyArray<string> }[];
} {
  const calls: { cmd: string; args: ReadonlyArray<string> }[] = [];
  const spawn: ProbeSpawn = (cmd, args) => {
    if (opts.throwOnSpawn) throw opts.throwOnSpawn;
    calls.push({ cmd, args });
    return new FakeProc(opts) as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const okJson = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
    {
      codec_type: "audio",
      codec_name: "mp3",
      sample_rate: "44100",
      channels: 2,
      duration: "1.5",
    },
  ],
  format: { duration: "1.5" },
});

describe("probeAudio — parsing", () => {
  it("extracts duration, sampleRate, channels, codec from the first audio stream", async () => {
    const { spawn, calls } = makeSpawn({ stdout: okJson });
    const meta = await probeAudio("track.mp3", { ffprobePath: "ffprobe", spawn });

    expect(meta).toEqual({
      duration: 1.5,
      sampleRate: 44100,
      channels: 2,
      codec: "mp3",
    });
    // ffprobe invoked with JSON output flags on the requested file.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      "track.mp3",
    ]);
  });

  it("falls back to the audio stream's own duration when format duration is absent", async () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_type: "audio",
          codec_name: "aac",
          sample_rate: "48000",
          channels: 1,
          duration: "2.25",
        },
      ],
    });
    const { spawn } = makeSpawn({ stdout: json });
    const meta = await probeAudio("v.m4a", { ffprobePath: "ffprobe", spawn });
    expect(meta.duration).toBe(2.25);
    expect(meta.sampleRate).toBe(48000);
    expect(meta.codec).toBe("aac");
  });

  it("omits fields that ffprobe did not report (no spurious undefined keys)", async () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: "opus" }],
    });
    const { spawn } = makeSpawn({ stdout: json });
    const meta = await probeAudio("v.ogg", { ffprobePath: "ffprobe", spawn });
    expect(meta).toEqual({ codec: "opus" });
    expect("sampleRate" in meta).toBe(false);
    expect("duration" in meta).toBe(false);
  });
});

describe("probeAudio — failure modes", () => {
  it("throws FfprobeUnavailableError when the process emits a spawn error", async () => {
    const err = Object.assign(new Error("spawn ffprobe ENOENT"), {
      code: "ENOENT",
    });
    const { spawn } = makeSpawn({ spawnError: err });
    await expect(
      probeAudio("a.mp3", { ffprobePath: "ffprobe", spawn }),
    ).rejects.toBeInstanceOf(FfprobeUnavailableError);
  });

  it("throws FfprobeUnavailableError when the spawn call itself throws", async () => {
    const { spawn } = makeSpawn({ throwOnSpawn: new Error("EACCES") });
    await expect(
      probeAudio("a.mp3", { ffprobePath: "ffprobe", spawn }),
    ).rejects.toBeInstanceOf(FfprobeUnavailableError);
  });

  it("throws (not unavailable) on a non-zero exit, surfacing stderr", async () => {
    const { spawn } = makeSpawn({ exitCode: 1, stderr: "Invalid data found" });
    const promise = probeAudio("bad.mp3", { ffprobePath: "ffprobe", spawn });
    await expect(promise).rejects.toThrow(/Invalid data found/);
    await expect(promise).rejects.not.toBeInstanceOf(FfprobeUnavailableError);
  });

  it("throws when ffprobe output is not valid JSON", async () => {
    const { spawn } = makeSpawn({ stdout: "not json{" });
    await expect(
      probeAudio("x.wav", { ffprobePath: "ffprobe", spawn }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the file has no audio stream", async () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264" }],
      format: { duration: "3.0" },
    });
    const { spawn } = makeSpawn({ stdout: json });
    await expect(
      probeAudio("silent.mp4", { ffprobePath: "ffprobe", spawn }),
    ).rejects.toThrow(/No audio stream/);
  });
});

// ── probeVideoSync (v1.3 B-7): the extractor's synchronous, never-throwing
// probe. Only the fields the decoder choice needs are asserted here; the full
// parse is shared with `probeVideo` above. ──

const WEBM_ALPHA_JSON = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "vp9",
      width: 160,
      height: 120,
      pix_fmt: "yuv420p",
      avg_frame_rate: "24/1",
      tags: { alpha_mode: "1" },
    },
  ],
  format: { duration: "1.000000" },
});

describe("probeVideoSync", () => {
  it("reads the WebM alpha side channel that the pixel format hides", () => {
    const meta = probeVideoSync("/abs/overlay.webm", {
      ffprobePath: "/bin/ffprobe",
      spawnSync: () => ({ status: 0, stdout: WEBM_ALPHA_JSON }),
    });
    expect(meta?.codec).toBe("vp9");
    expect(meta?.pixelFormat).toBe("yuv420p");
    expect(meta?.hasAlpha).toBe(true);
  });

  it("returns undefined rather than throwing when ffprobe is missing", () => {
    expect(
      probeVideoSync("/abs/x.webm", {
        spawnSync: () => ({
          status: null,
          stdout: "",
          error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        }),
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a non-zero exit, unparseable output, or no video", () => {
    const sync = (r: { status: number; stdout: string }) =>
      probeVideoSync("/abs/x.webm", { spawnSync: () => r });
    expect(sync({ status: 1, stdout: "" })).toBeUndefined();
    expect(sync({ status: 0, stdout: "not json" })).toBeUndefined();
    expect(sync({ status: 0, stdout: '{"streams":[]}' })).toBeUndefined();
  });

  it("passes the source path to ffprobe last, after the JSON flags", () => {
    const calls: ReadonlyArray<string>[] = [];
    probeVideoSync("/abs/overlay.webm", {
      ffprobePath: "/bin/ffprobe",
      spawnSync: (_cmd, args) => {
        calls.push(args);
        return { status: 0, stdout: WEBM_ALPHA_JSON };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at(-1)).toBe("/abs/overlay.webm");
    expect(calls[0]).toContain("-show_streams");
  });
});

// §S8 node-driver wiring: renderToFile, given a composition with a video item,
// pre-extracts frames, builds a VideoFrameProvider, and the render loop draws
// the right frame per encoded frame. Runs without native skia/ffmpeg via a
// fake skia (FakeContext-backed canvas) and a fake spawn that writes dummy PNGs
// during the extraction call and behaves as the encoder otherwise.

import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { FfmpegSpawn } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";
import { FakeFfmpeg } from "./fakeFfmpeg.js";
import { makeFakeSkia } from "./fakeSkia.js";

const EXTRACTED_FRAMES = 4;

// One spawn used for BOTH phases. An arg ending in `.png` is the extraction's
// output pattern (`.../%05d.png`) → write dummy PNGs into that dir, then close
// 0. Otherwise it's the encoder → defer to the standard FakeFfmpeg.
function makeVideoFakeSpawn(): {
  spawn: FfmpegSpawn;
  calls: { cmd: string; args: ReadonlyArray<string> }[];
} {
  const calls: { cmd: string; args: ReadonlyArray<string> }[] = [];
  const spawn: FfmpegSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    const pngArg = args.find((a) => a.endsWith(".png"));
    if (pngArg) {
      const dir = dirname(pngArg);
      for (let i = 1; i <= EXTRACTED_FRAMES; i++) {
        writeFileSync(
          join(dir, `${String(i).padStart(5, "0")}.png`),
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        );
      }
      const proc = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: EventEmitter & { setEncoding: () => unknown };
        stdin: { end: () => void };
        kill: () => void;
      };
      proc.stdout = null;
      proc.stderr = Object.assign(new EventEmitter(), {
        setEncoding() {
          return this;
        },
      });
      proc.stdin = {
        end: () => {
          setImmediate(() => proc.emit("close", 0, null));
        },
      };
      proc.kill = () => {};
      return proc as unknown as ReturnType<FfmpegSpawn>;
    }
    const ffmpeg = new FakeFfmpeg({ exitCode: 0 });
    return ffmpeg as unknown as ReturnType<FfmpegSpawn>;
  };
  return { spawn, calls };
}

// Use the committed fixture so the default statSync in spec collection has a
// real file to stat (the fake spawn never actually decodes it).
const FIXTURE = join(
  dirname(new URL(import.meta.url).pathname),
  "fixtures",
  "video",
  "small.mp4",
);

function videoComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 32,
      height: 32,
      fps: 5,
      duration: 0.6, // ceil(0.6*5) = 3 encoded frames
      background: "#000000",
    },
    assets: [
      { id: "clip", type: "video", src: FIXTURE, duration: 1, width: 320, height: 240, fps: 30 },
    ],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["v"] }],
    items: {
      v: {
        type: "video",
        asset: "clip",
        width: 32,
        height: 32,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: "fill",
        loop: false,
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
  };
}

describe("renderToFile — draws pre-extracted video frames", () => {
  let cacheRoot: string;
  let workDir: string;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "davidup-s8-cache-"));
    workDir = mkdtempSync(join(tmpdir(), "davidup-s8-out-"));
  });
  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("paints one frame image per encoded frame, advancing the index", async () => {
    const comp = videoComp();
    const skia = makeFakeSkia();
    const { spawn } = makeVideoFakeSpawn();

    const result = await renderToFile(comp, join(workDir, "out.mp4"), {
      skiaCanvas: skia,
      spawn,
      preExtract: { cacheRoot },
    });

    expect(result.frameCount).toBe(3);

    // The single reused canvas should carry one video-frame drawImage per
    // encoded frame. Frame index advances floor(t*fps)+1: t=0,0.2,0.4 → 1,2,3.
    const canvas = skia.canvases[0]!;
    const frameDraws = canvas.ctx.calls.filter(
      (c) =>
        c.op === "drawImage" &&
        typeof c.image === "object" &&
        c.image !== null &&
        typeof (c.image as { src?: string }).src === "string" &&
        (c.image as { src: string }).src.endsWith(".png"),
    );
    expect(frameDraws).toHaveLength(3);

    const srcs = frameDraws.map((c) =>
      c.op === "drawImage" ? (c.image as { src: string }).src : "",
    );
    expect(srcs[0]!.endsWith("00001.png")).toBe(true);
    expect(srcs[1]!.endsWith("00002.png")).toBe(true);
    expect(srcs[2]!.endsWith("00003.png")).toBe(true);

    // fill into the 32×32 box via the 9-arg form. §S7 extracts frames at the
    // item's box size, so the intrinsic (source) frame is 32×32 too — fit is a
    // no-op at the base box, and the source rect spans the whole frame.
    const first = frameDraws[0]!;
    if (first.op === "drawImage") {
      expect({ dw: first.dw, dh: first.dh }).toEqual({ dw: 32, dh: 32 });
      expect({ sw: first.sw, sh: first.sh }).toEqual({ sw: 32, sh: 32 });
    }
  });

  it("freezes on the last extracted frame past the trimmed content", async () => {
    const comp = videoComp();
    // Extend the clip well past its 4 extracted frames (@5fps ⇒ ~0.8s content):
    comp.composition.duration = 2; // ceil(2*5)=10 encoded frames
    const skia = makeFakeSkia();
    const { spawn } = makeVideoFakeSpawn();

    await renderToFile(comp, join(workDir, "out.mp4"), {
      skiaCanvas: skia,
      spawn,
      preExtract: { cacheRoot },
    });

    const canvas = skia.canvases[0]!;
    const srcs = canvas.ctx.calls
      .filter(
        (c) =>
          c.op === "drawImage" &&
          (c.image as { src?: string })?.src?.endsWith(".png"),
      )
      .map((c) => (c.op === "drawImage" ? (c.image as { src: string }).src : ""));

    // 10 encoded frames, only 4 extracted → frames 1..4 then freeze on 4.
    expect(srcs.length).toBe(10);
    expect(srcs[3]!.endsWith("00004.png")).toBe(true);
    for (let i = 4; i < 10; i++) {
      expect(srcs[i]!.endsWith("00004.png")).toBe(true);
    }
  });
});

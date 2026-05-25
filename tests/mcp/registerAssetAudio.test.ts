// register_asset audio path through the dispatcher (v0.2 §S2).
//
// Two layers:
//   1. Injected-probe unit tests — deterministic, no subprocess. Cover the
//      happy path, the ffprobe-unavailable warning, a generic probe failure,
//      and unsupported-extension rejection.
//   2. Real-files E2E — register the three committed fixtures with the real
//      ffprobe-static binary and confirm list_assets surfaces the metadata.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { FfprobeUnavailableError } from "../../src/drivers/node/ffprobe.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drivers",
  "fixtures",
  "audio",
);

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function freshDeps(extra: Partial<ToolDeps> = {}): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 100, height: 100, fps: 30, duration: 10 });
  return { store, ...extra };
}

describe("register_asset (audio) — injected probe", () => {
  it("probes the src and stores duration/sampleRate/channels/codec", async () => {
    const deps = freshDeps({
      probeAudio: async (src) => {
        expect(src).toBe("voice.mp3");
        return { duration: 3.2, sampleRate: 44100, channels: 2, codec: "mp3" };
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "vo", type: "audio", src: "voice.mp3" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ ok: true });

    const asset = deps.store.listAssets().find((a) => a.id === "vo");
    expect(asset).toEqual({
      id: "vo",
      type: "audio",
      src: "voice.mp3",
      duration: 3.2,
      sampleRate: 44100,
      channels: 2,
      codec: "mp3",
    });
  });

  it("returns a warning and registers without metadata when ffprobe is unavailable", async () => {
    const deps = freshDeps({
      probeAudio: async () => {
        throw new FfprobeUnavailableError("no ffprobe");
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "m", type: "audio", src: "music.ogg" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/ffprobe not found/i);

    // Asset still registered, just without metadata.
    expect(deps.store.listAssets().find((a) => a.id === "m")).toEqual({
      id: "m",
      type: "audio",
      src: "music.ogg",
    });
  });

  it("warns (but still registers) when ffprobe runs and fails", async () => {
    const deps = freshDeps({
      probeAudio: async () => {
        throw new Error("Invalid data found when processing input");
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "bad", type: "audio", src: "corrupt.wav" },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings![0]).toMatch(/Invalid data found/);
    expect(deps.store.listAssets().find((a) => a.id === "bad")?.type).toBe("audio");
  });

  it("rejects an unsupported extension without invoking ffprobe", async () => {
    let probed = false;
    const deps = freshDeps({
      probeAudio: async () => {
        probed = true;
        return {};
      },
    });
    const out = await dispatchTool(
      getTool("register_asset"),
      { id: "x", type: "audio", src: "notes.txt" },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
    expect(probed).toBe(false);
  });
});

describe("register_asset (audio) — real fixtures via ffprobe-static", () => {
  const cases = [
    { id: "mp3", file: "tone-stereo.mp3", codec: "mp3", sampleRate: 44100, channels: 2 },
    { id: "wav", file: "tone-mono.wav", codec: "pcm_s16le", sampleRate: 48000, channels: 1 },
    { id: "m4a", file: "tone-stereo.m4a", codec: "aac", sampleRate: 44100, channels: 2 },
  ] as const;

  it("registers all three with probed metadata and lists them", async () => {
    // No injected probe → uses the default ffprobe-static-backed probe.
    const deps = freshDeps();
    for (const c of cases) {
      const out = await dispatchTool(
        getTool("register_asset"),
        { id: c.id, type: "audio", src: join(FIXTURES, c.file) },
        deps,
      );
      expect(out.ok, `${c.file} should register cleanly`).toBe(true);
      if (!out.ok) continue;
      // Real probe succeeded → no warnings.
      expect(out.result).toEqual({ ok: true });
    }

    const listed = await dispatchTool(getTool("list_assets"), {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const assets = (listed.result as { assets: Array<Record<string, unknown>> }).assets;

    for (const c of cases) {
      const asset = assets.find((a) => a.id === c.id)!;
      expect(asset.type).toBe("audio");
      expect(asset.codec).toBe(c.codec);
      expect(asset.sampleRate).toBe(c.sampleRate);
      expect(asset.channels).toBe(c.channels);
      expect(typeof asset.duration).toBe("number");
      expect(asset.duration as number).toBeGreaterThan(0);
    }
  });
});

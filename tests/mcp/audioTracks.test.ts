// Audio-track MCP tools through the dispatcher (v0.2 §S3).
//
// The headline test is the lifecycle the plan's "Verificare" calls for:
//   register_asset(audio) → add_audio_track → update_audio_track →
//   list_audio_tracks → remove_audio_track
// driven entirely through `dispatchTool` (the same path the real server and
// the editor bridge use). The rest cover the §S3 validations: asset must exist
// and be audio (errors), and a track running past the composition end is a
// warning, never an error (plan Q6).

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function freshDeps(duration = 30): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 1920, height: 1080, fps: 30, duration });
  return { store };
}

// Register an audio asset directly on the store with an injected duration so
// the natural-end warning path is exercisable without ffprobe in CI.
function withAudioAsset(
  deps: ToolDeps,
  id: string,
  opts: { src?: string; duration?: number } = {},
): void {
  deps.store.registerAsset({
    id,
    type: "audio",
    src: opts.src ?? `${id}.mp3`,
    ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
  });
}

async function call(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps,
) {
  return dispatchTool(getTool(name), args, deps);
}

describe("audio track tools — add → update → list → remove lifecycle", () => {
  it("walks a track through every tool and round-trips via toJSON", async () => {
    const deps = freshDeps(30);
    withAudioAsset(deps, "music", { duration: 12 });

    // add
    const added = await call(
      "add_audio_track",
      { asset: "music", start: 2, end: 14, volume: 0.8, fadeIn: 0.5, fadeOut: 1 },
      deps,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const { audioTrackId } = added.result as { audioTrackId: string };
    expect(audioTrackId).toBe("audio-1");
    // Fully inside [0, 30) → no warnings key.
    expect(added.result).toEqual({ audioTrackId: "audio-1" });

    // update
    const updated = await call(
      "update_audio_track",
      { id: audioTrackId, props: { volume: 1.5, start: 3 } },
      deps,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.result).toEqual({ ok: true });

    // list
    const listed = await call("list_audio_tracks", {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const { audioTracks } = listed.result as { audioTracks: Array<Record<string, unknown>> };
    expect(audioTracks).toEqual([
      { id: "audio-1", asset: "music", start: 3, end: 14, volume: 1.5, fadeIn: 0.5, fadeOut: 1 },
    ]);

    // the track is on the serialised composition
    expect(deps.store.toJSON().audio).toEqual(audioTracks);

    // remove
    const removed = await call("remove_audio_track", { id: audioTrackId }, deps);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.result).toEqual({ ok: true });

    const after = await call("list_audio_tracks", {}, deps);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect((after.result as { audioTracks: unknown[] }).audioTracks).toEqual([]);
    // audio key drops out of toJSON once empty (legacy-clean serialisation).
    expect("audio" in deps.store.toJSON()).toBe(false);
  });

  it("builds a composition with three audio tracks via MCP", async () => {
    const deps = freshDeps(60);
    withAudioAsset(deps, "voice", { duration: 20 });
    withAudioAsset(deps, "music", { duration: 60 });
    withAudioAsset(deps, "sfx", { duration: 2 });

    const ids: string[] = [];
    for (const track of [
      { asset: "voice", start: 1, end: 21, volume: 1 },
      { asset: "music", start: 0, volume: 0.3 },
      { asset: "sfx", start: 30, end: 32 },
    ]) {
      const out = await call("add_audio_track", track, deps);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      ids.push((out.result as { audioTrackId: string }).audioTrackId);
    }
    expect(ids).toEqual(["audio-1", "audio-2", "audio-3"]);

    const listed = await call("list_audio_tracks", {}, deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect((listed.result as { audioTracks: unknown[] }).audioTracks).toHaveLength(3);

    // filtered list
    const filtered = await call("list_audio_tracks", { asset: "music" }, deps);
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    const onlyMusic = (filtered.result as { audioTracks: Array<{ asset: string }> }).audioTracks;
    expect(onlyMusic).toHaveLength(1);
    expect(onlyMusic[0]!.asset).toBe("music");
  });
});

describe("audio track tools — asset validation", () => {
  it("rejects a track referencing an unregistered asset (E_NOT_FOUND)", async () => {
    const deps = freshDeps();
    const out = await call("add_audio_track", { asset: "ghost", start: 0 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_NOT_FOUND");
  });

  it("rejects a track referencing a non-audio asset (E_ASSET_TYPE_MISMATCH)", async () => {
    const deps = freshDeps();
    deps.store.registerAsset({ id: "pic", type: "image", src: "pic.png" });
    const out = await call("add_audio_track", { asset: "pic", start: 0 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_TYPE_MISMATCH");
  });

  it("re-checks the asset type when update_audio_track changes it", async () => {
    const deps = freshDeps();
    withAudioAsset(deps, "music");
    deps.store.registerAsset({ id: "pic", type: "image", src: "pic.png" });
    const added = await call("add_audio_track", { asset: "music", start: 0 }, deps);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = (added.result as { audioTrackId: string }).audioTrackId;

    const out = await call("update_audio_track", { id, props: { asset: "pic" } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_TYPE_MISMATCH");
  });

  it("blocks remove_asset while an audio track still references it", async () => {
    const deps = freshDeps();
    withAudioAsset(deps, "music");
    await call("add_audio_track", { asset: "music", start: 0 }, deps);
    const out = await call("remove_asset", { id: "music" }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_IN_USE");
  });
});

describe("audio track tools — past-composition-end warnings (not errors)", () => {
  it("warns (but succeeds) when an explicit end runs past the composition", async () => {
    const deps = freshDeps(10);
    withAudioAsset(deps, "music", { duration: 60 });
    const out = await call("add_audio_track", { asset: "music", start: 0, end: 25 }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { audioTrackId: string; warnings?: string[] };
    expect(result.audioTrackId).toBe("audio-1");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toMatch(/past the composition end/i);
  });

  it("warns from the asset's natural duration when end is omitted", async () => {
    const deps = freshDeps(10);
    withAudioAsset(deps, "music", { duration: 60 });
    const out = await call("add_audio_track", { asset: "music", start: 5 }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { warnings?: string[] };
    // start(5) + naturalDuration(60) = 65 > 10
    expect(result.warnings![0]).toMatch(/truncated at mux time/i);
  });

  it("warns when the track starts at or after the composition end", async () => {
    const deps = freshDeps(10);
    withAudioAsset(deps, "music", { duration: 2 });
    const out = await call("add_audio_track", { asset: "music", start: 12, end: 13 }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { warnings?: string[] };
    expect(result.warnings![0]).toMatch(/at or past the composition end/i);
  });

  it("does not warn when the track fits inside the composition", async () => {
    const deps = freshDeps(30);
    withAudioAsset(deps, "music", { duration: 5 });
    const out = await call("add_audio_track", { asset: "music", start: 1, end: 6 }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ audioTrackId: "audio-1" });
  });

  it("re-evaluates the warning on update_audio_track", async () => {
    const deps = freshDeps(10);
    withAudioAsset(deps, "music", { duration: 5 });
    const added = await call("add_audio_track", { asset: "music", start: 0, end: 5 }, deps);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = (added.result as { audioTrackId: string }).audioTrackId;

    const out = await call("update_audio_track", { id, props: { end: 40 } }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings![0]).toMatch(/past the composition end/i);
  });
});

describe("audio track tools — field + id validation", () => {
  it("rejects end <= start (E_INVALID_VALUE)", async () => {
    const deps = freshDeps();
    withAudioAsset(deps, "music");
    const out = await call("add_audio_track", { asset: "music", start: 5, end: 5 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("rejects a volume outside [0, 2] at the schema boundary", async () => {
    const deps = freshDeps();
    withAudioAsset(deps, "music");
    const out = await call("add_audio_track", { asset: "music", start: 0, volume: 3 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("rejects a duplicate explicit id (E_DUPLICATE_ID)", async () => {
    const deps = freshDeps();
    withAudioAsset(deps, "music");
    await call("add_audio_track", { asset: "music", start: 0, id: "bed" }, deps);
    const out = await call("add_audio_track", { asset: "music", start: 1, id: "bed" }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_DUPLICATE_ID");
  });

  it("returns E_NOT_FOUND removing or updating an unknown track id", async () => {
    const deps = freshDeps();
    const rm = await call("remove_audio_track", { id: "nope" }, deps);
    expect(rm.ok).toBe(false);
    if (rm.ok) return;
    expect(rm.error.code).toBe("E_NOT_FOUND");

    const up = await call("update_audio_track", { id: "nope", props: { volume: 1 } }, deps);
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error.code).toBe("E_NOT_FOUND");
  });
});
